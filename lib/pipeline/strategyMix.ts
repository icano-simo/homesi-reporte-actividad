import type { ResolvedLoan } from './types';
import { classifyStrategy, STRATEGY_ORDER, type Strategy } from './strategy';

/**
 * ============================================================================
 * MEZCLA DE ESTRATEGIA COMERCIAL — Etapa F7, Parte 10
 * ============================================================================
 *
 * Solo lectura sobre `fundedInRange` (mismo array que ya reciben los otros
 * 4 cortes de Analytics -- ya filtrado por `status === 'funded'` y por
 * `disbursementDate` dentro del período elegido). No requiere `org`:
 * `classifyStrategy` (lib/pipeline/strategy.ts, sin cambios) solo lee
 * `branch`/`strategyRaw`/`opportunityOwnerTitle`, los tres campos crudos
 * ya presentes en `ResolvedLoan` -- se le pasa directo, sin adaptador.
 */

export interface StrategyMixRow {
  strategy: Strategy;
  count: number;
  /** 0-100. 0 si `loans` está vacío (no hay división por cero). */
  percent: number;
}

/**
 * Siempre las 5 filas de `STRATEGY_ORDER`, en ese orden -- una estrategia
 * sin ningún loan en el período queda en `count: 0` explícito, nunca
 * ausente del array (mismo criterio que `monthsOfYear` en trends.ts: la
 * leyenda muestra las 5 categorías siempre, no solo las que tienen datos).
 */
export function buildStrategyMix(loans: ResolvedLoan[]): StrategyMixRow[] {
  const counts = new Map<Strategy, number>(STRATEGY_ORDER.map((s) => [s, 0]));
  for (const loan of loans) {
    const strategy = classifyStrategy(loan);
    counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
  }
  const total = loans.length;
  return STRATEGY_ORDER.map((strategy) => {
    const count = counts.get(strategy) ?? 0;
    return { strategy, count, percent: total > 0 ? (count / total) * 100 : 0 };
  });
}
