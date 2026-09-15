import type { YearMonth } from '@/lib/parsing/types';
import type { LoanRecord } from '@/lib/domain/types';

/**
 * ============================================================================
 * TENDENCIAS MENSUALES DE COMMERCIAL ACTIVITY (para Analytics) — ARCHIVO NUEVO
 * ============================================================================
 *
 * Vive en `lib/aggregation/` y no en `lib/domain/` -- mismo criterio que
 * `metricMaps.ts`/`months.ts` de esta carpeta: son agregadores que recorren
 * `LoanRecord[]` y bucketean por mes, y ese es exactamente el patrón ya
 * establecido acá. `lib/domain/` tiene el TIPO `LoanRecord` y las reglas de
 * clasificación (`strategy.ts`, `classifyBranch.ts`), no sus agregados.
 *
 * A propósito NO reusa `computeMetricMaps()`/`METRIC_MONTH_FIELD` de
 * `metricMaps.ts`: esa función itera las 4 métricas (`fc/cr/ap/cl`) con la
 * regla de `countsIn()` (el corte de HELOC de segundo gravamen, que sólo
 * aplica a Closing) -- fuera de alcance acá, que pidió explícitamente no
 * tocar nada de Closing. Los 3 campos de este archivo (File Creation,
 * Credit Report, Application) no tienen ninguna condición de scope: cada
 * préstamo con el mes no-nulo cuenta, sin excepción.
 */

export interface CommercialActivityMonthlyRow {
  month: YearMonth;
  fileCreations: number;
  creditReports: number;
  applications: number;
}

/**
 * Tendencia mensual de File Creations / Credit Reports / Applications, para
 * el gráfico de líneas de Commercial Activity en Analytics.
 *
 * Cada préstamo aporta a las 3 columnas de forma INDEPENDIENTE: su
 * `fileCreationMonth` alimenta `fileCreations`, su `creditReportMonth`
 * alimenta `creditReports`, su `appDateMonth` alimenta `applications` -- los
 * tres pueden caer en meses distintos entre sí para el mismo préstamo, y
 * cada uno se ignora por separado si es `null` (el campo respectivo no vino
 * o no aplica a ese préstamo).
 *
 * Filtro de estrategia OPCIONAL, aplicado ANTES de contar (excluye el
 * registro entero de las 3 columnas si no calza, no solo de una). `undefined`
 * o `'all'` -- sin filtrar.
 *
 * Sin ninguna fecha del sistema: el eje de meses sale enteramente de los
 * `YearMonth` presentes en `records`, nunca de `new Date()` ni de "hoy".
 */
export function buildCommercialActivityMonthlyTrends(
  records: LoanRecord[],
  strategy?: string
): CommercialActivityMonthlyRow[] {
  const filtered = strategy && strategy !== 'all' ? records.filter((r) => r.strategy === strategy) : records;

  const byMonth = new Map<YearMonth, { fileCreations: number; creditReports: number; applications: number }>();
  function bucket(month: YearMonth): { fileCreations: number; creditReports: number; applications: number } {
    let row = byMonth.get(month);
    if (!row) {
      row = { fileCreations: 0, creditReports: 0, applications: 0 };
      byMonth.set(month, row);
    }
    return row;
  }

  for (const record of filtered) {
    if (record.fileCreationMonth) bucket(record.fileCreationMonth).fileCreations++;
    if (record.creditReportMonth) bucket(record.creditReportMonth).creditReports++;
    if (record.appDateMonth) bucket(record.appDateMonth).applications++;
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({ month, ...counts }));
}

/**
 * Valores únicos de `record.strategy` presentes en `records`, orden
 * alfabético -- sin hardcodear `STRATEGY_ORDER` (lib/domain/strategy.ts) ni
 * ninguna otra lista fija: si mañana BigQuery resuelve una sexta estrategia,
 * aparece acá sola. `''` (préstamo sin estrategia resuelta, ver comentario de
 * `LoanRecord.strategy`) se excluye -- no es un valor de estrategia, es la
 * ausencia de uno, y ya tiene su propio significado en "Todas".
 */
export function getDistinctStrategies(records: LoanRecord[]): string[] {
  const values = new Set<string>();
  for (const record of records) {
    if (record.strategy) values.add(record.strategy);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
