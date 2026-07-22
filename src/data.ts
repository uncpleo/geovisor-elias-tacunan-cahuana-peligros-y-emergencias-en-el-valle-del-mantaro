import { Epicenter, Report } from './types';

// Epicentros de los sismos ocurridos el 18 de Julio de 2026 en Chupaca, Junín
export const OFFICIAL_EPICENTERS: Epicenter[] = [
  {
    id: 'epi_principal',
    magnitude: 5.1,
    depth: 15,
    time: '2026-07-18 15:42:10 (Hora Local)',
    lat: -12.0672,
    lng: -75.3125,
    type: 'principal',
  },
  {
    id: 'epi_replica',
    magnitude: 3.4,
    depth: 12,
    time: '2026-07-18 16:15:45 (Hora Local)',
    lat: -12.0815,
    lng: -75.3281,
    type: 'replica',
  }
];

// Reportes iniciales precargados (Semilla para que el mapa no se vea vacío)
export const INITIAL_REPORTS: Report[] = [
  {
    id: 'rep_1',
    type: 'damage_physical',
    subType: 'vivienda_colapsada',
    title: 'Vivienda de Adobe Colapsada - Jr. Bolognesi',
    description: 'Vivienda multifamiliar de adobe de dos niveles con colapso de pared frontal y desprendimiento de techo de tejas. La familia de 4 personas fue evacuada al centro comunal.',
    severity: 'critico',
    lat: -12.0652,
    lng: -75.3082,
    createdAt: '2026-07-18T16:10:00.000Z',
    updatedAt: '2026-07-18T16:10:00.000Z',
    createdBy: 'COER Junín'
  },
  {
    id: 'rep_2',
    type: 'damage_physical',
    subType: 'via_bloqueada',
    title: 'Derrumbe en Carretera Chupaca-Ahuac Km 4',
    description: 'Caída de rocas de gran volumen y lodo bloquea por completo la calzada en el kilómetro 4. No hay paso de vehículos. Se requiere urgente maquinaria pesada del Gobierno Regional.',
    severity: 'alto',
    lat: -12.0545,
    lng: -75.3312,
    createdAt: '2026-07-18T16:30:00.000Z',
    updatedAt: '2026-07-18T17:15:00.000Z',
    createdBy: 'Muni Chupaca'
  },
  {
    id: 'rep_3',
    type: 'damage_human',
    subType: 'heridos',
    title: '3 Heridos por Caída de Muro en Ahuac',
    description: 'Tres pobladores heridos con policontusiones leves y cortes debido a la caída de un muro perimétrico de tapial. Trasladados al Centro de Salud Chupaca. Reporte oficial de salud.',
    severity: 'medio',
    lat: -12.0592,
    lng: -75.3418,
    createdAt: '2026-07-18T16:22:00.000Z',
    updatedAt: '2026-07-18T16:22:00.000Z',
    createdBy: 'MINSA Chupaca'
  },
  {
    id: 'rep_4',
    type: 'need_urgency',
    subType: 'carpas_abrigo',
    title: 'Necesidad Crítica de Carpas - Vista Alegre',
    description: 'El anexo de Vista Alegre registra 8 viviendas inhabitables. Los pobladores pernoctan a la intemperie bajo un toldo improvisado debido a bajas temperaturas nocturnas y temor a más réplicas.',
    severity: 'critico',
    lat: -12.0725,
    lng: -75.3195,
    createdAt: '2026-07-18T18:05:00.000Z',
    updatedAt: '2026-07-18T18:05:00.000Z',
    createdBy: 'INDECI Chupaca'
  },
  {
    id: 'rep_5',
    type: 'damage_physical',
    subType: 'colegio_afectado',
    title: 'Fisuras Estructurales en I.E. 19 de Abril',
    description: 'Fisuras severas en columnas y asentamiento menor del pabellón principal. Se sugiere declarar aulas inhabitables antes del retorno a clases presenciales.',
    severity: 'alto',
    lat: -12.0618,
    lng: -75.3142,
    createdAt: '2026-07-18T17:40:00.000Z',
    updatedAt: '2026-07-18T17:40:00.000Z',
    createdBy: 'UGEL Chupaca'
  },
  {
    id: 'rep_6',
    type: 'need_urgency',
    subType: 'agua_alimentos',
    title: 'Rotura de Red de Agua en Barrio La Libertad',
    description: 'Sismo ocasionó fractura en la tubería principal de 4 pulgadas de agua potable. Más de 120 familias desabastecidas. Se requiere envío inmediato de camión cisterna.',
    severity: 'alto',
    lat: -12.0681,
    lng: -75.3015,
    createdAt: '2026-07-18T18:50:00.000Z',
    updatedAt: '2026-07-18T18:50:00.000Z',
    createdBy: 'INDECI Junín'
  },
  {
    id: 'rep_7',
    type: 'shelter_hub',
    subType: 'alimentos_agua',
    title: 'Centro de Acopio Estadio Municipal de Chupaca',
    description: 'Punto de recolección oficial de agua embotellada, alimentos no perecederos y frazadas. Coordinado por la Gerencia de Desarrollo Social de la Municipalidad de Chupaca.',
    severity: 'bajo',
    lat: -12.0645,
    lng: -75.3135,
    createdAt: '2026-07-18T19:00:00.000Z',
    updatedAt: '2026-07-18T19:00:00.000Z',
    createdBy: 'Muni Chupaca'
  }
];

