import React, { useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Calendar, HardDrive, Trash2, Loader2 } from 'lucide-react';
import { ReporteImagen } from '../types';

interface ImageLightboxModalProps {
  images: ReporteImagen[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  isAdmin?: boolean;
  onDelete?: (imagen: ReporteImagen) => void;
  isDeleting?: boolean;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  images,
  currentIndex,
  onClose,
  onNavigate,
  isAdmin = false,
  onDelete,
  isDeleting = false
}) => {
  const currentImg = images[currentIndex];
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  useEffect(() => {
    setShowDeleteConfirm(false);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNavigate(currentIndex + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, images.length, onClose, onNavigate]);

  if (!currentImg) return null;

  const formattedDate = currentImg.fecha_subida 
    ? new Date(currentImg.fecha_subida).toLocaleString('es-PE', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : '';

  const handleConfirmDeleteClick = () => {
    if (onDelete && currentImg) {
      onDelete(currentImg);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[2500] bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-between p-4 md:p-6 animate-fade-in"
      onClick={onClose}
    >
      {/* BARRA SUPERIOR DE ACCIONES */}
      <div 
        className="w-full max-w-5xl flex items-center justify-between text-white z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-xs font-mono bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15">
          <span className="font-bold text-teal-400">Evidencia Fotográfica</span>
          {images.length > 1 && (
            <span className="text-slate-300">
              ({currentIndex + 1} de {images.length})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && onDelete && (
            showDeleteConfirm ? (
              <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-500/80 px-2.5 py-1 rounded-full text-xs font-bold animate-fade-in">
                <span className="text-red-200 text-[11px]">¿Eliminar foto?</span>
                <button
                  type="button"
                  onClick={handleConfirmDeleteClick}
                  disabled={isDeleting}
                  className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-full transition-all cursor-pointer shadow-sm"
                >
                  {isDeleting ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Sí, borrar'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded-full transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-red-600/90 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold transition-all cursor-pointer border border-red-400 shadow-md hover:scale-105 disabled:opacity-50"
                title="Eliminar esta foto (Administrador)"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>Eliminar</span>
              </button>
            )
          )}

          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-all cursor-pointer border border-white/20 hover:scale-105"
            title="Cerrar vista previa (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* CONTENEDOR PRINCIPAL DE LA IMAGEN CON NAVEGACIÓN */}
      <div 
        className="relative flex-1 w-full max-w-5xl flex items-center justify-center my-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* BOTÓN ANTERIOR */}
        {images.length > 1 && (
          <button
            onClick={() => onNavigate(currentIndex > 0 ? currentIndex - 1 : images.length - 1)}
            className="absolute left-2 md:left-4 z-20 p-3 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-white/20 shadow-xl backdrop-blur-sm transition-all hover:scale-110 cursor-pointer"
            title="Imagen anterior"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* IMAGEN EN TAMAÑO COMPLETO */}
        <div className="relative max-h-[75vh] max-w-full flex items-center justify-center rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black/40">
          <img
            src={currentImg.url_imagen}
            alt={`Evidencia fotográfica ${currentIndex + 1}`}
            className="max-h-[75vh] max-w-full object-contain rounded-xl select-none"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* BOTÓN SIGUIENTE */}
        {images.length > 1 && (
          <button
            onClick={() => onNavigate(currentIndex < images.length - 1 ? currentIndex + 1 : 0)}
            className="absolute right-2 md:right-4 z-20 p-3 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-white/20 shadow-xl backdrop-blur-sm transition-all hover:scale-110 cursor-pointer"
            title="Siguiente imagen"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* BARRA INFERIOR DE DETALLES */}
      <div 
        className="w-full max-w-xl bg-slate-900/90 border border-white/10 p-3 rounded-2xl backdrop-blur-md flex items-center justify-around text-slate-300 text-xs shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-teal-400" />
          <span>{formattedDate || 'Fecha no registrada'}</span>
        </div>
        <div className="h-3 w-px bg-white/20"></div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
          <HardDrive className="w-3.5 h-3.5 text-teal-400" />
          <span className="truncate max-w-[220px]" title={currentImg.storage_path}>
            {currentImg.storage_path || 'Supabase Storage'}
          </span>
        </div>
      </div>
    </div>
  );
};

