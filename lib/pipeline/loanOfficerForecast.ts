import type { BranchRow } from '@/app/pipeline/PivotTable';
import {
  BROKERED_FLAT_PULL_THROUGH_RATE,
  apportionByWeight,
  calculateForecast,
  calculateTotalForecastWithClosed,
  countByMilestoneBucket,
  type DateRange,
  type PullThroughRates,
} from './aggregate';
import type { ResolvedLoan } from './types';

/**
 * ============================================================================
 * FORECAST POR LOAN OFFICER — investigación PDF, sin UI todavía
 * ============================================================================
 *
 * ⚠ SE APORCIONA, NO SE RECALCULA -- mismo criterio y mismo motivo que
 * `buildStrategyRows()` (PivotTable.tsx): `branchRow.projectedToClose` ya
 * es un entero REDONDEADO (Math.round, page.tsx). Redondear-y-sumar no es
 * asociativo -- si cada Loan Officer calculara su propio forecast y lo
 * redondeara por separado, la suma de las partes NO daría el entero del
 * branch (era exactamente el bug de la versión anterior de este archivo:
 * `buildBranchForecastRows()` con su propio `Math.round()` interno, una vez
 * por persona). Ahora se reparte el entero YA FIJADO del branch+channel
 * (`branchRow.projectedToClose`, el MISMO que ya reparte `buildStrategyRows()`
 * hacia las 5 estrategias) entre los Loan Officers de ese branch+channel,
 * con `apportionByWeight()` -- los pesos son los forecasts EXACTOS por
 * persona, sin redondear, con la MISMA fórmula por canal que usa
 * `buildStrategyRows()` (cascada de milestone para Banked, 40% plano para
 * Brokered). La suma de las partes cierra por construcción, no por
 * casualidad de los datos.
 *
 * ⚠ NO recalcula la población -- reusa `branchRow.branchForecastRow.loans`
 * (los mismos abiertos que ya arma la tabla "Por Branch", ya filtrados por
 * Pipeline Range) y vuelve a filtrar `resolvedLoans` por ese branch+channel
 * exacto para los cerrados -- el mismo filtro que hace `buildBranchRows()`
 * internamente para armar `closedLoansForBranch`, que no queda expuesto en
 * `BranchRow` (solo su `closedCount` ya sumado) y por eso hace falta
 * rehacerlo acá, no porque se esté recalculando ningún forecast.
 *
 * ⚠ UN PESO QUE FALTA NO FALLA (ver la advertencia en `apportionByWeight`,
 * casos reales OL12/OL15): el array de pesos que se le pasa SIEMPRE incluye
 * a TODOS los Loan Officers con al menos un loan (abierto o cerrado) en ese
 * branch+channel, incluso los que dan `exactForecast = 0` -- nunca se
 * filtra la lista antes de aporcionar.
 *
 * ⚠ YA NO DEPENDE DE UN COMPONENTE EN TIEMPO DE EJECUCIÓN -- a diferencia
 * de la versión anterior (que importaba `buildBranchRows` en runtime desde
 * `app/pipeline/PivotTable.tsx`, un componente `'use client'`), acá
 * `BranchRow` se importa con `import type` -- se borra por completo en la
 * compilación, no genera ningún `import` real en el JS emitido. Este
 * módulo ya no depende de PivotTable.tsx en runtime, solo de su tipo -- la
 * misma tensión que documentaba la versión anterior (bloqueaba el reuso
 * server-side, ej. una ruta de PDF) queda resuelta con este cambio.
 */

export interface LoanOfficerForecastRow {
  branch: string;
  channel: BranchRow['channel'];
  loanOfficer: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

export function buildLoanOfficerForecastRows(
  branchRows: BranchRow[],
  resolvedLoans: ResolvedLoan[],
  dateRange: DateRange,
  rates: PullThroughRates
): LoanOfficerForecastRow[] {
  const result: LoanOfficerForecastRow[] = [];

  for (const branchRow of branchRows) {
    const isBanked = branchRow.channel === 'Banked - Retail';
    const openLoansForBranch = branchRow.branchForecastRow.loans;
    /* Mismo filtro que hace buildBranchRows() para armar closedLoansForBranch
       -- no queda expuesto en BranchRow (solo closedCount, ya sumado). */
    const closedLoansForBranch = resolvedLoans.filter(
      (loan) => loan.branch === branchRow.branch && loan.channel === branchRow.channel
    );

    const loanOfficers = new Set<string>();
    for (const l of openLoansForBranch) if (l.loanOfficer) loanOfficers.add(l.loanOfficer);
    for (const l of closedLoansForBranch) if (l.loanOfficer) loanOfficers.add(l.loanOfficer);
    if (loanOfficers.size === 0) continue;

    const perOfficer = [...loanOfficers].map((loanOfficer) => {
      const loans = openLoansForBranch.filter((l) => l.loanOfficer === loanOfficer);
      const healthy = loans.filter((l) => l.healthy === true);
      const closedLoans = closedLoansForBranch.filter((l) => l.loanOfficer === loanOfficer);

      /* Mismo criterio de fecha y de status que la fila del branch. */
      const { closedCount } = calculateTotalForecastWithClosed(closedLoans, 0, dateRange);

      /* El peso: el forecast EXACTO, con la fórmula del canal. Sin redondear.
         MISMA fórmula que buildStrategyRows() usa por estrategia. */
      const exactForecast = isBanked
        ? calculateForecast(countByMilestoneBucket(healthy), rates).forecastTotal
        : loans.length * BROKERED_FLAT_PULL_THROUGH_RATE;

      return { loanOfficer, totalCount: loans.length, healthyCount: healthy.length, closedCount, exactForecast };
    });

    /* El entero del branch+channel, repartido. La suma de las partes ES el entero. */
    const parts = apportionByWeight(
      branchRow.projectedToClose,
      perOfficer.map((r) => r.exactForecast)
    );

    const rows: LoanOfficerForecastRow[] = perOfficer.map((r, i) => ({
      branch: branchRow.branch,
      channel: branchRow.channel,
      loanOfficer: r.loanOfficer,
      totalCount: r.totalCount,
      healthyCount: r.healthyCount,
      closedCount: r.closedCount,
      projectedToClose: parts[i],
      totalForecast: r.closedCount + parts[i],
    }));

    /*
     * Red de seguridad en desarrollo, mismo estilo que buildStrategyRows():
     * si un subtotal por Loan Officer no da la fila del branch+channel, hay
     * un préstamo contado dos veces, ninguna, o sin loanOfficer.
     */
    if (process.env.NODE_ENV !== 'production') {
      const suma = (pick: (r: LoanOfficerForecastRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
      const checks: [string, number, number][] = [
        ['totalCount', suma((r) => r.totalCount), branchRow.totalCount],
        ['healthyCount', suma((r) => r.healthyCount), branchRow.healthyCount],
        ['closedCount', suma((r) => r.closedCount), branchRow.closedCount],
        ['projectedToClose', suma((r) => r.projectedToClose), branchRow.projectedToClose],
      ];
      for (const [name, got, want] of checks) {
        if (got !== want) {
          console.warn('PDF-INVESTIGACIÓN: el desglose por Loan Officer no cuadra', {
            branch: branchRow.branch,
            channel: branchRow.channel,
            field: name,
            loanOfficersSum: got,
            branchValue: want,
          });
        }
      }
    }

    result.push(...rows);
  }

  return result.sort((a, b) => a.branch.localeCompare(b.branch) || a.loanOfficer.localeCompare(b.loanOfficer));
}