// Capa 1: GeoJSON simplificado de Delimitación Distrital de la Provincia de Chupaca
export const JUNIN_DISTRICTS_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'dist_chupaca',
      properties: {
        id: 'dist_chupaca',
        nombre: 'Distrito de Chupaca',
        provincia: 'Chupaca',
        departamento: 'Junín',
        poblacion: '22,500 hab.',
        area: '102.1 km²',
        gravedad: 'Alto',
        color: '#f43f5e'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-75.3300, -12.0450],
            [-75.2950, -12.0450],
            [-75.2950, -12.0750],
            [-75.3300, -12.0750],
            [-75.3300, -12.0450]
          ]
        ]
      }
    },
    {
      type: 'Feature',
      id: 'dist_ahuac',
      properties: {
        id: 'dist_ahuac',
        nombre: 'Distrito de Ahuac',
        provincia: 'Chupaca',
        departamento: 'Junín',
        poblacion: '6,800 hab.',
        area: '72.5 km²',
        gravedad: 'Medio-Alto',
        color: '#f59e0b'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-75.3650, -12.0450],
            [-75.3300, -12.0450],
            [-75.3300, -12.0800],
            [-75.3650, -12.0800],
            [-75.3650, -12.0450]
          ]
        ]
      }
    },
    {
      type: 'Feature',
      id: 'dist_tres_dic',
      properties: {
        id: 'dist_tres_dic',
        nombre: 'Distrito de 3 de Diciembre',
        provincia: 'Chupaca',
        departamento: 'Junín',
        poblacion: '2,100 hab.',
        area: '48.2 km²',
        gravedad: 'Bajo-Medio',
        color: '#10b981'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-75.2950, -12.0750],
            [-75.2800, -12.0750],
            [-75.2800, -12.1000],
            [-75.3100, -12.1000],
            [-75.3100, -12.0900],
            [-75.2950, -12.0750]
          ]
        ]
      }
    },
    {
      type: 'Feature',
      id: 'dist_huamancaca',
      properties: {
        id: 'dist_huamancaca',
        nombre: 'Distrito de Huamancaca Chico',
        provincia: 'Chupaca',
        departamento: 'Junín',
        poblacion: '5,400 hab.',
        area: '15.8 km²',
        gravedad: 'Medio',
        color: '#f59e0b'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-75.2950, -12.0450],
            [-75.2800, -12.0450],
            [-75.2800, -12.0750],
            [-75.2950, -12.0750],
            [-75.2950, -12.0450]
          ]
        ]
      }
    },
    {
      type: 'Feature',
      id: 'dist_huancayo_border',
      properties: {
        id: 'dist_huancayo_border',
        nombre: 'Distrito de Huancayo (Zona Frontera)',
        provincia: 'Huancayo',
        departamento: 'Junín',
        poblacion: '118,000 hab.',
        area: '237.5 km²',
        gravedad: 'Bajo',
        color: '#10b981'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-75.2800, -12.0400],
            [-75.2400, -12.0400],
            [-75.2400, -12.0900],
            [-75.2800, -12.0900],
            [-75.2800, -12.0400]
          ]
        ]
      }
    }
  ]
};

// Sub-tipos por Categoría
export const SUB_TYPES_BY_CATEGORY = {
  damage_physical: [
    { value: 'vivienda_colapsada', label: '🏠 Vivienda Colapsada' },
    { value: 'vivienda_afectada', label: '🏚️ Vivienda Afectada' },
    { value: 'via_bloqueada', label: '🚧 Vía Bloqueada / Derrumbe' },
    { value: 'colegio_afectado', label: '🏫 Institución Educativa Afectada' },
    { value: 'salud_afectado', label: '🏥 Centro de Salud Afectado' },
    { value: 'otros', label: '📦 Otros Daños Físicos' }
  ],
  damage_human: [
    { value: 'heridos', label: '🚑 Personas Heridas' },
    { value: 'damnificados', label: '👥 Familias Damnificadas' },
    { value: 'desaparecidos', label: '🔍 Desaparecidos' },
    { value: 'otros_humanos', label: '⚠️ Otros Afectados' }
  ],
  need_urgency: [
    { value: 'carpas_abrigo', label: '⛺ Carpas y Frazadas' },
    { value: 'agua_alimentos', label: '💧 Agua y Alimentos' },
    { value: 'herramientas', label: '🛠️ Palas, Picos y Herramientas' },
    { value: 'atencion_medica', label: '🩺 Kits Médicos / Primeros Auxilios' },
    { value: 'otros_necesidades', label: '🚨 Otras Necesidades' }
  ],
  shelter_hub: [
    { value: 'alimentos_agua', label: '🥫 Alimentos y Agua' },
    { value: 'ropa_abrigo', label: '👕 Ropa y Abrigo' },
    { value: 'medicinas_insumos', label: '💊 Medicinas e Insumos Médicos' },
    { value: 'herramientas_materiales', label: '🔧 Herramientas / Materiales' },
    { value: 'general', label: '📦 General' }
  ]
};
