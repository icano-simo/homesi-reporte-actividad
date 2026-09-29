import type { YearMonth } from '@/lib/parsing/types';

export interface DaysToCloseCell {
  /** branch, loanOfficer o loanProcessorName, según `groupBy`. */
  groupKey: string;
  /** `closingMonth` del préstamo -- el pivot se arma por mes de cierre, no por mes de App/CTC. */
  month: YearMonth;
  /** Promedio simple de App→CTC dentro de esta celda (mes × grupo). `null` si `countAppToCtc` es 0. */
  avgAppToCtc: number | null;
  countAppToCtc: number;
  /** Promedio simple de CTC→Disbursement dentro de esta celda -- conteo INDEPENDIENTE de `countAppToCtc` (ver comentario de abajo). */
  avgCtcToDisbursement: number | null;
  countCtcToDisbursement: number;
}

/**
 * Resultado crudo de UN préstamo, ya con sus 2 tramos resueltos -- input de
 * `aggregateDaysToCloseCells`. `loanNumber` sigue el mismo propósito que en
 * `DaysToCloseResult` (lib/aggregation/buildAverageDaysToCloseByDimension.ts):
 * permite identificar, después de agregar, qué préstamos componen una celda
 * -- sin volver a llamar la RPC.
 */
export interface DaysToCloseLoanResult {
  loanNumber: string;
  groupKey: string;
  month: YearMonth;
  appToCtc: number | null;
  ctcToDisb: number | null;
}

/**
 * ============================================================================
 * AGREGACIÓN PURA MES × DIMENSIÓN — extraída de `daysToClosePivot.ts`
 * ============================================================================
 *
 * Sin imports de red ni de Supabase -- a propósito, mismo patrón que
 * `lib/outlook/gobierno.ts`/`ventana.ts`/`gates.ts`: un archivo "puro y sin
 * imports" (el único que tiene es `import type`, que Node borra al cargar
 * TypeScript nativo) se puede cargar directo con `node`, sin bundler ni
 * sesión de navegador. Eso es lo que permite que
 * `scripts/verificacion/dias-cierre-conteos-independientes.test.mjs` exista:
 * `daysToClosePivot.ts` entero NO se puede cargar así -- sus imports de
 * `businessDaysToClose`/`ctcToDisbursement` bajan, transitivamente, hasta
 * `@/lib/supabase/client`, que necesita `document.cookie` (navegador real) y
 * nunca carga en un `node` plano.
 *
 * ⚠ LA INDEPENDENCIA DE `countAppToCtc`/`countCtcToDisbursement` -- que un
 * préstamo puede aportar a una métrica y no a la otra si sólo uno de los 2
 * tramos de la RPC resolvió -- ESTÁ VERIFICADA ACÁ, CON DATO SINTÉTICO (ver
 * el test), NO CON DATO REAL. Medido contra los 450 préstamos Banked-Retail
 * cerrados de hoy: countAppToCtc === countCtcToDisbursement en las 136
 * celdas, sin ninguna excepción. Eso no es evidencia de que esta función esté
 * bien -- es que ningún préstamo real de hoy tiene un `null` asimétrico
 * (`business_days_between` sólo da `null` con fechas nulas o invertidas, y
 * las 450 tienen sus 3 fechas en orden). Si alguien lee "0 celdas difieren"
 * corriendo contra datos reales y lo toma como la prueba de que la
 * independencia funciona, está leyendo una rama que nunca se ejercitó -- la
 * prueba de verdad es el test con datos inventados, no esa corrida.
 *
 * Confirmado (Isa): `business_days_between`, `is_business_day`,
 * `first_business_day` y `last_business_day` comparten
 * `maintenance.us_holidays` (35 filas, 2025-2027) sin defecto -- la
 * convención exclusiva y el calendario que usa la RPC no tienen ningún
 * pendiente de este lado. Lo único que sigue sin verificar con dato real es
 * la independencia de los 2 conteos de arriba, que es una propiedad de ESTE
 * módulo y no depende del calendario.
 */
export function aggregateDaysToCloseCells(results: DaysToCloseLoanResult[]): DaysToCloseCell[] {
  interface CellAccumulator {
    groupKey: string;
    month: YearMonth;
    sumAppToCtc: number;
    countAppToCtc: number;
    sumCtcToDisb: number;
    countCtcToDisbursement: number;
  }

  const byCell = new Map<string, CellAccumulator>();
  for (const r of results) {
    const cellKey = `${r.groupKey}\u0000${r.month}`;
    const cur =
      byCell.get(cellKey) ??
      { groupKey: r.groupKey, month: r.month, sumAppToCtc: 0, countAppToCtc: 0, sumCtcToDisb: 0, countCtcToDisbursement: 0 };
    if (r.appToCtc !== null) {
      cur.sumAppToCtc += r.appToCtc;
      cur.countAppToCtc += 1;
    }
    if (r.ctcToDisb !== null) {
      cur.sumCtcToDisb += r.ctcToDisb;
      cur.countCtcToDisbursement += 1;
    }
    byCell.set(cellKey, cur);
  }

  return [...byCell.values()]
    .map((c) => ({
      groupKey: c.groupKey,
      month: c.month,
      avgAppToCtc: c.countAppToCtc > 0 ? c.sumAppToCtc / c.countAppToCtc : null,
      countAppToCtc: c.countAppToCtc,
      avgCtcToDisbursement: c.countCtcToDisbursement > 0 ? c.sumCtcToDisb / c.countCtcToDisbursement : null,
      countCtcToDisbursement: c.countCtcToDisbursement,
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.groupKey.localeCompare(b.groupKey));
}
