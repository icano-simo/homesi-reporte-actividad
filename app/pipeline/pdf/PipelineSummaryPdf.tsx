import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, sumLite, BranchTable, SectionTitle, BRAND, type BranchRowLite } from './pdfShared';
import PipelineStrategyPagePdf from './PipelineStrategyPagePdf';

/**
 * ============================================================================
 * PDF-INVESTIGACIÓN — Página 1: Resumen (@react-pdf/renderer)
 * ============================================================================
 * Solo layout -- ningún cálculo de negocio adentro de este archivo. Todo
 * (KPIs, filas por branch/loan officer/strategy, ya separadas por canal)
 * llega ya resuelto por props, mismo patrón que ya usa
 * `app/api/pipeline/export/route.ts`: recibe `cover`/`strategySummary` ya
 * armados en el body, sin volver a calcular nada del lado del servidor.
 *
 * react-pdf no tiene <table> -- cada tabla es una View por fila con
 * flexDirection: 'row', y cada celda un View con un width fijo (%).
 *
 * Etapa STRATEGY-PAGES: `styles`/`sumLite`/`BranchTable`/`BranchRowLite`
 * viven ahora en `./pdfShared` (ver el comentario de cabecera de ese
 * archivo -- evita un import circular con `PipelineStrategyPagePdf.tsx`,
 * que también los necesita). Este archivo agrega, DESPUÉS de la página de
 * Resumen y dentro del mismo <Document>, una <Page> por estrategia
 * (`strategyPages`, un elemento por cada `STRATEGY_ORDER`) usando ese
 * componente -- un solo PDF, no un archivo por estrategia.
 */

export type { BranchRowLite };

export interface LoanOfficerRowLite {
  branch: string;
  loanOfficer: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

export interface StrategyRowLite {
  strategy: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

/** Una entrada por estrategia -- las 2 tablas (Banked/Brokered) ya armadas por buildStrategyBranchRows(). */
export interface StrategyPageData {
  strategy: string;
  banked: BranchRowLite[];
  brokered: BranchRowLite[];
}

export interface PipelineSummaryPdfProps {
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
  /** Una página por estrategia, en el orden que ya viene (STRATEGY_ORDER). */
  strategyPages: StrategyPageData[];
}

function LoanOfficerTable({ title, rows }: { title: string; rows: LoanOfficerRowLite[] }) {
  const subtotal = sumLite(rows);
  return (
    <View>
      <Text style={styles.channelLabel}>{title}</Text>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.cellHeader, styles.colLabelBranch]}>Branch</Text>
          <Text style={[styles.cellHeader, styles.colLabelWithBranch]}>Loan Officer</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Total Pipeline</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Healthy</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Closed</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Projected to Close</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Total Forecast</Text>
        </View>
        {rows.map((r, i) => (
          <View style={styles.row} key={r.branch + '::' + r.loanOfficer + '::' + i}>
            <Text style={[styles.cell, styles.colLabelBranch]}>{r.branch}</Text>
            <Text style={[styles.cell, styles.colLabelWithBranch]}>{r.loanOfficer}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.totalCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.healthyCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.closedCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.projectedToClose}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.totalForecast}</Text>
          </View>
        ))}
        <View style={styles.subtotalRow}>
          <Text style={[styles.cellBold, styles.colLabelBranch]}>Subtotal</Text>
          <Text style={[styles.cellBold, styles.colLabelWithBranch]}></Text>
          <Text style={[styles.cellBold, styles.colNum]}>{subtotal.totalCount}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{subtotal.healthyCount}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{subtotal.closedCount}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{subtotal.projectedToClose}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{subtotal.totalForecast}</Text>
        </View>
      </View>
    </View>
  );
}

function StrategyTable({ title, rows }: { title: string; rows: StrategyRowLite[] }) {
  const total = sumLite(rows);
  return (
    <View>
      <Text style={styles.channelLabel}>{title}</Text>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.cellHeader, styles.colLabel]}>Strategy</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Total Pipeline</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Healthy</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Closed</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Projected to Close</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Total Forecast</Text>
        </View>
        {rows.map((r) => (
          <View style={styles.row} key={r.strategy}>
            <Text style={[styles.cell, styles.colLabel]}>{r.strategy}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.totalCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.healthyCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.closedCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.projectedToClose}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.totalForecast}</Text>
          </View>
        ))}
        <View style={styles.subtotalRow}>
          <Text style={[styles.cellBold, styles.colLabel]}>Total</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{total.totalCount}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{total.healthyCount}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{total.closedCount}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{total.projectedToClose}</Text>
          <Text style={[styles.cellBold, styles.colNum]}>{total.totalForecast}</Text>
        </View>
      </View>
    </View>
  );
}

export default function PipelineSummaryPdf({ kpis, meta, branchRows, loanOfficerRows, strategyRows, strategyPages }: PipelineSummaryPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Forecast &amp; Pipeline Summary — {meta.forecastMonthLabel}</Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Pipeline Range</Text>
            <Text style={styles.metaValue}>{meta.pipelineRangeLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Branch</Text>
            <Text style={styles.metaValue}>{meta.branchLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Generated</Text>
            <Text style={styles.metaValue}>{meta.generatedAtLabel}</Text>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Pipeline</Text>
            <Text style={styles.kpiValue}>{kpis.totalPipeline}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Healthy Pipeline</Text>
            <Text style={styles.kpiValue}>{kpis.healthyPipeline}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Closed</Text>
            <Text style={styles.kpiValue}>{kpis.closed}</Text>
          </View>
          <View style={[styles.kpiCard, { marginRight: 0 }]}>
            <Text style={styles.kpiLabel}>Total Forecast</Text>
            <Text style={styles.kpiValue}>{kpis.totalForecast}</Text>
          </View>
        </View>

        <SectionTitle text="By Branch" accentColor={BRAND.navy} />
        <BranchTable title="Banked - Retail" rows={branchRows.banked} />
        <BranchTable title="Brokered" rows={branchRows.brokered} />

        {/* Etapa PDF-BRAND: salto de página antes de "By Loan Officer" -- prop `break` de react-pdf en el contenedor que arranca la sección. */}
        <View break>
          <SectionTitle text="By Loan Officer" accentColor={BRAND.sky} />
          <LoanOfficerTable title="Banked - Retail" rows={loanOfficerRows.banked} />
          <LoanOfficerTable title="Brokered" rows={loanOfficerRows.brokered} />
        </View>

        {/* Etapa PDF-BRAND: mismo salto de página que "By Loan Officer" -- prop `break` en el contenedor que arranca la sección. */}
        <View break>
          <SectionTitle text="Strategy Summary" accentColor={BRAND.coral} />
          <StrategyTable title="Banked - Retail" rows={strategyRows.banked} />
          <StrategyTable title="Brokered" rows={strategyRows.brokered} />
        </View>
      </Page>

      {strategyPages.map((sp) => (
        <PipelineStrategyPagePdf key={sp.strategy} strategy={sp.strategy} bankedRows={sp.banked} brokeredRows={sp.brokered} />
      ))}
    </Document>
  );
}
