import React, { useState, useEffect, useRef } from 'react';
import { Camera, Trash2, Plus, Loader2, Image as ImageIcon, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import { ReporteImagen } from '../types';
import { fetchReporteImagenes, uploadReporteImagen, deleteReporteImagen } from '../utils/imageUtils';
import { ImageLightboxModal } from './ImageLightboxModal';

interface ImageGalleryProps {
  reporteId?: number | string;
  solicitudId?: number | string;
  isAdmin?: boolean;
  onNotification?: (msg: string, type: 'success' | 'error' | 'info') => void;
  // Permite adjuntar imágenes locales antes de guardar si aún no hay ID persistido en BD
  readOnly?: boolean;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({
  reporteId,
  solicitudId,
  isAdmin = false,
  onNotification,
  readOnly = false
}) => {
  const [images, setImages] = useState<ReporteImagen[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cargar imágenes desde Supabase al montar o cambiar de spot
  const loadImages = async () => {
    if (!reporteId && !solicitudId) {
      setImages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchReporteImagenes({ reporteId, solicitudId });
      setImages(data);
    } catch (error) {
      console.error('[ImageGallery] Error cargando fotos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, [reporteId, solicitudId]);

  // Subir nueva foto (Comprime WebP + Supabase Storage + Registro BD)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!reporteId && !solicitudId) {
      if (onNotification) onNotification('Guarde primero el reporte antes de asociar evidencias fotográficas.', 'info');
      return;
    }

    setUploading(true);
    let successCount = 0;
    let failCount = 0;
    let lastErrorMsg = '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const newImg = await uploadReporteImagen(file, { reporteId, solicitudId });
        setImages(prev => [newImg, ...prev]);
        successCount++;
      } catch (err: any) {
        console.error('[ImageGallery] Error al procesar imagen:', err);
        lastErrorMsg = err?.message || 'Error desconocido';
        failCount++;
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (onNotification) {
      if (successCount > 0 && failCount === 0) {
        onNotification(`Se ${successCount === 1 ? 'subió 1 evidencia optimizada' : `subieron ${successCount} evidencias optimizadas`} (WebP <350KB).`, 'success');
      } else if (successCount > 0 && failCount > 0) {
        onNotification(`Se subieron ${successCount} imágenes. ${failCount} fallaron.`, 'info');
      } else {
        onNotification(`Error al subir imagen: ${lastErrorMsg || 'Verifique la conexión a Supabase.'}`, 'error');
      }
    }
  };

  // Eliminar foto (Storage + BD)
  const handleDelete = async (imagen: ReporteImagen, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin) return;

    if (!window.confirm('¿Está seguro de eliminar esta evidencia fotográfica? Se borrará de Supabase Storage y de la base de datos.')) {
      return;
    }

    setDeletingId(imagen.id);
    try {
      await deleteReporteImagen(imagen);
      setImages(prev => prev.filter(img => img.id !== imagen.id));
      if (onNotification) onNotification('Imagen eliminada de Supabase Storage y base de datos.', 'success');
    } catch (err: any) {
      if (onNotification) onNotification(`Error al eliminar la evidencia: ${err?.message || err}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-2.5 mt-3 pt-3 border-t border-slate-200/80">
      {/* CABECERA DE LA GALERÍA */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <Camera className="w-3.5 h-3.5 text-teal-600" />
          <span>Evidencia Fotográfica ({images.length})</span>
        </div>

        {/* Botón para subir imágenes únicamente cuando es Administrador y hay un spot seleccionado */}
        {!readOnly && isAdmin && (reporteId || solicitudId) && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
              id={`upload-input-${reporteId || solicitudId}`}
            />
            <label
              htmlFor={`upload-input-${reporteId || solicitudId}`}
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                uploading
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-teal-50 hover:bg-teal-100 text-teal-700 border-teal-200 hover:border-teal-300 shadow-2xs'
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-teal-600" />
                  <span>Comprimiendo...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  <span>Agregar Fotos</span>
                </>
              )}
            </label>
          </div>
        )}
      </div>

      {/* MOSAICO EN GRID DE 3 COLUMNAS */}
      {loading ? (
        <div className="flex items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200/60 text-xs text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
          <span>Cargando imágenes de Supabase...</span>
        </div>
      ) : images.length === 0 ? (
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-center text-[11px] text-slate-400">
          <ImageIcon className="w-5 h-5 mx-auto mb-1 opacity-40 text-slate-400" />
          <span>No hay evidencia fotográfica registrada para este spot.</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, idx) => (
            <div
              key={img.id}
              onClick={() => setLightboxIndex(idx)}
              className="group relative aspect-square bg-slate-100 rounded-xl overflow-hidden border border-slate-200 shadow-2xs cursor-pointer transition-all hover:scale-102 hover:shadow-md hover:border-teal-300"
            >
              {/* IMAGEN WEB P THUMBNAIL */}
              <img
                src={img.url_imagen}
                alt={`Evidencia ${idx + 1}`}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                referrerPolicy="no-referrer"
                loading="lazy"
              />

              {/* OVERLAY DE HOVER CON ICONO OJO */}
              <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="p-1.5 bg-white/90 rounded-full text-slate-800 shadow-sm">
                  <Eye className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* BOTÓN DE ELIMINACIÓN (SOLO ADMIN) */}
              {isAdmin && !readOnly && (
                <button
                  type="button"
                  onClick={(e) => handleDelete(img, e)}
                  disabled={deletingId === img.id}
                  className="absolute top-1 right-1 p-1 bg-red-600/90 hover:bg-red-700 text-white rounded-md shadow-md opacity-0 group-hover:opacity-100 transition-all hover:scale-110 cursor-pointer border border-white/20"
                  title="Eliminar evidencia fotográfica"
                >
                  {deletingId === img.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MODAL LIGHTBOX */}
      {lightboxIndex !== null && (
        <ImageLightboxModal
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(newIdx) => setLightboxIndex(newIdx)}
        />
      )}
    </div>
  );
};
