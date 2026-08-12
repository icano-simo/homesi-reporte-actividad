// ============================================================
// Etapa S1 — cuándo generó Salesforce el export, no cuándo se subió.
// ============================================================
//
// `app/api/pipeline/parse/route.ts` guardaba `snapshot_date` como
// `new Date().toISOString().slice(0,10)` -- la fecha de subida, no la del
// dato. Evidencia real (docs/ARQUITECTURA.md, snapshots 9 y 11): un mismo
// export del 30 de julio subido el 3 de agosto quedó archivado como si fuera
// del 3 de agosto. Los dos formatos de nombre de archivo en uso ya codifican
// el instante real -- este módulo lo extrae, sin inventar nada cuando no
// puede.

export type DataAsOfSource = 'filename_epoch' | 'filename_label' | 'unknown';

/** Formato A: `report<13 dígitos>.xls` -- los dígitos son epoch ms UTC. */
const EPOCH_FILENAME_RE = /^report(\d{13})\.xls$/i;

/**
 * Formato B: `Forecast - Pipeline Report-YYYY-MM-DD-HH-MM-SS.xlsx`, sello en
 * hora LOCAL America/Chicago (no UTC). Puede traer un sufijo de descarga
 * duplicada (" (1)", " (2)"...) antes de la extensión.
 */
const LABEL_FILENAME_RE =
  /^Forecast - Pipeline Report-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})(?: \(\d+\))?\.xlsx$/i;

const MIN_SANE_MS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Fuera de este rango, el nombre de archivo no es confiable (typo, reloj de
 * cliente desincronizado, archivo de prueba, etc.) -- se prefiere `null`
 * explícito a propagar una fecha absurda. Ver regla dura del brief: nunca
 * caer a `new Date()` como fallback silencioso, que es el bug que esto
 * arregla.
 */
function isSane(date: Date): boolean {
  const t = date.getTime();
  return !Number.isNaN(t) && t >= MIN_SANE_MS && t <= Date.now() + MAX_FUTURE_SLACK_MS;
}

/** Componentes de un instante UTC vistos como hora local en America/Chicago. */
function chicagoParts(date: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  // Algunos motores devuelven "24" para medianoche con hour12:false en vez de "00".
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/**
 * America/Chicago no tiene un offset fijo (CDT = UTC-5 en horario de verano,
 * CST = UTC-6 en invierno) y el brief pide no instalar una librería de zonas
 * horarias solo para esto. Se resuelve por búsqueda determinista: se prueban
 * los 2 offsets posibles y se queda con el que, formateado de vuelta a hora
 * de Chicago, reproduce exactamente el sello local del nombre de archivo.
 * No maneja la hora exacta del cambio de horario (2AM del cambio, ambigua u
 * omitida por definición) -- fuera de alcance, no hay archivos reales ahí.
 */
function chicagoLocalToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  for (const offsetHours of [5, 6]) {
    const candidate = new Date(Date.UTC(y, mo - 1, d, h, mi, s) + offsetHours * 3_600_000);
    const back = chicagoParts(candidate);
    if (back.y === y && back.mo === mo && back.d === d && back.h === h && back.mi === mi && back.s === s) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extrae de `file_name` el instante en que Salesforce generó el export.
 * `dataAsOf === null` y `source === 'unknown'` van siempre juntos: si no se
 * puede confiar en la fecha, no hay fuente que reportar.
 */
export function parseDataAsOf(fileName: string): { dataAsOf: Date | null; source: DataAsOfSource } {
  const epochMatch = fileName.match(EPOCH_FILENAME_RE);
  if (epochMatch) {
    const date = new Date(Number(epochMatch[1]));
    if (isSane(date)) return { dataAsOf: date, source: 'filename_epoch' };
    return { dataAsOf: null, source: 'unknown' };
  }

  const labelMatch = fileName.match(LABEL_FILENAME_RE);
  if (labelMatch) {
    const [, yStr, moStr, dStr, hStr, miStr, sStr] = labelMatch;
    const date = chicagoLocalToUtc(Number(yStr), Number(moStr), Number(dStr), Number(hStr), Number(miStr), Number(sStr));
    if (date && isSane(date)) return { dataAsOf: date, source: 'filename_label' };
    return { dataAsOf: null, source: 'unknown' };
  }

  return { dataAsOf: null, source: 'unknown' };
}
