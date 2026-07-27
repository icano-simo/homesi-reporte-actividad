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
 * Port de metricMaps() del legacy, con la medida como parámetro explícito
 * en vez de la variable global MEASURE, e iterando sobre METRICS en vez de
 * hardcodear {fc:{},cr:{},ap:{},cl:{}}.
 */
export function computeMetricMaps(
  records: LoanRecord[],
  measure: Measure
): Record<MetricKey, MetricMap> {
  const maps = {} as Record<MetricKey, MetricMap>;
  for (const { key } of METRICS) maps[key] = {};

  for (const record of records) {
    for (const { key } of METRICS) {
      const ym = record[METRIC_MONTH_FIELD[key]];
      if (!ym) continue;
      maps[key][ym] = (maps[key][ym] || 0) + amountFor(record, measure);
    }
  }

  return maps;
}
