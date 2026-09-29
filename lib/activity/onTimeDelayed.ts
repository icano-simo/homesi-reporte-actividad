import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';

export type OnTimeDelayedBucket = 'onTime' | 'delayed' | 'unknown';

export interface OnTimeDelayedCell {
  month: YearMonth;
  branch: string;
  countOnTime: number;
  countDelayed: number;
  countUnknown: number;
  /** % sobre (countOnTime + countDelayed) ÚNICAMENTE -- Unknown queda fuera del denominador, nunca se mezcla. `null` si ese subtotal es 0. */
  pctOnTime: number | null;
  pctDelayed: number | null;
  /** Promedio de días de atraso (Close Date - orgEstClosingDate), SOLO sobre el bucket Delayed. `null` si no hay ningún Delayed en esta celda. */
  avgDaysLate: number | null;
}

/**
 * Etapa ON-TIME-GROUPBY-1 -- misma forma que `OnTimeDelayedCell`, pero con
 * `groupKey: string` en vez de `branch: string`, para agrupar por CUALQUIER
 * dimensión (mismo criterio ya usado por `DaysToCloseCell` del pivot de
 * Duration). `OnTimeDelayedCell` no se elimina -- sigue siendo la forma que
 * consume el chart, vía `computeOnTimeDelayedByMonthAndBranch` (que ahora es
 * un envoltorio fino sobre ésta, ver más abajo) -- sin tocar ese contrato.
 */
export interface OnTimeDelayedGroupCell {
  month: YearMonth;
  groupKey: string;
  countOnTime: number;
  countDelayed: number;
  countUnknown: number;
  pctOnTime: number | null;
  pctDelayed: number | null;
  avgDaysLate: number | null;
}

export interface OnTimeDelayedTotals {
  countOnTime: number;
  countDelayed: number;
  countUnknown: number;
  pctOnTime: number | null;
  pctDelayed: number | null;
  avgDaysLate: number | null;
}

/**
 * Diferencia en DÍAS DE CALENDARIO entre 2 fechas 'YYYY-MM-DD' -- aritmética
 * en UTC explícito (parseo manual de año/mes/día + `Date.UTC`), nunca
 * `new Date(string)` ni Date local: evita el corrimiento de día por
 * interpretación de zona horaria (misma preocupación que ya documentó este
 * proyecto para `monthOf()` en loadCurrent.ts, acá aplicada a una resta de
 * días en vez de un truncamiento a mes).
 *
 * A propósito NO es `business_days_between()` -- esto es Close Date contra
 * una fecha objetivo FIJA (la estimación original), no el cálculo de
 * negocio de días hábiles que ya usan App→CTC/CTC→Disb.
 */
function calendarDaysBetweenUTC(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86400000);
}

/**
 * ============================================================================
 * CLASIFICACIÓN On Time / Delayed / Unknown — POR PRÉSTAMO
 * ============================================================================
 *
 * Regla de negocio (confirmada por Alejandra vía Isa):
 *   - `orgEstClosingDate === null` -- Unknown, sin excepción. NUNCA cuenta
 *     como On Time ni Delayed, sin importar qué diga `closingDate`.
 *   - `closingDate <= orgEstClosingDate` -- On Time (comparación lexicográfica
 *     de 2 strings 'YYYY-MM-DD', que ordena igual que la fecha real -- no
 *     hace falta ningún `Date` para esto).
 *   - `closingDate > orgEstClosingDate` -- Delayed.
 *
 * `closingDate === null` (no debería pasar dentro del universo de "cierres
 * de división", pero no se asume) también cae a Unknown -- no hay Close
 * Date con la cual comparar.
 */
function classify(loan: LoanRecord): OnTimeDelayedBucket {
  if (loan.orgEstClosingDate === null || loan.closingDate === null) return 'unknown';
  return loan.closingDate <= loan.orgEstClosingDate ? 'onTime' : 'delayed';
}

