export const REQUIRED_COLUMNS: string[] = [
  'True OrgID',
  'loan_officer',
  'fileCreation',
  'App_Date',
  'CreditReport',
  'loan_info_channel',
  'Milestone Date - Funding',
  'Milestone Date - Completion',
  'B2B Loans',
  'BD',
  // Etapa siguiente al modal de detalle de préstamo: id único, necesario
  // para listar loans individuales sin ambigüedad -- por eso required, a
  // diferencia de las 3 columnas de abajo.
  'loan_number',
];

// El orden importa: workbookReader.ts referencia estos por índice fijo
// (OPTIONAL_COLUMNS[1]/[2]/[3]/[4]), igual que ya hacía con Total Loan Amount
// en el índice 0. Si agregás una columna opcional nueva, agregala al final.
//
// [4] 'CLOSING DOCS REGZ LOAN INFO DISBURSEMENT DATE' -- header exacto
// confirmado por Isabella. Opcional (no REQUIRED_COLUMNS) a propósito: si el
// archivo no la trae, classifyLoan() cae de vuelta a Milestone
// Funding/Completion como mes de Closed (ver lib/domain/classifyLoan.ts) en
// vez de romper el parseo completo de archivos que todavía no la incluyan.
export const OPTIONAL_COLUMNS: string[] = [
  'Total Loan Amount',
  'Loan Program',
  'Loan Folder Name',
  'Affinity',
  'CLOSING DOCS REGZ LOAN INFO DISBURSEMENT DATE',
];
