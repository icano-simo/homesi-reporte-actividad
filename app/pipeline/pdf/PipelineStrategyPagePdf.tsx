import { Page } from '@react-pdf/renderer';
import { styles, BranchTable, type BranchRowLite } from './pdfShared';

/**
 * ============================================================================
 * PDF-INVESTIGACIÓN — una página "Por branch" por estrategia
 * ============================================================================
 * Solo layout, mismo criterio que PipelineSummaryPdf.tsx -- las filas ya
 * llegan armadas por props (buildStrategyBranchRows(), lib/pipeline/
 * strategyBranchRows.ts), TODOS los branches conocidos incluidos aunque
 * den cero. Reusa `BranchTable`/`styles` de `pdfShared.tsx` -- misma
 * estructura de columnas y mismo ancho de columna numérica que "Por
 * Branch" del Resumen, no una tabla nueva.
 */

export interface PipelineStrategyPagePdfProps {
  /** Nombre de la estrategia tal cual se muestra (ej. 'Own production'). */
  strategy: string;
  bankedRows: BranchRowLite[];
  brokeredRows: BranchRowLite[];
}

export default function PipelineStrategyPagePdf({ strategy, bankedRows, brokeredRows }: PipelineStrategyPagePdfProps) {
  return (
    <Page size="A4" style={styles.page}>
      <BranchTable title={`Por branch — ${strategy} (Banked - Retail)`} rows={bankedRows} />
      <BranchTable title={`Por branch — ${strategy} (Brokered)`} rows={brokeredRows} />
    </Page>
  );
}
