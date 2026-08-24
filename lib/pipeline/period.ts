import type { DateRange } from './aggregate';

/**
 * ============================================================================
 * SELECTOR DE PERÍODO (Mes / Quarter / Año a la fecha) — Etapa F7, Parte 1
 * ============================================================================
 *
 * Módulo puro (sin UI, sin Supabase) para que las etapas F7 siguientes
 * (scorecards, tendencias) puedan reusar el mismo cálculo de rango sin
 * duplicar aritmética de fechas.
 *
 * ⚠ Todo esto usa UTC explícito (`getUTCFullYear`/`getUTCMonth`/`getUTCDate`,
 * `Date.UTC(...)`), nunca los métodos locales (`getFullYear`/`getMonth`) --
 * regla del proyecto (ver "Fechas — siempre UTC" en la skill
 * forecast-business-rules): el equipo opera en UTC-5, y derivar "hoy" con
 * métodos locales puede desplazar el mes cerca de medianoche según el huso
 * horario del navegador de quien mira la pantalla.
 */

export type PeriodMode = 'month' | 'quarter' | 'ytd';

export interface MonthPeriod {
  mode: 'month';
  year: number;
  /** 1-12. */
  month: number;
}

export interface QuarterPeriod {
  mode: 'quarter';
  year: number;
  /** 1-4. */
  quarter: 1 | 2 | 3 | 4;
}

export interface YtdPeriod {
  mode: 'ytd';
  year: number;
}

export type PeriodSelection = MonthPeriod | QuarterPeriod | YtdPeriod;

const MONTH_NAMES = [
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'hoy' en UTC, como componentes de calendario -- nunca `new Date()` leído con métodos locales. */
export function utcToday(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

/** 1-12 -> 1-4. */
export function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Último día de ese mes-año, calculado en UTC (día 0 del mes siguiente = último día de este). */
function lastDayOfUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Mes en curso (UTC) -- default real del selector, nunca hardcodeado. */
export function getDefaultPeriodSelection(): PeriodSelection {
  const { year, month } = utcToday();
  return { mode: 'month', year, month };
}

/** Quarter en curso (UTC) -- default al cambiar a modo Quarter. */
export function getDefaultQuarterSelection(): QuarterPeriod {
  const { year, month } = utcToday();
  return { mode: 'quarter', year, quarter: quarterOfMonth(month) };
}

/** Año en curso (UTC) -- default al cambiar a modo YTD. */
export function getDefaultYtdSelection(): YtdPeriod {
  const { year } = utcToday();
  return { mode: 'ytd', year };
}

/**
 * Rango de fechas 'YYYY-MM-DD' (inclusive en los dos extremos) para la
 * selección. YTD SIEMPRE corta en "hoy" (UTC) si el año elegido es el año en
 * curso -- "a la fecha" quiere decir eso, no el año completo -- y en el 31 de
 * diciembre si se pidiera un año ya cerrado.
 */
export function periodDateRange(selection: PeriodSelection): DateRange {
  if (selection.mode === 'month') {
    const { year, month } = selection;
    const lastDay = lastDayOfUtcMonth(year, month);
    return { startDate: `${year}-${pad2(month)}-01`, endDate: `${year}-${pad2(month)}-${pad2(lastDay)}` };
  }
  if (selection.mode === 'quarter') {
    const { year, quarter } = selection;
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = lastDayOfUtcMonth(year, endMonth);
    return { startDate: `${year}-${pad2(startMonth)}-01`, endDate: `${year}-${pad2(endMonth)}-${pad2(lastDay)}` };
  }
  const today = utcToday();
  const endDate = selection.year === today.year ? `${today.year}-${pad2(today.month)}-${pad2(today.day)}` : `${selection.year}-12-31`;
  return { startDate: `${selection.year}-01-01`, endDate };
}

/** Texto visible del período, ej. "August 2026", "Q3 2026", "2026 (Year to Date)". */
export function periodLabel(selection: PeriodSelection): string {
  if (selection.mode === 'month') return `${MONTH_NAMES[selection.month - 1]} ${selection.year}`;
  if (selection.mode === 'quarter') return `Q${selection.quarter} ${selection.year}`;
  return `${selection.year} (Year to Date)`;
}

/**
 * Los meses ('YYYY-MM') que cubre la selección -- para resaltar el período
 * elegido DENTRO de una serie más larga (ej. las 12 barras del año en curso
 * de la Parte 3), sin reemplazar esa serie. YTD resalta desde enero hasta
 * el mes en curso (UTC) si el año elegido es el año en curso, o el año
 * completo si es un año ya cerrado -- mismo criterio que `periodDateRange`.
 */
export function periodMonths(selection: PeriodSelection): string[] {
  if (selection.mode === 'month') return [`${selection.year}-${pad2(selection.month)}`];
  if (selection.mode === 'quarter') {
    const startMonth = (selection.quarter - 1) * 3 + 1;
    return [0, 1, 2].map((i) => `${selection.year}-${pad2(startMonth + i)}`);
  }
  const today = utcToday();
  const lastMonth = selection.year === today.year ? today.month : 12;
  return Array.from({ length: lastMonth }, (_, i) => `${selection.year}-${pad2(i + 1)}`);
}
