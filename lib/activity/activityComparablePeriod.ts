import type { YearMonth } from '@/lib/parsing/types';
import type { LoanRecord } from '@/lib/domain/types';
import type { DaysToCloseLoanResult } from '@/lib/activity/daysToClosePivotCells';

/**
 * ============================================================================
 * "PERÍODO ANTERIOR COMPARABLE" PARA EL FILTRO Year + Month mode — Etapa
 * ACTIVITY-KPI-1
 * ============================================================================
 *
 * `TabAnalytics.tsx` ya resuelve este problema para su propio filtro
 * (`PeriodSelection`: Month/Quarter/YTD, un RANGO de fechas continuo) --
 * `currentPeriodProgress()`/`previousPeriodComparison()`/`buildComparison()`
 * de ese archivo. Acá el filtro es OTRO (`useYearMonthFilter`: Year +
 * Current/Last 3/Pick a Month, una LISTA de hasta 3 meses discretos, no un
 * rango) -- el mecanismo de TabAnalytics no calza 1:1 porque no hay un
 * `PeriodSelection` que describir, sólo un array de `YearMonth`. Este
 * archivo es la adaptación de ESE mecanismo a ESTE filtro, no una copia.
 *
 * La adaptación, en una frase: **la ventana anterior es el mismo número de
 * meses calendario, inmediatamente antes del más antiguo de los mostrados
 * -- y si el mes MÁS RECIENTE mostrado es el mes calendario real de hoy
 * (está "en curso"), su análogo en la ventana anterior se capa a los
 * mismos N días transcurridos**, igual que el capado día-a-día de
 * TabAnalytics, pero aplicado sólo a UN mes límite (el resto de la
 * ventana, si `monthsToShow` tiene más de 1 mes, son meses ya cerrados y
 * se usan completos en los 2 lados).
 *
 * ⚠ Simplificación deliberada frente al mecanismo de TabAnalytics: acá NO
 * se intenta capar día-a-día una ventana de VARIOS meses en curso a la
 * vez -- sólo el mes límite (el más reciente de `monthsToShow`) puede
 * estar en curso, porque `useYearMonthFilter` nunca deja "en curso" más
 * que ESE único mes (`'current'` muestra 1 solo mes; `'last3'` es una
 * ventana rodante de meses YA con datos, así que sólo el último de los 3
 * puede seguir sumando cierres hoy). Explicado en el reporte de esta
 * etapa, no escondido.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** '2026-07' desplazado `deltaMonths` meses calendario (puede ser negativo). Aritmética entera pura, sin `Date`. */
