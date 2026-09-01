import { NextResponse } from 'next/server';
import { Workbook } from 'exceljs';
import { getServerClient } from '@/lib/supabase/server';
import { isClosedInMonth, targetMonthRange } from '@/lib/pipeline/aggregate';
import {
  buildMonthlyReport,
  firstThursdayOf,
  type MonthlyReportRow,
} from '@/lib/pipeline/monthlyReport';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';

export const runtime = 'nodejs';

const PAGE_SIZE = 1000;

/**
 * ============================================================================
 * REPORTE MENSUAL DE PIPELINE — la ruta (etapa RPT1)
 * ============================================================================
 *
 * Arma el Excel de tres hojas que compara el pipeline en la fecha de corte
 * contra cómo cerró el mes. El cálculo vive en `lib/pipeline/monthlyReport.ts`;
 * acá sólo se leen los snapshots y se dibuja el libro.
 *
 * ⚠ ESTA RUTA SÍ CONSULTA SUPABASE, a diferencia de `/api/pipeline/export`, que
 * a propósito recibe del cliente lo que ya está en pantalla para que no puedan
 * divergir. La diferencia tiene motivo: aquel exporta lo que se ve, y éste
 * necesita TRES snapshots --el del corte, el del último día del mes y el
 * activo-- y el navegador sólo tiene el activo. Mandar los otros dos por el
 * cuerpo de un POST sería subir y bajar el mismo dato.
 *
 * El riesgo que aquella nota evita --que la pantalla y el archivo digan cosas
 * distintas-- se cubre por el otro lado: los números salen de las MISMAS
 * funciones que usa la pantalla (`isClosedInMonth`, `buildBranchForecastRows`,
 * `apportionByWeight`, `classifyStrategy`), y el snapshot activo se elige con el
 * mismo `is_active = true`. No hay una segunda fórmula en ningún punto.
 */

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
  return String(err);
}

interface OpenRow {
  source_loan_id: string;
  branch: string;
  channel: PipelineLoan['channel'];
  healthy: boolean | null;
  milestone: PipelineLoan['milestone'];
  raw_milestone: string;
  raw_healthiness: string;
  close_month: string;
  est_closing_date: string | null;
  amount: number | string | null;
  loan_officer: string | null;
  borrower_name: string;
  milestone_date: string | null;
  loan_type: string | null;
  loan_program: string | null;
  strategy_raw: string | null;
  opportunity_owner_title: string | null;
}

interface ResolvedRow {
  source_loan_id: string;
  branch: string;
  channel: ResolvedLoan['channel'];
  status: ResolvedLoan['status'];
  disbursement_date: string;
  est_closing_date: string | null;
  amount: number | string | null;
  loan_officer: string | null;
  borrower_name: string;
  loan_status: string;
  loan_type: string | null;
  loan_program: string | null;
  strategy_raw: string | null;
  opportunity_owner_title: string | null;
}

const OPEN_COLS =
  'source_loan_id, branch, channel, healthy, milestone, raw_milestone, raw_healthiness, close_month, est_closing_date, amount, loan_officer, borrower_name, milestone_date, loan_type, loan_program, strategy_raw, opportunity_owner_title';
const RESOLVED_COLS =
  'source_loan_id, branch, channel, status, disbursement_date, est_closing_date, amount, loan_officer, borrower_name, loan_status, loan_type, loan_program, strategy_raw, opportunity_owner_title';

