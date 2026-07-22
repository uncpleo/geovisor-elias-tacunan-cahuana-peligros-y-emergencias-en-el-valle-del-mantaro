export type SeverityLevel = 'bajo' | 'medio' | 'alto' | 'critico';

export type ReportType = 'damage_physical' | 'damage_human' | 'need_urgency' | 'shelter_hub';

export interface Report {
  id: string;
  type: ReportType;
  subType: string;
  title: string;
  description: string;
  severity: SeverityLevel;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  status?: string;
  phone?: string;
}

export interface Epicenter {
  id: string;
  magnitude: number;
  depth: number;
  time: string;
  lat: number;
  lng: number;
  type: 'principal' | 'replica';
}

export interface MapLayerConfig {
  id: string;
  name: string;
  visible: boolean;
  color: string;
  iconName: string;
  description: string;
  count?: number;
}

export interface CentroPoblado {
  id: string;
  nombre: string;
  distrito: string;
  provincia: string;
  lat: number;
  lng: number;
}

export interface SolicitudReporte {
  id: string;
  type: ReportType;
  subType: string;
  title: string;
  description: string;
  severity: SeverityLevel;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  status?: string;
  phone?: string;
  estado_solicitud: 'pendiente' | 'aprobado' | 'denegado';
}

