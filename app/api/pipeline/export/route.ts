import { NextResponse } from 'next/server';
import { Workbook } from 'exceljs';

export const runtime = 'nodejs';

interface ExportRow {
  loanChannel: string;
  loanNumber: string;
  borrowerName: string;
  branch: string;
  loanOfficer: string;
  /**
   * Etapa EXCEL-2: antes `lastMeeting` / header "Last Meeting" -- ese
   * nombre no coincide con nada del origen. Es el valor crudo de la
   * columna "Healthiness" de Salesforce (rawHealthiness para abiertos,
   * o el literal 'Funded'/'Adverse' para cerrados/adverse, sin cambios
   * en ese criterio) -- se renombra la clave, no solo el header, para
   * que no quede un desacople permanente entre el nombre del campo y lo
   * que muestra.
   */
  healthiness: string;
  /**
   * Etapa EXCEL-2: de la columna "Branch Transfer" del origen (ya
   * existía como PipelineLoan.branchTransferred/ResolvedLoan.branchTransferred,
   * "solo informativo, no afecta branch ni cálculos" -- ver
   * lib/pipeline/types.ts). Mismo dato que ya muestra el chip de
   * LoanDetailModal.tsx, acá como columna filtrable en vez de un ícono.
   * No hay branch "anterior" que traer -- el origen es un flag 1/0, no
   * un registro de/hacia qué branch.
   *
   * Etapa EXCEL-3: ya NO es `boolean` -- page.tsx manda el texto final
   * ya decidido ('Yes' / '' / 'Not tracked for closed loans', ver
   * openLoanBranchTransferValue()/BRANCH_TRANSFER_NOT_TRACKED en
   * page.tsx). `pipeline_resolved_loans` nunca tuvo esta columna
   * (hallazgo F5a, ver docs/ARQUITECTURA.md), así que un `false` de un
   * loan cerrado no es un "No" confirmado -- este endpoint ya no decide
   * eso, solo pasa el string tal cual, mismo criterio que
   * strategy/healthiness de arriba.
   */
  branchTransferred: string;
  /**
   * Etapa EXCEL-1: los cinco crudos de estrategia (Etapa F6/F7.20) + la
   * columna "Strategy" ya calculada con classifyStrategy() -- ver el
   * mismo patrón en page.tsx (toPipelineLoanRow/toResolvedLoanRow de
   * app/api/pipeline/parse/route.ts ya usan el mismo criterio: paso
   * directo, sin transformar, '' si el snapshot no trae la columna).
   */
  strategyRaw: string;
  opportunityOwnerTitle: string;
  nppmRealtor: string;
  referredBy: string;
  opportunityOwner: string;
  strategy: string;
}

/** Etapa EXCEL-6: datos ya resueltos por page.tsx para la hoja de portada -- ver coverSheetData ahí. */
interface CoverSheetData {
  snapshotId: number | null;
  snapshotDataAsOf: string | null;
  pipelineDateRange: string;
  forecastMonth: string;
  branchFilter: string;
  strategyFilter: string;
  channelFilter: string;
}

