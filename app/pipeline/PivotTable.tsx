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
 * Lo que page.tsx arma por branch+channel (usado también para la cascada
 * agregada de MilestoneCascade). PivotTable solo lee `loans` de acá para
 * alimentar el modal de auditoría; no toca aggregate.ts.
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
  /**
   * Etapa UX8: = `branchForecastRow.forecastTotal` (ya existía, sin cálculo
   * nuevo) -- los préstamos del open pipeline que se proyecta que cierren
   * después de aplicar el pull-through, ANTES de sumar Closed. Se expone acá
   * como campo propio (antes solo vivía adentro de `branchForecastRow`) para
   * poder mostrarlo como su propia columna y sumarlo en los subtotales igual
   * que los demás.
   */
  projectedToClose: number;
  totalForecast: number;
  branchForecastRow: BranchForecastRow;
}

interface BlockSubtotal {
  closedCount: number;
  totalCount: number;
  healthyCount: number;
  projectedToClose: number;
  totalForecast: number;
}

interface ChannelBlock {
  channel: PipelineLoan['channel'];
  rows: BranchRow[];
  subtotal: BlockSubtotal;
}

/** Estado del modal de auditoría: qué celda se clickeó y qué préstamos hay detrás. */
interface ModalState {
  context: string;
  metric: string;
  loans: LoanDetailModalLoan[];
}

/** Orden fijo de los dos bloques, igual que el Excel de referencia. */
const CHANNEL_ORDER: PipelineLoan['channel'][] = ['Banked - Retail', 'Brokered'];

const EMPTY_SUBTOTAL: BlockSubtotal = { closedCount: 0, totalCount: 0, healthyCount: 0, projectedToClose: 0, totalForecast: 0 };
const EMPTY_BUCKETS: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };
const EMPTY_FORECAST_BUCKETS: ForecastByBucket = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };

const UNASSIGNED_MANAGER = '(unassigned)';

function addSubtotal(a: BlockSubtotal, b: BranchRow | BlockSubtotal): BlockSubtotal {
  return {
    closedCount: a.closedCount + b.closedCount,
    totalCount: a.totalCount + b.totalCount,
    healthyCount: a.healthyCount + b.healthyCount,
    projectedToClose: a.projectedToClose + b.projectedToClose,
    totalForecast: a.totalForecast + b.totalForecast,
  };
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Etapa F4h: Forecast se muestra como entero en esta tabla -- el cálculo interno no cambia, solo el display. */
function fmtForecast(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Etapa F4d, hallazgo: la premisa del brief ("todo préstamo cerrado tiene un
 * Branch, así que el hueco de F4b se resuelve solo") no se cumplió del todo --
 * verificado contra report1785364641647.xls: 2 préstamos funded (branch 728,
 * Brokered) no tienen NINGÚN préstamo abierto en ese branch+canal, así que
 * `rows` (armado en page.tsx solo a partir de openLoans) nunca genera una fila
 * de branch para ellos. Sin este fix el Total combinado daba 86 en vez de 88.
 *
 * Se sintetiza una fila de Branch con pipeline abierto en cero para cualquier
 * branch+canal que solo tenga cerrados -- aparece como una fila normal,
 * auditables sus cerrados desde el modal (no una fila genérica "Otros").
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
      projectedToClose: 0,
      totalForecast: count,
      branchForecastRow: emptyBranchForecastRow,
    };
  });
}

/**
 * Una fila por Branch. Cada `BranchForecastRow` que arma page.tsx YA es por
 * branch+channel, así que "Closed" es lo único que hace falta calcular acá --
 * se filtra resolvedLoans por ese mismo branch+channel exacto. Se completa con
 * buildOrphanBranchRows para los branch+canal que solo tienen cerrados.
 *
 * Etapa F4g: antes de devolver, se oculta cualquier fila fantasma -- un branch
 * que da CERO en Closed/Total Pipeline/Healthy Pipeline y no está en el roster
 * conocido (`knownBranches`) no aporta información, es ruido.
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
      projectedToClose: branchForecastRow.forecastTotal,
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
  projectedToClose: number;
  totalForecast: number;
}

/**
 * Agrupa branchRows (ya sumadas por buildBranchRows) por branch, para la
 * sección "Combined Total by Branch". No es un cálculo nuevo: es la misma suma
 * que ya hace addSubtotal, reagrupada por branch en vez de por canal.
 */
