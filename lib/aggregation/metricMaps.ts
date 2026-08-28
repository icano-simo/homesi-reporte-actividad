import type { LoanRecord } from '@/lib/domain/types';
import { METRICS, type MetricKey } from '@/config/metrics';
import type { Measure, MetricMap } from './types';

/** Campo de LoanRecord que contiene el mes de cada MetricKey. */
type MetricDateField = 'fileCreationMonth' | 'creditReportMonth' | 'appDateMonth' | 'closingMonth';

/**
 * Tabla de glue entre las claves de config/metrics.ts (fc/cr/ap/cl, heredadas
 * del legacy) y los campos descriptivos de LoanRecord (Etapa 4). No hardcodea
 * la LISTA de métricas -- eso sigue viniendo de METRICS -- solo mapea cada
 * clave a su campo correspondiente.
 */
export const METRIC_MONTH_FIELD: Record<MetricKey, MetricDateField> = {
  fc: 'fileCreationMonth',
  cr: 'creditReportMonth',
  ap: 'appDateMonth',
  cl: 'closingMonth',
};

/** Cuánto aporta un LoanRecord a la medida pedida: 1 para 'count', el monto para 'amount'. */
export function amountFor(record: LoanRecord, measure: Measure): number {
  return measure === 'amount' ? record.totalLoanAmount || 0 : 1;
}

/**
 * A quién le está sumando este número — etapa V2.
 *
 *   'division' -- la fila Total del pivot y las tarjetas del KPI strip cuando
 *                 no hay una sucursal elegida. Es lo que la división reporta.
 *   'detail'   -- una sucursal, un loan officer, un BD. Es lo que esa persona
 *                 o esa sucursal se ganó.
 */
export type AggregationScope = 'division' | 'detail';

/**
 * ============================================================================
 * ⚠ LA ÚNICA DEFINICIÓN DE "ESTE PRÉSTAMO SUMA EN ESTE TOTAL" — etapa V2
 * ============================================================================
 *
 * Antes bastaba con "¿tiene mes en esta métrica?". Ahora hay una segunda
 * condición, y sólo para los cierres: los HELOC de segundo gravamen cierran
 * de verdad, pero la división no gana nada con ellos.
 *
 * ---------------------------------------------------------------------------
 * ⚠ CONSECUENCIA ASUMIDA: EL TOTAL NO ES LA SUMA DE LAS FILAS
 * ---------------------------------------------------------------------------
 * Con este corte --decidido explícitamente por la usuaria-- la fila Total del
 * pivot puede dar MENOS que la suma de las filas de sucursal que tiene arriba.
 * Con los datos de hoy la diferencia es de 5 préstamos repartidos en 4 meses:
 * enero 1, marzo 1, mayo 1 y **julio 2** (julio cierra 59 por sucursal y 57
 * para la división).
 *
 * Está escrito acá porque es exactamente el tipo de descuadre que en otras
 * pantallas de este proyecto ES un bug (los subtotales de Forecast, los
 * anclajes de S2). Acá no lo es: son dos preguntas distintas --"¿qué se ganó
 * esta sucursal?" y "¿qué reporta la división?"-- y la respuesta correcta a
 * las dos no es el mismo número. Si alguien "arregla" el descuadre igualando
 * los dos lados, rompe una de las dos.
 *
 * La otra mitad de la regla vive en `loansForCell()`, que usa este mismo
 * predicado para que el modal de detalle liste exactamente los préstamos que
 * la celda contó. Si esto cambia, cambia allá solo.
 */
export function countsIn(record: LoanRecord, key: MetricKey, scope: AggregationScope): boolean {
  if (!record[METRIC_MONTH_FIELD[key]]) return false;
  // El flag sólo se aplica a los cierres: es lo único que un HELOC de segundo
  // gravamen le aporta (o no) a la división. Sus files, credits y apps cuentan
  // en todas partes, igual que los de cualquier otro préstamo.
  if (key === 'cl' && scope === 'division' && !record.countsForDivision) return false;
  return true;
}

/**
 * Port de metricMaps() del legacy, con la medida como parámetro explícito
 * en vez de la variable global MEASURE, e iterando sobre METRICS en vez de
 * hardcodear {fc:{},cr:{},ap:{},cl:{}}.
 */
export function computeMetricMaps(
  records: LoanRecord[],
  measure: Measure,
  /*
   * Etapa V2. Sin default a propósito: quien agrega tiene que declarar para
   * quién es el número. Un default silencioso haría que un caller nuevo
   * eligiera sin saberlo, que es justo la decisión que no conviene heredar.
   */
  scope: AggregationScope
): Record<MetricKey, MetricMap> {
  const maps = {} as Record<MetricKey, MetricMap>;
  for (const { key } of METRICS) maps[key] = {};

  for (const record of records) {
    for (const { key } of METRICS) {
      if (!countsIn(record, key, scope)) continue;
      const ym = record[METRIC_MONTH_FIELD[key]] as string;
      maps[key][ym] = (maps[key][ym] || 0) + amountFor(record, measure);
    }
  }

  return maps;
}