/** Etapa EXCEL-6: una fila de la hoja de resumen por estrategia -- mismas 5 columnas del pivot ("By strategy"). */
interface StrategySummaryRow {
  strategy: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

interface StrategySummaryPayload {
  /** true si el snapshot no trae datos de estrategia -- mismo criterio que strategyDataMissingForExport en page.tsx. */
  missing: boolean;
  rows: StrategySummaryRow[];
  total: Omit<StrategySummaryRow, 'strategy'>;
}

/** Ver el mismo helper en app/api/pipeline/parse/route.ts -- duplicado por el mismo motivo (sin lib/ compartido server-side todavía). */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Etapa F5k: recibe las filas YA armadas por page.tsx (columnas ya
 * resueltas -- Loan Channel/Loan Number/Borrower Name/Branch/Loan
 * Officer/Healthiness, con los 3 grupos -- abiertos/cerrados/adverse --
 * ya mezclados en un solo array, en el mismo orden en que page.tsx los
 * concatena). Etapa EXCEL-2: "Last Meeting" se renombró a "Healthiness"
 * (nombre real de la columna en Salesforce) y se agregó Branch Transfer
 * (mismo dato del chip de LoanDetailModal, acá como columna). Etapa
 * EXCEL-1: se agregaron Strategy (ya calculada con classifyStrategy(),
 * o el aviso explícito si el snapshot no trae datos de estrategia -- ver
 * strategyColumnValue() en page.tsx) + los cinco crudos (Strategy
 * raw/Opportunity Owner: Title/Opportunity Owner/NPPM Realtor/Referred
 * By), mismo criterio de paso directo sin transformar.
 *
 * Etapa EXCEL-6: el workbook pasó de 1 a 3 hojas -- Cover (portada,
 * `body.cover`), Strategy Summary (siempre las 5 estrategias, ignora el
 * filtro de estrategia a propósito, `body.strategySummary`) y Pipeline
 * (el detalle de siempre, sin cambios de comportamiento -- solo se le
 * agregó el filtro de Channel de Adverse Loans, ya resuelto en
 * `exportRows` antes de llegar acá). Los tres `cover`/`strategySummary`
 * son opcionales en el body (`if (cover)`/`if (strategySummary)`) para
 * no romper si algún caller viejo solo manda `rows`.
 *
 * Este endpoint no sabe nada de PipelineLoan/ResolvedLoan ni
 * de ningún filtro de fecha/branch/estrategia/canal -- toda esa lógica vive en
 * page.tsx (incluido el filtro por estrategia activa del conmutador de
 * PivotTable), sobre los mismos datos que ya están en memoria del cliente (no vuelve a
 * consultar Supabase, evita cualquier drift entre lo que se ve en
 * pantalla y lo que se descarga). Mismo patrón/librería que ya usa
 * Actividad (lib/export/exportToExcel.ts, ExcelJS) -- acá corre
 * server-side (a diferencia de Actividad, que arma el workbook en el
 * navegador) porque así lo pide el brief de esta etapa.
 */

/**
 * Etapa PDF-DOWNLOAD-ONLY: el botón "Download Excel" y su handler del lado
 * del cliente (`handleExport()` en page.tsx) se retiraron, porque el PDF ya
 * cubre esa misma información (KPIs, By Branch, By Loan Officer, Strategy
 * Summary). Este endpoint queda vivo A PROPÓSITO, sin ningún llamador real
 * hoy, por si hace falta revertir más adelante.
 *
 * Antes de borrarlo en una futura limpieza de código muerto, hay que
 * confirmar de nuevo que sigue sin consumidores -- igual que se hizo acá: un
 * grep de `/api/pipeline/export` y `handleExport` en todo el proyecto, y
 * clasificar cada mención como uso real de código o solo comentario/prosa
 * (varios archivos lo citan como patrón de referencia sin importarlo ni
 * llamarlo -- eso no cuenta como consumidor).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows = body?.rows;
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: '"rows" is missing from the body.' }, { status: 400 });
    }
    const cover = body?.cover as CoverSheetData | undefined;
    const strategySummary = body?.strategySummary as StrategySummaryPayload | undefined;

    const workbook = new Workbook();

    /*
     * ============================================================================
     * Etapa EXCEL-6 — HOJA 1: PORTADA
     * ============================================================================
     * Primera hoja del workbook (ExcelJS respeta el orden de addWorksheet).
     * Puro key/value, sin cálculo -- todo ya viene resuelto de page.tsx.
     */
    if (cover) {
      const coverSheet = workbook.addWorksheet('Cover');
      coverSheet.columns = [
        { header: '', key: 'label', width: 26 },
        { header: '', key: 'value', width: 46 },
      ];
      const coverRows: [string, string][] = [
        ['Snapshot ID', cover.snapshotId != null ? String(cover.snapshotId) : 'n/a'],
        ['Snapshot data as of', cover.snapshotDataAsOf ?? 'n/a'],
        ['Pipeline range (Total/Healthy Pipeline)', cover.pipelineDateRange],
        ['Forecast month (Closed/Forecast/Adverse)', cover.forecastMonth],
        ['Branch filter', cover.branchFilter],
        ['Strategy filter', cover.strategyFilter],
        ['Channel filter (Adverse Loans only)', cover.channelFilter],
      ];
      for (const [label, value] of coverRows) {
        coverSheet.addRow({ label, value });
      }
      coverSheet.getColumn('label').font = { bold: true };
      coverSheet.addRow({});
      // Etapa EXCEL-6: nota pedida explícitamente por Isa -- para que la
      // diferencia entre el resumen (siempre el período completo) y el
      // detalle (respeta los filtros) no se reporte como un bug.
      const noteRow = coverSheet.addRow({
        label: '',
        value:
          'Summary sheet totals reflect the full period, regardless of any strategy/channel filter applied. Detail sheet reflects only what was filtered.',
      });
      noteRow.getCell('value').alignment = { wrapText: true };
      noteRow.getCell('value').font = { italic: true };
    }

