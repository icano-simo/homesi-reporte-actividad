'use client';

import { useEffect } from 'react';
import { healthStatusLabel, healthStatusVariant } from './healthStatus';
import { CloseIcon } from '@/components/ui/icons';

/*
 * ============================================================================
 * AUDIT DRILL-DOWN — modal centrado
 * ============================================================================
 *
 * HOTFIX UX2: vuelve a ser un modal CENTRADO. La etapa anterior lo había
 * convertido en un flyout lateral de 520px pegado al borde derecho; con 6
 * columnas de datos ese ancho quedaba apretado y obligaba a scroll horizontal
 * dentro del panel — justo lo que hay que evitar en una vista de auditoría.
 * Un modal centrado de hasta 768px muestra las 6 columnas enteras.
 *
 * Este componente no sabe nada de branch/canal/cálculos: recibe una lista ya
 * filtrada más el contexto y el nombre de la métrica.
 *
 * Cierra con click en el backdrop, el botón X, o Esc.
 */

export interface LoanDetailModalLoan {
  sourceLoanId: string;
  borrowerName: string;
  loanOfficer: string;
  amount: number;
  rawMilestone: string;
  /**
   * Solo presente en préstamos abiertos (PipelineLoan). ResolvedLoan (ya
   * cerrados) no tiene este campo: ausente = badge '—', no "undefined".
   */
  rawHealthiness?: string;
  /**
   * De la columna "Branch Transfer" del origen. Solo informativo, no afecta
   * branch ni cálculos.
   */
  branchTransferred?: boolean;
}

export interface LoanDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Contexto de la celda clickeada, ej. "Branch 707 — Banked - Retail". */
  context: string;
  /** Métrica auditada, ej. "Total Pipeline". El conteo lo agrega este componente. */
  metric: string;
  loans: LoanDetailModalLoan[];
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function HealthBadge({ rawHealthiness }: { rawHealthiness?: string }) {
  if (rawHealthiness === undefined) {
    return <span style={{ color: 'var(--slate-400)' }}>—</span>;
  }
  const label = healthStatusLabel(rawHealthiness);
  return <span className={'badge badge--pill ' + healthStatusVariant(label)}>{label}</span>;
}

export default function LoanDetailModal({ isOpen, onClose, context, metric, loans }: LoanDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /*
   * Bloquea el scroll del documento mientras el modal está abierto. Hace falta
   * desde el rediseño: antes el scroll lo manejaba un `.content` interno, ahora
   * scrollea el <body> y sin esto la página de atrás se mueve bajo el modal.
   */
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const countLabel = loans.length.toLocaleString('en-US') + (loans.length === 1 ? ' Loan' : ' Loans');

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* stopPropagation: un click DENTRO de la caja no debe cerrar el modal. */}
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label={context + ' — ' + metric}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <div className="modal-eyebrow">{context}</div>
            <h2 className="modal-title">
              {metric}
              <span className="badge badge--pill badge--sky">{countLabel}</span>
            </h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          <table className="piv">
            {/* Anchos explícitos: las 6 columnas entran sin scroll horizontal. */}
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">Loan #</th>
                <th style={{ textAlign: 'left' }}>Borrower</th>
                <th style={{ textAlign: 'left' }}>Loan Officer</th>
                <th>Amount</th>
                <th style={{ textAlign: 'left' }}>Milestone</th>
                <th style={{ textAlign: 'left' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr className="metric" key={loan.sourceLoanId}>
                  <td className="lbl" title={loan.sourceLoanId}>
                    {loan.sourceLoanId}
                    {loan.branchTransferred && (
                      <span className="branch-transfer-chip" title="Branch reassigned due to license (Branch Transfer)">
                        T
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.borrowerName}>
                    {loan.borrowerName}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.loanOfficer}>
                    {loan.loanOfficer || '—'}
                  </td>
                  <td className="val">{fmtAmount(loan.amount)}</td>
                  <td style={{ textAlign: 'left' }} title={loan.rawMilestone}>
                    {loan.rawMilestone || '—'}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <HealthBadge rawHealthiness={loan.rawHealthiness} />
                  </td>
                </tr>
              ))}
              {!loans.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={6}>
                    No loans.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
