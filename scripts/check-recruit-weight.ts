/*
 * ⚠ ¿EL PRESUPUESTO DE UN RECLUTA ENTRA AL PESO DE SU ESTRATEGIA?
 *
 * `projectBranch` suma los reclutas al total del branch. `exactoDe` produce el
 * PESO con el que ese total se reparte entre las estrategias. Si el peso no los
 * incluye, el excedente se reparte entre las OTRAS estrategias y la de ellos
 * queda corta -- en silencio, porque `apportionByWeight` siempre hace que las
 * partes sumen el total.
 *
 * Hoy no se puede ver en la pantalla: los 15 reclutas tienen `monthlyBenchmark`
 * en null, así que ninguno proyecta y el excedente es cero. Y no se puede probar
 * escribiendo un benchmark de prueba: `outlook.recruitment_projection` no tiene
 * policy de DELETE, así que una fila de prueba se queda para siempre.
 *
 * Por eso se prueba sobre las funciones PURAS con un branch sintético.
 *
 *   npx tsx scripts/check-recruit-weight.ts
 */
import { exactoDe } from '../lib/outlook/strategyRows';
import { projectBranch, type BranchStrategy, type OutlookBranch } from '../lib/outlook/loadData';

const MESES = ['2026-10', '2026-11', '2026-12'];

/** Una estrategia vacía a la que sólo se le cambia lo que el caso necesita. */
function estrategia(over: Partial<BranchStrategy>): BranchStrategy {
  return {
    strategy: 'Recruitment',
    ytd: 0,
    actualByMonth: {},
    opensBy: 'loanOfficer',
    realtors: [],
    owners: [],
    recruits: [],
    currentMonthRaw: 0,
    mode: 'growth',
    benchmarkSchedule: [],
    benchmarkAtDisplay: 0,
    rules: [],
    targets: {},
    targetRevision: 0,
    ruleRevision: 0,
    ...over,
  } as BranchStrategy;
}

const recluta = {
  identity: 'future:test',
  personName: 'Prueba',
  role: 'loan_officer' as const,
  branchCodeActual: 'X',
  nmls: null,
  stage: 'in_hiring' as const,
  startDate: null,
  closeDate: null,
  producingFrom: '2026-10',
  monthlyBenchmark: 4,
  linkedEmployeeKey: null,
  linkedByNmls: false,
  /* Ya rampado: 1, 2 y 4 con la rampa 25/50/100 sobre un benchmark de 4. */
  byMonth: { '2026-10': 1, '2026-11': 2, '2026-12': 4 },
  notProjecting: null,
};

const branch = {
  branchCode: 'X',
  ytd: 0,
  actualByMonth: {},
  currentMonth: 0,
  closedToDate: 0,
  unattributed: 0,
  outOfDivision: [],
  isInactive: false,
  closedByOutsiders: 0,
  outsiders: [],
  loanOfficers: [],
  byStrategy: [estrategia({ strategy: 'Recruitment', recruits: [recluta] })],
} as unknown as OutlookBranch;

const total = projectBranch(branch, MESES);
const peso = exactoDe(branch, branch.byStrategy[0], MESES);

console.log('un branch con UN recluta que proyecta 1 / 2 / 4:');
console.log('  projectBranch (el total del branch): ', JSON.stringify(total));
console.log('  exactoDe       (el peso de su fila): ', JSON.stringify(peso));

const sumaTotal = MESES.reduce((a, m) => a + (total[m] ?? 0), 0);
const sumaPeso = MESES.reduce((a, m) => a + (peso[m] ?? 0), 0);
console.log('\n  total=' + sumaTotal + '  peso=' + sumaPeso);
if (sumaTotal === sumaPeso) {
  console.log('  OK   el peso incluye al recluta: el reparto le da lo suyo.');
} else {
  console.log('  ** CONFIRMADO ** el total lo cuenta y el peso no.');
  console.log('  Consecuencia: ' + (sumaTotal - sumaPeso) + ' prestamos que el branch suma');
  console.log('  se reparten entre las OTRAS estrategias, y la de el queda corta.');
  console.log('  Invisible hoy porque los 15 reclutas tienen benchmark null.');
}