/**
 * ============================================================================
 * ON TIME / DELAYED, POR MES DE CIERRE × DIMENSIÓN — Etapa ON-TIME-GROUPBY-1
 * ============================================================================
 *
 * Generalización de la función original (`computeOnTimeDelayedByMonthAndBranch`,
 * ver el envoltorio fino más abajo) -- MISMA lógica de clasificación/
 * agregación, con `groupKeyOf(loan)` en vez de `loan.branch` fijo. Se
 * generalizó (no se duplicó) porque las 2 tienen que decidir exactamente lo
 * mismo -- la única diferencia entre "agrupar por branch" y "agrupar por
 * Loan Officer/Processor" es qué valor identifica la fila, no cómo se
 * clasifica ni se promedia.
 *
 * Universo: `counts_for_division === true` -- el mismo filtro ya usado y
 * verificado para "cierres de división" (508 con `orgEstClosingDate`, 6
 * sin, sobre 514 -- coincide exacto con lo que reportó Isa).
 *
 * Agrupado por `loan.closingMonth` (el mes de cierre YA resuelto en
 * BigQuery, mismo campo que usa el pivot de Days to Close para agrupar por
 * mes) × `groupKeyOf(loan)` -- no hay un helper de agrupamiento separado y
 * reusable en este repo (la agrupación de `daysToClosePivotCells.ts` está
 * inline dentro de su propia función, atada a sus propios campos); esta
 * función replica el MISMO patrón (`Map` con clave compuesta
 * `mes + '\u0000' + groupKey`), no inventa uno distinto.
 *
 * Una celda sin ningún préstamo Delayed tiene `avgDaysLate: null`, nunca
 * `0` ni `NaN` -- "no hubo atraso para promediar" no es lo mismo que "el
 * atraso promedio fue 0 días".
 */
