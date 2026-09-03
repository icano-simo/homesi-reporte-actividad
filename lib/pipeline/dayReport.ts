import { isClosedInMonth, type DateRange } from './aggregate';
import { pullThroughWeight, type BranchForecastRow } from './branchForecast';
import { classifyStrategy, type Strategy } from './strategy';
import type { PipelineLoan, ResolvedLoan } from './types';

/**
 * ============================================================================
 * EL FORECAST DE HOY — el modelo (etapa RPT6)
 * ============================================================================
 *
 * Una foto del presente: el pipeline como está AHORA y lo que proyecta. No
 * tiene fecha de corte fija ni comparación de cierre -- el corte es el día de
 * la descarga. Es lo contrario del reporte mensual, que compara un corte pasado
 * contra un cierre ya ocurrido.
 *
 * ---------------------------------------------------------------------------
 * ⚠ CORRE EN EL CLIENTE, Y ESA ES LA DECISIÓN QUE IMPORTA
 * ---------------------------------------------------------------------------
 *
 * Recibe `BranchForecastRow[]` y los resueltos TAL COMO ESTÁN EN LA PANTALLA,
 * ya filtrados por branch y por rango. No vuelve a consultar Supabase ni
 * recalcula nada: los números del Excel son los mismos objetos que alimentan las
 * tarjetas del Executive Summary.
 *
 * Es el patrón de `/api/pipeline/export` y no el del reporte mensual. Aquel
 * necesita TRES snapshots --el del corte, el de fin de mes y el activo-- y el
 * navegador sólo tiene el activo, así que no le queda otra que leer del
 * servidor. Éste no necesita ninguno más: lo que hay que exportar ya está en
 * memoria. Y si estuviera en el servidor, "exactamente los de la pantalla"
 * pasaría a ser una propiedad que hay que verificar en vez de una que se cumple
 * por construcción.
 *
 * ---------------------------------------------------------------------------
 * ⚠ DOS RANGOS, NO UNO, Y NO SE PUEDEN UNIFICAR
 * ---------------------------------------------------------------------------
 *
 * La pantalla usa dos y son independientes desde la etapa F5e:
 *
 *   pipelineRange   acota Total Pipeline y Healthy Pipeline, por
 *                   `estClosingDate` -- lo aplica `splitHealthyTotal`.
 *   forecastRange   acota los CERRADOS, por fecha de desembolso -- lo aplica
 *                   `isClosedInMonth`.
 *
 * Unificarlos acá daría números que la pantalla no muestra. Los dos van al
 * subtítulo del Excel para que quien lo lea sepa contra qué comparar.
 */

/** Abierto o cerrado. Los dos estados que componen el Executive Summary. */
export type DayStatus = 'Open' | 'Closed';

export interface DayReportRow {
  orgId: string;
  branch: string;
  channel: PipelineLoan['channel'];
  loanNumber: string;
  borrowerName: string;
  loanOfficer: string;
  loanAmount: number | null;
  lastFinishedMilestoneDate: string | null;
  fundingDate: string | null;
  lastFinishedMilestone: string;
  loanProgram: string;
  loanType: string;
  strategy: Strategy | '';
  estClosingDate: string | null;
  /** El valor crudo de Healthiness, informativo. */
  healthiness: string;
  /**
   * `Yes` / `No`, y es la que usan las fórmulas.
   *
   * ⚠ NO SE DERIVA DE `Healthiness` con un COUNTIFS. La app decide healthy con
   * `classifyHealthy`, que mapea varios valores crudos; un `COUNTIFS(=="On
   * Track")` daría un número parecido y no el mismo. La columna lleva la
   * decisión ya tomada, igual que `Strategy`.
   */
  healthy: 'Yes' | 'No';
  status: DayStatus;
  /**
   * Lo que este préstamo aporta al forecast. 0 en los cerrados: ya cerraron, no
   * se proyectan. Ver `pullThroughWeight` -- es la misma cascada de la pantalla
   * mirada de a un préstamo, y su suma por (branch, canal) da el forecast exacto
   * de ese grupo.
   */
  ptWeight: number;
}

export interface DayChannelCells {
  totalPipeline: number;
  healthyPipeline: number;
  closed: number;
  /** `null` en las filas de persona: la cascada está definida por (branch, canal). */
  forecast: number | null;
  /** Cerrados + forecast. `null` donde no hay forecast. */
  total: number | null;
}

export interface DayReportSummaryRow {
  kind: 'division' | 'branch' | 'officer';
  branch: string;
  loanOfficer: string;
  banked: DayChannelCells;
  brokered: DayChannelCells;
}

export interface DayReportInput {
  /** Las filas de la pantalla, ya filtradas por el branch elegido. */
  branchRows: BranchForecastRow[];
  /** Los resueltos de la pantalla, ya filtrados por branch. */
  resolvedLoans: ResolvedLoan[];
  /** El rango que acota Total/Healthy Pipeline. */
  pipelineRange: DateRange;
  /** El mes que acota los cerrados. */
  forecastRange: DateRange;
}

