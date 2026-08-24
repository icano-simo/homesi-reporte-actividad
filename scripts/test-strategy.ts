/**
 * Verificación de la clasificación por estrategia (Etapa F6).
 *
 * Corre el PARSER REAL sobre un export real y clasifica con la función real.
 * No reimplementa nada: si esto pasa, es la misma cadena que usa la app.
 *
 *   npx tsx scripts/test-strategy.ts "<ruta al .xlsx>"
 */
import fs from 'node:fs';
import { parseSalesforcePipelineFile } from '../lib/pipeline/sources/salesforce-file';
import { classifyStrategy, groupByStrategy, nppmRealtors, STRATEGY_ORDER, RECRUITMENT_BRANCHES, type Strategy } from '../lib/pipeline/strategy';

const file = process.argv[2];
if (!file) throw new Error('falta la ruta del archivo');
const parsed = parseSalesforcePipelineFile(fs.readFileSync(file));
/* Las dos mitades: el universo del archivo son los abiertos + los resueltos. */
const all = [...parsed.openLoans, ...parsed.resolvedLoans];
console.log('parseado: ' + parsed.openLoans.length + ' abiertos + ' + parsed.resolvedLoans.length +
  ' resueltos = ' + all.length + ' préstamos');

/* ── 1. Distribución ── */
const dist = new Map<Strategy, number>();
for (const l of all) dist.set(classifyStrategy(l), (dist.get(classifyStrategy(l)) ?? 0) + 1);
console.log('\n=== distribución ===');
let suma = 0;
for (const s of STRATEGY_ORDER) {
  const n = dist.get(s) ?? 0;
  suma += n;
  console.log('  ' + s.padEnd(16) + String(n).padStart(4));
}
const okSuma = suma === all.length;
console.log('  ' + 'SUMA'.padEnd(16) + String(suma).padStart(4) + (okSuma ? '   = total, exacto' : '   ** NO CUADRA **'));

/* ── 2. NPPM no cae en B2B ── */
const nppmRaw = all.filter((l) => l.strategyRaw === 'NPPM');
const nppmBD = nppmRaw.filter((l) => l.opportunityOwnerTitle === 'Business Developer');
console.log('\n=== NPPM vs B2B ===');
console.log('  Strategy="NPPM": ' + nppmRaw.length + '   de esos con title="Business Developer": ' + nppmBD.length);
console.log('  clasificados NPPM: ' + nppmRaw.filter((l) => classifyStrategy(l) === 'NPPM').length +
  '   clasificados B2B: ' + nppmRaw.filter((l) => classifyStrategy(l) === 'B2B').length);

/* ── 3. Recruitment gana sobre "B2B Strategy" ── */
const recB2B = all.filter((l) => RECRUITMENT_BRANCHES.has(l.branch) && l.strategyRaw === 'B2B Strategy');
console.log('\n=== Recruitment vs "B2B Strategy" ===');
console.log('  en 710/711/777 con Strategy="B2B Strategy": ' + recB2B.length);
console.log('  clasificados Recruitment: ' + recB2B.filter((l) => classifyStrategy(l) === 'Recruitment').length +
  '   como B2B: ' + recB2B.filter((l) => classifyStrategy(l) === 'B2B').length);

/* ── 4. Poblaciones distintas ── */
const sB2B = all.filter((l) => l.strategyRaw === 'B2B Strategy').length;
const tBD = all.filter((l) => l.opportunityOwnerTitle === 'Business Developer').length;
const ambas = all.filter((l) => l.strategyRaw === 'B2B Strategy' && l.opportunityOwnerTitle === 'Business Developer').length;
console.log('\n=== la columna Strategy NO define B2B ===');
console.log('  Strategy="B2B Strategy": ' + sB2B + '   title="Business Developer": ' + tBD + '   en ambas: ' + ambas);

/* ── 5. Own production siempre presente ── */
console.log('\n=== Own production aparece siempre, las de cero no ===');
const conCero = groupByStrategy(all.filter((l) => l.branch === 'Affinity'));
console.log('  branch Affinity -> ' + conCero.map((g) => g.strategy + '(' + g.loans.length + ')').join(', '));

/* ── 6. Los cuatro casos del realtor NPPM ── */
console.log('\n=== realtor NPPM: los cuatro casos ===');
const nppm = all.filter((l) => classifyStrategy(l) === 'NPPM');
const casos = { iguales: [] as string[], distintos: [] as string[], soloUno: [] as string[], ninguno: [] as string[] };
for (const l of nppm) {
  const a = l.nppmRealtor.trim(), b = l.referredBy.trim();
  const key = a !== '' && b !== '' ? (a === b ? 'iguales' : 'distintos') : a !== '' || b !== '' ? 'soloUno' : 'ninguno';
  casos[key].push(l.sourceLoanId);
}
for (const [k, v] of Object.entries(casos)) {
  console.log('  ' + k.padEnd(10) + String(v.length).padStart(3) + (v.length ? '   ej. ' + v[0] : ''));
  const ej = nppm.find((l) => l.sourceLoanId === v[0]);
  if (ej) console.log('             nppmRealtors() -> ' + JSON.stringify(nppmRealtors(ej)));
}
console.log('\nRESULTADO: ' + (okSuma ? 'la suma cuadra' : 'LA SUMA NO CUADRA'));
