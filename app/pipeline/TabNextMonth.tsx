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

/**
 * Etapa NEXTMONTH-9: un array por canal, ya filtrado y agregado en page.tsx
 * (buildNextMonthByBranch()/buildNextMonthByStrategy() sobre una población
 * filtrada por channel vía filterPopulationsByChannel(), lib/pipeline/
 * nextMonth.ts) -- mismo shape {banked, brokered} que ya usa page.tsx para
 * strategyPages en el export de PDF, no un mecanismo nuevo.
 */
interface ByChannel<T> {
  banked: T[];
  brokered: T[];
}

export interface TabNextMonthProps {
  estClosingNextMonth: CountAmount;
  outOfScope: CountAmount;
  combined: CountAmount;
  byBranchRows: ByChannel<NextMonthByBranchRow>;
  byStrategyRows: ByChannel<NextMonthByStrategyRow>;
  /** Etapa NEXTMONTH-8: branch -> nombre del Branch Manager (pipeline_forecast.branch_managers) -- mismo Map que ya recibe PivotTable.tsx, cargado una sola vez en page.tsx. Vacío si no cargó. */
  branchManagers: Map<string, string>;
}

/** Mismo fallback que PivotTable.tsx:209 -- UNASSIGNED_MANAGER no está exportada desde ahí, se redefine acá tal cual. */
const UNASSIGNED_MANAGER = '(unassigned)';

/**
 * Etapa NEXTMONTH-7: selector de población tipo píldora -- reemplaza los 3
 * pares de columnas fijos por una sola tabla que muestra UNA población a
 * la vez, elegida acá.
 *
 * El tinte de fondo por color (`col-nextmonth`/`col-outofscope`/
 * `col-combined`, Etapa NEXTMONTH-2b/5/6) se retiró de la tabla -- ya no
 * aplica con una sola población visible a la vez (esos 3 colores existían
 * para distinguir 3 pares de columnas simultáneos). Queda solo la línea
 * divisoria (`group-start`, sin color) entre el label y los valores.
 */
const POPULATION_OPTIONS = [
  { key: 'estClosingNextMonth', label: 'Est Closing Next Month' },
  { key: 'outOfScope', label: 'Out of Scope' },
  { key: 'combined', label: 'Combined' },
] as const;
type PopulationKey = (typeof POPULATION_OPTIONS)[number]['key'];

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

/** Suma una población (count/amount) sobre todas las filas -- sin recalcular nada de lib/pipeline/nextMonth.ts, es una suma directa sobre los NextMonthCell ya recibidos por prop. */
function sumPopulation<T>(rows: T[], pick: (row: T) => NextMonthCell): CountAmount {
  return rows.reduce(
    (acc, row) => {
      const cell = pick(row);
      return { count: acc.count + cell.count, amount: acc.amount + cell.amount };
    },
    { count: 0, amount: 0 }
  );
}

/**
 * Etapa NEXTMONTH-4, reducida en NEXTMONTH-7 a una sola población (la
 * píldora activa) -- mismo patrón que ExecTotalRow de PivotTable.tsx:
 * `tr.grp.total`, `td.lbl`, celda de valor con `group-start` (sin tinte de
 * color, retirado -- ver el comentario de POPULATION_OPTIONS) para que la
 * línea divisoria se vea continua hasta el total. Sin CountCell/onClick --
 * el total no es clickeable, es una suma, no una lista de préstamos propia.
 */
function TotalRow({ label, value, labelColSpan = 1 }: { label: string; value: CountAmount; labelColSpan?: number }) {
  return (
    <tr className="grp total">
      <td className="lbl" colSpan={labelColSpan}>
        {label}
      </td>
      <td className="val group-start">{fmtInt(value.count)}</td>
      <td className="val">${fmtAmount(value.amount)}</td>
    </tr>
  );
}

/**
 * Etapa NEXTMONTH-9: mismo orden/etiquetas que CHANNEL_ORDER de
 * PivotTable.tsx (`['Banked - Retail', 'Brokered']`) -- `key` es solo el
 * nombre de la mitad de `ByChannel<T>` que le corresponde a cada bloque.
 */
const CHANNEL_BLOCKS: { key: 'banked' | 'brokered'; label: string }[] = [
  { key: 'banked', label: 'Banked - Retail' },
  { key: 'brokered', label: 'Brokered' },
];

/**
 * Etapa NEXTMONTH-9: un bloque de canal -- mismo patrón visual que
 * buildChannelBlocks()/`.tbl-card` de PivotTable.tsx (líneas 1616-1694):
 * título = nombre del canal, tabla propia, `TotalRow` propio ("Subtotal
 * {canal}"). Los controles (view/population, arriba en TabNextMonth) son
 * compartidos entre los 2 bloques -- este componente solo recibe las rows
 * YA filtradas por canal y por view, no decide ninguno de los 2.
 */
