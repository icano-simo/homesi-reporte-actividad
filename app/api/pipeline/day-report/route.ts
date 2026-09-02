import { NextResponse } from 'next/server';
import { Workbook, type Worksheet } from 'exceljs';
import {
  C,
  FONT,
  MEDIUM,
  THIN,
  channelGrid,
  fill,
  setChannelWidths,
  writeChannelHeader,
  type ChannelGridSpec,
} from '@/lib/pipeline/reportStyle';
import type { DayReportModel, DayReportRow, DayReportSummaryRow } from '@/lib/pipeline/dayReport';

export const runtime = 'nodejs';

/**
 * ============================================================================
 * EL FORECAST DE HOY — el libro (etapa RPT6)
 * ============================================================================
 *
 * ⚠ ESTA RUTA NO CALCULA NADA. Recibe el modelo ya armado por el cliente
 * --`lib/pipeline/dayReport.ts`, corriendo sobre los mismos objetos que
 * alimentan las tarjetas del Executive Summary-- y sólo dibuja. Es el patrón de
 * `/api/pipeline/export`, y acá aplica por el mismo motivo: si los números se
 * recalcularan del lado del servidor, "son exactamente los de la pantalla"
 * pasaría de una propiedad garantizada a una que hay que verificar.
 *
 * La diferencia con `/api/pipeline/monthly-report`, que SÍ consulta la base, es
 * que aquel necesita tres snapshots y el navegador sólo tiene el activo.
 *
 * El formato --paleta, bandas, geometría-- sale de `lib/pipeline/reportStyle.ts`,
 * compartido con el mensual para que las dos hojas se lean igual.
 */

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface Meta {
  /** El día de la descarga: el corte de este reporte. */
  today: string;
  pipelineRange: { startDate: string; endDate: string };
  forecastMonthLabel: string;
  branchFilter: string;
}

/*
 * ⚠ CINCO COLUMNAS POR CANAL, SIN LAS DE CIERRE. Fuera `End of Month` y
 * `% vs Forecast`: el mes no terminó y no hay contra qué comparar. Quedan las
 * cinco que muestra el Executive Summary.
 *
 * El orden agrupa en vez de seguir la lista del brief al pie de la letra: el
 * pipeline de hoy primero, después lo que se espera de él. `Total` va al final
 * porque es `Closed + Forecast` y un total antes de sus términos se lee mal.
 */
const GRID_SPEC: ChannelGridSpec = {
  groups: [
    { label: 'Pipeline', span: 2 },
    { label: 'Forecast', span: 3 },
  ],
  headers: ['Total Pipeline', 'Healthy Pipeline', 'Closed', 'Forecast', 'Total'],
  /* Dos de los rótulos son de dos palabras y se envuelven: 32 en vez de 24. */
  headerHeight: 32,
};

const DETAIL_COLUMNS: { header: string; key: keyof DayReportRow | 'blank'; width: number }[] = [
  { header: 'OrgID', key: 'orgId', width: 10 },
  { header: 'Loan Info Channel', key: 'channel', width: 18 },
  { header: 'Loan Number', key: 'loanNumber', width: 16 },
  { header: 'Borrower Name', key: 'borrowerName', width: 32 },
  { header: 'Loan Officer', key: 'loanOfficer', width: 24 },
  { header: 'Loan Amount', key: 'loanAmount', width: 14 },
  { header: 'Last Finished Milestone Date', key: 'lastFinishedMilestoneDate', width: 26 },
  { header: 'Funding date', key: 'fundingDate', width: 14 },
  { header: 'Last Finished Milestone', key: 'lastFinishedMilestone', width: 22 },
  { header: 'Loan Program', key: 'loanProgram', width: 20 },
  { header: 'Loan Type', key: 'loanType', width: 14 },
  { header: 'Strategy', key: 'strategy', width: 16 },
  { header: 'Est closing date', key: 'estClosingDate', width: 16 },
  { header: 'Healthiness', key: 'healthiness', width: 15 },
  /* Las tres que hacen auditable el resumen. Ver sus notas en `dayReport.ts`. */
  { header: 'Healthy', key: 'healthy', width: 10 },
  { header: 'Status', key: 'status', width: 11 },
  { header: 'PT weight', key: 'ptWeight', width: 11 },
];

const colOf = (header: string): string => {
  const i = DETAIL_COLUMNS.findIndex((c) => c.header === header);
  if (i < 0) throw new Error(`The Pipeline sheet has no "${header}" column.`);
  return String.fromCharCode(65 + i);
};

/*
 * Las letras se derivan del orden de `DETAIL_COLUMNS`, no se escriben a mano:
 * agregar una columna y olvidarse de correr una letra daría un COUNTIFS que
 * cuenta lo que no es, sin fallar.
 */
