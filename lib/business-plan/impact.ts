import type { ActivityMetrics } from './types';

/**
 * ============================================================================
 * IMPACTO DEL BUSINESS PLAN — antes contra después
 * ============================================================================
 *
 * Etapa BP22 — ARCHIVO NUEVO. Funciones puras, sin base ni React: la decisión
 * de qué mes cuenta de qué lado es la parte que hay que poder revisar sin
 * levantar la app.
 *
 * ---------------------------------------------------------------------------
 * ⚠ TRES ESTADOS DE MES, NO DOS
 * ---------------------------------------------------------------------------
 * La tentación es partir la línea de tiempo en dos, antes y después. Está mal
 * dos veces:
 *
 *   1. EL MES DE ENROLAMIENTO ESTÁ PARTIDO. Ana Peña se enroló el 14 de agosto:
 *      la mitad de la producción de ese mes es anterior al plan. Contarlo como
 *      "después" atribuiría al plan lo que pasó antes de que existiera, y
 *      contarlo como "antes" haría lo contrario.
 *
 *   2. EL MES EN CURSO NO TERMINÓ. Compararlo contra un promedio de meses
 *      enteros da una caída garantizada el día 3 de cada mes. Es el mismo
 *      problema que ya tiene el Qualifier 2, y acá se evita del todo: sólo
 *      cuentan los meses COMPLETOS posteriores al de enrolamiento.
 *
 * Con los dos planes de hoy -- activados el 14 de agosto de 2026 -- eso deja
 * CERO meses del lado del después. La pantalla lo dice en vez de mostrar un
 * −100% falso.
 */

export type MonthPhase =
  /** Anterior al enrolamiento. Puede o no estar en la línea base. */
  | 'before'
  /** El mes del enrolamiento: partido, no cuenta de ningún lado. */
  | 'partial'
  /** Completo y posterior: es lo que mide el plan. */
  | 'after'
  /** El mes en curso, sin terminar. Se dibuja, no se promedia. */
  | 'running'
  /**
   * ⚠ Todavía no ocurrió. Existe porque el gráfico dibuja los DOCE meses del
   * año y hoy es agosto: sin este estado, septiembre a diciembre entraban como
   * 'after' con cero cierres cada uno, y el promedio del después daba 0 sobre
   * cuatro meses que no pasaron -- un −100% inventado, exactamente lo que esta
   * pantalla existe para no hacer. Se dibuja el hueco y no se promedia.
   */
  | 'future';

/** Las cuatro métricas que se comparan, siempre en el mismo orden. */
export type MetricKey = 'closings' | 'creditApplications' | 'preApprovals' | 'fileCreations';

export const METRIC_LABEL: Record<MetricKey, string> = {
  closings: 'Closings',
  creditApplications: 'Credit applications',
  preApprovals: 'Pre-approvals',
  fileCreations: 'File creations',
};

export interface MetricAverages {
  closings: number;
  creditApplications: number;
  preApprovals: number;
  fileCreations: number;
}

/** La foto congelada, tal como la devuelve la base. */
export interface Baseline extends MetricAverages {
  enrollmentKey: number;
  baselineMonths: string[];
  enrollmentMonth: string;
  source: 'captured' | 'reconstructed';
  capturedAt: string;
}

/** 'YYYY-MM' de una fecha ISO. La activación se guarda como timestamptz. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Los `count` meses completos inmediatamente anteriores a `month`.
 *
 * Se opera sobre la cadena y no sobre `Date` a propósito: `new Date('2026-08')`
 * se interpreta como UTC y en husos al oeste devuelve julio. Es el clásico
 * error de mes corrido, y acá cambiaría la línea base entera.
 */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return Math.floor(total / 12) + '-' + String((total % 12) + 1).padStart(2, '0');
}

export function monthsBefore(month: string, count: number): string[] {
  const out: string[] = [];
  for (let back = count; back >= 1; back--) out.push(addMonths(month, -back));
  return out;
}

/** En qué lado de la línea cae un mes. Ver el comentario de la cabecera. */
export function phaseOf(month: string, enrollmentMonth: string, currentMonth: string): MonthPhase {
  if (month === enrollmentMonth) return 'partial';
  if (month === currentMonth) return 'running';
  /* El futuro se descarta ANTES de mirar el enrolamiento: un mes posterior al
     actual nunca es "después del plan", es un mes que no existe todavía. */
  if (month > currentMonth) return 'future';
  return month < enrollmentMonth ? 'before' : 'after';
}

/**
 * Los meses que cuentan como "después": completos y posteriores al de
 * enrolamiento. Vacío mientras no haya pasado ninguno, que es el caso de hoy.
 */
export function completeMonthsAfter(months: string[], enrollmentMonth: string, currentMonth: string): string[] {
  return months.filter((m) => phaseOf(m, enrollmentMonth, currentMonth) === 'after');
}

/** El primer mes que va a poder medirse. Se muestra cuando todavía no hay. */
export function firstMeasurableMonth(enrollmentMonth: string): string {
  return addMonths(enrollmentMonth, 1);
}

/**
 * Promedio mensual de las cuatro métricas sobre un conjunto de meses.
 *
 * ⚠ Divide por la CANTIDAD DE MESES, no por los meses con dato. Un mes sin un
 * solo cierre es un cero que tiene que pesar: saltearlo convertiría a alguien
 * que cerró 3 en un mes y nada en otros dos en un promedio de 3, que es
 * exactamente al revés de lo que pasó.
 */
export function averageOver(activity: ActivityMetrics, months: string[]): MetricAverages {
  const n = months.length;
  if (n === 0) return { closings: 0, creditApplications: 0, preApprovals: 0, fileCreations: 0 };
  const sum = (rec: Record<string, number>) => months.reduce((acc, m) => acc + (rec[m] ?? 0), 0);
  return {
    closings: sum(activity.closingsByMonth) / n,
    creditApplications: sum(activity.applicationsByMonth) / n,
    preApprovals: sum(activity.creditReportsByMonth) / n,
    fileCreations: sum(activity.filesByMonth) / n,
  };
}

/** La serie mensual de una métrica, para el gráfico. */
export function seriesOf(activity: ActivityMetrics, metric: MetricKey): Record<string, number> {
  switch (metric) {
    case 'closings':
      return activity.closingsByMonth;
    case 'creditApplications':
      return activity.applicationsByMonth;
    case 'preApprovals':
      return activity.creditReportsByMonth;
    case 'fileCreations':
      return activity.filesByMonth;
  }
}

/**
 * Variación porcentual del antes al después.
 *
 * `null` cuando la base es cero, y no cero ni infinito: pasar de 0 a 3 no es
 * "+300%" ni "sin cambio" -- es una división indefinida, y cualquier número que
 * se muestre ahí es inventado. La pantalla escribe "no baseline" en su lugar.
 */
export function pctChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}

/** Con un decimal y signo explícito. El "+" importa: sin él, +2 y −2 se leen igual de rápido. */
export function fmtPct(pct: number | null): string {
  if (pct === null) return '—';
  return (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
}
