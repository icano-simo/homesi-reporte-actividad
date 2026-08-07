import { NextResponse } from 'next/server';
import { Workbook } from 'exceljs';

export const runtime = 'nodejs';

interface ExportRow {
  loanChannel: string;
  loanNumber: string;
  borrowerName: string;
  branch: string;
  loanOfficer: string;
  lastMeeting: string;
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
 * Officer/Last Meeting, con los 3 grupos -- abiertos/cerrados/adverse --
 * ya mezclados en un solo array, en el mismo orden en que page.tsx los
 * concatena). Este endpoint no sabe nada de PipelineLoan/ResolvedLoan ni
 * de ningún filtro de fecha/branch -- toda esa lógica vive en page.tsx,
 * sobre los mismos datos que ya están en memoria del cliente (no vuelve a
 * consultar Supabase, evita cualquier drift entre lo que se ve en
 * pantalla y lo que se descarga). Mismo patrón/librería que ya usa
 * Actividad (lib/export/exportToExcel.ts, ExcelJS) -- acá corre
 * server-side (a diferencia de Actividad, que arma el workbook en el
 * navegador) porque así lo pide el brief de esta etapa.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows = body?.rows;
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: 'Falta "rows" en el body.' }, { status: 400 });
    }

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Pipeline');

    sheet.columns = [
      { header: 'Loan Channel', key: 'loanChannel', width: 18 },
      { header: 'Loan Number', key: 'loanNumber', width: 18 },
      { header: 'Borrower Name', key: 'borrowerName', width: 26 },
      { header: 'Branch', key: 'branch', width: 12 },
      { header: 'Loan Officer', key: 'loanOfficer', width: 22 },
      { header: 'Last Meeting', key: 'lastMeeting', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows as ExportRow[]) {
      sheet.addRow({
        loanChannel: row.loanChannel ?? '',
        loanNumber: row.loanNumber ?? '',
        borrowerName: row.borrowerName ?? '',
        branch: row.branch ?? '',
        loanOfficer: row.loanOfficer ?? '',
        lastMeeting: row.lastMeeting ?? '',
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
