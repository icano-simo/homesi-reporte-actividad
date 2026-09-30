import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import { businessDaysToClose } from '@/lib/activity/businessDaysToClose';
import { ctcToDisbursement } from '@/lib/activity/ctcToDisbursement';
import {
  aggregateDaysToCloseCells,
  type DaysToCloseCell,
  type DaysToCloseLoanResult,
} from '@/lib/activity/daysToClosePivotCells';

export type { DaysToCloseCell, DaysToCloseLoanResult };
export type DaysToCloseGroupBy = 'branch' | 'loanOfficer' | 'processor';

/**
 * Rótulo en pantalla de cada dimensión -- ÚNICA definición (antes vivía
 * duplicada, textualmente idéntica, en `DaysToClosePivotTable.tsx` Y en
 * `DaysToClosePivotDrillDown.tsx`; una tercera copia para la sección On
 * Time/Delayed era la señal de "la segunda copia de algo, extraer ahora" ya
 * documentada en este repo -- las 3+ tienen que decidir exactamente lo
 * mismo, así que se extrae en vez de repetirse una vez más).
 */
export const GROUP_BY_LABEL: Record<DaysToCloseGroupBy, string> = {
  branch: 'Branch',
  loanOfficer: 'Loan Officer',
  processor: 'Processor',
};

/**
 * RPC calls en paralelo por tandas -- mismo criterio y mismo número que
 * `averageDaysToClose`/`computeDaysToCloseResults`.
 */
const CONCURRENCY = 20;

/**
 * Exportado (Etapa ON-TIME-GROUPBY-1) -- `OnTimeDelayedTable` necesita
 * agrupar por la MISMA dimensión que este pivot, reusando esta función tal
 * cual en vez de reimplementarla (era privada porque hasta ahora sólo la
 * usaba este archivo).
 */
export function groupKeyOf(loan: LoanRecord, groupBy: DaysToCloseGroupBy): string {
  if (groupBy === 'branch') return loan.branch;
  if (groupBy === 'loanOfficer') return loan.loanOfficer;
  return loan.loanProcessorName;
}

/**
 * Resultado crudo de la RPC por préstamo, SIN ninguna dimensión de
 * agrupación -- a propósito, ver `computePerLoanDaysToClose` más abajo.
 */
export interface PerLoanDaysToClose {
  loanNumber: string;
  month: YearMonth;
  appToCtc: number | null;
  ctcToDisb: number | null;
}

/**
 * ============================================================================
 * DÍAS HÁBILES POR PRÉSTAMO, Banked-Retail cerrados — Etapa AVG-DAYS-TO-CLOSE
 * (separada de la agrupación en Etapa PERF-GROUPBY-CACHE-1)
 * ============================================================================
 *
 * ⚠ NO DEPENDE DE `DaysToCloseGroupBy` -- a propósito. Antes esta misma
 * función recibía `groupBy` y calculaba `groupKeyOf(loan, groupBy)` DENTRO
 * del mismo loop que llama la RPC (`buildDaysToClosePivot`, ahora dividida
 * en ésta + `buildDaysToClosePivotCells` de abajo). Eso acoplaba lo caro
 * (2 llamadas RPC por préstamo, ~910 llamadas en total hoy) con lo barato
 * (qué campo del préstamo se usa como fila) -- cambiar el selector "Group
 * by" en pantalla volvía a llamar las 910 RPC desde cero, aunque ninguna
 * dependía de `groupBy`. Medido: ~10s de más por cada cambio de selector.
 * Separarlas permite cachear ÉSTA (cara, por `loans`) en el caller y
 * recalcular sólo la agrupación (barata) cuando cambia la dimensión -- ver
 * el comentario de `page.tsx` en la etapa que hizo este split.
 *
 * Población: `loanInfoChannel === 'Banked - Retail'` Y `closingMonth !==
 * null` -- mismo criterio ya validado en `averageDaysToClose.ts`.
 *
 * Las llamadas a la RPC corren en una sola pasada sobre TODOS los elegibles
 * (en tandas de `CONCURRENCY`). `null` nunca se trata como `0`: un tramo que
 * no resolvió (fechas faltantes o RPC fallida) se propaga como `null`.
 */
