import { createBrowserClient } from '@supabase/ssr';

/**
 * ============================================================================
 * CLIENTE DE SUPABASE DEL NAVEGADOR
 * ============================================================================
 *
 * Etapa AUTH1. Antes este módulo creaba un cliente con `createClient` de
 * supabase-js, que guarda la sesión en localStorage y — al no haber login —
 * llamaba a la base siempre como `anon` sin autenticar.
 *
 * Desde que se cerró la seguridad en simoOS-prod (permisos de `anon` revocados
 * en `activity_report` y `pipeline_forecast`, RLS activo en las 8 tablas, y
 * políticas que exigen sesión autenticada + "commercial_activity" en
 * `app_metadata.allowed_apps`), ese cliente ya no puede leer ni escribir nada.
 *
 * DOS CAMBIOS, POR MOTIVOS DISTINTOS:
 *
 * 1. `createBrowserClient` (@supabase/ssr) en vez de `createClient`.
 *    Guarda la sesión en COOKIES en vez de localStorage. Hace falta porque:
 *      - el gate (`proxy.ts`) corre en el servidor y sólo ve cookies;
 *      - las 3 API routes de pipeline que el navegador llama por fetch
 *        (`/parse`, `/latest`, `/adverse-history`) reciben esas cookies solas
 *        por ser same-origin, así que pueden hablar con Supabase con la sesión
 *        del usuario sin necesidad de `service_role`.
 *    Es el mismo cliente que usa el repo hermano homesi-pl.
 *
 * 2. UNA SOLA INSTANCIA para los dos schemas.
 *    `app/pipeline/page.tsx` creaba su propio cliente para
 *    `pipeline_forecast`, porque éste está fijo a `activity_report`. Con auth
 *    eso pasa a ser un problema real: dos instancias de GoTrue compitiendo por
 *    la misma sesión (supabase-js avisa por consola) y el riesgo de que una de
 *    las dos quede sin token. Se resuelve con `getForecastDb()`, que apunta el
 *    MISMO cliente al otro schema vía `.schema()`.
 *
 * El JWT viaja solo: `supabase-js` adjunta el access token de la sesión activa
 * en el header `Authorization` de cada request. No hay que pasarlo a mano en
 * ningún lado — alcanza con que el login se haga con este mismo cliente
 * (ver app/login/page.tsx).
 */

/**
 * Mensaje único de configuración faltante -- lo ven tanto quien levanta el
 * proyecto local como quien mira el pill de error en la UI, así que vale la
 * pena que diga exactamente qué hacer.
 */
const MISSING_ENV_MESSAGE =
  'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. ' +
  'Copy .env.example to .env.local and fill in the project values.';

/**
 * El tipo lleva el schema como parámetro genérico, y `SupabaseClient` a secas
 * asume 'public' -- se deriva del propio constructor con ReturnType en vez de
 * anotarlo a mano.
 */
function createActivityReportClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey, { db: { schema: 'activity_report' } });
}

type BrowserClient = ReturnType<typeof createActivityReportClient>;

let client: BrowserClient | null = null;

/**
 * Cliente del navegador, cacheado. Schema por defecto `activity_report`
 * (Commercial Activity); para Forecast, ver `getForecastDb()`.
 *
 * El chequeo de env vars corre al PRIMER USO, no al evaluar el módulo: hacerlo
 * arriba provocaba un 500 con pantalla en blanco en cualquier entorno sin
 * `.env.local`, incluido el prerender de `next build`.
 */
export function getSupabaseClient(): BrowserClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  client = createActivityReportClient(supabaseUrl, supabaseAnonKey);
  return client;
}

/**
 * El MISMO cliente apuntando al schema `pipeline_forecast` (módulo Forecast).
 *
 * Devuelve el query builder de PostgREST, no un SupabaseClient completo: para
 * `.from(...)` es suficiente, y deja explícito que la sesión y el resto del
 * estado de auth siguen viviendo en una única instancia.
 *
 * Nota: el schema debe estar en "Exposed schemas" del proyecto (Settings →
 * API) para que PostgREST lo acepte; si no, todas las llamadas fallan con un
 * error de "schema no encontrado" que no tiene nada que ver con RLS.
 */
export function getForecastDb() {
  return getSupabaseClient().schema('pipeline_forecast');
}

/**
 * true si las env vars están presentes. Permite que la UI distinga
 * "no hay nada guardado todavía" de "esta instalación no tiene Supabase
 * configurado", sin tener que atrapar una excepción para averiguarlo.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
