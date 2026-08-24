'use client';

import type { MetricMap, Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import { fmtVal } from '@/lib/aggregation/format';
import { sumMonths } from '@/lib/aggregation/sumMonths';
import { ChevronRightIcon } from '@/components/ui/icons';

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
  /**
   * Drill-down (Fase 1): si se provee, cada celda de mes con valor > 0 abre
   * el modal de detalle -- independiente de toggleId/onToggle (que sigue
   * colapsando/expandiendo el desglose inline, sin cambios). Las dos
   * interacciones conviven en la misma fila: click en la celda de valor abre
   * el modal (con stopPropagation, para no disparar también el toggle de la
   * fila); click en el resto de la fila sigue colapsando/expandiendo como
   * antes.
   */
  onCellClick?: (ym: YearMonth) => void;
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
  onCellClick,
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
        {/* Etapa UX1: chevron SVG (rotado por CSS con .chev.open) en vez de
            los caracteres "▸"/"▾" -- spec §2, "Zero Emojis". */}
        {canToggle && (
          <span className={'chev' + (collapsed ? '' : ' open')}>
            <ChevronRightIcon size={12} />
          </span>
        )}
        {label}
      </td>
      {months.map((ym) => {
        const value = map[ym] || 0;
        // Drill-down (Fase 1): solo celdas con valor > 0 son clicables -- 0
        // loans no amerita abrir un modal vacío (ver PivotRowProps.onCellClick).
        const drillable = Boolean(onCellClick) && value > 0;
        const cellClass = ['val', isClosedMetric && value ? 'cl' : '', value ? '' : 'zero'].filter(Boolean).join(' ');
        const formatted = fmtVal(value, measure);
        return (
          <td key={ym} className={cellClass}>
            {drillable ? (
              // Visual polish (Activity): el elemento clicable pasa a ser
              // este <span>, no el <td> -- así el hover/background quedan
              // acotados al número (.drill-value, components.css) en vez de
              // toda la celda, y el <td> conserva su text-align:right/resto
              // de comportamiento sin cambios. Misma lógica exacta de antes
              // (onCellClick, ym, stopPropagation, condición drillable,
              // fmtVal/measure), solo un nivel más adentro del DOM.
              <span
                className="drill-value"
                onClick={(e) => {
                  // No debe también disparar el onClick de la fila (toggle).
                  e.stopPropagation();
                  onCellClick!(ym);
                }}
              >
                {formatted}
              </span>
            ) : (
              formatted
            )}
          </td>
        );
      })}
      <td className="totcol">{fmtVal(total, measure)}</td>
    </tr>
  );
}
