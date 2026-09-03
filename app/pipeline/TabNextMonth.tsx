'use client';

import { useState } from 'react';
import type { NextMonthByBranchRow, NextMonthByStrategyRow, NextMonthCell, CountAmount } from '@/lib/pipeline/nextMonth';
import type { PipelineLoan } from '@/lib/pipeline/types';
import LoanDetailModal, { type LoanDetailModalLoan } from './LoanDetailModal';

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

/**
 * Etapa NEXTMONTH-3: mismo mapper que PivotTable.tsx (openLoanToModalLoan,
 * ~línea 690) -- copiado tal cual, no importado. Mismo criterio que ya usa
 * el repo: este mapper está duplicado en PivotTable.tsx 3 veces, no
 * exportado; no se refactoriza PivotTable.tsx para exportarlo acá, eso es
 * otro alcance.
 */
function openLoanToModalLoan(loan: PipelineLoan): LoanDetailModalLoan {
  return {
    sourceLoanId: loan.sourceLoanId,
    branch: loan.branch,
    strategyRaw: loan.strategyRaw,
    opportunityOwnerTitle: loan.opportunityOwnerTitle,
    nppmRealtor: loan.nppmRealtor,
    referredBy: loan.referredBy,
    borrowerName: loan.borrowerName,
    loanOfficer: loan.loanOfficer,
    channel: loan.channel,
    amount: loan.amount,
    rawMilestone: loan.rawMilestone,
    rawHealthiness: loan.rawHealthiness,
    branchTransferred: loan.branchTransferred,
    loanType: loan.loanType,
    loanProgram: loan.loanProgram,
    noteHistory: loan.noteHistory,
    propertyState: loan.propertyState,
  };
}

/** Estado del modal de drill-down: qué celda se clickeó y qué préstamos hay detrás. Mismo shape reducido que ModalState de PivotTable.tsx (sin sections/showChannelColumn -- no hay split Banked/Brokered acá). */
interface ModalState {
  context: string;
  metric: string;
  loans: LoanDetailModalLoan[];
}

/** Mismo patrón que CountCell de PivotTable.tsx (~línea 1218): botón cuando hay préstamos, texto plano en 0 -- Amount nunca pasa por acá, no es clickeable (número calculado, no una lista de préstamos). */
function CountCell({ cell, onClick }: { cell: NextMonthCell; onClick: () => void }) {
  if (cell.count === 0) {
    return <span className="cell-trigger is-zero">0</span>;
  }
  return (
    <button type="button" className="cell-trigger" onClick={onClick}>
      {fmtInt(cell.count)}
    </button>
  );
}

export default function TabNextMonth({ estClosingNextMonth, outOfScope, combined, byBranchRows, byStrategyRows }: TabNextMonthProps) {
  const [view, setView] = useState<'branch' | 'strategy'>('branch');
  const [modal, setModal] = useState<ModalState | null>(null);

  /** "Branch {code}", mismo criterio que contextForBranch() de PivotTable.tsx. */
  function contextForBranch(branch: string): string {
    return `Branch ${branch}`;
  }

  function openCell(context: string, metric: string, loans: PipelineLoan[]) {
    setModal({ context, metric, loans: loans.map(openLoanToModalLoan) });
  }

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
                      <td className="val col-nextmonth group-start">
                        <CountCell
                          cell={row.estClosingNextMonth}
                          onClick={() => openCell(contextForBranch(row.branch), 'Est Closing Next Month', row.estClosingNextMonth.loans)}
                        />
                      </td>
                      <td className="val col-nextmonth">${fmtAmount(row.estClosingNextMonth.amount)}</td>
                      <td className="val col-outofscope group-start">
                        <CountCell
                          cell={row.outOfScope}
                          onClick={() => openCell(contextForBranch(row.branch), 'Out of Scope', row.outOfScope.loans)}
                        />
                      </td>
                      <td className="val col-outofscope">${fmtAmount(row.outOfScope.amount)}</td>
                      <td className="val col-combined group-start">
                        <CountCell cell={row.combined} onClick={() => openCell(contextForBranch(row.branch), 'Combined', row.combined.loans)} />
                      </td>
                      <td className="val col-combined">${fmtAmount(row.combined.amount)}</td>
                    </tr>
                  ))
                : byStrategyRows.map((row) => (
                    <tr className="metric" key={row.strategy}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {row.strategy}
                      </td>
                      <td className="val col-nextmonth group-start">
                        <CountCell
                          cell={row.estClosingNextMonth}
                          onClick={() => openCell(row.strategy, 'Est Closing Next Month', row.estClosingNextMonth.loans)}
                        />
                      </td>
                      <td className="val col-nextmonth">${fmtAmount(row.estClosingNextMonth.amount)}</td>
                      <td className="val col-outofscope group-start">
                        <CountCell cell={row.outOfScope} onClick={() => openCell(row.strategy, 'Out of Scope', row.outOfScope.loans)} />
                      </td>
                      <td className="val col-outofscope">${fmtAmount(row.outOfScope.amount)}</td>
                      <td className="val col-combined group-start">
                        <CountCell cell={row.combined} onClick={() => openCell(row.strategy, 'Combined', row.combined.loans)} />
                      </td>
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

      <LoanDetailModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        context={modal?.context ?? ''}
        metric={modal?.metric ?? ''}
        loans={modal?.loans ?? []}
      />
    </>
  );
}
