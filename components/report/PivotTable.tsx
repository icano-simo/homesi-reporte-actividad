'use client';

import type { ReactNode } from 'react';
import type { ReportTree, ReportTreeBranch, ReportTreeMetricGroup, Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import { METRICS, MONTH_NAMES } from '@/config/metrics';
import PivotRow from './PivotRow';

export interface PivotTableProps {
  tree: ReportTree;
  months: YearMonth[];
  measure: Measure;
  /** false cuando hay un branchFilter activo -- igual que showTotal del legacy. */
  showTotal: boolean;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  /** Decide el label de la 3ra columna ("BD" vs "Loan Officer") y el de la fila Total. */
  view: 'main' | 'b2b';
}

function monthAbbrev(ym: YearMonth): string {
  return MONTH_NAMES[Number(ym.split('-')[1]) - 1].slice(0, 3);
}

function YearHeaderCells({ months }: { months: YearMonth[] }) {
  const cells: ReactNode[] = [];
  let i = 0;
  while (i < months.length) {
    const year = months[i].split('-')[0];
    let span = 0;
    while (i + span < months.length && months[i + span].split('-')[0] === year) span++;
    cells.push(
      <th key={year + '-' + i} colSpan={span}>
        {year}
      </th>
    );
    i += span;
  }
  return <>{cells}</>;
}

/** Port de grpRow() del legacy: fila de encabezado de grupo (Total / Branch), clicable. */
function GroupHeaderRow({
  id,
  label,
  depthClass,
  collapsed,
  onToggleCollapse,
}: {
  id: string;
  label: string;
  depthClass: string;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
}) {
  return (
    <tr className={'grp togg ' + depthClass} onClick={() => onToggleCollapse(id)}>
      <td className="lbl">
        <span className="indent" style={{ width: '0px' }}></span>
        <span className="chev">{collapsed ? '▸' : '▾'}</span>
        {label}
      </td>
      <td colSpan={99}></td>
    </tr>
  );
}

function MetricGroupRows({
  branchId,
  group,
  months,
  measure,
  collapsed,
  onToggleCollapse,
}: {
  branchId: string;
  group: ReportTreeMetricGroup;
  months: YearMonth[];
  measure: Measure;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const isClosed = group.metric === 'cl';
  const hasItems = group.items.length > 0;
  const groupId = branchId + '::m::' + group.metric;
  const groupCollapsed = collapsed.has(groupId);

  return (
    <>
      <PivotRow
        label={group.label}
        map={group.total}
        months={months}
        measure={measure}
        isClosedMetric={isClosed}
        rowClassName={'metric mrow' + (isClosed ? ' clm' : '')}
        indentPx={20}
        toggleId={hasItems ? groupId : undefined}
        collapsed={groupCollapsed}
        onToggle={onToggleCollapse}
      />
      {hasItems &&
        !groupCollapsed &&
        group.items.map((item) => (
          <PivotRow
            key={item.name}
            label={item.name}
            map={item.map}
            months={months}
            measure={measure}
            isClosedMetric={isClosed}
            rowClassName="metric drow"
            indentPx={46}
          />
        ))}
    </>
  );
}

function BranchRows({
  branch,
  months,
  measure,
  collapsed,
  onToggleCollapse,
}: {
  branch: ReportTreeBranch;
  months: YearMonth[];
  measure: Measure;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const branchId = 'br::' + branch.branch;
  const branchCollapsed = collapsed.has(branchId);

  return (
    <>
      <GroupHeaderRow
        id={branchId}
        label={branch.branch}
        depthClass="d1"
        collapsed={branchCollapsed}
        onToggleCollapse={onToggleCollapse}
      />
      {!branchCollapsed &&
        branch.metricGroups.map((g) => (
          <MetricGroupRows
            key={g.metric}
            branchId={branchId}
            group={g}
            months={months}
            measure={measure}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
    </>
  );
}

/**
 * Port de renderTable() + renderTotal() + renderBranch() del legacy, ahora
 * con colapso real (Etapa 8): los headers de grupo (Total/Branch) y las
 * filas mrow con items son clicables (mismo esquema de ids que el legacy:
 * 'total', 'br::'+branch, 'br::'+branch+'::m::'+metric).
 *
 * `showTotal` reemplaza el `BRANCHF==='all'` del legacy: cuando hay un
 * branch filtrado, el nodo Total del ReportTree existe igual (no está
 * filtrado por branch, ver buildReportTree) pero no se debe mostrar --
 * ese es el bug corregido en esta etapa.
 *
 * `view` resuelve las dos etiquetas dinámicas del legacy: `drillLbl`
 * ('BD' vs 'Loan Officer' en el header de la 3ra columna) y `total.label`
 * ('Total (B2B)' vs 'Total'). Es solo texto -- ReportTree no necesita saber
 * qué vista lo generó, el cálculo no cambia.
 */
export default function PivotTable({ tree, months, measure, showTotal, collapsed, onToggleCollapse, view }: PivotTableProps) {
  const totalCollapsed = collapsed.has('total');
  const drillLabel = view === 'b2b' ? 'BD' : 'Loan Officer';
  const totalLabel = view === 'b2b' ? 'Total (B2B)' : 'Total';

  return (
    <table className="piv" id="pivot">
      <thead>
        <tr className="yr-row">
          <th className="lbl"></th>
          <YearHeaderCells months={months} />
          <th className="totcol"></th>
        </tr>
        <tr className="mo-row">
          <th className="lbl">{'Branch / Métrica / ' + drillLabel}</th>
          {months.map((ym) => (
            <th key={ym}>{monthAbbrev(ym)}</th>
          ))}
          <th className="totcol">Total</th>
        </tr>
      </thead>
      <tbody>
        {showTotal && (
          <>
            <GroupHeaderRow
              id="total"
              label={totalLabel}
              depthClass="total"
              collapsed={totalCollapsed}
              onToggleCollapse={onToggleCollapse}
            />
            {!totalCollapsed &&
              METRICS.map(({ key, label }) => (
                <PivotRow
                  key={key}
                  label={label}
                  map={tree.total.maps[key]}
                  months={months}
                  measure={measure}
                  isClosedMetric={key === 'cl'}
                  rowClassName="metric"
                  indentPx={26}
                />
              ))}
          </>
        )}

        {tree.branches.map((b) => (
          <BranchRows
            key={b.branch}
            branch={b}
            months={months}
            measure={measure}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
          />
        ))}

        {!tree.branches.length && (
          <tr>
            <td className="lbl" style={{ color: 'var(--muted)', fontWeight: 500 }}>
              Ningún branch con actividad en el período seleccionado.
            </td>
            <td colSpan={99}></td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
