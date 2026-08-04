'use client';

import { Fragment, useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import {
  calculateTotalForecastWithClosed,
  type BucketCounts,
  type ForecastByBucket,
  type PullThroughRates,
  type DateRange,
} from '@/lib/pipeline/aggregate';

/**
 * Sigue siendo lo que page.tsx arma por branch+channel (usado también para
 * la cascada agregada de MilestoneCascade) -- PivotTable ahora solo lee
 * `loans` de acá para el detalle expandible; no toca aggregate.ts.
 */
export interface BranchForecastRow {
  branch: string;
  channel: PipelineLoan['channel'];
  totalCount: number;
  healthyCount: number;
  bucketTotal: BucketCounts;
  bucketHealthy: BucketCounts;
  forecastByBucket: ForecastByBucket;
  forecastTotal: number;
  loans: PipelineLoan[];
}

export interface PivotTableProps {
  rows: BranchForecastRow[];
  resolvedLoans: ResolvedLoan[];
  rates: PullThroughRates;
  dateRange: DateRange;
  /** Etapa F4f: branch -> nombre del Branch Manager (pipeline_forecast.branch_managers). Vacío si no cargó. */
  branchManagers: Map<string, string>;
  /** Etapa F4g: set de branch codes conocidos (pipeline_forecast.branches). Vacío si no cargó. */
  knownBranches: Set<string>;
}

interface BranchRow {
  branch: string;
  channel: PipelineLoan['channel'];
  closedCount: number;
  totalCount: number;
  healthyCount: number;
  totalForecast: number;
  branchForecastRow: BranchForecastRow;
}

interface BlockSubtotal {
  closedCount: number;
  totalCount: number;
  healthyCount: number;
  totalForecast: number;
}

interface ChannelBlock {
  channel: PipelineLoan['channel'];
  rows: BranchRow[];
  subtotal: BlockSubtotal;
}

interface LoanDetailRow {
  sourceLoanId: string;
  branch: string;
  loanOfficer: string;
  borrowerName: string;
  amount: number;
  lastMilestone: string;
  lastMilestoneDate: string | null;
  estClosingDate: string | null;
  branchTransferred: boolean;
  /**
   * Etapa F5g: Healthiness real del préstamo -- 'Healthy' cuando el valor
   * crudo es "On Track" o vacío (mismo criterio que classifyHealthy() en
   * salesforce-file.ts), o el valor crudo tal cual ("Delayed", "Out of
   * Scope", "Never", etc.) en cualquier otro caso. Solo aplica a préstamos
   * abiertos -- ResolvedLoan no trae rawHealthiness (un préstamo ya cerrado
   * no tiene un estado de salud vigente), así que las filas de cerrados
   * muestran '—'.
   */
  healthStatus: string;
}

/** Orden fijo de los dos bloques, igual que el Excel de referencia. */
const CHANNEL_ORDER: PipelineLoan['channel'][] = ['Banked - Retail', 'Brokered'];

const EMPTY_SUBTOTAL: BlockSubtotal = { closedCount: 0, totalCount: 0, healthyCount: 0, totalForecast: 0 };
const EMPTY_BUCKETS: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };
const EMPTY_FORECAST_BUCKETS: ForecastByBucket = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };

function addSubtotal(a: BlockSubtotal, b: BranchRow | BlockSubtotal): BlockSubtotal {
  return {
    closedCount: a.closedCount + b.closedCount,
    totalCount: a.totalCount + b.totalCount,
    healthyCount: a.healthyCount + b.healthyCount,
    totalForecast: a.totalForecast + b.totalForecast,
  };
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Etapa F4h: Forecast se muestra como entero (Math.round) en esta tabla -- el cálculo interno no cambia, solo el display. */
function fmtForecast(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Etapa F5g: mismo criterio que classifyHealthy() en salesforce-file.ts ("On Track" o vacío -> healthy) -- acá se muestra la etiqueta en vez del boolean. */
function healthStatusLabel(rawHealthiness: string): string {
  const v = rawHealthiness.trim();
  return v === '' || v === 'On Track' ? 'Healthy' : v;
}

/** Etapa F4h: mismo punto de color que SummaryCards, junto a Healthy Pipeline en cada fila. */
function HealthyDot() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: 'var(--green)',
        marginRight: '5px',
      }}
    />
  );
}