export async function computePerLoanDaysToClose(loans: LoanRecord[]): Promise<PerLoanDaysToClose[]> {
  const eligible = loans.filter((loan) => loan.loanInfoChannel === 'Banked - Retail' && loan.closingMonth !== null);

  const results: PerLoanDaysToClose[] = [];
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const chunk = eligible.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (loan) => {
        const appToCtcPromise =
          loan.appDate === null || loan.ctcDate === null
            ? Promise.resolve(null)
            : businessDaysToClose(loan.appDate, loan.ctcDate).catch((err) => {
                console.error(
                  `[computePerLoanDaysToClose] business_days_between (App→CTC) falló para el préstamo ${loan.loanNumber} (${loan.appDate} -> ${loan.ctcDate}):`,
                  err
                );
                return null;
              });

        const ctcToDisbPromise =
          loan.ctcDate === null || loan.closingDate === null
            ? Promise.resolve(null)
            : ctcToDisbursement(loan.ctcDate, loan.closingDate).catch((err) => {
                console.error(
                  `[computePerLoanDaysToClose] business_days_between (CTC→Disbursement) falló para el préstamo ${loan.loanNumber} (${loan.ctcDate} -> ${loan.closingDate}):`,
                  err
                );
                return null;
              });

        const [appToCtc, ctcToDisb] = await Promise.all([appToCtcPromise, ctcToDisbPromise]);
        return {
          loanNumber: loan.loanNumber,
          month: loan.closingMonth as YearMonth,
          appToCtc,
          ctcToDisb,
        };
      })
    );
    results.push(...chunkResults);
  }

  return results;
}

/**
 * ============================================================================
 * AGRUPACIÓN MES × DIMENSIÓN — barata, sin red — Etapa PERF-GROUPBY-CACHE-1
 * ============================================================================
 *
 * La mitad barata del viejo `buildDaysToClosePivot`: re-etiqueta cada
 * resultado YA CALCULADO por `computePerLoanDaysToClose` con el `groupKey`
 * de la dimensión activa (`groupKeyOf`) y arma el pivot
 * (`aggregateDaysToCloseCells`, puro). Sin RPC, sin `await` -- se puede
 * recalcular en cada cambio de `groupBy` sin costo real.
 *
 * `loanByNumber` -- los mismos `loans` que se le pasaron a
 * `computePerLoanDaysToClose` (o cualquier lista que los contenga, buscada
 * por `loanNumber`); un `perLoan.loanNumber` que no aparece ahí se
 * descarta (no debería pasar nunca, pero no se asume).
 *
 * `loanResults` se devuelve JUNTO con `cells` (mismo criterio que antes):
 * un drill-down puede filtrar este array por `groupKey`/`month` para saber
 * qué préstamos componen una celda, sin volver a llamar la RPC.
 */
export function buildDaysToClosePivotCells(
  perLoan: PerLoanDaysToClose[],
  loans: LoanRecord[],
  groupBy: DaysToCloseGroupBy
): { cells: DaysToCloseCell[]; loanResults: DaysToCloseLoanResult[] } {
  const loanByNumber = new Map(loans.map((loan) => [loan.loanNumber, loan]));

  const loanResults: DaysToCloseLoanResult[] = perLoan.flatMap((r) => {
    const loan = loanByNumber.get(r.loanNumber);
    if (!loan) return [];
    return [
      {
        loanNumber: r.loanNumber,
        groupKey: groupKeyOf(loan, groupBy),
        month: r.month,
        appToCtc: r.appToCtc,
        ctcToDisb: r.ctcToDisb,
      },
    ];
  });

  return { cells: aggregateDaysToCloseCells(loanResults), loanResults };
}