export interface DayReportModel {
  rows: DayReportRow[];
  summary: DayReportSummaryRow[];
  counts: { open: number; closed: number; total: number };
}

const CHANNELS: PipelineLoan['channel'][] = ['Banked - Retail', 'Brokered'];

function strategyOf(l: { branch: string; strategyRaw: string; opportunityOwnerTitle: string }): Strategy | '' {
  /* Sin los crudos no hay clasificación posible: vacío, no una estrategia inventada. */
  if (!l.strategyRaw && !l.opportunityOwnerTitle) return '';
  return classifyStrategy(l);
}

export function buildDayReport(input: DayReportInput): DayReportModel {
  const { branchRows, resolvedLoans, forecastRange } = input;

  const rows: DayReportRow[] = [];

  /* Los abiertos salen de `loans` de cada fila: ya vienen filtrados por la pantalla. */
  for (const br of branchRows) {
    for (const l of br.loans) {
      rows.push({
        orgId: l.branch,
        branch: l.branch,
        channel: l.channel,
        loanNumber: l.sourceLoanId,
        borrowerName: l.borrowerName ?? '',
        loanOfficer: l.loanOfficer ?? '',
        loanAmount: l.amount ?? null,
        lastFinishedMilestoneDate: l.milestoneDate,
        fundingDate: null,
        lastFinishedMilestone: l.rawMilestone,
        loanProgram: l.loanProgram ?? '',
        loanType: l.loanType ?? '',
        strategy: strategyOf(l),
        estClosingDate: l.estClosingDate,
        healthiness: l.rawHealthiness ?? '',
        healthy: l.healthy === true ? 'Yes' : 'No',
        status: 'Open',
        ptWeight: pullThroughWeight(l),
      });
    }
  }

  /*
   * Y los cerrados del mes de forecast, con la MISMA `isClosedInMonth` que usa
   * el Executive Summary. Sin ellos la columna `Closed` no se podría derivar del
   * detalle y habría que escribirla a mano.
   *
   * ⚠ Los `adverse` no entran. La pantalla no los cuenta en ninguna de las cinco
   * métricas --se cayeron del pipeline-- así que una fila suya en el detalle no
   * sería contada por ningún COUNTIFS y rompería la única propiedad que hace
   * auditable la hoja: que las tres cuenten lo mismo.
   */
  for (const r of resolvedLoans) {
    if (!isClosedInMonth(r, forecastRange)) continue;
    rows.push({
      orgId: r.branch,
      branch: r.branch,
      channel: r.channel,
      loanNumber: r.sourceLoanId,
      borrowerName: r.borrowerName ?? '',
      loanOfficer: r.loanOfficer ?? '',
      loanAmount: r.amount ?? null,
      /* `pipeline_resolved_loans` no guarda milestone -- ver su nota en types.ts. */
      lastFinishedMilestoneDate: null,
      fundingDate: r.disbursementDate,
      lastFinishedMilestone: 'Funded',
      loanProgram: r.loanProgram ?? '',
      loanType: r.loanType ?? '',
      strategy: strategyOf(r),
      estClosingDate: r.estClosingDate,
      healthiness: 'Funded',
      healthy: 'No',
      status: 'Closed',
      ptWeight: 0,
    });
  }

  rows.sort(
    (a, b) =>
      a.branch.localeCompare(b.branch) ||
      a.loanOfficer.localeCompare(b.loanOfficer) ||
      a.loanNumber.localeCompare(b.loanNumber)
  );

  /*
   * ==========================================================================
   * EL RESUMEN
   * ==========================================================================
   *
   * ⚠ EL FORECAST SALE DE `br.forecastTotal`, no de sumar pesos.
   *
   * Es el número que la pantalla ya redondeó por (branch, canal), y el total de
   * división es la SUMA de esos redondeos -- exactamente como
   * `grandForecastTotal` del Executive Summary. Redondear al final daría otro
   * número: medido en su momento, 33 sumando redondeos contra 32 redondeando la
   * suma.
   *
   * La columna `PT weight` del detalle existe para que la fórmula del Excel
   * reproduzca ese mismo número con un `ROUND(SUMIFS(...))`, no para calcularlo
   * acá por segunda vez.
   *
   * ⚠ Y NO HAY FORECAST POR PERSONA. La cascada está definida por (branch,
   * canal): un forecast por Loan Officer sería inventado, y sin forecast tampoco
   * hay `Total` que calcular. Es la misma decisión que el reporte mensual.
   */
  const forecastPor = new Map<string, number>();
  for (const br of branchRows) forecastPor.set(br.branch + '|' + br.channel, br.forecastTotal);

  const claves = new Map<string, { branch: string; loanOfficer: string }>();
  for (const r of rows) claves.set(r.branch + '|' + r.loanOfficer, { branch: r.branch, loanOfficer: r.loanOfficer });

  const celdasDe = (branch: string, loanOfficer: string | null, channel: PipelineLoan['channel']): DayChannelCells => {
    const suyas = rows.filter(
      (r) => r.branch === branch && r.channel === channel && (loanOfficer === null || r.loanOfficer === loanOfficer)
    );
    const abiertos = suyas.filter((r) => r.status === 'Open');
    const cerrados = suyas.filter((r) => r.status === 'Closed').length;
    const forecast = loanOfficer === null ? (forecastPor.get(branch + '|' + channel) ?? 0) : null;
    return {
      totalPipeline: abiertos.length,
      healthyPipeline: abiertos.filter((r) => r.healthy === 'Yes').length,
      closed: cerrados,
      forecast,
      total: forecast === null ? null : cerrados + forecast,
    };
  };

  const sumar = (xs: DayChannelCells[]): DayChannelCells =>
    xs.reduce(
      (a, c) => ({
        totalPipeline: a.totalPipeline + c.totalPipeline,
        healthyPipeline: a.healthyPipeline + c.healthyPipeline,
        closed: a.closed + c.closed,
        forecast: (a.forecast ?? 0) + (c.forecast ?? 0),
        total: (a.total ?? 0) + (c.total ?? 0),
      }),
      { totalPipeline: 0, healthyPipeline: 0, closed: 0, forecast: 0, total: 0 }
    );

  const branches = [...new Set([...claves.values()].map((k) => k.branch))].sort((a, b) => a.localeCompare(b));
  const filasBranch: DayReportSummaryRow[] = [];
  for (const branch of branches) {
    filasBranch.push({
      kind: 'branch',
      branch,
      loanOfficer: '',
      banked: celdasDe(branch, null, CHANNELS[0]),
      brokered: celdasDe(branch, null, CHANNELS[1]),
    });
    const officers = [...claves.values()]
      .filter((k) => k.branch === branch)
      .map((k) => k.loanOfficer)
      .sort((a, b) => a.localeCompare(b));
    for (const who of officers) {
      filasBranch.push({
        kind: 'officer',
        branch,
        loanOfficer: who,
        banked: celdasDe(branch, who, CHANNELS[0]),
        brokered: celdasDe(branch, who, CHANNELS[1]),
      });
    }
  }

  const soloBranches = filasBranch.filter((f) => f.kind === 'branch');
  const summary: DayReportSummaryRow[] = [
    {
      kind: 'division',
      branch: '',
      loanOfficer: '',
      banked: sumar(soloBranches.map((f) => f.banked)),
      brokered: sumar(soloBranches.map((f) => f.brokered)),
    },
    ...filasBranch,
  ];

  return {
    rows,
    summary,
    counts: {
      open: rows.filter((r) => r.status === 'Open').length,
      closed: rows.filter((r) => r.status === 'Closed').length,
      total: rows.length,
    },
  };
}

