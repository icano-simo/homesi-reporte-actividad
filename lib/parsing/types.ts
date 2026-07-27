/** Mes en formato 'YYYY-MM'. Documenta la intención de los campos de mes. */
export type YearMonth = string;

/**
 * Fila cruda del Excel de actividad, tal como viene sin interpretar: sin
 * clasificar el branch, sin decidir cuál milestone es el closing y sin
 * normalizar loan officer / BD. Esas son reglas de negocio (Etapa 4).
 */
export interface RawLoanRow {
  /** Columna 'True OrgID', valor crudo sin clasificar contra el roster. */
  trueOrgId: string;
  /** Columna 'loan_officer', valor crudo sin uppercase. */
  loanOfficer: string;
  /** Columna 'BD', valor crudo. */
  bd: string;
  /** Columna 'B2B Loans', valor crudo (NO convertido a boolean). */
  b2bLoans: string;
  /** Columna 'loan_info_channel', valor crudo. */
  loanInfoChannel: string;
  /** Columna 'fileCreation' convertida a YYYY-MM. */
  fileCreationMonth: YearMonth | null;
  /** Columna 'CreditReport' convertida a YYYY-MM. */
  creditReportMonth: YearMonth | null;
  /** Columna 'App_Date' convertida a YYYY-MM. */
  appDateMonth: YearMonth | null;
  /** Columna 'Milestone Date - Funding' convertida a YYYY-MM. */
  fundingMonth: YearMonth | null;
  /** Columna 'Milestone Date - Completion' convertida a YYYY-MM. */
  completionMonth: YearMonth | null;
  /** Columna 'Total Loan Amount'; 0 si la columna está ausente o no es numérica. */
  totalLoanAmount: number;
}
