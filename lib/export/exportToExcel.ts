import { Workbook } from 'exceljs';
import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Measure } from '@/lib/aggregation/types';
import { buildReportTree } from '@/lib/aggregation/buildReportTree';
import { matchesStrategy, type StrategyFilter } from '@/lib/domain/strategy';
import { buildBranchSheet, buildDrillSheet } from './sheetBuilders';

/**
 * Nombre de la hoja de estrategia, dentro del límite de 31 caracteres que
 * impone Excel.
 *
 * Con el filtro en 'all' devuelve el nombre histórico tal cual, para no
 * romperle el archivo a nadie que ya lo tenga referenciado. Con una estrategia
 * elegida, `'Activity By Branch Own Production'` daría 33 caracteres y ExcelJS
 * lo rechazaría, así que en ese caso se cae al prefijo corto -- que entra
 * siempre: el nombre más largo posible es 'Activity Own Production' (23).
 */
function strategySheetName(filter: StrategyFilter): string {
  if (filter === 'all') return 'Activity By Branch B2B';
  const largo = 'Activity By Branch ' + filter;
  return largo.length <= 31 ? largo : 'Activity ' + filter;
}

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
  /**
   * Etapa V3: la estrategia elegida en pantalla. La PRIMERA hoja del libro
   * pasa a ser la de esa estrategia; con 'all' queda exactamente como estaba
   * (la hoja B2B desglosada por BD). Las otras dos hojas nunca filtran, igual
   * que antes.
   */
  strategyFilter: StrategyFilter;
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
  const { records, months, measure, strategyFilter } = options;
  const workbook = new Workbook();

  /*
   * Etapa V3: esta hoja era siempre la de B2B, filtrada por `r.isB2B` y
   * desglosada por BD. Ahora sigue al selector de la pantalla.
   *
   *   * `strategyFilter === 'all'` -> idéntica a antes, incluido el nombre de
   *     la hoja y el predicado: sigue siendo `r.isB2B`, NO `strategy === 'B2B'`.
   *     En los datos de v2 los dos dan el mismo conjunto (759 y 759, cero
   *     discrepancias medidas), pero en un archivo cargado a mano `strategy`
   *     viene vacía y `isB2B` no: cambiar el predicado dejaría esa hoja vacía
   *     en el único camino que todavía puede producir esos registros.
   *   * Con una estrategia elegida -> esa estrategia, y el desglose deja de ser
   *     por BD salvo en B2B, por el mismo motivo que en pantalla: el Business
   *     Developer sólo explica algo dentro de B2B.
   *
   * Las otras 2 hojas siguen sin filtrar, como siempre.
   */
  const sheetStrategy: StrategyFilter = strategyFilter === 'all' ? 'B2B' : strategyFilter;
  const strategyTree = buildReportTree({
    records: records.filter((r) =>
      strategyFilter === 'all' ? r.isB2B : matchesStrategy(r.strategy, sheetStrategy)
    ),
    months,
    measure,
    branchFilter: 'all',
    drillBy: sheetStrategy === 'B2B' ? 'bd' : 'loanOfficer',
  });
  buildDrillSheet(
    workbook.addWorksheet(strategySheetName(strategyFilter)),
    strategyTree,
    months,
    measure,
    sheetStrategy === 'B2B' ? 'BD' : 'Loan Officer'
  );

  const branchTree = buildReportTree({
    records,
    months,
    measure,
    branchFilter: 'all',
    drillBy: 'loanOfficer',
  });
  buildBranchSheet(workbook.addWorksheet('Activity By Branch'), branchTree, months, measure);

  const loTree = buildReportTree({
    records,
    months,
    measure,
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
