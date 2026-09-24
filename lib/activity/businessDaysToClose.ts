import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * ============================================================================
 * DÍAS HÁBILES App → CTC — Etapa AVG-DAYS-TO-CLOSE-1
 * ============================================================================
 *
 * Envoltorio de la RPC `business_days_between(p_from, p_to)`, ya probada por
 * Isa contra datos reales. Vive en el schema `public`, NO en `activity_report`
 * (el default de `getSupabaseClient()`, ver ese comentario) -- confirmado
 * llamándola directo: sin `.schema('public')` da 404
 * (PGRST202, "Could not find the function activity_report.business_days_between").
 *
 * Comportamiento actual de la RPC (Isa la actualizó del lado de Supabase,
 * fuera de este repo): cuenta EXCLUSIVO nativo -- mismo día -> 0, lunes a
 * martes -> 1. Antes era inclusivo (mismo día -> 1) y esta función
 * compensaba restando 1 acá; ese compensador se quitó cuando Isa cambió la
 * RPC -- dejarlo habría restado 1 dos veces.
 *   - `p_from` o `p_to` NULL -> `null` (no error).
 *   - `p_from` > `p_to` (fechas invertidas) -> `null` (no error, no negativo).
 *
 * El valor de la RPC se devuelve tal cual, sin ningún ajuste -- un `null`
 * se propaga como `null`, NUNCA como un número: "no se pudo calcular" y
 * "cero días" son cosas distintas.
 */
export async function businessDaysToClose(appDate: string, ctcDate: string): Promise<number | null> {
  const { data, error } = await getSupabaseClient()
    .schema('public')
    .rpc('business_days_between', { p_from: appDate, p_to: ctcDate });

  if (error) {
    throw new Error(`business_days_between(${appDate}, ${ctcDate}) failed: ${error.message}`);
  }

  return data === null ? null : (data as number);
}