export function computeOnTimeDelayedByMonthAndGroup(
  loans: LoanRecord[],
  groupKeyOf: (loan: LoanRecord) => string
): OnTimeDelayedGroupCell[] {
  const eligible = loans.filter((loan) => loan.countsForDivision === true);

  interface CellAccumulator {
    month: YearMonth;
    groupKey: string;
    onTime: number;
    delayed: number;
    unknown: number;
    daysLateSum: number;
    daysLateCount: number;
  }

  const byCell = new Map<string, CellAccumulator>();
  for (const loan of eligible) {
    // `closingMonth` puede ser `null` en teoría (préstamo que no cerró) --
    // dentro de `counts_for_division === true` no debería pasar nunca (ese
    // flag ya implica cierre), pero no se asume: sin mes no hay celda a la
    // que asignar este préstamo, así que se salta de ESTE agrupamiento
    // (no de `computeOnTimeDelayedTotals`, que no depende del mes).
    if (loan.closingMonth === null) continue;

    const groupKey = groupKeyOf(loan);
    const key = loan.closingMonth + '\u0000' + groupKey;
    const cur =
      byCell.get(key) ??
      { month: loan.closingMonth, groupKey, onTime: 0, delayed: 0, unknown: 0, daysLateSum: 0, daysLateCount: 0 };

    const bucket = classify(loan);
    if (bucket === 'unknown') {
      cur.unknown += 1;
    } else if (bucket === 'onTime') {
      cur.onTime += 1;
    } else {
      cur.delayed += 1;
      cur.daysLateSum += calendarDaysBetweenUTC(loan.orgEstClosingDate as string, loan.closingDate as string);
      cur.daysLateCount += 1;
    }
    byCell.set(key, cur);
  }

  return [...byCell.values()]
    .map((c) => {
      const denom = c.onTime + c.delayed;
      return {
        month: c.month,
        groupKey: c.groupKey,
        countOnTime: c.onTime,
        countDelayed: c.delayed,
        countUnknown: c.unknown,
        pctOnTime: denom > 0 ? (c.onTime / denom) * 100 : null,
        pctDelayed: denom > 0 ? (c.delayed / denom) * 100 : null,
        avgDaysLate: c.daysLateCount > 0 ? c.daysLateSum / c.daysLateCount : null,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.groupKey.localeCompare(b.groupKey));
}

/**
 * Envoltorio fino sobre `computeOnTimeDelayedByMonthAndGroup` -- preserva EL
 * MISMO contrato/forma (`OnTimeDelayedCell` con `branch`, no `groupKey`) para
 * sus 2 consumidores actuales (el chart de On Time/Delayed y
 * `OnTimeKpiCards`, vía `onTimeCells`/`onTimeByMonth` en `page.tsx`) -- Etapa
 * ON-TIME-GROUPBY-1 pidió explícitamente NO tocar esos 2. Salida
 * byte-idéntica a la versión anterior: mismo agrupamiento (`groupKeyOf` acá
 * es `(loan) => loan.branch`, igual que el `key` que se armaba antes a
 * mano) y mismo orden de `sort` (antes por `branch`, ahora por `groupKey` --
 * el mismo valor con otro nombre de campo).
 */
export function computeOnTimeDelayedByMonthAndBranch(loans: LoanRecord[]): OnTimeDelayedCell[] {
  return computeOnTimeDelayedByMonthAndGroup(loans, (loan) => loan.branch).map((c) => ({
    month: c.month,
    branch: c.groupKey,
    countOnTime: c.countOnTime,
    countDelayed: c.countDelayed,
    countUnknown: c.countUnknown,
    pctOnTime: c.pctOnTime,
    pctDelayed: c.pctDelayed,
    avgDaysLate: c.avgDaysLate,
  }));
}

/**
 * ============================================================================
 * RESULTADO POR PRÉSTAMO — Etapa ON-TIME-DRILLDOWN-1 / ON-TIME-GROUPBY-1
 * ============================================================================
 *
 * Mismo propósito que `DaysToCloseLoanResult` en
 * `lib/activity/daysToClosePivotCells.ts`: el detalle por préstamo detrás
 * de una celda de `computeOnTimeDelayedByMonthAndGroup`, para el
 * drill-down de `OnTimeDelayedTable.tsx` -- sin volver a clasificar nada
 * (reusa la MISMA `classify()`/`calendarDaysBetweenUTC()` de arriba, ya
 * validadas contra los números de Isa).
 *
 * `groupKey` (Etapa ON-TIME-GROUPBY-1, antes `branch` fijo) -- mismo motivo
 * que en `OnTimeDelayedGroupCell`: el drill-down tiene que poder filtrar por
 * la dimensión activa (Branch/Loan Officer/Processor), no sólo por branch.
 * El 2do parámetro de `computeOnTimeDelayedLoanResults` tiene default
 * `(loan) => loan.branch` -- preserva el comportamiento anterior para quien
 * no pase nada (mismo patrón que `betterDirection` en `DeltaBadge.tsx`).
 *
 * `unknown` queda AFUERA (nunca se agrega un resultado para ese bucket) --
 * mismo criterio que la tabla y el chart, que tampoco lo muestran como
 * columna: el drill-down de una celda es sobre los préstamos que SÍ
 * entran en el % (On Time + Delayed), igual que el resto de esta pantalla.
 */
export interface OnTimeDelayedLoanResult {
  loanNumber: string;
  month: YearMonth;
  groupKey: string;
  bucket: 'onTime' | 'delayed';
  /** Días de atraso (Close Date - orgEstClosingDate), SOLO si `bucket === 'delayed'`. `null` en On Time -- nunca 0, "no aplica" no es "cero atraso". */
  daysLate: number | null;
}

export function computeOnTimeDelayedLoanResults(
  loans: LoanRecord[],
  groupKeyOf: (loan: LoanRecord) => string = (loan) => loan.branch
): OnTimeDelayedLoanResult[] {
  const eligible = loans.filter((loan) => loan.countsForDivision === true);
  const results: OnTimeDelayedLoanResult[] = [];
  for (const loan of eligible) {
    if (loan.closingMonth === null) continue;
    const bucket = classify(loan);
    if (bucket === 'unknown') continue;
    const daysLate =
      bucket === 'delayed' ? calendarDaysBetweenUTC(loan.orgEstClosingDate as string, loan.closingDate as string) : null;
    results.push({ loanNumber: loan.loanNumber, month: loan.closingMonth, groupKey: groupKeyOf(loan), bucket, daysLate });
  }
  return results;
}

/**
 * Totales globales, SIN agrupar -- misma clasificación y las mismas 3
 * reglas de arriba, pero sobre el universo entero de una sola vez. Para la
 * verificación contra los números de Isa (302 Delayed / 206 On Time / 6
 * Unknown, sobre el total) -- no depende de `closingMonth`, así que un
 * préstamo sin mes de cierre (si lo hubiera) SÍ se cuenta acá, a
 * diferencia de `computeOnTimeDelayedByMonthAndBranch`.
 */
export function computeOnTimeDelayedTotals(loans: LoanRecord[]): OnTimeDelayedTotals {
  const eligible = loans.filter((loan) => loan.countsForDivision === true);

  let onTime = 0;
  let delayed = 0;
  let unknown = 0;
  let daysLateSum = 0;
  let daysLateCount = 0;

  for (const loan of eligible) {
    const bucket = classify(loan);
    if (bucket === 'unknown') {
      unknown += 1;
    } else if (bucket === 'onTime') {
      onTime += 1;
    } else {
      delayed += 1;
      daysLateSum += calendarDaysBetweenUTC(loan.orgEstClosingDate as string, loan.closingDate as string);
      daysLateCount += 1;
    }
  }

  const denom = onTime + delayed;
  return {
    countOnTime: onTime,
    countDelayed: delayed,
    countUnknown: unknown,
    pctOnTime: denom > 0 ? (onTime / denom) * 100 : null,
    pctDelayed: denom > 0 ? (delayed / denom) * 100 : null,
    avgDaysLate: daysLateCount > 0 ? daysLateSum / daysLateCount : null,
  };
}
