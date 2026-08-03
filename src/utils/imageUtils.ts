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
 * Filtra para que en reportes oficiales solo se muestren fotos aprobadas (reporte_id IS NOT NULL).
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
      // Filtrar estrictamente por reporte_id y asegurar que no sea nulo (no fotos de solicitudes pendientes)
      query = query.eq('reporte_id', reporteId).not('reporte_id', 'is', null);
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
 * REQUERIMIENTO 1: FUNCIÓN DE ELIMINACIÓN COMPLETA (deleteImage / deleteReporteImagen):
 * 1. Ejecuta PRIMERO la eliminación del archivo físico en el bucket usando
 *    `supabase.storage.from('emergencias-bucket').remove([storage_path])`.
 * 2. LUEGO elimina la fila de la tabla `reportes_imagenes` por su `id`.
 */
export async function deleteImage(imagen: ReporteImagen): Promise<boolean> {
  console.log(`[imageUtils] Iniciando eliminación de evidencia ID ${imagen.id}...`);

  try {
    // 1. PRIMERO: Borrar de Supabase Storage si el path es válido
    if (imagen.storage_path && imagen.storage_path !== 'inline_data_url' && !imagen.storage_path.startsWith('data:')) {
      console.log(`[imageUtils] 1/2 Eliminando de Supabase Storage: '${imagen.storage_path}'...`);
      const { error: storageErr } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([imagen.storage_path]);

      if (storageErr) {
        console.warn('[imageUtils] Aviso al borrar de Storage (procediendo con BD):', storageErr.message);
      } else {
        console.log('[imageUtils] Archivo físico eliminado con éxito de Supabase Storage.');
      }
    }

    // 2. LUEGO: Borrar registro en la base de datos por ID
    console.log(`[imageUtils] 2/2 Borrando fila en tabla reportes_imagenes id = ${imagen.id}...`);
    const { error: dbErr } = await supabase
      .from('reportes_imagenes')
      .delete()
      .eq('id', imagen.id);

    if (dbErr) {
      console.error('[imageUtils] Error al eliminar registro en BD:', dbErr);
      throw new Error(`Error en base de datos al eliminar imagen: ${dbErr.message}`);
    }

    console.log(`[imageUtils] Evidencia ID ${imagen.id} eliminada correctamente.`);
    return true;
  } catch (err: any) {
    console.error('[imageUtils] Excepción en deleteImage:', err);
    throw err;
  }
}

// Alias para compatibilidad
export const deleteReporteImagen = deleteImage;

/**
 * REQUERIMIENTO 2: FLUJO DE RECHAZO / DENEGACIÓN DE SOLICITUD (rejectSolicitud):
 * a) Consulta todas las filas en `reportes_imagenes` donde `solicitud_id == id_solicitud`.
 * b) Extrae los `storage_path` de esas fotos y las elimina físicamente del bucket `emergencias-bucket`.
 * c) Elimina el registro en `solicitudes_reporte` (o actualiza su estado), limpiando la BD sin dejar imágenes huérfanas en Storage.
 */
export async function rejectSolicitud(solicitudId: number | string): Promise<boolean> {
  const numericId = Number(solicitudId);
  console.log(`[imageUtils] Iniciando rechazo de solicitud ID ${numericId}...`);

  try {
    // a) Consultar todas las filas en reportes_imagenes donde solicitud_id == id_solicitud
    const { data: images, error: fetchErr } = await supabase
      .from('reportes_imagenes')
      .select('id, storage_path')
      .eq('solicitud_id', numericId);

    if (fetchErr) {
      console.warn('[imageUtils] Error consultando fotos asociadas a la solicitud:', fetchErr.message);
    }

    // b) Extraer storage_path y eliminarlas físicamente de emergencias-bucket
    if (images && images.length > 0) {
      const paths = images
        .map(i => i.storage_path)
        .filter((p): p is string => Boolean(p) && p !== 'inline_data_url' && !p.startsWith('data:'));

      if (paths.length > 0) {
        console.log(`[imageUtils] Eliminando ${paths.length} archivo(s) del bucket '${BUCKET_NAME}':`, paths);
        const { error: storageErr } = await supabase.storage
          .from(BUCKET_NAME)
          .remove(paths);

        if (storageErr) {
          console.warn('[imageUtils] Error al remover archivos de Storage:', storageErr.message);
        } else {
          console.log('[imageUtils] Archivos de la solicitud removidos del Storage exitosamente.');
        }
      }

      // Limpiar explícitamente las filas en reportes_imagenes
      await supabase
        .from('reportes_imagenes')
        .delete()
        .eq('solicitud_id', numericId);
    }

    // c) Eliminar el registro en solicitudes_reporte
    console.log(`[imageUtils] Eliminando registro de solicitud_id = ${numericId} en solicitudes_reporte...`);
    const { error: deleteErr } = await supabase
      .from('solicitudes_reporte')
      .delete()
      .eq('id', numericId);

    if (deleteErr) {
      console.warn('[imageUtils] Aviso al eliminar solicitud, intentando marcar como denegado:', deleteErr.message);
      await supabase
        .from('solicitudes_reporte')
        .update({ estado_solicitud: 'denegado' })
        .eq('id', numericId);
    }

    console.log(`[imageUtils] Solicitud ID ${numericId} rechazada y purgada por completo.`);
    return true;
  } catch (err: any) {
    console.error('[imageUtils] Error en rejectSolicitud:', err);
    throw new Error(`Error en rechazo de solicitud: ${err.message || err}`);
  }
}

