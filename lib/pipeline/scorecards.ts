import type { ResolvedLoan } from './types';
import type { AliasIndex } from '../business-plan/aliasIndex';
import type { SourceSystem } from '../business-plan/types';
import { classifyStrategy } from './strategy';

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

/**
 * FIX-SCORECARD-TIEBREAK -- diagnóstico confirmado: sin desempate, dos
 * filas con el mismo `closedCount` quedaban en el orden en que `byKey`
 * las insertó, que a su vez depende del orden en que Supabase devuelve
 * las filas -- SIN ningún `.order()` en la query (`app/api/pipeline/
 * latest/route.ts`), así que ese orden no es un criterio de negocio, es
 * incidental. Caso real confirmado: 3 branches empatados en 5 closed
 * (agosto 2026) aparecían en un orden que no correspondía ni al monto
 * ni a nada reconocible.
 *
 * Desempate: a igualdad de `closedCount`, gana quien facturó más
 * (`totalAmount` desc) -- determinístico y reproducible, ya no depende
 * de qué orden devolvió la base esta vez. Afecta a las 3 tablas
 * (Branch/Loan Officer/Business Developer) y al podio que las resume
 * (ambos consumen este mismo `toRows()`) -- NO afecta "Combined Total by
 * Branch" ni ninguna otra vista de Forecast (`PivotTable.tsx`), que usa
 * su propia agregación, sin pasar por `scorecards.ts`.
 */
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
    .sort((a, b) => b.closedCount - a.closedCount || b.totalAmount - a.totalAmount);
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
  /**
   * `loanOfficer`/`opportunityOwner` vacío -- sin nadie a quien atribuir, no
   * es un nombre "sin mapear". Hotfix loan-officer-null: estos loans YA NO
   * se descartan -- entran a `rows` agrupados bajo una fila sintética
   * ("Unknown Loan Officer"/"Unknown Business Developer", ver
   * `unknownLabel` en `buildPersonScorecard`), a propósito, para que el
   * problema quede visible en la tabla hasta que se corrija en el origen
   * (Salesforce) en vez de desaparecer en silencio. Este contador se
   * conserva igual para el ícono de diagnóstico -- ver
   * `personDiagnosticsNote()`.
   */
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
/**
 * Clave sintética para la fila agregada de "sin nombre" -- nunca colisiona
 * con un `employeeKey` real (`String(number)`). Exportada para que
 * TabAnalytics.tsx pueda reconocer esta fila específica en el `onRowClick`
 * del drill-down (el nombre vacío no resuelve por `aliasIndex`, así que el
 * filtro normal por `employeeKey` no le encuentra ningún loan).
 */
export const UNKNOWN_PERSON_KEY = '__unknown__';

