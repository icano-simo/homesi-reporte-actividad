'use client';

import { useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import {
  calculateTotalForecastWithClosed,
  splitCtcAndClosing,
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
  /**
   * Etapa F5k, Parte 3: `branchForecastRow.bucketTotal.Closing` de esta fila
   * -- el mismo dato que ya suma la tarjeta Closed ("Projected to close soon
   * (CTC)"), sin cálculo nuevo. Estructuralmente 0 para Brokered (ver
   * buildBranchRows): su `bucketTotal` es vestigial (esquema de buckets de
   * Banked, que Brokered no puebla) -- no se apoya en que hoy dé 0 por
   * casualidad de los datos, se fuerza a 0 por canal para que nunca dependa
   * de eso.
   */
  closingCount: number;
  /**
   * Aditivo, no reemplaza a `closingCount` de arriba (el punto CtcDot sigue
   * usando ese, sin tocar). Desglose de "Projected to Close": cuántos de los
   * loans HEALTHY (no bucketTotal -- Projected to Close nunca incluye
   * Delayed, ver el bug fix en buildBranchRows) tenían milestone crudo
   * "Clear To Close" vs "Closing" (ver `splitCtcAndClosing`, aggregate.ts).
   * `ctcRawCount + closingRawCount` == `branchForecastRow.bucketHealthy.Closing`,
   * NO `closingCount`. Mismo criterio de canal: 0 para Brokered.
   */
  ctcRawCount: number;
  closingRawCount: number;
  totalForecast: number;
  branchForecastRow: BranchForecastRow;
}

interface BlockSubtotal {
  closedCount: number;
  totalCount: number;
  healthyCount: number;
  projectedToClose: number;
  closingCount: number;
  /** Aditivo -- ver el comentario en BranchRow. Suma de ctcRawCount/closingRawCount de las filas. */
  ctcRawCount: number;
  closingRawCount: number;
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
  /** Solo lo setea openCtcClosing/openCombinedCtcClosing -- el resto de los openers no lo pasan, así que el modal cae al render plano de siempre. */
  sections?: { label: string; loans: LoanDetailModalLoan[] }[];
}

/** Orden fijo de los dos bloques, igual que el Excel de referencia. */
const CHANNEL_ORDER: PipelineLoan['channel'][] = ['Banked - Retail', 'Brokered'];

const EMPTY_SUBTOTAL: BlockSubtotal = {
  closedCount: 0,
  totalCount: 0,
  healthyCount: 0,
  projectedToClose: 0,
  closingCount: 0,
  ctcRawCount: 0,
  closingRawCount: 0,
  totalForecast: 0,
};
const EMPTY_BUCKETS: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };
const EMPTY_FORECAST_BUCKETS: ForecastByBucket = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };

const UNASSIGNED_MANAGER = '(unassigned)';