/**
 * Etapa F4d, hallazgo: la premisa del brief ("todo préstamo cerrado tiene
 * un Branch, así que el hueco de F4b se resuelve solo") no se cumplió del
 * todo -- verificado contra report1785364641647.xls: 2 préstamos funded
 * (branch 728, Brokered) no tienen NINGÚN préstamo abierto en ese
 * branch+canal, así que `rows` (armado en page.tsx solo a partir de
 * openLoans) nunca genera una fila de branch para ellos. Sin este fix el
 * Total combinado daba 86 en vez de 88.
 *
 * A diferencia del hueco de F4b (por LO), acá SÍ se puede resolver de forma
 * limpia: cada préstamo cerrado sabe su propio Branch, así que se sintetiza
 * una fila de Branch con pipeline abierto en cero para cualquier
 * branch+canal que solo tenga cerrados -- aparece como una fila normal,
 * expandible, mostrando ese cerrado en el detalle (no una fila genérica
 * "Otros").
 */
function buildOrphanBranchRows(rows: BranchForecastRow[], resolvedLoans: ResolvedLoan[], dateRange: DateRange): BranchRow[] {
  const knownKeys = new Set(rows.map((r) => r.branch + '::' + r.channel));

  const orphanFunded = resolvedLoans.filter(
    (loan) =>
      loan.status === 'funded' &&
      loan.disbursementDate >= dateRange.startDate &&
      loan.disbursementDate <= dateRange.endDate &&
      !knownKeys.has(loan.branch + '::' + loan.channel)
  );

  const grouped = new Map<string, { branch: string; channel: PipelineLoan['channel']; count: number }>();
  for (const loan of orphanFunded) {
    const key = loan.branch + '::' + loan.channel;
    const entry = grouped.get(key);
    if (entry) entry.count += 1;
    else grouped.set(key, { branch: loan.branch, channel: loan.channel, count: 1 });
  }

  return [...grouped.values()].map(({ branch, channel, count }) => {
    const emptyBranchForecastRow: BranchForecastRow = {
      branch,
      channel,
      totalCount: 0,
      healthyCount: 0,
      bucketTotal: EMPTY_BUCKETS,
      bucketHealthy: EMPTY_BUCKETS,
      forecastByBucket: EMPTY_FORECAST_BUCKETS,
      forecastTotal: 0,
      loans: [],
    };
    return {
      branch,
      channel,
      closedCount: count,
      totalCount: 0,
      healthyCount: 0,
      totalForecast: count,
      branchForecastRow: emptyBranchForecastRow,
    };
  });
}

/**
 * Etapa F4d (rediseño): una fila por Branch (ya no por Loan Officer). Cada
 * `BranchForecastRow` que arma page.tsx YA es por branch+channel, así que
 * "Closed" es lo único que hace falta calcular acá -- se filtra
 * resolvedLoans por ese mismo branch+channel exacto. Se completa con
 * buildOrphanBranchRows para los branch+canal que solo tienen cerrados (ver
 * su comentario) -- juntos cubren el 100% de resolvedLoans, así que ya no
 * hace falta la fila genérica "Otros cerrados" del diseño anterior.
 *
 * Etapa F4g: antes de devolver, se oculta cualquier fila fantasma -- un
 * branch que da CERO en Closed/Total Pipeline/Healthy Pipeline (ej. "150":
 * tiene un préstamo abierto, pero su Est. Closing Date cae fuera del rango
 * activo desde F4f, así que queda todo en cero) Y no está en el roster
 * conocido (`knownBranches`, de pipeline_forecast.branches) no aporta
 * información -- es ruido. El filtro se aplica sobre la lista YA combinada
 * (matched + orphans), no solo dentro de buildOrphanBranchRows: "150" es una
 * fila "matched" (tiene pipeline abierto), no una "orphan", así que
 * filtrar solo adentro de buildOrphanBranchRows no la habría ocultado.
 */
function buildBranchRows(
  rows: BranchForecastRow[],
  resolvedLoans: ResolvedLoan[],
  dateRange: DateRange,
  knownBranches: Set<string>
): BranchRow[] {
  const matched = rows.map((branchForecastRow) => {
    const closedLoansForBranch = resolvedLoans.filter(
      (loan) => loan.branch === branchForecastRow.branch && loan.channel === branchForecastRow.channel
    );
    const { closedCount, totalForecast } = calculateTotalForecastWithClosed(
      closedLoansForBranch,
      branchForecastRow.forecastTotal,
      dateRange
    );
    return {
      branch: branchForecastRow.branch,
      channel: branchForecastRow.channel,
      closedCount,
      totalCount: branchForecastRow.totalCount,
      healthyCount: branchForecastRow.healthyCount,
      totalForecast,
      branchForecastRow,
    };
  });

  const orphans = buildOrphanBranchRows(rows, resolvedLoans, dateRange);

  const visible = [...matched, ...orphans].filter(
    (row) => row.totalCount > 0 || row.healthyCount > 0 || row.closedCount > 0 || knownBranches.has(row.branch)
  );

  return visible.sort((a, b) => a.branch.localeCompare(b.branch));
}

