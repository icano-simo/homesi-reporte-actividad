import { utils, type WorkBook } from 'xlsx';
import { REQUIRED_COLUMNS, OPTIONAL_COLUMNS } from '@/config/requiredColumns';
import { excelValueToYearMonth } from './excelDate';
import type { RawLoanRow } from './types';

const TOTAL_LOAN_AMOUNT_COLUMN = OPTIONAL_COLUMNS[0];
const LOAN_PROGRAM_COLUMN = OPTIONAL_COLUMNS[1];
const LOAN_FOLDER_NAME_COLUMN = OPTIONAL_COLUMNS[2];
const AFFINITY_COLUMN = OPTIONAL_COLUMNS[3];
const DISBURSEMENT_DATE_COLUMN = OPTIONAL_COLUMNS[4];

function toRawString(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).trim();
}

function readSheetAsRows(workbook: WorkBook, sheetName: string): unknown[][] {
  return utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    blankrows: false,
  });
}

function headerOf(rows: unknown[][]): string[] {
  const first = rows[0] ?? [];
  return first.map((x) => (x === null || x === undefined ? '' : String(x)).trim());
}

/**
 * Recorre las hojas del workbook y mapea las filas de la primera hoja cuyo
 * encabezado contiene todas las REQUIRED_COLUMNS a RawLoanRow.
 *
 * No decide branch ni closing, no normaliza loan officer/BD y no convierte
 * B2B Loans a boolean: eso es responsabilidad de lib/domain (Etapa 4). El
 * workbook debe llegar ya parseado por la librería xlsx; esta función no lee
 * archivos ni toca el DOM.
 */
export function readWorkbook(workbook: WorkBook): RawLoanRow[] {
  let matchedHeader: string[] | null = null;
  let matchedRows: unknown[][] | null = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = readSheetAsRows(workbook, sheetName);
    if (!rows.length) continue;
    const header = headerOf(rows);
    if (REQUIRED_COLUMNS.every((column) => header.includes(column))) {
      matchedHeader = header;
      matchedRows = rows;
      break;
    }
  }

  if (!matchedHeader || !matchedRows) {
    const firstSheetName = workbook.SheetNames[0];
    const header = headerOf(readSheetAsRows(workbook, firstSheetName));
    const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
    throw new Error('No encontré una hoja con las columnas requeridas. Faltan: ' + missing.join(', '));
  }

  const header = matchedHeader;
  const rows = matchedRows;

  const columnIndex: Record<string, number> = {};
  REQUIRED_COLUMNS.forEach((column) => {
    columnIndex[column] = header.indexOf(column);
  });
  const totalLoanAmountIndex = header.indexOf(TOTAL_LOAN_AMOUNT_COLUMN);
  const loanProgramIndex = header.indexOf(LOAN_PROGRAM_COLUMN);
  const loanFolderNameIndex = header.indexOf(LOAN_FOLDER_NAME_COLUMN);
  const affinityIndex = header.indexOf(AFFINITY_COLUMN);
  const disbursementDateIndex = header.indexOf(DISBURSEMENT_DATE_COLUMN);

  const result: RawLoanRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const cell = (column: string) => row[columnIndex[column]];

    let totalLoanAmount = 0;
    if (totalLoanAmountIndex >= 0) {
      const raw = row[totalLoanAmountIndex];
      totalLoanAmount =
        typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.-]/g, '')) || 0;
    }

    // Igual patrón que totalLoanAmount arriba: '' si el archivo no trae la
    // columna (índice -1), sin transformar el valor si sí la trae.
    const loanProgram = loanProgramIndex >= 0 ? toRawString(row[loanProgramIndex]) : '';
    const loanFolderName = loanFolderNameIndex >= 0 ? toRawString(row[loanFolderNameIndex]) : '';
    const affinity = affinityIndex >= 0 ? toRawString(row[affinityIndex]) : '';

    // Igual patrón que fundingMonth/completionMonth: fecha convertida a
    // YYYY-MM, null si el archivo no trae la columna (índice -1) o la celda
    // está vacía.
    const disbursementMonth =
      disbursementDateIndex >= 0 ? excelValueToYearMonth(row[disbursementDateIndex]) : null;

    result.push({
      trueOrgId: toRawString(cell('True OrgID')),
      loanOfficer: toRawString(cell('loan_officer')),
      bd: toRawString(cell('BD')),
      b2bLoans: toRawString(cell('B2B Loans')),
      loanInfoChannel: toRawString(cell('loan_info_channel')),
      fileCreationMonth: excelValueToYearMonth(cell('fileCreation')),
      creditReportMonth: excelValueToYearMonth(cell('CreditReport')),
      appDateMonth: excelValueToYearMonth(cell('App_Date')),
      fundingMonth: excelValueToYearMonth(cell('Milestone Date - Funding')),
      completionMonth: excelValueToYearMonth(cell('Milestone Date - Completion')),
      disbursementMonth,
      totalLoanAmount,
      loanNumber: toRawString(cell('loan_number')),
      loanProgram,
      loanFolderName,
      affinity,
    });
  }

  return result;
}