function buildPersonScorecard(
  loans: ResolvedLoan[],
  getRawName: (loan: ResolvedLoan) => string,
  source: SourceSystem,
  aliasIndex: AliasIndex,
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean },
  employeeNameByKey: Map<number, string>,
  /** Hotfix loan-officer-null: label de la fila agregada de loans sin nombre -- distinto texto según el caller (Loan Officer vs. Business Developer), la función no lo asume. */
  unknownLabel: string
): PersonScorecardResult {
  const byKey = new Map<string, { label: string; count: number; amount: number }>();
  const unmapped = new Map<string, { nameRaw: string; rows: number }>();
  let resolvedCount = 0;
  let blankCount = 0;
  let excludedCount = 0;

  for (const loan of loans) {
    const nameRaw = getRawName(loan).trim();
    if (!nameRaw) {
      // Hotfix loan-officer-null: antes esto era `blankCount += 1; continue`,
      // que descartaba el loan de `rows` -- desaparecía de la tabla y del
      // total sin ningún rastro visible. Ahora se agrupa bajo una fila
      // sintética visible, con el mismo tratamiento que cualquier fila real
      // (cuenta en closedCount/totalAmount/percentOfTotal), para que el
      // problema de datos (loans sin Loan Officer/Owner en el origen) quede
      // a la vista hasta que se corrija en Salesforce -- decisión de negocio,
      // no un efecto colateral del fix de null. `blankCount` se sigue
      // acumulando igual, para el ícono de diagnóstico.
      blankCount += 1;
      const cur = byKey.get(UNKNOWN_PERSON_KEY) ?? { label: unknownLabel, count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += loan.amount;
      byKey.set(UNKNOWN_PERSON_KEY, cur);
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
    // Hotfix loan-officer-null: el denominador de `percentOfTotal` pasa de
    // `resolvedCount` a `resolvedCount + blankCount` -- `rows` ahora incluye
    // la fila "Unknown ..." además de las resueltas, y el % debe seguir
    // sumando 100% entre las filas que de verdad se muestran.
    rows: toRows(byKey, resolvedCount + blankCount),
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
  return buildPersonScorecard(loans, (loan) => loan.loanOfficer, 'salesforce', aliasIndex, excludedIndex, employeeNameByKey, 'Unknown Loan Officer');
}

/**
 * Business Developer: población = `classifyStrategy(loan) === 'B2B'`, NO
 * el filtro de título crudo que tenía antes.
 *
 * FIX-BD-B2B-POPULATION -- el filtro viejo (`opportunityOwnerTitle ===
 * 'Business Developer'`) mezclaba 2 poblaciones distintas: `strategy.ts`
 * documenta explícito (ver el comentario largo de `classifyStrategy`) que
 * los 24 préstamos NPPM tienen TODOS ese mismo título -- así que este
 * scorecard los contaba como B2B, cuando la fuente de verdad del negocio
 * para "qué es B2B" ya existe y dice lo contrario (NPPM se evalúa ANTES
 * que B2B, a propósito). `classifyStrategy` también saca cualquier
 * préstamo de una branch de Recruitment que diga ese título (misma regla,
 * ver `RECRUITMENT_BRANCHES` en strategy.ts). El resultado real BAJA
 * respecto de antes -- es la corrección, no un efecto colateral.
 *
 * Etapa F7.20: sigue agrupando por `opportunityOwner` (columna
 * "Opportunity Owner" del export), no por `loanOfficer` -- confirmado con
 * captura real que son personas distintas en la misma fila. La resolución
 * sigue exactamente igual (`aliasIndex.lookup('salesforce', ...)`,
 * `excludedIndex.has(...)`) -- mismo mecanismo, solo cambió el filtro de
 * población de entrada.
 */
export function buildBusinessDeveloperScorecard(
  loans: ResolvedLoan[],
  aliasIndex: AliasIndex,
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean },
  employeeNameByKey: Map<number, string>
): PersonScorecardResult {
  const bdLoans = loans.filter((loan) => classifyStrategy(loan) === 'B2B');
  return buildPersonScorecard(bdLoans, (loan) => loan.opportunityOwner, 'salesforce', aliasIndex, excludedIndex, employeeNameByKey, 'Unknown Business Developer');
}

/**
 * NPPM Realtor -- población = `classifyStrategy(loan) === 'NPPM'`, agrupado
 * por `loan.nppmRealtor` (el realtor externo que trajo el préstamo).
 *
 * ⚠ PENDIENTE DE VALIDAR CON EL NEGOCIO -- a diferencia de Branch/Loan
 * Officer/Business Developer, este scorecard NO pasa por `aliasIndex`/
 * `excludedIndex`: el Realtor de NPPM es una persona EXTERNA a HomeSí, no
 * un empleado -- no está (ni tendría por qué estar) en `org.employee_alias`.
 * Se agrupa por el nombre crudo (`.trim()`) directo, mismo patrón simple
 * que `buildBranchScorecard` (sin resolución de identidad) -- dos grafías
 * distintas del mismo realtor NO se combinan acá. Si el negocio confirma
 * que hace falta ese matching (ej. un realtor que aparece con 2 variantes
 * de nombre en Salesforce), este supuesto cambia.
 */
export function buildNppmRealtorScorecard(loans: ResolvedLoan[]): { rows: ScorecardRow[]; totalInput: number; blankCount: number } {
  const nppmLoans = loans.filter((loan) => classifyStrategy(loan) === 'NPPM');
  const byKey = new Map<string, { label: string; count: number; amount: number }>();
  let blankCount = 0;

  for (const loan of nppmLoans) {
    const nameRaw = loan.nppmRealtor.trim();
    const key = nameRaw || UNKNOWN_PERSON_KEY;
    if (!nameRaw) blankCount += 1;
    const cur = byKey.get(key) ?? { label: nameRaw || 'Unknown NPPM Realtor', count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += loan.amount;
    byKey.set(key, cur);
  }

  return { rows: toRows(byKey, nppmLoans.length), totalInput: nppmLoans.length, blankCount };
}