function buildChannelBlocks(branchRows: BranchRow[]): ChannelBlock[] {
  return CHANNEL_ORDER.map((channel) => {
    const channelRows = branchRows.filter((row) => row.channel === channel);
    const subtotal = channelRows.reduce(addSubtotal, EMPTY_SUBTOTAL);
    return { channel, rows: channelRows, subtotal };
  });
}

/**
 * Detalle de préstamos individuales de un branch+canal: los abiertos
 * (pipeline en Negotiation) más los ya cerrados (funded, dentro del rango
 * de fechas -- el mismo conjunto exacto que cuenta en "Closed" de la fila
 * de branch, para que la lista sume igual que el número de arriba).
 * "Last Finished Milestone" de un cerrado no tiene una etiqueta granular
 * propia en ResolvedLoan (solo se agregaron los 3 campos que pidió esta
 * etapa) -- se muestra como "Closed (Funded)", derivado de `status`.
 */
function buildLoanDetailRows(branchForecastRow: BranchForecastRow, resolvedLoans: ResolvedLoan[], dateRange: DateRange): LoanDetailRow[] {
  const openRows: LoanDetailRow[] = branchForecastRow.loans.map((loan) => ({
    sourceLoanId: loan.sourceLoanId,
    branch: loan.branch,
    loanOfficer: loan.loanOfficer,
    borrowerName: loan.borrowerName,
    amount: loan.amount,
    lastMilestone: loan.rawMilestone,
    lastMilestoneDate: loan.milestoneDate,
    estClosingDate: loan.estClosingDate,
    branchTransferred: loan.branchTransferred,
    healthStatus: healthStatusLabel(loan.rawHealthiness),
  }));

  const closedRows: LoanDetailRow[] = resolvedLoans
    .filter(
      (loan) =>
        loan.branch === branchForecastRow.branch &&
        loan.channel === branchForecastRow.channel &&
        loan.status === 'funded' &&
        loan.disbursementDate >= dateRange.startDate &&
        loan.disbursementDate <= dateRange.endDate
    )
    .map((loan) => ({
      sourceLoanId: loan.sourceLoanId,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      borrowerName: loan.borrowerName,
      amount: loan.amount,
      lastMilestone: 'Closed (Funded)',
      lastMilestoneDate: loan.milestoneDate,
      // Etapa F4e: ResolvedLoan ya no trae Est. Closing Date por separado
      // (el campo de fecha de cierre pasó a ser disbursementDate) -- para un
      // préstamo cerrado, esta columna muestra su Disbursement Date. Ver
      // riesgo señalado en la respuesta de F4e.
      estClosingDate: loan.disbursementDate,
      branchTransferred: loan.branchTransferred,
      healthStatus: '—',
    }));

  return [...openRows, ...closedRows].sort(
    (a, b) => a.loanOfficer.localeCompare(b.loanOfficer) || a.borrowerName.localeCompare(b.borrowerName)
  );
}

function BranchTransferBadge() {
  return (
    <span
      title="Branch reassigned due to license (Branch Transfer)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        marginLeft: '5px',
        borderRadius: '50%',
        background: 'var(--accent)',
        color: '#fff',
        fontSize: '9px',
        fontWeight: 700,
        cursor: 'help',
      }}
    >
      ⇄
    </span>
  );
}

