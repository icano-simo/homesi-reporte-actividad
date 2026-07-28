import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Revisa homesi-app/.env.local.'
  );
}

/**
 * Cliente único de Supabase, apuntando al schema 'activity_report' (no
 * 'public'). Acceso abierto sin login por ahora -- es una decisión temporal,
 * pendiente de reemplazar cuando exista SSO/login (ver Etapa futura).
 *
 * Nota: el schema 'activity_report' debe estar en la lista de "Exposed
 * schemas" del proyecto de Supabase (Settings -> API) para que PostgREST lo
 * acepte -- si no, todas las llamadas de este módulo fallan con un error de
 * "schema no encontrado". Ver Riesgos en la respuesta de esta etapa.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'activity_report' },
});
