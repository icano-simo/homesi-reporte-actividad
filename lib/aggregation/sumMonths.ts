import type { YearMonth } from '@/lib/parsing/types';
import type { MetricMap } from './types';

/** Port de sumRow() del legacy: suma únicamente los meses pedidos. */
export function sumMonths(map: MetricMap, months: YearMonth[]): number {
  let sum = 0;
  for (const ym of months) sum += map[ym] || 0;
  return sum;
}
