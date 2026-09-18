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

/**
 * Mes de arranque por defecto de Monthly Trends, sin ninguna selección
 * explícita del usuario -- garantiza mínimo 6 meses visibles sin importar
 * en qué mes del año se abra la pantalla:
 *   - mes actual >= junio: enero del año en curso (6 a 12 meses visibles,
 *     nunca menos de 6 -- de junio a diciembre).
 *   - mes actual < junio: el mes (7 + mes actual) del año ANTERIOR -- ej.
 *     mayo (5) arranca en diciembre (7+5=12) del año anterior: dic, ene,
 *     feb, mar, abr, may = exactamente 6 meses.
 *
 * Función PURA -- recibe `today` como parámetro en vez de leer el reloj del
 * sistema, para poder testearla con cualquier fecha sin mockear nada. El
 * caller (CommercialActivityTrends.tsx) es quien calcula "hoy" -- con
 * `businessToday()` de `lib/pipeline/period.ts` (FIX-BUSINESS-TODAY, ya
 * existente en el repo: hora de negocio Bogotá UTC-5 fijo, no `new Date()`
 * en UTC puro -- ese bug ya costó un salto de mes real el 31 de agosto).
 * Este archivo no importa `businessToday()` ni llama al reloj del sistema
 * directamente, para no perder esa pureza.
 */
export function getDefaultTrendsFromMonth(today: { year: number; month: number }): YearMonth {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  if (today.month >= 6) return `${today.year}-01`;
  return `${today.year - 1}-${pad2(7 + today.month)}`;
}

/**
 * Años ('YYYY') presentes en los 3 campos de fecha de `records`, para el
 * selector "Year" de Monthly Trends -- nunca hardcodeados. Mismo criterio
 * que `getDistinctStrategies`: se deriva de TODOS los registros cargados,
 * no del subconjunto ya filtrado por estrategia -- elegir una estrategia
 * no tiene por qué acotar qué años aparecen en este selector, que es
 * independiente del de Strategy.
 */
export function getDistinctYears(records: LoanRecord[]): string[] {
  const values = new Set<string>();
  for (const record of records) {
    if (record.fileCreationMonth) values.add(record.fileCreationMonth.slice(0, 4));
    if (record.creditReportMonth) values.add(record.creditReportMonth.slice(0, 4));
    if (record.appDateMonth) values.add(record.appDateMonth.slice(0, 4));
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

export interface CommercialActivityKpiValue {
  value: number;
  deltaPct: number | null;
}

export interface CommercialActivityKpiRate {
  /** 0-100. */
  value: number;
  /** Diferencia en puntos porcentuales (no un % change de un %) -- ver comentario de la función. */
  deltaPp: number | null;
}

export interface CommercialActivityKpis {
  fileCreations: CommercialActivityKpiValue;
  applications: CommercialActivityKpiValue;
  fcToCrRate: CommercialActivityKpiRate;
  crToApRate: CommercialActivityKpiRate;
}

function sumField(
  rows: CommercialActivityMonthlyRow[],
  key: 'fileCreations' | 'creditReports' | 'applications'
): number {
  return rows.reduce((acc, r) => acc + r[key], 0);
}

/** 0-100, `0` si `denominator` es 0 -- nunca división por cero sin chequear. */
function ratePct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

/** `null` si `previous` es 0 -- sin base real contra la cual medir un % change (mismo criterio que `computeDelta` de TabAnalytics.tsx: nunca un falso "+Infinity%" ni "0%" inventado). */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * KPIs de Commercial Activity (Analytics) sobre un conjunto de filas YA
 * FILTRADO por el componente (Year/All/rango default) -- esta función no
 * sabe ni le importa de dónde salió `rows`, sólo suma sus columnas.
 *
 * `previousRows`: el bloque de meses INMEDIATAMENTE anterior a `rows`, de
 * la MISMA longitud, si existe completo -- lo arma el caller
 * (`CommercialActivityTrends.tsx`, con `contiguous()` de
 * `lib/aggregation/months.ts` para no reescribir esa aritmética de meses)
 * a partir del set SIN filtrar por Year. `null` = no hay bloque anterior
 * completo (historia insuficiente, o `rows` ya cubre todo lo cargado
 * -- "All" seleccionado) -- ahí los 4 deltas son `null`, nunca un número
 * inventado.
 *
 * fileCreations/applications: delta en % CHANGE normal
 * (`(actual-previo)/previo`). Las 2 tasas (fcToCrRate/crToApRate) usan
 * diferencia en PUNTOS PORCENTUALES (`actual% - previo%`), no un % change
 * del propio %: un cambio de 40% a 44% es "+4pp", nunca "+10%" (que es lo
 * que daría un % change ahí, y confundiría una mejora de conversión con
 * una magnitud 2.5 veces mayor a la real).
 *
 * ⚠ `fcToCrRate`/`crToApRate` son por MES CALENDARIO, no por cohorte: dividen
 * sumas del MISMO rango de meses (`creditReports` del período / `fileCreations`
 * del período), sin rastrear al préstamo individual desde su File Creation
 * hasta su Credit Report. Un préstamo creado en el mes N que saca crédito en
 * el mes N+1 aporta a `fileCreations` de N y a `creditReports` de N+1 -- dos
 * períodos distintos, cada uno con su propio denominador/numerador. No es un
 * bug: es la definición actual de la métrica (documentado, no para cambiar
 * acá).
 */
export function computeCommercialActivityKpis(
  rows: CommercialActivityMonthlyRow[],
  previousRows: CommercialActivityMonthlyRow[] | null
): CommercialActivityKpis {
  const fc = sumField(rows, 'fileCreations');
  const cr = sumField(rows, 'creditReports');
  const ap = sumField(rows, 'applications');
  const fcToCr = ratePct(cr, fc);
  const crToAp = ratePct(ap, cr);

  if (!previousRows) {
    return {
      fileCreations: { value: fc, deltaPct: null },
      applications: { value: ap, deltaPct: null },
      fcToCrRate: { value: fcToCr, deltaPp: null },
      crToApRate: { value: crToAp, deltaPp: null },
    };
  }

  const prevFc = sumField(previousRows, 'fileCreations');
  const prevCr = sumField(previousRows, 'creditReports');
  const prevAp = sumField(previousRows, 'applications');
  /*
   * El `0` de `ratePct` cuando su denominador es 0 es un valor de
   * PRESENTACIÓN (la tasa actual, mostrada tal cual) -- no una tasa real
   * con la que comparar. Si el bloque anterior tuvo 0 File Creations (o 0
   * Credit Reports), su "tasa anterior" no es 0%, es indefinida, y restar
   * contra ese 0 inventaría una mejora de +N pp que nunca ocurrió (mismo
   * mecanismo que "un rótulo que interpreta un número es una afirmación
   * nueva", AGENTS.md) -- por eso ese caso también da `deltaPp: null`, no
   * `fcToCr - 0`.
   */
  const fcToCrDeltaPp = prevFc > 0 ? fcToCr - ratePct(prevCr, prevFc) : null;
  const crToApDeltaPp = prevCr > 0 ? crToAp - ratePct(prevAp, prevCr) : null;

  return {
    fileCreations: { value: fc, deltaPct: pctChange(fc, prevFc) },
    applications: { value: ap, deltaPct: pctChange(ap, prevAp) },
    fcToCrRate: { value: fcToCr, deltaPp: fcToCrDeltaPp },
    crToApRate: { value: crToAp, deltaPp: crToApDeltaPp },
  };
}
