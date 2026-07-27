import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import { METRICS } from '@/config/metrics';
import { BRANCH_ORDER, type Branch } from '@/config/roster';
import { computeMetricMaps, amountFor, METRIC_MONTH_FIELD } from './metricMaps';
import { sumMonths } from './sumMonths';
import type {
  Measure,
  MetricMap,
  ReportTree,
  ReportTreeBranch,
  ReportTreeItem,
  ReportTreeMetricGroup,
} from './types';

export interface BuildReportTreeOptions {
  records: LoanRecord[];
  months: YearMonth[];
  measure: Measure;
  view: 'main' | 'b2b';
  branchFilter: Branch | 'all';
  drillBy: 'loanOfficer' | 'bd';
}

/**
 * Port de buildView() del legacy. Único cambio de comportamiento consciente:
 * los items del drill (loan officer / BD) suman según `measure` igual que
 * los totales de branch, en vez de contar siempre por 1 como hacía el
 * legacy cuando MEASURE==='amount' -- esta era una inconsistencia del
 * legacy entre el total de branch (sí sensible a MEASURE) y sus items (no),
 * y este módulo es la única fuente de cálculo, así que se resuelve aquí.
 */
export function buildReportTree(options: BuildReportTreeOptions): ReportTree {
  const { records, months, measure, view, branchFilter, drillBy } = options;

  const scoped = view === 'b2b' ? records.filter((r) => r.isB2B) : records;

  const total = { maps: computeMetricMaps(scoped, measure) };

  const byBranch = new Map<Branch, LoanRecord[]>();
  for (const record of scoped) {
    const list = byBranch.get(record.branch);
    if (list) list.push(record);
    else byBranch.set(record.branch, [record]);
  }

  const order = BRANCH_ORDER.filter((b) => branchFilter === 'all' || b === branchFilter);

  const branches: ReportTreeBranch[] = [];
  for (const branch of order) {
    const branchRecords = byBranch.get(branch) ?? [];
    const branchMaps = computeMetricMaps(branchRecords, measure);

    let active = 0;
    for (const { key } of METRICS) active += sumMonths(branchMaps[key], months);
    if (!active) continue;

    const metricGroups: ReportTreeMetricGroup[] = METRICS.map(({ key, label }) => {
      const byItem = new Map<string, MetricMap>();
      for (const record of branchRecords) {
        const ym = record[METRIC_MONTH_FIELD[key]];
        if (!ym) continue;
        const name = record[drillBy];
        let map = byItem.get(name);
        if (!map) {
          map = {};
          byItem.set(name, map);
        }
        map[ym] = (map[ym] || 0) + amountFor(record, measure);
      }

      // DECISIÓN DE NEGOCIO (confirmada 2026-07-27): el desglose por Loan Officer/BD
      // respeta `measure` igual que el total del branch. El HTML legacy tenía una
      // inconsistencia aquí (el desglose siempre sumaba conteo, incluso con measure
      // 'amount') que resultó ser un bug no detectado, no un comportamiento intencional.
      const items: ReportTreeItem[] = [...byItem.entries()]
        .map(([name, map]) => ({ name, map, total: sumMonths(map, months) }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

      return { metric: key, label, total: branchMaps[key], items };
    });

    branches.push({ branch, metricGroups });
  }

  return { total, branches };
}
