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
  fileCreationMonth: YearMonth | null;
  creditReportMonth: YearMonth | null;
  appDateMonth: YearMonth | null;
  /** fundingMonth o completionMonth combinados según el canal (ver classifyLoan). */
  closingMonth: YearMonth | null;
  totalLoanAmount: number;
}
