'use client';

import { useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';

export interface AdverseTableProps {
  resolvedLoans: ResolvedLoan[];
}

type ChannelFilter = 'all' | PipelineLoan['channel'];

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Etapa F4h: tabla informativa de préstamos Adverse (Stage=Closed Lost).
 * Nunca cuentan para ningún cálculo de Forecast (regla desde F4b, sin
 * cambios acá) -- esta tabla solo los lista para consulta/auditoría, con
 * filtro por canal en el cliente (no vuelve a pedir datos, filtra sobre
 * `resolvedLoans` que ya vive en memoria desde el upload).
 */
export default function AdverseTable({ resolvedLoans }: AdverseTableProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const adverseLoans = resolvedLoans.filter((loan) => loan.status === 'adverse');
  const filtered = channelFilter === 'all' ? adverseLoans : adverseLoans.filter((loan) => loan.channel === channelFilter);

  return (
    <div className="tbl-card">
      <div
        className="cards-head"
        style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>Adverse ({filtered.length.toLocaleString('en-US')})</span>
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
          <option value="all">Todos</option>
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
                Sin préstamos adverse{channelFilter !== 'all' ? ' en este canal' : ''}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
