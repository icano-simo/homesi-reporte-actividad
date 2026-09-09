import type { BranchRow } from '@/app/pipeline/PivotTable';
import {
  BROKERED_FLAT_PULL_THROUGH_RATE,
  apportionByWeight,
  calculateForecast,
  calculateTotalForecastWithClosed,
  countByMilestoneBucket,
  isClosedInMonth,
  type DateRange,
  type PullThroughRates,
} from './aggregate';
import type { AliasIndex } from '@/lib/business-plan/aliasIndex';
import type { PipelineLoan, ResolvedLoan } from './types';

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
  loanOfficerKey: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
  loans: PipelineLoan[];
  closedLoans: ResolvedLoan[];
}

export function buildLoanOfficerForecastRows(
  branchRows: BranchRow[],
  resolvedLoans: ResolvedLoan[],
  dateRange: DateRange,
  rates: PullThroughRates,
  aliasIndex: AliasIndex,
  employeeNameByKey: Map<number, string>
): LoanOfficerForecastRow[] {
  const result: LoanOfficerForecastRow[] = [];

  /**
   * Resuelve un nombre crudo de "Loan Officers" (Salesforce) contra
   * org.employee_alias -- mismo mecanismo que buildLoanOfficerScorecard()
   * en scorecards.ts. Si no resuelve, NO se descarta ni se fusiona con
   * nadie: queda como su propia identidad (key = 'raw:'+nombre), con su
   * nombre crudo como display -- fidelidad del dato por sobre prolijidad
   * del nombre (7 casos conocidos hoy, 8-sep, pendientes de que Isa los
   * agregue a employee_alias).
   */
  function resolveOfficer(rawName: string): { key: string; displayName: string } {
    const { employeeKey } = aliasIndex.lookup('salesforce', rawName);
    if (employeeKey === null) return { key: 'raw:' + rawName, displayName: rawName };
    return { key: 'emp:' + employeeKey, displayName: employeeNameByKey.get(employeeKey) ?? rawName };
  }

  for (const branchRow of branchRows) {
    const isBanked = branchRow.channel === 'Banked - Retail';
    const openLoansForBranch = branchRow.branchForecastRow.loans;
    /* Mismo filtro que hace buildBranchRows() para armar closedLoansForBranch
       -- no queda expuesto en BranchRow (solo closedCount, ya sumado). */
    const closedLoansForBranch = resolvedLoans.filter(
      (loan) => loan.branch === branchRow.branch && loan.channel === branchRow.channel
    );

    const officersByKey = new Map<string, { key: string; displayName: string }>();
    for (const l of openLoansForBranch) if (l.loanOfficer) officersByKey.set(resolveOfficer(l.loanOfficer).key, resolveOfficer(l.loanOfficer));
    for (const l of closedLoansForBranch) if (l.loanOfficer) officersByKey.set(resolveOfficer(l.loanOfficer).key, resolveOfficer(l.loanOfficer));
    if (officersByKey.size === 0) continue;

    const perOfficer = [...officersByKey.values()].map(({ key, displayName }) => {
      const loans = openLoansForBranch.filter((l) => l.loanOfficer && resolveOfficer(l.loanOfficer).key === key);
      const healthy = loans.filter((l) => l.healthy === true);
      const closedLoans = closedLoansForBranch.filter((l) => l.loanOfficer && resolveOfficer(l.loanOfficer).key === key);
      const closedLoansInMonth = closedLoans.filter((loan) => isClosedInMonth(loan, dateRange));

      /* Mismo criterio de fecha y de status que la fila del branch. */
      const { closedCount } = calculateTotalForecastWithClosed(closedLoans, 0, dateRange);

      /* El peso: el forecast EXACTO, con la fórmula del canal. Sin redondear.
         MISMA fórmula que buildStrategyRows() usa por estrategia. */
      const exactForecast = isBanked
        ? calculateForecast(countByMilestoneBucket(healthy), rates).forecastTotal
        : loans.length * BROKERED_FLAT_PULL_THROUGH_RATE;

      return { loanOfficerKey: key, loanOfficer: displayName, loans, closedLoans: closedLoansInMonth, totalCount: loans.length, healthyCount: healthy.length, closedCount, exactForecast };
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
      loanOfficerKey: r.loanOfficerKey,
      loans: r.loans,
      closedLoans: r.closedLoans,
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

    /*
     * Red de seguridad en desarrollo: `rows[i].closedLoans` (ahora
     * `closedLoansInMonth`) tiene que tener EXACTAMENTE `closedCount`
     * préstamos -- si no, el modal mostraría un conjunto de préstamos
     * distinto del número que dice la celda. No debería dispararse nunca
     * si el fix es correcto.
     */
    if (process.env.NODE_ENV !== 'production') {
      for (const r of rows) {
        if (r.closedLoans.length !== r.closedCount) {
          console.warn('PDF-INVESTIGACIÓN: closedLoans del modal no coincide con closedCount de la celda', {
            branch: r.branch,
            channel: r.channel,
            loanOfficer: r.loanOfficer,
            closedLoansLength: r.closedLoans.length,
            closedCount: r.closedCount,
          });
        }
      }
    }

    result.push(...rows);
  }

  return result.sort((a, b) => a.branch.localeCompare(b.branch) || a.loanOfficer.localeCompare(b.loanOfficer));
}

export interface LoanOfficerForecastByPerson {
  loanOfficer: string;
  loanOfficerKey: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
  loans: PipelineLoan[];
  closedLoans: ResolvedLoan[];
}

/**
 * Agrupa `LoanOfficerForecastRow[]` (una fila por branch+channel+Loan
 * Officer) por Loan Officer solo -- un mismo Loan Officer con filas en
 * varios branches/canales queda en UNA sola fila acá, con los 5 campos
 * numéricos sumados. NO recalcula ningún forecast ni vuelve a redondear
 * nada -- suma directa de lo que ya devolvió `buildLoanOfficerForecastRows()`,
 * mismo criterio de "aporcionar, no recalcular" documentado arriba.
 */
export function buildLoanOfficerForecastByPerson(rows: LoanOfficerForecastRow[]): LoanOfficerForecastByPerson[] {
  const byOfficer = new Map<string, LoanOfficerForecastByPerson>();
  for (const row of rows) {
    const cur = byOfficer.get(row.loanOfficerKey) ?? {
      loanOfficer: row.loanOfficer,
      loanOfficerKey: row.loanOfficerKey,
      totalCount: 0,
      healthyCount: 0,
      closedCount: 0,
      projectedToClose: 0,
      totalForecast: 0,
      loans: [],
      closedLoans: [],
    };
    cur.totalCount += row.totalCount;
    cur.healthyCount += row.healthyCount;
    cur.closedCount += row.closedCount;
    cur.projectedToClose += row.projectedToClose;
    cur.totalForecast += row.totalForecast;
    cur.loans.push(...row.loans);
    cur.closedLoans.push(...row.closedLoans);
    byOfficer.set(row.loanOfficerKey, cur);
  }

  const result = [...byOfficer.values()].sort((a, b) => a.loanOfficer.localeCompare(b.loanOfficer));

  /*
   * Mismo chequeo de desarrollo que buildLoanOfficerForecastRows() arriba
   * -- agrupar por persona no debe cambiar ninguna suma total, solo
   * colapsar filas. Si no cuadra, algún Loan Officer quedó contado dos
   * veces o se perdió una fila al agrupar.
   */
  if (process.env.NODE_ENV !== 'production') {
    const sumRows = (pick: (r: LoanOfficerForecastRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
    const sumResult = (pick: (r: LoanOfficerForecastByPerson) => number) => result.reduce((a, r) => a + pick(r), 0);
    const checks: [string, number, number][] = [
      ['totalCount', sumResult((r) => r.totalCount), sumRows((r) => r.totalCount)],
      ['healthyCount', sumResult((r) => r.healthyCount), sumRows((r) => r.healthyCount)],
      ['closedCount', sumResult((r) => r.closedCount), sumRows((r) => r.closedCount)],
      ['projectedToClose', sumResult((r) => r.projectedToClose), sumRows((r) => r.projectedToClose)],
    ];
    for (const [name, got, want] of checks) {
      if (got !== want) {
        console.warn('PDF-INVESTIGACIÓN: el agrupado por persona no cuadra contra las filas sin agrupar', {
          field: name,
          groupedSum: got,
          rowsSum: want,
        });
      }
    }
  }

  return result;
}
