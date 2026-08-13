import type { User } from '@supabase/supabase-js';
import { getServerClient } from '@/lib/supabase/server';

/**
 * ============================================================================
 * QUIÉN ESTÁ LLAMANDO — verificación de sesión para Route Handlers
 * ============================================================================
 *
 * Etapa AUTH2 — ARCHIVO NUEVO. Equivalente a `getSessionUser()` de
 * `lib/auth.ts` en homesi-pl.
 *
 * El gate (`proxy.ts`) ya rechaza las llamadas sin sesión a `/api/*`, así que
 * esto es defensa en profundidad y no el único candado: un cambio futuro en el
 * `matcher`, o una ruta alcanzada por un path que el matcher no cubra, dejaría
 * abierto un endpoint que escribe. Toda ruta que mute datos llama a esto
 * primero.
 *
 * Lee la sesión de las cookies con la ANON KEY, nunca con service_role. El
 * cliente administrativo (lib/supabase/admin.ts) saltea RLS y no tiene noción
 * de "quién está llamando" -- que es exactamente por qué no puede ser él quien
 * responda esa pregunta.
 */

/** El usuario autenticado, o null. Validado contra Supabase, no sólo decodificado. */
export async function getSessionUser(): Promise<User | null> {
  try {
    // Sin schema: acá sólo interesa `auth`.
    const supabase = await getServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch {
    // Falta de configuración o Supabase caído: se trata como "no hay sesión".
    // Es la dirección segura en la que fallar -- nunca deja pasar de más.
    return null;
  }
}
