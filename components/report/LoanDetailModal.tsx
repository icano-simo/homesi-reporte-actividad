'use client';

import { useEffect } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import type { DrillDownContext } from '@/lib/aggregation/loansForCell';
import { METRICS, MONTH_NAMES } from '@/config/metrics';
import { CloseIcon } from '@/components/ui/icons';

export interface LoanDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** null cuando no hay drill-down activo -- el componente igual retorna null en ese caso. */
  context: DrillDownContext | null;
  /** Ya filtrados por loansForCell() -- este componente no filtra ni calcula nada, solo muestra. */
  loans: LoanRecord[];
}

/**
 * Drill-down de Activity (Fase 1) -- modal CENTRADO, mismo patrón visual que
 * `app/pipeline/LoanDetailModal.tsx` (clases `.modal-*` globales de
 * `app/styles/components.css`), pero NO es el mismo componente ni comparte
 * dominio: los campos de un LoanRecord de Activity no tienen nada que ver con
 * los de un loan de Forecast/Pipeline (sin borrowerName, sin milestone/health
 * de Forecast). Ver auditoría previa a esta etapa -- decisión explícita de no
 * reutilizar el modal de Forecast.
 *
 * Fase 1: solo MES/AÑO en el header (sin día) y sin columna de fecha en la
 * tabla -- todos los loans de una celda comparten el mismo mes por
 * definición, así que no hace falta repetirlo por fila.
 */
function monthYearLabel(ym: string): string {
  const [year, month] = ym.split('-');
  return MONTH_NAMES[Number(month) - 1] + ' ' + year;
}

function metricLabel(metric: DrillDownContext['metric']): string {
  return METRICS.find((m) => m.key === metric)?.label ?? metric;
}

/** '' (channel vacío, Etapa 2 de Activity) se muestra como "Unclassified" -- mismo criterio de negocio que CHANNEL_OPTIONS en Toolbar.tsx, sin inventar uno nuevo. */
function channelLabel(loanInfoChannel: string): string {
  return loanInfoChannel || 'Unclassified';
}

export default function LoanDetailModal({ isOpen, onClose, context, loans }: LoanDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Bloquea el scroll del documento mientras el modal está abierto -- mismo
  // patrón que el modal de Forecast, necesario porque acá también scrollea
  // el <body> y no un contenedor interno.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen || !context) return null;

  const countLabel = loans.length.toLocaleString('en-US') + (loans.length === 1 ? ' loan' : ' loans');
  const title = metricLabel(context.metric) + ' · ' + monthYearLabel(context.month);
  const eyebrow = context.drillName
    ? (context.drillBy === 'bd' ? 'BD: ' : 'Loan Officer: ') + context.drillName
    : context.branch
      ? 'Branch ' + context.branch
      : 'All branches';

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* stopPropagation: un click DENTRO de la caja no debe cerrar el modal. */}
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label={title + ' — ' + eyebrow}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <div className="modal-eyebrow">{eyebrow}</div>
            <h2 className="modal-title">
              {title}
              <span className="badge badge--pill badge--sky">{countLabel}</span>
            </h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          <table className="piv">
            {/*
             * Anchos explícitos: las 6 columnas entran sin scroll horizontal.
             * Ajuste post-validación visual: se quitó Affinity -- no es un
             * atributo individual del loan en este drill-down (Affinity es un
             * modelo de negocio que Activity ya representa vía branch
             * 'AFFINITY', ver classifyBranch; un loan con True OrgID de otro
             * branch, ej. 716 o 700, puede pertenecer igual a ese modelo, así
             * que el campo crudo LoanRecord.affinity quedaba fuera de lugar
             * acá). Branch se conserva -- ese sí es el branch clasificado del
             * loan, y ya puede mostrar 'AFFINITY' cuando corresponde.
             */}
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">Loan #</th>
                <th style={{ textAlign: 'left' }}>Loan Officer</th>
                <th style={{ textAlign: 'left' }}>Branch</th>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th>B2B</th>
                <th style={{ textAlign: 'left' }}>Program</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan, i) => (
                <tr className="metric" key={loan.loanNumber || i}>
                  <td className="lbl" title={loan.loanNumber}>
                    {loan.loanNumber || '—'}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.loanOfficer}>
                    {loan.loanOfficer}
                  </td>
                  <td style={{ textAlign: 'left' }}>{loan.branch}</td>
                  <td style={{ textAlign: 'left' }} title={channelLabel(loan.loanInfoChannel)}>
                    {channelLabel(loan.loanInfoChannel)}
                  </td>
                  <td style={{ textAlign: 'center' }}>{loan.isB2B ? 'Yes' : 'No'}</td>
                  <td style={{ textAlign: 'left' }} title={loan.loanProgram}>
                    {loan.loanProgram || '—'}
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
