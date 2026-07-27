import type { RawLoanRow } from '@/lib/parsing/types';
import { classifyBranch } from './classifyBranch';
import type { LoanRecord } from './types';

/**
 * Compone las reglas de negocio de esta etapa sobre un RawLoanRow: branch,
 * normalización de loan officer/BD, B2B Loans como boolean y closing según
 * el canal (equivalente a la variable `cl` del legacy).
 *
 * El closing de esta etapa es simple: tiene fecha o no la tiene, sin
 * distinguir la razón de ausencia. No agrega ningún otro estado -- eso
 * pertenece al proyecto de Pipeline/Forecast, fuera de alcance aquí.
 */
export function classifyLoan(raw: RawLoanRow): LoanRecord {
  const loanOfficer = raw.loanOfficer.trim();
  const bd = raw.bd.trim();

  let closingMonth: LoanRecord['closingMonth'] = null;
  if (raw.loanInfoChannel === 'Banked - Retail') {
    closingMonth = raw.fundingMonth;
  } else if (raw.loanInfoChannel === 'Brokered') {
    closingMonth = raw.completionMonth;
  }

  return {
    branch: classifyBranch(raw.trueOrgId),
    loanOfficer: loanOfficer ? loanOfficer.toUpperCase() : '(blank)',
    bd: bd ? bd : '(blank)',
    isB2B: raw.b2bLoans.trim() === 'B2B',
    fileCreationMonth: raw.fileCreationMonth,
    creditReportMonth: raw.creditReportMonth,
    appDateMonth: raw.appDateMonth,
    closingMonth,
    totalLoanAmount: raw.totalLoanAmount,
  };
}
