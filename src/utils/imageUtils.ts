import imageCompression from 'browser-image-compression';
import { supabase } from '../supabaseClient';
import { ReporteImagen } from '../types';

export const BUCKET_NAME = 'emergencias-bucket';

/**
 * Optimizador de imágenes en el cliente:
 * - Convierte/comprime a formato WebP (o JPEG si el navegador no soporta WebP).
 * - Resolución máxima 1280px (1280x720 max).
 * - Calidad 80% (0.8).
 * - Límite estricto de peso < 350 KB (0.35 MB) para preservar la cuota de Supabase.
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
    const compressedFile = await imageCompression(file, options);
    // Renombrar archivo comprimido a .webp
    const webpName = file.name.replace(/\.[^/.]+$/, "") + '.webp';
    return new File([compressedFile], webpName, { type: compressedFile.type || 'image/webp' });
  } catch (error) {
    console.warn('[imageUtils] Fallback a compresión por defecto:', error);
    // Si la conversión a WebP falla, intentamos compresión estándar JPEG/PNG
    try {
      return await imageCompression(file, {
        maxSizeMB: 0.35,
        maxWidthOrHeight: 1280,
        initialQuality: 0.8,
        useWebWorker: true
      });
    } catch (err) {
      console.error('[imageUtils] Error irreversible al comprimir la imagen:', err);
      return file;
    }
  }
}

/**
 * Convierte un File a Data URL (Base64) para fallback cuando el bucket de Supabase Storage no está creado.
 */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Sube una imagen optimizada a Supabase Storage (o fallback a WebP DataURL) y registra la entrada en `public.reportes_imagenes`.
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

  // 1. Comprimir en el cliente (WebP <350KB, 1280x720 max)
  const optimizedFile = await compressImage(file);

  // 2. Definir nombre único de archivo
  const prefix = reporteId ? `rep_${reporteId}` : `sol_${solicitudId}`;
  const timestamp = Date.now();
  const randomHash = Math.random().toString(36).substring(2, 8);
  const fileName = `${prefix}_${timestamp}_${randomHash}.webp`;
  const storagePath = `evidencias/${fileName}`;

  let finalUrl = '';
  let finalStoragePath = storagePath;

  // 3. Intentar subir archivo a Supabase Storage bucket 'emergencias-bucket'
  try {
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, optimizedFile, {
        cacheControl: '3600',
        upsert: false,
        contentType: optimizedFile.type || 'image/webp'
      });

    if (uploadError) {
      console.warn('[imageUtils] Supabase Storage upload error (probando fallback DataURL):', uploadError.message);
      // Fallback a Base64 WebP DataURL si el bucket no existe en la consola de Supabase
      finalUrl = await fileToDataURL(optimizedFile);
      finalStoragePath = 'inline_data_url';
    } else {
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(uploadData?.path || storagePath);
      finalUrl = publicUrlData.publicUrl;
      finalStoragePath = uploadData?.path || storagePath;
    }
  } catch (err: any) {
    console.warn('[imageUtils] Fallback a Base64 por excepción en Storage:', err);
    finalUrl = await fileToDataURL(optimizedFile);
    finalStoragePath = 'inline_data_url';
  }

  // 4. Insertar registro en la tabla `reportes_imagenes`
  const { data: dbData, error: dbError } = await supabase
    .from('reportes_imagenes')
    .insert([
      {
        reporte_id: reporteId,
        solicitud_id: solicitudId,
        url_imagen: finalUrl,
        storage_path: finalStoragePath,
        fecha_subida: new Date().toISOString()
      }
    ])
    .select('*')
    .single();

  if (dbError) {
    console.error('[imageUtils] Error registrando imagen en BD:', dbError);
    // Limpieza preventiva si se subió a storage
    if (finalStoragePath !== 'inline_data_url') {
      await supabase.storage.from(BUCKET_NAME).remove([finalStoragePath]);
    }
    throw new Error(`Error BD: ${dbError.message || 'No se pudo registrar la evidencia fotográfica'}`);
  }

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
 * - Elimina la fila de la BD `reportes_imagenes`.
 */
export async function deleteReporteImagen(imagen: ReporteImagen): Promise<boolean> {
  try {
    // 1. Borrar de Supabase Storage
    if (imagen.storage_path) {
      const { error: storageErr } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([imagen.storage_path]);

      if (storageErr) {
        console.warn('[imageUtils] Aviso al eliminar de Storage (continuando eliminación en BD):', storageErr.message);
      }
    }

    // 2. Borrar registro en la base de datos
    const { error: dbErr } = await supabase
      .from('reportes_imagenes')
      .delete()
      .eq('id', imagen.id);

    if (dbErr) {
      console.error('[imageUtils] Error al eliminar registro en BD:', dbErr);
      throw dbErr;
    }

    return true;
  } catch (err: any) {
    console.error('[imageUtils] Fallo al eliminar imagen:', err);
    throw new Error(`Error al eliminar la imagen: ${err.message || err}`);
  }
}
