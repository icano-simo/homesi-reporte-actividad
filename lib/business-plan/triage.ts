import type { LoanOfficerRow, TriageState } from './types';

/**
 * ============================================================================
 * ⚠ MOTOR DE TRIAGE — NO IMPLEMENTADO A PROPÓSITO
 * ============================================================================
 *
 * Etapa BP1. El brief es explícito: las reglas tienen contradicciones abiertas
 * que están en revisión con el negocio, y "si te encontrás decidiendo una
 * fórmula, pará y avisá". Así que este archivo NO decide ninguna.
 *
 * LO QUE ESTÁ SIN DEFINIR (copiado del brief, para que quede en el código y no
 * sólo en un documento):
 *
 *  1. El GAP es un promedio, o sea fraccionario. Las reglas dicen `GAP = -1` ->
 *     On Risk, pero un GAP de -0,67 no cae en ningún estado. La banda no está
 *     definida.
 *  2. `Apps >= 2 × Benchmark` **Y** `(Apps × 0,5) + Closed >= Benchmark` es
 *     redundante: si la primera se cumple, la segunda se cumple sola. Falta
 *     saber si era **O**.
 *  3. Los multiplicadores del benchmark para las tres actividades no están
 *     definidos.
 *  4. El ejemplo del negocio dice "1 of 3 thresholds missed" mostrando dos
 *     fallados.
 *
 * MIENTRAS TANTO, lo único que se evalúa es lo que sí está decidido: sin
 * benchmark no hay nada que comparar, así que el estado es `not_evaluable`.
 * Como `org.employee_benchmark` todavía no está poblada, hoy TODOS los LOs caen
 * ahí -- y eso es correcto, no un bug. Nada de defaults silenciosos a 2.0.
 *
 * Los otros tres estados existen en el tipo y tienen su lenguaje visual armado
 * (colores, badges, filtros), listos para cuando lleguen las fórmulas.
 */

/** Bandera única para encender la UI de "pendiente" en todas las pantallas. */
export const TRIAGE_ENGINE_READY = false;

export const TRIAGE_PENDING_NOTICE =
  'Triage engine pending definition — thresholds and GAP bands are still under review with the business.';

/**
 * Estado de un LO.
 *
 * Hoy sólo puede devolver `not_evaluable`. Cuando el motor esté definido, esta
 * función recibirá además las métricas y las reglas; la firma se amplía acá y
 * ninguna pantalla necesita cambiar, porque todas leen `row.triage`.
 */
export function triageFor(monthlyBenchmark: number | null): TriageState {
  if (monthlyBenchmark === null) return 'not_evaluable';
  // Con benchmark pero sin motor, sigue sin haber veredicto posible.
  return 'not_evaluable';
}

/**
 * Estado de un branch a partir de sus LOs. Mismo criterio provisorio: mientras
 * ningún LO sea evaluable, el branch tampoco lo es.
 */
export function branchTriage(loanOfficers: LoanOfficerRow[]): TriageState {
  if (loanOfficers.some((lo) => lo.triage === 'on_risk')) return 'on_risk';
  if (loanOfficers.some((lo) => lo.triage === 'need_attention')) return 'need_attention';
  if (loanOfficers.length > 0 && loanOfficers.every((lo) => lo.triage === 'on_track')) return 'on_track';
  return 'not_evaluable';
}

/** Etiqueta visible de cada estado. */
export const TRIAGE_LABEL: Record<TriageState, string> = {
  on_track: 'On Track',
  need_attention: 'Need Attention',
  on_risk: 'On Risk',
  not_evaluable: 'Not evaluable',
};

/**
 * Clase del badge.
 *
 * Etapa BP2b: usa el sistema de badges de `app/styles/components.css`, el mismo
 * que Forecast. Antes había un set paralelo (`.bp-badge--ok/warn/risk/muted`)
 * que describía los mismos estados con otros valores -- ese fue el motivo de
 * que el módulo se viera de otra aplicación.
 */
export const TRIAGE_CLASS: Record<TriageState, string> = {
  on_track: 'badge badge--pill badge--emerald',
  need_attention: 'badge badge--pill badge--amber',
  on_risk: 'badge badge--pill badge--rose',
  not_evaluable: 'badge badge--pill badge--neutral',
};

/** Estados que ofrece el filtro de pills, en orden. */
export const TRIAGE_FILTERS: { value: TriageState | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'on_risk', label: 'On Risk' },
  { value: 'need_attention', label: 'Need Attention' },
  { value: 'on_track', label: 'On Track' },
];
