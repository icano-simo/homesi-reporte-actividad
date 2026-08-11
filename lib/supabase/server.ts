import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * ============================================================================
 * CLIENTE DE SUPABASE DEL SERVIDOR (Route Handlers)
 * ============================================================================
 *
 * Etapa AUTH1 — ARCHIVO NUEVO.
 *
 * Las 3 API routes de pipeline que el navegador llama por fetch
 * (`/api/pipeline/parse`, `/latest`, `/adverse-history`) creaban su propio
 * cliente con la anon key y SIN sesión. Con RLS activo eso ya no lee ni
 * escribe nada: la política exige un usuario autenticado.
 *
 * Como el navegador guarda la sesión en cookies (`createBrowserClient`, ver
 * client.ts) y esas rutas son same-origin, la cookie llega sola en cada fetch.
 * Este helper la convierte en un cliente de Supabase que actúa COMO EL USUARIO
 * QUE HIZO LA LLAMADA: las mismas políticas de RLS que rigen en el navegador
 * rigen acá, sin `service_role` ni ningún permiso elevado.
 *
 * Sirve para las 3 rutas que quedan, porque a las 3 las llama el navegador. La
 * cuarta (`/api/pipeline/retention`) era un cron sin sesión y por eso no podía
 * usar este helper: se eliminó, y la retención ahora corre como pg_cron dentro
 * de Supabase (docs/sql/2026-08-retention-pg-cron.sql).
 */

/** Mismo mensaje que client.ts, para que el diagnóstico sea idéntico en los dos lados. */
const MISSING_ENV_MESSAGE =
  'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing.';

/**
 * Cliente para el schema pedido, con la sesión del usuario de la request.
 *
 * `cookies()` es async en Next 16. Los Route Handlers no pueden escribir
 * cookies a través de este objeto, así que `setAll` queda como no-op: el
 * refresco del token lo hace el gate (`proxy.ts`), que sí puede escribir en la
 * respuesta. Sin ese no-op, `@supabase/ssr` avisa por consola en cada llamada.
 */
export async function getServerClient(schema?: 'activity_report' | 'pipeline_forecast') {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    // Sin schema cuando sólo se necesita `auth` (por ejemplo para resolver quién
    // llama): el schema de datos es irrelevante ahí y pedirlo obligaría a elegir
    // uno al azar.
    ...(schema ? { db: { schema } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        /* ver nota de arriba: el refresco de sesión lo maneja proxy.ts */
      },
    },
  });
}
