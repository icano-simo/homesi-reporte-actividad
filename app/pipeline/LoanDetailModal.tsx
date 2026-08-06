'use client';

import { useEffect } from 'react';
// Ajuste posterior: import circular con PivotTable.tsx -- ese archivo ya
// importa LoanDetailModal (para renderizarlo), y este importa de vuelta
// healthStatusLabel/healthStatusColor de PivotTable.tsx (para no duplicar
// la clasificación de salud). Verificado que no rompe build ni runtime
// (tsc --noEmit limpio, npm run build sin warning de dependencia circular,
// dev server sin errores de "Cannot access before initialization") --
// funciona porque son funciones puras, usadas solo dentro de un render, no
// evaluadas en el top-level del módulo. Si algún día se vuelve un problema
// real, la solución es mover healthStatusLabel/healthStatusColor a un
// archivo neutral que ambos importen, en vez de que se importen entre sí.
import { healthStatusLabel, healthStatusColor } from './PivotTable';

export interface LoanDetailModalLoan {
  sourceLoanId: string;
  borrowerName: string;
  amount: number;
  rawMilestone: string;
  /** Solo present en préstamos abiertos (PipelineLoan) -- ResolvedLoan (préstamos ya cerrados) no tiene este campo en su tipo, ausente = badge '—' en vez de romper o mostrar "undefined". */
  rawHealthiness?: string;
}

export interface LoanDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  loans: LoanDetailModalLoan[];
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Ajuste posterior: antes derivaba el texto del boolean `healthy`
 * (true/false/null) en vez de mostrar las 4 categorías reales de
 * rawHealthiness (On Track/Delayed/Out of Scope/Never). Reusa
 * healthStatusLabel()/healthStatusColor() de PivotTable.tsx en vez de
 * duplicar la clasificación acá -- no se toca classifyHealthy() ni el
 * campo `healthy`, esto es solo el texto/color del badge. rawHealthiness
 * undefined (préstamos ya cerrados, ResolvedLoan no trae ese campo)
 * muestra un simple "—", mismo criterio que ya usaba PivotTable.tsx para
 * esos casos.
 */
function HealthBadge({ rawHealthiness }: { rawHealthiness?: string }) {
  if (rawHealthiness === undefined) {
    return <span style={{ color: 'var(--muted)' }}>—</span>;
  }
  const label = healthStatusLabel(rawHealthiness);
  const { background, color } = healthStatusColor(label);
  return (
    <span
      style={{
        background,
        color,
        borderRadius: '9999px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Ajuste posterior a F6e: reemplaza la fila expandible inline por un modal
 * centrado -- PivotTable.tsx arma `loans` según qué celda se clickeó
 * (Total Pipeline/Healthy Pipeline/Closed) y le pasa acá solo la lista +
 * un título, este componente no sabe nada de branch/channel/cálculos.
 * Cierra con click en el overlay, el botón X, o Esc.
 */
export default function LoanDetailModal({ isOpen, onClose, title, loans }: LoanDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>
            {title} ({loans.length.toLocaleString('en-US')})
          </span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <table className="piv" style={{ width: '100%' }}>
            <thead>
              <tr className="mo-row">
                <th style={{ textAlign: 'left' }}>Loan Number</th>
                <th style={{ textAlign: 'left' }}>Borrower Name</th>
                <th>Amount</th>
                <th style={{ textAlign: 'left' }}>Milestone</th>
                <th style={{ textAlign: 'left' }}>Health Status</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr className="metric" key={loan.sourceLoanId}>
                  <td style={{ textAlign: 'left' }}>{loan.sourceLoanId}</td>
                  <td style={{ textAlign: 'left' }}>{loan.borrowerName}</td>
                  <td className="val">{fmtAmount(loan.amount)}</td>
                  <td style={{ textAlign: 'left' }}>{loan.rawMilestone || '—'}</td>
                  <td style={{ textAlign: 'left' }}>
                    <HealthBadge rawHealthiness={loan.rawHealthiness} />
                  </td>
                </tr>
              ))}
              {!loans.length && (
                <tr>
                  <td style={{ color: 'var(--muted)', fontWeight: 500 }} colSpan={5}>
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
