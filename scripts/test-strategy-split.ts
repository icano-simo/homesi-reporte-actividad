/**
 * ⚠ EL CHEQUEO MÁS IMPORTANTE DE F6.
 *
 * Que los subtotales por estrategia cuadren EXACTAMENTE con los de por branch,
 * en las dos tablas. Si difieren, hay un préstamo contado dos veces o ninguna.
 *
 * Reproduce la misma cadena que la app: parser real -> misma partición por
 * branch/canal que `page.tsx` -> mismas fórmulas por canal -> `apportionByWeight`
 * para el reparto del entero ya redondeado.
 *
 *   npx tsx scripts/test-strategy-split.ts "<ruta al .xlsx>"
 */
import fs from 'node:fs';
import { parseSalesforcePipelineFile } from '../lib/pipeline/sources/salesforce-file';
import {
  BROKERED_FLAT_PULL_THROUGH_RATE,
  apportionByWeight,
  calculateForecast,
  calculateTotalForecastWithClosed,
  countByMilestoneBucket,
  splitCtcAndClosing,
  splitHealthyTotal,
  type DateRange,
} from '../lib/pipeline/aggregate';
import { STRATEGY_ORDER, classifyStrategy, type Strategy } from '../lib/pipeline/strategy';
import type { PipelineLoan, ResolvedLoan } from '../lib/pipeline/types';

/* Mismas tasas y mismo rango que usa page.tsx para el mes de forecast. */
const RATES = { Started: 0.6668, Processing: 0.7473, Underwriting: 0.8036, Closing: 0.95 };
const file = process.argv[2];
const parsed = parseSalesforcePipelineFile(fs.readFileSync(file));

/* El mes de forecast: el que más cierres estimados tiene, para no depender del reloj. */
const meses = new Map<string, number>();
for (const l of parsed.openLoans) if (l.estClosingDate) meses.set(l.estClosingDate.slice(0, 7), (meses.get(l.estClosingDate.slice(0, 7)) ?? 0) + 1);
const mes = [...meses.entries()].sort((a, b) => b[1] - a[1])[0][0];
const [yy, mm] = mes.split('-').map(Number);
const range: DateRange = {
  startDate: mes + '-01',
  endDate: mes + '-' + String(new Date(yy, mm, 0).getDate()).padStart(2, '0'),
};
console.log('mes de forecast: ' + mes + '  (' + range.startDate + ' .. ' + range.endDate + ')');

const CHANNELS: PipelineLoan['channel'][] = ['Banked - Retail', 'Brokered'];
let fallos = 0;
const totalPorCanal = new Map<string, Record<string, number>>();

