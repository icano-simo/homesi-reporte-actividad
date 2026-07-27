import { Workbook } from 'exceljs';
import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Measure } from '@/lib/aggregation/types';
import { buildReportTree } from '@/lib/aggregation/buildReportTree';
import { buildBranchSheet, buildDrillSheet } from './sheetBuilders';

export interface ExportToExcelOptions {
  records: LoanRecord[];
  months: YearMonth[];
  measure: Measure;
  /**
   * Nombre del archivo de origen cargado por el usuario. Se acepta por
   * completitud del contrato de esta etapa, pero el nombre de descarga
   * sigue el esquema fijo del legacy ('Stats_activity_'+fecha), que no
   * incorpora el nombre de origen -- ver Riesgos en la respuesta.
   */
  fileName: string;
}

/**
 * Port de exportExcel() del legacy, pero sin recalcular nada: cada hoja se
 * arma llamando a buildReportTree() (Etapa 5) -- la misma función que ya usa
 * la pantalla -- y sheetBuilders.ts solo transforma ese ReportTree ya
 * calculado a celdas de ExcelJS. Elimina la duplicación de cálculo que tenía
 * el legacy entre renderTable() y xlBranchSheet()/xlDrillSheet().
 *
 * branchFilter siempre es 'all' para las 3 hojas, independiente de cualquier
 * filtro de branch activo en pantalla -- igual que exportExcel() del legacy,
 * que siempre exporta sobre RECORDS/b2b completos, nunca sobre BRANCHF.
 *
 * Decisión de diseño (ver Riesgos): las 3 hojas usan el mismo `months` que
 * recibe esta función (los meses mostrados en pantalla), no el rango fijo
 * "solo el último año" que usaba xlDrillSheet() en el legacy para las hojas
 * B2B/LO.
 */
export async function exportToExcel(options: ExportToExcelOptions): Promise<void> {
  const { records, months, measure } = options;
  const workbook = new Workbook();

  const b2bTree = buildReportTree({
    records,
    months,
    measure,
    view: 'b2b',
    branchFilter: 'all',
    drillBy: 'bd',
  });
  buildDrillSheet(workbook.addWorksheet('Activity By Branch B2B'), b2bTree, months, measure, 'BD');

  const branchTree = buildReportTree({
    records,
    months,
    measure,
    view: 'main',
    branchFilter: 'all',
    drillBy: 'loanOfficer',
  });
  buildBranchSheet(workbook.addWorksheet('Activity By Branch'), branchTree, months, measure);

  const loTree = buildReportTree({
    records,
    months,
    measure,
    view: 'main',
    branchFilter: 'all',
    drillBy: 'loanOfficer',
  });
  buildDrillSheet(workbook.addWorksheet('Activity By LO'), loTree, months, measure, 'Loan Officer');

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const d = new Date();
  const stamp = d.getFullYear() + '_' + String(d.getMonth() + 1).padStart(2, '0') + '_' + String(d.getDate()).padStart(2, '0');
  const suffix = measure === 'amount' ? '_Monto' : '';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Stats_activity_' + stamp + suffix + '.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