function LoanDetailTable({ detailRows }: { detailRows: LoanDetailRow[] }) {
  return (
    <table className="piv" style={{ width: '100%' }}>
      <thead>
        <tr className="mo-row">
          <th style={{ textAlign: 'left' }}>Loan Number</th>
          <th style={{ textAlign: 'left' }}>Branch</th>
          <th style={{ textAlign: 'left' }}>Loan Officer</th>
          <th style={{ textAlign: 'left' }}>Borrower Name</th>
          <th>Total Loan Amount</th>
          <th style={{ textAlign: 'left' }}>Last Finished Milestone</th>
          <th style={{ textAlign: 'left' }}>Last Finished Milestone Date</th>
          <th style={{ textAlign: 'left' }}>Est. Closing Date</th>
          <th style={{ textAlign: 'left' }}>Health Status</th>
        </tr>
      </thead>
      <tbody>
        {detailRows.map((d) => (
          <tr className="metric" key={d.sourceLoanId}>
            <td style={{ textAlign: 'left' }}>
              {d.sourceLoanId}
              {d.branchTransferred && <BranchTransferBadge />}
            </td>
            <td style={{ textAlign: 'left' }}>{d.branch}</td>
            <td style={{ textAlign: 'left' }}>{d.loanOfficer}</td>
            <td style={{ textAlign: 'left' }}>{d.borrowerName}</td>
            <td className="val">{fmtAmount(d.amount)}</td>
            <td style={{ textAlign: 'left' }}>{d.lastMilestone}</td>
            <td style={{ textAlign: 'left' }}>{d.lastMilestoneDate ?? '—'}</td>
            <td style={{ textAlign: 'left' }}>{d.estClosingDate ?? '—'}</td>
            <td style={{ textAlign: 'left' }}>{d.healthStatus}</td>
          </tr>
        ))}
        {!detailRows.length && (
          <tr>
            <td style={{ color: 'var(--muted)', fontWeight: 500 }} colSpan={9}>
              No loans.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * Desglose por Branch, en dos bloques por canal -- ver Decisiones en la
 * respuesta de esta etapa (F4d, rediseño). Cada branch está colapsado por
 * default; al expandir se ve la lista de préstamos individuales (abiertos +
 * cerrados que cuentan en el rango activo). Un préstamo con Branch
 * Transfer=1 muestra una nota visual junto a su Loan Number -- no cambia el
 * branch mostrado ni ningún cálculo.
 */
export default function PivotTable({ rows, resolvedLoans, dateRange, branchManagers, knownBranches }: PivotTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const branchRows = buildBranchRows(rows, resolvedLoans, dateRange, knownBranches);
  const blocks = buildChannelBlocks(branchRows);
  const grandTotal = blocks.reduce((acc, block) => addSubtotal(acc, block.subtotal), EMPTY_SUBTOTAL);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        {blocks.map((block) => (
          <div className="tbl-card" style={{ flex: '1 1 480px', minWidth: 0, overflowX: 'auto' }} key={block.channel}>
            <div className="cards-head" style={{ padding: '10px 12px 0' }}>
              {block.channel}
            </div>
            <table className="piv">
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Branch</th>
                  <th style={{ textAlign: 'left' }}>Branch Manager</th>
                  <th>Closed</th>
                  <th>Total Pipeline</th>
                  <th>Healthy Pipeline</th>
                  <th className="totcol">Forecast</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => {
                  const key = row.branch + '::' + row.channel;
                  const isOpen = expanded.has(key);
                  const managerName = branchManagers.get(row.branch) ?? '(unassigned)';
                  return (
                    <Fragment key={key}>
                      <tr className="grp togg" onClick={() => toggle(key)}>
                        <td className="lbl">
                          <span className="chev">{isOpen ? '▾' : '▸'}</span>
                          {row.branch}
                        </td>
                        <td style={{ textAlign: 'left', color: 'var(--muted)' }}>{managerName}</td>
                        <td className="val">{fmtInt(row.closedCount)}</td>
                        <td className="val">{fmtInt(row.totalCount)}</td>
                        <td className="val">
                          <HealthyDot />
                          {fmtInt(row.healthyCount)}
                        </td>
                        <td className="totcol">{fmtForecast(row.totalForecast)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{ padding: '6px 8px', background: '#fafbfd' }}>
                            <LoanDetailTable detailRows={buildLoanDetailRows(row.branchForecastRow, resolvedLoans, dateRange)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!block.rows.length && (
                  <tr>
                    <td className="lbl" style={{ color: 'var(--muted)', fontWeight: 500 }}>
                      No pipeline data.
                    </td>
                    <td colSpan={99}></td>
                  </tr>
                )}
                <tr className="grp total">
                  <td className="lbl">Subtotal {block.channel}</td>
                  <td></td>
                  <td className="val">{fmtInt(block.subtotal.closedCount)}</td>
                  <td className="val">{fmtInt(block.subtotal.totalCount)}</td>
                  <td className="val">{fmtInt(block.subtotal.healthyCount)}</td>
                  <td className="totcol">{fmtForecast(block.subtotal.totalForecast)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="tbl-card" style={{ marginTop: '16px' }}>
        <table className="piv">
          <tbody>
            <tr className="grp total">
              <td className="lbl">Combined Total (Banked - Retail + Brokered)</td>
              <td className="val">{fmtInt(grandTotal.closedCount)}</td>
              <td className="val">{fmtInt(grandTotal.totalCount)}</td>
              <td className="val">{fmtInt(grandTotal.healthyCount)}</td>
              <td className="totcol">{fmtForecast(grandTotal.totalForecast)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