/** Los campos que el modelo lee de un abierto. El resto de `PipelineLoan` no se usa acá. */
function toOpen(r: OpenRow): PipelineLoan {
  return {
    sourceLoanId: r.source_loan_id,
    branch: r.branch,
    channel: r.channel,
    milestone: r.milestone,
    healthy: r.healthy,
    closeMonth: r.close_month,
    amount: Number(r.amount) || 0,
    /* La columna admite NULL real -- mismo `?? ''` que /api/pipeline/latest. */
    loanOfficer: r.loan_officer ?? '',
    rawMilestone: r.raw_milestone,
    rawHealthiness: r.raw_healthiness,
    estClosingDate: r.est_closing_date,
    borrowerName: r.borrower_name,
    milestoneDate: r.milestone_date,
    branchTransferred: false,
    loanType: r.loan_type ?? '',
    loanProgram: r.loan_program ?? '',
    noteHistory: '',
    strategyRaw: r.strategy_raw ?? '',
    opportunityOwnerTitle: r.opportunity_owner_title ?? '',
    nppmRealtor: '',
    referredBy: '',
    affinityProgram: '',
    opportunityOwner: '',
    propertyState: '',
  };
}

function toResolved(r: ResolvedRow): ResolvedLoan {
  return {
    sourceLoanId: r.source_loan_id,
    branch: r.branch,
    channel: r.channel,
    status: r.status,
    disbursementDate: r.disbursement_date,
    amount: Number(r.amount) || 0,
    loanOfficer: r.loan_officer ?? '',
    borrowerName: r.borrower_name,
    milestoneDate: null,
    branchTransferred: null,
    loanStatus: r.loan_status,
    estClosingDate: r.est_closing_date,
    /*
     * ⚠ Siempre vacío, y no es un olvido: `pipeline_resolved_loans` NO tiene
     * columna de milestone (verificado contra el esquema, y ya documentado en
     * /api/pipeline/latest). Por eso el último milestone de un préstamo cerrado
     * se reconstruye con `lastMilestone`, mirando la última vez que se lo vio
     * abierto -- que es literalmente su last finished milestone.
     */
    rawMilestone: '',
    rawLoanFolder: '',
    noteHistory: '',
    loanType: r.loan_type ?? '',
    loanProgram: r.loan_program ?? '',
    strategyRaw: r.strategy_raw ?? '',
    opportunityOwnerTitle: r.opportunity_owner_title ?? '',
    nppmRealtor: '',
    referredBy: '',
    affinityProgram: '',
    opportunityOwner: '',
    propertyState: '',
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const month: string = typeof body?.month === 'string' ? body.month : '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
    }
    const cutoffDate: string =
      typeof body?.cutoffDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.cutoffDate)
        ? body.cutoffDate
        : firstThursdayOf(month);

    const monthRange = targetMonthRange({ year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) });
    const pf = await getServerClient('pipeline_forecast');

    const page = async <T,>(table: string, cols: string, apply: (q: never) => unknown): Promise<T[]> => {
      const all: T[] = [];
      let from = 0;
      for (;;) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = pf.from(table).select(cols);
        q = apply(q as never);
        const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as T[]));
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return all;
    };

    /* ── 1. Los tres snapshots ──────────────────────────────────────────── */
    const { data: snaps, error: snapErr } = await pf
      .from('pipeline_snapshots')
      .select('id, snapshot_date, is_active')
      .order('snapshot_date', { ascending: true });
    if (snapErr) throw snapErr;
    const all = (snaps ?? []) as { id: number; snapshot_date: string; is_active: boolean }[];

    const active = all.find((s) => s.is_active);
    if (!active) return NextResponse.json({ error: 'There is no active snapshot.' }, { status: 409 });

    /*
     * El corte es el snapshot DE esa fecha; si ese día no hubo carga, el último
     * anterior. Nunca uno posterior: el reporte dice "cómo estaba al corte", y
     * un snapshot de después ya incorporó movimientos que al corte no existían.
     */
    const anchorCandidates = all.filter((s) => s.snapshot_date <= cutoffDate);
    const anchor = anchorCandidates[anchorCandidates.length - 1];
    if (!anchor) {
      return NextResponse.json({ error: `There is no snapshot on or before ${cutoffDate}.` }, { status: 409 });
    }

    /* Los snapshots del mes posteriores al corte: de ahí salen los que aparecieron. */
    const duringMonth = all.filter((s) => s.snapshot_date > anchor.snapshot_date && s.snapshot_date <= monthRange.endDate);

    /* ── 2. El corte ────────────────────────────────────────────────────── */
    const anchorOpen = (
      await page<OpenRow>('pipeline_loans', OPEN_COLS, (q) => (q as never as { eq: (a: string, b: number) => unknown }).eq('snapshot_id', anchor.id))
    ).map(toOpen);
    const anchorResolved = (
      await page<ResolvedRow>('pipeline_resolved_loans', RESOLVED_COLS, (q) =>
        (q as never as { eq: (a: string, b: number) => unknown }).eq('snapshot_id', anchor.id)
      )
    ).map(toResolved);

    /*
     * ── 3. Quiénes aparecieron durante el mes, y su último milestone ──────
     *
     * Una sola lectura sirve para las dos cosas. Se leen los ABIERTOS de cada
     * snapshot del mes posterior al corte:
     *
     *   · el conjunto de ids es "los que aparecieron hasta fin de mes";
     *   · el `raw_milestone` del snapshot MÁS ALTO en que cada préstamo se vio
     *     abierto es su último milestone terminado, que es lo que hace falta
     *     para los que ya cerraron -- `pipeline_resolved_loans` no guarda
     *     milestone.
     *
     * ⚠ NO se usan los ids de `pipeline_resolved_loans` para armar el universo.
     * Esa tabla es ACUMULATIVA: el snapshot del 31 de agosto trae los 911
     * préstamos resueltos de toda la historia, no los resueltos en agosto.
     * Medido: unirla al universo lo llevaba de 172 a 911.
     */
    const existedByMonthEnd = new Set<string>();
    /* El del ÚLTIMO snapshot del mes: decide quién seguía abierto al cierre. */
    let openAtMonthEnd = new Set<string>(anchorOpen.map((l) => l.sourceLoanId));
    const lastMilestone = new Map<string, { milestone: string; date: string | null; at: number }>();
    for (const l of anchorOpen) lastMilestone.set(l.sourceLoanId, { milestone: l.rawMilestone, date: l.milestoneDate, at: anchor.id });
    for (const s of duringMonth) {
      const rows = await page<{ source_loan_id: string; raw_milestone: string; milestone_date: string | null }>(
        'pipeline_loans',
        'source_loan_id, raw_milestone, milestone_date',
        (q) => (q as never as { eq: (a: string, b: number) => unknown }).eq('snapshot_id', s.id)
      );
      const aqui = new Set<string>();
      for (const r of rows) {
        existedByMonthEnd.add(r.source_loan_id);
        aqui.add(r.source_loan_id);
        const prev = lastMilestone.get(r.source_loan_id);
        if (!prev || prev.at < s.id) {
          lastMilestone.set(r.source_loan_id, { milestone: r.raw_milestone, date: r.milestone_date, at: s.id });
        }
      }
      /* `duringMonth` viene ordenado por fecha, así que el último gana. */
      openAtMonthEnd = aqui;
    }

    /* ── 4. El estado de hoy ────────────────────────────────────────────── */
    const activeOpen = (
      await page<OpenRow>('pipeline_loans', OPEN_COLS, (q) => (q as never as { eq: (a: string, b: number) => unknown }).eq('snapshot_id', active.id))
    ).map(toOpen);
    const activeResolved = (
      await page<ResolvedRow>('pipeline_resolved_loans', RESOLVED_COLS, (q) =>
        (q as never as { eq: (a: string, b: number) => unknown }).eq('snapshot_id', active.id)
      )
    ).map(toResolved);

    /*
     * ── 5. Lo que el pipeline no tiene ────────────────────────────────────
     *
     * Fecha de solicitud y posición de gravamen salen de
     * `activity_report.loan_records_v2`, que es la única fuente que las trae.
     * Medido sobre el universo: 911 de 912 préstamos tienen fila ahí, 909
     * tienen `app_date` y 911 tienen `lien_position`.
     *
     * `lien_position` es confiable: 4.792 en posición 1 y 45 en posición 2, y
     * los 45 coinciden exactamente con `is_second_lien_heloc`.
     */
    /* Las MISMAS tres partes del universo -- si acá faltara una, esas filas
       saldrían sin fecha de solicitud ni lien y parecería un dato perdido. */
    const universeIds = new Set<string>([...anchorOpen.map((l) => l.sourceLoanId), ...existedByMonthEnd]);
    for (const r of activeResolved) {
      if (isClosedInMonth(r, monthRange)) universeIds.add(r.sourceLoanId);
    }
    const ar = await getServerClient('activity_report');
    const fromActivity = new Map<string, { applicationDate: string | null; lien: number | null }>();
    const ids = [...universeIds];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await ar
        .from('loan_records_v2')
        .select('loan_number, app_date, lien_position')
        .in('loan_number', ids.slice(i, i + 200));
      if (error) throw error;
      for (const r of (data ?? []) as { loan_number: string; app_date: string | null; lien_position: number | null }[]) {
        fromActivity.set(r.loan_number, { applicationDate: r.app_date, lien: r.lien_position });
      }
    }

    /* ── 6. El modelo ───────────────────────────────────────────────────── */
    const model = buildMonthlyReport({
      month,
      monthRange,
      cutoffDate,
      anchorOpen,
      anchorResolved,
      existedByMonthEnd,
      openAtMonthEnd,
      activeOpen,
      activeResolved,
      lastMilestone: new Map([...lastMilestone].map(([k, v]) => [k, { milestone: v.milestone, date: v.date }])),
      fromActivity,
    });

    const wb = buildWorkbook(model, {
      month,
      cutoffDate,
      anchorId: anchor.id,
      anchorDate: anchor.snapshot_date,
      activeId: active.id,
      activeDate: active.snapshot_date,
    });
    const buffer = await wb.xlsx.writeBuffer();

    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Pipeline_Monthly_Report_${month}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// ============================================================================
