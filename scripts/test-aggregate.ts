// Script temporal de verificación de la Etapa F1 (aggregate.ts).
// NO es parte de la app final -- fixture escrito a mano con los números
// reales de Summary SL (Pipeline_SL_CL.xlsx).
import type { PipelineLoan } from '../lib/pipeline/types';
import { buildPipelineForecast } from '../lib/pipeline/aggregate';

let nextId = 1;
function makeLoan(
  branch: string,
  channel: PipelineLoan['channel'],
  milestone: PipelineLoan['milestone'],
  healthy: boolean
): PipelineLoan {
  return {
    sourceLoanId: 'TEST-' + nextId++,
    branch,
    channel,
    milestone,
    healthy,
    closeMonth: '2026-08',
    amount: 0,
    loanOfficer: 'TEST OFFICER',
    rawMilestone: milestone,
    rawHealthiness: healthy ? 'Healthy' : 'Unhealthy',
    estClosingDate: '2026-08-15',
    borrowerName: 'TEST BORROWER',
    milestoneDate: null,
    branchTransferred: false,
  };
}

// Etapa F5e: splitHealthyTotal/buildPipelineForecast volvieron a recibir un
// DateRange completo (F5c los había cambiado a un string de fin de mes,
// revertido) -- este rango cubre el mes que ya usaban los fixtures de abajo
// (closeMonth/estClosingDate '2026-08'), así que los resultados esperados
// (comentados junto a cada caso) no cambian.
const TEST_DATE_RANGE = { startDate: '2026-08-01', endDate: '2026-08-31' };

function makeBucket(
  branch: string,
  channel: PipelineLoan['channel'],
  milestone: PipelineLoan['milestone'],
  total: number,
  healthyCount: number
): PipelineLoan[] {
  const loans: PipelineLoan[] = [];
  for (let i = 0; i < healthyCount; i++) loans.push(makeLoan(branch, channel, milestone, true));
  for (let i = 0; i < total - healthyCount; i++) loans.push(makeLoan(branch, channel, milestone, false));
  return loans;
}

// ============================================================
// Caso 1: branch 716, Banked - Retail (ya pasó, sin modificar)
// ============================================================
const CASE1_BRANCH = '716';
const CASE1_CHANNEL: PipelineLoan['channel'] = 'Banked - Retail';

const case1Loans: PipelineLoan[] = [
  ...makeBucket(CASE1_BRANCH, CASE1_CHANNEL, 'Started', 3, 1),
  ...makeBucket(CASE1_BRANCH, CASE1_CHANNEL, 'Processing', 0, 0),
  ...makeBucket(CASE1_BRANCH, CASE1_CHANNEL, 'Underwriting', 33, 22),
  ...makeBucket(CASE1_BRANCH, CASE1_CHANNEL, 'Closing', 8, 8),
];

const rates = {
  Started: 0.8923,
  Processing: 0.93,
  Underwriting: 0.8459,
  Closing: 0.95,
};

const case1Result = buildPipelineForecast(case1Loans, CASE1_BRANCH, CASE1_CHANNEL, rates, TEST_DATE_RANGE);

console.log('=== Caso 1: buildPipelineForecast (branch 716, Banked - Retail) ===');
console.log(JSON.stringify(case1Result, null, 2));

console.log('\n=== Caso 1: chequeo contra el resultado esperado ===');
console.log('totalCount:', case1Result.totalCount, '(esperado 44)');
console.log('healthyCount:', case1Result.healthyCount, '(esperado 31)');
console.log('forecastByBucket.Started:', case1Result.forecastByBucket.Started, '(esperado ~0.6668)');
console.log('forecastByBucket.Underwriting:', case1Result.forecastByBucket.Underwriting, '(esperado ~17.68)');
console.log('forecastByBucket.Closing:', case1Result.forecastByBucket.Closing, '(esperado ~7.6)');
console.log('forecastTotal:', case1Result.forecastTotal, '(esperado ~25.95)');

// ============================================================
// Caso 2: branch 747, Banked - Retail, bucket Processing
// 5 total, 3 healthy. A mano: 3 x 0.93 x 0.8459 x 0.95 = 2.24205795
// ============================================================
const CASE2_BRANCH = '747';
const CASE2_CHANNEL: PipelineLoan['channel'] = 'Banked - Retail';

const case2Loans: PipelineLoan[] = [...makeBucket(CASE2_BRANCH, CASE2_CHANNEL, 'Processing', 5, 3)];

const case2Result = buildPipelineForecast(case2Loans, CASE2_BRANCH, CASE2_CHANNEL, rates, TEST_DATE_RANGE);

const expectedCase2Processing = 3 * rates.Processing * rates.Underwriting * rates.Closing;

console.log('\n\n=== Caso 2: buildPipelineForecast (branch 747, Banked - Retail, Processing) ===');
console.log(JSON.stringify(case2Result, null, 2));
console.log('\n=== Caso 2: chequeo contra el cálculo a mano ===');
console.log('forecastByBucket.Processing (código):', case2Result.forecastByBucket.Processing);
console.log('forecastByBucket.Processing (a mano, 3 x 0.93 x 0.8459 x 0.95):', expectedCase2Processing);
console.log('coinciden:', case2Result.forecastByBucket.Processing === expectedCase2Processing);

// ============================================================
// Caso 3: branch 703, Brokered, bucket Closing -- 4 total, 4 healthy.
// Se agregan también préstamos Banked - Retail en el MISMO branch 703
// para confirmar que splitHealthyTotal no los mezcla con los Brokered.
// A mano: 4 x 0.95 = 3.8
// ============================================================
const CASE3_BRANCH = '703';
const CASE3_CHANNEL_BROKERED: PipelineLoan['channel'] = 'Brokered';
const CASE3_CHANNEL_BANKED: PipelineLoan['channel'] = 'Banked - Retail';

const case3Loans: PipelineLoan[] = [
  ...makeBucket(CASE3_BRANCH, CASE3_CHANNEL_BROKERED, 'Closing', 4, 4),
  // Ruido: mismo branch, canal distinto -- no debe contarse en el resultado de abajo.
  ...makeBucket(CASE3_BRANCH, CASE3_CHANNEL_BANKED, 'Started', 6, 2),
  ...makeBucket(CASE3_BRANCH, CASE3_CHANNEL_BANKED, 'Closing', 2, 2),
];

const case3Result = buildPipelineForecast(case3Loans, CASE3_BRANCH, CASE3_CHANNEL_BROKERED, rates, TEST_DATE_RANGE);

const expectedCase3Closing = 4 * rates.Closing;

console.log('\n\n=== Caso 3: buildPipelineForecast (branch 703, Brokered, Closing) ===');
console.log(JSON.stringify(case3Result, null, 2));
console.log('\n=== Caso 3: chequeo contra el cálculo a mano ===');
console.log('totalCount (código):', case3Result.totalCount, '(esperado 4 -- NO debe incluir los 8 préstamos Banked del mismo branch)');
console.log('forecastByBucket.Closing (código):', case3Result.forecastByBucket.Closing);
console.log('forecastByBucket.Closing (a mano, 4 x 0.95):', expectedCase3Closing);
console.log('coinciden:', case3Result.forecastByBucket.Closing === expectedCase3Closing);
