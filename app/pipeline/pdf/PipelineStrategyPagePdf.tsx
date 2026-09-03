import { Page } from '@react-pdf/renderer';
import { styles, BranchTable, BRAND, type BranchRowLite } from './pdfShared';

/**
 * ============================================================================
 * PDF-INVESTIGACIÓN — una página "By Branch" por estrategia
 * ============================================================================
 * Solo layout, mismo criterio que PipelineSummaryPdf.tsx -- las filas ya
 * llegan armadas por props (buildStrategyBranchRows(), lib/pipeline/
 * strategyBranchRows.ts), el mismo conjunto de branches que ya lista "By
 * Branch" del Resumen (ver el fix PDF3-fix). Reusa `BranchTable`/`styles`
 * de `pdfShared.tsx` -- misma estructura de columnas y mismo ancho de
 * columna numérica que "By Branch" del Resumen, no una tabla nueva.
 *
 * Etapa PDF-BRAND: el título de cada tabla ES el título de la página acá
 * (no hay un encabezado de sección aparte, a diferencia del Resumen) --
 * por eso lleva la misma barrita de acento (`accentColor` en
 * `BranchTable`), con un color de marca fijo por estrategia (no
 * inventado, los mismos 5 valores ya definidos en `BRAND`).
 */

/** Un color de marca por estrategia, mismo criterio que RPT2 (Excel mensual) -- sin inventar ninguno nuevo. */
const STRATEGY_ACCENT: Record<string, string> = {
  'Own production': BRAND.navy,
  B2B: BRAND.coral,
  Affinity: BRAND.sky,
  Recruitment: BRAND.navySoft,
  NPPM: BRAND.coralSoft,
};

export interface PipelineStrategyPagePdfProps {
  /** Nombre de la estrategia tal cual se muestra (ej. 'Own production'). */
  strategy: string;
  bankedRows: BranchRowLite[];
  brokeredRows: BranchRowLite[];
}

export default function PipelineStrategyPagePdf({ strategy, bankedRows, brokeredRows }: PipelineStrategyPagePdfProps) {
  const accentColor = STRATEGY_ACCENT[strategy] ?? BRAND.navy;
  return (
    <Page size="A4" style={styles.page}>
      <BranchTable title={`By Branch — ${strategy} (Banked - Retail)`} rows={bankedRows} accentColor={accentColor} />
      <BranchTable title={`By Branch — ${strategy} (Brokered)`} rows={brokeredRows} accentColor={accentColor} />
    </Page>
  );
}
