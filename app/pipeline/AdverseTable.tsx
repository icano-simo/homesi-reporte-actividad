'use client';

import { useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';

export interface AdverseTableProps {
  /** Etapa F4i: page.tsx ya filtra por status='adverse' + Loan Status='Application withdrawn' + rango de fechas antes de pasarlo -- acá solo se filtra por canal. */
  resolvedLoans: ResolvedLoan[];
  /** Rango de fechas activo (Est. Closing Date), solo para mostrarlo en el header. */
  dateRangeLabel?: string;
}

type ChannelFilter = 'all' | PipelineLoan['channel'];

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Etapa F4h: tabla informativa de préstamos Adverse. Nunca cuentan para
 * ningún cálculo de Forecast (regla desde F4b, sin cambios acá) -- esta
 * tabla solo los lista para consulta/auditoría, con filtro por canal en el
 * cliente (no vuelve a pedir datos).
 *
 * Etapa F4i: ya no es el histórico completo -- page.tsx filtra antes de
 * pasarlo acá (status='adverse' + Loan Status='Application withdrawn' +
 * Est. Closing Date dentro del rango activo). El filtro por canal de abajo
 * es adicional, sobre ese subconjunto ya acotado al rango.
 */
export default function AdverseTable({ resolvedLoans, dateRangeLabel }: AdverseTableProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const adverseLoans = resolvedLoans.filter((loan) => loan.status === 'adverse');
  const filtered = channelFilter === 'all' ? adverseLoans : adverseLoans.filter((loan) => loan.channel === channelFilter);

  return (
    <div className="tbl-card">
      <div
        className="cards-head"
        style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}
      >
        <span>
          Adverse ({filtered.length.toLocaleString('en-US')}) -- active range
          {dateRangeLabel && (
            <span style={{ fontWeight: 400, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>
              {' '}
              (Est. Closing Date {dateRangeLabel})
            </span>
          )}
        </span>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)}
          style={{
            border: '1px solid var(--border)',
            borderRadius: '999px',
            padding: '3px 10px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--muted)',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          <option value="all">All</option>
          <option value="Banked - Retail">Banked - Retail</option>
          <option value="Brokered">Brokered</option>
        </select>
      </div>
      <table className="piv">
        <thead>
          <tr className="mo-row">
            <th style={{ textAlign: 'left' }}>Loan Number</th>
            <th style={{ textAlign: 'left' }}>Branch</th>
            <th style={{ textAlign: 'left' }}>Borrower Name</th>
            <th style={{ textAlign: 'left' }}>Loan Officer</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((loan) => (
            <tr className="metric" key={loan.sourceLoanId}>
              <td style={{ textAlign: 'left' }}>{loan.sourceLoanId}</td>
              <td style={{ textAlign: 'left' }}>{loan.branch}</td>
              <td style={{ textAlign: 'left' }}>{loan.borrowerName}</td>
              <td style={{ textAlign: 'left' }}>{loan.loanOfficer}</td>
              <td className="val">{fmtAmount(loan.amount)}</td>
            </tr>
          ))}
          {!filtered.length && (
            <tr>
              <td style={{ color: 'var(--muted)', fontWeight: 500 }} colSpan={5}>
                No adverse loans{channelFilter !== 'all' ? ' in this channel' : ''}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
