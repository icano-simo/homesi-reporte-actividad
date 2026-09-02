import { NextResponse } from 'next/server';
import { Workbook } from 'exceljs';
import { getServerClient } from '@/lib/supabase/server';
import { isClosedInMonth, targetMonthRange } from '@/lib/pipeline/aggregate';
import {
  buildMonthlyReport,
  firstThursdayOf,
  type MonthlyReportRow,
  type MonthlyReportSummaryRow,
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
      monthEnd: monthRange.endDate,
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

/**
 * ============================================================================
 * ⚠ EL FORECAST DEL CORTE, FIJADO POR EL NEGOCIO — etapa RPT4
 * ============================================================================
 *
 * NO se calcula. Son los números del corte tal como los dio el negocio, y van
 * como valores. Es la única columna del libro que no es una fórmula.
 *
 * ⚠ EL TOTAL NO ES LA SUMA, Y ESTÁ BIEN ASÍ. Los branches suman 38 y la fila de
 * división dice 37. No se fuerza a cuadrar: cada número es el que el negocio
 * fijó, y el de la división no es la suma de los de arriba. Un `SUM()` acá
 * "arreglaría" el total y perdería el número que se pidió.
 *
 * ⚠ Y SON POR BRANCH, NO POR CANAL. La tabla da un solo número por branch; el
 * resumen tiene una columna de Forecast por canal. Se coloca bajo BANKED, que es
 * donde está el volumen, y la de BROKERED queda vacía -- repartir el número
 * entre los dos canales sería calcularlo, que es justo lo que no hay que hacer.
 * El `%` de Brokered queda vacío por lo mismo.
 *
 * ⚠ Y NO COINCIDEN CON LA CASCADA. La cascada sobre el snapshot 19 daba
 * Affinity 6 y acá dice 7; el 733 daba 5 y acá 3; el 724 daba 1 y acá 0. Manda
 * la tabla.
 *
 * `711` no está en la tabla y sí en los datos, así que queda en 0. `777` está en
 * la tabla con 0 y no tiene préstamos en agosto, así que no genera fila.
 */
const FORECAST_AT_CUTOFF: Record<string, number> = {
  Affinity: 7,
  '703': 5,
  '707': 3,
  '710': 3,
  '711': 0,
  '716': 6,
  '724': 0,
  '728': 0,
  '733': 3,
  '747': 5,
  '760': 3,
  '770': 1,
  '776': 2,
  '777': 0,
};
const FORECAST_DIVISION = 37;

interface Meta {
  month: string;
  cutoffDate: string;
  anchorId: number;
  anchorDate: string;
  activeId: number;
  activeDate: string;
  /** Ultimo dia del mes -- la otra fecha del titulo. */
  monthEnd: string;
}

function buildWorkbook(model: ReturnType<typeof buildMonthlyReport>, meta: Meta): Workbook {
  const wb = new Workbook();
  const nRows = model.rows.length;
  /* El rango exacto, no la columna entera: COUNTIFS sobre A:A en un libro con
     fórmulas en tres hojas es notablemente más lento al abrir. */
  const rng = (c: string) => `Pipeline!$${c}$2:$${c}$${nRows + 1}`;

  buildSummary(wb, model, meta, rng);
  buildByBranch(wb, model);
  buildDetail(wb, model);
  return wb;
}

/*
 * ============================================================================
 * LA GEOMETRÍA DE LA HOJA DE RESUMEN
 * ============================================================================
 *
 *   A  Branch
 *   B  Loan Officer
 *   C  aire
 *   D..O   BANKED - RETAIL    (10 columnas de dato + 2 separadoras internas)
 *   P  separadora de CANAL
 *   Q..AB  BROKERED           (idem)
 *
 * ⚠ LAS SEPARADORAS SON COLUMNAS DE VERDAD, angostas y vacías, no un borde. Es
 * lo que hace el archivo original --D, H, J, O, R, de ancho 1,7 a 3,7-- y con
 * veintidós columnas de números seguidas el aire entre bloques es lo que
 * permite leer una fila sin perder de vista en qué grupo se está.
 *
 * `OFFSETS` traduce el índice de columna de dato (0..9) a su desplazamiento
 * real dentro del canal, salteando las separadoras. Todo el resto del código
 * habla en índices 0..9 y nunca en columnas absolutas.
 */
const OFFSETS = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11] as const;
const CHANNEL_SPAN = 12;
const BANKED_AT = 4;
const SEP_COL = BANKED_AT + CHANNEL_SPAN;
const BROKERED_AT = SEP_COL + 1;
const LAST_COL = BROKERED_AT + CHANNEL_SPAN - 1;

