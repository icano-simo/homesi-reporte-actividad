import { NextResponse } from 'next/server';
/*
 * ============================================================================
 * POR QUÉ @react-pdf/renderer -- documentado a pedido de Isa
 * ============================================================================
 * Encaja con el mismo patrón que ya usa el Excel (`export/route.ts`): el
 * cliente calcula todo, el servidor solo dibuja -- acá con
 * @react-pdf/renderer en vez de ExcelJS, mismo reparto de responsabilidades.
 * Tiene motor de layout propio (flexbox, ver `pdfShared.tsx`) -- las tablas
 * se arman con `flexDirection`/`width` en vez de posicionar cada celda a
 * mano en coordenadas x/y.
 *
 * ⚠ TRES ALTERNATIVAS DESCARTADAS:
 *   Puppeteer/Playwright -- un navegador headless entero para renderizar un
 *     PDF es desproporcionado acá (cold starts largos, bundle pesado).
 *   pdf-lib -- sin motor de layout: cada celda se posiciona a mano en
 *     coordenadas x/y.
 *   jsPDF -- mismo problema que pdf-lib, sin motor de layout propio.
 *
 * ⚠ NO MEDIDO: ni el bundle size ni el cold-start reales de
 * @react-pdf/renderer en esta ruta -- la elección fue por ajuste de patrón
 * y por tener motor de layout, no por un benchmark. Si el cold-start
 * resulta un problema en producción, ese dato todavía falta.
 */
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
      // @react-pdf/renderer server-side, no react-dom: renderToBuffer() ejecuta el render real
      // dentro de este await, así que cualquier error de render de PipelineSummaryPdf
      // (Document/Page/Text/View) SÍ cae en el catch de abajo -- a diferencia de react-dom,
      // donde escribir JSX solo describe el elemento y el render ocurre después, fuera de este try/catch.
      // eslint-disable-next-line react-hooks/error-boundaries
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
