import type { YearMonth } from '@/lib/parsing/types';
import type { LoanRecord } from '@/lib/domain/types';
import { METRICS, MONTH_NAMES } from '@/config/metrics';
import { METRIC_MONTH_FIELD } from './metricMaps';

/**
 * Port de contiguous() del legacy: genera la secuencia de meses contigua
 * entre minYM y maxYM (inclusive), rellenando los meses sin actividad.
 */
export function contiguous(minYM: YearMonth | null, maxYM: YearMonth | null): YearMonth[] {
  if (!minYM || !maxYM) return [];
  const out: YearMonth[] = [];
  let [y, m] = minYM.split('-').map(Number);
  const [endY, endM] = maxYM.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Port de ymLabel() del legacy: "Aug '25". */
export function ymLabel(ym: YearMonth): string {
  const [y, m] = ym.split('-');
  return MONTH_NAMES[Number(m) - 1].slice(0, 3) + " '" + y.slice(2);
}

export interface MonthRange {
  minYM: YearMonth | null;
  maxYM: YearMonth | null;
  allMonths: YearMonth[];
}

/**
 * Equivalente a cómo ingest() del legacy deriva ALL_MONTHS: junta las 4
 * fechas de cada LoanRecord (file creation / credit report / app date /
 * closing) -- vía METRIC_MONTH_FIELD, para no volver a hardcodear esos 4
 * campos -- y arma el rango contiguo mínimo-máximo.
 */
export function deriveMonthRange(records: LoanRecord[]): MonthRange {
  const months = new Set<YearMonth>();
  for (const record of records) {
    for (const { key } of METRICS) {
      const ym = record[METRIC_MONTH_FIELD[key]];
      if (ym) months.add(ym);
    }
  }
  const sorted = [...months].sort();
  const minYM = sorted[0] ?? null;
  const maxYM = sorted[sorted.length - 1] ?? null;
  return { minYM, maxYM, allMonths: contiguous(minYM, maxYM) };
}
