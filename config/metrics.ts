// Closed set of metrics, so a strict literal union is appropriate here
// (unlike Branch in roster.ts).
export type MetricKey = 'fc' | 'cr' | 'ap' | 'cl';

export interface Metric {
  key: MetricKey;
  label: string;
}

/*
 * Etapa UX1: los labels pasaron a la redacción en inglés que fija el spec
 * (§3A) -- 'Credit_Report' -> 'Credit Reports', 'App date' -> 'App Date'.
 * Solo cambia el texto visible; las keys (fc/cr/ap/cl) y por lo tanto todo el
 * cálculo quedan idénticos.
 *
 * ATENCIÓN: METRICS es fuente única -- estos labels también son los rótulos
 * de fila del Excel exportado (lib/export/sheetBuilders.ts). Es deliberado:
 * se prefirió un solo juego de nombres a duplicar "label de UI" vs "label de
 * export", que se desincronizan sin que nadie lo note.
 */
export const METRICS: Metric[] = [
  { key: 'fc', label: 'File Creations' },
  { key: 'cr', label: 'Credit Reports' },
  { key: 'ap', label: 'App Date' },
  { key: 'cl', label: 'Closed' },
];

export const MONTH_NAMES: string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
