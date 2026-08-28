'use client';

import { useEffect, useState } from 'react';
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
  /**
   * Etapa EXCEL-6: mismo patrón que `onActiveStrategyFilterChange` de
   * PivotTable.tsx (EXCEL-1) -- notifica a page.tsx qué canal está activo
   * en el `<select>` de acá abajo, para que `handleExport()` pueda acotar
   * el detalle del Excel al mismo canal cuando se descarga desde esta
   * pestaña. `'all'` significa "sin filtro".
   */
  onChannelFilterChange?: (channel: ChannelFilter) => void;
}

export type ChannelFilter = 'all' | PipelineLoan['channel'];

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
export default function AdverseTable({
  resolvedLoans,
  forecastMonthLabel,
  firstSeenAsAdverse,
  onChannelFilterChange,
}: AdverseTableProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  /*
   * ⚠ Mismo motivo que el cleanup de PivotTable (EXCEL-1): page.tsx solo
   * renderiza AdverseTable en el tab `adverse`. El botón Download Excel es
   * global. Sin el reset al desmontar, elegir un canal acá y cambiar de
   * tab dejaría el export filtrado a un canal sin ningún control visible
   * que lo explique.
   */
  useEffect(() => {
    onChannelFilterChange?.(channelFilter);
    return () => onChannelFilterChange?.('all');
  }, [channelFilter, onChannelFilterChange]);

  const adverseLoans = resolvedLoans.filter((loan) => loan.status === 'adverse');
  const filtered = channelFilter === 'all' ? adverseLoans : adverseLoans.filter((loan) => loan.channel === channelFilter);

  return (
    <>
      {/*
       * Etapa UX10: se reemplaza el texto -- ya no habla de "risk loans"
       * (esa categoría nunca existió en el código: la tabla filtra solo por
       * status === 'adverse', nada de "en riesgo"). Motivo del mismo ajuste
       * que renombra la tab de "Adverse & Risk Loans" a "Adverse Loans".
       */}
      <p className="foot-note" style={{ marginBottom: '16px' }}>
        Loans marked Closed Lost in Salesforce &mdash; deals that left the pipeline without closing. They&apos;re
        listed by the month they were first detected as lost, not by their original expected closing date.
        &ldquo;New this period&rdquo; means the loan turned up as lost for the first time in the current upload. None
        of these count toward Pipeline or Forecast.
      </p>
      <div className="tbl-card">
        <div className="tbl-card__head">
          <span className="tbl-card__title">
            {/* Etapa UX10: "Adverse" -> "Adverse Loans", mismo renombre que la tab (ya no promete "Risk"). */}
            Adverse Loans ({filtered.length.toLocaleString('en-US')}){forecastMonthLabel ? ' — ' + forecastMonthLabel : ''}
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
          <table className="piv piv--adverse">
            {/* Etapa UX10: 8 columnas con ancho explícito -- suma 100%. Se
                agregó Loan Folder; Borrower Name/Loan Officer quedan en 18%
                sin cambios (ver min-width de forecast-visual.css, calculado
                sobre ese 18%) -- el resto se achicó para hacerle lugar. */}
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
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
                <th style={{ textAlign: 'left' }}>Loan Folder</th>
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
                    <td className="val">{fmtAmount(loan.amount)}</td>
                    <td style={{ textAlign: 'left' }}>{loan.rawLoanFolder || '—'}</td>
                    <td style={{ textAlign: 'left' }}>{loan.rawMilestone || '—'}</td>
                    <td style={{ textAlign: 'left' }}>
                      {firstSeen === undefined ? '—' : firstSeen === null ? 'New this period' : firstSeen}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={8}>
                    No adverse loans{channelFilter !== 'all' ? ' in this channel' : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

