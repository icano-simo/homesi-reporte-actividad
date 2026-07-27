import type { Measure } from './types';

/**
 * Port exacto de fmtAmt() del legacy: formatea a $K/$M/$B según magnitud,
 * preservando el signo negativo. Nota: usa toFixed(2) (o toFixed(1) para
 * millones a partir de 1e7), así que por ejemplo 1500000 formatea como
 * '$1.50M', no '$1.5M' -- es el comportamiento real del legacy, no un typo.
 */
export function fmtAmt(value: number): string {
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  if (v >= 1e9) return sign + '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M';
  if (v >= 1e3) return sign + '$' + Math.round(v / 1e3) + 'K';
  return sign + '$' + Math.round(v);
}

/**
 * Port de fmtVal() del legacy, con `measure` como parámetro explícito en
 * vez de la variable global MEASURE. '–' (en dash) para 0 o valores falsy,
 * igual que el legacy.
 */
export function fmtVal(value: number, measure: Measure): string {
  if (!value) return '–';
  return measure === 'amount' ? fmtAmt(value) : value.toLocaleString('en-US');
}
