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
