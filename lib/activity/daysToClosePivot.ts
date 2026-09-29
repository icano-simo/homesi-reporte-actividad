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
 * ============================================================================
 * PIVOT MES × DIMENSIÓN, Banked-Retail cerrados — Etapa AVG-DAYS-TO-CLOSE
 * ============================================================================
 *
 * Mismo patrón de agrupación de `buildReportTree`
 * (lib/aggregation/buildReportTree.ts): primero por dimensión, y adentro de
 * cada grupo por mes -- acá el mes SIEMPRE es `closingMonth` (cuándo cerró
 * el préstamo), no `appDateMonth` ni ningún otro anclaje.
 *
 * Población: `loanInfoChannel === 'Banked - Retail'` Y `closingMonth !==
 * null` -- mismo criterio ya validado en `averageDaysToClose.ts`.
 *
 * ⚠ Diferencia deliberada con `averageDaysToClose()`: ahí, si CUALQUIERA de
 * los 2 tramos da `null` para un préstamo, ese préstamo se excluye de LOS 2
 * promedios (para que compartan la misma población). Acá, en cambio, cada
 * celda lleva 2 conteos INDEPENDIENTES (`countAppToCtc`/
 * `countCtcToDisbursement`): un préstamo puede aportar a un tramo y no al
 * otro si sólo uno de los 2 resolvió. El pivot muestra cada tramo por
 * separado, así que no hace falta que compartan población para ser
 * comparables entre sí.
 *
 * ⚠ ESA INDEPENDENCIA ESTÁ VERIFICADA POR LECTURA DE CÓDIGO Y POR UN TEST CON
 * DATO SINTÉTICO -- NO POR UNA CORRIDA CONTRA DATO REAL. La lógica de
 * agrupación vive en `daysToClosePivotCells.ts` (`aggregateDaysToCloseCells`,
 * puro y sin imports de red -- ver su comentario para el porqué de la
 * extracción) y su test es
 * `scripts/verificacion/dias-cierre-conteos-independientes.test.mjs`. Medido
 * contra los 450 préstamos reales de hoy: `countAppToCtc ===
 * countCtcToDisbursement` en las 136 celdas, siempre -- eso NO prueba que la
 * independencia funcione, prueba que ningún préstamo real de hoy tiene un
 * `null` asimétrico entre los 2 tramos. Si algún día aparece uno y esta
 * función se toca sin mirar el test, ahí está la red.
 *
 * Confirmado (Isa): `business_days_between`, `is_business_day`,
 * `first_business_day` y `last_business_day` comparten
 * `maintenance.us_holidays` (35 filas, 2025-2027) sin defecto -- la
 * convención exclusiva (mismo día -> 0) y el calendario que usa la RPC no
 * tienen ningún pendiente de este lado. Lo único no verificado con dato real
 * sigue siendo la independencia de los 2 conteos (arriba), que es una
 * propiedad de ESTE módulo y no depende del calendario.
 *
 * `null` nunca se trata como `0`: ni al excluir un préstamo de una métrica
 * puntual, ni en el promedio de la celda (`count === 0` da `avg: null`, no
 * `NaN` ni `0`).
 *
 * Las llamadas a la RPC corren en una sola pasada sobre TODOS los elegibles
 * (en tandas de `CONCURRENCY`), y recién después se arma el pivot agrupando
 * el resultado ya calculado -- no se vuelve a tocar la RPC por celda.
 *
 * `loanResults` se devuelve JUNTO con `cells` (antes se descartaba) -- es el
 * mismo propósito que `computeDaysToCloseResults()` cachea para
 * `DaysToCloseTrends.tsx`: un drill-down futuro puede filtrar este array por
 * `groupKey`/`month` para saber qué préstamos componen una celda, sin volver
 * a llamar la RPC.
 */
export async function buildDaysToClosePivot(
  loans: LoanRecord[],
  groupBy: DaysToCloseGroupBy
): Promise<{ cells: DaysToCloseCell[]; loanResults: DaysToCloseLoanResult[] }> {
  const eligible = loans.filter((loan) => loan.loanInfoChannel === 'Banked - Retail' && loan.closingMonth !== null);

  const results: DaysToCloseLoanResult[] = [];
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const chunk = eligible.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (loan) => {
        const appToCtcPromise =
          loan.appDate === null || loan.ctcDate === null
            ? Promise.resolve(null)
            : businessDaysToClose(loan.appDate, loan.ctcDate).catch((err) => {
                console.error(
                  `[buildDaysToClosePivot] business_days_between (App→CTC) falló para el préstamo ${loan.loanNumber} (${loan.appDate} -> ${loan.ctcDate}):`,
                  err
                );
                return null;
              });

        const ctcToDisbPromise =
          loan.ctcDate === null || loan.closingDate === null
            ? Promise.resolve(null)
            : ctcToDisbursement(loan.ctcDate, loan.closingDate).catch((err) => {
                console.error(
                  `[buildDaysToClosePivot] business_days_between (CTC→Disbursement) falló para el préstamo ${loan.loanNumber} (${loan.ctcDate} -> ${loan.closingDate}):`,
                  err
                );
                return null;
              });

        const [appToCtc, ctcToDisb] = await Promise.all([appToCtcPromise, ctcToDisbPromise]);
        return {
          loanNumber: loan.loanNumber,
          groupKey: groupKeyOf(loan, groupBy),
          month: loan.closingMonth as YearMonth,
          appToCtc,
          ctcToDisb,
        };
      })
    );
    results.push(...chunkResults);
  }

  return { cells: aggregateDaysToCloseCells(results), loanResults: results };
}
