import imageCompression from 'browser-image-compression';
import { supabase } from '../supabaseClient';
import { ReporteImagen } from '../types';

export const BUCKET_NAME = 'emergencias-bucket';

/**
 * Optimizador de imágenes en el cliente:
 * - Convierte y comprime a formato WebP.
 * - Resolución máxima 1280px (720p/1080p).
 * - Calidad 80% (0.8).
 * - Límite estricto de peso < 350 KB.
 */
export async function compressImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 0.35,
    maxWidthOrHeight: 1280,
    initialQuality: 0.8,
    useWebWorker: true,
    fileType: 'image/webp'
  };

  try {
    const compressedBlob = await imageCompression(file, options);
    const webpName = file.name.replace(/\.[^/.]+$/, "") + '.webp';
    return new File([compressedBlob], webpName, { type: 'image/webp' });
  } catch (error) {
    console.warn('[imageUtils] Aviso al comprimir imagen, enviando archivo original:', error);
    return file;
  }
}

/**
 * Sube una imagen optimizada directamente al bucket `emergencias-bucket` en Supabase Storage
 * y registra la entrada con la URL pública en `public.reportes_imagenes`.
 */
export async function uploadReporteImagen(
  file: File,
  target: { reporteId?: number | string; solicitudId?: number | string }
): Promise<ReporteImagen> {
  const reporteId = target.reporteId ? Number(target.reporteId) : null;
  const solicitudId = target.solicitudId ? Number(target.solicitudId) : null;

  if (!reporteId && !solicitudId) {
    throw new Error('Debe especificar un reporteId o solicitudId válido para asociar la evidencia.');
  }

  // 1. Comprimir en el cliente
  console.log(`[imageUtils] Comprimiendo imagen original (${(file.size / 1024).toFixed(1)} KB)...`);
  const compressedFile = await compressImage(file);
  console.log(`[imageUtils] Imagen comprimida lista (${(compressedFile.size / 1024).toFixed(1)} KB, WebP).`);

  // 2. Definir ruta única en el bucket
  const prefix = reporteId ? `reportes/${reporteId}` : `solicitudes/${solicitudId}`;
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const storagePath = `${prefix}/${timestamp}_${randomStr}.webp`;

  // 3. Subir archivo a Supabase Storage (emergencias-bucket)
  console.log(`[imageUtils] Subiendo a Supabase Storage: bucket '${BUCKET_NAME}', ruta '${storagePath}'...`);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, compressedFile, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'image/webp'
    });

  if (uploadError) {
    console.error('[imageUtils] Error en upload a Supabase Storage:', uploadError);
    throw new Error(`Error en Supabase Storage ('${BUCKET_NAME}'): ${uploadError.message}`);
  }

  const uploadedPath = uploadData?.path || storagePath;

  // 4. Obtener URL pública oficial
  const { data: publicUrlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(uploadedPath);

  const publicUrl = publicUrlData.publicUrl;
  console.log(`[imageUtils] URL pública de Supabase Storage: ${publicUrl}`);

  // 5. Insertar registro en la tabla `reportes_imagenes`
  const recordToInsert = {
    reporte_id: reporteId,
    solicitud_id: solicitudId,
    url_imagen: publicUrl,
    storage_path: uploadedPath,
    fecha_subida: new Date().toISOString()
  };

  console.log('[imageUtils] Insertando registro en BD public.reportes_imagenes:', recordToInsert);
  const { data: dbData, error: dbError } = await supabase
    .from('reportes_imagenes')
    .insert([recordToInsert])
    .select('*')
    .single();

  if (dbError) {
    console.error('[imageUtils] Error registrando imagen en BD:', dbError);
    // Limpieza de emergencia en Storage si falla la inserción en BD
    await supabase.storage.from(BUCKET_NAME).remove([uploadedPath]);
    throw new Error(`Error en base de datos: ${dbError.message}`);
  }

  console.log('[imageUtils] Evidencia guardada exitosamente:', dbData);
  return dbData as ReporteImagen;
}

/**
 * Consulta todas las imágenes ligadas a un reporte o solicitud específica.
 */
export async function fetchReporteImagenes(target: {
  reporteId?: number | string;
  solicitudId?: number | string;
}): Promise<ReporteImagen[]> {
  const reporteId = target.reporteId ? Number(target.reporteId) : null;
  const solicitudId = target.solicitudId ? Number(target.solicitudId) : null;

  try {
    let query = supabase.from('reportes_imagenes').select('*').order('fecha_subida', { ascending: false });

    if (reporteId) {
      query = query.eq('reporte_id', reporteId);
    } else if (solicitudId) {
      query = query.eq('solicitud_id', solicitudId);
    } else {
      return [];
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[imageUtils] Error al consultar evidencia fotográfica:', error.message);
      return [];
    }

    return (data || []) as ReporteImagen[];
  } catch (err) {
    console.error('[imageUtils] Error consultando imágenes:', err);
    return [];
  }
}

/**
 * Elimina una imagen existente:
 * - Borra el objeto en Supabase Storage usando `storage_path`.
 * - Elimina la fila de la BD `reportes_imagenes` por su `id`.
 */
export async function deleteReporteImagen(imagen: ReporteImagen): Promise<boolean> {
  console.log(`[imageUtils] Iniciando eliminación de evidencia ID ${imagen.id}...`);

  // 1. Borrar de Supabase Storage si el path es válido
  if (imagen.storage_path && imagen.storage_path !== 'inline_data_url' && !imagen.storage_path.startsWith('data:')) {
    console.log(`[imageUtils] Borrando de Storage: '${imagen.storage_path}'...`);
    const { error: storageErr } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([imagen.storage_path]);

    if (storageErr) {
      console.warn('[imageUtils] Aviso al borrar de Storage (continuando con eliminación en BD):', storageErr.message);
    } else {
      console.log('[imageUtils] Objeto borrado con éxito de Supabase Storage.');
    }
  }

  // 2. Borrar registro en la base de datos por ID
  console.log(`[imageUtils] Borrando registro de BD reportes_imagenes id = ${imagen.id}...`);
  const { error: dbErr } = await supabase
    .from('reportes_imagenes')
    .delete()
    .eq('id', imagen.id);

  if (dbErr) {
    console.error('[imageUtils] Error al eliminar registro en BD:', dbErr);
    throw new Error(`Error en base de datos al eliminar: ${dbErr.message}`);
  }

  console.log(`[imageUtils] Evidencia ID ${imagen.id} eliminada correctamente.`);
  return true;
}

