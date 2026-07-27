'use client';

import type { MetricMap, Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import { fmtVal } from '@/lib/aggregation/format';
import { sumMonths } from '@/lib/aggregation/sumMonths';

export interface PivotRowProps {
  label: string;
  map: MetricMap;
  months: YearMonth[];
  measure: Measure;
  isClosedMetric?: boolean;
  rowClassName?: string;
  indentPx?: number;
  /** Si se provee (junto con onToggle), la fila es clicable y muestra un chevron ▾/▸. */
  toggleId?: string;
  collapsed?: boolean;
  onToggle?: (id: string) => void;
}

/**
 * Port de valueRow() del legacy: label + un valor por mes + total.
 * El chevron/togg es opcional (toggleId+onToggle) -- lo usan las filas mrow
 * de la Etapa 8 para colapsar su desglose de Loan Officer/BD; las filas
 * simples (Total, drow) se siguen renderizando sin chevron, como antes.
 */
export default function PivotRow({
  label,
  map,
  months,
  measure,
  isClosedMetric = false,
  rowClassName = 'metric',
  indentPx = 0,
  toggleId,
  collapsed = false,
  onToggle,
}: PivotRowProps) {
  const total = sumMonths(map, months);
  const canToggle = toggleId !== undefined && onToggle !== undefined;

  return (
    <tr
      className={rowClassName + (canToggle ? ' togg' : '')}
      onClick={canToggle ? () => onToggle!(toggleId!) : undefined}
    >
      <td className="lbl mname">
        <span className="indent" style={{ width: indentPx + 'px' }}></span>
        {canToggle && <span className="chev">{collapsed ? '▸' : '▾'}</span>}
        {label}
      </td>
      {months.map((ym) => {
        const value = map[ym] || 0;
        const cellClass = 'val ' + (isClosedMetric && value ? 'cl' : '') + (value ? '' : ' zero');
        return (
          <td key={ym} className={cellClass}>
            {fmtVal(value, measure)}
          </td>
        );
      })}
      <td className="totcol">{fmtVal(total, measure)}</td>
    </tr>
  );
}
