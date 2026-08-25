import type { ResolvedLoan } from './types';
import { utcToday } from './period';

/**
 * ============================================================================
 * TENDENCIAS MENSUALES DEL AÑO EN CURSO — Etapa F7, Parte 3
 * ============================================================================
 *
 * Solo lectura sobre `pipeline_resolved_loans` (`status === 'funded'`) --
 * no depende de `org` ni de resolución de alias, a diferencia de la Parte 2.
 *
 * ⚠ `disbursementDate` ya es un string 'YYYY-MM-DD' (nunca un objeto Date) --
 * agrupar por mes es `slice(0, 7)`, sin construir ningún `new Date(...)` ni
 * leer componentes locales/UTC de una fecha. Esto es justo lo que evita el
 * bug que la regla "siempre UTC" previene (desplazar un cierre de fin de mes
 * al mes siguiente por husos horarios): no hay conversión de zona horaria
 * posible cuando nunca se pasa por un objeto Date. `utcToday()` (de
 * `lib/pipeline/period.ts`, mismo criterio ya establecido en la Parte 1) es
 * lo único que sí necesita UTC explícito -- para saber cuál es el "año en
 * curso" a partir del reloj del sistema.
 */

export interface MonthlyTotal {
  /** 'YYYY-MM'. */
  month: string;
  count: number;
  amount: number;
}

export interface MonthlyTypeBreakdown {
  /** 'YYYY-MM'. */
  month: string;
  byType: { label: string; count: number; amount: number }[];
}

/** Los 12 meses ('YYYY-MM') de ese año, en orden -- el eje completo, exista o no un solo loan en cada uno. */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/** Año en curso (UTC) -- el que usa la serie por defecto. */
export function currentYear(): number {
  return utcToday().year;
}

/**
 * Cierres + monto por mes, para TODOS los 12 meses del año -- los que no
 * tengan ningún loan quedan en `count: 0, amount: 0` explícito, nunca
 * ausentes del array (el caller nunca tiene que adivinar si un mes falta
 * porque no hubo datos o porque se omitió por error).
 */
export function buildMonthlyTotals(loans: ResolvedLoan[], year: number): MonthlyTotal[] {
  const byMonth = new Map<string, { count: number; amount: number }>();
  const yearPrefix = String(year) + '-';
  for (const loan of loans) {
    if (loan.status !== 'funded' || !loan.disbursementDate.startsWith(yearPrefix)) continue;
    const month = loan.disbursementDate.slice(0, 7);
    const cur = byMonth.get(month) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += loan.amount;
    byMonth.set(month, cur);
  }
  return monthsOfYear(year).map((month) => {
    const v = byMonth.get(month) ?? { count: 0, amount: 0 };
    return { month, count: v.count, amount: v.amount };
  });
}

export interface MonthlyAvgTicket {
  /** 'YYYY-MM'. */
  month: string;
  /** amount/count del mes -- 0 si el mes no tiene ningún loan (nunca NaN/división por cero). */
  avgAmount: number;
}

/**
 * Ticket promedio por mes -- Etapa F7, Parte 15. Recibe el `MonthlyTotal[]`
 * YA calculado por `buildMonthlyTotals` (el mismo array que ya usan
 * Closings/Amount by Month en `TabAnalytics.tsx`) -- no vuelve a leer
 * `loans` ni recalcula `count`/`amount`, solo divide, con la misma guarda
 * contra división por cero que ya usa `ScorecardRow.avgAmount`
 * (`lib/pipeline/scorecards.ts`, `toRows()`): `count > 0 ? amount/count :
 * 0`. Un mes sin datos (ej. un mes futuro) queda en `avgAmount: 0`
 * explícito, mismo criterio que el resto de esta serie -- nunca se omite
 * ni se calcula un promedio indefinido.
 */
export function avgTicketByMonth(totals: MonthlyTotal[]): MonthlyAvgTicket[] {
  return totals.map((m) => ({
    month: m.month,
    avgAmount: m.count > 0 ? m.amount / m.count : 0,
  }));
}

/** Mismo criterio que buildMonthlyTotals, desglosado por loan_type dentro de cada mes -- vacío -> "Sin tipo", mismo placeholder que analytics.ts. */
export function buildMonthlyTypeBreakdown(loans: ResolvedLoan[], year: number): MonthlyTypeBreakdown[] {
  const byMonth = new Map<string, Map<string, { count: number; amount: number }>>();
  const yearPrefix = String(year) + '-';
  for (const loan of loans) {
    if (loan.status !== 'funded' || !loan.disbursementDate.startsWith(yearPrefix)) continue;
    const month = loan.disbursementDate.slice(0, 7);
    const label = loan.loanType.trim() || 'Sin tipo';
    const byType = byMonth.get(month) ?? new Map<string, { count: number; amount: number }>();
    const cur = byType.get(label) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += loan.amount;
    byType.set(label, cur);
    byMonth.set(month, byType);
  }
  return monthsOfYear(year).map((month) => {
    const byType = byMonth.get(month);
    const rows = byType ? [...byType.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count) : [];
    return { month, byType: rows };
  });
}