export function shiftYearMonth(ym: YearMonth, deltaMonths: number): YearMonth {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${pad2(newM)}`;
}

/** Día del mes (UTC explícito, nunca `Date` local) -- mismo criterio del resto del proyecto para "hoy". */
function todayUTC(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

export interface ComparableWindow {
  /** Meses de esta ventana que se usan COMPLETOS, sin capar. */
  monthsFull: YearMonth[];
  /** El único mes de la ventana que puede necesitar capado por día -- `null` si la ventana no lo necesita. */
  cappedMonth: YearMonth | null;
  /** Día del mes (1-based, inclusive) hasta el cual se cuenta `cappedMonth`. `null` si `cappedMonth` es `null`. */
  cappedThroughDay: number | null;
}

export interface ComparablePeriod {
  currentWindow: ComparableWindow;
  previousWindow: ComparableWindow;
  /** `true` si el mes más reciente de `monthsToShow` es el mes calendario real de hoy (UTC) -- dispara el capado del análogo anterior. */
  inProgress: boolean;
}

/**
 * `monthsToShow` -- SIEMPRE ascendente (así lo devuelve `useYearMonthFilter`:
 * `monthsForYear` ya viene ordenado y `.slice(-N)`/`[picked]` preservan ese
 * orden). Vacío -- sin período que comparar -- da 2 ventanas vacías.
 */
export function computeComparablePeriod(monthsToShow: YearMonth[]): ComparablePeriod {
  if (monthsToShow.length === 0) {
    return {
      currentWindow: { monthsFull: [], cappedMonth: null, cappedThroughDay: null },
      previousWindow: { monthsFull: [], cappedMonth: null, cappedThroughDay: null },
      inProgress: false,
    };
  }

  const windowSize = monthsToShow.length;
  const earliestShown = monthsToShow[0];
  const mostRecentShown = monthsToShow[monthsToShow.length - 1];

  const previousMonths = Array.from({ length: windowSize }, (_, i) => shiftYearMonth(earliestShown, -(windowSize - i)));

  const today = todayUTC();
  const todayYM = `${today.year}-${pad2(today.month)}`;
  const inProgress = mostRecentShown === todayYM;

  if (!inProgress) {
    return {
      currentWindow: { monthsFull: monthsToShow, cappedMonth: null, cappedThroughDay: null },
      previousWindow: { monthsFull: previousMonths, cappedMonth: null, cappedThroughDay: null },
      inProgress: false,
    };
  }

  const cappedMonth = previousMonths[previousMonths.length - 1];
  const previousMonthsFull = previousMonths.slice(0, -1);
  return {
    currentWindow: { monthsFull: monthsToShow, cappedMonth: null, cappedThroughDay: null },
    previousWindow: { monthsFull: previousMonthsFull, cappedMonth, cappedThroughDay: today.day },
    inProgress: true,
  };
}

/** 'YYYY-MM' -> 'Jul 2026'. */
function monthYearLabel(ym: YearMonth, monthNames: readonly string[]): string {
  const [y, m] = ym.split('-');
  return `${monthNames[Number(m) - 1]} ${y}`;
}

/** Etiqueta legible de una `ComparableWindow`, para la línea "vs {label}" del `DeltaBadge`. */
export function comparableWindowLabel(window: ComparableWindow, monthNames: readonly string[]): string {
  const all = [...window.monthsFull, ...(window.cappedMonth ? [window.cappedMonth] : [])].sort((a, b) => a.localeCompare(b));
  if (all.length === 0) return 'no prior data';
  const first = monthYearLabel(all[0], monthNames);
  const last = monthYearLabel(all[all.length - 1], monthNames);
  const base = all.length === 1 ? first : `${first} – ${last}`;
  if (window.cappedMonth === null || window.cappedThroughDay === null) return base;
  return all.length === 1
    ? `first ${window.cappedThroughDay} day${window.cappedThroughDay === 1 ? '' : 's'} of ${first}`
    : `${base} (${monthYearLabel(window.cappedMonth, monthNames)} capped to its first ${window.cappedThroughDay} day${window.cappedThroughDay === 1 ? '' : 's'})`;
}

function isWithinWindow(month: YearMonth, closingDateISO: string | null, window: ComparableWindow): boolean {
  if (window.monthsFull.includes(month)) return true;
  if (window.cappedMonth !== null && month === window.cappedMonth && window.cappedThroughDay !== null) {
    if (closingDateISO === null) return false;
    const day = Number(closingDateISO.slice(8, 10));
    return day <= window.cappedThroughDay;
  }
  return false;
}

export interface DurationWindowSummary {
  avgAppToCtc: number | null;
  countAppToCtc: number;
  avgCtcToDisbursement: number | null;
  countCtcToDisbursement: number;
  /** Préstamos elegibles en la ventana -- misma población que alimenta el pivot (`loanInfoChannel === 'Banked - Retail' && closingMonth !== null`), independiente de si resolvieron alguno de los 2 tramos. */
  closedLoansCount: number;
}

/**
 * Resume `loanResults` (el array por préstamo que ya produce
 * `buildDaysToClosePivot`, guardado en `pivotLoanResults` -- SIN volver a
 * llamar la RPC) sobre una `ComparableWindow`, COLAPSANDO mes Y groupKey
 * -- a diferencia de `aggregateDaysToCloseCells` (que agrupa por
 * `groupKey × month`, para construir el pivot), acá hace falta UN sólo
 * total combinado por ventana, aunque la ventana abarque 2-3 meses
 * ('last3'). Mismo criterio de conteos INDEPENDIENTES por tramo que ya
 * documenta `daysToClosePivotCells.ts` -- un préstamo puede aportar a
 * `avgAppToCtc` y no a `avgCtcToDisbursement`, o viceversa.
 *
 * `closingDateByLoanNumber` -- necesaria SÓLO para el mes capado
 * (`window.cappedMonth`): `DaysToCloseLoanResult` no lleva `closingDate`
 * (sólo `month`), así que el día exacto de cierre se busca en el mapa
 * loanNumber -> `LoanRecord` que la página ya arma (`dtcRecordsByLoanNumber`)
 * -- ninguna estructura nueva, se reusa la que ya existe.
 */
export function summarizeDurationWindow(
  loanResults: DaysToCloseLoanResult[],
  closingDateByLoanNumber: Map<string, string | null>,
  window: ComparableWindow
): DurationWindowSummary {
  let sumAppToCtc = 0;
  let countAppToCtc = 0;
  let sumCtcToDisb = 0;
  let countCtcToDisbursement = 0;
  let closedLoansCount = 0;

  for (const r of loanResults) {
    if (!isWithinWindow(r.month, closingDateByLoanNumber.get(r.loanNumber) ?? null, window)) continue;
    closedLoansCount += 1;
    if (r.appToCtc !== null) {
      sumAppToCtc += r.appToCtc;
      countAppToCtc += 1;
    }
    if (r.ctcToDisb !== null) {
      sumCtcToDisb += r.ctcToDisb;
      countCtcToDisbursement += 1;
    }
  }

  return {
    avgAppToCtc: countAppToCtc > 0 ? sumAppToCtc / countAppToCtc : null,
    countAppToCtc,
    avgCtcToDisbursement: countCtcToDisbursement > 0 ? sumCtcToDisb / countCtcToDisbursement : null,
    countCtcToDisbursement,
    closedLoansCount,
  };
}

/**
 * Mismo criterio que `summarizeDurationWindow`, para la sección On
 * Time/Delayed: filtra `LoanRecord[]` (no un array ya agrupado) por la
 * ventana, y el caller le pasa el resultado a `computeOnTimeDelayedTotals`
 * (`lib/activity/onTimeDelayed.ts`, SIN TOCAR esa función) -- la
 * clasificación On Time/Delayed/Unknown y la regla de `countsForDivision`
 * siguen siendo, exactamente, las ya validadas.
 */
export function loansWithinWindow(loans: LoanRecord[], window: ComparableWindow): LoanRecord[] {
  return loans.filter((loan) => loan.closingMonth !== null && isWithinWindow(loan.closingMonth, loan.closingDate, window));
}
