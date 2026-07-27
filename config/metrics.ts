// Closed set of metrics, so a strict literal union is appropriate here
// (unlike Branch in roster.ts).
export type MetricKey = 'fc' | 'cr' | 'ap' | 'cl';

export interface Metric {
  key: MetricKey;
  label: string;
}

export const METRICS: Metric[] = [
  { key: 'fc', label: 'File Creations' },
  { key: 'cr', label: 'Credit_Report' },
  { key: 'ap', label: 'App date' },
  { key: 'cl', label: 'Closed' },
];

export const MONTH_NAMES: string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
