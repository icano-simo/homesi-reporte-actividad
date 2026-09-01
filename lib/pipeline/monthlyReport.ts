import { apportionByWeight, isClosedInMonth, type DateRange } from './aggregate';
import { buildBranchForecastRows } from './branchForecast';
import { classifyStrategy, type Strategy } from './strategy';
import type { PipelineLoan, ResolvedLoan } from './types';

/**
 * ============================================================================
 * REPORTE MENSUAL DE PIPELINE — el modelo (etapa RPT1)
 * ============================================================================
 *
 * Compara cómo estaba el pipeline en una FECHA DE CORTE contra cómo cerró el
 * mes. Módulo puro: no sabe de Supabase ni de ExcelJS. La ruta le pasa los tres
 * snapshots ya leídos y recibe filas y resumen; así el modelo se puede verificar
 * sin levantar nada.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS DOS FECHAS QUE DEFINEN EL REPORTE, Y POR QUÉ NO SON LA MISMA
 * ---------------------------------------------------------------------------
 *
 *   QUIÉNES son las filas   sale de los snapshots del CORTE y del último día
 *                           del mes: los que estaban abiertos al corte, más los
 *                           que aparecieron durante el mes.
 *   QUÉ LES PASÓ            sale del snapshot ACTIVO, el más reciente. Estado,
 *                           fecha de cierre y milestone, los tres.
 *
 * No es un detalle. Medido en agosto de 2026: cuatro préstamos desembolsaron el
 * 28 y el 31 de agosto y Salesforce los marcó Closed Won DESPUÉS de que se tomó
 * el export del 31. El snapshot de fin de mes los muestra abiertos en milestone
 * `Closing`; el activo los muestra fundeados, con fecha de desembolso de agosto.
 * Leer el estado del snapshot del 31 da 32 Banked; leerlo del activo da 36, que
 * es lo que muestra la pantalla y lo correcto.
 *
 * Es un retraso de CARGA, no una ambigüedad de mes: las cuatro fechas de
 * desembolso caen dentro de agosto. Por eso la regla es simple y no necesita
 * excepciones -- un préstamo cuenta en el mes de su desembolso, sin importar
 * cuándo se enteró el sistema.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NINGÚN NÚMERO DE ACÁ ES UNA DEFINICIÓN NUEVA
 * ---------------------------------------------------------------------------
 * "Cerrado" es `isClosedInMonth`, la misma que usa el Executive Summary de la
 * pantalla. El forecast es `buildBranchForecastRows`, la misma cascada, con las
 * mismas tasas y la misma diferencia entre Banked y Brokered. El reparto entre
 * Loan Officers es `apportionByWeight`, el mismo de siempre. La estrategia es
 * `classifyStrategy`. Este archivo ORDENA esos números; no calcula ninguno por
 * su cuenta.
 */

/** El estado al cierre del mes. Los tres son excluyentes y cubren el universo. */
export type EndOfMonthState = 'Closed' | 'Adversed' | 'Still Open';

export interface MonthlyReportRow {
  /** `raw_org_id`. Medido: coincide con `branch` en las 13 branches, así que sirve de clave. */
  orgId: string;
  branch: string;
  channel: PipelineLoan['channel'];
  loanNumber: string;
  borrowerName: string;
  loanOfficer: string;
  loanAmount: number | null;
  /** De `activity_report.loan_records_v2`: el pipeline no trae fecha de solicitud. */
  applicationDate: string | null;
  /** El milestone ACTUAL, no el del corte -- y su fecha. */
  lastFinishedMilestoneDate: string | null;
  lastFinishedMilestone: string;
  fundingDate: string | null;
  loanProgram: string;
  /** `'Pipeline'` si estaba abierto al corte; vacío si apareció después. */
  startOfMonth: '' | 'Pipeline';
  endOfMonth: EndOfMonthState;
  strategy: Strategy | '';
  loanType: string;
  /** Su Est. Closing Date en el snapshot del corte. Vacío si no estaba. */
  estClosingStart: string | null;
  /** Dónde quedó. */
  estClosingEnd: string | null;
  /** `'Yes'` sólo si las dos existen y difieren -- "no sé" no es "no se movió". */
  estClosingMoved: '' | 'Yes';
  /** 1 o 2, de `loan_records_v2.lien_position`. */
  lien: number | null;
}

