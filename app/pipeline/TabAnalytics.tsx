'use client';

import { useState } from 'react';
import type { ResolvedLoan } from '@/lib/pipeline/types';
import { buildLoanProgramRanking, buildLoanTypeRanking, earliestFundedDisbursementDate, fundedLoansInRange, type RankingRow } from '@/lib/pipeline/analytics';
import { getDefaultPeriodSelection, periodDateRange, periodLabel, type PeriodSelection } from '@/lib/pipeline/period';
import PeriodSelector from './PeriodSelector';

export interface TabAnalyticsProps {
  /** Mismo array que ya reciben PivotTable/AdverseTable -- pipeline_resolved_loans del snapshot activo, sin filtrar por canal ni por fecha todavía. */
  resolvedLoans: ResolvedLoan[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function RankingTable({
  title,
  columnLabel,
  rows,
  totalCount,
}: {
  title: string;
  columnLabel: string;
  rows: RankingRow[];
  totalCount: number;
}) {
  const rowsTotalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const rowsTotalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

  /*
   * Red de seguridad, mismo criterio que splitCtcAndClosing/aggregate.ts: el
   * ranking agrupa TODOS los loans que recibe (el vacío va a "Sin
   * programa"/"Sin tipo", nunca se descarta uno), así que la suma de sus
   * counts tiene que coincidir siempre con el total de funded del período.
   * Si no coincide, es un préstamo contado dos veces o ninguna -- se avisa en
   * dev, no se esconde.
   */
  if (process.env.NODE_ENV !== 'production' && rowsTotalCount !== totalCount) {
    console.warn(`[TabAnalytics] ${title}: rowsTotalCount (${rowsTotalCount}) no coincide con totalCount (${totalCount})`);
  }

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">
          {title} ({fmtInt(rowsTotalCount)})
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <colgroup>
            <col style={{ width: '55%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '25%' }} />
          </colgroup>
          <thead>
            <tr className="mo-row">
              <th className="lbl">{columnLabel}</th>
              <th>Count</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="metric" key={row.label}>
                <td className="lbl" style={{ textAlign: 'left' }}>
                  {row.label}
                </td>
                <td className="val">{fmtInt(row.count)}</td>
                <td className="val">{fmtAmount(row.amount)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={3}>
                  No funded loans in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="grp total">
                <td className="lbl">Total</td>
                <td className="val">{fmtInt(rowsTotalCount)}</td>
                <td className="val">{fmtAmount(rowsTotalAmount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Tab 4 — Analytics (Etapa F7, Parte 1): selector de período + rankings de
 * Loan Program y Loan Type. Solo lectura sobre `pipeline_resolved_loans`
 * (status='funded', filtrado por `disbursementDate` -- nunca `estClosingDate`,
 * regla explícita del brief). No toca ninguna regla de cálculo existente:
 * pull-through, Healthy, Adverse y las estrategias comerciales quedan
 * idénticos -- esta pestaña es un corte nuevo e independiente sobre los
 * mismos datos ya cargados.
 */
export default function TabAnalytics({ resolvedLoans }: TabAnalyticsProps) {
  const [period, setPeriod] = useState<PeriodSelection>(() => getDefaultPeriodSelection());

  const range = periodDateRange(period);
  const earliestDate = earliestFundedDisbursementDate(resolvedLoans);
  /*
   * "Nunca un total incompleto disfrazado de total completo": si el período
   * pedido empieza antes de la disbursementDate más antigua que existe en el
   * snapshot, lo que se muestra no es "todo el período", es solo la parte que
   * el historial realmente cubre -- se avisa explícito en vez de mostrar un
   * número que parece completo y no lo es.
   */
  const exceedsHistory = earliestDate !== null && range.startDate < earliestDate;

  const fundedInRange = fundedLoansInRange(resolvedLoans, range);
  const programRanking = buildLoanProgramRanking(fundedInRange);
  const typeRanking = buildLoanTypeRanking(fundedInRange);

  return (
    <>
      <p className="foot-note" style={{ marginBottom: '16px' }}>
        Funded loans (Disbursement Date) grouped by Loan Program and Loan Type, for the selected period. Read-only —
        doesn&apos;t affect pull-through, Healthy, Adverse, or strategy calculations elsewhere in Forecast.
      </p>

      <div className="control-bar" style={{ marginBottom: '16px' }}>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {exceedsHistory && (
        <p className="pill warn" style={{ marginBottom: '16px', display: 'inline-flex' }}>
          Data only goes back to {earliestDate}. {periodLabel(period)} ({range.startDate} to {range.endDate}) extends
          earlier than that — totals below cover only {earliestDate} to {range.endDate}, not the full period
          requested.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
        <RankingTable title="Loan Program" columnLabel="Program" rows={programRanking} totalCount={fundedInRange.length} />
        <RankingTable title="Loan Type" columnLabel="Type" rows={typeRanking} totalCount={fundedInRange.length} />
      </div>
    </>
  );
}
