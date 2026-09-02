import type { BranchRow } from '@/app/pipeline/PivotTable';
import type { BranchRowLite } from '@/app/pipeline/pdf/pdfShared';
import type { Strategy } from './strategy';

/**
 * ============================================================================
 * DESGLOSE "POR BRANCH" DE UNA SOLA ESTRATEGIA — páginas del PDF por estrategia
 * ============================================================================
 * Solo reparte lo que `buildBranchRows()` (PivotTable.tsx) ya calculó vía
 * `buildStrategyRows()` -- ningún cálculo nuevo. Cada `BranchRow.strategyRows`
 * ya trae, por branch+canal, una fila por estrategia PRESENTE (ver el
 * comentario de `buildStrategyRows()`: `Own production` siempre, las demás
 * solo si tienen algo) -- acá se muestran TODOS los branches conocidos para
 * TODAS las estrategias, con una fila en cero cuando esa estrategia no
 * está presente en ese branch, en vez de omitir la fila.
 *
 * `import type { BranchRow }` -- igual que `lib/pipeline/loanOfficerForecast.ts`,
 * se borra en la compilación: este módulo no depende de `PivotTable.tsx`
 * (componente `'use client'`) en runtime, solo de su tipo.
 */
export function buildStrategyBranchRows(branchRows: BranchRow[], knownBranches: Set<string>, strategy: Strategy): BranchRowLite[] {
  const branches = new Set<string>(knownBranches);
  for (const row of branchRows) branches.add(row.branch);

  const byBranch = new Map(branchRows.map((r) => [r.branch, r] as const));

  const rows: BranchRowLite[] = [...branches].map((branch) => {
    const strategyRow = byBranch.get(branch)?.strategyRows.find((sr) => sr.strategy === strategy);
    if (strategyRow) {
      return {
        branch,
        totalCount: strategyRow.totalCount,
        healthyCount: strategyRow.healthyCount,
        closedCount: strategyRow.closedCount,
        projectedToClose: strategyRow.projectedToClose,
        totalForecast: strategyRow.totalForecast,
      };
    }
    return { branch, totalCount: 0, healthyCount: 0, closedCount: 0, projectedToClose: 0, totalForecast: 0 };
  });

  /* Mismo orden que ya usa "Por Branch" -- buildBranchRows() también ordena así. */
  return rows.sort((a, b) => a.branch.localeCompare(b.branch));
}
