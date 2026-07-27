import type { YearMonth } from '@/lib/parsing/types';
import type { MetricKey } from '@/config/metrics';
import type { Branch } from '@/config/roster';

/** Totales de una métrica indexados por mes ('YYYY-MM' -> total). */
export type MetricMap = Record<YearMonth, number>;

/**
 * La medida de cálculo (conteo de ocurrencias vs. suma de Total Loan Amount)
 * es siempre un parámetro explícito de cada función de este módulo, nunca
 * una variable global implícita como en el legacy.
 */
export type Measure = 'count' | 'amount';

export interface ReportTreeItem {
  /** Loan officer o BD según el drillBy usado para construir el árbol. */
  name: string;
  map: MetricMap;
  total: number;
}

export interface ReportTreeMetricGroup {
  metric: MetricKey;
  label: string;
  total: MetricMap;
  items: ReportTreeItem[];
}

export interface ReportTreeBranch {
  branch: Branch;
  metricGroups: ReportTreeMetricGroup[];
}

/** Estructura jerárquica equivalente al resultado de buildView() del legacy. */
export interface ReportTree {
  total: { maps: Record<MetricKey, MetricMap> };
  branches: ReportTreeBranch[];
}
