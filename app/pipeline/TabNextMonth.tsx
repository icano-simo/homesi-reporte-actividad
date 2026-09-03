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
          {/*
            Etapa NEXTMONTH-2b: mismo criterio de PivotTable.tsx (.col-pipeline/
            .col-forecast) -- un par de columnas (Loans/Amount) por población,
            agrupadas por un tinte de fondo compartido + `group-start` como
            divisor, en vez de una celda combinada "N ($monto)". Valores crudos
            (count/$), no badges -- se conserva la alineación a la derecha de
            `table.piv td.val` (mismo criterio que Commercial Activity/la
            cascada), sin el centrado que sí tiene sentido en .piv--exec para
            sus badges/píldoras.
          */}
          <table className="piv piv--nextmonth">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">{view === 'branch' ? 'Branch' : 'Strategy'}</th>
                <th className="col-nextmonth group-start">Est Closing Next Month</th>
                <th className="col-nextmonth">Amount</th>
                <th className="col-outofscope group-start">Out of Scope</th>
                <th className="col-outofscope">Amount</th>
                <th className="col-combined group-start">Combined</th>
                <th className="col-combined">Amount</th>
              </tr>
            </thead>
            <tbody>
              {view === 'branch'
                ? byBranchRows.map((row) => (
                    <tr className="metric" key={row.branch}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {row.branch}
                      </td>
                      <td className="val col-nextmonth group-start">{fmtInt(row.estClosingNextMonth.count)}</td>
                      <td className="val col-nextmonth">${fmtAmount(row.estClosingNextMonth.amount)}</td>
                      <td className="val col-outofscope group-start">{fmtInt(row.outOfScope.count)}</td>
                      <td className="val col-outofscope">${fmtAmount(row.outOfScope.amount)}</td>
                      <td className="val col-combined group-start">{fmtInt(row.combined.count)}</td>
                      <td className="val col-combined">${fmtAmount(row.combined.amount)}</td>
                    </tr>
                  ))
                : byStrategyRows.map((row) => (
                    <tr className="metric" key={row.strategy}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {row.strategy}
                      </td>
                      <td className="val col-nextmonth group-start">{fmtInt(row.estClosingNextMonth.count)}</td>
                      <td className="val col-nextmonth">${fmtAmount(row.estClosingNextMonth.amount)}</td>
                      <td className="val col-outofscope group-start">{fmtInt(row.outOfScope.count)}</td>
                      <td className="val col-outofscope">${fmtAmount(row.outOfScope.amount)}</td>
                      <td className="val col-combined group-start">{fmtInt(row.combined.count)}</td>
                      <td className="val col-combined">${fmtAmount(row.combined.amount)}</td>
                    </tr>
                  ))}
              {view === 'branch' && !byBranchRows.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={7}>
                    No data.
                  </td>
                </tr>
              )}
              {view === 'strategy' && !byStrategyRows.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={7}>
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