function buildSummary(
  wb: Workbook,
  model: ReturnType<typeof buildMonthlyReport>,
  meta: Meta,
  rng: (c: string) => string
): void {
  const sh = wb.addWorksheet('Summary');
  const at = (channelAt: number, i: number) => channelAt + OFFSETS[i];

  /*
   * ⚠ SIN TEXTOS EXPLICATIVOS — etapa RPT4. Acá había cuatro párrafos: el
   * retraso de carga del snapshot, qué población alimenta cada columna, qué es
   * fórmula y qué no, y el aviso de los transferidos. Se fueron todos, y la
   * decisión es del negocio: si algo necesita tres renglones para explicarse, no
   * va en el archivo.
   *
   * Lo que explicaban NO se perdió: sigue escrito en los comentarios de este
   * archivo y de `lib/pipeline/monthlyReport.ts`, que es donde lo va a buscar
   * quien tenga que cambiar el código. Lo que se fue es la copia en el Excel.
   *
   * Queda una sola línea: las dos fechas que definen el reporte.
   */
  const titulo = sh.addRow([`Pipeline monthly report — ${meta.month}`]);
  titulo.font = { name: FONT, bold: true, size: 16, color: { argb: C.navy } };
  const sub1 = sh.addRow([`Cut-off ${meta.cutoffDate} · month-end ${meta.monthEnd}`]);
  sub1.font = { name: FONT, size: 10, color: { argb: C.slate500 } };
  for (const r of [titulo, sub1]) sh.mergeCells(r.number, 1, r.number, LAST_COL);
  sh.addRow([]);

  const HEADERS = ['Pipeline', 'Closed', 'Potential', 'Forecast', 'Closed', 'Closed', 'Adversed', 'Still Open', 'Loan Count', '%'];
  /*
   * ⚠ CUATRO FILAS DE ENCABEZADO, CON JERARQUÍA DE COLOR — etapas RPT1c y RPT2.
   *
   *   canal    navy sólido, texto blanco   la separación más fuerte de la hoja
   *   grupo    sky suave                   dónde termina el corte y empieza el cierre
   *   columna  slate tenue                 el nombre, que no tiene que competir
   *   sub                                  First lien / Second Lien
   *
   * La del medio es la que faltaba y la que más importa: sin ella las diez
   * columnas de cada canal corren seguidas y no se ve dónde termina el corte y
   * dónde empieza el cierre, que es la comparación entera del reporte.
   */
  const GROUPS: { label: string; span: number }[] = [
    { label: `As of ${meta.cutoffDate}`, span: 4 },
    { label: 'End of Month', span: 4 },
    { label: '% vs Forecast', span: 2 },
  ];

  const rowCanal = sh.addRow([]);
  const rowGrupo = sh.addRow([]);
  const rowCol = sh.addRow([]);
  const rowSub = sh.addRow([]);

  for (const channelAt of [BANKED_AT, BROKERED_AT]) {
    const c = rowCanal.getCell(channelAt);
    c.value = channelAt === BANKED_AT ? 'BANKED - RETAIL' : 'BROKERED';
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.font = { name: FONT, bold: true, size: 11, color: { argb: C.white } };
    c.fill = fill(C.navy);
    sh.mergeCells(rowCanal.number, channelAt, rowCanal.number, channelAt + CHANNEL_SPAN - 1);

    let i = 0;
    for (const g of GROUPS) {
      const desde = at(channelAt, i);
      const hasta = at(channelAt, i + g.span - 1);
      const gc = rowGrupo.getCell(desde);
      gc.value = g.label;
      gc.alignment = { horizontal: 'center' };
      gc.font = { name: FONT, bold: true, size: 10, color: { argb: C.navy } };
      gc.fill = fill(C.skySoft);
      gc.border = { top: THIN, bottom: THIN, left: MEDIUM, right: MEDIUM };
      if (hasta > desde) sh.mergeCells(rowGrupo.number, desde, rowGrupo.number, hasta);
      i += g.span;
    }

    HEADERS.forEach((h, idx) => {
      const cc = rowCol.getCell(at(channelAt, idx));
      cc.value = h;
      cc.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true };
      cc.font = { name: FONT, bold: true, size: 9, color: { argb: C.navy } };
      cc.fill = fill(C.slate100);
    });
    /* Debajo de los dos `Closed` del cierre de mes, y sólo ahí. */
    for (const [idx, txt] of [
      [4, 'First lien'],
      [5, 'Second Lien'],
    ] as const) {
      const cc = rowSub.getCell(at(channelAt, idx));
      cc.value = txt;
      cc.alignment = { horizontal: 'center', wrapText: true };
      cc.font = { name: FONT, bold: true, size: 8, color: { argb: C.slate500 } };
    }
    for (let k = 0; k < 10; k++) {
      rowSub.getCell(at(channelAt, k)).fill = fill(C.slate100);
      rowSub.getCell(at(channelAt, k)).border = { bottom: MEDIUM };
    }
  }

  sh.getCell(rowCanal.number, 1).value = 'Branch';
  sh.getCell(rowCanal.number, 2).value = 'Loan Officer';
  sh.mergeCells(rowCanal.number, 1, rowSub.number, 1);
  sh.mergeCells(rowCanal.number, 2, rowSub.number, 2);
  for (const col of [1, 2]) {
    const cc = sh.getCell(rowCanal.number, col);
    cc.alignment = { vertical: 'bottom' };
    cc.font = { name: FONT, bold: true, size: 10, color: { argb: C.white } };
    cc.fill = fill(C.navy);
  }

  const HEAD_ROW = rowSub.number;

  /* Qué criterios lleva el COUNTIFS de cada fila, según su nivel. */
  const crit = (r: MonthlyReportSummaryRow, n: number): string => {
    if (r.kind === 'division') return '';
    if (r.kind === 'branch') return `${rng(COL.orgId)},$A${n},`;
    return `${rng(COL.orgId)},$A${n},${rng(COL.loanOfficer)},$B${n},`;
  };

  /*
   * ⚠ TRES NIVELES DE FILA, TRES TRATAMIENTOS — etapa RPT2.
   *
   *   DIVISION   coral suave, negrita, borde grueso arriba y abajo
   *   branch     navy suave, negrita
   *   persona    limpio, con cebra tenue para seguir la línea a lo ancho
   *
   * Antes los tres compartían relleno y la jerarquía no se veía: había que leer
   * la columna B para saber en qué nivel se estaba.
   */
  let zebra = false;
  /* En que filas quedaron los branches -- lo lee la verificacion cruzada. */
  const filasDeBranch: number[] = [];
  for (const r of model.summary) {
    const row = sh.addRow([]);
    const n = row.number;
    if (r.kind === 'officer') zebra = !zebra;
    else zebra = false;
    if (r.kind === 'branch') filasDeBranch.push(n);

    const bg = r.kind === 'division' ? C.coralSoft : r.kind === 'branch' ? C.navySoft : zebra ? C.zebra : C.white;
    const bold = r.kind !== 'officer';

    row.getCell(1).value = r.kind === 'division' ? 'DIVISION' : r.branch;
    row.getCell(2).value = r.kind === 'officer' ? r.loanOfficer : r.kind === 'branch' ? 'All loan officers' : '';

    for (let col = 1; col <= LAST_COL; col++) {
      const cc = row.getCell(col);
      cc.fill = fill(bg);
      cc.font = { name: FONT, size: 10, bold, color: { argb: C.navy } };
      if (r.kind === 'division') cc.border = { top: MEDIUM, bottom: MEDIUM };
      else if (r.kind === 'branch') cc.border = { top: THIN, bottom: THIN };
      else cc.border = { bottom: THIN };
    }
    /* Las separadoras no llevan borde: son aire, no una celda vacía de la tabla. */
    for (const col of [3, SEP_COL, BANKED_AT + 4, BANKED_AT + 9, BROKERED_AT + 4, BROKERED_AT + 9]) {
      row.getCell(col).border = {};
    }

    for (const [channelAt, ch, cells] of [
      [BANKED_AT, 'Banked - Retail', r.banked],
      [BROKERED_AT, 'Brokered', r.brokered],
    ] as const) {
      const base = `COUNTIFS(${crit(r, n)}${rng(COL.channel)},"${ch}"`;
      const put = (i: number, formula: string, result: number) => {
        row.getCell(at(channelAt, i)).value = { formula, result };
      };
      const L = (i: number) => sh.getColumn(at(channelAt, i)).letter;

      /*
       * ⚠ TODO NÚMERO DE ESTA HOJA SE PUEDE RECONSTRUIR FILTRANDO EL DETALLE
       * — etapa RPT3. Antes `Closed`, `Potential` y `Forecast` iban escritos a
       * mano porque el detalle no llevaba con qué derivarlos; ahora lleva dos
       * columnas más --`Status at cut-off` y `PT weight`-- y no queda ninguno.
       */
      put(0, `${base},${rng(COL.statusAtCutoff)},"Pipeline")`, cells.pipelineAtCutoff);
      put(1, `${base},${rng(COL.statusAtCutoff)},"Closed")`, cells.closedAtCutoff);
      /* Potential = Pipeline + Closed: todo lo que había disponible para cerrar. */
      put(2, `${L(0)}${n}+${L(1)}${n}`, cells.potentialAtCutoff);

      /*
       * ⚠ EL FORECAST SÓLO EXISTE A NIVEL BRANCH, Y VA COMO VALOR FIJO.
       *
       *   persona    vacío. El forecast es del branch; una cifra por Loan
       *              Officer sería inventada. Y sin forecast tampoco hay
       *              `% vs Forecast` que calcular, así que esa celda también
       *              queda vacía.
       *   branch     el número de `FORECAST_AT_CUTOFF`, bajo BANKED. La celda
       *              de BROKERED queda vacía: la tabla da un número por branch,
       *              no por canal.
       *   división   `FORECAST_DIVISION`, que NO es la suma de los de arriba.
       *
       * Acá había un `ROUND(SUMIFS(PT weight))` que reproducía la cascada de la
       * app. Se reemplaza por los valores del negocio -- ver la nota de
       * `FORECAST_AT_CUTOFF` para las diferencias, que son varias y son a
       * propósito. `PT weight` se deja en el detalle: sigue explicando de dónde
       * saldría la cascada si alguien quiere compararla.
       */
      if (r.kind !== 'officer' && channelAt === BANKED_AT) {
        row.getCell(at(channelAt, 3)).value =
          r.kind === 'division' ? FORECAST_DIVISION : (FORECAST_AT_CUTOFF[r.branch] ?? 0);
      }

      put(4, `${base},${rng(COL.endOfMonth)},"Closed",${rng(COL.lien)},1)`, cells.closedFirstLien);
      put(5, `${base},${rng(COL.endOfMonth)},"Closed",${rng(COL.lien)},2)`, cells.closedSecondLien);
      put(6, `${base},${rng(COL.endOfMonth)},"Adversed")`, cells.adversed);
      put(7, `${base},${rng(COL.endOfMonth)},"Still Open")`, cells.stillOpen);

      const cnt = cells.closedFirstLien + cells.closedSecondLien;
      put(8, `${L(4)}${n}+${L(5)}${n}`, cnt);

      /*
       * El porcentaje existe sólo donde existe el forecast. En una fila de
       * persona la celda queda vacía --no 0%--: no se puede comparar contra un
       * número que a ese nivel no existe.
       */
      if (r.kind !== 'officer' && channelAt === BANKED_AT) {
        const fc = r.kind === 'division' ? FORECAST_DIVISION : (FORECAST_AT_CUTOFF[r.branch] ?? 0);
        const pct = row.getCell(at(channelAt, 9));
        pct.value = {
          formula: `IF(${L(3)}${n}=0,"",${L(8)}${n}/${L(3)}${n})`,
          result: fc === 0 ? '' : cnt / fc,
        };
        pct.numFmt = '0%';
      }

      /* Números a la derecha: la app usa tabular-nums y acá el equivalente es esto. */
      for (let k = 0; k < 10; k++) {
        row.getCell(at(channelAt, k)).alignment = { horizontal: 'right' };
      }
      /* El borde grueso que delimita cada grupo, fila por fila. */
      for (const i of [0, 4, 8]) row.getCell(at(channelAt, i)).border = { ...row.getCell(at(channelAt, i)).border, left: MEDIUM };
      row.getCell(at(channelAt, 9)).border = { ...row.getCell(at(channelAt, 9)).border, right: MEDIUM };
    }
    row.getCell(1).alignment = { horizontal: 'left' };
    row.getCell(2).alignment = { horizontal: 'left', indent: r.kind === 'officer' ? 1 : 0 };
  }

  /*
   * Acá se llenaba la fila de división sumando las celdas de branch. Ya no hace
   * falta: el forecast de división es un valor fijo del negocio y NO es la suma
   * de los de arriba -- ver `FORECAST_DIVISION`.
   */
  /* Encabezados congelados: después de la fila de sub-encabezado y de Loan Officer. */
  sh.views = [{ state: 'frozen', xSplit: 2, ySplit: HEAD_ROW }];
  sh.getColumn(1).width = 11;
  sh.getColumn(2).width = 30;
  sh.getColumn(3).width = 2;
  sh.getColumn(SEP_COL).width = 3;
  for (const channelAt of [BANKED_AT, BROKERED_AT]) {
    for (let k = 0; k < 10; k++) sh.getColumn(at(channelAt, k)).width = k === 9 ? 8 : 11;
    sh.getColumn(channelAt + 4).width = 2;
    sh.getColumn(channelAt + 9).width = 2;
  }
  sh.getRow(rowCanal.number).height = 20;
  sh.getRow(rowCol.number).height = 24;
}

