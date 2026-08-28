import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import { METRICS } from '@/config/metrics';
import { BRANCH_ORDER, type Branch } from '@/config/roster';
import { computeMetricMaps, amountFor, countsIn, METRIC_MONTH_FIELD } from './metricMaps';
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
  /**
   * Etapa 2 (refacción de filtros): YA debe venir filtrado por quien llama
   * (B2B, Loan Info Channel) -- este módulo agrega lo que recibe, no decide
   * qué filtrar. Antes (`view: 'main'|'b2b'`) el filtro de B2B vivía acá
   * adentro; se movió a app/page.tsx para que sea combinable con cualquier
   * otro filtro/agrupación, no exclusivo de una "vista". Ver
   * BuildReportTreeOptions.drillBy para el único rastro que queda de B2B acá
   * (el label del drill, que sigue siendo responsabilidad del caller).
   */
  records: LoanRecord[];
  months: YearMonth[];
  measure: Measure;
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
  const { records, months, measure, branchFilter, drillBy } = options;

  // Etapa 2: ya no filtra por B2B acá (ver comentario en BuildReportTreeOptions.records)
  // -- `scoped` se mantiene como nombre solo para no tocar el resto del cuerpo.
  const scoped = records;

  /*
   * ⚠ Etapa V2: el nodo `total` es el ÚNICO de todo el módulo que agrega en
   * scope 'division'. Alimenta la fila Total del pivot, las tarjetas del KPI
   * strip cuando no hay sucursal elegida, y el Excel exportado -- los tres
   * lugares donde el número que se lee es "lo que reporta la división".
   *
   * Las filas de sucursal y sus desgloses van en 'detail', más abajo. Ver el
   * comentario de `countsIn()` para por qué los dos números pueden no coincidir
   * y por qué eso acá no es un bug.
   */
  const total = { maps: computeMetricMaps(scoped, measure, 'division') };

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
    // 'detail': la fila de una sucursal muestra lo que esa sucursal se ganó,
    // HELOC de segundo gravamen incluidos.
    const branchMaps = computeMetricMaps(branchRecords, measure, 'detail');

    let active = 0;
    for (const { key } of METRICS) active += sumMonths(branchMaps[key], months);
    if (!active) continue;

    const metricGroups: ReportTreeMetricGroup[] = METRICS.map(({ key, label }) => {
      const byItem = new Map<string, MetricMap>();
      for (const record of branchRecords) {
        // Mismo scope 'detail' que el total de la sucursal de arriba: el
        // desglose por Loan Officer/BD tiene que sumar exactamente esa fila.
        if (!countsIn(record, key, 'detail')) continue;
        const ym = record[METRIC_MONTH_FIELD[key]] as string;
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
