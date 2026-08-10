'use client';

import { useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';

export interface AdverseTableProps {
  /** Etapa F4i, ampliado en F5h/F5j: page.tsx ya filtra por status='adverse' + firstSeenAsAdverse dentro de forecastMonth antes de pasarlo (F5h quitó el filtro por Loan Status; F5j cambió el campo/rango de fecha de Est. Closing Date+Pipeline Range a firstSeenAsAdverse+Forecast Month) -- acá solo se filtra por canal. */
  resolvedLoans: ResolvedLoan[];
  /** Etapa F5j: "August 2026" -- el Forecast Month activo (el mismo criterio de fecha que ya aplicó page.tsx al armar `resolvedLoans`), solo para mostrarlo en el header. Antes (F4i-F5h) era un rango de Pipeline Range/Est. Closing Date -- ya no. */
  forecastMonthLabel?: string;
  /**
   * Etapa F5g: source_loan_id -> fecha 'YYYY-MM-DD' del snapshot más viejo
   * donde ese préstamo ya aparecía como adverse (de /api/pipeline/adverse-history),
   * o null si ese snapshot más viejo encontrado ES el activo (primera vez
   * que se lo ve como adverse -> "New this period"). Ausente del mapa =
   * todavía no llegó la respuesta del endpoint (no confundir con null).
   */
  firstSeenAsAdverse?: Record<string, string | null>;
}

type ChannelFilter = 'all' | PipelineLoan['channel'];

/**
 * Umbral a partir del cual el monto se resalta con badge rosa suave
 * (spec §4E). Constante nombrada en vez del literal 300000 suelto dentro del
 * JSX, que era donde estaba antes.
 */
const HIGH_AMOUNT_THRESHOLD = 300_000;

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
 * pasarlo acá (status='adverse' + Est. Closing Date dentro del rango
 * activo). El filtro por canal de abajo es adicional, sobre ese subconjunto
 * ya acotado al rango.
 *
 * Etapa F5h: se quitó el filtro adicional por Loan Status='Application
 * withdrawn' que tenía F4i -- excluía Adverse legítimos con otros motivos
 * (Application denied, File Closed for incompleteness, Loan Status
 * desincronizado, etc.). Ahora es cualquier préstamo con status='adverse'
 * dentro del rango, sin importar el motivo.
 *
 * Etapa F5j: el campo/rango de fecha del filtro cambió -- ya no es Est.
 * Closing Date dentro de Pipeline Range, es firstSeenAsAdverse (F5g) dentro
 * de Forecast Month (mismo mes que ya usa Cerrados). `resolvedLoans` que
 * llega acá ya viene acotado con ese criterio nuevo -- este componente no
 * lo vuelve a aplicar, solo lo muestra.
 */
export default function AdverseTable({ resolvedLoans, forecastMonthLabel, firstSeenAsAdverse }: AdverseTableProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const adverseLoans = resolvedLoans.filter((loan) => loan.status === 'adverse');
  const filtered = channelFilter === 'all' ? adverseLoans : adverseLoans.filter((loan) => loan.channel === channelFilter);

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">
          Adverse ({filtered.length.toLocaleString('en-US')}){forecastMonthLabel ? ' — ' + forecastMonthLabel : ''}
        </span>
        <select
          className="field"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)}
        >
          <option value="all">All channels</option>
          <option value="Banked - Retail">Banked - Retail</option>
          <option value="Brokered">Brokered</option>
        </select>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <thead>
            {/* Etapa UX1: se quitó `.adverse-header` (header navy sólido con
                !important). El spec §3C fija un header claro para TODAS las
                tablas, así que esta ya no necesita su propia excepción. */}
            <tr className="mo-row">
              <th className="lbl">Loan Number</th>
              <th style={{ textAlign: 'left' }}>Branch</th>
              <th style={{ textAlign: 'left' }}>Borrower Name</th>
              <th style={{ textAlign: 'left' }}>Loan Officer</th>
              <th>Amount</th>
              <th style={{ textAlign: 'left' }}>Last Finished Milestone</th>
              <th style={{ textAlign: 'left' }}>First Seen As Adverse</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((loan) => {
              const firstSeen = firstSeenAsAdverse?.[loan.sourceLoanId];
              return (
                <tr className="metric" key={loan.sourceLoanId}>
                  <td className="lbl">{loan.sourceLoanId}</td>
                  <td style={{ textAlign: 'left' }}>{loan.branch}</td>
                  <td style={{ textAlign: 'left' }}>{loan.borrowerName}</td>
                  <td style={{ textAlign: 'left' }}>{loan.loanOfficer}</td>
                  <td className="val">
                    {loan.amount >= HIGH_AMOUNT_THRESHOLD ? (
                      <span className="badge badge--rose">{fmtAmount(loan.amount)}</span>
                    ) : (
                      fmtAmount(loan.amount)
                    )}
                  </td>
                  <td style={{ textAlign: 'left' }}>{loan.rawMilestone || '—'}</td>
                  <td style={{ textAlign: 'left' }}>
                    {firstSeen === undefined ? '—' : firstSeen === null ? 'New this period' : firstSeen}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={7}>
                  No adverse loans{channelFilter !== 'all' ? ' in this channel' : ''}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
