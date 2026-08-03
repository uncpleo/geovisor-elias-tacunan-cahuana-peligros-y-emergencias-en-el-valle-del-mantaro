import React, { useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Calendar, HardDrive } from 'lucide-react';
import { ReporteImagen } from '../types';

interface ImageLightboxModalProps {
  images: ReporteImagen[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  images,
  currentIndex,
  onClose,
  onNavigate
}) => {
  const currentImg = images[currentIndex];

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

        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-all cursor-pointer border border-white/20 hover:scale-105"
          title="Cerrar vista previa (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
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
          <HardDrive className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate max-w-[180px]" title={currentImg.storage_path}>
            Supabase WebP
          </span>
        </div>
      </div>
    </div>
  );
};