const COL = {
  orgId: colOf('OrgID'),
  channel: colOf('Loan Info Channel'),
  loanOfficer: colOf('Loan Officer'),
  healthy: colOf('Healthy'),
  status: colOf('Status'),
  ptWeight: colOf('PT weight'),
} as const;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const model = body?.model as DayReportModel | undefined;
    const meta = body?.meta as Meta | undefined;
    if (!model || !Array.isArray(model.rows) || !Array.isArray(model.summary) || !meta) {
      return NextResponse.json({ error: '"model" and "meta" are missing from the body.' }, { status: 400 });
    }

    const wb = new Workbook();
    const nRows = model.rows.length;
    const rng = (c: string) => `Pipeline!$${c}$2:$${c}$${nRows + 1}`;

    buildSummary(wb, model, meta, rng);
    buildByBranch(wb, model);
    buildDetail(wb, model);

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Forecast_Today_${meta.today}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function buildSummary(wb: Workbook, model: DayReportModel, meta: Meta, rng: (c: string) => string): void {
  const sh = wb.addWorksheet('Summary');
  const G = channelGrid(GRID_SPEC);
  const at = G.at;

  const titulo = sh.addRow([`Forecast as of ${meta.today}`]);
  titulo.font = { name: FONT, bold: true, size: 16, color: { argb: C.navy } };
  /*
   * Una sola línea, y lleva los dos rangos porque son los que definen los
   * números: el pipeline se acota por fecha estimada de cierre y los cerrados
   * por mes de desembolso, y son independientes. Sin esto no hay contra qué
   * comparar el archivo.
   */
  const sub = sh.addRow([
    `Pipeline ${meta.pipelineRange.startDate} – ${meta.pipelineRange.endDate} · closings ${meta.forecastMonthLabel} · ${meta.branchFilter}`,
  ]);
  sub.font = { name: FONT, size: 10, color: { argb: C.slate500 } };
  for (const r of [titulo, sub]) sh.mergeCells(r.number, 1, r.number, G.lastCol);
  sh.addRow([]);

  const HEAD_ROW = writeChannelHeader(sh, GRID_SPEC, G);

  const crit = (r: DayReportSummaryRow, n: number): string => {
    if (r.kind === 'division') return '';
    if (r.kind === 'branch') return `${rng(COL.orgId)},$A${n},`;
    return `${rng(COL.orgId)},$A${n},${rng(COL.loanOfficer)},$B${n},`;
  };

  let zebra = false;
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

    for (let col = 1; col <= G.lastCol; col++) {
      const cc = row.getCell(col);
      cc.fill = fill(bg);
      cc.font = { name: FONT, size: 10, bold, color: { argb: C.navy } };
      if (r.kind === 'division') cc.border = { top: MEDIUM, bottom: MEDIUM };
      else if (r.kind === 'branch') cc.border = { top: THIN, bottom: THIN };
      else cc.border = { bottom: THIN };
    }
    for (const col of G.spacerCols) row.getCell(col).border = {};

    for (const [channelAt, ch, cells] of [
      [G.bankedAt, 'Banked - Retail', r.banked],
      [G.brokeredAt, 'Brokered', r.brokered],
    ] as const) {
      const base = `COUNTIFS(${crit(r, n)}${rng(COL.channel)},"${ch}"`;
      const L = (i: number) => sh.getColumn(at(channelAt, i)).letter;
      const put = (i: number, formula: string, result: number) => {
        row.getCell(at(channelAt, i)).value = { formula, result };
      };

      put(0, `${base},${rng(COL.status)},"Open")`, cells.totalPipeline);
      put(1, `${base},${rng(COL.status)},"Open",${rng(COL.healthy)},"Yes")`, cells.healthyPipeline);
      put(2, `${base},${rng(COL.status)},"Closed")`, cells.closed);

      /*
       * ⚠ EL FORECAST SÍ ES FÓRMULA ACÁ, a diferencia del mensual --donde son
       * valores fijados por el negocio--. Es el de hoy y sale de la cascada, y
       * `SUMIFS` sobre `PT weight` la reproduce exactamente: la suma de los
       * pesos de un (branch, canal) ES su forecast sin redondear, y el `ROUND`
       * va por fila de branch, que es donde lo hace la pantalla.
       *
       * La división NO repite el SUMIFS: suma las CELDAS de branch. El total de
       * la app es la suma de los redondeos por branch, no el redondeo de la
       * suma, y un `ROUND(SUMIFS(...))` sin criterio de branch daría lo segundo.
       * Se completa después del bucle, cuando ya se sabe en qué filas quedaron.
       *
       * ⚠ Y NO HAY FORECAST POR PERSONA: la cascada está definida por (branch,
       * canal). Sin forecast tampoco hay `Total`.
       */
      if (r.kind === 'branch') {
        put(3, `ROUND(SUMIFS(${rng(COL.ptWeight)},${crit(r, n)}${rng(COL.channel)},"${ch}"),0)`, cells.forecast ?? 0);
        put(4, `${L(2)}${n}+${L(3)}${n}`, cells.total ?? 0);
      }

      for (let k = 0; k < G.dataCols; k++) row.getCell(at(channelAt, k)).alignment = { horizontal: 'right' };
      for (const i of [0, 2]) {
        row.getCell(at(channelAt, i)).border = { ...row.getCell(at(channelAt, i)).border, left: MEDIUM };
      }
      const ult = row.getCell(at(channelAt, G.dataCols - 1));
      ult.border = { ...ult.border, right: MEDIUM };
    }
    row.getCell(1).alignment = { horizontal: 'left' };
    row.getCell(2).alignment = { horizontal: 'left', indent: r.kind === 'officer' ? 1 : 0 };
  }

  /* La fila de división: suma de las celdas de branch, no un SUMIFS propio. */
  const div = model.summary.findIndex((r) => r.kind === 'division');
  if (div >= 0 && filasDeBranch.length > 0) {
    const n = HEAD_ROW + 1 + div;
    for (const [channelAt, cells] of [
      [G.bankedAt, model.summary[div].banked],
      [G.brokeredAt, model.summary[div].brokered],
    ] as const) {
      for (const [i, valor] of [
        [3, cells.forecast ?? 0],
        [4, cells.total ?? 0],
      ] as const) {
        const col = sh.getColumn(at(channelAt, i)).letter;
        sh.getRow(n)
          .getCell(at(channelAt, i))
          .value = { formula: filasDeBranch.map((f) => col + f).join('+'), result: valor };
      }
    }
  }

  sh.views = [{ state: 'frozen', xSplit: 2, ySplit: HEAD_ROW }];
  setChannelWidths(sh, G, () => 16);
}

