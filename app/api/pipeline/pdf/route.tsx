import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import PipelineSummaryPdf, {
  type BranchRowLite,
  type LoanOfficerRowLite,
  type StrategyRowLite,
  type StrategyPageData,
} from '@/app/pipeline/pdf/PipelineSummaryPdf';

export const runtime = 'nodejs';

interface PdfRequestBody {
  kpis: {
    totalPipeline: number;
    healthyPipeline: number;
    closed: number;
    totalForecast: number;
  };
  meta: {
    forecastMonthLabel: string;
    pipelineRangeLabel: string;
    branchLabel: string;
    generatedAtLabel: string;
  };
  branchRows: { banked: BranchRowLite[]; brokered: BranchRowLite[] };
  loanOfficerRows: { banked: LoanOfficerRowLite[]; brokered: LoanOfficerRowLite[] };
  strategyRows: { banked: StrategyRowLite[]; brokered: StrategyRowLite[] };
  strategyPages: StrategyPageData[];
}

/** Ver el mismo helper en app/api/pipeline/export/route.ts -- duplicado por el mismo motivo (sin lib/ compartido server-side todavía). */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * PDF-INVESTIGACIÓN — Resumen + una página "Por branch" por estrategia.
 *
 * Mismo patrón que app/api/pipeline/export/route.ts: recibe TODO ya
 * calculado por page.tsx en el body (nada de lógica de negocio acá, no
 * vuelve a consultar Supabase), y solo dibuja -- acá con
 * @react-pdf/renderer en vez de ExcelJS. Etapa STRATEGY-PAGES: agrega
 * `strategyPages` (una entrada por STRATEGY_ORDER, ya armada por
 * `buildStrategyBranchRows()` en page.tsx) sin tocar nada de lo anterior.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<PdfRequestBody>;
    if (
      !body?.kpis ||
      !body?.meta ||
      !body?.branchRows ||
      !body?.loanOfficerRows ||
      !body?.strategyRows ||
      !Array.isArray(body?.strategyPages)
    ) {
      return NextResponse.json({ error: 'Missing required fields in the request body.' }, { status: 400 });
    }

    const buffer = await renderToBuffer(
      <PipelineSummaryPdf
        kpis={body.kpis}
        meta={body.meta}
        branchRows={body.branchRows}
        loanOfficerRows={body.loanOfficerRows}
        strategyRows={body.strategyRows}
        strategyPages={body.strategyPages}
      />
    );

    const now = new Date();
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Forecast_Pipeline_Resumen_${stamp}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
