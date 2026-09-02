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
 * solo si tienen algo) -- acá se muestra el MISMO conjunto de branches que
 * ya lista "Por Branch" (el `branchRows` recibido), con una fila en cero
 * cuando esa estrategia no está presente en ese branch, en vez de omitir
 * la fila.
 *
 * Etapa PDF3-fix: ya NO se une con `knownBranches` -- eso agregaba
 * branches que "Por Branch" del Resumen no lista (ej. 711 en Banked, 777
 * en ambos canales, sin ninguna actividad en el snapshot), dejando las
 * páginas de estrategia con más filas que la tabla que están desglosando.
 * El listado de branches tiene que ser IDÉNTICO entre ambas vistas -- lo
 * decide `branchRows`, nunca un roster aparte.
 *
 * `import type { BranchRow }` -- igual que `lib/pipeline/loanOfficerForecast.ts`,
 * se borra en la compilación: este módulo no depende de `PivotTable.tsx`
 * (componente `'use client'`) en runtime, solo de su tipo.
 */
export function buildStrategyBranchRows(branchRows: BranchRow[], strategy: Strategy): BranchRowLite[] {
  const rows: BranchRowLite[] = branchRows.map((branchRow) => {
    const strategyRow = branchRow.strategyRows.find((sr) => sr.strategy === strategy);
    if (strategyRow) {
      return {
        branch: branchRow.branch,
        totalCount: strategyRow.totalCount,
        healthyCount: strategyRow.healthyCount,
        closedCount: strategyRow.closedCount,
        projectedToClose: strategyRow.projectedToClose,
        totalForecast: strategyRow.totalForecast,
      };
    }
    return { branch: branchRow.branch, totalCount: 0, healthyCount: 0, closedCount: 0, projectedToClose: 0, totalForecast: 0 };
  });

  /* Mismo orden que ya usa "Por Branch" -- buildBranchRows() también ordena así. */
  return rows.sort((a, b) => a.branch.localeCompare(b.branch));
}
