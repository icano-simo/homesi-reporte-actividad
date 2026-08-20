// Script de verificación de la Etapa S1 (lib/pipeline/dataAsOf.ts).
// NO es parte del cálculo de la app -- mismo patrón que scripts/test-aggregate.ts
// y scripts/test-parser.ts: los 9 primeros casos son reales de producción
// (docs/ARQUITECTURA.md / brief S1), verificados contra `pipeline_snapshots`.
import { parseDataAsOf } from '../lib/pipeline/dataAsOf';

interface Case {
  fileName: string;
  expectedIso: string | null;
  expectedSource: 'filename_epoch' | 'filename_label' | 'unknown';
  note?: string;
}

const CASES: Case[] = [
  { fileName: 'report1786543113200.xls', expectedIso: '2026-08-12T13:58:33.200Z', expectedSource: 'filename_epoch' },
  { fileName: 'report1786457438427.xls', expectedIso: '2026-08-11T14:10:38.427Z', expectedSource: 'filename_epoch' },
  { fileName: 'report1785525743615.xls', expectedIso: '2026-07-31T19:22:23.615Z', expectedSource: 'filename_epoch' },
  { fileName: 'report1786108835628.xls', expectedIso: '2026-08-07T13:20:35.628Z', expectedSource: 'filename_epoch' },
  {
    fileName: 'Forecast - Pipeline Report-2026-08-10-11-09-42 (1).xlsx',
    expectedIso: '2026-08-10T16:09:42.000Z',
    expectedSource: 'filename_label',
  },
  {
    fileName: 'Forecast - Pipeline Report-2026-08-11-16-00-03.xlsx',
    expectedIso: '2026-08-11T21:00:03.000Z',
    expectedSource: 'filename_label',
  },
  {
    fileName: 'Forecast - Pipeline Report-2026-08-03-10-55-22.xlsx',
    expectedIso: '2026-08-03T15:55:22.000Z',
    expectedSource: 'filename_label',
  },
  {
    fileName: 'Forecast - Pipeline Report-2026-07-30-10-51-51.xlsx',
    expectedIso: '2026-07-30T15:51:51.000Z',
    expectedSource: 'filename_label',
  },
  { fileName: 'pipeline.xlsx', expectedIso: null, expectedSource: 'unknown' },
  {
    // Sintético -- no hay archivo real de invierno todavía (brief S1). Enero
    // cae en CST (UTC-6), a diferencia de los 4 casos filename_label de
    // arriba (todos CDT, UTC-5). Valor derivado por regla: 09:00:00 local
    // Chicago en enero + 6h = 15:00:00 UTC.
    fileName: 'Forecast - Pipeline Report-2026-01-15-09-00-00.xlsx',
    expectedIso: '2026-01-15T15:00:00.000Z',
    expectedSource: 'filename_label',
    note: 'sintético (CST, sin archivo real de invierno todavía)',
  },
];

let allPass = true;

console.log('caso'.padEnd(58), 'esperado'.padEnd(26), 'obtenido'.padEnd(26), 'source esperado'.padEnd(17), 'source obtenido');
for (const c of CASES) {
  const { dataAsOf, source } = parseDataAsOf(c.fileName);
  const obtainedIso = dataAsOf ? dataAsOf.toISOString() : null;
  const isoMatch = obtainedIso === c.expectedIso;
  const sourceMatch = source === c.expectedSource;
  const pass = isoMatch && sourceMatch;
  if (!pass) allPass = false;

  console.log(
    c.fileName.padEnd(58),
    String(c.expectedIso).padEnd(26),
    String(obtainedIso).padEnd(26),
    c.expectedSource.padEnd(17),
    source,
    pass ? 'PASS' : 'FAIL',
    c.note ? `(${c.note})` : ''
  );
}

console.log('\nTodos los casos pasan:', allPass ? 'SI' : 'NO');
if (!allPass) process.exit(1);