function addSubtotal(a: BlockSubtotal, b: BranchRow | BlockSubtotal): BlockSubtotal {
  return {
    closedCount: a.closedCount + b.closedCount,
    totalCount: a.totalCount + b.totalCount,
    healthyCount: a.healthyCount + b.healthyCount,
    projectedToClose: a.projectedToClose + b.projectedToClose,
    closingCount: a.closingCount + b.closingCount,
    ctcRawCount: a.ctcRawCount + b.ctcRawCount,
    closingRawCount: a.closingRawCount + b.closingRawCount,
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
      closingCount: 0,
      ctcRawCount: 0,
      closingRawCount: 0,
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
    // Etapa F5k, Parte 3: solo Banked -- ver el comentario en BranchRow.
    const isBanked = branchForecastRow.channel === 'Banked - Retail';
    // `closingCount` (el que alimenta el punto CtcDot, sin tocar -- Tarea 5
    // del brief anterior) sigue siendo bucketTotal.Closing, TODOS los loans:
    // es un indicador de presencia ("¿hay algún préstamo en CTC en esta
    // fila?"), no una cuenta que tenga que cuadrar con Projected to Close.
    const closingCount = isBanked ? branchForecastRow.bucketTotal.Closing : 0;
    // Bug fix (desglose CTC/Closing mostraba Delayed): "Projected to Close"
    // -- la columna donde vive este desglose -- usa ÚNICAMENTE bucketHealthy
    // (`branchForecastRow.forecastTotal`, calculado sobre `bucketHealthy` en
    // page.tsx, nunca sobre bucketTotal/Delayed). El desglose CTC+Closing
    // tiene que explicar ESE número, no el de la columna vecina (Total
    // Pipeline/CtcDot) -- por eso se filtra `healthy === true` ANTES de
    // separar por rawMilestone, y se compara contra `bucketHealthy.Closing`
    // (no contra `closingCount` de arriba, que a propósito sigue incluyendo
    // Delayed para el punto). Misma fuente cruda de siempre
    // (`branchForecastRow.loans`), solo que ahora filtrada por healthy antes
    // de contar -- sin tocar bucketTotal/bucketHealthy/closingCount.
    const healthyClosingCount = isBanked ? branchForecastRow.bucketHealthy.Closing : 0;
    const ctcSplit = isBanked
      ? splitCtcAndClosing(branchForecastRow.loans.filter((loan) => loan.healthy === true))
      : { ctcCount: 0, closingCount: 0 };
    if (process.env.NODE_ENV !== 'production' && ctcSplit.ctcCount + ctcSplit.closingCount !== healthyClosingCount) {
      console.warn('CTC+Closing (healthy) no coincide con bucketHealthy.Closing', {
        branch: branchForecastRow.branch,
        channel: branchForecastRow.channel,
        ctcCount: ctcSplit.ctcCount,
        closingCount: ctcSplit.closingCount,
        bucketHealthyClosingTotal: healthyClosingCount,
      });
    }
    return {
      branch: branchForecastRow.branch,
      channel: branchForecastRow.channel,
      closedCount,
      totalCount: branchForecastRow.totalCount,
      healthyCount: branchForecastRow.healthyCount,
      projectedToClose: branchForecastRow.forecastTotal,
      closingCount,
      ctcRawCount: ctcSplit.ctcCount,
      closingRawCount: ctcSplit.closingCount,
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
  /** Etapa F5k, Parte 3: suma de `row.closingCount` de las 2 filas (Banked + Brokered) de esta branch -- como Brokered siempre aporta 0 (ver BranchRow), esto termina siendo solo la parte Banked, tal como pide el brief. */
  closingCount: number;
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
      existing.closingCount += row.closingCount;
      existing.totalForecast += row.totalForecast;
    } else {
      map.set(row.branch, {
        branch: row.branch,
        closedCount: row.closedCount,
        totalCount: row.totalCount,
        healthyCount: row.healthyCount,
        projectedToClose: row.projectedToClose,
        closingCount: row.closingCount,
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
    loanType: loan.loanType,
    loanProgram: loan.loanProgram,
    noteHistory: loan.noteHistory,
  };
}

/**
 * Drill-down del punto CtcDot: mismo filtro exacto que ya usa el desglose de
 * texto "X CTC + X Closing" (ver splitCtcAndClosing/ctcRawCount/
 * closingRawCount, aggregate.ts + page.tsx) -- healthy === true SIEMPRE
 * (Projected to Close nunca incluye Delayed) + rawMilestone en las 2
 * etiquetas crudas que el bucket combinado "Closing" fusiona. Deliberadamente
 * NO usa `closingCount`/`bucketTotal.Closing` (el que enciende el punto en
 * sí, sin filtrar por healthy, ver CtcDot) -- ese conteo es el indicador de
 * presencia del punto, no la población que este modal debe auditar; el modal
 * explica el desglose de texto ya visible, no el punto.
 */
function ctcClosingEligibleLoans(loans: PipelineLoan[]): PipelineLoan[] {
  return loans.filter(
    (loan) => loan.healthy === true && (loan.rawMilestone === 'Clear To Close' || loan.rawMilestone === 'Closing')
  );
}

/** Agrupa los loans ya filtrados por ctcClosingEligibleLoans() en las 2 secciones del modal -- omite la sección que quede vacía (un branch con solo CTC no debe mostrar un header "Closing:" sin filas debajo). */
function buildCtcClosingSections(loans: PipelineLoan[]): { label: string; loans: LoanDetailModalLoan[] }[] {
  const ctc = loans.filter((loan) => loan.rawMilestone === 'Clear To Close').map(openLoanToModalLoan);
  const closing = loans.filter((loan) => loan.rawMilestone === 'Closing').map(openLoanToModalLoan);
  const sections: { label: string; loans: LoanDetailModalLoan[] }[] = [];
  if (ctc.length) sections.push({ label: 'Clear to Close', loans: ctc });
  if (closing.length) sections.push({ label: 'Closing', loans: closing });
  return sections;
}

/**
 * Fix (tooltip de CtcDot no coincidía con el modal): el título fijo
 * "N loans in Clear to Close" asumía un solo milestone, de antes de que
 * existiera el desglose CTC/Closing de hoy -- no distinguía cuál rawMilestone
 * tenía cada loan, y ni siquiera usaba la población healthy-only del modal
 * (usaba `closingCount`/bucketTotal, sin filtrar). Reusa EXACTAMENTE
 * ctcClosingEligibleLoans()/buildCtcClosingSections() (mismos que arma el
 * modal) para que el tooltip nunca pueda decir algo que el modal no muestre.
 * `undefined` si no hay loans elegibles -- mismo criterio que el resto de
 * `CtcDot` (sin title cuando no hay nada que reportar).
 */
function formatCtcClosingTooltip(loans: PipelineLoan[]): string | undefined {
  const sections = buildCtcClosingSections(ctcClosingEligibleLoans(loans));
  if (!sections.length) return undefined;
  return sections.map((section) => section.loans.length + ' ' + section.label).join(', ');
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
    loanType: loan.loanType,
    loanProgram: loan.loanProgram,
    noteHistory: loan.noteHistory,
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
 * Etapa UX8: agregó una fila de agrupación arriba ("Forecast" con colSpan=3).
 * Etapa UX9: se quita -- los tintes de color (`col-pipeline`/`col-forecast`,
 * ya aplicados a esta misma fila de rótulos) ya identifican el grupo sin
 * necesidad de una segunda fila de `<thead>`; sacarla libera altura y
 * simplifica el encabezado a una sola fila, como las demás tablas de la app.
 */
function ExecHead() {
  return (
    <thead>
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
 *
 * Etapa UX12: se quitó el punto verde de Healthy Pipeline (`.dot-healthy`) --
 * aparecía en toda fila con valor > 0, así que no distinguía nada, y
 * competía visualmente con la marca de CTC nueva de la columna vecina. Queda
 * solo el número, en esta fila, en `BranchDataRow` y en el bloque Combinado.
 */
function ExecTotalRow({ label, subtotal }: { label: string; subtotal: BlockSubtotal }) {
  return (
    <tr className="grp total">
      {/* Etapa UX9: colSpan=2 sobre Branch+Branch Manager -- antes el label
          ("Subtotal Brokered", "Combined Total (Banked - Retail + Brokered)")
          se recortaba contra el ancho angosto de la sola columna Branch. */}
      <td className="lbl" colSpan={2}>
        {label}
      </td>
      <td className="val col-pipeline group-start">{fmtInt(subtotal.totalCount)}</td>
      <td className="val col-pipeline">{fmtInt(subtotal.healthyCount)}</td>
      <td className="val col-forecast group-start">
        <ClosedValue value={subtotal.closedCount} />
      </td>
      <td className="val col-forecast">
        {/* El subtotal nunca pinta el punto (va como "N CTC" en CtcSubtotalNote,
            abajo) -- pero reserva el mismo espacio que las filas de arriba
            (count=0 fijo, no subtotal.closingCount) para que su número quede
            en la misma línea vertical que ellas. */}
        <span className="ctc-cell">
          <CtcDot count={0} />
          {fmtForecast(subtotal.projectedToClose)}
        </span>
        <CtcSubtotalNote ctcCount={subtotal.ctcRawCount} closingCount={subtotal.closingRawCount} />
      </td>
      <td className="totcol col-forecast">
        <span className="badge badge--pill badge--emerald">{fmtForecast(subtotal.totalForecast)}</span>
      </td>
    </tr>
  );
}

/**
 * Etapa UX12: reemplaza los puntos de F5k/UX10 (uno por préstamo, con tope de
 * 8) -- ahora un solo punto, sin importar cuántos préstamos haya en Clear to
 * Close. El tope y el número al lado del punto ya no aplican: nunca se dibuja
 * más de un punto por fila. El color es `--ctc-dot` (forecast-visual.css) --
 * el MISMO verde que ya usaba el punto de Healthy Pipeline, para que el
 * verde siga significando "va bien" en toda la app (antes era un tono nuevo,
 * navy, elegido justamente para no chocar con Healthy -- ya no hace falta
 * distinguirlos porque Healthy perdió su punto en este mismo ajuste).
 *
 * Ajuste posterior: SIEMPRE se renderiza el punto (con `count > 0` solo
 * decide si se pinta o queda transparente, vía `.ctc-dot--empty`), en vez de
 * `return null` cuando count es 0. Antes, el elemento faltaba por completo en
 * las filas sin CTC, así que esas filas medían menos que las filas con punto
 * -- centrado dentro de la celda, eso desplazaba el número entre unas filas y
 * otras (el 5 de Affinity no quedaba alineado con el 1 de 707). Reservando
 * siempre el mismo espacio, pintado o no, el ancho de cada fila es idéntico
 * y los números quedan en línea. Va ANTES del número (no después): "● 1", no
 * "1 ●".
 */
/**
 * Ajuste (drill-down CTC/Closing): `onClick` es opcional -- la fila de
 * subtotal (más abajo) sigue pasando `count={0}` sin `onClick`, exactamente
 * como antes, así que nunca se vuelve clickeable (un punto que nunca se
 * pinta no tiene nada que auditar). Cuando SÍ hay onClick y count > 0, el
 * punto pasa a ser un <button> real (mismo criterio que CountCell: value=0
 * nunca es clickeable) -- mismo footprint 6x6 que el <span> de siempre, ver
 * `.ctc-dot--clickable` (forecast-visual.css).
 *
 * Fix (tooltip no coincidía con el modal): `title` ya NO se calcula acá a
 * partir de `count` (era un texto fijo "N loans in Clear to Close" que
 * asumía un solo milestone) -- lo arma el caller con
 * formatCtcClosingTooltip(), mismo desglose real (ctcClosingEligibleLoans +
 * buildCtcClosingSections) que ya usa el modal, para que el tooltip nunca
 * pueda decir algo que el modal no muestre.
 */
function CtcDot({ count, onClick, title }: { count: number; onClick?: () => void; title?: string }) {
  if (onClick && count > 0) {
    return (
      <button
        type="button"
        className="ctc-dot ctc-dot--clickable"
        title={title}
        aria-label={title}
        onClick={onClick}
      />
    );
  }
  return <span className={'ctc-dot' + (count > 0 ? '' : ' ctc-dot--empty')} title={title} />;
}

/**
 * Etapa UX12: la fila de subtotal no lleva punto -- un punto binario no
 * puede representar "6 préstamos" sin perder información, así que en el
 * subtotal se muestra el número exacto en texto chico, subordinado al total
 * de Projected to Close de arriba: mismo verde que el punto, sin negrita.
 *
 * Ajuste (desglose CTC/Closing): antes mostraba un solo número combinado
 * ("6 CTC"); ahora desglosa ese mismo total en sus dos etiquetas crudas
 * ("4 CTC + 2 Closing", ver splitCtcAndClosing/ctcRawCount/closingRawCount)
 * -- el número combinado (`closingCount`, sin tocar) sigue siendo el que
 * alimenta pull-through/forecast, esto es solo el texto de este renglón.
 */
function CtcSubtotalNote({ ctcCount, closingCount }: { ctcCount: number; closingCount: number }) {
  if (ctcCount + closingCount <= 0) return null;
  return (
    <div className="ctc-subtotal-note">
      {fmtInt(ctcCount)} CTC + {fmtInt(closingCount)} Closing
    </div>
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
  onOpenCtcClosing,
}: {
  row: BranchRow;
  managerName: string;
  onOpenClosed: (row: BranchRow) => void;
  onOpenTotal: (row: BranchRow) => void;
  onOpenHealthy: (row: BranchRow) => void;
  onOpenCtcClosing: (row: BranchRow) => void;
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
        <CountCell value={row.healthyCount} onClick={() => onOpenHealthy(row)} />
      </td>
      <td className="val col-forecast group-start">
        <CountCell value={row.closedCount} onClick={() => onOpenClosed(row)} variant="closed" />
      </td>
      {/* Etapa UX8: Projected to Close no es clickeable, mismo motivo que
          Forecast -- es un valor calculado (pull-through), no una lista de
          préstamos concreta que auditar. */}
      <td className="val col-forecast">
        <span className="ctc-cell">
          <CtcDot
            count={row.closingCount}
            onClick={row.closingCount > 0 ? () => onOpenCtcClosing(row) : undefined}
            title={formatCtcClosingTooltip(row.branchForecastRow.loans)}
          />
          {fmtForecast(row.projectedToClose)}
        </span>
      </td>
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
  variant,
}: {
  value: number;
  onClick: () => void;
  /** 'closed' pinta el valor como badge de logro (fondo slate, navy bold). */
  variant?: 'closed';
}) {
  const base = variant === 'closed' ? 'cell-trigger cell-trigger--closed' : 'cell-trigger';
  if (value === 0) {
    return <span className={base + ' is-zero'}>0</span>;
  }
  return (
    <button type="button" className={base} onClick={onClick}>
      {fmtInt(value)}
    </button>
  );
}

/**
 * TAB 1 — Projected Forecast (spec §4C; antes "Executive Branch Forecast",
 * renombrada en Etapa UX9 -- el id interno de la tab ('executive') no cambió).
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

  /**
   * Drill-down del punto CtcDot de esta fila (una sola tabla de canal --
   * Banked - Retail o Brokered, nunca mezclados). `row.branchForecastRow.loans`
   * es el mismo pool de PipelineLoan de siempre (ya acotado a branch+channel
   * por buildBranchRows) -- se filtra acá con ctcClosingEligibleLoans() antes
   * de agrupar. Para Brokered esto siempre da 0 (bucketTotal es vestigial
   * ahí, ver BranchRow.closingCount), pero el handler igual queda wireado
   * por simetría -- el punto nunca es clickeable con count=0 (ver CtcDot).
   */
  function openCtcClosing(row: BranchRow) {
    const eligible = ctcClosingEligibleLoans(row.branchForecastRow.loans);
    setModal({
      context: contextFor(row),
      metric: 'CTC + Closing',
      loans: eligible.map(openLoanToModalLoan),
      sections: buildCtcClosingSections(eligible),
    });
  }

  /** Contexto del modal para una fila de "Combined Total by Branch" -- mismo formato que contextFor(), sin canal (combina los 2). */
  function contextForBranch(branch: string): string {
    return `Branch ${branch} — Combined (Banked - Retail + Brokered)`;
  }

  /**
   * Combined Total by Branch: mismo patrón que openTotalPipeline/
   * openHealthyPipeline/openClosed de arriba, sin filtrar por canal -- junta
   * las filas de `branchRows` de ese branch (como mucho 2: Banked + Brokered,
   * cada una con su propio array `loans` de PipelineLoan, nunca solapado
   * entre canales) en vez de una sola fila. No recalcula nada de
   * aggregate.ts ni de buildCombinedByBranch -- solo re-arma la LISTA de
   * préstamos detrás de un número que buildCombinedByBranch ya sumó.
   */
  function branchRowsFor(branch: string): BranchRow[] {
    return branchRows.filter((r) => r.branch === branch);
  }

  function openCombinedTotalPipeline(branch: string) {
    const loans = branchRowsFor(branch)
      .flatMap((r) => r.branchForecastRow.loans)
      .map(openLoanToModalLoan);
    setModal({ context: contextForBranch(branch), metric: 'Total Pipeline', loans });
  }

  function openCombinedHealthyPipeline(branch: string) {
    const loans = branchRowsFor(branch)
      .flatMap((r) => r.branchForecastRow.loans.filter((l) => l.healthy === true))
      .map(openLoanToModalLoan);
    setModal({ context: contextForBranch(branch), metric: 'Healthy Pipeline', loans });
  }

  // Mismo filtro que openClosed() de arriba, sin la condición de canal --
  // une los cerrados de Banked y Brokered de este branch (ResolvedLoan no
  // puede pertenecer a los 2 canales a la vez, así que no hay riesgo de
  // duplicar un préstamo al no filtrar por canal).
  function openCombinedClosed(branch: string) {
    const closedLoans = resolvedLoans.filter(
      (loan) =>
        loan.status === 'funded' &&
        loan.branch === branch &&
        loan.disbursementDate >= dateRange.startDate &&
        loan.disbursementDate <= dateRange.endDate
    );
    setModal({ context: contextForBranch(branch), metric: 'Closed', loans: closedLoans.map(closedLoanToModalLoan) });
  }

  /**
   * Combined Total by Branch: mismo patrón que openCtcClosing de arriba,
   * sin filtrar por canal -- une los loans de Banked + Brokered de este
   * branch (branchRowsFor ya trae ambas filas si existen) antes de aplicar
   * ctcClosingEligibleLoans(). Brokered sigue aportando 0 (bucketTotal
   * vestigial), así que en la práctica el resultado es equivalente al de
   * la fila Banked sola -- pero no se asume eso, se filtra sobre el pool
   * combinado real, igual que el resto de los openers "Combined".
   */
  function openCombinedCtcClosing(branch: string) {
    const eligible = ctcClosingEligibleLoans(branchRowsFor(branch).flatMap((r) => r.branchForecastRow.loans));
    setModal({
      context: contextForBranch(branch),
      metric: 'CTC + Closing',
      loans: eligible.map(openLoanToModalLoan),
      sections: buildCtcClosingSections(eligible),
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
                      onOpenCtcClosing={openCtcClosing}
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
            {/* Etapa UX9: nota reubicada acá desde el card "Total Forecast" --
                el 40% flat pull-through solo aplica a Brokered, no tenía
                sentido mostrarla en una tarjeta que resume ambos canales. */}
            {block.channel === 'Brokered' && (
              <p className="foot-note" style={{ padding: '0 16px 14px' }}>
                Brokered applies a flat 40% pull-through rate on its open pipeline (Total).
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="tbl-card" style={{ marginTop: '20px' }}>
        <div className="tbl-card__head">
          <span className="tbl-card__title">Combined Total by Branch</span>
        </div>
        <div className="tbl-scroll">
          {/* `piv--combined` (Fase urgente): solo agrega el centrado de columnas
              numéricas de ESTA tabla (components.css) -- no cambia nada más,
              Banked/Brokered arriba siguen usando table.piv td.val sin tocar. */}
          <table className="piv piv--exec piv--combined">
            <ExecColgroup />
            <ExecHead />
            <tbody>
              {combinedByBranch.map((row) => (
                <tr className="metric" key={row.branch}>
                  <td className="lbl">{row.branch}</td>
                  <td className="th-left manager-cell" title={branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}>
                    {branchManagers.get(row.branch) ?? UNASSIGNED_MANAGER}
                  </td>
                  <td className="val col-pipeline group-start">
                    <CountCell value={row.totalCount} onClick={() => openCombinedTotalPipeline(row.branch)} />
                  </td>
                  <td className="val col-pipeline">
                    <CountCell value={row.healthyCount} onClick={() => openCombinedHealthyPipeline(row.branch)} />
                  </td>
                  <td className="val col-forecast group-start">
                    <CountCell value={row.closedCount} onClick={() => openCombinedClosed(row.branch)} variant="closed" />
                  </td>
                  <td className="val col-forecast">
                    <span className="ctc-cell">
                      <CtcDot
                        count={row.closingCount}
                        onClick={row.closingCount > 0 ? () => openCombinedCtcClosing(row.branch) : undefined}
                        title={formatCtcClosingTooltip(branchRowsFor(row.branch).flatMap((r) => r.branchForecastRow.loans))}
                      />
                      {fmtForecast(row.projectedToClose)}
                    </span>
                  </td>
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
       * Fase urgente, punto 5: Isabella pidió explícitamente sacar de la UI
       * el texto explicativo que iba acá ("Closed + Projected to Close
       * always add up to Forecast..."). Es solo el párrafo de presentación
       * -- la garantía que describía (subtotales = suma exacta, ver
       * ExecTotalRow/addSubtotal más arriba) sigue intacta en el cálculo,
       * no se tocó nada de eso, solo se dejó de mostrar el texto.
       */}

      <LoanDetailModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        context={modal?.context ?? ''}
        metric={modal?.metric ?? ''}
        loans={modal?.loans ?? []}
        sections={modal?.sections}
      />
    </>
  );
}