/**
 * REQUERIMIENTO 3: FLUJO DE APROBACIÓN DE SOLICITUD (approveSolicitud / relinkImagesToReporte):
 * - Las fotos NO se mueven de carpeta en el Storage.
 * - Intenta llamar a la función RPC `aprobar_solicitud_con_imagenes` o ejecuta la actualización directo:
 *   `UPDATE reportes_imagenes SET reporte_id = nuevo_id, solicitud_id = NULL WHERE solicitud_id = id_solicitud`.
 */
export async function approveSolicitud(solicitudId: number | string, nuevoReporteId: number | string): Promise<boolean> {
  const numSolicitudId = Number(solicitudId);
  const numReporteId = Number(nuevoReporteId);

  console.log(`[imageUtils] Asociando imágenes de solicitud ${numSolicitudId} al nuevo reporte ${numReporteId}...`);

  try {
    // 1. Intentar llamar a la función RPC aprobar_solicitud_con_imagenes
    const { error: rpcErr } = await supabase.rpc('aprobar_solicitud_con_imagenes', {
      p_solicitud_id: numSolicitudId,
      p_reporte_id: numReporteId
    });

    if (rpcErr) {
      console.warn('[imageUtils] RPC aprobar_solicitud_con_imagenes no disponible o falló. Ejecutando UPDATE directo:', rpcErr.message);

      // 2. Ejecutar UPDATE directo en la tabla reportes_imagenes
      const { error: updateErr } = await supabase
        .from('reportes_imagenes')
        .update({
          reporte_id: numReporteId,
          solicitud_id: null
        })
        .eq('solicitud_id', numSolicitudId);

      if (updateErr) {
        console.error('[imageUtils] Error al actualizar reportes_imagenes:', updateErr);
        throw new Error(`Error vinculando imágenes al reporte aprobado: ${updateErr.message}`);
      }
    }

    console.log(`[imageUtils] Imágenes vinculadas correctamente al reporte ID ${numReporteId}.`);
    return true;
  } catch (err: any) {
    console.error('[imageUtils] Error en approveSolicitud:', err);
    throw err;
  }
}

// Alias para mantener compatibilidad de nombres
export const relinkImagesToReporte = approveSolicitud;

/**
 * PURGA DE IMÁGENES AL ELIMINAR UN REPORTE CONFIRMADO (reportes_emergencia):
 * Evita imágenes huérfanas en Storage cuando se elimina un reporte de la base de datos.
 */
export async function purgeReporteImages(reporteId: number | string): Promise<boolean> {
  const numericId = Number(reporteId);
  console.log(`[imageUtils] Purgando imágenes de Storage para reporte ID ${numericId}...`);

  try {
    const { data: images, error: fetchErr } = await supabase
      .from('reportes_imagenes')
      .select('storage_path')
      .eq('reporte_id', numericId);

    if (!fetchErr && images && images.length > 0) {
      const paths = images
        .map(i => i.storage_path)
        .filter((p): p is string => Boolean(p) && p !== 'inline_data_url' && !p.startsWith('data:'));

      if (paths.length > 0) {
        console.log(`[imageUtils] Borrando ${paths.length} archivos físicos de Storage...`);
        await supabase.storage.from(BUCKET_NAME).remove(paths);
      }

      await supabase.from('reportes_imagenes').delete().eq('reporte_id', numericId);
    }
    return true;
  } catch (err) {
    console.warn('[imageUtils] Error en purgeReporteImages:', err);
    return false;
  }
}


