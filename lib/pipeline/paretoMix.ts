import type { ScorecardRow } from './scorecards';

/**
 * ============================================================================
 * PARETO POR BRANCH / LOAN OFFICER — Etapa F7, Parte 11
 * ============================================================================
 *
 * Solo lectura sobre `ScorecardRow[]` -- las mismas filas que ya calculan
 * `buildBranchScorecard`/`buildLoanOfficerScorecard` (`lib/pipeline/
 * scorecards.ts`), ya ordenadas de mayor a menor por `closedCount`
 * (`toRows()`, sin cambios en ese archivo). Este módulo NO reagrupa ni
 * reclasifica ningún loan -- solo acumula el `closedCount` ya calculado,
 * en el orden en que llega. Si `rows` no viniera ordenado desc, el
 * porcentaje acumulado no sería monótono creciente -- responsabilidad del
 * caller, no de este módulo (que confía en el orden ya garantizado por
 * `toRows`).
 */

export interface ParetoRow {
  label: string;
  count: number;
  /** 0-100, esta fila sola. */
  percent: number;
  /** 0-100, acumulado hasta esta fila inclusive. */
  cumulativePercent: number;
}

export function buildParetoRows(rows: ScorecardRow[]): ParetoRow[] {
  const total = rows.reduce((sum, r) => sum + r.closedCount, 0);
  const result: ParetoRow[] = [];
  let cumulative = 0;
  for (const r of rows) {
    cumulative += r.closedCount;
    result.push({
      label: r.label,
      count: r.closedCount,
      percent: total > 0 ? (r.closedCount / total) * 100 : 0,
      cumulativePercent: total > 0 ? (cumulative / total) * 100 : 0,
    });
  }
  return result;
}
