import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

/**
 * ============================================================================
 * PDF-INVESTIGACIÓN — Página 1: Resumen (@react-pdf/renderer)
 * ============================================================================
 * Solo layout -- ningún cálculo de negocio adentro de este archivo. Todo
 * (KPIs, filas por branch/loan officer/strategy, ya separadas por canal)
 * llega ya resuelto por props, igual que `handleExport()` ya arma
 * `exportRows`/`cover`/`strategySummary` para el Excel antes de mandarlos a
 * `app/api/pipeline/export/route.ts`.
 *
 * react-pdf no tiene <table> -- cada tabla es una View por fila con
 * flexDirection: 'row', y cada celda un View con un width fijo (%).
 */

export interface BranchRowLite {
  branch: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

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
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#111827',
    padding: 32,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    color: '#374151',
  },
  metaRow: {
    flexDirection: 'row',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
  },
  metaItem: {
    marginRight: 24,
  },
  metaLabel: {
    fontSize: 8,
    color: '#6b7280',
  },
  metaValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    marginTop: 18,
    marginBottom: 6,
  },
  kpiRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    padding: 8,
    marginRight: 8,
  },
  kpiLabel: {
    fontSize: 8,
    color: '#6b7280',
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    marginTop: 2,
  },
  channelLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginTop: 10,
    marginBottom: 4,
    color: '#374151',
  },
  table: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  subtotalRow: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
  },
  cellHeader: {
    padding: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  cell: {
    padding: 4,
    fontSize: 8,
  },
  cellBold: {
    padding: 4,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  /*
   * Las 3 tablas (Por Branch, Por Loan Officer, Strategy Summary) tienen
   * 5 columnas numéricas: Total Pipeline, Healthy, Closed, Projected to
   * Close, Total Forecast. `colNum` es la MISMA en las 3 -- así las
   * columnas compartidas quedan del mismo ancho en todas. El resto del
   * 100% se reparte en la(s) columna(s) de etiqueta de cada tabla:
   * `colLabel` (Branch o Strategy, una sola columna, Por Branch/Strategy
   * Summary) o `colLabelBranch` + `colLabelWithBranch` (Branch + Loan
   * Officer, dos columnas, Por Loan Officer -- ésta necesita más espacio
   * total por los nombres largos, ej. "Gissel Stephanie Garcia Garzon").
   *   colLabel + 5*colNum = 40 + 60 = 100
   *   colLabelBranch + colLabelWithBranch + 5*colNum = 12 + 28 + 60 = 100
   */
  colLabel: { width: '40%' },
  colNum: { width: '12%', textAlign: 'right' },
  colLabelWithBranch: { width: '28%' },
  colLabelBranch: { width: '12%' },
});

function sumLite<T extends { totalCount: number; healthyCount: number; closedCount: number; projectedToClose: number; totalForecast: number }>(
  rows: T[]
) {
  return rows.reduce(
    (acc, r) => ({
      totalCount: acc.totalCount + r.totalCount,
      healthyCount: acc.healthyCount + r.healthyCount,
      closedCount: acc.closedCount + r.closedCount,
      projectedToClose: acc.projectedToClose + r.projectedToClose,
      totalForecast: acc.totalForecast + r.totalForecast,
    }),
    { totalCount: 0, healthyCount: 0, closedCount: 0, projectedToClose: 0, totalForecast: 0 }
  );
}

function BranchTable({ title, rows }: { title: string; rows: BranchRowLite[] }) {
  const subtotal = sumLite(rows);
  return (
    <View>
      <Text style={styles.channelLabel}>{title}</Text>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.cellHeader, styles.colLabel]}>Branch</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Total Pipeline</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Healthy</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Closed</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Projected to Close</Text>
          <Text style={[styles.cellHeader, styles.colNum]}>Total Forecast</Text>
        </View>
        {rows.map((r) => (
          <View style={styles.row} key={r.branch}>
            <Text style={[styles.cell, styles.colLabel]}>{r.branch}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.totalCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.healthyCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.closedCount}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.projectedToClose}</Text>
            <Text style={[styles.cell, styles.colNum]}>{r.totalForecast}</Text>
          </View>
        ))}
        <View style={styles.subtotalRow}>
          <Text style={[styles.cellBold, styles.colLabel]}>Subtotal</Text>
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

export default function PipelineSummaryPdf({ kpis, meta, branchRows, loanOfficerRows, strategyRows }: PipelineSummaryPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Forecast &amp; Pipeline</Text>
        <Text style={styles.subtitle}>Resumen — {meta.forecastMonthLabel}</Text>
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
            <Text style={styles.metaLabel}>Generado</Text>
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

        <Text style={styles.sectionTitle}>Por Branch</Text>
        <BranchTable title="Banked - Retail" rows={branchRows.banked} />
        <BranchTable title="Brokered" rows={branchRows.brokered} />

        <Text style={styles.sectionTitle}>Por Loan Officer</Text>
        <LoanOfficerTable title="Banked - Retail" rows={loanOfficerRows.banked} />
        <LoanOfficerTable title="Brokered" rows={loanOfficerRows.brokered} />

        <Text style={styles.sectionTitle}>Strategy Summary</Text>
        <StrategyTable title="Banked - Retail" rows={strategyRows.banked} />
        <StrategyTable title="Brokered" rows={strategyRows.brokered} />
      </Page>
    </Document>
  );
}
