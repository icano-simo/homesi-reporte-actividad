import { StyleSheet, Text, View } from '@react-pdf/renderer';

/**
 * ============================================================================
 * PDF-INVESTIGACIÓN — estilos y piezas compartidas entre páginas del PDF
 * ============================================================================
 * Extraído de PipelineSummaryPdf.tsx (etapa STRATEGY-PAGES): `BranchTable`
 * hace falta tal cual en las 5 páginas nuevas por estrategia
 * (PipelineStrategyPagePdf.tsx), que a su vez la página de Resumen importa
 * para agregarlas al mismo <Document>. Si `BranchTable`/`styles` se
 * hubieran dejado en PipelineSummaryPdf.tsx, PipelineStrategyPagePdf.tsx
 * las habría importado desde ahí, y PipelineSummaryPdf.tsx habría tenido
 * que importar PipelineStrategyPagePdf.tsx para agregar sus páginas al
 * Document -- un import circular entre los dos archivos. Este módulo es
 * el tercer archivo, sin ese ciclo: los dos componentes de página lo
 * importan, ninguno se importa al otro.
 */

export interface BranchRowLite {
  branch: string;
  totalCount: number;
  healthyCount: number;
  closedCount: number;
  projectedToClose: number;
  totalForecast: number;
}

export const styles = StyleSheet.create({
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
   * Todas las tablas "Por Branch" (Resumen y las 5 páginas por estrategia)
   * más Por Loan Officer/Strategy Summary del Resumen tienen 5 columnas
   * numéricas: Total Pipeline, Healthy, Closed, Projected to Close, Total
   * Forecast. `colNum` es la MISMA en todas -- así las columnas
   * compartidas quedan del mismo ancho en cualquier tabla del PDF. El
   * resto del 100% se reparte en la(s) columna(s) de etiqueta de cada
   * tabla: `colLabel` (Branch o Strategy, una sola columna) o
   * `colLabelBranch` + `colLabelWithBranch` (Branch + Loan Officer, dos
   * columnas, Por Loan Officer -- ésta necesita más espacio total por los
   * nombres largos, ej. "Gissel Stephanie Garcia Garzon").
   *   colLabel + 5*colNum = 40 + 60 = 100
   *   colLabelBranch + colLabelWithBranch + 5*colNum = 12 + 28 + 60 = 100
   */
  colLabel: { width: '40%' },
  colNum: { width: '12%', textAlign: 'right' },
  colLabelWithBranch: { width: '28%' },
  colLabelBranch: { width: '12%' },
});

export function sumLite<T extends { totalCount: number; healthyCount: number; closedCount: number; projectedToClose: number; totalForecast: number }>(
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

/** Tabla "Por Branch" -- usada por la página de Resumen (canal a secas como título) y por cada página de estrategia (título "Por branch — {Strategy} ({Canal})"). */
export function BranchTable({ title, rows }: { title: string; rows: BranchRowLite[] }) {
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
