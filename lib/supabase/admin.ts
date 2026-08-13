import { createClient } from '@supabase/supabase-js';

/**
 * ============================================================================
 * CLIENTE ADMINISTRATIVO (service_role) — SALTEA RLS
 * ============================================================================
 *
 * Etapa AUTH2 — ARCHIVO NUEVO.
 *
 * ⚠ ESTE ES EL ÚNICO LUGAR DE LA APP QUE USA `service_role`. Con esa clave se
 *   lee y escribe cualquier tabla como superusuario, sin políticas de por
 *   medio. Todo lo demás — el navegador y las 3 API routes de pipeline — pasa
 *   por RLS con la sesión del usuario, y así debe seguir.
 *
 * POR QUÉ HIZO FALTA:
 * `must_change_password` vive en `app_metadata`, que el propio usuario NO puede
 * escribir desde el navegador. Eso es deliberado: si viviera en `user_metadata`,
 * cualquiera podría bajarse el flag solo y saltarse el cambio de contraseña.
 * La contrapartida es que liberarlo requiere privilegios que el cliente no
 * tiene, y de ahí esta excepción acotada.
 *
 * REGLAS DE USO, sin excepción:
 *   1. Sólo desde Route Handlers (server-side). Nunca importar esto en un
 *      componente de cliente: la clave terminaría en el bundle del navegador.
 *   2. Quien llama debe resolverse SIEMPRE desde la cookie de sesión
 *      (`getSessionUser()`), nunca desde el body de la request. Este cliente no
 *      tiene noción de "quién está llamando", así que preguntárselo a él sería
 *      justamente el error.
 *   3. `SUPABASE_SERVICE_ROLE_KEY` jamás lleva prefijo NEXT_PUBLIC_.
 */

/** Mensaje único, para que el diagnóstico sea igual en los dos lados. */
const MISSING_ENV_MESSAGE =
  'SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL no estan configuradas. ' +
  'La ruta de cambio de contrasena no puede liberar el flag sin ellas.';

/**
 * Cliente con service_role. Sin `db.schema`: lo único que se usa acá es la
 * Admin API de `auth`, que no depende del schema de datos.
 *
 * `persistSession: false` porque en el servidor no hay a quién persistirle la
 * sesión, y guardarla podría filtrar estado entre requests.
 */
export function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** true si el service_role está configurado -- para diagnosticar sin lanzar. */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
