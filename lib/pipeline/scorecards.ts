import type { ResolvedLoan } from './types';
import type { AliasIndex } from '../business-plan/aliasIndex';
import type { SourceSystem } from '../business-plan/types';

/**
 * ============================================================================
 * SCORECARDS POR BRANCH / LOAN OFFICER / BUSINESS DEVELOPER — Etapa F7, Parte 2
 * ============================================================================
 *
 * Solo lectura sobre `resolvedLoans` ya cargado (mismo array que
 * `lib/pipeline/analytics.ts`, ya filtrado a `status === 'funded'` +
 * `disbursementDate` dentro del período por el caller -- este módulo no
 * vuelve a filtrar por fecha).
 *
 * REGLA DURA (misma que `lib/business-plan/aliasIndex.ts`): nunca comparar
 * nombres de persona con `===`. La única forma válida de saber que dos
 * nombres son la misma persona es `org.employee_alias`, vía `AliasIndex`
 * (importado, no reimplementado).
 */

export interface ScorecardRow {
  /** Clave estable -- branch_code, o employee_key como string. */
  key: string;
  /** Texto a mostrar. */
  label: string;
  closedCount: number;
  totalAmount: number;
  avgAmount: number;
  /** 0-100. */
  percentOfTotal: number;
}

function toRows(byKey: Map<string, { label: string; count: number; amount: number }>, totalCount: number): ScorecardRow[] {
  return [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      closedCount: v.count,
      totalAmount: v.amount,
      avgAmount: v.count > 0 ? v.amount / v.count : 0,
      percentOfTotal: totalCount > 0 ? (v.count / totalCount) * 100 : 0,
    }))
    .sort((a, b) => b.closedCount - a.closedCount);
}

/**
 * Scorecard por branch. `knownBranchCodes` viene de `org.dim_branch`
 * (`branch_code`) -- se usa para reportar diagnóstico (qué branches del
 * loan NO están en el roster de `org`), nunca para descartar un loan: un
 * branch fuera del roster de `org` sigue contando en el total, solo se
 * marca como no reconocido.
 */
