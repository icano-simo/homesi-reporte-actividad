import type { PipelineLoan } from './types';
import { targetMonthRange, type DateRange, type TargetMonth } from './aggregate';
import { groupByStrategy, type Strategy, STRATEGY_ORDER } from './strategy';

// Etapa NEXTMONTH-1 — ARCHIVO NUEVO.
//
// Misma regla de aislamiento que aggregate.ts: este archivo nunca importa de
// lib/pipeline/sources/ -- solo recibe PipelineLoan[] ya armado por quien lo
// llame.

/** Mes siguiente a `target`, con rollover de año en diciembre->enero. */
export function nextTargetMonth(target: TargetMonth): TargetMonth {
  return target.month === 12 ? { year: target.year + 1, month: 1 } : { year: target.year, month: target.month + 1 };
}

export interface NextMonthPopulations {
  estClosingNextMonth: PipelineLoan[];
  outOfScope: PipelineLoan[];
  /** Unión real por sourceLoanId, sin duplicados. */
  combined: PipelineLoan[];
}

/**
 * "Est Closing Next Month": abiertos (sin filtro de Healthiness) cuyo
 * estClosingDate cae dentro del mes siguiente al Forecast Month.
 *
 * "Out of Scope": rawHealthiness.trim() === 'Out of Scope' (nunca `healthy`
 * -- ese campo ya está colapsado a boolean y pierde la distinción con
 * Delayed) cuyo estClosingDate cae dentro del Forecast Month ACTUAL, no del
 * siguiente. Representa específicamente "se esperaba que cerrara ESTE mes y
 * no va a poder" -- un Out of Scope cuyo estClosingDate ya cayó en el mes
 * siguiente lo cubre la regla de arriba (que no filtra por Healthiness);
 * uno con estClosingDate anterior al mes actual es un valor stale y no es
 * información activa de esta pestaña.
 *
 * "Combined": unión real por sourceLoanId. Por construcción (una regla mira
 * solo el mes siguiente, la otra solo el mes actual) las 2 poblaciones
 * deberían ser mutuamente excluyentes -- se arma como unión real igual, no
 * como concatenación sin deduplicar, por si algún dato real rompe ese
 * supuesto.
 */
export function buildNextMonthPopulations(loans: PipelineLoan[], forecastMonth: TargetMonth): NextMonthPopulations {
  const nextMonthRange: DateRange = targetMonthRange(nextTargetMonth(forecastMonth));
  const currentMonthRange: DateRange = targetMonthRange(forecastMonth);

  const estClosingNextMonth = loans.filter(
    (loan) =>
      loan.estClosingDate !== null &&
      loan.estClosingDate >= nextMonthRange.startDate &&
      loan.estClosingDate <= nextMonthRange.endDate
  );

  const outOfScope = loans.filter(
    (loan) =>
      loan.rawHealthiness.trim() === 'Out of Scope' &&
      loan.estClosingDate !== null &&
      loan.estClosingDate >= currentMonthRange.startDate &&
      loan.estClosingDate <= currentMonthRange.endDate
  );

  const byId = new Map<string, PipelineLoan>();
  for (const loan of estClosingNextMonth) byId.set(loan.sourceLoanId, loan);
  for (const loan of outOfScope) byId.set(loan.sourceLoanId, loan);

  return { estClosingNextMonth, outOfScope, combined: [...byId.values()] };
}

export interface CountAmount {
  count: number;
  amount: number;
}

/** count = loans.length, amount = suma de loan.amount. Sin pull-through -- Opción A ya confirmada, tarjetas KPI muestran cifras crudas. */
export function summarizeCountAmount(loans: PipelineLoan[]): CountAmount {
  return { count: loans.length, amount: loans.reduce((sum, loan) => sum + loan.amount, 0) };
}

export interface NextMonthByBranchRow {
  branch: string;
  estClosingNextMonth: CountAmount;
  outOfScope: CountAmount;
  combined: CountAmount;
}

/**
 * Un row por cada branch que aparezca en CUALQUIERA de las 3 poblaciones
 * (detección dinámica de branch, no una lista fija -- mismo criterio que ya
 * usa el resto de la app). Ordenado alfabéticamente por ahora; el orden de
 * presentación final se decide en la Etapa NEXTMONTH-2 (UI).
 */
export function buildNextMonthByBranch(populations: NextMonthPopulations): NextMonthByBranchRow[] {
  const branches = new Set<string>();
  for (const loan of populations.estClosingNextMonth) branches.add(loan.branch);
  for (const loan of populations.outOfScope) branches.add(loan.branch);
  for (const loan of populations.combined) branches.add(loan.branch);

  return [...branches].sort().map((branch) => ({
    branch,
    estClosingNextMonth: summarizeCountAmount(populations.estClosingNextMonth.filter((loan) => loan.branch === branch)),
    outOfScope: summarizeCountAmount(populations.outOfScope.filter((loan) => loan.branch === branch)),
    combined: summarizeCountAmount(populations.combined.filter((loan) => loan.branch === branch)),
  }));
}

export interface NextMonthByStrategyRow {
  strategy: Strategy;
  estClosingNextMonth: CountAmount;
  outOfScope: CountAmount;
  combined: CountAmount;
}

/**
 * Reutiliza groupByStrategy() de strategy.ts para cada una de las 3
 * poblaciones -- no reclasifica a mano. groupByStrategy() omite estrategias
 * en 0 (salvo 'Own production', que siempre va) DENTRO de cada población por
 * separado, así que una estrategia puede faltar en el resultado de una
 * población y estar presente en otra -- el row set final es la UNIÓN de las
 * 3 llamadas, no la intersección; a la estrategia ausente en una población
 * puntual se le arma un CountAmount en 0 ahí, no se omite la fila entera.
 */
export function buildNextMonthByStrategy(populations: NextMonthPopulations): NextMonthByStrategyRow[] {
  const byStrategy = (loans: PipelineLoan[]): Map<Strategy, PipelineLoan[]> =>
    new Map(groupByStrategy(loans).map((g) => [g.strategy, g.loans]));

  const estClosingNextMonthByStrategy = byStrategy(populations.estClosingNextMonth);
  const outOfScopeByStrategy = byStrategy(populations.outOfScope);
  const combinedByStrategy = byStrategy(populations.combined);

  const strategies = new Set<Strategy>([
    ...estClosingNextMonthByStrategy.keys(),
    ...outOfScopeByStrategy.keys(),
    ...combinedByStrategy.keys(),
  ]);

  return STRATEGY_ORDER.filter((strategy) => strategies.has(strategy)).map((strategy) => ({
    strategy,
    estClosingNextMonth: summarizeCountAmount(estClosingNextMonthByStrategy.get(strategy) ?? []),
    outOfScope: summarizeCountAmount(outOfScopeByStrategy.get(strategy) ?? []),
    combined: summarizeCountAmount(combinedByStrategy.get(strategy) ?? []),
  }));
}
