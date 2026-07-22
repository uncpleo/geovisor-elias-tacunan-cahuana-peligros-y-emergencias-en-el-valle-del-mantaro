import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Activity,
  AlertTriangle,
  Layers,
  MapPin,
  Lock,
  Unlock,
  Plus,
  Trash2,
  RotateCcw,
  Info,
  ShieldAlert,
  Users,
  Eye,
  Settings,
  X,
  PlusCircle,
  HelpCircle,
  Map as MapIcon,
  Clock,
  Locate,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle
} from 'lucide-react';
import {
  INITIAL_REPORTS,
  OFFICIAL_EPICENTERS,
  JUNIN_DISTRICTS_GEOJSON,
  SUB_TYPES_BY_CATEGORY
} from './data';
import { Report, ReportType, SeverityLevel, Epicenter, CentroPoblado, SolicitudReporte } from './types';
import {
  supabase,
  mapEpicenter,
  mapReport,
  mapSolicitud,
  uiTypeToDb,
  uiSeverityToDb,
  parseGeometry
} from './supabaseClient';

// Password para acceder al panel de administración de respaldo
const ADMIN_PASSWORD = 'chupaca2026';

export default function App() {
  // --- STATE MANAGEMENT ---
  const [reports, setReports] = useState<Report[]>(() => {
    const saved = localStorage.getItem('chupaca_seismic_reports');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return INITIAL_REPORTS;
      }
    }
    return INITIAL_REPORTS;
  });

  // Rol activo (Público general con permisos de LECTURA vs Admin COER con gestión total)
  const [activeRole, setActiveRole] = useState<'publico' | 'admin'>('publico');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [pendingSolicitudes, setPendingSolicitudes] = useState<SolicitudReporte[]>([]);
  const [selectedSolicitud, setSelectedSolicitud] = useState<SolicitudReporte | null>(null);
  const [isEditingSolicitud, setIsEditingSolicitud] = useState<boolean>(false);
  const [selectedReportTypeForSolicitud, setSelectedReportTypeForSolicitud] = useState<ReportType>('damage_physical');
  const [selectedSubTypeForSolicitud, setSelectedSubTypeForSolicitud] = useState<string>('vivienda_colapsada');
  const [selectedSeverityForSolicitud, setSelectedSeverityForSolicitud] = useState<SeverityLevel>('alto');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Control de Basemaps: OpenStreetMap vs Google Streets vs Google Satellite
  const [activeBasemap, setActiveBasemap] = useState<'openstreetmap' | 'streets' | 'satellite'>('openstreetmap');

  // Control de desplegable de la barra lateral de información para móviles y tablets
  const [isSidebarOpenMobile, setIsSidebarOpenMobile] = useState<boolean>(false);

  // Redimensionar el mapa de Leaflet cuando cambia el estado de colapso de la barra lateral
  useEffect(() => {
    if (mapRef.current) {
      const timer = setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isSidebarOpenMobile]);

  // Nivel de la capa WMS del INEI ('3' = Distritos, '2' = Provincias, '1' = Departamentos)
  const [wmsLayerLevel, setWmsLayerLevel] = useState<'3' | '2' | '1'>('3');

  // Control de Capas de abajo hacia arriba (True = Visible, False = Oculto)
  const [visibleLayers, setVisibleLayers] = useState({
    capa1: true, // Delimitación Distrital de Junín
    capa2: true, // Epicentros del 18 de Julio en Chupaca (IGP)
    capa3: true, // Daño Físico (Naranja/Rojo)
    capa4: true, // Daño Humano (Alerta médica / Humanos)
    capa5: true, // Necesidades y Urgencias (Exclamación / Alta prioridad)
    capa6: true, // Centros Poblados (PostGIS)
    capa7: true  // Centro de acopio (Verde)
  });

  // Estado para centros poblados obtenidos de Supabase (PostGIS)
  const [centrosPoblados, setCentrosPoblados] = useState<CentroPoblado[]>([]);
  const [isCentrosPobladosLoading, setIsCentrosPobladosLoading] = useState<boolean>(false);

  // Filtro de severidad activo para visualización rápida
  const [severityFilter, setSeverityFilter] = useState<string>('todos');

  // Estado para creación de reporte (formulario dinámico)
  const [isCreatingReport, setIsCreatingReport] = useState(false);
  const [clickCoords, setClickCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [newReport, setNewReport] = useState<{
    type: ReportType;
    subType: string;
    title: string;
    description: string;
    severity: SeverityLevel;
    createdBy: string;
    distrito: string;
    provincia: string;
  }>({
    type: 'damage_physical',
    subType: 'vivienda_colapsada',
    title: '',
    description: '',
    severity: 'alto',
    createdBy: 'Público General',
    distrito: '',
    provincia: ''
  });

  // Estado para edición o visualización detallada de un reporte existente
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [isResetConfirming, setIsResetConfirming] = useState(false);

  // Resetear confirmación de borrado al cambiar de reporte seleccionado
  useEffect(() => {
    setIsDeleteConfirming(false);
  }, [selectedReport]);

  // Sincronizar activeRole con la bandera isAdmin
  useEffect(() => {
    setIsAdmin(activeRole === 'admin');
  }, [activeRole]);

  // Función para cargar solicitudes desde Supabase
  const loadPendingSolicitudes = async () => {
    try {
      const { data, error } = await supabase
        .from('solicitudes_reporte')
        .select('*')
        .eq('estado_solicitud', 'pendiente')
        .order('id', { ascending: false });

      if (error) throw error;
      if (data) {
        setPendingSolicitudes(data.map(mapSolicitud));
      }
    } catch (err) {
      console.error('Error cargando solicitudes de Supabase:', err);
    }
  };

  // Cargar solicitudes al activar modo admin
  useEffect(() => {
    if (isAdmin) {
      loadPendingSolicitudes();
    } else {
      setPendingSolicitudes([]);
      setSelectedSolicitud(null);
    }
  }, [isAdmin]);

  // --- APROBAR Y REGISTRAR SOLICITUD ---
  const handleApproveSolicitud = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSolicitud) return;

    setIsSubmitting(true);
    try {
      const latVal = Number(selectedSolicitud.lat);
      const lngVal = Number(selectedSolicitud.lng);

      // a) Insertar en la tabla de reportes oficiales 'reportes_emergencia'
      const { data: reportData, error: insertError } = await supabase
        .from('reportes_emergencia')
        .insert([
          {
            capa_tipo: uiTypeToDb(selectedSolicitud.type),
            subcategoria: selectedSolicitud.subType,
            identificacion_lugar: selectedSolicitud.title,
            descripcion_detallada: selectedSolicitud.description,
            contacto_telefono: selectedSolicitud.phone || null,
            nivel_gravedad: uiSeverityToDb(selectedSolicitud.severity),
            estado_atencion: selectedSolicitud.status || 'Pendiente',
            brigadista_institucion: selectedSolicitud.createdBy || 'Público General',
            ubicacion: `POINT(${lngVal} ${latVal})`
          }
        ])
        .select();

      if (insertError) throw insertError;

      // b) Cambiar estado en 'solicitudes_reporte' a 'aprobado'
      const { error: updateError } = await supabase
        .from('solicitudes_reporte')
        .update({ estado_solicitud: 'aprobado' })
        .eq('id', Number(selectedSolicitud.id));

      if (updateError) throw updateError;

      // Sincronizar en el cliente
      if (reportData && reportData.length > 0) {
        const createdReport = mapReport(reportData[0]);
        setReports(prev => [createdReport, ...prev]);
      }

      setPendingSolicitudes(prev => prev.filter(s => s.id !== selectedSolicitud.id));
      setSelectedSolicitud(null);
      setIsEditingSolicitud(false);
      showToast('Solicitud aprobada e integrada con éxito al geovisor oficial.', 'success');
    } catch (err: any) {
      console.error('Error aprobando solicitud:', err);
      showToast('Error de conexión al aprobar solicitud.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- DENEGAR SOLICITUD ---
  const handleDenySolicitud = async () => {
    if (!selectedSolicitud) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('solicitudes_reporte')
        .update({ estado_solicitud: 'denegado' })
        .eq('id', Number(selectedSolicitud.id));

      if (error) throw error;

      setPendingSolicitudes(prev => prev.filter(s => s.id !== selectedSolicitud.id));
      setSelectedSolicitud(null);
      setIsEditingSolicitud(false);
      showToast('Solicitud denegada y removida del geovisor.', 'info');
    } catch (err: any) {
      console.error('Error al denegar solicitud:', err);
      showToast('Error de conexión al denegar solicitud.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mensaje de notificación temporal
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // --- SUPABASE & EXTRA STATES ---
  const [epicenters, setEpicenters] = useState<Epicenter[]>(OFFICIAL_EPICENTERS);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingLogin, setIsLoadingLogin] = useState<boolean>(false);

  // --- REFS PARA MAPA LEAFLET ---
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const layersGroupRef = useRef<L.FeatureGroup | null>(null);
  const centrosPobladosGroupRef = useRef<L.FeatureGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // --- GEOLOCALIZACIÓN EN TIEMPO REAL ---
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  // 1. Escuchar la posición del usuario en tiempo real (watchPosition)
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn('Este dispositivo o navegador no soporta geolocalización.');
      return;
    }

    const handleSuccess = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ lat: latitude, lng: longitude });
    };

    const handleError = (err: GeolocationPositionError) => {
      console.warn('Error al rastrear ubicación en tiempo real:', err.message);
    };

    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // 2. Sincronizar el marcador azul (Blue Dot) con el mapa base de Leaflet
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!userLocation) {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
      return;
    }

    const blueDotIcon = L.divIcon({
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-8 h-8 rounded-full bg-blue-500 animate-ping opacity-35"></div>
          <div class="absolute w-5 h-5 rounded-full bg-blue-400 animate-pulse opacity-50"></div>
          <div class="relative w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-lg"></div>
        </div>
      `,
      className: 'user-location-marker-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
    } else {
      const marker = L.marker([userLocation.lat, userLocation.lng], { icon: blueDotIcon });
      marker.bindTooltip('Tu ubicación actual', {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
      });
      marker.addTo(map);
      userMarkerRef.current = marker;
    }
  }, [userLocation]);

  // Cleanup de marcador al desmontar el componente
  useEffect(() => {
    return () => {
      if (userMarkerRef.current && mapRef.current) {
        mapRef.current.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
    };
  }, []);

  // 3. Función para centrar y dirigir el mapa a la ubicación del usuario
  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      showToast('Tu navegador no soporta geolocalización.', 'error');
      return;
    }

    showToast('Buscando tu ubicación en tiempo real...', 'info');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 16, { animate: true, duration: 1.5 });
          showToast('Geolocalización centrada y actualizada en tiempo real.', 'success');
        }
      },
      (error) => {
        console.error('Error de geolocalización al centrar:', error);
        if (error.code === error.PERMISSION_DENIED) {
          showToast('Permiso denegado. Por favor, concede acceso a tu ubicación.', 'error');
        } else {
          showToast('No se pudo determinar tu paradero actual.', 'error');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // 4. Ciclar mapa base en móviles
  const handleCycleBasemap = () => {
    const basemaps: ('openstreetmap' | 'satellite' | 'streets')[] = ['openstreetmap', 'satellite', 'streets'];
    const nextIndex = (basemaps.indexOf(activeBasemap) + 1) % basemaps.length;
    const nextBasemap = basemaps[nextIndex];
    setActiveBasemap(nextBasemap);

    let label = 'OpenStreetMap';
    if (nextBasemap === 'satellite') label = 'Satélite (Híbrido)';
    if (nextBasemap === 'streets') label = 'Vías y Calles';

    showToast(`Mapa cambiado a: ${label}`, 'info');
  };

  // --- CARGA DE DATOS DESDE SUPABASE EN TIEMPO REAL ---
  useEffect(() => {
    const loadSupabaseData = async () => {
      setIsLoading(true);
      try {
        // 1. Obtener epicentros reales
        const { data: dbEpicentros, error: epiError } = await supabase
          .from('epicentros_igp')
          .select('*');
        
        if (epiError) throw epiError;
        if (dbEpicentros && dbEpicentros.length > 0) {
          setEpicenters(dbEpicentros.map(mapEpicenter));
        }

        // 2. Obtener reportes reales
        const { data: dbReportes, error: repError } = await supabase
          .from('reportes_emergencia')
          .select('*')
          .order('fecha_registro', { ascending: false });

        if (repError) throw repError;
        if (dbReportes) {
          setReports(dbReportes.map(mapReport));
          showToast('Datos sincronizados en tiempo real con Supabase.', 'success');
        }
      } catch (err: any) {
        console.error('Error cargando datos de Supabase:', err);
        showToast('Error de conexión con Supabase. Usando respaldo local.', 'error');
      } finally {
        setIsLoading(false);
      }
    };

    loadSupabaseData();
  }, []);

  // --- PERSISTENCIA LOCAL DE RESPALDO ---
  useEffect(() => {
    localStorage.setItem('chupaca_seismic_reports', JSON.stringify(reports));
  }, [reports]);

  // --- MOSTRAR NOTIFICACIONES EFÍMERAS ---
  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // --- RESTABLECER MAPA A SU CONFIGURACIÓN SEMILLA ---
  const handleResetData = () => {
    setReports(INITIAL_REPORTS);
    localStorage.setItem('chupaca_seismic_reports', JSON.stringify(INITIAL_REPORTS));
    setSelectedReport(null);
    setIsCreatingReport(false);
    setIsEditingReport(false);
    setClickCoords(null);
    setIsResetConfirming(false);
    showToast('Se han restaurado los datos semilla oficiales.', 'success');
  };

  // --- INICIAR / CERRAR SESIÓN DE ADMINISTRACIÓN ---
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoadingLogin(true);
    setPasswordError('');
    try {
      // Intentar validar contraseña usando el RPC seguro en Supabase
      const { data: isValid, error } = await supabase.rpc('validar_clave_coer', {
        pass_ingresada: passwordInput
      });

      if (error) throw error;

      if (isValid === true) {
        setActiveRole('admin');
        setShowLoginModal(false);
        setPasswordInput('');
        showToast('Sesión de Administrador iniciada de forma segura vía Supabase RPC.', 'success');
      } else {
        setPasswordError('Contraseña incorrecta. Intente con la contraseña maestra de Supabase.');
      }
    } catch (err: any) {
      console.error('Error al validar con Supabase RPC:', err);
      // Fallback local robusto para que la app siempre sea operativa
      if (passwordInput === ADMIN_PASSWORD) {
        setActiveRole('admin');
        setShowLoginModal(false);
        setPasswordInput('');
        showToast('Sesión iniciada (Modo de contingencia local activado).', 'info');
      } else {
        setPasswordError('Contraseña incorrecta de la base de datos de Supabase.');
      }
    } finally {
      setIsLoadingLogin(false);
    }
  };

  const handleLogout = () => {
    setActiveRole('publico');
    setIsCreatingReport(false);
    setIsEditingReport(false);
    setClickCoords(null);
    showToast('Sesión cerrada. Modo de lectura pública activo.', 'info');
  };

  // --- MANEJO DE SELECCIÓN DE CATEGORÍA DE REPORTE ---
  const handleCategoryChange = (type: ReportType) => {
    const subTypes = SUB_TYPES_BY_CATEGORY[type];
    setNewReport(prev => ({
      ...prev,
      type,
      subType: subTypes[0].value,
      title: prev.title || ''
    }));
  };

  // --- GUARDAR NUEVO REPORTE EN EL MAPA ---
  const handleSaveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clickCoords) return;
    if (!newReport.title.trim() || !newReport.description.trim()) {
      showToast('Por favor, complete el título y la descripción del reporte.', 'error');
      return;
    }

    setIsSubmitting(true);
    const latVal = Number(clickCoords.lat.toFixed(6));
    const lngVal = Number(clickCoords.lng.toFixed(6));

    if (activeRole !== 'admin') {
      // COMPORTAMIENTO PARA USUARIOS NO-ADMIN -> solicitudes_reporte
      try {
        const { error } = await supabase
          .from('solicitudes_reporte')
          .insert([
            {
              capa_tipo: uiTypeToDb(newReport.type),
              subcategoria: newReport.subType,
              identificacion_lugar: newReport.title,
              descripcion_detallada: newReport.description,
              contacto_telefono: null,
              nivel_gravedad: uiSeverityToDb(newReport.severity),
              estado_atencion: 'Pendiente',
              brigadista_institucion: newReport.createdBy || 'Público General',
              ubicacion: `POINT(${lngVal} ${latVal})`,
              estado_solicitud: 'pendiente'
            }
          ]);

        if (error) throw error;

        showToast('Solicitud de reporte enviada con éxito. Pendiente de aprobación.', 'success');
        setIsCreatingReport(false);
        setClickCoords(null);
        setNewReport({
          type: 'damage_physical',
          subType: 'vivienda_colapsada',
          title: '',
          description: '',
          severity: 'alto',
          createdBy: 'Público General',
          distrito: 'Chupaca',
          provincia: 'Chupaca'
        });
      } catch (err: any) {
        console.error('Error enviando solicitud a Supabase:', err);
        showToast('Error al enviar la solicitud de reporte a la base de datos.', 'error');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // COMPORTAMIENTO PARA USUARIOS ADMINISTRADORES -> reportes_emergencia
    try {
      // 1. Insertar en Supabase
      const { data, error } = await supabase
        .from('reportes_emergencia')
        .insert([
          {
            capa_tipo: uiTypeToDb(newReport.type),
            subcategoria: newReport.subType,
            identificacion_lugar: newReport.title,
            descripcion_detallada: newReport.description,
            contacto_telefono: null,
            nivel_gravedad: uiSeverityToDb(newReport.severity),
            estado_atencion: 'Pendiente',
            brigadista_institucion: newReport.createdBy || 'COER Junín',
            ubicacion: `POINT(${lngVal} ${latVal})`
          }
        ])
        .select();

      if (error) throw error;

      let created: Report;
      if (data && data.length > 0) {
        created = mapReport(data[0]);
      } else {
        // Fallback local en caso de que no devuelva datos inmediatamente
        created = {
          id: 'rep_' + Date.now(),
          type: newReport.type,
          subType: newReport.subType,
          title: newReport.title,
          description: newReport.description,
          severity: newReport.severity,
          lat: latVal,
          lng: lngVal,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: newReport.createdBy || 'COER Junín'
        };
      }

      setReports(prev => [created, ...prev]);
      setIsCreatingReport(false);
      setClickCoords(null);
      setNewReport({
        type: 'damage_physical',
        subType: 'vivienda_colapsada',
        title: '',
        description: '',
        severity: 'alto',
        createdBy: 'COER Junín',
        distrito: 'Chupaca',
        provincia: 'Chupaca'
      });
      showToast('Reporte guardado con éxito y sincronizado con Supabase.', 'success');
    } catch (err: any) {
      console.error('Error guardando reporte en Supabase:', err);
      // Fallback local
      const fallbackReport: Report = {
        id: 'rep_' + Date.now(),
        type: newReport.type,
        subType: newReport.subType,
        title: newReport.title,
        description: newReport.description,
        severity: newReport.severity,
        lat: latVal,
        lng: lngVal,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: newReport.createdBy || 'COER Junín'
      };
      setReports(prev => [fallbackReport, ...prev]);
      setIsCreatingReport(false);
      setClickCoords(null);
      setNewReport({
        type: 'damage_physical',
        subType: 'vivienda_colapsada',
        title: '',
        description: '',
        severity: 'alto',
        createdBy: 'COER Junín',
        distrito: 'Chupaca',
        provincia: 'Chupaca'
      });
      showToast('Reporte guardado localmente (Sin conexión a Supabase).', 'info');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- ACTUALIZAR UN REPORTE EXISTENTE ---
  const handleUpdateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport) return;

    setIsSubmitting(true);
    try {
      const isLocalId = selectedReport.id.startsWith('rep_');
      
      if (!isLocalId) {
        // Actualizar en Supabase con cast numérico seguro para BIGINT
        const numericId = isNaN(Number(selectedReport.id)) ? selectedReport.id : Number(selectedReport.id);
        const { error } = await supabase
          .from('reportes_emergencia')
          .update({
            identificacion_lugar: selectedReport.title,
            descripcion_detallada: selectedReport.description,
            nivel_gravedad: uiSeverityToDb(selectedReport.severity),
            brigadista_institucion: selectedReport.createdBy,
            estado_atencion: selectedReport.status || 'Pendiente',
            contacto_telefono: selectedReport.phone || null
          })
          .eq('id', numericId);

        if (error) throw error;
      }

      setReports(prev => prev.map(rep => {
        if (rep.id === selectedReport.id) {
          return {
            ...selectedReport,
            updatedAt: new Date().toISOString()
          };
        }
        return rep;
      }));

      setIsEditingReport(false);
      showToast('Reporte actualizado correctamente en Supabase.', 'success');
    } catch (err: any) {
      console.error('Error actualizando reporte en Supabase:', err);
      // Fallback local
      setReports(prev => prev.map(rep => {
        if (rep.id === selectedReport.id) {
          return {
            ...selectedReport,
            updatedAt: new Date().toISOString()
          };
        }
        return rep;
      }));
      setIsEditingReport(false);
      showToast('Reporte actualizado localmente (Error en base de datos).', 'info');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- ELIMINAR REPORTE ---
  const handleDeleteReport = async (id: string) => {
    setIsSubmitting(true);
    try {
      const isLocalId = id.startsWith('rep_');

      if (!isLocalId) {
        // Eliminar de Supabase con cast numérico seguro para BIGINT
        const numericId = isNaN(Number(id)) ? id : Number(id);
        const { error } = await supabase
          .from('reportes_emergencia')
          .delete()
          .eq('id', numericId);

        if (error) throw error;
      }

      setReports(prev => prev.filter(r => r.id !== id));
      setSelectedReport(null);
      setIsEditingReport(false);
      showToast('Reporte eliminado de Supabase y del mapa.', 'info');
    } catch (err: any) {
      console.error('Error eliminando reporte de Supabase:', err);
      // Fallback local
      setReports(prev => prev.filter(r => r.id !== id));
      setSelectedReport(null);
      setIsEditingReport(false);
      showToast('Reporte eliminado localmente (Error en base de datos).', 'info');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- INICIALIZAR EL MAPA BASE LEAFLET ---
  useEffect(() => {
    if (!mapRef.current && mapContainerRef.current) {
      // Centrar el mapa en el Perú (coordenadas [-9.19, -75.01], zoom 6)
      const map = L.map(mapContainerRef.current, {
        center: [-9.19, -75.01],
        zoom: 6,
        zoomControl: false,
        maxZoom: 18,
        minZoom: 3
      });

      // Añadir escala gráfica oficial para analistas de campo
      L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

      // Añadir control de zoom personalizado en una esquina limpia (topleft)
      L.control.zoom({ position: 'topleft' }).addTo(map);

      // Definir los Mapas Base
      const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      });

      const googleSatelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: '&copy; Google Maps Satélite'
      });

      const googleStreetsLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: '&copy; Google Maps Callejero'
      });

      // Añadir OpenStreetMap por defecto
      osmLayer.addTo(map);
      tileLayerRef.current = osmLayer;

      // Definir capas WMS del IGN de Perú (Límite Departamental y Límite Distrital)
      const departamentoWMS = L.tileLayer.wms('https://ide.ign.gob.pe/geoserver/wms', {
        layers: 'core:g_departamento',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        attribution: '&copy; IGN Límite Departamental WMS'
      });

      const distritoWMS = L.tileLayer.wms('https://ide.ign.gob.pe/geoserver/wms', {
        layers: 'core:g_distrito',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        attribution: '&copy; IGN Límite Distrital WMS'
      });

      // Cargar por defecto las capas WMS del IGN
      departamentoWMS.addTo(map);
      distritoWMS.addTo(map);

      // Agregar control de capas arriba a la derecha (topright)
      const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Google Satélite (Híbrido)": googleSatelliteLayer,
        "Google Vías y Calles": googleStreetsLayer
      };

      const overlayMaps = {
        "Límite Departamental (IGN)": departamentoWMS,
        "Límite Distrital (IGN)": distritoWMS
      };

     // L.control.layers(baseMaps, overlayMaps, { position: 'topright', collapsed: false }).addTo(map);

      // Sincronizar cambios de base map desde el control nativo hacia el estado de React
      map.on('baselayerchange', (e: any) => {
        if (e.name === "Google Satélite (Híbrido)") {
          setActiveBasemap('satellite');
        } else if (e.name === "Google Vías y Calles") {
          setActiveBasemap('streets');
        } else if (e.name === "OpenStreetMap") {
          setActiveBasemap('openstreetmap');
        }
      });

      mapRef.current = map;
      layersGroupRef.current = L.featureGroup().addTo(map);
      centrosPobladosGroupRef.current = L.featureGroup().addTo(map);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // --- ACTUALIZAR MAPA BASE (TILE LAYER) DESDE EL SELECTOR FLOTANTE ---
  useEffect(() => {
    if (!mapRef.current) return;

    // Remover capa previa si existe
    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }

    let tileUrl = '';
    let attribution = '';

    if (activeBasemap === 'satellite') {
      tileUrl = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
      attribution = '&copy; Google Maps Satélite';
    } else if (activeBasemap === 'streets') {
      tileUrl = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
      attribution = '&copy; Google Maps Callejero';
    } else {
      tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap contributors';
    }

    const newTileLayer = L.tileLayer(tileUrl, {
      maxZoom: 20,
      attribution
    });

    newTileLayer.addTo(mapRef.current);
    tileLayerRef.current = newTileLayer;
  }, [activeBasemap]);

  // --- CARGAR CENTROS POBLADOS DESDE SUPABASE ---
  const fetchCentrosPoblados = async () => {
    const map = mapRef.current;
    if (!map) return;

    const zoom = map.getZoom();
    if (zoom < 14 || !visibleLayers.capa6) {
      setCentrosPoblados([]);
      if (centrosPobladosGroupRef.current) {
        centrosPobladosGroupRef.current.clearLayers();
      }
      return;
    }

    setIsCentrosPobladosLoading(true);
    try {
      const bounds = map.getBounds();
      const min_lat = bounds.getSouth();
      const min_lng = bounds.getWest();
      const max_lat = bounds.getNorth();
      const max_lng = bounds.getEast();

      // Llamada RPC optimizada en Supabase (PostGIS)
      const { data, error } = await supabase.rpc('get_centros_poblados_in_bbox', {
        min_lat,
        min_lng,
        max_lat,
        max_lng
      });

      if (error) {
        console.warn('RPC get_centros_poblados_in_bbox no disponible. Intentando consulta directa:', error);
        
        // Fallback: consulta directa si aún no han creado la función en Supabase
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('centros_poblados')
          .select('*')
          .limit(100);

        if (fallbackError) throw fallbackError;

        if (fallbackData) {
          const mapped = fallbackData
            .map((row: any) => {
              let lat = 0;
              let lng = 0;
              if (row.lat !== undefined && row.lon !== undefined) {
                lat = Number(row.lat);
                lng = Number(row.lon);
              } else if (row.lat !== undefined && row.lng !== undefined) {
                lat = Number(row.lat);
                lng = Number(row.lng);
              } else {
                const coords = parseGeometry(row.ubicacion);
                if (!coords) return null;
                lat = coords.lat;
                lng = coords.lng;
              }
              return {
                id: String(row.id),
                nombre: row.nombre,
                distrito: row.distrito,
                provincia: row.provincia,
                lat,
                lng
              };
            })
            .filter(Boolean) as CentroPoblado[];

          const visibleMapped = mapped.filter(
            (cp) => cp.lat >= min_lat && cp.lat <= max_lat && cp.lng >= min_lng && cp.lng <= max_lng
          );
          setCentrosPoblados(visibleMapped);
        }
      } else if (data) {
        const mapped: CentroPoblado[] = data.map((row: any) => {
          let lat = 0;
          let lng = 0;
          if (row.lat !== undefined && row.lon !== undefined) {
            lat = Number(row.lat);
            lng = Number(row.lon);
          } else if (row.lat !== undefined && row.lng !== undefined) {
            lat = Number(row.lat);
            lng = Number(row.lng);
          } else {
            const coords = parseGeometry(row.ubicacion) || { lat: 0, lng: 0 };
            lat = coords.lat;
            lng = coords.lng;
          }
          return {
            id: String(row.id),
            nombre: row.nombre,
            distrito: row.distrito,
            provincia: row.provincia,
            lat,
            lng
          };
        });
        setCentrosPoblados(mapped);
      }
    } catch (err) {
      console.error('Error al cargar Centros Poblados:', err);
    } finally {
      setIsCentrosPobladosLoading(false);
    }
  };

  // --- ESCUCHAR MOVIMIENTOS DEL MAPA PARA ACTUALIZAR CENTROS POBLADOS ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMapMove = () => {
      fetchCentrosPoblados();
    };

    map.on('moveend', handleMapMove);

    // Carga inicial
    fetchCentrosPoblados();

    return () => {
      map.off('moveend', handleMapMove);
    };
  }, [visibleLayers.capa6]);

  // --- RENDERIZAR CENTROS POBLADOS EN EL MAPA ---
  useEffect(() => {
    const group = centrosPobladosGroupRef.current;
    if (!group) return;

    group.clearLayers();

    if (!visibleLayers.capa6) return;

    centrosPoblados.forEach((cp) => {
      // CORRECCIÓN: Usamos un divIcon limpio de Leaflet para que no rompa el diseño
      const labelIcon = L.divIcon({
        className: '', // Dejar vacío para que Leaflet no le meta estilos raros de fondo
        html: `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100px;">
            <!-- El puntito azul del centro poblado -->
            <div class="w-1.5 h-1.5 rounded-full bg-indigo-600 border border-white shadow-sm mb-0.5"></div>
            
            <!-- La etiqueta de texto -->
            <div class="px-1.5 py-0.5 text-[9px] font-bold text-indigo-900 bg-indigo-50/95 border border-indigo-200/80 rounded shadow-sm whitespace-nowrap backdrop-blur-sm">
              ${cp.nombre}
            </div>
          </div>
        `,
        iconSize: [100, 30],
        iconAnchor: [50, 4] // Ajustado para que el puntito quede exactamente sobre la coordenada
      });

      const marker = L.marker([cp.lat, cp.lng], { 
        icon: labelIcon,
        interactive: true // Activado para que el popup funcione
      });

      const popupContent = `
        <div class="p-2.5 font-sans min-w-[160px]">
          <div class="flex items-center gap-1 border-b border-indigo-100 pb-1 mb-1 bg-indigo-50/60 px-1.5 py-0.5 rounded">
            <span class="text-[9px] font-bold text-indigo-700 uppercase">📍 Centro Poblado</span>
          </div>
          <h4 class="font-extrabold text-indigo-900 text-xs m-0 mb-1 leading-snug">${cp.nombre}</h4>
          <div class="space-y-0.5 text-[10px] text-slate-600">
            <p><strong>Distrito:</strong> ${cp.distrito}</p>
            <p><strong>Provincia:</strong> ${cp.provincia}</p>
          </div>
        </div>
      `;
      marker.bindPopup(popupContent);

      group.addLayer(marker);
    });
  }, [centrosPoblados, visibleLayers.capa6]);

  // --- CAPTURAR EVENTOS DE CLICK EN EL MAPA ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMapClick = (e: L.LeafletMouseEvent) => {
      // Detener cualquier edición de reporte actual
      setIsEditingReport(false);
      setSelectedReport(null);
      setSelectedSolicitud(null);
      setIsEditingSolicitud(false);

      // Activar formulario de creación en las coordenadas cliqueadas
      setClickCoords({
        lat: e.latlng.lat,
        lng: e.latlng.lng
      });
      setIsCreatingReport(true);
      const isCurrentlyAdmin = activeRole === 'admin';
      showToast(
        `Punto seleccionado en mapa: [Lat: ${e.latlng.lat.toFixed(5)}, Lng: ${e.latlng.lng.toFixed(5)}]. Complete el formulario para ${isCurrentlyAdmin ? 'registrar reporte (COER)' : 'solicitar registro'}.`,
        'info'
      );
    };

    map.on('click', onMapClick);

    return () => {
      map.off('click', onMapClick);
    };
  }, [activeRole]);

  // --- COMPILAR Y RENDERIZAR CAPAS SEGÚN EL ORDEN ESTRICTO (1 a 5) ---
  useEffect(() => {
    const map = mapRef.current;
    const group = layersGroupRef.current;
    if (!map || !group) return;

    // Limpiar todas las capas previas para evitar duplicidad y mantener orden jerárquico estricto
    group.clearLayers();

    // -------------------------------------------------------------
    // CAPA 1: Delimitación Distrital de Junín (WMS Oficial INEI)
    // -------------------------------------------------------------
    if (visibleLayers.capa1) {
      const wmsLayer = L.tileLayer.wms('https://geoservicios.inei.gob.pe/arcgis/services/Censos2017/MapServer/WMSServer', {
        layers: wmsLayerLevel, // '3' = Distrital, '2' = Provincial, '1' = Departamental
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        attribution: '&copy; INEI Delimitación Distrital WMS &copy; CAPCORP'
      });
      group.addLayer(wmsLayer);
    }

    // -----------------------------------------------------------------
    // CAPA 2: Epicentros del 18 de Julio en Chupaca (IGP - Datos Supabase)
    // -----------------------------------------------------------------
    if (visibleLayers.capa2) {
      epicenters.forEach((epicenter) => {
        // Crear DivIcon dinámico e inamovible de alta visibilidad técnica GIS
        const iconHtml = epicenter.type === 'principal' 
          ? `
            <div class="relative flex items-center justify-center">
              <div class="absolute w-12 h-12 rounded-full bg-red-600 animate-ping opacity-35"></div>
              <div class="absolute w-8 h-8 rounded-full bg-red-500 animate-pulse opacity-50"></div>
              <div class="relative w-7 h-7 rounded-full bg-red-700 border-2 border-white flex items-center justify-center text-white shadow-lg font-bold text-xs">
                ★
              </div>
            </div>
          `
          : `
            <div class="relative flex items-center justify-center">
              <div class="absolute w-8 h-8 rounded-full bg-orange-500 animate-ping opacity-30"></div>
              <div class="absolute w-6 h-6 rounded-full bg-orange-400 animate-pulse opacity-45"></div>
              <div class="relative w-5.5 h-5.5 rounded-full bg-orange-600 border border-white flex items-center justify-center text-white shadow-md font-bold text-[9px]">
                ★
              </div>
            </div>
          `;

        const markerIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-div-icon',
          iconSize: epicenter.type === 'principal' ? [48, 48] : [32, 32],
          iconAnchor: epicenter.type === 'principal' ? [24, 24] : [16, 16]
        });

        const popupContent = `
          <div class="p-3 font-sans max-w-[260px]">
            <div class="flex items-center gap-1.5 border-b border-red-200 pb-2 mb-2 bg-red-50 p-1.5 rounded">
              <span class="flex h-2.5 w-2.5 relative">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
              </span>
              <h4 class="font-bold text-red-900 text-sm m-0">
                ${epicenter.type === 'principal' ? 'Sismo Principal (Reporte IGP)' : 'Réplica Controlada'}
              </h4>
            </div>
            <div class="space-y-1 text-xs text-gray-700 leading-normal">
              <p><strong>Magnitud:</strong> <span class="text-red-700 font-bold text-sm">${epicenter.magnitude} Mww</span></p>
              <p><strong>Profundidad:</strong> ${epicenter.depth} km</p>
              <p><strong>Fecha/Hora:</strong> ${epicenter.time}</p>
              <p><strong>Epicentro:</strong> Chupaca, Junín</p>
              <p><strong>Coordenadas:</strong> Lat: ${epicenter.lat}, Lng: ${epicenter.lng}</p>
            </div>
            <div class="mt-2.5 pt-1.5 border-t border-gray-100 text-[10px] text-gray-500 flex items-center gap-1">
              <span class="px-1 bg-red-100 text-red-800 rounded font-bold uppercase">IGP</span>
              <span>Ubicación Instrumental Inamovible</span>
            </div>
          </div>
        `;

        const marker = L.marker([epicenter.lat, epicenter.lng], { icon: markerIcon });
        marker.bindPopup(popupContent, { closeButton: true });
        
        // Tooltip permanente para visibilidad inmediata sin hacer click
        marker.bindTooltip(`Sismo M${epicenter.magnitude}`, { 
          permanent: true, 
          direction: 'top', 
          offset: epicenter.type === 'principal' ? [0, -15] : [0, -10],
          className: `px-1.5 py-0.5 text-[10px] font-bold text-white rounded border-none shadow ${
            epicenter.type === 'principal' ? 'bg-red-600' : 'bg-orange-500'
          }` 
        });

        group.addLayer(marker);
      });
    }

    // -------------------------------------------------------------
    // CAPAS DINÁMICAS (Capa 3: Daño Físico, Capa 4: Daño Humano, Capa 5: Necesidades)
    // -------------------------------------------------------------
    filteredReports.forEach((report) => {

      let isVisible = false;
      let iconColorClass = 'bg-orange-500';
      let svgPath = '';
      let markerHtml = '';

      if (report.type === 'damage_physical' && visibleLayers.capa3) {
        isVisible = true;
        iconColorClass = report.severity === 'critico' ? 'bg-red-700' : 'bg-orange-500';
        // Icono de Casa / Infraestructura
        svgPath = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
      } else if (report.type === 'damage_human' && visibleLayers.capa4) {
        isVisible = true;
        iconColorClass = 'bg-red-600';
        // Icono de Cruz Médica / Humanos
        svgPath = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
      } else if (report.type === 'need_urgency' && visibleLayers.capa5) {
        isVisible = true;
        iconColorClass = 'bg-amber-500';
        // Icono de Alerta / Exclamación
        svgPath = `<div class="text-white font-black text-sm select-none leading-none">!</div>`;
      } else if (report.type === 'shelter_hub' && visibleLayers.capa7) {
        isVisible = true;
        iconColorClass = 'bg-emerald-500';
        // Icono de Paquete / Caja de acopio
        svgPath = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
      }

      if (!isVisible) return;

      // Crear HTML del marcador GIS con efecto de rebote sutil si es seleccionado
      const isSelected = selectedReport?.id === report.id;
      const pulseRingHtml = report.severity === 'critico' 
        ? `<div class="absolute w-8 h-8 rounded-full bg-red-600 animate-ping opacity-25"></div>` 
        : '';

      markerHtml = `
        <div class="relative flex items-center justify-center">
          ${pulseRingHtml}
          <div class="w-8 h-8 rounded-full ${iconColorClass} border-2 ${isSelected ? 'border-yellow-300 scale-125 z-[999] ring-2 ring-red-500' : 'border-white'} flex items-center justify-center text-white shadow-md hover:scale-110 transition-transform duration-200">
            ${svgPath}
          </div>
        </div>
      `;

      const divIcon = L.divIcon({
        html: markerHtml,
        className: 'custom-report-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([report.lat, report.lng], { icon: divIcon });
      
      // Asociar evento de clic para ver en panel de control lateral de forma sincrónica
      marker.on('click', () => {
        // Cerrar cualquier ventana de creación
        setIsCreatingReport(false);
        setClickCoords(null);
        setSelectedReport(report);
        setIsEditingReport(false);
      });

      // Crear popup básico por si se visualiza en móvil directo
      const severityBadgeColor = 
        report.severity === 'critico' ? 'bg-red-600 text-white font-bold' :
        report.severity === 'alto' ? 'bg-orange-500 text-white' :
        report.severity === 'medio' ? 'bg-amber-500 text-white' : 'bg-green-600 text-white';

      const reportTypeLabel = 
        report.type === 'damage_physical' ? '🧱 Daño Físico' :
        report.type === 'damage_human' ? '❤️ Daño Humano / Salud' : 
        report.type === 'shelter_hub' ? '📦 Centro de acopio' : '🚨 Necesidad / Urgencia';

      const popupContent = `
        <div class="p-2.5 font-sans min-w-[200px] max-w-[240px]">
          <div class="flex items-center justify-between gap-1 border-b border-gray-100 pb-1.5 mb-1.5">
            <span class="text-[10px] font-bold text-gray-500 uppercase">${reportTypeLabel}</span>
            <span class="px-1 text-[9px] uppercase rounded ${severityBadgeColor}">${report.severity}</span>
          </div>
          <h4 class="font-bold text-gray-900 text-xs m-0 mb-1 leading-snug">${report.title}</h4>
          <p class="text-[11px] text-gray-600 m-0 line-clamp-3 leading-normal">${report.description}</p>
          <div class="mt-2 pt-1 border-t border-gray-100 flex items-center justify-between text-[9px] text-gray-400">
            <span>Por: <strong>${report.createdBy}</strong></span>
            <span>Ver detalles en barra lateral</span>
          </div>
        </div>
      `;
      marker.bindPopup(popupContent, { closeButton: true });

      group.addLayer(marker);
    });

    // -------------------------------------------------------------
    // SOLICITUDES PENDIENTES (Solo para Administradores)
    // -------------------------------------------------------------
    if (isAdmin) {
      pendingSolicitudes.forEach((solicitud) => {
        const isSelected = selectedSolicitud?.id === solicitud.id;
        const pulseRingHtml = `<div class="absolute w-8 h-8 rounded-full bg-amber-500 animate-ping opacity-25"></div>`;
        const markerColorClass = 'bg-amber-400';

        const markerHtml = `
          <div class="relative flex items-center justify-center">
            ${pulseRingHtml}
            <div class="w-8 h-8 rounded-full ${markerColorClass} border-2 ${isSelected ? 'border-yellow-300 scale-125 z-[999] ring-2 ring-amber-500' : 'border-white'} flex items-center justify-center text-slate-900 shadow-md hover:scale-110 transition-transform duration-200">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-amber-950"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            </div>
          </div>
        `;

        const divIcon = L.divIcon({
          html: markerHtml,
          className: 'custom-solicitud-icon',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = L.marker([solicitud.lat, solicitud.lng], { icon: divIcon });

        // Asociar evento de clic para seleccionar e iniciar edición/aprobación en el panel lateral
        marker.on('click', () => {
          setIsCreatingReport(false);
          setClickCoords(null);
          setSelectedReport(null);
          setIsEditingReport(false);
          setSelectedSolicitud(solicitud);
          setIsEditingSolicitud(true);
        });

        const popupContent = `
          <div class="p-2.5 font-sans min-w-[200px] max-w-[240px]">
            <div class="flex items-center justify-between gap-1 border-b border-amber-200 pb-1.5 mb-1.5 bg-amber-50 px-1.5 py-0.5 rounded">
              <span class="text-[10px] font-bold text-amber-800 uppercase">⌛ SOLICITUD PENDIENTE</span>
              <span class="px-1 text-[9px] uppercase rounded bg-amber-600 text-white font-bold">REVISIÓN</span>
            </div>
            <h4 class="font-bold text-gray-900 text-xs m-0 mb-1 leading-snug">${solicitud.title}</h4>
            <p class="text-[11px] text-gray-600 m-0 line-clamp-3 leading-normal">${solicitud.description}</p>
            <div class="mt-2 pt-1 border-t border-amber-100 flex items-center justify-between text-[9px] text-gray-400">
              <span>Por: <strong>${solicitud.createdBy}</strong></span>
              <span>Gravedad: <strong class="uppercase">${solicitud.severity}</strong></span>
            </div>
          </div>
        `;
        marker.bindPopup(popupContent, { closeButton: true });

        group.addLayer(marker);
      });
    }

  }, [visibleLayers, reports, epicenters, severityFilter, selectedReport, wmsLayerLevel, isAdmin, pendingSolicitudes, selectedSolicitud]);

  // --- ENFOCAR PUNTO EN EL MAPA ---
  const handleFocusOnMap = (lat: number, lng: number) => {
    if (mapRef.current) {
      mapRef.current.setView([lat, lng], 16, { animate: true, duration: 1 });
      showToast('Enfocando coordenadas en visor satelital.', 'info');
    }
  };

  // --- CARGAR NUEVAS COORDENADAS DESDE EL INPUT MANUAL ---
  const handleManualCoordinates = (latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -18 && lat <= -1 && lng >= -82 && lng <= -68) {
      setClickCoords({ lat, lng });
      handleFocusOnMap(lat, lng);
    } else {
      showToast('Coordenadas inválidas. Rango aproximado de Perú: Lat: [-18 a -1], Lng: [-82 a -68]', 'error');
    }
  };

  // --- REPORTE Y FILTRADO POR SEVERIDAD ---
  const filteredReports = severityFilter === 'todos' 
    ? reports 
    : reports.filter(r => r.severity === severityFilter);

  // --- CÁLCULO DE ESTADÍSTICAS RÁPIDAS ---
  const stats = {
    totalReports: reports.length,
    physicalDamage: reports.filter(r => r.type === 'damage_physical').length,
    humanDamage: reports.filter(r => r.type === 'damage_human').length,
    urgentNeeds: reports.filter(r => r.type === 'need_urgency').length,
    shelterHubs: reports.filter(r => r.type === 'shelter_hub').length,
    criticalSeverity: reports.filter(r => r.severity === 'critico').length,
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-50 overflow-hidden font-sans text-slate-800">
      
      {/* ================= BARRA LATERAL DE CONTROL E INFORMACIÓN ================= */}
      <aside className={`w-full md:w-96 bg-white border-r border-slate-200/80 flex flex-col z-10 shadow-sm shrink-0 scrollbar-thin transition-all duration-300 ${
        isSidebarOpenMobile ? 'h-[60vh]' : 'h-[80px] overflow-hidden'
      } md:h-full md:overflow-y-auto`}>
        
        {/* CABECERA GUBERNAMENTAL / OPERATIVA */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200/80 sticky top-0 z-20 backdrop-blur-md flex flex-col justify-center">
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl overflow-hidden shadow border border-slate-200 shrink-0 mt-0.5 bg-white flex items-center justify-center">
                <img 
                  src="https://cloudfront-us-east-1.images.arcpublishing.com/copesa/STLLPKYDT5EENIT5EC6DVMZ7HU.jpg" 
                  alt="Logo Geovisor" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[9px] font-bold text-red-600 tracking-wider uppercase block">PELIGROS Y EMERGENCIAS JUNIN - GIS</span>
                <h1 className="text-xs md:text-sm font-black text-slate-900 uppercase tracking-tight leading-tight whitespace-normal break-words">
                  GEOVISOR ELIAS TACUNAN CAHUANA
                </h1>
              </div>
            </div>

            {/* BOTÓN DESPLEGABLE EXCLUSIVO PARA MÓVILES Y TABLETS */}
            <button
              onClick={() => setIsSidebarOpenMobile(!isSidebarOpenMobile)}
              className="md:hidden flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-[10px] font-extrabold uppercase rounded-lg text-slate-700 transition-all border border-slate-200 shadow-sm shrink-0 cursor-pointer"
            >
              <span>{isSidebarOpenMobile ? 'Cerrar' : 'Info / Capas'}</span>
              {isSidebarOpenMobile ? (
                <ChevronUp className="w-3 h-3 text-slate-600" />
              ) : (
                <ChevronDown className="w-3 h-3 text-slate-600 animate-bounce" />
              )}
            </button>
          </div>

          {/* Detalles ocultables en móvil si está colapsado, siempre visibles en PC/Tablet */}
          <div className={`${isSidebarOpenMobile ? 'block animate-fade-in' : 'hidden md:block'} mt-2.5`}>
            <p className="text-[11px] text-slate-500 leading-normal">
              Centro de Monitoreo y Control Georreferenciado para la Gestión del Riesgo de Desastres en el Valle del Mantaro.
            </p>
            <div className="mt-2.5 flex items-center justify-between text-[10px] bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-650 shadow-sm">
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Sismo Principal: <strong className="text-slate-800">5.1 Mww</strong></span>
              </div>
              <span className="text-red-600 font-bold">Afectación Media</span>
            </div>
          </div>
        </div>

        {/* CONTENEDOR PRINCIPAL SIDEBAR (Ocultable si está colapsado en móvil, siempre visible en desktop) */}
        <div className={`flex-1 p-4 space-y-4 ${isSidebarOpenMobile ? 'block overflow-y-auto' : 'hidden md:block md:overflow-y-auto'}`}>

          {/* ESTADÍSTICAS RÁPIDAS EN TIEMPO REAL */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="bg-white p-2 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <span className="text-[9px] text-slate-500 block font-semibold truncate">Daño Físico</span>
              <div className="flex items-baseline gap-0.5 mt-0.5">
                <span className="text-base font-black text-orange-600">{stats.physicalDamage}</span>
                <span className="text-[8px] text-slate-400">pts</span>
              </div>
            </div>
            <div className="bg-white p-2 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <span className="text-[9px] text-slate-500 block font-semibold truncate">Daño Humano</span>
              <div className="flex items-baseline gap-0.5 mt-0.5">
                <span className="text-base font-black text-red-600">{stats.humanDamage}</span>
                <span className="text-[8px] text-slate-400">cas</span>
              </div>
            </div>
            <div className="bg-white p-2 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <span className="text-[9px] text-slate-500 block font-semibold truncate">Necesidades</span>
              <div className="flex items-baseline gap-0.5 mt-0.5">
                <span className="text-base font-black text-amber-600">{stats.urgentNeeds}</span>
                <span className="text-[8px] text-slate-400">zon</span>
              </div>
            </div>
            <div className="bg-white p-2 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <span className="text-[9px] text-slate-500 block font-semibold truncate">Acopios</span>
              <div className="flex items-baseline gap-0.5 mt-0.5">
                <span className="text-base font-black text-emerald-650">{stats.shelterHubs}</span>
                <span className="text-[8px] text-slate-400">cent</span>
              </div>
            </div>
          </div>

          {/* CONTROLADORES DE CAPAS GIS (DE ABAJO HACIA ARRIBA EN PANEL) */}
          <div className="hidden md:block bg-slate-50/40 rounded-2xl p-3.5 border border-slate-200/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-slate-600" />
                Jerarquía de Capas (GIS Layer Stack)
              </span>
              <span className="text-[9px] text-slate-400 font-mono">Orden de carga</span>
            </div>

            {/* Capa 5 (Arriba en panel para mantener el orden jerárquico estricto visual) */}
            <div className="space-y-2.5">

              {/* CAPA 7: Centro de acopio */}
              <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <input
                  type="checkbox"
                  id="chk-capa7"
                  checked={visibleLayers.capa7}
                  onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa7: e.target.checked }))}
                  className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-emerald-650 focus:ring-emerald-500 bg-slate-50 accent-emerald-650 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="chk-capa7" className="text-xs font-bold text-emerald-850 flex items-center gap-1 select-none cursor-pointer">
                      <span>Capa 7: Centro de acopio</span>
                    </label>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-emerald-50 border border-emerald-200/60 text-emerald-800 rounded font-mono">
                      {stats.shelterHubs}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    Centros de acopio y ayuda autorizados (alimentos, ropa, medicinas). Simbología verde.
                  </p>
                </div>
              </div>
              
              {/* CAPA 5: Necesidades y Urgencias */}
              <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <input
                  type="checkbox"
                  id="chk-capa5"
                  checked={visibleLayers.capa5}
                  onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa5: e.target.checked }))}
                  className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500 bg-slate-50 accent-amber-600 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="chk-capa5" className="text-xs font-bold text-amber-850 flex items-center gap-1 select-none cursor-pointer">
                      <span>Capa 5: Necesidades y Urgencias</span>
                    </label>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-amber-50 border border-amber-200/60 text-amber-800 rounded font-mono">
                      {stats.urgentNeeds}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    Ayuda humanitaria requerida (carpas, agua, víveres). Icono de exclamación.
                  </p>
                </div>
              </div>

              {/* CAPA 4: Daño Humano */}
              <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <input
                  type="checkbox"
                  id="chk-capa4"
                  checked={visibleLayers.capa4}
                  onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa4: e.target.checked }))}
                  className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500 bg-slate-50 accent-red-600 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="chk-capa4" className="text-xs font-bold text-red-850 flex items-center gap-1 select-none cursor-pointer">
                      <span>Capa 4: Daño Humano / Salud</span>
                    </label>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-red-50 border border-red-200/60 text-red-800 rounded font-mono">
                      {stats.humanDamage}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    Familias damnificadas, personas heridas o decesos. Icono médico.
                  </p>
                </div>
              </div>

              {/* CAPA 3: Daño Físico */}
              <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <input
                  type="checkbox"
                  id="chk-capa3"
                  checked={visibleLayers.capa3}
                  onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa3: e.target.checked }))}
                  className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500 bg-slate-50 accent-orange-600 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="chk-capa3" className="text-xs font-bold text-orange-850 flex items-center gap-1 select-none cursor-pointer">
                      <span>Capa 3: Daño Físico / Infraestructura</span>
                    </label>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-orange-50 border border-orange-200/60 text-orange-800 rounded font-mono">
                      {stats.physicalDamage}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    Casas destruidas, colegios, puentes y carreteras bloqueadas. Simbología naranja.
                  </p>
                </div>
              </div>

              {/* CAPA 2: Epicentros del 18 de Julio */}
              <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <input
                  type="checkbox"
                  id="chk-capa2"
                  checked={visibleLayers.capa2}
                  onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa2: e.target.checked }))}
                  className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-slate-700 focus:ring-slate-500 bg-slate-50 accent-slate-700 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="chk-capa2" className="text-xs font-bold text-slate-800 flex items-center gap-1 select-none cursor-pointer">
                      <span>Capa 2: Epicentros del 18 de Julio</span>
                    </label>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-slate-100 border border-slate-200 text-slate-600 rounded font-mono">
                      2 pts
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    Epicentro principal (5.1 M) y réplica (3.4 M). Datos científicos IGP. Inamovibles.
                  </p>
                </div>
              </div>

              {/* CAPA 1: Delimitación Distrital */}
              <div className="flex flex-col gap-2 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="chk-capa1"
                    checked={visibleLayers.capa1}
                    onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa1: e.target.checked }))}
                    className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 bg-slate-50 accent-teal-600 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor="chk-capa1" className="text-xs font-bold text-teal-850 flex items-center gap-1 select-none cursor-pointer">
                        <span>Capa 1: Delimitación Distrital (WMS)</span>
                      </label>
                      <span className="text-[9px] font-bold px-1.5 py-0.2 bg-teal-50 border border-teal-200/60 text-teal-800 rounded font-mono uppercase">
                        WMS INEI
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                      Límites cartográficos oficiales en tiempo real provistos por el geovisor de Censos Nacionales (INEI).
                    </p>
                  </div>
                </div>

                {visibleLayers.capa1 && (
                  <div className="mt-1.5 pl-6 pt-1.5 border-t border-slate-100/70 flex items-center justify-between gap-1.5">
                    <span className="text-[9px] font-bold text-slate-400 font-mono">NIVEL CARTOGRÁFICO:</span>
                    <div className="flex gap-1">
                      {[
                        { label: 'Distrital', val: '3' },
                        { label: 'Provincial', val: '2' },
                        { label: 'Departamental', val: '1' }
                      ].map((lvl) => (
                        <button
                          key={lvl.val}
                          type="button"
                          onClick={() => {
                            setWmsLayerLevel(lvl.val as '3' | '2' | '1');
                            showToast(`Capa WMS INEI de nivel ${lvl.label} activada.`, 'info');
                          }}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer border ${
                            wmsLayerLevel === lvl.val
                              ? 'bg-slate-900 border-slate-900 text-white shadow-sm font-sans'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800 font-sans'
                          }`}
                        >
                          {lvl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* CAPA 6: Centros Poblados (PostGIS) */}
              <div className="flex flex-col gap-1 bg-white p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="chk-capa6"
                    checked={visibleLayers.capa6}
                    onChange={(e) => setVisibleLayers(prev => ({ ...prev, capa6: e.target.checked }))}
                    className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-slate-50 accent-indigo-600 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor="chk-capa6" className="text-xs font-bold text-indigo-850 flex items-center gap-1 select-none cursor-pointer">
                        <span>Capa 6: Centros Poblados (PostGIS)</span>
                      </label>
                      {isCentrosPobladosLoading ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 bg-indigo-50 text-indigo-600 rounded font-mono animate-pulse">
                          Cargando...
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.2 bg-indigo-50 border border-indigo-200/60 text-indigo-800 rounded font-mono">
                          {centrosPoblados.length} labels
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                      Etiquetas de texto dinámicas sobre el mapa. Solo se cargan al hacer Zoom &ge; 14 (escala &le; 1 km) de la zona visible.
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* FILTRO DE SEVERIDAD RÁPIDO */}
          <div className="bg-slate-50/40 rounded-2xl p-3.5 border border-slate-200/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700">Filtro de Gravedad del Impacto</span>
              {severityFilter !== 'todos' && (
                <button 
                  onClick={() => setSeverityFilter('todos')}
                  className="text-[10px] text-slate-500 hover:text-slate-900 underline cursor-pointer"
                >
                  Ver todos
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'todos', label: 'Todos', count: reports.length },
                { id: 'critico', label: 'Crítico', count: reports.filter(r => r.severity === 'critico').length },
                { id: 'alto', label: 'Alto', count: reports.filter(r => r.severity === 'alto').length },
                { id: 'medio', label: 'Medio', count: reports.filter(r => r.severity === 'medio').length },
                { id: 'bajo', label: 'Bajo', count: reports.filter(r => r.severity === 'bajo').length }
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSeverityFilter(item.id)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-medium capitalize border transition-all cursor-pointer flex items-center gap-1.5 ${
                    severityFilter === item.id 
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm font-bold' 
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-350 hover:text-slate-900 shadow-sm'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    severityFilter === item.id
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* LISTA RÁPIDA DE ALERTAS REPORTADAS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Puntos Críticos de Campo</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {severityFilter === 'todos' ? `Mostrando ${reports.length}` : `Mostrando ${filteredReports.length} de ${reports.length}`}
              </span>
            </div>
            
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {filteredReports.length === 0 ? (
                <div className="p-3 text-center bg-white border border-dashed border-slate-200 rounded-xl">
                  <p className="text-[11px] text-slate-500 font-medium">No hay reportes con gravedad "{severityFilter}".</p>
                </div>
              ) : (
                filteredReports.map((report) => (
                  <div
                    key={report.id}
                    onClick={() => {
                      setSelectedReport(report);
                      setIsEditingReport(false);
                      setIsCreatingReport(false);
                      setClickCoords(null);
                      handleFocusOnMap(report.lat, report.lng);
                    }}
                    className={`p-2.5 rounded-xl text-left border cursor-pointer transition-all ${
                      selectedReport?.id === report.id
                        ? 'bg-slate-50/90 border-slate-400/80 shadow-md scale-[0.99]'
                        : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase border ${
                        report.type === 'damage_physical' ? 'bg-orange-50 border-orange-200/40 text-orange-700' :
                        report.type === 'damage_human' ? 'bg-red-50 border-red-200/40 text-red-700' : 
                        report.type === 'shelter_hub' ? 'bg-emerald-50 border-emerald-200/40 text-emerald-750' : 'bg-amber-50 border-amber-200/40 text-amber-700'
                      }`}>
                        {report.type === 'damage_physical' ? 'Físico' : 
                         report.type === 'damage_human' ? 'Salud' : 
                         report.type === 'shelter_hub' ? 'Acopio' : 'Urgencia'}
                      </span>
                      <span className={`text-[8px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                        report.severity === 'critico' ? 'bg-red-500 text-white' :
                        report.severity === 'alto' ? 'bg-orange-500 text-white' :
                        report.severity === 'medio' ? 'bg-amber-500 text-white' : 'bg-slate-100 border border-slate-200 text-slate-700'
                      }`}>
                        {report.severity}
                      </span>
                    </div>
                    <h5 className="text-xs font-semibold text-slate-900 truncate">{report.title}</h5>
                    <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1">
                      <span className="font-medium text-slate-500">{report.createdBy}</span>
                      <span className="font-mono">Lat: {report.lat.toFixed(3)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* CONTROL DE ACCESO Y SEGURIDAD (ROLES DE USUARIO) */}
          <div className="bg-slate-50/50 rounded-2xl p-3.5 border border-slate-200/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-800">Acceso del Geovisor</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${activeRole === 'admin' ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}`}></span>
                <span className="text-[10px] font-mono uppercase text-slate-500 font-bold">
                  {activeRole === 'admin' ? 'Administrador' : 'Público General'}
                </span>
              </div>
            </div>

            {activeRole === 'publico' ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-500 leading-normal">
                  Ingreso general con permisos de <strong>LECTURA</strong>. Puede navegar capas, ver epicentros e impactos reportados. Para añadir/editar, inicie sesión.
                </p>
                <button
                  id="btn-login-coer"
                  onClick={() => setShowLoginModal(true)}
                  className="w-full py-1.5 px-3 bg-white hover:bg-slate-50 text-xs font-semibold rounded-xl flex items-center justify-center gap-1 text-slate-700 transition-colors border border-slate-200 shadow-sm"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                  Iniciar Sesión CAPCORP (Modo Admin)
                </button>
              </div>
            ) : (
              <div className="space-y-2 bg-red-50/85 p-3 rounded-2xl border border-red-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-red-750 font-bold flex items-center gap-1">
                    <Unlock className="w-3.5 h-3.5" />
                    Modo Editor Habilitado
                  </span>
                  <button
                    onClick={handleLogout}
                    className="text-[10px] font-medium text-slate-500 hover:text-slate-800 transition-colors"
                  >
                    Cerrar Sesión
                  </button>
                </div>
                <p className="text-[10px] text-red-600/80 leading-tight">
                  Haga clic en cualquier punto del mapa satelital para capturar coordenadas geográficas y registrar un nuevo reporte en caliente.
                </p>
              </div>
            )}
          </div>

          {/* SOLICITUDES PENDIENTES (Solo visible para Administradores) */}
          {isAdmin && (
            <div className="bg-amber-50/50 rounded-2xl p-3.5 border border-amber-200/60 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-700 animate-pulse" />
                  <span className="text-xs font-bold text-amber-900">Solicitudes Pendientes</span>
                </div>
                <span className="text-[10px] bg-amber-200 text-amber-800 font-mono font-bold px-1.5 py-0.2 rounded-full">
                  {pendingSolicitudes.length}
                </span>
              </div>

              {pendingSolicitudes.length === 0 ? (
                <p className="text-[11px] text-amber-750 italic leading-snug">
                  No hay solicitudes de registro pendientes de aprobación.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-amber-200">
                  {pendingSolicitudes.map((solicitud) => {
                    const isSelected = selectedSolicitud?.id === solicitud.id;
                    const displayDate = solicitud.createdAt ? new Date(solicitud.createdAt).toLocaleDateString() : '';
                    return (
                      <div
                        key={solicitud.id}
                        onClick={() => {
                          setSelectedSolicitud(solicitud);
                          setIsEditingSolicitud(true);
                          setIsCreatingReport(false);
                          setClickCoords(null);
                          setSelectedReport(null);
                          setIsEditingReport(false);
                          handleFocusOnMap(solicitud.lat, solicitud.lng);
                        }}
                        className={`p-2.5 rounded-xl text-left border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-amber-100/80 border-amber-400 shadow-sm scale-[0.99]'
                            : 'bg-white border-amber-200 hover:bg-amber-50/70 shadow-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[8px] font-mono font-bold px-1 rounded bg-amber-500 text-white uppercase">
                            Pendiente
                          </span>
                          {displayDate && (
                            <span className="text-[8px] font-mono text-slate-400">
                              {displayDate}
                            </span>
                          )}
                        </div>
                        <h5 className="text-[11px] font-bold text-slate-900 truncate">
                          {solicitud.title}
                        </h5>
                        <p className="text-[10px] text-slate-500 line-clamp-2 leading-tight">
                          {solicitud.description}
                        </p>
                        <div className="flex items-center justify-between text-[8px] text-slate-400 mt-1 pt-1 border-t border-amber-100/50">
                          <span>Por: <strong>{solicitud.createdBy}</strong></span>
                          <span>Gravedad: <strong className="uppercase">{solicitud.severity}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* CONTROL DE DATOS SEMILLA / RECOBRAR */}
          <div className="pt-2.5 border-t border-slate-200 flex justify-between items-center text-[11px] text-slate-400">
            <span className="font-medium">Sistema WebGIS v2.4.0</span>
            {isResetConfirming ? (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <button
                  onClick={handleResetData}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold px-2 py-0.5 rounded text-[10px] cursor-pointer"
                >
                  ¿Seguro?
                </button>
                <button
                  onClick={() => setIsResetConfirming(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] border border-slate-200 cursor-pointer"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsResetConfirming(true)}
                className="flex items-center gap-1 hover:text-slate-900 hover:bg-slate-50 transition-colors text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-sm cursor-pointer"
                title="Restablecer base de datos local a reportes por defecto"
              >
                <RotateCcw className="w-3 h-3" />
                Restablecer Semilla
              </button>
            )}
          </div>

        </div>
      </aside>

      {/* ================= SECCIÓN DERECHA: MAPA LEAFLET Y FORMULARIOS DE ACCIÓN ================= */}
      <main className="flex-1 relative flex flex-col h-0 md:h-full">
        
        {/* ENCABEZADO SUPERIOR DE ESTADO EN EL MAPA */}
        <div className="absolute top-3 left-3 z-[1000] max-w-sm md:max-w-md bg-white/95 border border-slate-200 p-3 rounded-2xl shadow-lg backdrop-blur-md">
          <div className="flex items-start gap-2.5">
            <div className="p-2 bg-yellow-100 text-yellow-800 rounded-xl border border-yellow-200/50 shadow-sm">
              <Activity className="w-4 h-4 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs text-slate-900">Consola de Estado Sísmico</span>
                <span className="px-1.5 py-0.2 rounded border border-emerald-200 text-[8px] font-bold bg-emerald-50 text-emerald-800 uppercase animate-pulse">
                  Monitoreo Activo
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                Datos oficiales referenciados a Chupaca, Provincia de Chupaca, Junín. Escala instrumental del Instituto Geofísico del Perú (IGP).
              </p>
            </div>
          </div>
        </div>

        {/* SELECTOR FLOTANTE DE BASEMAPS */}
        <div className="hidden md:flex absolute bottom-6 left-6 z-[1000] bg-white/95 border border-slate-200 p-2 rounded-2xl shadow-xl backdrop-blur-md gap-1.5">
          <button
            onClick={() => {
              setActiveBasemap('openstreetmap');
              showToast('Mapa base OpenStreetMap activado.', 'info');
            }}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeBasemap === 'openstreetmap' 
                ? 'bg-slate-900 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-slate-50'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            OpenStreetMap
          </button>
          <button
            onClick={() => {
              setActiveBasemap('satellite');
              showToast('Capa satelital híbrida activada.', 'info');
            }}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeBasemap === 'satellite' 
                ? 'bg-slate-900 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-slate-50'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Satélite (Híbrido)
          </button>
          <button
            onClick={() => {
              setActiveBasemap('streets');
              showToast('Capa de calles Google Maps activada.', 'info');
            }}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeBasemap === 'streets' 
                ? 'bg-slate-900 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-slate-50'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Vías y Calles
          </button>
        </div>

        {/* BOTÓN FLOTANTE PARA SELECCIÓN DE MAPA (SOLO MÓVIL) */}
        <button
          onClick={handleCycleBasemap}
          className="md:hidden absolute bottom-36 right-6 z-[1000] p-3.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-full shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-110 active:scale-90 cursor-pointer flex items-center justify-center border border-slate-700/30 group"
          title="Cambiar mapa base"
        >
          <MapIcon className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
          <span className="absolute right-14 bg-slate-900/95 text-white text-[10px] font-bold px-2.5 py-1 rounded-xl border border-slate-700/40 shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            {activeBasemap === 'openstreetmap' ? 'OpenStreetMap' : activeBasemap === 'satellite' ? 'Satélite' : 'Vías y Calles'}
          </span>
        </button>

        {/* BOTÓN FLOTANTE PARA GEOLOCALIZAR Y CENTRAR MAPA */}
        <button
          onClick={handleLocateUser}
          className="absolute bottom-20 right-6 z-[1000] p-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-115 active:scale-90 cursor-pointer flex items-center justify-center border border-blue-500/30 group"
          title="Centrar en mi ubicación"
        >
          <Locate className="w-5 h-5 animate-pulse group-hover:animate-none" />
        </button>

        {/* NOTIFICACIÓN EN CONSOLA (TOAST) */}
        {notification && (
          <div className={`absolute bottom-20 left-1/2 -translate-x-1/2 z-[1000] px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 border text-xs font-semibold animate-fade-in ${
            notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
            notification.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-white border-slate-200 text-slate-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              notification.type === 'success' ? 'bg-emerald-500 animate-ping' :
              notification.type === 'error' ? 'bg-red-500 animate-ping' : 'bg-slate-400 animate-ping'
            }`}></span>
            {notification.text}
          </div>
        )}

        {/* BANNER AVISO MODO EDITOR */}
        {activeRole === 'admin' && (
          <div className="absolute top-3 right-16 z-[1000] bg-red-600 text-white font-bold text-[10px] md:text-xs px-3 py-2 rounded-xl shadow-lg border border-red-500 animate-pulse flex items-center gap-1.5">
            <PlusCircle className="w-4 h-4" />
            <span>MODO COER: Haz clic en el mapa para colocar un marcador de impacto</span>
          </div>
        )}

        {/* ================= CONTENEDOR DE MAPA LEAFLET REAL ================= */}
        <div 
          ref={mapContainerRef} 
          id="map" 
          className="w-full h-full bg-slate-900 outline-none"
          style={{ height: '100%', minHeight: '500px' }}
        />

        {/* ================= DETALLE DE REPORTE SELECCIONADO (SIDEBAR DE MAPA) ================= */}
        {selectedReport && (
          <div className="absolute top-16 md:top-24 right-3 z-[1000] w-[340px] md:w-[380px] bg-white/95 border border-slate-200/80 rounded-3xl shadow-xl p-4 animate-slide-in backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-200/85 pb-2.5 mb-3">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                selectedReport.type === 'damage_physical' ? 'bg-orange-50 text-orange-700 border-orange-200/60' :
                selectedReport.type === 'damage_human' ? 'bg-red-50 text-red-700 border-red-200/60' : 
                selectedReport.type === 'shelter_hub' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' : 'bg-amber-50 text-amber-700 border-amber-200/60'
              }`}>
                {selectedReport.type === 'damage_physical' ? '🧱 Capa 3: Daño Físico' :
                 selectedReport.type === 'damage_human' ? '❤️ Capa 4: Daño Humano' : 
                 selectedReport.type === 'shelter_hub' ? '📦 Capa 7: Centro de acopio' : '🚨 Capa 5: Necesidad y Urgencia'}
              </span>
              <button 
                onClick={() => {
                  setSelectedReport(null);
                  setIsEditingReport(false);
                }} 
                className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!isEditingReport ? (
              // VISTA DE LECTURA (DISPONIBLE PARA AMBOS ROLES)
              <div className="space-y-3.5">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-snug">{selectedReport.title}</h3>
                  <p className="text-slate-650 text-xs mt-1 leading-relaxed whitespace-pre-line">{selectedReport.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200/50 text-[11px]">
                  <div>
                    <span className="text-slate-400 block font-medium">Severidad</span>
                    <span className="font-bold capitalize flex items-center gap-1 text-slate-800">
                      <span className={`w-2 h-2 rounded-full ${
                        selectedReport.severity === 'critico' ? 'bg-red-500 animate-pulse' :
                        selectedReport.severity === 'alto' ? 'bg-orange-500' :
                        selectedReport.severity === 'medio' ? 'bg-amber-500' : 'bg-green-500'
                      }`}></span>
                      {selectedReport.severity}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Subtipo</span>
                    <span className="font-bold text-slate-700">
                      {selectedReport.subType.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Registrado Por</span>
                    <span className="font-bold text-slate-700">{selectedReport.createdBy}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Fecha/Hora Reporte</span>
                    <span className="font-mono text-slate-500">
                      {new Date(selectedReport.createdAt).toLocaleString('es-PE')}
                    </span>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-slate-200 mt-1">
                    <span className="text-slate-400 block font-medium">Coordenadas Geográficas</span>
                    <span className="font-mono text-slate-650">
                      {selectedReport.lat.toFixed(5)}, {selectedReport.lng.toFixed(5)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 pt-1.5 border-t border-slate-200">
                  <button
                    onClick={() => handleFocusOnMap(selectedReport.lat, selectedReport.lng)}
                    className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1 text-white shadow-sm transition-all cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Centrar en Mapa
                  </button>

                  {activeRole === 'admin' && (
                    <>
                      <button
                        onClick={() => setIsEditingReport(true)}
                        className="px-3.5 py-2 bg-white hover:bg-slate-50 text-xs font-semibold rounded-xl flex items-center justify-center gap-1 text-slate-700 border border-slate-200 shadow-sm transition-all cursor-pointer"
                        disabled={isSubmitting}
                      >
                        Editar
                      </button>
                      
                      {isDeleteConfirming ? (
                        <div className="flex items-center gap-1.5 animate-fade-in">
                          <button
                            onClick={() => handleDeleteReport(selectedReport.id)}
                            disabled={isSubmitting}
                            className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-xs font-bold rounded-xl text-white shadow-sm transition-all cursor-pointer"
                          >
                            {isSubmitting ? '...' : '¿Eliminar?'}
                          </button>
                          <button
                            onClick={() => setIsDeleteConfirming(false)}
                            disabled={isSubmitting}
                            className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-semibold rounded-xl text-slate-700 border border-slate-200 transition-all cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setIsDeleteConfirming(true)}
                          disabled={isSubmitting}
                          className="px-3.5 py-2 bg-red-50 hover:bg-red-100 border border-red-150 text-xs font-semibold rounded-xl flex items-center justify-center gap-1 text-red-650 transition-all cursor-pointer"
                          title="Eliminar Reporte de Supabase"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              // FORMULARIO DE EDICIÓN (SÓLO PARA ADMINISTRADORES)
              <form onSubmit={handleUpdateReport} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Título del Reporte</label>
                  <input
                    type="text"
                    value={selectedReport.title}
                    onChange={(e) => setSelectedReport(prev => prev ? { ...prev, title: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                    maxLength={100}
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Gravedad / Severidad</label>
                  <select
                    value={selectedReport.severity}
                    onChange={(e) => setSelectedReport(prev => prev ? { ...prev, severity: e.target.value as SeverityLevel } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                  >
                    <option value="bajo">Bajo (Precaución)</option>
                    <option value="medio">Medio (Atención necesaria)</option>
                    <option value="alto">Alto (Peligro estructural/social)</option>
                    <option value="critico">Crítico (Colapso/Inmediato)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Descripción de Daños o Necesidad</label>
                  <textarea
                    value={selectedReport.description}
                    onChange={(e) => setSelectedReport(prev => prev ? { ...prev, description: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none h-20 resize-none transition-all"
                    maxLength={1000}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Reportado Por</label>
                    <input
                      type="text"
                      value={selectedReport.createdBy}
                      onChange={(e) => setSelectedReport(prev => prev ? { ...prev, createdBy: e.target.value } : null)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Ubicación (Lectura)</label>
                    <div className="bg-slate-50 text-slate-500 p-2.5 text-[10px] font-mono rounded-xl border border-slate-200 truncate">
                      {selectedReport.lat.toFixed(4)}, {selectedReport.lng.toFixed(4)}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`flex-1 py-2 text-xs font-semibold rounded-xl text-white shadow-sm transition-all cursor-pointer ${
                      isSubmitting
                        ? 'bg-slate-500 cursor-not-allowed opacity-75'
                        : 'bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsEditingReport(false)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 text-xs font-semibold rounded-xl text-slate-700 border border-slate-200 shadow-sm transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ================= REGISTRO DE NUEVO REPORTE EN CALIENTE (MAP CLICK) ================= */}
        {isCreatingReport && clickCoords && (
          <div className="absolute top-16 md:top-24 right-3 z-[1000] w-[340px] md:w-[380px] bg-white/95 border border-slate-200/80 rounded-3xl shadow-xl p-4 animate-slide-in backdrop-blur-md max-h-[80vh] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between border-b border-slate-200/85 pb-2 mb-2.5">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1">
                <Plus className="w-4 h-4 text-slate-600" />
                {activeRole === 'admin' ? 'Registrar Impacto de Campo (COER)' : 'Solicitar Registro de Reporte'}
              </span>
              <button 
                onClick={() => {
                  setIsCreatingReport(false);
                  setClickCoords(null);
                }} 
                className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReport} className="space-y-3.5">
              
              {/* Coordenadas capturadas */}
              <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 font-medium font-sans">Ubicación de Impacto:</span>
                <span className="text-slate-800 font-bold font-mono">
                  [{clickCoords.lat.toFixed(5)}, {clickCoords.lng.toFixed(5)}]
                </span>
              </div>

              {/* Selección de Capa / Categoría */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Capa Temática de Emergencia</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCategoryChange('damage_physical')}
                    className={`p-1.5 rounded-lg text-[10px] border font-bold text-center transition-all cursor-pointer ${
                      newReport.type === 'damage_physical'
                        ? 'bg-orange-50 border-orange-300 text-orange-700 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-850'
                    }`}
                  >
                    🧱 Capa 3: Físico
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCategoryChange('damage_human')}
                    className={`p-1.5 rounded-lg text-[10px] border font-bold text-center transition-all cursor-pointer ${
                      newReport.type === 'damage_human'
                        ? 'bg-red-50 border-red-300 text-red-700 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-850'
                    }`}
                  >
                    ❤️ Capa 4: Humano
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCategoryChange('need_urgency')}
                    className={`p-1.5 rounded-lg text-[10px] border font-bold text-center transition-all cursor-pointer ${
                      newReport.type === 'need_urgency'
                        ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-850'
                    }`}
                  >
                    🚨 Capa 5: Urgencia
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCategoryChange('shelter_hub')}
                    className={`p-1.5 rounded-lg text-[10px] border font-bold text-center transition-all cursor-pointer ${
                      newReport.type === 'shelter_hub'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-850'
                    }`}
                  >
                    🟢 Capa 7: Acopio
                  </button>
                </div>
              </div>

              {/* Subtipo de reporte */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Subtipo Específico de Incidencia</label>
                <select
                  value={newReport.subType}
                  onChange={(e) => setNewReport(prev => ({ ...prev, subType: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                >
                  {SUB_TYPES_BY_CATEGORY[newReport.type].map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Título */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Título / Incidencia Breve</label>
                <input
                  type="text"
                  placeholder="Ej: Colapso de tapial en Jr. Lima"
                  value={newReport.title}
                  onChange={(e) => setNewReport(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                  maxLength={100}
                  required
                />
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Descripción Detallada / Reporte de Daños</label>
                <textarea
                  placeholder="Describa la afectación de forma clara para el envío de ayuda humanitaria..."
                  value={newReport.description}
                  onChange={(e) => setNewReport(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none h-16 resize-none transition-all"
                  maxLength={1000}
                  required
                />
              </div>

              {/* Distrito y Provincia (Requerido para solicitudes de reporte) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Distrito</label>
                  <input
                    type="text"
                    placeholder="Ej: Chupaca"
                    value={newReport.distrito}
                    onChange={(e) => setNewReport(prev => ({ ...prev, distrito: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Provincia</label>
                  <input
                    type="text"
                    placeholder="Ej: Chupaca"
                    value={newReport.provincia}
                    onChange={(e) => setNewReport(prev => ({ ...prev, provincia: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                    required
                  />
                </div>
              </div>

              {/* Severidad y Reportador */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nivel de Gravedad</label>
                  <select
                    value={newReport.severity}
                    onChange={(e) => setNewReport(prev => ({ ...prev, severity: e.target.value as SeverityLevel }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                  >
                    <option value="bajo">Bajo (Precaución)</option>
                    <option value="medio">Medio (Atención)</option>
                    <option value="alto">Alto (Grave)</option>
                    <option value="critico">Crítico (Emergencia)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">
                    {activeRole === 'admin' ? 'Reportado Por' : 'Nombre del Solicitante'}
                  </label>
                  <input
                    type="text"
                    value={newReport.createdBy}
                    onChange={(e) => setNewReport(prev => ({ ...prev, createdBy: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex-1 py-2.5 text-xs font-semibold rounded-xl text-white shadow-sm transition-all cursor-pointer ${
                    isSubmitting
                      ? 'bg-slate-500 cursor-not-allowed opacity-75'
                      : 'bg-slate-900 hover:bg-slate-850'
                  }`}
                >
                  {activeRole === 'admin' 
                    ? (isSubmitting ? 'Guardando en Supabase...' : 'Registrar Reporte') 
                    : (isSubmitting ? 'Enviando solicitud...' : 'Solicitar Registro del Reporte')}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsCreatingReport(false);
                    setClickCoords(null);
                  }}
                  className="px-3.5 py-2.5 bg-white hover:bg-slate-50 text-xs font-semibold rounded-xl text-slate-700 border border-slate-200 shadow-sm transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ================= FORMULARIO DE REVISIÓN, EDICIÓN Y APROBACIÓN DE SOLICITUD (SÓLO ADMIN) ================= */}
        {selectedSolicitud && isEditingSolicitud && isAdmin && (
          <div className="absolute top-16 md:top-24 right-3 z-[1000] w-[340px] md:w-[380px] bg-white/95 border border-slate-200/80 rounded-3xl shadow-xl p-4 animate-slide-in backdrop-blur-md max-h-[80vh] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between border-b border-amber-200 pb-2 mb-2.5">
              <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
                <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
                Revisar Solicitud de Reporte
              </span>
              <button 
                onClick={() => {
                  setSelectedSolicitud(null);
                  setIsEditingSolicitud(false);
                }} 
                className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleApproveSolicitud} className="space-y-3">
              
              {/* Coordenadas */}
              <div className="grid grid-cols-2 gap-2 text-[10px] bg-amber-50/50 p-2.5 rounded-xl border border-amber-100">
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-0.5">Latitud</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={selectedSolicitud.lat}
                    onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, lat: parseFloat(e.target.value) || 0 } : null)}
                    className="w-full bg-white border border-amber-200 rounded-lg p-1.5 text-xs text-slate-800 focus:border-amber-400 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-0.5">Longitud</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={selectedSolicitud.lng}
                    onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, lng: parseFloat(e.target.value) || 0 } : null)}
                    className="w-full bg-white border border-amber-200 rounded-lg p-1.5 text-xs text-slate-800 focus:border-amber-400 outline-none"
                    required
                  />
                </div>
              </div>

              {/* Título de la solicitud */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Título / Identificación del Lugar</label>
                <input
                  type="text"
                  value={selectedSolicitud.title}
                  onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, title: e.target.value } : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                  maxLength={100}
                  required
                />
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Descripción de Daños / Detallada</label>
                <textarea
                  value={selectedSolicitud.description}
                  onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, description: e.target.value } : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none h-16 resize-none transition-all"
                  maxLength={1000}
                  required
                />
              </div>

              {/* Capa Temática y Gravedad */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Capa Temática</label>
                  <select
                    value={selectedSolicitud.type}
                    onChange={(e) => {
                      const newType = e.target.value as ReportType;
                      setSelectedSolicitud(prev => {
                        if (!prev) return null;
                        return {
                          ...prev,
                          type: newType,
                          subType: SUB_TYPES_BY_CATEGORY[newType][0].value
                        };
                      });
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                  >
                    <option value="damage_physical">🧱 Físico / Infraestructura</option>
                    <option value="damage_human">❤️ Humano / Salud</option>
                    <option value="need_urgency">🚨 Necesidad / Urgencia</option>
                    <option value="shelter_hub">🟢 Centro de acopio</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nivel Gravedad</label>
                  <select
                    value={selectedSolicitud.severity}
                    onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, severity: e.target.value as SeverityLevel } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                  >
                    <option value="bajo">Bajo (Precaución)</option>
                    <option value="medio">Medio (Atención)</option>
                    <option value="alto">Alto (Grave)</option>
                    <option value="critico">Crítico (Emergencia)</option>
                  </select>
                </div>
              </div>

              {/* Subtipo de Emergencia */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Subtipo de Emergencia</label>
                <select
                  value={selectedSolicitud.subType}
                  onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, subType: e.target.value } : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                >
                  {SUB_TYPES_BY_CATEGORY[selectedSolicitud.type].map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reportador y Teléfono */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Reportado Por</label>
                  <input
                    type="text"
                    value={selectedSolicitud.createdBy}
                    onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, createdBy: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={selectedSolicitud.phone || ''}
                    placeholder="Ej: 999888777"
                    onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, phone: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Estado de Atención */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Estado de Atención</label>
                <select
                  value={selectedSolicitud.status || 'Pendiente'}
                  onChange={(e) => setSelectedSolicitud(prev => prev ? { ...prev, status: e.target.value } : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all cursor-pointer"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En proceso">En proceso</option>
                  <option value="Atendido">Atendido</option>
                </select>
              </div>

              {/* Botones de acción final: "Aprobar y Registrar" y "Denegar Solicitud" */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full py-2 text-xs font-bold rounded-xl text-white shadow-md transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    isSubmitting
                      ? 'bg-slate-500 cursor-not-allowed opacity-75'
                      : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100'
                  }`}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Procesando...' : 'Aprobar y Registrar'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleDenySolicitud}
                  className={`w-full py-2 text-xs font-bold rounded-xl text-red-750 bg-red-50 hover:bg-red-100 border border-red-250 transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Denegar Solicitud
                </button>
              </div>
            </form>
          </div>
        )}

      </main>

      {/* ================= MODAL DE INICIO DE SESIÓN DE ADMINISTRACIÓN (SIMULADO) ================= */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[2000] bg-slate-900/65 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white border border-slate-200/80 rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-fade-in text-left">
            <div className="flex items-center justify-between border-b border-slate-200/85 pb-2.5 mb-4">
              <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-slate-600" />
                Acceso Administrador CAPCORP GIS
              </span>
              <button 
                onClick={() => {
                  setShowLoginModal(false);
                  setPasswordError('');
                  setPasswordInput('');
                }} 
                className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <p className="text-[11px] text-slate-500 leading-normal">
                Para desbloquear las capas dinámicas del geovisor y registrar, editar o eliminar reportes de campo, ingrese la contraseña oficial del CAPCORP Junín.
              </p>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Contraseña del Sistema</label>
                <input
                  type="password"
                  placeholder="Ingrese contraseña"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                  required
                  autoFocus
                />
                {passwordError && (
                  <p className="text-[10px] text-red-500 font-semibold mt-1">{passwordError}</p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isLoadingLogin}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl text-white shadow-sm transition-all cursor-pointer ${
                    isLoadingLogin 
                      ? 'bg-slate-500 cursor-not-allowed opacity-75' 
                      : 'bg-slate-900 hover:bg-slate-850'
                  }`}
                >
                  {isLoadingLogin ? 'Verificando con Supabase...' : 'Confirmar Credencial'}
                </button>
                <button
                  type="button"
                  disabled={isLoadingLogin}
                  onClick={() => {
                    setShowLoginModal(false);
                    setPasswordError('');
                    setPasswordInput('');
                  }}
                  className="px-4 py-2.5 bg-white hover:bg-slate-50 text-xs font-semibold rounded-xl text-slate-700 border border-slate-200 shadow-sm transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