export function buildBranchScorecard(
  loans: ResolvedLoan[],
  knownBranchCodes: Set<string>
): { rows: ScorecardRow[]; unresolvedBranches: string[] } {
  const byKey = new Map<string, { label: string; count: number; amount: number }>();
  const unresolved = new Set<string>();
  for (const loan of loans) {
    const code = loan.branch;
    if (!knownBranchCodes.has(code)) unresolved.add(code);
    const cur = byKey.get(code) ?? { label: code, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += loan.amount;
    byKey.set(code, cur);
  }
  return { rows: toRows(byKey, loans.length), unresolvedBranches: [...unresolved].sort() };
}

export interface PersonScorecardDiagnostics {
  /** Cuántos loans entraron a este scorecard antes de resolver (el universo, ya filtrado -- ej. solo Business Developer). */
  totalInput: number;
  /** Resueltos contra `org.employee_alias` -- entran a `rows`. */
  resolvedCount: number;
  /** `loanOfficer` vacío -- sin nadie a quien atribuir, no es un nombre "sin mapear". */
  blankCount: number;
  /** Encontrados en `org.source_name_excluded` -- exclusión conocida (ej. "sf integrations"), no una persona real de la división. */
  excludedCount: number;
  /** Ni alias, ni exclusión, ni vacío -- nombre real que no está en `org.employee_alias` todavía. */
  unmappedCount: number;
  /** Detalle de los no mapeados, para poder pedir que se agreguen a la tabla de alias. */
  unmappedNames: { nameRaw: string; rows: number }[];
}

export interface PersonScorecardResult {
  rows: ScorecardRow[];
  diagnostics: PersonScorecardDiagnostics;
}

/**
 * Agrupa por `employeeKey` resuelto (nunca por el nombre crudo) -- dos
 * nombres distintos que resuelven al mismo `employeeKey` (ej. "Ana Milena
 * Zegarra" vs un alias distinto de la misma persona) se suman en la MISMA
 * fila, con `dim_employee.full_name` como label.
 *
 * `source` es siempre `'salesforce'` para los dos scorecards de esta etapa
 * (Loan Officer y Business Developer) -- ambos leen `resolvedLoans.loanOfficer`,
 * que es la columna "Loan Officers" del export de Salesforce (ver
 * `lib/pipeline/sources/salesforce-file.ts`); no hay una columna "Opportunity
 * Owner" separada en los datos reales, confirmado contra el snapshot activo.
 */
function buildPersonScorecard(
  loans: ResolvedLoan[],
  getRawName: (loan: ResolvedLoan) => string,
  source: SourceSystem,
  aliasIndex: AliasIndex,
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean },
  employeeNameByKey: Map<number, string>
): PersonScorecardResult {
  const byKey = new Map<string, { label: string; count: number; amount: number }>();
  const unmapped = new Map<string, { nameRaw: string; rows: number }>();
  let resolvedCount = 0;
  let blankCount = 0;
  let excludedCount = 0;

  for (const loan of loans) {
    const nameRaw = getRawName(loan).trim();
    if (!nameRaw) {
      blankCount += 1;
      continue;
    }
    const { employeeKey } = aliasIndex.lookup(source, nameRaw);
    if (employeeKey !== null) {
      resolvedCount += 1;
      const key = String(employeeKey);
      const label = employeeNameByKey.get(employeeKey) ?? nameRaw;
      const cur = byKey.get(key) ?? { label, count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += loan.amount;
      byKey.set(key, cur);
      continue;
    }
    if (excludedIndex.has(source, nameRaw)) {
      excludedCount += 1;
      continue;
    }
    const u = unmapped.get(nameRaw) ?? { nameRaw, rows: 0 };
    u.rows += 1;
    unmapped.set(nameRaw, u);
  }

  const unmappedCount = [...unmapped.values()].reduce((sum, u) => sum + u.rows, 0);

  return {
    rows: toRows(byKey, resolvedCount),
    diagnostics: {
      totalInput: loans.length,
      resolvedCount,
      blankCount,
      excludedCount,
      unmappedCount,
      unmappedNames: [...unmapped.values()].sort((a, b) => b.rows - a.rows),
    },
  };
}

export function buildLoanOfficerScorecard(
  loans: ResolvedLoan[],
  aliasIndex: AliasIndex,
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean },
  employeeNameByKey: Map<number, string>
): PersonScorecardResult {
  return buildPersonScorecard(loans, (loan) => loan.loanOfficer, 'salesforce', aliasIndex, excludedIndex, employeeNameByKey);
}

/**
 * Business Developer: comparación exacta de `opportunityOwnerTitle`, mismo
 * criterio (sin trim ni normalización) que ya usa `lib/pipeline/strategy.ts`
 * para clasificar B2B -- no se reinterpreta esa regla acá, solo se reusa el
 * mismo filtro para armar el scorecard.
 *
 * Etapa F7.20: agrupa por `opportunityOwner` (columna "Opportunity Owner"
 * del export), no por `loanOfficer` -- confirmado con captura real que son
 * personas distintas en la misma fila; `loanOfficer` procesa el préstamo,
 * `opportunityOwner` es quien realmente originó/lleva la relación B2B. La
 * resolución sigue exactamente igual (`aliasIndex.lookup('salesforce', ...)`,
 * `excludedIndex.has(...)`) -- mismo mecanismo, distinto nombre crudo de
 * entrada. Un valor como "sf integrations" se excluye por el mismo
 * `excludedIndex` ya usado para Loan Officer, no por un chequeo nuevo acá.
 */
export function buildBusinessDeveloperScorecard(
  loans: ResolvedLoan[],
  aliasIndex: AliasIndex,
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean },
  employeeNameByKey: Map<number, string>
): PersonScorecardResult {
  const bdLoans = loans.filter((loan) => loan.opportunityOwnerTitle === 'Business Developer');
  return buildPersonScorecard(bdLoans, (loan) => loan.opportunityOwner, 'salesforce', aliasIndex, excludedIndex, employeeNameByKey);
}
