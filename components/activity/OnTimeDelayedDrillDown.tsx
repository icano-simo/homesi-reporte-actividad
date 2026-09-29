'use client';

import { useEffect } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import { GROUP_BY_LABEL, groupKeyOf, type DaysToCloseGroupBy } from '@/lib/activity/daysToClosePivot';
import { DIMENSIONS } from '@/components/activity/DaysToCloseDimensionSelector';
import { MONTH_NAMES } from '@/config/metrics';
import { CloseIcon } from '@/components/ui/icons';

export interface OnTimeDelayedDrillDownRow {
  loanNumber: string;
  bucket: 'onTime' | 'delayed';
  /** `null` en On Time -- ver `OnTimeDelayedLoanResult` en lib/activity/onTimeDelayed.ts. */
  daysLate: number | null;
  loan: LoanRecord;
}

export interface OnTimeDelayedDrillDownProps {
  isOpen: boolean;
  onClose: () => void;
  month: YearMonth | null;
  groupKey: string | null;
  /** Etapa ON-TIME-GROUPBY-1 -- decide el rótulo del eyebrow ("Branch"/"Loan Officer"/"Processor"), mismo `GROUP_BY_LABEL` que `DaysToClosePivotDrillDown.tsx`. */
  groupBy: DaysToCloseGroupBy;
  rows: OnTimeDelayedDrillDownRow[];
}

function monthYearLabel(ym: YearMonth): string {
  const [year, month] = ym.split('-');
  return MONTH_NAMES[Number(month) - 1] + ' ' + year;
}

/** `null` es '—' -- mismo criterio de "no aplica" que el resto del módulo (fmtDays/fmtPct en OnTimeDelayedTable.tsx), NUNCA '0': un préstamo On Time no tiene "0 días de atraso", el atraso no le aplica. Confirmado en pantalla contra la alternativa (mostrar '0') -- ver el reporte de esta etapa para el porqué se descartó. */
function fmtDaysLate(n: number | null): string {
  return n === null ? '—' : n.toFixed(0);
}

const BUCKET_LABEL: Record<'onTime' | 'delayed', string> = {
  onTime: 'On Time',
  delayed: 'Delayed',
};

/**
 * ============================================================================
 * DRILL-DOWN DE UNA CELDA (Dimensión × Mes) — OnTimeDelayedTable
 * ============================================================================
 *
 * Componente NUEVO -- mismo patrón visual EXACTO que
 * `DaysToClosePivotDrillDown.tsx` (`.modal-overlay`/`.modal-box--wide`/
 * `.modal-header`/`.modal-context`/`table.piv`), no el mismo componente:
 * ese exige `metric` (App→CTC vs CTC→Disb), que no aplica acá -- un click
 * en esta tabla es sobre la celda entera (On Time + Delayed mezclados), no
 * sobre un tramo específico.
 *
 * Etapa ON-TIME-GROUPBY-1 -- `groupBy` (antes esto era fijo "siempre
 * branch"): ahora sigue la MISMA dimensión activa que
 * `OnTimeDelayedTable`/`DaysToClosePivotTable`. Antes esta tabla mostraba
 * SIEMPRE Loan Officer y Processor como columnas de contexto (nunca
 * Branch, porque Branch era la única dimensión agrupada posible -- mostrarla
 * de nuevo hubiera sido redundante con el eyebrow). Generalizado con el
 * mismo mecanismo que ya usa `DaysToClosePivotDrillDown.tsx`
 * (`contextDims = DIMENSIONS.filter(d => d.key !== groupBy)`, reusando el
 * mismo array): las OTRAS 2 dimensiones, nunca la agrupada -- si no se
 * excluyera, agrupar por Loan Officer mostraría el nombre resuelto en el
 * eyebrow Y el nombre crudo sin resolver en su propia columna, dos valores
 * distintos para "la misma persona" en la misma pantalla.
 *
 * Una sola celda (groupKey × mes) puede tener préstamos On Time Y Delayed
 * mezclados -- a diferencia del drill-down de Duration (donde CADA click
 * es sobre UN metric específico, App→CTC o CTC→Disb, nunca los 2 a la
 * vez), acá el click es sobre la CELDA entera: "On Time" y "Delayed" son
 * las 2 columnas clicables de esa misma fila, y las 2 abren el MISMO
 * modal con TODOS los préstamos de esa celda (Unknown excluido, mismo
 * criterio que la tabla/el chart) -- por eso hace falta una columna de
 * Status por fila, cosa que Duration no necesita (ahí todas las filas del
 * modal comparten el mismo metric, ya declarado en el header).
 */
export default function OnTimeDelayedDrillDown({ isOpen, onClose, month, groupKey, groupBy, rows }: OnTimeDelayedDrillDownProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen || month === null || groupKey === null) return null;

  const groupByLabel = GROUP_BY_LABEL[groupBy];
  const countLabel = rows.length.toLocaleString('en-US') + (rows.length === 1 ? ' loan' : ' loans');
  const contextDims = DIMENSIONS.filter((d) => d.key !== groupBy);
  const ariaLabel = groupByLabel + ' ' + groupKey + ' — On Time / Delayed — ' + monthYearLabel(month);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box modal-box--wide"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-context" style={{ minWidth: 0, flex: 1 }}>
            <div className="modal-context__field">
              <div className="modal-eyebrow">{groupByLabel}</div>
              <div className="modal-context__value">{groupKey}</div>
            </div>
            <div className="modal-context__field">
              <div className="modal-eyebrow">Month</div>
              <div className="modal-context__value">{monthYearLabel(month)}</div>
            </div>
            <div className="modal-context__field">
              <div className="modal-eyebrow">Loans</div>
              <div className="modal-context__value">{countLabel}</div>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-table-scroll">
            <table className="piv">
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Loan Number</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                  <th>Days Late</th>
                  <th style={{ textAlign: 'left' }}>Est. Closing Date</th>
                  <th style={{ textAlign: 'left' }}>Closing Date</th>
                  {contextDims.map((d) => (
                    <th key={d.key} style={{ textAlign: 'left' }}>
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="metric" key={row.loanNumber}>
                    <td className="lbl" style={{ textAlign: 'left' }}>
                      {row.loanNumber}
                    </td>
                    <td style={{ textAlign: 'left' }}>{BUCKET_LABEL[row.bucket]}</td>
                    <td className="val">{fmtDaysLate(row.daysLate)}</td>
                    <td style={{ textAlign: 'left' }}>{row.loan.orgEstClosingDate ?? '—'}</td>
                    <td style={{ textAlign: 'left' }}>{row.loan.closingDate ?? '—'}</td>
                    {contextDims.map((d) => (
                      <td key={d.key} style={{ textAlign: 'left' }}>
                        {groupKeyOf(row.loan, d.key)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={5 + contextDims.length}>
                      No loans.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
