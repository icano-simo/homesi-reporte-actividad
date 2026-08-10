'use client';

import { useEffect } from 'react';
import { healthStatusLabel, healthStatusVariant } from './healthStatus';
import { CloseIcon } from '@/components/ui/icons';

/*
 * ============================================================================
 * AUDIT DRILL-DOWN — flyout lateral (spec §5)
 * ============================================================================
 *
 * Etapa UX1 — REEMPLAZA a `LoanDetailModal.tsx` (borrado). Mismo contrato
 * conceptual (recibe una lista ya filtrada + un título; no sabe nada de
 * branch/canal/cálculos), tres diferencias:
 *
 *  1. Presentación: panel deslizante fijo al borde derecho (520px) sobre un
 *     overlay con blur, en vez de una caja centrada. El spec lo pide así
 *     porque el usuario necesita seguir viendo la tabla de contexto mientras
 *     audita una celda.
 *  2. Columnas: se agregó `Loan Officer` (spec §5) -- el dato ya existía en
 *     PipelineLoan/ResolvedLoan, simplemente no se estaba mostrando.
 *  3. El título se parte en `eyebrow` (contexto: branch/canal) + `title`
 *     (métrica + conteo), en vez de un solo string concatenado.
 *
 * Cierra con click en el overlay, el botón X, o Esc.
 */

export interface LoanDetailDrawerLoan {
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
   * Etapa UX1: de la columna "Branch Transfer" del origen. Solo informativo,
   * no afecta branch ni cálculos. El chip que lo muestra existía desde F5d
   * pero había quedado sin renderizarse en ningún lado cuando el drill-down
   * inline se reemplazó por el modal -- vuelve acá, que es donde se ven los
   * préstamos uno por uno.
   */
  branchTransferred?: boolean;
}

export interface LoanDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Contexto de la celda clickeada, ej. "Branch 707 — Banked - Retail". */
  context: string;
  /** Métrica auditada, ej. "Total Pipeline". El conteo lo agrega este componente. */
  metric: string;
  loans: LoanDetailDrawerLoan[];
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

export default function LoanDetailDrawer({ isOpen, onClose, context, metric, loans }: LoanDetailDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /*
   * Mientras el flyout está abierto se bloquea el scroll del documento. Hace
   * falta ahora y no antes: con el modal centrado el scroll lo manejaba el
   * `.content` interno; desde esta etapa el que scrollea es el <body>, así
   * que sin esto la página de atrás se movía debajo del panel.
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
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={context + ' — ' + metric}>
        <div className="drawer__header">
          <div style={{ minWidth: 0 }}>
            <div className="drawer__eyebrow">{context}</div>
            <h2 className="drawer__title">
              {metric} ({countLabel})
            </h2>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="drawer__body">
          <div className="tbl-scroll">
            <table className="piv">
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Loan Number</th>
                  <th style={{ textAlign: 'left' }}>Borrower Name</th>
                  <th style={{ textAlign: 'left' }}>Loan Officer</th>
                  <th>Amount ($)</th>
                  <th style={{ textAlign: 'left' }}>Milestone</th>
                  <th style={{ textAlign: 'left' }}>Health Status</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr className="metric" key={loan.sourceLoanId}>
                    <td className="lbl">
                      {loan.sourceLoanId}
                      {loan.branchTransferred && (
                        <span
                          className="branch-transfer-chip"
                          title="Branch reassigned due to license (Branch Transfer)"
                        >
                          Transferred
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'left' }}>{loan.borrowerName}</td>
                    <td style={{ textAlign: 'left' }}>{loan.loanOfficer || '—'}</td>
                    <td className="val">{fmtAmount(loan.amount)}</td>
                    <td style={{ textAlign: 'left' }}>{loan.rawMilestone || '—'}</td>
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
      </aside>
    </>
  );
}