    /*
     * ============================================================================
     * Etapa EXCEL-6 — HOJA 2: RESUMEN POR ESTRATEGIA
     * ============================================================================
     * SIEMPRE las 5 estrategias (STRATEGY_ORDER, ya pre-sembradas por
     * page.tsx) -- este endpoint no decide eso, solo dibuja lo que llega.
     * Si `missing` es true (snapshot sin datos de estrategia), se muestra
     * el mismo aviso del detalle en vez de una tabla con números falsos.
     */
    if (strategySummary) {
      const summarySheet = workbook.addWorksheet('Strategy Summary');
      if (strategySummary.missing) {
        summarySheet.addRow(['No strategy data in this snapshot']);
      } else {
        summarySheet.columns = [
          { header: 'Strategy', key: 'strategy', width: 18 },
          { header: 'Total Pipeline', key: 'totalCount', width: 16 },
          { header: 'Healthy', key: 'healthyCount', width: 12 },
          { header: 'Closed', key: 'closedCount', width: 12 },
          { header: 'Projected to Close', key: 'projectedToClose', width: 18 },
          { header: 'Forecast', key: 'totalForecast', width: 12 },
        ];
        summarySheet.getRow(1).font = { bold: true };
        for (const r of strategySummary.rows) {
          summarySheet.addRow({
            strategy: r.strategy,
            totalCount: r.totalCount,
            healthyCount: r.healthyCount,
            closedCount: r.closedCount,
            projectedToClose: r.projectedToClose,
            totalForecast: r.totalForecast,
          });
        }
        const totalRow = summarySheet.addRow({
          strategy: 'Total',
          totalCount: strategySummary.total.totalCount,
          healthyCount: strategySummary.total.healthyCount,
          closedCount: strategySummary.total.closedCount,
          projectedToClose: strategySummary.total.projectedToClose,
          totalForecast: strategySummary.total.totalForecast,
        });
        totalRow.font = { bold: true };
      }
    }

    /*
     * ============================================================================
     * HOJA 3: DETALLE — 'Pipeline' (Etapa F5k, ampliada en EXCEL-1/2/3/5)
     * ============================================================================
     */
    const sheet = workbook.addWorksheet('Pipeline');

    sheet.columns = [
      { header: 'Loan Channel', key: 'loanChannel', width: 18 },
      { header: 'Loan Number', key: 'loanNumber', width: 18 },
      { header: 'Borrower Name', key: 'borrowerName', width: 26 },
      { header: 'Branch', key: 'branch', width: 12 },
      { header: 'Loan Officer', key: 'loanOfficer', width: 22 },
      { header: 'Healthiness', key: 'healthiness', width: 16 },
      // Etapa EXCEL-2: mismo dato que el chip de LoanDetailModal, como columna.
      { header: 'Branch Transfer', key: 'branchTransferred', width: 16 },
      // Etapa EXCEL-1: los cinco crudos de estrategia + la columna calculada.
      { header: 'Strategy', key: 'strategy', width: 16 },
      { header: 'Strategy (raw)', key: 'strategyRaw', width: 16 },
      { header: 'Opportunity Owner: Title', key: 'opportunityOwnerTitle', width: 22 },
      { header: 'Opportunity Owner', key: 'opportunityOwner', width: 22 },
      { header: 'NPPM Realtor', key: 'nppmRealtor', width: 20 },
      { header: 'Referred By', key: 'referredBy', width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows as ExportRow[]) {
      sheet.addRow({
        loanChannel: row.loanChannel ?? '',
        loanNumber: row.loanNumber ?? '',
        borrowerName: row.borrowerName ?? '',
        branch: row.branch ?? '',
        loanOfficer: row.loanOfficer ?? '',
        healthiness: row.healthiness ?? '',
        // Etapa EXCEL-3: paso directo -- page.tsx ya decidió el texto ('Yes'/''/'Not tracked for closed loans').
        branchTransferred: row.branchTransferred ?? '',
        strategy: row.strategy ?? '',
        strategyRaw: row.strategyRaw ?? '',
        opportunityOwnerTitle: row.opportunityOwnerTitle ?? '',
        opportunityOwner: row.opportunityOwner ?? '',
        nppmRealtor: row.nppmRealtor ?? '',
        referredBy: row.referredBy ?? '',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    const now = new Date();
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Forecast_Pipeline_${stamp}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
