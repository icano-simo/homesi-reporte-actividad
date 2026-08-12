import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';

/**
 * Préstamo ya interpretado según las reglas de negocio de esta etapa: branch
 * clasificado, loan officer/BD normalizados, B2B Loans como boolean y el
 * closing resuelto según el canal.
 *
 * No introduce ningún concepto de "Estados Finales" del proyecto de
 * Pipeline/Forecast (fuera de alcance aquí): el closing de este módulo es
 * simple, solo tiene fecha o no la tiene.
 */
export interface LoanRecord {
  /** Resultado de classifyBranch, NO el trueOrgId crudo. */
  branch: Branch;
  /** Normalizado: toUpperCase(), o '(blank)' si está vacío. */
  loanOfficer: string;
  /** Normalizado: valor tal cual si no está vacío, o '(blank)'. */
  bd: string;
  /** true si b2bLoans === 'B2B', false en cualquier otro caso. */
  isB2B: boolean;
  /**
   * Valor crudo de RawLoanRow.loanInfoChannel (columna 'loan_info_channel'),
   * SIN normalizar ni mapear -- el mismo string que ya usa classifyLoan()
   * para decidir closingMonth (funding vs completion). Se expone tal cual
   * para poder auditar que un filtro nuevo coincida con esa lógica existente.
   */
  loanInfoChannel: 'Banked - Retail' | 'Brokered' | string;
  fileCreationMonth: YearMonth | null;
  creditReportMonth: YearMonth | null;
  appDateMonth: YearMonth | null;
  /** fundingMonth o completionMonth combinados según el canal (ver classifyLoan). */
  closingMonth: YearMonth | null;
  totalLoanAmount: number;
  /** Columna 'loan_number', valor crudo sin transformar -- id único de préstamo. */
  loanNumber: string;
  /** Columna 'Loan Program' (optional), valor crudo sin transformar. '' si el archivo no la trae. */
  loanProgram: string;
  /** Columna 'Loan Folder Name' (optional), valor crudo sin transformar. '' si el archivo no la trae. */
  loanFolderName: string;
  /**
   * Columna 'Affinity' (optional), valor crudo sin transformar. '' si el
   * archivo no la trae. Ver auditoría de consistencia contra
   * True OrgID==='AFFINITY' (classifyBranch) -- el criterio para el flag
   * `affinity` del modal todavía no está decidido, este campo solo expone
   * el dato crudo.
   */
  affinity: string;
}
