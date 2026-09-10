/**
 * Verificación de las poblaciones del mes siguiente (Etapa NEXTMONTH-1).
 *
 * Corre el PARSER REAL sobre un export real y arma las poblaciones con las
 * funciones reales. No reimplementa nada: si esto pasa, es la misma cadena
 * que usaría la app.
 *
 *   npx tsx scripts/test-next-month.ts "<ruta al .xlsx>" [YYYY-MM]
 */
import fs from 'node:fs';
import { parseSalesforcePipelineFile } from '../lib/pipeline/sources/salesforce-file';
import { buildNextMonthPopulations, buildNextMonthByBranch, buildNextMonthByStrategy, nextTargetMonth } from '../lib/pipeline/nextMonth';
import type { TargetMonth } from '../lib/pipeline/aggregate';

const file = process.argv[2];
if (!file) throw new Error('falta la ruta del archivo');
const monthArg = process.argv[3];

let forecastMonth: TargetMonth;
if (monthArg) {
  const [y, m] = monthArg.split('-').map(Number);
  forecastMonth = { year: y, month: m };
} else {
  const today = new Date();
  forecastMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };
}
const nextMonth = nextTargetMonth(forecastMonth);
console.log(
  'Forecast Month: ' + forecastMonth.year + '-' + String(forecastMonth.month).padStart(2, '0') +
  '   Mes siguiente: ' + nextMonth.year + '-' + String(nextMonth.month).padStart(2, '0')
);

const parsed = parseSalesforcePipelineFile(fs.readFileSync(file));
console.log('\nparseado: ' + parsed.openLoans.length + ' abiertos');

const populations = buildNextMonthPopulations(parsed.openLoans, forecastMonth);

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

console.log('\n=== poblaciones ===');
console.log(
  '  Est Closing Next Month: ' + String(populations.estClosingNextMonth.length).padStart(4) +
  '   ' + fmtMoney(populations.estClosingNextMonth.reduce((s, l) => s + l.amount, 0))
);
console.log(
  '  Out of Scope:           ' + String(populations.outOfScope.length).padStart(4) +
  '   ' + fmtMoney(populations.outOfScope.reduce((s, l) => s + l.amount, 0))
);
console.log(
  '  Combined:                ' + String(populations.combined.length).padStart(4) +
  '   ' + fmtMoney(populations.combined.reduce((s, l) => s + l.amount, 0))
);

/* ── ¿Las dos poblaciones se solapan? Debería dar CERO con datos reales. ── */
const nextIds = new Set(populations.estClosingNextMonth.map((l) => l.sourceLoanId));
const overlap = populations.outOfScope.filter((l) => nextIds.has(l.sourceLoanId));
console.log('\n=== solapamiento Est Closing Next Month / Out of Scope ===');
console.log('  préstamos en ambas listas: ' + overlap.length + (overlap.length === 0 ? '   -- OK, supuesto de la regla 3 se cumple' : '   ** REVISAR EL SUPUESTO DE LA REGLA 3 **'));
if (overlap.length > 0) {
  for (const l of overlap) console.log('    ' + l.sourceLoanId + '  branch=' + l.branch + '  estClosingDate=' + l.estClosingDate);
}

/* ── Por branch ── */
console.log('\n=== por branch ===');
const byBranch = buildNextMonthByBranch(populations);
console.log('  branch'.padEnd(10) + 'NextMonth (n/$)'.padEnd(24) + 'OutOfScope (n/$)'.padEnd(24) + 'Combined (n/$)');
for (const row of byBranch) {
  console.log(
    '  ' + row.branch.padEnd(8) +
    (row.estClosingNextMonth.count + '/' + fmtMoney(row.estClosingNextMonth.amount)).padEnd(24) +
    (row.outOfScope.count + '/' + fmtMoney(row.outOfScope.amount)).padEnd(24) +
    (row.combined.count + '/' + fmtMoney(row.combined.amount))
  );
}

/* ── Por strategy ── */
console.log('\n=== por strategy ===');
const byStrategy = buildNextMonthByStrategy(populations);
console.log('  strategy'.padEnd(18) + 'NextMonth (n/$)'.padEnd(24) + 'OutOfScope (n/$)'.padEnd(24) + 'Combined (n/$)');
for (const row of byStrategy) {
  console.log(
    '  ' + row.strategy.padEnd(16) +
    (row.estClosingNextMonth.count + '/' + fmtMoney(row.estClosingNextMonth.amount)).padEnd(24) +
    (row.outOfScope.count + '/' + fmtMoney(row.outOfScope.amount)).padEnd(24) +
    (row.combined.count + '/' + fmtMoney(row.combined.amount))
  );
}

/* ── Etapa NEXTMONTH-3: sanity check barato -- .loans.length tiene que
   coincidir con .count en cada celda de cada fila, o algo quedó mal armado
   en summarizeNextMonthCell()/buildNextMonthByBranch()/buildNextMonthByStrategy(). ── */
console.log('\n=== sanity check: row.cell.loans.length === row.cell.count ===');
let cellMismatches = 0;
for (const row of byBranch) {
  for (const [pop, cell] of [
    ['estClosingNextMonth', row.estClosingNextMonth],
    ['outOfScope', row.outOfScope],
    ['combined', row.combined],
  ] as const) {
    if (cell.loans.length !== cell.count) {
      cellMismatches++;
      console.log('  ** MISMATCH ** byBranch branch=' + row.branch + ' pop=' + pop + ' count=' + cell.count + ' loans.length=' + cell.loans.length);
    }
  }
}
for (const row of byStrategy) {
  for (const [pop, cell] of [
    ['estClosingNextMonth', row.estClosingNextMonth],
    ['outOfScope', row.outOfScope],
    ['combined', row.combined],
  ] as const) {
    if (cell.loans.length !== cell.count) {
      cellMismatches++;
      console.log('  ** MISMATCH ** byStrategy strategy=' + row.strategy + ' pop=' + pop + ' count=' + cell.count + ' loans.length=' + cell.loans.length);
    }
  }
}
console.log('  ' + (cellMismatches === 0 ? 'OK -- todas las celdas cuadran' : cellMismatches + ' celdas NO cuadran, revisar'));

/* ── Préstamos sin estClosingDate -- no entran a ninguna población, se listan para bulto. ── */
const sinFecha = parsed.openLoans.filter((l) => l.estClosingDate === null);
console.log('\n=== abiertos sin estClosingDate (excluidos de las 2 poblaciones) ===');
console.log('  total: ' + sinFecha.length + ' de ' + parsed.openLoans.length + ' abiertos');
