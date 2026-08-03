import { createClient } from '@supabase/supabase-js';
import { Epicenter, Report, ReportType, SeverityLevel, SolicitudReporte } from './types';

// Default Supabase credentials provided by the user
const DEFAULT_SUPABASE_URL = 'https://mowalmwdygnhtjjhkuvk.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_VSWgQ00lVE4wyMVKmNYEyA_-KHtBtVk';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Parses geometry point data from Supabase/PostgREST.
 * Handles GeoJSON Object, Well-Known Text (WKT), or Well-Known Binary (WKB) hex string.
 */
export function parseGeometry(val: any): { lat: number; lng: number } | null {
  if (!val) return null;
  
  // 1. GeoJSON format (standard for PostgREST modern representation of geography/geometry)
  if (typeof val === 'object' && val.coordinates && Array.isArray(val.coordinates)) {
    return {
      lng: Number(val.coordinates[0]),
      lat: Number(val.coordinates[1])
    };
  }
  
  if (typeof val === 'string') {
    // 2. Well-Known Text (WKT) string format e.g. "POINT(-75.2683 -12.1340)"
    if (val.toUpperCase().startsWith('POINT')) {
      const match = val.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
      if (match) {
        return {
          lng: parseFloat(match[1]),
          lat: parseFloat(match[2])
        };
      }
    }
    
    // 3. Well-Known Binary (WKB) hex string representation
    if (/^[0-9a-fA-F]+$/.test(val)) {
      try {
        const bytes = new Uint8Array(val.match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16)));
        const isLittleEndian = bytes[0] === 1;
        const view = new DataView(bytes.buffer);
        
        // Read type (4 bytes at offset 1)
        const type = view.getUint32(1, isLittleEndian);
        const hasSrid = (type & 0x20000000) !== 0;
        const offset = hasSrid ? 9 : 5;
        
        const lng = view.getFloat64(offset, isLittleEndian);
        const lat = view.getFloat64(offset + 8, isLittleEndian);
        
        return { lat, lng };
      } catch (e) {
        console.error('Error parsing WKB geometry:', e);
      }
    }
  }
  
  return null;
}

/**
 * Maps DB Epicenter format to UI Epicenter type
 */
export function mapEpicenter(row: any): Epicenter {
  const coords = parseGeometry(row.ubicacion) || { lat: -12.0672, lng: -75.3125 };
  const magnitude = Number(row.magnitud);
  const type = magnitude >= 4.5 ? 'principal' : 'replica';
  
  return {
    id: String(row.id),
    magnitude,
    depth: Number(row.profundidad_km),
    time: new Date(row.hora_local).toLocaleString('es-PE', { timeZone: 'America/Lima' }) + ' (Hora Local)',
    lat: coords.lat,
    lng: coords.lng,
    type
  };
}

/**
 * Maps DB Report format to UI Report type
 */
export function mapReport(row: any): Report {
  const coords = parseGeometry(row.ubicacion) || { lat: 0, lng: 0 };
  
  // Map DB capa_tipo -> UI ReportType
  let type: ReportType = 'damage_physical';
  if (row.capa_tipo === 'Dano Humano') {
    type = 'damage_human';
  } else if (row.capa_tipo === 'Necesidades') {
    type = 'need_urgency';
  } else if (row.capa_tipo === 'Centro de acopio') {
    type = 'shelter_hub';
  }

  // Map DB nivel_gravedad -> UI SeverityLevel
  const rawSev = String(row.nivel_gravedad || '').toLowerCase().trim();
  let severity: SeverityLevel = 'medio';
  if (rawSev.includes('baj')) {
    severity = 'bajo';
  } else if (rawSev.includes('alt')) {
    severity = 'alto';
  } else if (rawSev.includes('crit') || rawSev.includes('crít')) {
    severity = 'critico';
  } else if (rawSev.includes('med')) {
    severity = 'medio';
  }

  return {
    id: String(row.id),
    type,
    subType: row.subcategoria,
    title: row.identificacion_lugar,
    description: row.descripcion_detallada,
    severity,
    lat: coords.lat,
    lng: coords.lng,
    createdAt: row.fecha_registro,
    updatedAt: row.fecha_registro,
    createdBy: row.brigadista_institucion,
    status: row.estado_atencion,
    phone: row.contacto_telefono
  };
}

/**
 * Maps UI ReportType -> DB capa_tipo
 */
export function uiTypeToDb(type: ReportType): string {
  switch (type) {
    case 'damage_physical': return 'Dano Fisico';
    case 'damage_human': return 'Dano Humano';
    case 'need_urgency': return 'Necesidades';
    case 'shelter_hub': return 'Centro de acopio';
    default: return 'Dano Fisico';
  }
}

/**
 * Maps UI SeverityLevel -> DB nivel_gravedad
 */
export function uiSeverityToDb(severity: SeverityLevel): string {
  switch (severity) {
    case 'bajo': return 'Baja';
    case 'medio': return 'Media';
    case 'alto': return 'Alta';
    case 'critico': return 'Critica';
    default: return 'Media';
  }
}

/**
 * Maps DB Solicitud format to UI SolicitudReporte type
 */
export function mapSolicitud(row: any): SolicitudReporte {
  const baseReport = mapReport(row);
  return {
    ...baseReport,
    estado_solicitud: row.estado_solicitud || 'pendiente'
  };
}

/**
 * Fetches GeoJSON cartographic layers from Supabase tables:
 * public.departamentos (coddep, departamento, geom)
 * public.provincias (codprov_full, coddep, provincia, capital, geom)
 * public.distritos (ubigeo, codprov_full, distrito, capital, coddist, geom)
 */
export async function fetchCartographicLayer(level: '1' | '2' | '3' | 'departamental' | 'provincial' | 'distrital') {
  let tableName = 'distritos';
  let fields = 'ubigeo, codprov_full, distrito, capital, coddist, geom';
  
  if (level === '1' || level === 'departamental') {
    tableName = 'departamentos';
    fields = 'coddep, departamento, geom';
  } else if (level === '2' || level === 'provincial') {
    tableName = 'provincias';
    fields = 'codprov_full, coddep, provincia, capital, geom';
  } else {
    tableName = 'distritos';
    fields = 'ubigeo, codprov_full, distrito, capital, coddist, geom';
  }

  try {
    const { data, error } = await supabase.from(tableName).select(fields);
    if (error || !data || data.length === 0) {
      console.warn(`[Supabase GIS] No data in table ${tableName}:`, error?.message || 'Tabla vacía o sin registros');
      return null;
    }

    const features = data.map((row: any) => {
      let geometry = row.geom;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch (e) {
          // If geometry string is WKT or other format, keep raw
        }
      }
      
      const { geom, ...properties } = row;
      return {
        type: 'Feature' as const,
        geometry,
        properties
      };
    }).filter(f => f.geometry && typeof f.geometry === 'object');

    if (features.length === 0) return null;

    return {
      tableName,
      geoJson: {
        type: 'FeatureCollection' as const,
        features
      }
    };
  } catch (err) {
    console.error(`[Supabase GIS] Error querying ${tableName}:`, err);
    return null;
  }
}