function buildCombinedByBranch(branchRows: BranchRow[]): CombinedBranchRow[] {
  const map = new Map<string, CombinedBranchRow>();
  for (const row of branchRows) {
    const existing = map.get(row.branch);
    if (existing) {
      existing.closedCount += row.closedCount;
      existing.totalCount += row.totalCount;
      existing.healthyCount += row.healthyCount;
      existing.projectedToClose += row.projectedToClose;
      existing.totalForecast += row.totalForecast;
    } else {
      map.set(row.branch, {
        branch: row.branch,
        closedCount: row.closedCount,
        totalCount: row.totalCount,
        healthyCount: row.healthyCount,
        projectedToClose: row.projectedToClose,
        totalForecast: row.totalForecast,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.branch.localeCompare(b.branch));
}

function openLoanToModalLoan(loan: PipelineLoan): LoanDetailModalLoan {
  return {
    sourceLoanId: loan.sourceLoanId,
    borrowerName: loan.borrowerName,
    loanOfficer: loan.loanOfficer,
    amount: loan.amount,
    rawMilestone: loan.rawMilestone,
    rawHealthiness: loan.rawHealthiness,
    branchTransferred: loan.branchTransferred,
  };
}

/**
 * Etapa F5g agregó rawMilestone a ResolvedLoan (el valor real al momento del
 * cierre) -- se usa acá, con 'Closed (Funded)' como fallback si el archivo no
 * trae la columna. rawHealthiness se OMITE a propósito: un préstamo ya cerrado
 * no tiene un estado de salud vigente, y el modal muestra '—' cuando falta.
 */
function closedLoanToModalLoan(loan: ResolvedLoan): LoanDetailModalLoan {
  return {
    sourceLoanId: loan.sourceLoanId,
    borrowerName: loan.borrowerName,
    loanOfficer: loan.loanOfficer,
    amount: loan.amount,
    rawMilestone: loan.rawMilestone || 'Closed (Funded)',
    branchTransferred: loan.branchTransferred,
  };
}

/*
 * ===========================================================================
 * ESTRUCTURA COMPARTIDA POR LAS 3 TABLAS EJECUTIVAS
 * ===========================================================================
 * Banked - Retail, Brokered y Combined Total by Branch tienen exactamente las
 * mismas 7 columnas. Antes el <colgroup> y el <thead> estaban duplicados
 * literalmente en los dos bloques de JSX; con la jerarquía de columnas nueva
 * (etapa UX3) esa duplicación pasaba a ser de 3 clases por celda, así que se
 * extraen acá: un solo lugar donde cambiar anchos, rótulos o agrupación.
 *
 * Las clases `col-*` marcan a qué GRUPO DE MÉTRICA pertenece cada columna
 * (Pipeline / Forecast) y son las que el CSS usa para tintarlas. `group-start`
 * dibuja el divisor vertical al inicio de cada grupo.
 *
 * Etapa UX8: Closed se movió adentro del grupo Forecast (antes tenía su
 * propio grupo `col-closed`, con un divisor propio) -- ahora las 3 columnas
 * de Forecast (Closed, Projected to Close, Forecast) comparten `col-forecast`
 * y un solo `group-start` al principio del bloque (en Closed). `col-closed`
 * queda sin ningún consumidor (ver forecast-visual.css, se retira esa regla).
 */
function ExecColgroup() {
  return (
    <colgroup>
      <col className="branch-col" />
      <col className="manager-col" />
      <col className="metric-col" />
      <col className="metric-col" />
      <col className="metric-col" />
      <col className="metric-col" />
      <col className="metric-col" />
    </colgroup>
  );
}

/**
 * Etapa UX8: 2 filas de `<thead>` -- la primera agrupa Closed + Projected to
 * Close + Forecast bajo una única barra "Forecast" (colSpan=3), la segunda
 * tiene los rótulos reales de columna. Las 4 columnas de la izquierda
 * (Branch/Branch Manager/Total Pipeline/Healthy Pipeline) no tienen nada que
 * agrupar todavía, así que su celda en la fila de grupo va vacía -- ocupan su
 * lugar en el <colgroup> pero no dibujan texto ni tinte.
 */
function ExecHead() {
  return (
    <thead>
      <tr className="mo-row exec-group-row">
        <th className="lbl" />
        <th className="th-left" />
        <th className="col-pipeline group-start" />
        <th className="col-pipeline" />
        <th className="col-forecast group-start forecast-group-label" colSpan={3}>
          Forecast
        </th>
      </tr>
      <tr className="mo-row">
        <th className="lbl">Branch</th>
        <th className="th-left">Branch Manager</th>
        <th className="col-pipeline group-start">Total Pipeline</th>
        <th className="col-pipeline">Healthy Pipeline</th>
        <th className="col-forecast group-start">Closed</th>
        <th
          className="col-forecast"
          title="Open pipeline loans (Total) projected to close after applying pull-through -- before adding Closed."
        >
          Projected to Close
        </th>
        <th className="totcol col-forecast">Forecast</th>
      </tr>
    </thead>
  );
}

/**
 * Fila de subtotal / total. Los valores repiten el tratamiento visual de su
 * columna (badge de Closed, píldora de Forecast) para que la fila de cierre se
 * lea como el resumen de lo de arriba y no como otra tabla.
 *
 * Etapa UX8: `subtotal.projectedToClose` (suma de `branchForecastRow.forecastTotal`
 * de cada fila, ver BranchRow) tiene que cuadrar con
 * `subtotal.totalForecast - subtotal.closedCount` -- verificado con datos
 * reales en el reporte de esta etapa, no solo asumido.
 */
function ExecTotalRow({ label, subtotal }: { label: string; subtotal: BlockSubtotal }) {
  return (
    <tr className="grp total">
      <td className="lbl">{label}</td>
      <td></td>
      <td className="val col-pipeline group-start">{fmtInt(subtotal.totalCount)}</td>
      <td className="val col-pipeline">
        <span className="dot-healthy" />
        {fmtInt(subtotal.healthyCount)}
      </td>
      <td className="val col-forecast group-start">
        <ClosedValue value={subtotal.closedCount} />
      </td>
      <td className="val col-forecast">{fmtForecast(subtotal.projectedToClose)}</td>
      <td className="totcol col-forecast">
        <span className="badge badge--pill badge--emerald">{fmtForecast(subtotal.totalForecast)}</span>
      </td>
    </tr>
  );
}

/**
 * Valor de la columna Closed cuando NO es clickeable (filas de total). En cero
 * se apaga; con valor va en badge, igual que las celdas de datos.
 */
function ClosedValue({ value }: { value: number }) {
  if (value === 0) return <span className="closed-badge is-zero">0</span>;
  return <span className="closed-badge">{fmtInt(value)}</span>;
}

/**
 * Fila de branch de una de las dos tablas de canal. Se extrajo como componente
 * propio (Etapa UX1) porque su JSX era idéntico salvo los handlers -- antes
 * estaba inline dentro del .map() del bloque.
 */
function BranchDataRow({
  row,
  managerName,
  onOpenClosed,
  onOpenTotal,
  onOpenHealthy,
}: {
  row: BranchRow;
  managerName: string;
  onOpenClosed: (row: BranchRow) => void;
  onOpenTotal: (row: BranchRow) => void;
  onOpenHealthy: (row: BranchRow) => void;
}) {
  return (
    <tr className="metric">
      <td className="lbl">{row.branch}</td>
      {/* HOTFIX UX2: con la columna en % un nombre largo se recorta con
          ellipsis, así que el valor completo va en el title. */}
      <td className="th-left manager-cell" title={managerName}>
        {managerName}
      </td>
      <td className="val col-pipeline group-start">
        <CountCell value={row.totalCount} onClick={() => onOpenTotal(row)} />
      </td>
      <td className="val col-pipeline">
        <CountCell value={row.healthyCount} onClick={() => onOpenHealthy(row)} withHealthyDot />
      </td>
      <td className="val col-forecast group-start">
        <CountCell value={row.closedCount} onClick={() => onOpenClosed(row)} variant="closed" />
      </td>
      {/* Etapa UX8: Projected to Close no es clickeable, mismo motivo que
          Forecast -- es un valor calculado (pull-through), no una lista de
          préstamos concreta que auditar. */}
      <td className="val col-forecast">{fmtForecast(row.projectedToClose)}</td>
      <td className="totcol col-forecast">
        {/* Sin barras de progreso: el Forecast va siempre en píldora verde. */}
        <span className="badge badge--pill badge--emerald">{fmtForecast(row.totalForecast)}</span>
      </td>
    </tr>
  );
}

/**
 * Celda numérica que abre el modal de auditoría. En cero no es clickeable y
 * se muestra apagada (spec §3C/§4D.2): no hay nada que auditar detrás de un 0,
 * y ofrecer el click igual solo produce paneles vacíos.
 */
function CountCell({
  value,
  onClick,
  withHealthyDot,
  variant,
}: {
  value: number;
  onClick: () => void;
  withHealthyDot?: boolean;
  /** 'closed' pinta el valor como badge de logro (fondo slate, navy bold). */
  variant?: 'closed';
}) {
  const base = variant === 'closed' ? 'cell-trigger cell-trigger--closed' : 'cell-trigger';
  if (value === 0) {
    return <span className={base + ' is-zero'}>0</span>;
  }
  return (
    <button type="button" className={base} onClick={onClick}>
      {withHealthyDot && <span className="dot-healthy" />}
      {fmtInt(value)}
    </button>
  );
}

/**
 * TAB 1 — Executive Branch Forecast (spec §4C).
 *
 * Dos tablas lado a lado (Banked - Retail / Brokered) + una tercera con el
 * Combined Total agrupado por branch. Sin acordeones: cada celda numérica
 * abre el modal centrado (LoanDetailModal) con la lista real de préstamos
 * detrás de ese número. Forecast NO es clickeable -- es un valor calculado
 * (cerrados + proyección de pull-through), no un conjunto de préstamos.
 *
 * Combined Total vive en una tabla aparte y no como columna extra dentro de
 * cada tabla de canal porque Banked y Brokered no necesariamente comparten el
 * mismo set de branches; una columna "Combined" adentro tendría que ir a
 * buscar el valor del OTRO canal, rompiendo la separación limpia
 * "esta tabla = este canal, nada más".
 *
 * Etapa UX1: se eliminaron `buildLoanDetailRows()` y `LoanDetailTable`, que
 * estaban muertos desde que el drill-down inline se reemplazó por el modal
 * (y ahora por el modal). Si hiciera falta recuperarlos, están en el
 * historial de git de este archivo.
 */
export default function PivotTable({ rows, resolvedLoans, dateRange, branchManagers, knownBranches }: PivotTableProps) {
  const [modal, setModal] = useState<ModalState | null>(null);

  const branchRows = buildBranchRows(rows, resolvedLoans, dateRange, knownBranches);
  const blocks = buildChannelBlocks(branchRows);
  const grandTotal = blocks.reduce((acc, block) => addSubtotal(acc, block.subtotal), EMPTY_SUBTOTAL);
  const combinedByBranch = buildCombinedByBranch(branchRows);

  /** Contexto que se muestra como "eyebrow" del modal. */
  function contextFor(row: BranchRow): string {
    return `Branch ${row.branch} — ${row.channel}`;
  }

  function openTotalPipeline(row: BranchRow) {
    setModal({
      context: contextFor(row),
      metric: 'Total Pipeline',
      loans: row.branchForecastRow.loans.map(openLoanToModalLoan),
    });
  }

  function openHealthyPipeline(row: BranchRow) {
    setModal({
      context: contextFor(row),
      metric: 'Healthy Pipeline',
      loans: row.branchForecastRow.loans.filter((l) => l.healthy === true).map(openLoanToModalLoan),
    });
  }

  // Mismo filtro que ya usa buildBranchRows para "Closed" de esta fila
  // (status='funded' + branch+channel exactos + disbursementDate en
  // dateRange) -- se repite acá porque branchForecastRow guarda el count, no
  // la lista de cerrados.
  function openClosed(row: BranchRow) {
    const closedLoans = resolvedLoans.filter(
      (loan) =>
        loan.status === 'funded' &&
        loan.branch === row.branch &&
        loan.channel === row.channel &&
        loan.disbursementDate >= dateRange.startDate &&
        loan.disbursementDate <= dateRange.endDate
    );
    setModal({
      context: contextFor(row),
      metric: 'Closed',
      loans: closedLoans.map(closedLoanToModalLoan),
    });
  }

  return (
    <>
      {/* Spec §4C.2: grilla de 2 columnas, un canal por columna. */}
      <div className="channel-grid">
        {blocks.map((block) => (
          <div className="tbl-card" key={block.channel}>
            <div className="tbl-card__head">
              <span className="tbl-card__title">{block.channel}</span>
              <span className="badge badge--pill badge--sky">{fmtInt(block.subtotal.totalCount)} in pipeline</span>
            </div>
            <div className="tbl-scroll">
              <table className="piv piv--exec">
                <ExecColgroup />
                <ExecHead />
                <tbody>
                  {block.rows.map((row) => (
                    <BranchDataRow
                      key={row.branch + '::' + row.channel}
                      row={row}
                      managerName={branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}
                      onOpenClosed={openClosed}
                      onOpenTotal={openTotalPipeline}
                      onOpenHealthy={openHealthyPipeline}
                    />
                  ))}
                  {!block.rows.length && (
                    <tr>
                      <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={7}>
                        No pipeline data.
                      </td>
                    </tr>
                  )}
                  <ExecTotalRow label={'Subtotal ' + block.channel} subtotal={block.subtotal} />
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="tbl-card" style={{ marginTop: '20px' }}>
        <div className="tbl-card__head">
          <span className="tbl-card__title">Combined Total by Branch</span>
        </div>
        <div className="tbl-scroll">
          <table className="piv piv--exec">
            <ExecColgroup />
            <ExecHead />
            <tbody>
              {combinedByBranch.map((row) => (
                <tr className="metric" key={row.branch}>
                  <td className="lbl">{row.branch}</td>
                  <td className="th-left manager-cell" title={branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}>
                    {branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}
                  </td>
                  <td className="val col-pipeline group-start">{fmtInt(row.totalCount)}</td>
                  <td className="val col-pipeline">
                    <span className="dot-healthy" />
                    {fmtInt(row.healthyCount)}
                  </td>
                  <td className="val col-forecast group-start">
                    <ClosedValue value={row.closedCount} />
                  </td>
                  <td className="val col-forecast">{fmtForecast(row.projectedToClose)}</td>
                  <td className="totcol col-forecast">
                    <span className="badge badge--pill badge--emerald">{fmtForecast(row.totalForecast)}</span>
                  </td>
                </tr>
              ))}
              {!combinedByBranch.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={7}>
                    No pipeline data.
                  </td>
                </tr>
              )}
              <ExecTotalRow label="Combined Total (Banked - Retail + Brokered)" subtotal={grandTotal} />
            </tbody>
          </table>
        </div>
      </div>

      {/*
       * Etapa UX8, hallazgo: este texto describía un comportamiento que ya no
       * existe. Databa de antes de F5j-b, cuando `forecastTotal` viajaba en
       * decimal hasta el final y cada subtotal (de canal y Combinado) se
       * redondeaba por separado -- podían no coincidir. Desde F5j-b,
       * `forecastTotal` ya llega redondeado POR BRANCH (page.tsx), así que
       * todo lo que suma esos valores (subtotal de canal, Combined Total)
       * sí cuadra exacto con la suma de las filas mostradas -- verificado en
       * el reporte de esta etapa, no solo asumido. Se reemplaza el texto en
       * vez de dejarlo, porque contradecía directamente la garantía que esta
       * etapa pide verificar.
       */}
      <p className="foot-note">
        Closed + Projected to Close always add up to Forecast, and subtotals are the exact sum of the rows shown above
        -- no rows are hidden by rounding.
      </p>

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