const BY_BRANCH_COLUMNS = [
  { header: 'Loan Officer', width: 26 },
  { header: 'Loan Number', width: 16 },
  { header: 'Borrower Name', width: 32 },
  { header: 'Channel', width: 16 },
  { header: 'Loan Amount', width: 14 },
  { header: 'Status', width: 11 },
  { header: 'Healthy', width: 10 },
  { header: 'Last Finished Milestone', width: 22 },
  { header: 'Est closing date', width: 16 },
  { header: 'Strategy', width: 16 },
];

function buildByBranch(wb: Workbook, model: DayReportModel): void {
  const sh = wb.addWorksheet('By Branch');
  const N = BY_BRANCH_COLUMNS.length;

  const byBranch = new Map<string, DayReportRow[]>();
  for (const r of model.rows) {
    const list = byBranch.get(r.branch) ?? [];
    list.push(r);
    byBranch.set(r.branch, list);
  }

  for (const branch of [...byBranch.keys()].sort((a, b) => a.localeCompare(b))) {
    const list = byBranch.get(branch)!;
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
      cc.alignment = { horizontal: i === 5 ? 'right' : 'left', wrapText: true };
    }

    let zebra = false;
    for (const r of list) {
      zebra = !zebra;
      /*
       * ⚠ EL LOAN OFFICER VA EN CADA FILA, no sólo en la primera del grupo.
       * Escribirlo una vez se ve más limpio y deja las filas sin dueño en cuanto
       * alguien ordena o filtra la hoja, que es lo primero que se hace.
       */
      const row = sh.addRow([
        r.loanOfficer,
        r.loanNumber,
        r.borrowerName,
        r.channel,
        r.loanAmount,
        r.status,
        r.healthy,
        r.lastFinishedMilestone,
        r.estClosingDate,
        r.strategy,
      ]);
      for (let i = 1; i <= N; i++) {
        const cc = row.getCell(i);
        cc.font = { name: FONT, size: 10, color: { argb: C.navy } };
        cc.fill = fill(zebra ? C.zebra : C.white);
        cc.border = { bottom: THIN };
        if (i === 5) cc.alignment = { horizontal: 'right' };
      }
      row.getCell(5).numFmt = '#,##0';
    }

    const sub = sh.addRow([
      `${list.length} loans`,
      '',
      '',
      '',
      list.reduce((a, r) => a + (r.loanAmount ?? 0), 0),
      `${list.filter((r) => r.status === 'Open').length} open · ${list.filter((r) => r.status === 'Closed').length} closed`,
    ]);
    sh.mergeCells(sub.number, 6, sub.number, N);
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

function buildDetail(wb: Workbook, model: DayReportModel): void {
  const sh: Worksheet = wb.addWorksheet('Pipeline');
  const N = DETAIL_COLUMNS.length;
  const NUM = new Set(
    DETAIL_COLUMNS.map((c, i) => (c.key === 'loanAmount' || c.key === 'ptWeight' ? i + 1 : 0)).filter(Boolean)
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
      cc.font = { name: FONT, size: 10, color: { argb: C.navy } };
      cc.fill = fill(zebra ? C.zebra : C.white);
      cc.border = { bottom: THIN };
      if (NUM.has(i)) cc.alignment = { horizontal: 'right' };
    }
    row.getCell(DETAIL_COLUMNS.findIndex((c) => c.key === 'loanAmount') + 1).numFmt = '#,##0';
    /* Cuatro decimales: el peso de un Started es 0,6666 y redondeado a 1 no explicaría el SUMIFS. */
    row.getCell(DETAIL_COLUMNS.findIndex((c) => c.key === 'ptWeight') + 1).numFmt = '0.0000';
  }

  sh.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: N } };
  sh.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
}
