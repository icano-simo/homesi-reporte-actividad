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
  closeDate: string;
  amount: number;
  loanOfficer: string;
};
