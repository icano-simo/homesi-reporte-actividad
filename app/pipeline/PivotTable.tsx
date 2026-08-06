'use client';

import { useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import {
  calculateTotalForecastWithClosed,
  type BucketCounts,
  type ForecastByBucket,
  type PullThroughRates,
  type DateRange,
} from '@/lib/pipeline/aggregate';
import LoanDetailModal, { type LoanDetailModalLoan } from './LoanDetailModal';

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

/**
 * Etapa F5g: mismo criterio que classifyHealthy() en salesforce-file.ts
 * ("On Track" o vacío -> healthy) -- acá se muestra la etiqueta en vez del
 * boolean. NO se toca classifyHealthy() ni el campo `healthy` -- esto es
 * puramente para texto/color visible, nunca alimenta ningún cálculo de
 * Healthy Pipeline. Exportada para que LoanDetailModal.tsx la reuse en vez
 * de duplicar la clasificación string -> label.
 */
export function healthStatusLabel(rawHealthiness: string): string {
  const v = rawHealthiness.trim();
  return v === '' || v === 'On Track' ? 'Healthy' : v;
}

/**
 * Color del badge de salud, a partir del label YA resuelto por
 * healthStatusLabel() -- no vuelve a comparar contra el string crudo, solo
 * mapea label -> color. "Never" usa el mismo rojo/fondo que ya usa
 * AdverseTable.tsx para el badge de monto >= $300k (mismo hex #fef2f2,
 * no hay token --red-tint en tokens.css); el resto reusa tokens
 * existentes, ninguno nuevo.
 */
export function healthStatusColor(label: string): { background: string; color: string } {
  switch (label) {
    case 'Healthy':
      return { background: 'var(--green-tint)', color: 'var(--green)' };
    case 'Delayed':
      return { background: 'var(--amber)', color: 'var(--amber-text)' };
    case 'Never':
      return { background: '#fef2f2', color: 'var(--red)' };
    default:
      // 'Out of Scope' y cualquier otro valor futuro no contemplado -- gris neutro.
      return { background: 'var(--border-soft)', color: 'var(--muted)' };
  }
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

interface CombinedBranchRow {
  branch: string;
  closedCount: number;
  totalCount: number;
  healthyCount: number;
  totalForecast: number;
}

/**
 * Ajuste posterior a F6e: agrupa branchRows (ya suma Banked+Brokered por
 * fila vía buildBranchRows, sin tocar) por branch -- para la sección
 * "Combined Total by Branch" de abajo. No es un cálculo nuevo, es la misma
 * suma que ya hace addSubtotal/grandTotal, solo reagrupada por branch en
 * vez de por canal.
 */
function buildCombinedByBranch(branchRows: BranchRow[]): CombinedBranchRow[] {
  const map = new Map<string, CombinedBranchRow>();
  for (const row of branchRows) {
    const existing = map.get(row.branch);
    if (existing) {
      existing.closedCount += row.closedCount;
      existing.totalCount += row.totalCount;
      existing.healthyCount += row.healthyCount;
      existing.totalForecast += row.totalForecast;
    } else {
      map.set(row.branch, {
        branch: row.branch,
        closedCount: row.closedCount,
        totalCount: row.totalCount,
        healthyCount: row.healthyCount,
        totalForecast: row.totalForecast,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.branch.localeCompare(b.branch));
}

function toModalLoan(loan: PipelineLoan): LoanDetailModalLoan {
  return {
    sourceLoanId: loan.sourceLoanId,
    borrowerName: loan.borrowerName,
    amount: loan.amount,
    rawMilestone: loan.rawMilestone,
    rawHealthiness: loan.rawHealthiness,
  };
}

/**
 * Detalle de préstamos individuales de un branch+canal: los abiertos
 * (pipeline en Negotiation) más los ya cerrados (funded, dentro del rango
 * de fechas -- el mismo conjunto exacto que cuenta en "Closed" de la fila
 * de branch, para que la lista sume igual que el número de arriba).
 * "Last Finished Milestone" de un cerrado no tiene una etiqueta granular
 * propia en ResolvedLoan (solo se agregaron los 3 campos que pidió esta
 * etapa) -- se muestra como "Closed (Funded)", derivado de `status`.
 *
 * Ajuste posterior a F6e: esta función y LoanDetailTable (abajo) ya no se
 * usan -- el drill-down inline por fila se reemplazó por LoanDetailModal.tsx
 * (modal centrado, abierto por celda clickeada: Total Pipeline/Healthy
 * Pipeline/Closed). Se dejan sin borrar a propósito, tal como se pidió.
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
    <span className="branch-transfer-chip" title="Branch reassigned due to license (Branch Transfer)">
      Transferred
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
 * Desglose por Branch -- ajuste posterior a F6e: vuelve a ser 2 tablas
 * lado a lado (Banked - Retail / Brokered) en vez de una sola tabla con
 * sub-headers, según último pedido confirmado. Sin acordeón: cada celda
 * numérica (Closed/Total Pipeline/Healthy Pipeline) abre un modal
 * (LoanDetailModal.tsx) con la lista de préstamos correspondiente, en vez
 * de expandir una fila inline. Forecast NO es clickeable -- ver nota en
 * el componente sobre esa decisión.
 *
 * Combined Total ahora vive en una 3ra tabla, agrupada por branch (suma
 * Banked+Brokered) -- se eligió una tabla aparte en vez de una columna
 * extra dentro de cada una de las 2 tablas porque Banked y Brokered no
 * necesariamente tienen el mismo set de branches (uno puede tener un
 * branch que el otro no); una columna "Combined" adentro de cada tabla
 * hubiera tenido que buscar el valor del OTRO canal para ese branch,
 * rompiendo la separación limpia "esta tabla = este canal, nada más".
 */
export default function PivotTable({ rows, resolvedLoans, dateRange, branchManagers, knownBranches }: PivotTableProps) {
  const [modal, setModal] = useState<{ title: string; loans: LoanDetailModalLoan[] } | null>(null);

  const branchRows = buildBranchRows(rows, resolvedLoans, dateRange, knownBranches);
  const blocks = buildChannelBlocks(branchRows);
  const grandTotal = blocks.reduce((acc, block) => addSubtotal(acc, block.subtotal), EMPTY_SUBTOTAL);
  const combinedByBranch = buildCombinedByBranch(branchRows);

  function openTotalPipelineModal(row: BranchRow) {
    setModal({
      title: `Total Pipeline — ${row.branch} (${row.channel})`,
      loans: row.branchForecastRow.loans.map(toModalLoan),
    });
  }

  function openHealthyPipelineModal(row: BranchRow) {
    setModal({
      title: `Healthy Pipeline — ${row.branch} (${row.channel})`,
      loans: row.branchForecastRow.loans.filter((l) => l.healthy === true).map(toModalLoan),
    });
  }

  // Etapa F4i en adelante: mismo filtro que ya usa buildBranchRows para
  // "Closed" de esta fila (status='funded' + branch+channel exactos +
  // disbursementDate en dateRange) -- se repite acá en vez de reusar
  // branchForecastRow (que no guarda la lista de cerrados, solo el count).
  function openClosedModal(row: BranchRow) {
    const closedLoans = resolvedLoans.filter(
      (loan) =>
        loan.status === 'funded' &&
        loan.branch === row.branch &&
        loan.channel === row.channel &&
        loan.disbursementDate >= dateRange.startDate &&
        loan.disbursementDate <= dateRange.endDate
    );
    setModal({
      title: `Closed — ${row.branch} (${row.channel})`,
      loans: closedLoans.map((loan) => ({
        sourceLoanId: loan.sourceLoanId,
        borrowerName: loan.borrowerName,
        amount: loan.amount,
        // Etapa F5g agregó rawMilestone a ResolvedLoan (el valor real al
        // momento del cierre) -- se usa acá en vez del literal fijo
        // 'Closed (Funded)' que usaba el viejo LoanDetailTable, con ese
        // string como fallback solo si el archivo no trae la columna.
        rawMilestone: loan.rawMilestone || 'Closed (Funded)',
        // ResolvedLoan no tiene rawHealthiness en su tipo -- un préstamo ya
        // cerrado no tiene un estado de salud vigente. Se omite el campo en
        // vez de mandar un string inventado; LoanDetailModal.tsx muestra
        // '—' cuando rawHealthiness es undefined.
      })),
    });
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {blocks.map((block) => (
          <div className="tbl-card" style={{ minWidth: 0, overflowX: 'auto' }} key={block.channel}>
            <div className="cards-head" style={{ padding: '10px 12px 0' }}>
              {block.channel}
            </div>
            <table className="piv">
              <colgroup>
                <col className="branch-col" />
                <col className="manager-col" />
                <col />
                <col />
                <col />
                <col />
              </colgroup>
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
                  const managerName = branchManagers.get(row.branch) ?? '(unassigned)';
                  return (
                    <tr className="metric" key={row.branch + '::' + row.channel}>
                      <td className="lbl">{row.branch}</td>
                      <td style={{ textAlign: 'left', color: 'var(--muted)' }}>{managerName}</td>
                      <td className="val">
                        <button type="button" className="cell-trigger" onClick={() => openClosedModal(row)}>
                          {fmtInt(row.closedCount)}
                        </button>
                      </td>
                      <td className="val">
                        <button type="button" className="cell-trigger" onClick={() => openTotalPipelineModal(row)}>
                          {fmtInt(row.totalCount)}
                        </button>
                      </td>
                      <td className="val">
                        <button type="button" className="cell-trigger" onClick={() => openHealthyPipelineModal(row)}>
                          <HealthyDot />
                          {fmtInt(row.healthyCount)}
                        </button>
                      </td>
                      <td className="totcol">
                        <span className="forecast-pill">{fmtForecast(row.totalForecast)}</span>
                      </td>
                    </tr>
                  );
                })}
                {!block.rows.length && (
                  <tr>
                    <td className="lbl" style={{ color: 'var(--muted)', fontWeight: 500 }} colSpan={6}>
                      No pipeline data.
                    </td>
                  </tr>
                )}
                <tr className="grp total total-forecast">
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
        <div className="cards-head" style={{ padding: '10px 12px 0' }}>
          Combined Total by Branch
        </div>
        <table className="piv">
          <colgroup>
            <col className="branch-col" />
            <col className="manager-col" />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
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
            {combinedByBranch.map((row) => {
              const managerName = branchManagers.get(row.branch) ?? '(unassigned)';
              return (
                <tr className="metric" key={row.branch}>
                  <td className="lbl">{row.branch}</td>
                  <td style={{ textAlign: 'left', color: 'var(--muted)' }}>{managerName}</td>
                  <td className="val">{fmtInt(row.closedCount)}</td>
                  <td className="val">{fmtInt(row.totalCount)}</td>
                  <td className="val">
                    <HealthyDot />
                    {fmtInt(row.healthyCount)}
                  </td>
                  <td className="totcol">
                    <span className="forecast-pill">{fmtForecast(row.totalForecast)}</span>
                  </td>
                </tr>
              );
            })}
            {!combinedByBranch.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--muted)', fontWeight: 500 }} colSpan={6}>
                  No pipeline data.
                </td>
              </tr>
            )}
            <tr className="grp total total-forecast">
              <td className="lbl">Combined Total (Banked - Retail + Brokered)</td>
              <td></td>
              <td className="val">{fmtInt(grandTotal.closedCount)}</td>
              <td className="val">{fmtInt(grandTotal.totalCount)}</td>
              <td className="val">{fmtInt(grandTotal.healthyCount)}</td>
              <td className="totcol">{fmtForecast(grandTotal.totalForecast)}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
          Forecast subtotals are rounded independently per channel; the Combined Total is calculated from the underlying decimal
          values before rounding, so it may differ by a small margin from the sum of the rounded subtotals shown above.
        </p>
      </div>

      <LoanDetailModal isOpen={modal !== null} onClose={() => setModal(null)} title={modal?.title ?? ''} loans={modal?.loans ?? []} />
    </>
  );
}