/** Una celda del resumen: un (branch, Loan Officer, canal). */
export interface MonthlyReportSummaryRow {
  branch: string;
  loanOfficer: string;
  channel: PipelineLoan['channel'];
  /** Al corte. */
  pipelineAtCutoff: number;
  closedAtCutoff: number;
  potentialAtCutoff: number;
  forecastAtCutoff: number;
}

export interface MonthlyReportInput {
  /** 'YYYY-MM'. */
  month: string;
  monthRange: DateRange;
  cutoffDate: string;
  /** Abiertos en el snapshot del corte. */
  anchorOpen: PipelineLoan[];
  /** Resueltos en el snapshot del corte -- para el "Closed" de la columna del corte. */
  anchorResolved: ResolvedLoan[];
  /** Ids vistos ABIERTOS en algún snapshot posterior al corte y hasta fin de mes. */
  existedByMonthEnd: Set<string>;
  /**
   * Ids abiertos en el snapshot del ÚLTIMO DÍA del mes. Es lo que decide si un
   * préstamo seguía en el pipeline al cierre -- ver `endOfMonth`.
   */
  openAtMonthEnd: Set<string>;
  /** El estado de HOY. */
  activeOpen: PipelineLoan[];
  activeResolved: ResolvedLoan[];
  /**
   * El último milestone conocido de cada préstamo, para los que ya cerraron:
   * `pipeline_resolved_loans` no guarda milestone, así que se toma el que tenía
   * la última vez que se lo vio abierto. Es literalmente "last finished
   * milestone".
   */
  lastMilestone: Map<string, { milestone: string; date: string | null }>;
  /** De `loan_records_v2`, por número de préstamo. */
  fromActivity: Map<string, { applicationDate: string | null; lien: number | null }>;
}

export interface MonthlyReportModel {
  rows: MonthlyReportRow[];
  summary: MonthlyReportSummaryRow[];
  /** Para la portada y para el reporte de verificación. */
  counts: {
    universe: number;
    atCutoff: number;
    appearedDuringMonth: number;
    /** Los que ya habían cerrado cuando se tomó el snapshot del corte. */
    closedBeforeCutoff: number;
    closed: number;
    adversed: number;
    stillOpen: number;
    closedByChannel: Record<string, number>;
  };
}

function strategyOf(l: { branch: string; strategyRaw: string; opportunityOwnerTitle: string }): Strategy | '' {
  /* Sin los crudos no hay clasificación posible: vacío, no una estrategia inventada. */
  if (!l.strategyRaw && !l.opportunityOwnerTitle) return '';
  return classifyStrategy(l);
}