/**
 * ============================================================================
 * ⚠ QUÉ BOTÓN OFRECE UN MES — etapa RPT6
 * ============================================================================
 *
 *   mes ya cerrado   sólo el reporte mensual: arranque contra cierre.
 *   mes en curso     sólo el del día: una foto del presente.
 *   mes futuro       ninguno.
 *
 * El motivo de que no convivan: un reporte de cierre generado a mitad de mes
 * muestra un cierre que todavía no ocurrió, y quien lo abra lo va a leer como
 * definitivo. Que la opción NO EXISTA es mejor que advertir que no se use.
 *
 * ⚠ SE DERIVA DE LA FECHA DEL SISTEMA, nunca de una lista de meses cerrados. Una
 * lista hay que mantenerla y el día que nadie la actualice el mes en curso va a
 * ofrecer un cierre inexistente.
 *
 * ⚠ Y USA LA HORA DE NEGOCIO, no UTC. `businessToday()` existe por un bug real:
 * el selector de período saltaba a septiembre desde las 7 de la tarde del 31 de
 * agosto en Colombia. Con `utcToday()` acá, cinco horas antes de que termine el
 * último día del mes, el botón cambiaría de uno a otro.
 *
 * ⚠ EL MES RECIÉN ARRANCADO OFRECE EL DEL DÍA, con un día de datos y a
 * propósito: es una foto del presente y un día es un presente válido. Un
 * pipeline el 1 de octubre es un dato -- lo que no existiría es su cierre.
 */
export type MonthExportKind = 'monthly' | 'day' | 'none';

export function exportKindForMonth(month: string, today: { year: number; month: number }): MonthExportKind {
  const [y, m] = month.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 'none';
  if (y === today.year && m === today.month) return 'day';
  if (y < today.year || (y === today.year && m < today.month)) return 'monthly';
  return 'none';
}