for (const channel of CHANNELS) {
  const branches = [...new Set(parsed.openLoans.filter((l) => l.channel === channel).map((l) => l.branch))].sort();
  let subBranch = { total: 0, healthy: 0, closed: 0, proj: 0, fc: 0, ctc: 0, closing: 0 };
  let subStrat = { total: 0, healthy: 0, closed: 0, proj: 0, fc: 0, ctc: 0, closing: 0 };
  const porEstrategia = new Map<Strategy, number>();

  console.log('\n═══ ' + channel + ' ═══');
  console.log('  branch  |  total healthy closed  proj forecast  ||  suma de estrategias        | cuadra');

  for (const branch of branches) {
    const { total, healthy } = splitHealthyTotal(parsed.openLoans, branch, channel, range);
    if (!total.length) continue;
    const closedLoans = parsed.resolvedLoans.filter((l) => l.branch === branch && l.channel === channel);
    const isBanked = channel === 'Banked - Retail';

    /* ── la fila del branch, igual que page.tsx + PivotTable ── */
    const exact = isBanked
      ? calculateForecast(countByMilestoneBucket(healthy), RATES).forecastTotal
      : total.length * BROKERED_FLAT_PULL_THROUGH_RATE;
    const proj = Math.round(exact);
    const { closedCount } = calculateTotalForecastWithClosed(closedLoans, proj, range);
    const fc = closedCount + proj;
    const ctcS = isBanked ? splitCtcAndClosing(healthy) : { ctcCount: 0, closingCount: 0 };

    /* ── el desglose, igual que buildStrategyRows ── */
    const present = new Set<Strategy>(['Own production']);
    for (const l of total) present.add(classifyStrategy(l));
    for (const l of closedLoans) {
      if (l.status === 'funded' && l.disbursementDate >= range.startDate && l.disbursementDate <= range.endDate) {
        present.add(classifyStrategy(l));
      }
    }
    const strategies = STRATEGY_ORDER.filter((st) => present.has(st));
    const per = strategies.map((st) => {
      const ls = total.filter((l) => classifyStrategy(l) === st);
      const hs = ls.filter((l) => l.healthy === true);
      const cs: ResolvedLoan[] = closedLoans.filter((l) => classifyStrategy(l) === st);
      const w = isBanked
        ? calculateForecast(countByMilestoneBucket(hs), RATES).forecastTotal
        : ls.length * BROKERED_FLAT_PULL_THROUGH_RATE;
      const cc = calculateTotalForecastWithClosed(cs, 0, range).closedCount;
      const sp = isBanked ? splitCtcAndClosing(hs) : { ctcCount: 0, closingCount: 0 };
      return { st, total: ls.length, healthy: hs.length, closed: cc, w, ctc: sp.ctcCount, closing: sp.closingCount };
    });
    const parts = apportionByWeight(proj, per.map((r) => r.w));

    const sT = per.reduce((a, r) => a + r.total, 0);
    const sH = per.reduce((a, r) => a + r.healthy, 0);
    const sC = per.reduce((a, r) => a + r.closed, 0);
    const sP = parts.reduce((a, b) => a + b, 0);
    const sF = per.reduce((a, r, i) => a + r.closed + parts[i], 0);
    const sCtc = per.reduce((a, r) => a + r.ctc, 0);
    const sCl = per.reduce((a, r) => a + r.closing, 0);

    const ok = sT === total.length && sH === healthy.length && sC === closedCount && sP === proj && sF === fc
      && sCtc === ctcS.ctcCount && sCl === ctcS.closingCount;
    if (!ok) fallos++;
    console.log('  ' + branch.padEnd(8) + '|' + String(total.length).padStart(6) + String(healthy.length).padStart(8) +
      String(closedCount).padStart(7) + String(proj).padStart(6) + String(fc).padStart(9) +
      '  ||' + String(sT).padStart(6) + String(sH).padStart(8) + String(sC).padStart(7) + String(sP).padStart(6) +
      String(sF).padStart(9) + '  | ' + (ok ? 'si' : '** NO **'));

    subBranch = { total: subBranch.total + total.length, healthy: subBranch.healthy + healthy.length,
      closed: subBranch.closed + closedCount, proj: subBranch.proj + proj, fc: subBranch.fc + fc,
      ctc: subBranch.ctc + ctcS.ctcCount, closing: subBranch.closing + ctcS.closingCount };
    subStrat = { total: subStrat.total + sT, healthy: subStrat.healthy + sH, closed: subStrat.closed + sC,
      proj: subStrat.proj + sP, fc: subStrat.fc + sF, ctc: subStrat.ctc + sCtc, closing: subStrat.closing + sCl };
    per.forEach((r, i) => porEstrategia.set(r.st, (porEstrategia.get(r.st) ?? 0) + r.total + 0 * parts[i]));
  }

  console.log('  ' + '-'.repeat(88));
  const campos: (keyof typeof subBranch)[] = ['total', 'healthy', 'closed', 'proj', 'fc', 'ctc', 'closing'];
  for (const k of campos) {
    const a = subBranch[k], b = subStrat[k];
    if (a !== b) fallos++;
    console.log('  subtotal ' + String(k).padEnd(9) + 'By branch=' + String(a).padStart(6) +
      '   By strategy=' + String(b).padStart(6) + '   ' + (a === b ? 'cuadra' : '** DIFIERE **'));
  }
  totalPorCanal.set(channel, Object.fromEntries([...porEstrategia].map(([k, v]) => [k, v])));
}

console.log('\n=== total pipeline por estrategia y canal (abiertos del mes) ===');
for (const [ch, d] of totalPorCanal) console.log('  ' + ch.padEnd(16) + JSON.stringify(d));

console.log('\nRESULTADO: ' + (fallos === 0 ? 'todos los subtotales cuadran' : fallos + ' DIFERENCIAS'));
