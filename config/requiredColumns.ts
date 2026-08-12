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

// El orden importa: workbookReader.ts referencia estos 3 por índice fijo
// (OPTIONAL_COLUMNS[1]/[2]/[3]), igual que ya hacía con Total Loan Amount
// en el índice 0. Si agregás una columna opcional nueva, agregala al final.
export const OPTIONAL_COLUMNS: string[] = ['Total Loan Amount', 'Loan Program', 'Loan Folder Name', 'Affinity'];