// EL LIBRO
// ============================================================================

interface Meta {
  month: string;
  cutoffDate: string;
  anchorId: number;
  anchorDate: string;
  activeId: number;
  activeDate: string;
}

/*
 * Las letras de columna de la hoja `Pipeline`. Las fórmulas del resumen apuntan
 * acá, así que el orden del `DETAIL_COLUMNS` de abajo y estas constantes tienen
 * que moverse juntos -- de ahí que estén declaradas al lado y no sueltas en las
 * fórmulas.
 */
const COL = {
  orgId: 'A',
  channel: 'B',
  loanOfficer: 'E',
  startOfMonth: 'O',
  endOfMonth: 'P',
  lien: 'T',
} as const;

function buildWorkbook(model: ReturnType<typeof buildMonthlyReport>, meta: Meta): Workbook {
  const wb = new Workbook();
  const nRows = model.rows.length;
  /* El rango exacto, no la columna entera: COUNTIFS sobre A:A en un libro con
     fórmulas en tres hojas es notablemente más lento al abrir. */
  const rng = (c: string) => `Pipeline!$${c}$2:$${c}$${nRows + 1}`;

  buildSummary(wb, model, meta, rng);
  buildByBranch(wb, model);
  buildDetail(wb, model, meta);
  return wb;
}

