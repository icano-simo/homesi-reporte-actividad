import { buildBranchForecastRows } from './branchForecast';
import { buildBranchRows } from '@/app/pipeline/PivotTable';
import type { DateRange, PullThroughRates } from './aggregate';
import type { PipelineLoan, ResolvedLoan } from './types';

/**
 * ============================================================================
 * FORECAST POR LOAN OFFICER — investigación PDF, sin UI todavía
 * ============================================================================
 *
 * ⚠ ARCHIVO NUEVO SIN LÓGICA NUEVA -- mismo criterio que
 * `lib/pipeline/branchForecast.ts` (etapa RPT1): esto no inventa ningún
 * cálculo, solo llama a `buildBranchForecastRows()` + `buildBranchRows()`
 * -- las MISMAS funciones que ya arman las filas de pantalla -- una vez
 * por cada Loan Officer distinto, filtrando `openLoans`/`resolvedLoans` a
 * sus propios préstamos antes de llamarlas. El resultado de cada llamada
 * es un `BranchRow` normal; acá solo se toman los 5 campos que hacen falta
 * para esta tabla (sin `strategyRows`, sin `branchForecastRow`).
 *
 * ⚠ DOS RANGOS DE FECHA DISTINTOS, NO UNO -- réplica exacta de cómo
 * page.tsx ya arma la pantalla: primero construye `filteredBranchRows`
 * con `pipelineDateRange` (la población -- qué préstamos abiertos entran,
 * vía el filtro de `estClosingDate` dentro de `buildBranchForecastRows()`),
 * y por separado llama a `buildBranchRows()` con `forecastRange` (la
 * ventana de cierre -- qué préstamos resueltos cuentan como cerrados EN
 * el mes de forecast, dentro de `calculateTotalForecastWithClosed()`).
 * Son dos preguntas distintas (quién compone el pipeline vs. qué mes se
 * está pronosticando) y usar un solo rango para ambas es lo que producía
 * la inconsistencia señalada en la investigación anterior.
 *
 * ⚠ DEPENDENCIA A SEÑALAR: `buildBranchRows()` vive en
 * `app/pipeline/PivotTable.tsx`, un componente `'use client'` -- este
 * módulo de `lib/` termina dependiendo de un componente, exactamente lo
 * que `branchForecast.ts` documenta como la razón por la que
 * `BranchForecastRow`/`buildBranchForecastRows` se mudaron FUERA de
 * `PivotTable.tsx`. Funciona hoy porque todo lo que llama a esto corre en
 * el cliente (page.tsx) -- pero si más adelante hiciera falta este mismo
 * cálculo desde una API route (server-side, como el reporte mensual), este
 * archivo no se podría importar tal cual sin antes mover `buildBranchRows()`
 * a `lib/` también, con el mismo criterio.
 */

export interface LoanOfficerForecastRow {
  branch: string;
  channel: PipelineLoan['channel'];
  loanOfficer: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

export function buildLoanOfficerForecastRows(
  openLoans: PipelineLoan[],
  resolvedLoans: ResolvedLoan[],
  pipelineDateRange: DateRange,
  forecastRange: DateRange,
  knownBranches: Set<string>,
  rates: PullThroughRates
): LoanOfficerForecastRow[] {
  const loanOfficers = new Set<string>();
  for (const l of openLoans) if (l.loanOfficer) loanOfficers.add(l.loanOfficer);
  for (const l of resolvedLoans) if (l.loanOfficer) loanOfficers.add(l.loanOfficer);

  const result: LoanOfficerForecastRow[] = [];
  for (const loanOfficer of loanOfficers) {
    const openForThisLo = openLoans.filter((l) => l.loanOfficer === loanOfficer);
    const resolvedForThisLo = resolvedLoans.filter((l) => l.loanOfficer === loanOfficer);

    /* Misma cascada, mismo reparto -- ver el comentario de cabecera:
       pipelineDateRange para la población, forecastRange para el cierre. */
    const branchForecastRows = buildBranchForecastRows(openForThisLo, pipelineDateRange, rates);
    const branchRows = buildBranchRows(branchForecastRows, resolvedForThisLo, forecastRange, knownBranches, rates);

    for (const row of branchRows) {
      if (row.totalCount === 0 && row.healthyCount === 0 && row.closedCount === 0) continue;
      result.push({
        branch: row.branch,
        channel: row.channel,
        loanOfficer,
        totalCount: row.totalCount,
        healthyCount: row.healthyCount,
        closedCount: row.closedCount,
        projectedToClose: row.projectedToClose,
        totalForecast: row.totalForecast,
      });
    }
  }

  return result.sort((a, b) => a.branch.localeCompare(b.branch) || a.loanOfficer.localeCompare(b.loanOfficer));
}
