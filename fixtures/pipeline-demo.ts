import type { PipelineLoan } from '@/lib/pipeline/types';
import type { PullThroughRates } from '@/lib/pipeline/aggregate';

/**
 * Datos de ejemplo para construir la UI del Forecast sin conectar el parser
 * real ni Supabase todavía. El grupo branch '716' / 'Banked - Retail' usa
 * los números REALES ya validados contra Summary SL en la Etapa F2 (Started
 * 3/1 healthy, Processing 0, Underwriting 33/22, Closing 8/8). Los demás
 * branches son inventados pero con proporciones healthy/total plausibles,
 * solo para que la tabla no se vea vacía con un solo grupo.
 */

let nextId = 1;
function makeLoan(
  branch: string,
  channel: PipelineLoan['channel'],
  milestone: PipelineLoan['milestone'],
  healthy: boolean,
  amount: number,
  loanOfficer: string
): PipelineLoan {
  return {
    sourceLoanId: 'DEMO-' + String(nextId++).padStart(4, '0'),
    branch,
    channel,
    milestone,
    healthy,
    closeMonth: '2026-08',
    amount,
    loanOfficer,
    rawMilestone: milestone,
    rawHealthiness: healthy ? 'On Track' : 'Delayed',
    estClosingDate: '2026-08-31',
    borrowerName: 'Demo Borrower',
    milestoneDate: '2026-08-01',
    branchTransferred: false,
    loanType: '',
    loanProgram: '',
    noteHistory: '',
    // Etapa F6: los cinco crudos de la estrategia. Vacios en el fixture -- no
    // se prueba la clasificacion aca (eso vive en scripts/test-strategy.ts).
    strategyRaw: '',
    opportunityOwnerTitle: '',
    nppmRealtor: '',
    referredBy: '',
    affinityProgram: '',
  };
}

function makeBucket(
  branch: string,
  channel: PipelineLoan['channel'],
  milestone: PipelineLoan['milestone'],
  total: number,
  healthyCount: number,
  amountEach: number,
  officers: string[]
): PipelineLoan[] {
  const loans: PipelineLoan[] = [];
  for (let i = 0; i < healthyCount; i++) loans.push(makeLoan(branch, channel, milestone, true, amountEach, officers[i % officers.length]));
  for (let i = 0; i < total - healthyCount; i++) loans.push(makeLoan(branch, channel, milestone, false, amountEach, officers[i % officers.length]));
  return loans;
}

const OFFICERS_716 = ['NATHAN MARTINEZ', 'MONICA FERNANDEZ', 'ADRIANA CERVANTES'];
const OFFICERS_747 = ['STEVE BADOVINAC', 'ISA VASQUEZ'];
const OFFICERS_760 = ['CRISTHIAN A RAMIREZ'];
const OFFICERS_703 = ['KIANA SMITH', 'EDUARDO NUNEZ VILLEGAS'];

export const DEMO_LOANS: PipelineLoan[] = [
  // branch 716, Banked - Retail -- números reales validados en la Etapa F2.
  ...makeBucket('716', 'Banked - Retail', 'Started', 3, 1, 410000, OFFICERS_716),
  ...makeBucket('716', 'Banked - Retail', 'Processing', 0, 0, 0, OFFICERS_716),
  ...makeBucket('716', 'Banked - Retail', 'Underwriting', 33, 22, 375000, OFFICERS_716),
  ...makeBucket('716', 'Banked - Retail', 'Closing', 8, 8, 420000, OFFICERS_716),

  // branch 747, Banked - Retail -- inventado, plausible.
  ...makeBucket('747', 'Banked - Retail', 'Started', 5, 3, 350000, OFFICERS_747),
  ...makeBucket('747', 'Banked - Retail', 'Processing', 2, 2, 340000, OFFICERS_747),
  ...makeBucket('747', 'Banked - Retail', 'Underwriting', 18, 14, 360000, OFFICERS_747),
  ...makeBucket('747', 'Banked - Retail', 'Closing', 4, 4, 355000, OFFICERS_747),

  // branch 760, Banked - Retail -- inventado, plausible.
  ...makeBucket('760', 'Banked - Retail', 'Started', 2, 0, 330000, OFFICERS_760),
  ...makeBucket('760', 'Banked - Retail', 'Processing', 1, 1, 328000, OFFICERS_760),
  ...makeBucket('760', 'Banked - Retail', 'Underwriting', 12, 9, 331000, OFFICERS_760),
  ...makeBucket('760', 'Banked - Retail', 'Closing', 3, 2, 329000, OFFICERS_760),

  // branch 703, Brokered -- inventado, plausible (canal distinto para variedad).
  ...makeBucket('703', 'Brokered', 'Started', 1, 1, 260000, OFFICERS_703),
  ...makeBucket('703', 'Brokered', 'Processing', 0, 0, 0, OFFICERS_703),
  ...makeBucket('703', 'Brokered', 'Underwriting', 6, 4, 270000, OFFICERS_703),
  ...makeBucket('703', 'Brokered', 'Closing', 2, 2, 265000, OFFICERS_703),
];

/** Mismas tasas usadas y validadas en la Etapa F2. */
export const DEMO_RATES: PullThroughRates = {
  Started: 0.8923,
  Processing: 0.93,
  Underwriting: 0.8459,
  Closing: 0.95,
};
