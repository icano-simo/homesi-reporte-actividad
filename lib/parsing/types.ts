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
  /**
   * Columna opcional 'CLOSING DOCS REGZ LOAN INFO DISBURSEMENT DATE'
   * convertida a YYYY-MM. `null` si el archivo no la trae o la celda está
   * vacía. Determina el MES de Closed cuando el loan ya llegó a su milestone
   * de cierre (Funding para Banked, Completion para Brokered) -- ver
   * classifyLoan(). Por sí sola NO implica que el loan esté Closed (un loan
   * puede tener Disbursement Date y seguir en Started).
   */
  disbursementMonth: YearMonth | null;
  /** Columna 'Total Loan Amount'; 0 si la columna está ausente o no es numérica. */
  totalLoanAmount: number;
  /** Columna 'loan_number', valor crudo -- id único de préstamo (required). */
  loanNumber: string;
  /** Columna 'Loan Program' (optional), valor crudo. '' si el archivo no la trae. */
  loanProgram: string;
  /** Columna 'Loan Folder Name' (optional), valor crudo. '' si el archivo no la trae. */
  loanFolderName: string;
  /** Columna 'Affinity' (optional), valor crudo. '' si el archivo no la trae. */
  affinity: string;
  /**
   * Columna opcional 'HELOC LIEN POSITION', valor numérico tal cual (1 o 2
   * en los datos reales vistos). `null` si el archivo no trae la columna o
   * la celda está vacía -- no se asume ningún valor por defecto. Usada
   * exclusivamente por lib/domain/isHelocLien2.ts para decidir exclusión
   * (regla confirmada por Isabella); no se transforma ni normaliza acá.
   */
  helocLienPosition: number | null;
}
