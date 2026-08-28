import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import { METRICS, type MetricKey } from '@/config/metrics';
import { computeMetricMaps } from './metricMaps';
import { sumMonths } from './sumMonths';
import type { Measure, MetricMap } from './types';

export interface LoanOfficerMetricGroup {
  metric: MetricKey;
  label: string;
  map: MetricMap;
  total: number;
}

export interface LoanOfficerTreeItem {
  name: string;
  metricGroups: LoanOfficerMetricGroup[];
}

export interface LoanOfficerTree {
  officers: LoanOfficerTreeItem[];
}

export interface BuildLoanOfficerTreeOptions {
  records: LoanRecord[];
  months: YearMonth[];
  measure: Measure;
}

/** Suma de las 4 métricas de un officer -- usada para el orden default y para omitir sin actividad. No se guarda en el tipo (no lo pedía el diseño); se recalcula donde hace falta. */
function officerActivityTotal(metricGroups: LoanOfficerMetricGroup[]): number {
  return metricGroups.reduce((sum, g) => sum + g.total, 0);
}

/**
 * Etapa 12: agrupa TODOS los records por Loan Officer, cruzando cualquier
 * branch -- a diferencia de buildReportTree() (Branch -> Métrica -> LO),
 * acá el Loan Officer es el nivel superior directo. Reutiliza
 * computeMetricMaps/sumMonths ya existentes, no reimplementa ningún
 * cálculo. Un Loan Officer sin actividad en el rango de meses pedido
 * (suma de las 4 métricas = 0) se omite -- no aporta información.
 */
export function buildLoanOfficerTree(options: BuildLoanOfficerTreeOptions): LoanOfficerTree {
  const { records, months, measure } = options;

  const byOfficer = new Map<string, LoanRecord[]>();
  for (const record of records) {
    const name = record.loanOfficer || '(blank)';
    const list = byOfficer.get(name);
    if (list) list.push(record);
    else byOfficer.set(name, [record]);
  }

  const officers: LoanOfficerTreeItem[] = [];
  for (const [name, officerRecords] of byOfficer) {
    /*
     * Etapa V2: 'detail', no 'division'. Esta tabla mide PERSONAS -- es la
     * misma decisión que rige el Business Plan: el HELOC de segundo gravamen
     * lo gana quien lo originó. Además esta vista no tiene fila Total contra
     * la cual descuadrar: `LoanOfficerTree` sólo tiene `officers`.
     */
    const maps = computeMetricMaps(officerRecords, measure, 'detail');
    const metricGroups: LoanOfficerMetricGroup[] = METRICS.map(({ key, label }) => ({
      metric: key,
      label,
      map: maps[key],
      total: sumMonths(maps[key], months),
    }));

    if (!officerActivityTotal(metricGroups)) continue;
    officers.push({ name, metricGroups });
  }

  officers.sort(
    (a, b) => officerActivityTotal(b.metricGroups) - officerActivityTotal(a.metricGroups) || a.name.localeCompare(b.name)
  );

  return { officers };
}