function buildSummary(
  wb: Workbook,
  model: ReturnType<typeof buildMonthlyReport>,
  meta: Meta,
  rng: (c: string) => string
): void {
  const sh = wb.addWorksheet('Summary');

  sh.addRow([`Pipeline monthly report — ${meta.month}`]).font = { bold: true, size: 14 };
  sh.addRow([`Cut-off ${meta.cutoffDate} · snapshot ${meta.anchorId} of ${meta.anchorDate}`]);
  sh.addRow([`Status, closing date and milestone read from the active snapshot ${meta.activeId} of ${meta.activeDate}`]);
  /*
   * La nota más importante del archivo. Es la que explica por qué este reporte
   * no coincide con uno armado sobre el snapshot de fin de mes, y sin ella la
   * diferencia se reporta como un error.
   */
  const why = sh.addRow([
    'A loan counts in the month its disbursement date falls in, whichever snapshot recorded it. Four August 2026 loans ' +
      'disbursed on the 28th and 31st were only marked Closed Won after the 31st export was taken: reading the month-end ' +
      'snapshot gives 32 Banked, reading the active one gives 36, which is what the Forecast screen shows.',
  ]);
  why.getCell(1).alignment = { wrapText: true };
  why.getCell(1).font = { italic: true };
  sh.addRow([]);

  /*
   * ⚠ QUÉ ES FÓRMULA Y QUÉ ES VALOR, dicho en la hoja y no sólo acá.
   *
   * Todo lo que se puede contar sobre el detalle es COUNTIFS, para que se pueda
   * auditar filtrando. Tres columnas no se pueden: `Closed` y `Potential` al
   * corte describen el snapshot del corte, que no está en la hoja de detalle
   * --el detalle lleva el estado ACTUAL de cada préstamo, no el del corte-- y
   * `Forecast` es una cascada de pull-through, no un conteo de filas.
   */
  const nota = sh.addRow([
    'Loan counts are COUNTIFS over the Pipeline sheet, so they can be audited by filtering it. ' +
      'The three shaded columns cannot be: Closed and Potential describe the cut-off snapshot, which the detail sheet ' +
      'does not carry (it carries the current state of each loan), and Forecast is a pull-through cascade, not a row count.',
  ]);
  nota.getCell(1).alignment = { wrapText: true };
  nota.getCell(1).font = { italic: true };
  sh.addRow([]);

  const head1 = sh.addRow([
    '',
    '',
    '',
    `As of ${meta.cutoffDate}`,
    '',
    '',
    '',
    'End of month',
    '',
    '',
    '',
    '% vs Forecast',
    '',
  ]);
  head1.font = { bold: true };
  const head2 = sh.addRow([
    'Branch',
    'Loan Officer',
    'Channel',
    'Pipeline',
    'Closed',
    'Potential',
    'Forecast',
    'Closed 1st lien',
    'Closed 2nd lien',
    'Adversed',
    'Still Open',
    'Loan Count',
    '%',
  ]);
  head2.font = { bold: true };

  const SHADED = 'FFF2E8DA';
  for (const r of model.summary) {
    const q = (col: string, v: string) => `COUNTIFS(${rng(COL.orgId)},$A${'{R}'},${rng(COL.loanOfficer)},$B${'{R}'},${rng(COL.channel)},$C${'{R}'},${rng(col)},"${v}")`;
    const row = sh.addRow([
      r.branch,
      r.loanOfficer,
      r.channel,
      null,
      r.closedAtCutoff,
      r.potentialAtCutoff,
      r.forecastAtCutoff,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    const n = row.number;
    const at = (t: string) => t.replace(/\{R\}/g, String(n));
    row.getCell(4).value = { formula: at(q(COL.startOfMonth, 'Pipeline')) };
    row.getCell(8).value = {
      formula: at(
        `COUNTIFS(${rng(COL.orgId)},$A{R},${rng(COL.loanOfficer)},$B{R},${rng(COL.channel)},$C{R},${rng(COL.endOfMonth)},"Closed",${rng(COL.lien)},1)`
      ),
    };
    row.getCell(9).value = {
      formula: at(
        `COUNTIFS(${rng(COL.orgId)},$A{R},${rng(COL.loanOfficer)},$B{R},${rng(COL.channel)},$C{R},${rng(COL.endOfMonth)},"Closed",${rng(COL.lien)},2)`
      ),
    };
    row.getCell(10).value = { formula: at(q(COL.endOfMonth, 'Adversed')) };
    row.getCell(11).value = { formula: at(q(COL.endOfMonth, 'Still Open')) };
    row.getCell(12).value = { formula: `H${n}+I${n}` };
    /* Sin forecast no hay porcentaje que calcular, y 0/0 en Excel es #DIV/0!. */
    row.getCell(13).value = { formula: `IF(G${n}=0,"",L${n}/G${n})` };
    row.getCell(13).numFmt = '0%';
    for (const c of [5, 6, 7]) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SHADED } };
    }
  }

  const first = 9;
  const last = first + model.summary.length - 1;
  if (model.summary.length > 0) {
    const t = sh.addRow(['Total', '', '', null, null, null, null, null, null, null, null, null, null]);
    t.font = { bold: true };
    for (let c = 4; c <= 12; c++) {
      const L = String.fromCharCode(64 + c);
      t.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})` };
    }
    t.getCell(13).value = { formula: `IF(G${t.number}=0,"",L${t.number}/G${t.number})` };
    t.getCell(13).numFmt = '0%';
  }

  sh.columns.forEach((c, i) => (c.width = i === 0 ? 12 : i === 1 ? 26 : i === 2 ? 16 : 15));
  sh.getColumn(1).width = 12;
}

function buildByBranch(wb: Workbook, model: ReturnType<typeof buildMonthlyReport>): void {
  const sh = wb.addWorksheet('By Branch');
  sh.addRow(['One block per branch. Every loan carries its own Loan Officer, so the sheet survives sorting and filtering.']).font =
    { italic: true };
  sh.addRow([]);

  const byBranch = new Map<string, MonthlyReportRow[]>();
  for (const r of model.rows) {
    const list = byBranch.get(r.branch) ?? [];
    list.push(r);
    byBranch.set(r.branch, list);
  }

  for (const branch of [...byBranch.keys()].sort((a, b) => a.localeCompare(b))) {
    const list = byBranch.get(branch)!;
    const title = sh.addRow([`Branch ${branch}`]);
    title.font = { bold: true, size: 12 };
    const head = sh.addRow([
      'Loan Officer',
      'Loan Number',
      'Borrower Name',
      'Channel',
      'Loan Amount',
      'Start of month',
      'End of month',
      'Funding date',
      'Last Finished Milestone',
      'Strategy',
      'Lien',
    ]);
    head.font = { bold: true };
    for (const r of list) {
      /*
       * ⚠ EL LOAN OFFICER VA EN CADA FILA, no sólo en la primera del grupo.
       * Escribirlo una vez y dejar el resto en blanco se ve más limpio y deja
       * las filas sin dueño en cuanto alguien ordena o filtra la hoja -- que es
       * lo primero que se hace con un bloque de 30 préstamos.
       */
      sh.addRow([
        r.loanOfficer,
        r.loanNumber,
        r.borrowerName,
        r.channel,
        r.loanAmount,
        r.startOfMonth,
        r.endOfMonth,
        r.fundingDate,
        r.lastFinishedMilestone,
        r.strategy,
        r.lien,
      ]);
    }
    const sub = sh.addRow([
      `${branch} — ${list.length} loans`,
      '',
      '',
      '',
      null,
      '',
      `${list.filter((r) => r.endOfMonth === 'Closed').length} closed · ` +
        `${list.filter((r) => r.endOfMonth === 'Adversed').length} adversed · ` +
        `${list.filter((r) => r.endOfMonth === 'Still Open').length} still open`,
    ]);
    sub.font = { bold: true };
    sh.addRow([]);
  }

  sh.columns.forEach((c, i) => (c.width = i === 0 ? 26 : i === 2 ? 28 : 18));
}

const DETAIL_COLUMNS: { header: string; key: keyof MonthlyReportRow | 'blank'; width: number }[] = [
  { header: 'OrgID', key: 'orgId', width: 10 },
  { header: 'Loan Info Channel', key: 'channel', width: 18 },
  { header: 'Loan Number', key: 'loanNumber', width: 16 },
  { header: 'Borrower Name', key: 'borrowerName', width: 26 },
  { header: 'Loan Officer', key: 'loanOfficer', width: 24 },
  { header: 'Loan Amount', key: 'loanAmount', width: 14 },
  { header: 'Application Date', key: 'applicationDate', width: 16 },
  { header: 'Last Finished Milestone Date', key: 'lastFinishedMilestoneDate', width: 26 },
  { header: 'Funding date', key: 'fundingDate', width: 14 },
  { header: 'Last Finished Milestone', key: 'lastFinishedMilestone', width: 22 },
  { header: 'Loan Program', key: 'loanProgram', width: 20 },
  { header: 'Loan Processor', key: 'blank', width: 18 },
  { header: 'Role Name - LO Assistant', key: 'blank', width: 22 },
  { header: 'Role Name - LO Assistant 2', key: 'blank', width: 22 },
  { header: 'Start of month', key: 'startOfMonth', width: 14 },
  { header: 'End of month', key: 'endOfMonth', width: 14 },
  { header: 'Strategy', key: 'strategy', width: 16 },
  { header: 'Loan Type', key: 'loanType', width: 14 },
  { header: 'Est closing moved', key: 'estClosingMoved', width: 16 },
  { header: 'Lien', key: 'lien', width: 8 },
  { header: 'Est closing - start', key: 'estClosingStart', width: 17 },
  { header: 'Est closing - end', key: 'estClosingEnd', width: 17 },
];

function buildDetail(wb: Workbook, model: ReturnType<typeof buildMonthlyReport>, meta: Meta): void {
  const sh = wb.addWorksheet('Pipeline');
  const head = sh.addRow(DETAIL_COLUMNS.map((c) => c.header));
  head.font = { bold: true };
  DETAIL_COLUMNS.forEach((c, i) => (sh.getColumn(i + 1).width = c.width));

  for (const r of model.rows) {
    sh.addRow(DETAIL_COLUMNS.map((c) => (c.key === 'blank' ? '' : (r[c.key] ?? ''))));
  }

  sh.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: DETAIL_COLUMNS.length } };
  sh.views = [{ state: 'frozen', ySplit: 1 }];

  /*
   * ⚠ LAS TRES COLUMNAS VACÍAS SE EXPLICAN EN LA HOJA, no se dejan en blanco a
   * secas. Verificado: `Loan Processor` y los dos `LO Assistant` no existen ni
   * en `pipeline_loans` ni en `loan_records_v2`. Una columna vacía sin nota se
   * lee como un dato que se perdió; con la nota se lee como lo que es.
   */
  sh.addRow([]);
  const n1 = sh.addRow([
    'Loan Processor and the two LO Assistant columns are empty because neither source has them: they exist in ' +
      'neither pipeline_loans nor loan_records_v2. The columns are kept so the layout matches the July file.',
  ]);
  n1.getCell(1).font = { italic: true };
  const n2 = sh.addRow([
    `Rows: loans open at the ${meta.cutoffDate} cut-off plus those that appeared through the end of the month. ` +
      `End of month, Funding date and Last Finished Milestone come from the active snapshot ${meta.activeId} ` +
      `(${meta.activeDate}), never from the month-end one.`,
  ]);
  n2.getCell(1).font = { italic: true };
  const n3 = sh.addRow([
    `Universe ${model.counts.universe} = ${model.counts.atCutoff} open at the cut-off + ${model.counts.appearedDuringMonth} that ` +
      `appeared during the month + ${model.counts.closedBeforeCutoff} that had already closed before the cut-off. ` +
      `Closed ${model.counts.closed} + Adversed ${model.counts.adversed} + Still Open ${model.counts.stillOpen} = ${model.counts.universe}.`,
  ]);
  n3.getCell(1).font = { italic: true };
  /*
   * El tercer grupo es el que nadie espera y por eso se nombra: son cierres del
   * mes que ocurrieron antes del corte, así que no están entre los abiertos de
   * ese día ni entre los que aparecieron después. Sin ellos el reporte no
   * cuadraría con la pantalla.
   */
  const n4 = sh.addRow([
    'Loans that closed before the cut-off have no "Start of month" mark: they were no longer in the pipeline that day. ' +
      'They are included because they closed inside the month, which is what makes the totals match the Forecast screen.',
  ]);
  n4.getCell(1).font = { italic: true };
}
