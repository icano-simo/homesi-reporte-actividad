'use client';

import { useState } from 'react';
import type { NextMonthByBranchRow, NextMonthByStrategyRow, CountAmount } from '@/lib/pipeline/nextMonth';

// Etapa NEXTMONTH-2 — ARCHIVO NUEVO.
//
// Puramente presentacional -- no llama a buildNextMonthPopulations() ni a
// ninguna función de lib/pipeline/nextMonth.ts acá adentro. Recibe todo ya
// calculado, mismo patrón que PivotTable/AdverseTable.

export interface TabNextMonthProps {
  estClosingNextMonth: CountAmount;
  outOfScope: CountAmount;
  combined: CountAmount;
  byBranchRows: NextMonthByBranchRow[];
  byStrategyRows: NextMonthByStrategyRow[];
}

// Mismo patrón que AdverseTable.tsx/TabAnalytics.tsx: cada componente de esta
// carpeta tiene su propia copia de fmtInt/fmtAmount, no hay un helper
// compartido.
function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** "73" -> "73 Loans" / "1 Loan", mismo criterio que loansLabel() de SummaryCards.tsx. */
function loansLabel(n: number): string {
  return fmtInt(n) + (n === 1 ? ' Loan' : ' Loans');
}

/** "N ($monto)" -- formato de celda de la tabla por branch/strategy. */
function fmtCell(ca: CountAmount): string {
  return fmtInt(ca.count) + ' ($' + fmtAmount(ca.amount) + ')';
}

export default function TabNextMonth({ estClosingNextMonth, outOfScope, combined, byBranchRows, byStrategyRows }: TabNextMonthProps) {
  const [view, setView] = useState<'branch' | 'strategy'>('branch');

  return (
    <>
      <div className="hero-banner">
        <div className="mcard">
          <div className="m-name">Est Closing Next Month</div>
          <div className="kpi-hero__value">{loansLabel(estClosingNextMonth.count)}</div>
          <div className="kpi-hero__sub">${fmtAmount(estClosingNextMonth.amount)}</div>
        </div>
        <div className="mcard">
          <div className="m-name">Out of Scope</div>
          <div className="kpi-hero__value">{loansLabel(outOfScope.count)}</div>
          <div className="kpi-hero__sub">${fmtAmount(outOfScope.amount)}</div>
        </div>
        <div className="mcard">
          <div className="m-name">Combined</div>
          <div className="kpi-hero__value">{loansLabel(combined.count)}</div>
          <div className="kpi-hero__sub">${fmtAmount(combined.amount)}</div>
        </div>
      </div>

      {/* Mismo patrón visual/de estado que el toggle "By branch"/"By strategy" de PivotTable.tsx (`.seg`, clase `on` en el botón activo). */}
      <div className="seg">
        <button type="button" className={view === 'branch' ? 'on' : ''} onClick={() => setView('branch')}>
          By branch
        </button>
        <button type="button" className={view === 'strategy' ? 'on' : ''} onClick={() => setView('strategy')}>
          By strategy
        </button>
      </div>

      <div className="tbl-card" style={{ marginTop: '12px' }}>
        <div className="tbl-card__head">
          <span className="tbl-card__title">{view === 'branch' ? 'By Branch' : 'By Strategy'}</span>
        </div>
        <div className="tbl-scroll">
          <table className="piv">
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">{view === 'branch' ? 'Branch' : 'Strategy'}</th>
                <th>Est Closing Next Month</th>
                <th>Out of Scope</th>
                <th>Combined</th>
              </tr>
            </thead>
            <tbody>
              {view === 'branch'
                ? byBranchRows.map((row) => (
                    <tr className="metric" key={row.branch}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {row.branch}
                      </td>
                      <td className="val">{fmtCell(row.estClosingNextMonth)}</td>
                      <td className="val">{fmtCell(row.outOfScope)}</td>
                      <td className="val">{fmtCell(row.combined)}</td>
                    </tr>
                  ))
                : byStrategyRows.map((row) => (
                    <tr className="metric" key={row.strategy}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {row.strategy}
                      </td>
                      <td className="val">{fmtCell(row.estClosingNextMonth)}</td>
                      <td className="val">{fmtCell(row.outOfScope)}</td>
                      <td className="val">{fmtCell(row.combined)}</td>
                    </tr>
                  ))}
              {view === 'branch' && !byBranchRows.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={4}>
                    No data.
                  </td>
                </tr>
              )}
              {view === 'strategy' && !byStrategyRows.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={4}>
                    No data.
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
