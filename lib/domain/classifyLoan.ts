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

  // Regla de negocio confirmada por Isabella (consistencia con Salesforce):
  // 1. SI cuenta como Closed sigue decidiéndolo el milestone del canal
  //    (Funding para Banked-Retail, Completion para Brokered) -- un loan sin
  //    ese milestone NO es Closed, tenga o no Disbursement Date (caso C: un
  //    loan puede tener Disbursement Date y seguir en Started).
  // 2. QUÉ MES de Closed sí cambia: si el loan ya cumplió su milestone,
  //    Disbursement Date manda sobre Funding/Completion cuando está presente
  //    (caso A). Si el milestone se cumplió pero el archivo no trae
  //    Disbursement Date para esa fila (caso B), se conserva el mes de
  //    Funding/Completion tal como antes -- alternativa conservadora, no se
  //    inventa una regla nueva para ese caso.
  let closingMonth: LoanRecord['closingMonth'] = null;
  if (raw.loanInfoChannel === 'Banked - Retail' && raw.fundingMonth) {
    closingMonth = raw.disbursementMonth ?? raw.fundingMonth;
  } else if (raw.loanInfoChannel === 'Brokered' && raw.completionMonth) {
    closingMonth = raw.disbursementMonth ?? raw.completionMonth;
  }

  return {
    branch: classifyBranch(raw.trueOrgId),
    loanOfficer: loanOfficer ? loanOfficer.toUpperCase() : '(blank)',
    bd: bd ? bd : '(blank)',
    isB2B: raw.b2bLoans.trim() === 'B2B',
    // Mismo valor crudo (sin trim ni normalizar) que se usó arriba para
    // decidir closingMonth -- se expone tal cual, ver comentario en types.ts.
    loanInfoChannel: raw.loanInfoChannel,
    fileCreationMonth: raw.fileCreationMonth,
    creditReportMonth: raw.creditReportMonth,
    appDateMonth: raw.appDateMonth,
    closingMonth,
    totalLoanAmount: raw.totalLoanAmount,
    // Los 4 campos de abajo van tal cual, sin transformar (ver RawLoanRow).
    loanNumber: raw.loanNumber,
    loanProgram: raw.loanProgram,
    loanFolderName: raw.loanFolderName,
    affinity: raw.affinity,
  };
}