function ChannelBlock({
  label,
  view,
  population,
  populationLabel,
  branchRows,
  strategyRows,
  branchManagers,
  openCell,
  contextForBranch,
}: {
  label: string;
  view: 'branch' | 'strategy';
  population: PopulationKey;
  populationLabel: string;
  branchRows: NextMonthByBranchRow[];
  strategyRows: NextMonthByStrategyRow[];
  branchManagers: Map<string, string>;
  openCell: (context: string, metric: string, loans: PipelineLoan[]) => void;
  contextForBranch: (branch: string) => string;
}) {
  const total =
    view === 'branch' ? sumPopulation(branchRows, (r) => r[population]) : sumPopulation(strategyRows, (r) => r[population]);

  return (
    <div className="tbl-card" style={{ marginTop: '12px' }}>
      <div className="tbl-card__head">
        <span className="tbl-card__title">{label}</span>
      </div>
      <div className="tbl-scroll">
        <table className="piv piv--nextmonth">
          {view === 'branch' ? (
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '30%' }} />
            </colgroup>
          ) : (
            <colgroup>
              <col style={{ width: '40%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '30%' }} />
            </colgroup>
          )}
          <thead>
            <tr className="mo-row">
              {view === 'branch' ? (
                <>
                  <th className="lbl">Branch</th>
                  <th style={{ textAlign: 'left' }}>Branch Manager</th>
                </>
              ) : (
                <th className="lbl">Strategy</th>
              )}
              <th className="group-start">{populationLabel}</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {view === 'branch'
              ? branchRows.map((row) => (
                  <tr className="metric" key={row.branch}>
                    <td className="lbl" style={{ textAlign: 'left' }}>
                      {row.branch}
                    </td>
                    <td style={{ textAlign: 'left' }} title={branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}>
                      {branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}
                    </td>
                    <td className="val group-start">
                      <CountCell
                        cell={row[population]}
                        onClick={() => openCell(contextForBranch(row.branch), populationLabel, row[population].loans)}
                      />
                    </td>
                    <td className="val">${fmtAmount(row[population].amount)}</td>
                  </tr>
                ))
              : strategyRows.map((row) => (
                  <tr className="metric" key={row.strategy}>
                    <td className="lbl" style={{ textAlign: 'left' }}>
                      {row.strategy}
                    </td>
                    <td className="val group-start">
                      <CountCell
                        cell={row[population]}
                        onClick={() => openCell(row.strategy, populationLabel, row[population].loans)}
                      />
                    </td>
                    <td className="val">${fmtAmount(row[population].amount)}</td>
                  </tr>
                ))}
            {view === 'branch' && !branchRows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={4}>
                  No data.
                </td>
              </tr>
            )}
            {view === 'strategy' && !strategyRows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={3}>
                  No data.
                </td>
              </tr>
            )}
            <TotalRow label={'Subtotal ' + label} value={total} labelColSpan={view === 'branch' ? 2 : 1} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TabNextMonth({
  estClosingNextMonth,
  outOfScope,
  combined,
  byBranchRows,
  byStrategyRows,
  branchManagers,
}: TabNextMonthProps) {
  const [view, setView] = useState<'branch' | 'strategy'>('branch');
  const [population, setPopulation] = useState<PopulationKey>('combined');
  const [modal, setModal] = useState<ModalState | null>(null);
  const activePopulation = POPULATION_OPTIONS.find((p) => p.key === population)!;

  /** "Branch {code}", mismo criterio que contextForBranch() de PivotTable.tsx. */
  function contextForBranch(branch: string): string {
    return `Branch ${branch}`;
  }

  function openCell(context: string, metric: string, loans: PipelineLoan[]) {
    setModal({ context, metric, loans: loans.map(openLoanToModalLoan) });
  }

  /** Suma un CountAmount de cada canal -- para el chequeo de abajo, que compara contra las tarjetas KPI (combinadas, nunca separadas por canal -- ver alcance de esta etapa). */
  const addCA = (a: CountAmount, b: CountAmount): CountAmount => ({ count: a.count + b.count, amount: a.amount + b.amount });

  const byBranchTotals = {
    estClosingNextMonth: addCA(
      sumPopulation(byBranchRows.banked, (r) => r.estClosingNextMonth),
      sumPopulation(byBranchRows.brokered, (r) => r.estClosingNextMonth)
    ),
    outOfScope: addCA(
      sumPopulation(byBranchRows.banked, (r) => r.outOfScope),
      sumPopulation(byBranchRows.brokered, (r) => r.outOfScope)
    ),
    combined: addCA(
      sumPopulation(byBranchRows.banked, (r) => r.combined),
      sumPopulation(byBranchRows.brokered, (r) => r.combined)
    ),
  };
  const byStrategyTotals = {
    estClosingNextMonth: addCA(
      sumPopulation(byStrategyRows.banked, (r) => r.estClosingNextMonth),
      sumPopulation(byStrategyRows.brokered, (r) => r.estClosingNextMonth)
    ),
    outOfScope: addCA(
      sumPopulation(byStrategyRows.banked, (r) => r.outOfScope),
      sumPopulation(byStrategyRows.brokered, (r) => r.outOfScope)
    ),
    combined: addCA(
      sumPopulation(byStrategyRows.banked, (r) => r.combined),
      sumPopulation(byStrategyRows.brokered, (r) => r.combined)
    ),
  };

  /**
   * Etapa NEXTMONTH-4, extendida en NEXTMONTH-9: verificación de desarrollo,
   * mismo estilo que el `console.warn` de CTC+Closing en page.tsx -- el total
   * de cada columna (suma de byBranchRows/byStrategyRows, AHORA sumando
   * banked+brokered porque el split de canal no cambia el total combinado)
   * tiene que coincidir EXACTO con summarizeCountAmount() de esa población
   * (la misma fuente que ya alimenta las 3 tarjetas KPI, recibida acá por
   * prop -- las tarjetas KPI siguen combinadas, sin split, ver alcance). No
   * debería fallar nunca -- es la misma fuente sumada de formas distintas --
   * pero si algún día no cuadra, mejor un aviso en consola que un número
   * mudo.
   */
  if (process.env.NODE_ENV !== 'production') {
    const checks: [string, CountAmount, CountAmount][] = [
      ['byBranch / Est Closing Next Month', byBranchTotals.estClosingNextMonth, estClosingNextMonth],
      ['byBranch / Out of Scope', byBranchTotals.outOfScope, outOfScope],
      ['byBranch / Combined', byBranchTotals.combined, combined],
      ['byStrategy / Est Closing Next Month', byStrategyTotals.estClosingNextMonth, estClosingNextMonth],
      ['byStrategy / Out of Scope', byStrategyTotals.outOfScope, outOfScope],
      ['byStrategy / Combined', byStrategyTotals.combined, combined],
    ];
    for (const [label, rowsSum, kpi] of checks) {
      if (rowsSum.count !== kpi.count || rowsSum.amount !== kpi.amount) {
        console.warn(`[TabNextMonth] Total de ${label} no coincide con la tarjeta KPI`, { rowsSum, kpi });
      }
    }
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

      {/*
        Etapa NEXTMONTH-7, fix de layout: `.seg` es `display: inline-flex`
        (components.css) -- 2 `<div className="seg">` hermanos flotan en la
        misma línea, como texto en línea, en vez de apilarse. Se envuelven
        acá en un contenedor propio (flex column) para forzar 2 filas
        separadas, sin tocar `.seg` en sí (comparte esa clase con
        PivotTable.tsx, no se toca su definición global).
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Mismo patrón visual/de estado que el toggle "By branch"/"By strategy" de PivotTable.tsx (`.seg`, clase `on` en el botón activo). */}
        <div className="seg">
          <button type="button" className={view === 'branch' ? 'on' : ''} onClick={() => setView('branch')}>
            By branch
          </button>
          <button type="button" className={view === 'strategy' ? 'on' : ''} onClick={() => setView('strategy')}>
            By strategy
          </button>
        </div>

        {/* Mismo patrón visual/de estado que el toggle de arriba (`.seg`, clase `on` en el botón activo). */}
        <div className="seg">
          {POPULATION_OPTIONS.map((opt) => (
            <button key={opt.key} type="button" className={population === opt.key ? 'on' : ''} onClick={() => setPopulation(opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/*
        Etapa NEXTMONTH-9: la única tabla ("By Branch"/"By Strategy", ambos
        canales mezclados) se reemplaza por 2 bloques `.tbl-card`, uno por
        canal -- mismo patrón visual que buildChannelBlocks()/las 2 tablas
        Banked/Brokered de PivotTable.tsx (líneas 1616-1694). Los controles de
        arriba (view, población) son compartidos: los 2 bloques muestran
        siempre el mismo view/population a la vez, mismo criterio ya usado
        por PivotTable.tsx para su propio toggle By branch/By strategy ("un
        solo control para las dos tablas... se conmutan juntas").
      */}
      {CHANNEL_BLOCKS.map(({ key, label }) => (
        <ChannelBlock
          key={key}
          label={label}
          view={view}
          population={population}
          populationLabel={activePopulation.label}
          branchRows={byBranchRows[key]}
          strategyRows={byStrategyRows[key]}
          branchManagers={branchManagers}
          openCell={openCell}
          contextForBranch={contextForBranch}
        />
      ))}

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