const BY_BRANCH_COLUMNS = [
  { header: 'Loan Officer', width: 26 },
  { header: 'Loan Number', width: 16 },
  { header: 'Borrower Name', width: 32 },
  { header: 'Channel', width: 16 },
  { header: 'Loan Amount', width: 14 },
  { header: 'Start of month', width: 14 },
  { header: 'End of month', width: 14 },
  { header: 'Funding date', width: 13 },
  { header: 'Last Finished Milestone', width: 22 },
  { header: 'Strategy', width: 16 },
  { header: 'Lien', width: 7 },
];

function buildByBranch(wb: Workbook, model: ReturnType<typeof buildMonthlyReport>): void {
  const sh = wb.addWorksheet('By Branch');
  const N = BY_BRANCH_COLUMNS.length;

  /*
   * Aca habia una linea de intro explicando que cada prestamo lleva su Loan
   * Officer. Se fue con el resto de los textos -- etapa RPT4. La propiedad
   * sigue valiendo y sigue verificada; lo que se fue es el parrafo.
   */
  const byBranch = new Map<string, MonthlyReportRow[]>();
  for (const r of model.rows) {
    const list = byBranch.get(r.branch) ?? [];
    list.push(r);
    byBranch.set(r.branch, list);
  }

  for (const branch of [...byBranch.keys()].sort((a, b) => a.localeCompare(b))) {
    const list = byBranch.get(branch)!;

    /* El título del bloque, en navy a todo el ancho: es lo que separa un branch del anterior. */
    const title = sh.addRow([`BRANCH ${branch}`]);
    sh.mergeCells(title.number, 1, title.number, N);
    const tc = title.getCell(1);
    tc.font = { name: FONT, bold: true, size: 12, color: { argb: C.white } };
    tc.fill = fill(C.navy);
    tc.alignment = { vertical: 'middle', indent: 1 };
    sh.getRow(title.number).height = 20;

    const head = sh.addRow(BY_BRANCH_COLUMNS.map((c) => c.header));
    for (let i = 1; i <= N; i++) {
      const cc = head.getCell(i);
      cc.font = { name: FONT, bold: true, size: 9, color: { argb: C.navy } };
      cc.fill = fill(C.slate100);
      cc.border = { bottom: MEDIUM };
      cc.alignment = { horizontal: i === 5 || i === 11 ? 'right' : 'left', wrapText: true };
    }

    let zebra = false;
    for (const r of list) {
      zebra = !zebra;
      const row = sh.addRow([
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
      for (let i = 1; i <= N; i++) {
        const cc = row.getCell(i);
        cc.font = { name: FONT, size: 10, color: { argb: C.navy } };
        cc.fill = fill(zebra ? C.zebra : C.white);
        cc.border = { bottom: THIN };
        if (i === 5 || i === 11) cc.alignment = { horizontal: 'right' };
      }
      row.getCell(5).numFmt = '#,##0';
    }

    /* La franja de total del bloque -- misma lectura que la fila de branch del Summary. */
    const sub = sh.addRow([
      `${list.length} loans`,
      '',
      '',
      '',
      list.reduce((a, r) => a + (r.loanAmount ?? 0), 0),
      '',
      `${list.filter((r) => r.endOfMonth === 'Closed').length} closed · ` +
        `${list.filter((r) => r.endOfMonth === 'Adversed').length} adversed · ` +
        `${list.filter((r) => r.endOfMonth === 'Still Open').length} still open`,
    ]);
    sh.mergeCells(sub.number, 7, sub.number, N);
    for (let i = 1; i <= N; i++) {
      const cc = sub.getCell(i);
      cc.font = { name: FONT, bold: true, size: 10, color: { argb: C.navy } };
      cc.fill = fill(C.navySoft);
      cc.border = { top: MEDIUM, bottom: MEDIUM };
      if (i === 5) cc.alignment = { horizontal: 'right' };
    }
    sub.getCell(5).numFmt = '#,##0';
    sh.addRow([]);
  }

  BY_BRANCH_COLUMNS.forEach((c, i) => (sh.getColumn(i + 1).width = c.width));
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
  /*
   * ⚠ LAS DOS COLUMNAS QUE NO ESTÁN EN EL ARCHIVO DE JULIO, y están a propósito
   * — etapa RPT3. Van al final para no tocar el orden del original.
   *
   * Existen para que NINGÚN número del resumen quede escrito a mano. Sin
   * `Status at cut-off` no hay forma de contar los que ya estaban cerrados el
   * día del corte --la hoja lleva el estado ACTUAL de cada préstamo, no el de
   * ese día-- y sin `PT weight` el forecast no puede salir de un SUMIFS. Una
   * columna más es preferible a un número que nadie puede reconstruir
   * filtrando.
   */
  { header: 'Status at cut-off', key: 'statusAtCutoff', width: 15 },
  { header: 'PT weight', key: 'ptWeight', width: 11 },
];

/*
 * Las letras de columna de la hoja `Pipeline`. Las fórmulas del resumen apuntan
 * acá, así que el orden del `DETAIL_COLUMNS` de abajo y estas constantes tienen
 * que moverse juntos -- de ahí que estén declaradas al lado y no sueltas en las
 * fórmulas.
 */
/*
 * Las letras de columna de la hoja `Pipeline`, a las que apuntan todas las
 * fórmulas del resumen. Se derivan del orden de `DETAIL_COLUMNS` en vez de
 * escribirse a mano: agregar una columna al detalle y olvidarse de correr una
 * letra acá daría un COUNTIFS que cuenta la columna equivocada sin fallar.
 */
const colOf = (header: string): string => {
  const i = DETAIL_COLUMNS.findIndex((c) => c.header === header);
  if (i < 0) throw new Error(`The Pipeline sheet has no "${header}" column.`);
  /* 26 columnas alcanzan de sobra; si algún día no, hay que hacer AA. */
  return String.fromCharCode(65 + i);
};

/**
 * ============================================================================
 * LOS COLORES — etapa RPT2
 * ============================================================================
 *
 * ⚠ SALEN DE `app/styles/tokens.css`, no se inventan acá. Son los cuatro de
 * HomeSí más la escala neutra que ya usa toda la app, en ARGB porque es lo que
 * pide ExcelJS. Si alguno cambia en la marca, cambia ahí y acá.
 *
 * Los tres tonos derivados --`NAVY_SOFT`, `CORAL_SOFT`, `SKY_SOFT`-- son mezclas
 * del color de marca sobre blanco, porque un relleno de Excel es OPACO: no hay
 * opacidad, así que el tono claro hay que calcularlo. El porcentaje va anotado
 * en cada uno para que se pueda rehacer.
 */
const C = {
  navy: 'FF001A40',
  coral: 'FFFF4040',
  sky: 'FFA6DEFF',
  canvas: 'FFFCFCFA',
  white: 'FFFFFFFF',
  slate100: 'FFF1F5F9',
  slate200: 'FFE2E8F0',
  slate300: 'FFCBD5E1',
  slate500: 'FF64748B',
  /** coral al 28% sobre blanco: la fila de división. Al 12% no se leia. */
  coralSoft: 'FFFFCCCC',
  /** navy al 16% sobre blanco: las filas de branch. */
  navySoft: 'FFD8DCE4',
  /** sky al 45% sobre blanco: la banda de periodo. Al 25% se leia como blanco. */
  skySoft: 'FFD3EEFF',
  /**
   * La banda cebra de las filas de persona. Es  y no :
   * medido contra la captura, al 50 no se distinguia del blanco y la cebra no
   * cumplia su unica funcion, que es seguir una fila a lo ancho de 22 columnas.
   */
  zebra: 'FFF1F5F9',
} as const;

/** Arial: la app usa Inter, que Excel no tiene. Ver la nota del brief. */
const FONT = 'Arial';

type Fill = { type: 'pattern'; pattern: 'solid'; fgColor: { argb: string } };
const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const THIN = { style: 'thin' as const, color: { argb: C.slate300 } };
const MEDIUM = { style: 'medium' as const, color: { argb: C.navy } };

const COL = {
  orgId: colOf('OrgID'),
  channel: colOf('Loan Info Channel'),
  loanOfficer: colOf('Loan Officer'),
  startOfMonth: colOf('Start of month'),
  endOfMonth: colOf('End of month'),
  lien: colOf('Lien'),
  statusAtCutoff: colOf('Status at cut-off'),
  ptWeight: colOf('PT weight'),
} as const;

function buildDetail(wb: Workbook, model: ReturnType<typeof buildMonthlyReport>): void {
  const sh = wb.addWorksheet('Pipeline');
  const N = DETAIL_COLUMNS.length;
  /* Las tres que no tienen fuente: se marcan tenues para que se vean vacías a propósito. */
  const HUECAS = new Set(DETAIL_COLUMNS.map((c, i) => (c.key === 'blank' ? i + 1 : 0)).filter(Boolean));
  /* Y las que llevan número, alineadas a la derecha. */
  const NUM = new Set(
    DETAIL_COLUMNS.map((c, i) => (c.key === 'loanAmount' || c.key === 'lien' ? i + 1 : 0)).filter(Boolean)
  );

  const head = sh.addRow(DETAIL_COLUMNS.map((c) => c.header));
  for (let i = 1; i <= N; i++) {
    const cc = head.getCell(i);
    cc.font = { name: FONT, bold: true, size: 9, color: { argb: C.white } };
    cc.fill = fill(C.navy);
    cc.alignment = { horizontal: NUM.has(i) ? 'right' : 'left', vertical: 'middle', wrapText: true };
    cc.border = { bottom: MEDIUM };
  }
  sh.getRow(head.number).height = 28;
  DETAIL_COLUMNS.forEach((c, i) => (sh.getColumn(i + 1).width = c.width));

  let zebra = false;
  for (const r of model.rows) {
    zebra = !zebra;
    const row = sh.addRow(DETAIL_COLUMNS.map((c) => (c.key === 'blank' ? '' : (r[c.key] ?? ''))));
    for (let i = 1; i <= N; i++) {
      const cc = row.getCell(i);
      cc.font = { name: FONT, size: 10, color: { argb: HUECAS.has(i) ? C.slate300 : C.navy } };
      cc.fill = fill(zebra ? C.zebra : C.white);
      cc.border = { bottom: THIN };
      if (NUM.has(i)) cc.alignment = { horizontal: 'right' };
    }
    row.getCell(DETAIL_COLUMNS.findIndex((c) => c.key === 'loanAmount') + 1).numFmt = '#,##0';
  }

  sh.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: N } };
  /* Congelado el encabezado y las tres primeras columnas, que son las que identifican la fila. */
  sh.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

  /*
   * ⚠ ACA HABIA CUATRO NOTAS AL PIE y se fueron todas -- etapa RPT4: las tres
   * columnas sin fuente, el origen de cada campo, el desglose del universo y el
   * aviso de los transferidos.
   *
   * Lo que decian sigue escrito en los comentarios del codigo, que es donde lo
   * necesita quien lo cambie. Lo que se fue es la copia en la hoja.
   */
}