export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReportModel {
  const {
    monthRange,
    anchorOpen,
    anchorResolved,
    existedByMonthEnd,
    openAtMonthEnd,
    activeOpen,
    activeResolved,
    lastMilestone,
    fromActivity,
  } = input;

  const anchorById = new Map(anchorOpen.map((l) => [l.sourceLoanId, l]));
  const activeOpenById = new Map(activeOpen.map((l) => [l.sourceLoanId, l]));
  const activeResolvedById = new Map(activeResolved.map((l) => [l.sourceLoanId, l]));

  /*
   * ==========================================================================
   * ⚠ EL UNIVERSO SON TRES CONJUNTOS, NO DOS
   * ==========================================================================
   *
   *   1. los abiertos al CORTE
   *   2. los que aparecieron abiertos DESPUÉS del corte y hasta fin de mes
   *   3. los que CERRARON en el mes, hayan estado o no en los dos anteriores
   *
   * El tercero parece redundante y no lo es. Un préstamo que fundeó ANTES del
   * corte ya estaba resuelto cuando se tomó el snapshot del corte: no aparece
   * entre los abiertos de ese día ni vuelve a aparecer abierto después. Sin esta
   * cláusula queda fuera del reporte, y es un cierre real del mes.
   *
   * Medido en agosto de 2026: son cinco --el 3, el 4, el 4, el 5 y el 5--, y sin
   * ellos el reporte decía 31 Banked contra los 36 de la pantalla. Con ellos da
   * 36, que es el requisito: los totales del reporte tienen que coincidir con lo
   * que muestra Forecast para el mismo mes.
   *
   * ⚠ Y NO se usan los ids de `pipeline_resolved_loans` en bloque para esto:
   * esa tabla es ACUMULATIVA --el snapshot del 31 trae los 911 resueltos de toda
   * la historia--. Sólo entran los que `isClosedInMonth` acepta.
   */
  const universe = new Set<string>([...anchorById.keys()]);
  for (const id of existedByMonthEnd) universe.add(id);
  for (const r of activeResolved) {
    if (isClosedInMonth(r, monthRange)) universe.add(r.sourceLoanId);
  }

  const rows: MonthlyReportRow[] = [];
  for (const id of universe) {
    const atCutoff = anchorById.get(id);
    const openNow = activeOpenById.get(id);
    const resolvedNow = activeResolvedById.get(id);
    /*
     * De dónde salen los campos descriptivos: del registro de HOY si existe, y
     * del corte sólo para los que ya no están en ningún lado --un préstamo que
     * se borró del origen--. Nunca al revés: el reporte describe el estado
     * actual, no el del corte.
     */
    const base = openNow ?? resolvedNow ?? atCutoff;
    if (!base) continue;

    /*
     * ⚠ EL ESTADO AL CIERRE DEL MES, EN ESTE ORDEN Y POR ESTOS MOTIVOS.
     *
     * 1. `Closed` gana sobre todo. Es lo que rescata los cuatro préstamos de
     *    agosto que el snapshot del 31 mostraba abiertos en `Closing` y que
     *    habían desembolsado el 28 y el 31: el retraso es de la carga, no del
     *    negocio.
     * 2. Si al último día del mes seguía ABIERTO, es `Still Open` -- aunque hoy
     *    figure adverse. Un préstamo que cayó en septiembre no fue un adverse de
     *    agosto, y sin este paso el reporte le atribuiría al mes cerrado algo
     *    que pasó después.
     * 3. Recién ahí, `Adversed`.
     *
     * ⚠ LO QUE ESTO NO PUEDE HACER: `pipeline_resolved_loans` no guarda CUÁNDO
     * un préstamo pasó a adverse, así que para los que ya estaban resueltos
     * antes del último día del mes se toma su estado actual. Es exacto para todo
     * lo que seguía abierto al 31 --que es el caso que importa-- y aproximado
     * para lo que se resolvió antes.
     */
    const closed = resolvedNow ? isClosedInMonth(resolvedNow, monthRange) : false;
    const endOfMonth: EndOfMonthState = closed
      ? 'Closed'
      : openAtMonthEnd.has(id)
        ? 'Still Open'
        : resolvedNow?.status === 'adverse'
          ? 'Adversed'
          : 'Still Open';

    const extra = fromActivity.get(id);
    /*
     * El milestone ACTUAL si sigue abierto; el último que se le vio si ya cerró.
     *
     * ⚠ Y UN LITERAL cuando no se le vio ninguno. Pasa con los que cerraron
     * ANTES del corte --cinco en agosto de 2026--: nunca aparecen abiertos en
     * ningún snapshot desde el corte en adelante, así que no hay milestone que
     * recuperar sin recorrer toda la historia. `Funded` / `Adverse` es el mismo
     * criterio que usa `/api/pipeline/export` para la columna Healthiness de un
     * préstamo cerrado, y dice la verdad: es su estado terminal. Una celda vacía
     * se leería como un dato que se perdió.
     */
    const observado = openNow
      ? { milestone: openNow.rawMilestone, date: openNow.milestoneDate }
      : lastMilestone.get(id);
    const milestoneNow = observado ?? {
      milestone: closed ? 'Funded' : resolvedNow?.status === 'adverse' ? 'Adverse' : '',
      date: null,
    };

    const estStart = atCutoff?.estClosingDate ?? null;
    const estEnd = openNow?.estClosingDate ?? resolvedNow?.estClosingDate ?? null;

    rows.push({
      orgId: openNow?.branch ?? base.branch,
      branch: base.branch,
      channel: base.channel,
      loanNumber: id,
      borrowerName: base.borrowerName ?? '',
      loanOfficer: base.loanOfficer ?? '',
      loanAmount: base.amount ?? null,
      applicationDate: extra?.applicationDate ?? null,
      lastFinishedMilestoneDate: milestoneNow.date,
      lastFinishedMilestone: milestoneNow.milestone,
      fundingDate: closed ? (resolvedNow?.disbursementDate ?? null) : null,
      loanProgram: base.loanProgram ?? '',
      startOfMonth: atCutoff ? 'Pipeline' : '',
      endOfMonth,
      strategy: strategyOf({
        branch: base.branch,
        strategyRaw: base.strategyRaw ?? '',
        opportunityOwnerTitle: base.opportunityOwnerTitle ?? '',
      }),
      loanType: base.loanType ?? '',
      estClosingStart: estStart,
      estClosingEnd: estEnd,
      /* Sin las dos fechas no se puede afirmar que se movió, así que no se afirma. */
      estClosingMoved: estStart && estEnd && estStart !== estEnd ? 'Yes' : '',
      lien: extra?.lien ?? null,
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
   * EL RESUMEN AL CORTE, ABIERTO POR LOAN OFFICER
   * ==========================================================================
   *
   * ⚠ EL FORECAST DE UN LOAN OFFICER NO SE CALCULA: SE REPARTE.
   *
   * La cascada está definida por (branch, canal) -- es ahí donde el negocio fijó
   * las tasas-- así que el forecast de una persona no es "su cascada", es su
   * parte del forecast de su branch. Se reparte con `apportionByWeight`, usando
   * como peso el forecast EXACTO de sus propios préstamos por la misma función.
   *
   * Así las personas suman exactamente el branch y el branch suma exactamente lo
   * que muestra la pantalla. Calcular la cascada por persona y redondear cada
   * una daría un total distinto del de Forecast, que es justo el descuadre que
   * este reporte viene a eliminar.
   */
  const summary: MonthlyReportSummaryRow[] = [];
  const cutoffRange: DateRange = { startDate: monthRange.startDate, endDate: monthRange.endDate };
  const branchChannelRows = buildBranchForecastRows(anchorOpen, cutoffRange);

  for (const br of branchChannelRows) {
    const suyos = anchorOpen.filter((l) => l.branch === br.branch && l.channel === br.channel);
    const officers = [...new Set(suyos.map((l) => l.loanOfficer))].sort((a, b) => a.localeCompare(b));

    const pesos = officers.map((who) => {
      const delLo = suyos.filter((l) => l.loanOfficer === who);
      /* La MISMA función, sobre los préstamos de una sola persona. */
      return buildBranchForecastRows(delLo, cutoffRange).reduce((a, r) => a + r.forecastExact, 0);
    });
    const partes = apportionByWeight(br.forecastTotal, pesos);

    officers.forEach((who, i) => {
      const delLo = suyos.filter((l) => l.loanOfficer === who);
      const cerradosAlCorte = anchorResolved.filter(
        (r) => r.branch === br.branch && r.channel === br.channel && r.loanOfficer === who && isClosedInMonth(r, monthRange)
      ).length;
      summary.push({
        branch: br.branch,
        loanOfficer: who,
        channel: br.channel,
        pipelineAtCutoff: delLo.length,
        closedAtCutoff: cerradosAlCorte,
        potentialAtCutoff: delLo.filter((l) => l.healthy === true).length,
        forecastAtCutoff: partes[i],
      });
    });
  }
  summary.sort(
    (a, b) => a.branch.localeCompare(b.branch) || a.loanOfficer.localeCompare(b.loanOfficer) || a.channel.localeCompare(b.channel)
  );

  const closedByChannel: Record<string, number> = {};
  for (const r of rows) {
    if (r.endOfMonth === 'Closed') closedByChannel[r.channel] = (closedByChannel[r.channel] ?? 0) + 1;
  }

  return {
    rows,
    summary,
    counts: {
      universe: rows.length,
      atCutoff: rows.filter((r) => r.startOfMonth === 'Pipeline').length,
      /*
       * "Apareció" y "ya había cerrado" no son lo mismo, aunque los dos tengan
       * `Start of month` vacío: uno nació después del corte y el otro ya no
       * estaba. Contarlos juntos hacía que el pie de página dijera que 91
       * préstamos aparecieron durante el mes cuando fueron 86.
       */
      appearedDuringMonth: rows.filter((r) => r.startOfMonth === '' && existedByMonthEnd.has(r.loanNumber)).length,
      closedBeforeCutoff: rows.filter((r) => r.startOfMonth === '' && !existedByMonthEnd.has(r.loanNumber)).length,
      closed: rows.filter((r) => r.endOfMonth === 'Closed').length,
      adversed: rows.filter((r) => r.endOfMonth === 'Adversed').length,
      stillOpen: rows.filter((r) => r.endOfMonth === 'Still Open').length,
      closedByChannel,
    },
  };
}

/**
 * El primer jueves del mes, en UTC — el corte por defecto.
 *
 * UTC explícito, nunca los métodos locales: es la regla del proyecto. Derivar
 * un día con `getDay()` puede correrlo según el huso de quien mira la pantalla,
 * y acá un día de diferencia cambia qué snapshot se usa.
 */
export function firstThursdayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
