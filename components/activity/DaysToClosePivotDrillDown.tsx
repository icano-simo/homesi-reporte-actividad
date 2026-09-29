'use client';

import { useEffect } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import { GROUP_BY_LABEL, groupKeyOf, type DaysToCloseGroupBy } from '@/lib/activity/daysToClosePivot';
import { DIMENSIONS } from '@/components/activity/DaysToCloseDimensionSelector';
import { MONTH_NAMES } from '@/config/metrics';
import { CloseIcon } from '@/components/ui/icons';

export interface DaysToClosePivotDrillDownRow {
  loanNumber: string;
  /** Días hábiles del tramo que se clickeó (App→CTC o CTC→Disb) para ESTE préstamo -- viene de `DaysToCloseLoanResult`, nunca null acá (ya se filtró antes de armar la fila). */
  days: number;
  loan: LoanRecord;
}

export interface DaysToClosePivotDrillDownProps {
  isOpen: boolean;
  onClose: () => void;
  month: YearMonth | null;
  groupKey: string | null;
  groupBy: DaysToCloseGroupBy;
  metric: 'appToCtc' | 'ctcToDisb' | null;
  rows: DaysToClosePivotDrillDownRow[];
}

const METRIC_LABEL: Record<'appToCtc' | 'ctcToDisb', string> = {
  appToCtc: 'App → CTC',
  ctcToDisb: 'CTC → Disbursement',
};

function monthYearLabel(ym: YearMonth): string {
  const [year, month] = ym.split('-');
  return MONTH_NAMES[Number(month) - 1] + ' ' + year;
}

/**
 * ============================================================================
 * DRILL-DOWN DE UN Count — DaysToClosePivotTable
 * ============================================================================
 *
 * Componente NUEVO, no reusa `components/report/LoanDetailModal.tsx` --
 * evaluado antes de escribir código: ese modal exige `context:
 * DrillDownContext` (con `metric: MetricKey`, atado a 'fc'/'cr'/'ap'/'cl' de
 * Commercial Activity, no a 'appToCtc'/'ctcToDisb') y `strategyFilter`, que
 * decide QUÉ COLUMNAS mostrar de ese otro dominio (Strategy/Owner/Referred
 * By, etc.) -- ninguna sirve acá, y forzar valores neutros ('all') igual
 * mostraría columnas irrelevantes y NINGUNA con el número de días hábiles
 * que es, justamente, la razón de abrir el modal. Mismo patrón visual
 * (`.modal-*`, `.piv`) que los 2 modales existentes de Activity
 * (`LoanDetailModal`/el `GroupDetailModal` local de `DaysToCloseTrends.tsx`),
 * pero un componente propio -- tercer caso de "compartir el CSS, no el
 * componente, cuando el dominio difiere", ya documentado 2 veces en este
 * repo.
 *
 * Muestra las OTRAS 2 dimensiones de contexto (no la agrupada) -- mismo
 * criterio que `otherDimensions()` en `DaysToCloseTrends.tsx`, usando el
 * mismo array `DIMENSIONS` (no una copia).
 */
export default function DaysToClosePivotDrillDown({
  isOpen,
  onClose,
  month,
  groupKey,
  groupBy,
  metric,
  rows,
}: DaysToClosePivotDrillDownProps) {
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

  if (!isOpen || month === null || groupKey === null || metric === null) return null;

  const groupByLabel = GROUP_BY_LABEL[groupBy];
  const metricLabel = METRIC_LABEL[metric];
  const countLabel = rows.length.toLocaleString('en-US') + (rows.length === 1 ? ' loan' : ' loans');
  const contextDims = DIMENSIONS.filter((d) => d.key !== groupBy);
  const ariaLabel = groupByLabel + ' ' + groupKey + ' — ' + metricLabel + ' — ' + monthYearLabel(month);

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
              <div className="modal-eyebrow">Metric</div>
              <div className="modal-context__value">{metricLabel}</div>
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
                  <th>Business Days</th>
                  <th style={{ textAlign: 'left' }}>App Date</th>
                  <th style={{ textAlign: 'left' }}>CTC Date</th>
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
                    <td className="val">{row.days}</td>
                    <td style={{ textAlign: 'left' }}>{row.loan.appDate ?? '—'}</td>
                    <td style={{ textAlign: 'left' }}>{row.loan.ctcDate ?? '—'}</td>
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
