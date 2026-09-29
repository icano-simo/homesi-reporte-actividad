import type { AliasIndex } from '@/lib/business-plan/aliasIndex';
import type { SourceSystem } from '@/lib/business-plan/types';

/**
 * ============================================================================
 * RESOLUCIÓN DE LOAN OFFICER POR ALIAS — Etapa ACTIVITY-GROUPBY-1
 * ============================================================================
 *
 * Activity (`activity_report.loan_records_v2`) es la MISMA fuente que ya
 * resuelve `lib/business-plan/loadData.ts` (`resolveActivityOfficer()`,
 * confirmado leyendo ese archivo: mismo `.from('loan_records_v2')`, mismo
 * `loan_officer`) -- mismo `SourceSystem` de alias: `'slquery'`. Acá se
 * replica SÓLO la vía por nombre (`aliasIndex.lookup('slquery', ...)`) --
 * `loan_officer_person_code` (la vía primaria de esa función, más
 * confiable) queda FUERA de esta etapa a propósito: esa columna no está
 * en el `SELECT` de `lib/supabase/loadCurrent.ts` ni en `LoanRecord` hoy,
 * agregarla es una etapa aparte.
 *
 * ⚠ DECISIÓN EXPLÍCITA (2026-09-28): a diferencia de `resolveActivityOfficer`,
 * ACÁ NUNCA SE EXCLUYE UN PRÉSTAMO DEL AGREGADO. Un nombre en
 * `org.source_name_excluded` (cuenta que no es LO real, ej. "sf
 * integrations") se sigue agrupando bajo su propio nombre crudo, igual
 * que un nombre sin ningún alias -- la única diferencia es que NO se
 * reporta como "sin resolver" (es un caso YA conocido y clasificado, no
 * un hueco de datos que alguien tenga que revisar). Un préstamo real
 * nunca desaparece de Duration/On Time por el modo de Group by elegido.
 */

const SOURCE: SourceSystem = 'slquery';

export interface LoanOfficerNameResolution {
  /** Nombre a mostrar -- resuelto (`dim_employee.full_name`) si se pudo, crudo si no. NUNCA vacío. */
  displayName: string;
  /**
   * `true` sólo si el nombre no resolvió por alias Y no es un nombre
   * deliberadamente excluido -- un caso real para el reporte de "sin
   * resolver" de esta etapa.
   */
  unresolved: boolean;
}

export function resolveLoanOfficerName(
  nameRaw: string,
  aliasIndex: AliasIndex,
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean },
  employeeNameByKey: Map<number, string>
): LoanOfficerNameResolution {
  if (excludedIndex.has(SOURCE, nameRaw)) {
    return { displayName: nameRaw, unresolved: false };
  }
  const { employeeKey } = aliasIndex.lookup(SOURCE, nameRaw);
  if (employeeKey !== null) {
    const resolvedName = employeeNameByKey.get(employeeKey);
    if (resolvedName) return { displayName: resolvedName, unresolved: false };
  }
  return { displayName: nameRaw, unresolved: true };
}
