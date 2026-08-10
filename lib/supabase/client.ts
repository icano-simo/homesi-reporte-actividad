import { createClient } from '@supabase/supabase-js';

/**
 * Mensaje único de configuración faltante -- lo ven tanto quien levanta el
 * proyecto local como quien mira el pill de error en la UI, así que vale la
 * pena que diga exactamente qué hacer.
 */
const MISSING_ENV_MESSAGE =
  'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. ' +
  'Copy .env.example to .env.local and fill in the project values.';

/**
 * El tipo del cliente lleva el schema como parámetro genérico
 * (`SupabaseClient<any, 'activity_report', ...>`), y `SupabaseClient` a secas
 * asume 'public' -- anotarlo así daba un error de tipos. Se deriva del propio
 * constructor con ReturnType, que es exactamente el tipo que antes se
 * infería del `export const supabase = createClient(...)`.
 */
function createActivityReportClient(url: string, anonKey: string) {
  return createClient(url, anonKey, { db: { schema: 'activity_report' } });
}

type ActivityReportClient = ReturnType<typeof createActivityReportClient>;

let client: ActivityReportClient | null = null;

/**
 * Cliente único de Supabase, apuntando al schema 'activity_report' (no
 * 'public'). Acceso abierto sin login por ahora -- decisión temporal,
 * pendiente de reemplazar cuando exista SSO.
 *
 * Nota: el schema 'activity_report' debe estar en la lista de "Exposed
 * schemas" del proyecto de Supabase (Settings -> API) para que PostgREST lo
 * acepte -- si no, todas las llamadas de este módulo fallan con un error de
 * "schema no encontrado".
 *
 * ---------------------------------------------------------------------------
 * Etapa UX1b — POR QUÉ ES UNA FUNCIÓN Y NO UN `export const supabase`
 * ---------------------------------------------------------------------------
 * Antes este módulo creaba el cliente en el top-level y hacía `throw` ahí
 * mismo si faltaban las env vars. Como app/page.tsx importa (vía saveUpload)
 * este archivo, ese throw ocurría durante la EVALUACIÓN DEL MÓDULO: sin
 * `.env.local`, la vista Commercial Activity devolvía un 500 completo, pantalla
 * en blanco, antes de renderizar una sola línea de UI.
 *
 * Ahora el chequeo se corre al PRIMER USO. La diferencia práctica:
 *  - la página renderiza siempre, aunque no haya credenciales;
 *  - el error sigue siendo igual de ruidoso, pero por el canal correcto: la
 *    promesa de loadCurrentReport()/saveUpload() rechaza y app/page.tsx ya
 *    tiene el `catch` que lo muestra como pill roja (ese manejo ya existía,
 *    simplemente nunca se llegaba a ejecutar).
 *
 * Es el mismo criterio que app/pipeline/page.tsx ya usaba para el cliente del
 * schema 'pipeline_forecast' (chequea las env vars y sale sin romper) -- esto
 * elimina la asimetría entre los dos módulos.
 *
 * El cliente se cachea: `createClient` abre conexiones/canales propios, no
 * conviene instanciar uno por llamada.
 */
export function getSupabaseClient(): ActivityReportClient {
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
 * true si las env vars están presentes. Permite que la UI distinga
 * "no hay nada guardado todavía" de "esta instalación no tiene Supabase
 * configurado", sin tener que atrapar una excepción para averiguarlo.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
