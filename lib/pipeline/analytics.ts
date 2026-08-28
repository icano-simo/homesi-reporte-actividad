import type { ResolvedLoan } from './types';
import type { DateRange } from './aggregate';

/**
 * ============================================================================
 * RANKINGS DE PROGRAMA Y TIPO — Etapa F7, Parte 1
 * ============================================================================
 *
 * Solo lectura sobre `pipeline_forecast.pipeline_resolved_loans` (ya cargado
 * en el estado del cliente por `/api/pipeline/latest`, mismo array
 * `resolvedLoans` que ya consumen PivotTable/AdverseTable -- no se agrega
 * ninguna consulta nueva a Supabase). Filtra por `status === 'funded'` y por
 * `disbursementDate` dentro del rango del período elegido -- nunca
 * `estClosingDate` (regla explícita del brief).
 *
 * Ninguna regla de cálculo existente se toca: esto no alimenta pull-through,
 * Healthy, Adverse ni las estrategias -- son agregados nuevos e
 * independientes sobre los mismos `loanType`/`loanProgram` crudos que ya
 * expone `ResolvedLoan` (Fase urgente del modal de detalle).
 */

export interface RankingRow {
  /** Valor tal cual del crudo, o el placeholder si venía vacío. */
  label: string;
  count: number;
  amount: number;
}

const NO_PROGRAM_LABEL = 'Sin programa';
const NO_TYPE_LABEL = 'Sin tipo';
/** Etapa PROPERTY-STATE-1: exportado (a diferencia de los dos de arriba) porque el drill-down de TabAnalytics.tsx necesita re-derivar la misma etiqueta -- ver el comentario de DRILLDOWN_NO_PROGRAM_LABEL en ese archivo. */
export const NO_PROPERTY_STATE_LABEL = 'Sin estado';

/** Préstamos funded cuya `disbursementDate` cae dentro del rango, inclusive en los dos extremos. */
export function fundedLoansInRange(loans: ResolvedLoan[], range: DateRange): ResolvedLoan[] {
  return loans.filter(
    (loan) => loan.status === 'funded' && loan.disbursementDate >= range.startDate && loan.disbursementDate <= range.endDate
  );
}

/**
 * `disbursementDate` más antigua entre los funded -- hasta dónde llega la
 * historia real disponible en el snapshot activo. `null` si no hay ningún
 * funded (snapshot vacío o recién cargado).
 */
export function earliestFundedDisbursementDate(loans: ResolvedLoan[]): string | null {
  let earliest: string | null = null;
  for (const loan of loans) {
    if (loan.status !== 'funded' || !loan.disbursementDate) continue;
    if (earliest === null || loan.disbursementDate < earliest) earliest = loan.disbursementDate;
  }
  return earliest;
}

/** Agrupa por una clave cruda, con el vacío llevado a `emptyLabel` -- nunca se descarta un loan por no tener el campo. */
function buildRanking(loans: ResolvedLoan[], getRaw: (loan: ResolvedLoan) => string, emptyLabel: string): RankingRow[] {
  const byLabel = new Map<string, RankingRow>();
  for (const loan of loans) {
    const label = getRaw(loan).trim() || emptyLabel;
    const row = byLabel.get(label) ?? { label, count: 0, amount: 0 };
    row.count += 1;
    row.amount += loan.amount;
    byLabel.set(label, row);
  }
  return [...byLabel.values()].sort((a, b) => b.count - a.count);
}

export function buildLoanProgramRanking(fundedInRange: ResolvedLoan[]): RankingRow[] {
  return buildRanking(fundedInRange, (loan) => loan.loanProgram, NO_PROGRAM_LABEL);
}

export function buildLoanTypeRanking(fundedInRange: ResolvedLoan[]): RankingRow[] {
  return buildRanking(fundedInRange, (loan) => loan.loanType, NO_TYPE_LABEL);
}

/**
 * Etapa PROPERTY-STATE-1. Mismo patrón exacto que Program/Type -- código de
 * 2 letras de estado/territorio (o el placeholder si venía vacío), agrupado
 * por conteo y monto de funded en el período.
 */
export function buildPropertyStateRanking(fundedInRange: ResolvedLoan[]): RankingRow[] {
  return buildRanking(fundedInRange, (loan) => loan.propertyState, NO_PROPERTY_STATE_LABEL);
}

/**
 * ¿Este snapshot capturó property_state para al menos un loan? Mismo
 * criterio que `hasStrategyData()` (lib/pipeline/strategy.ts) -- un snapshot
 * guardado antes de que existiera la columna vuelve con '' para el 100% de
 * los loans, y eso NO debe leerse como "ningún préstamo tiene estado
 * registrado" (un ranking en blanco sin explicación), sino como "este
 * snapshot no capturó el dato".
 */
export function hasPropertyStateData(loans: ResolvedLoan[]): boolean {
  return loans.some((loan) => loan.propertyState !== '');
}
