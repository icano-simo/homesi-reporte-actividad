export type PipelineLoan = {
  sourceLoanId: string;
  branch: string;
  channel: 'Banked - Retail' | 'Brokered';
  milestone: 'Started' | 'Processing' | 'Underwriting' | 'Closing';
  healthy: boolean | null;
  closeMonth: string;
  amount: number;
  loanOfficer: string;
  rawMilestone: string;
  rawHealthiness: string;
  estClosingDate: string | null;
  /** Etapa F4d: nombre del prestatario, separado de "Opportunity Name" (que trae "Nombre - id"). */
  borrowerName: string;
  /** Etapa F4d: 'YYYY-MM-DD' de "Current Milestone Date"; null si el archivo no trae valor. */
  milestoneDate: string | null;
  /** Etapa F4d: de la columna "Branch Transfer" (1/true -> true). Solo informativo, no afecta branch ni cálculos. */
  branchTransferred: boolean;
};

/**
 * Préstamo ya resuelto (Stage Closed Won / Closed Lost): solo para
 * historial, no entra al cálculo de forecast de aggregate.ts.
 */
export type ResolvedLoan = {
  sourceLoanId: string;
  branch: string;
  channel: PipelineLoan['channel'];
  status: 'funded' | 'adverse';
  /**
   * Etapa F4e: 'YYYY-MM-DD' de "Disbursement Date" (campo correcto, confirmado
   * con datos reales). Si el archivo no trae esa columna (reportes viejos),
   * cae a Est. Closing Date como aproximación -- ver warning explícito que
   * genera el parser en ese caso.
   */
  disbursementDate: string;
  amount: number;
  loanOfficer: string;
  /** Etapa F4d: mismo significado que en PipelineLoan. */
  borrowerName: string;
  milestoneDate: string | null;
  branchTransferred: boolean;
  /**
   * Etapa F4i: de la columna "Loan Status" -- solo presente en reportes muy
   * recientes (no en Formato A ni en reportes B viejos). '' si el archivo no
   * trae la columna. Distingue, dentro de Stage=Closed Lost, cuáles son
   * realmente "Application withdrawn" -- el resto (Application denied, File
   * Closed for incompleteness, etc.) sigue siendo status='adverse' para el
   * resto de la app, pero no entra en la tabla de Adverse (ver AdverseTable).
   */
  loanStatus: string;
  /** Etapa F4i: 'YYYY-MM-DD' de "Est. Closing Date" (mismo campo que ya usa Total/Healthy Pipeline desde F4f) -- null si no hay valor. */
  estClosingDate: string | null;
};
