// Script temporal de verificación de la Etapa F3 (salesforce-file.ts).
// NO es parte de la app final.
import { readFileSync } from 'node:fs';
import { parseSalesforcePipelineFile } from '../lib/pipeline/sources/salesforce-file';
import type { PipelineLoan } from '../lib/pipeline/types';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('uso: tsx scripts/test-parser.ts <archivo1.xlsx> [archivo2.xls ...]');
  process.exit(1);
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

for (const filePath of files) {
  console.log('\n' + '='.repeat(70));
  console.log('ARCHIVO:', filePath);
  console.log('='.repeat(70));

  const buffer = readFileSync(filePath);
  const result = parseSalesforcePipelineFile(buffer);

  console.log('formatDetected:', result.formatDetected);
  console.log('openLoans:', result.openLoans.length);
  console.log('resolvedLoans:', result.resolvedLoans.length);

  console.log('\nopenLoans por bucket de milestone:');
  console.log(countBy(result.openLoans, (l) => l.milestone));

  console.log('\nresolvedLoans por status:');
  console.log(countBy(result.resolvedLoans, (l) => l.status));

  console.log('\nopenLoans por branch:');
  console.log(countBy(result.openLoans, (l) => l.branch));

  console.log('\nopenLoans por channel:');
  console.log(countBy(result.openLoans, (l) => l.channel));

  const healthyCount = result.openLoans.filter((l: PipelineLoan) => l.healthy === true).length;
  console.log('\nopenLoans healthy===true:', healthyCount, 'de', result.openLoans.length);

  console.log('\nwarnings (' + result.warnings.length + '):');
  result.warnings.forEach((w, i) => console.log('  ' + (i + 1) + '.', w));

  console.log('\nejemplo de openLoan[0]:', JSON.stringify(result.openLoans[0], null, 2));
  if (result.resolvedLoans.length) {
    console.log('\nejemplo de resolvedLoan[0]:', JSON.stringify(result.resolvedLoans[0], null, 2));
  }
}
