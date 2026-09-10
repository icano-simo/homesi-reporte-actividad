'use client';

import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * ============================================================================
 * EL PERFIL DEL LOAN OFFICER — etapa BP50
 * ============================================================================
 *
 * Lee y escribe `org.lo_profile`. Ver `docs/sql/2026-09-lo-profile.sql` para el
 * modelo y sus razones; acá va lo que el cliente necesita saber.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SE EDITA EN EL LUGAR, ASÍ QUE NO ES `upsert`
 * ---------------------------------------------------------------------------
 * `upsert` mandaría `created_by` en cada guardado, y con `on conflict do
 * update` eso PISA al autor original: `created_by` pasaría a significar «el
 * último que guardó», que es lo que ya dice `updated_by`. Dos columnas con el
 * mismo significado y ninguna con el que hace falta.
 *
 * Así que hay dos caminos explícitos: si no hay fila, `insert` con
 * `created_by`; si hay, `update` con `updated_by`. Es una consulta más y vale
 * la pena.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL NMLS ES UN OVERRIDE, NO UNA COPIA
 * ---------------------------------------------------------------------------
 * `nmls_override = null` significa «usá el de `org.dim_employee`», que lo trae
 * para 34 de 35 Loan Officers activos. Guardar el mismo número acá crearía dos
 * verdades sin forma de saber cuál manda -- así que si lo que se escribe es
 * IGUAL al de la sincronización, se guarda `null`.
 */

export interface LoProfile {
  employee_key: number;
  operating_states: string[];
  licenses: string | null;
  nmls_override: string | null;
  lead_source: string | null;
  schedule: 'full_time' | 'part_time' | null;
  started_on: string | null;
  interests: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

/** Lo que la pantalla edita. Sin las columnas de autoría, que no se tipean. */
export type LoProfileDraft = Pick<
  LoProfile,
  'operating_states' | 'licenses' | 'nmls_override' | 'lead_source' | 'schedule' | 'started_on' | 'interests'
>;

export const PERFIL_VACIO: LoProfileDraft = {
  operating_states: [],
  licenses: null,
  nmls_override: null,
  lead_source: null,
  schedule: null,
  started_on: null,
  interests: null,
};

/** El mismo patrón que el CHECK de la tabla, para que la pantalla rechace lo mismo. */
export const ESTADO_VALIDO = /^[A-Z]{2}$/;

/** `https://new.mmi.run/nmls/<nmls>`, y `null` si no hay NMLS: sin número no hay link. */
export function linkMmi(nmls: string | null | undefined): string | null {
  const limpio = (nmls ?? '').trim();
  return limpio === '' ? null : 'https://new.mmi.run/nmls/' + encodeURIComponent(limpio);
}

/**
 * El NMLS que rige: el override si alguien lo corrigió, y si no el de la
 * sincronización. `null` cuando no hay ninguno -- y ese caso EXISTE: medido, un
 * Loan Officer activo (Lucio Romero) no tiene NMLS en `dim_employee`.
 */
export function nmlsEfectivo(perfil: LoProfileDraft | null, nmlsDeLaBase: string | null): string | null {
  const o = (perfil?.nmls_override ?? '').trim();
  if (o !== '') return o;
  const b = (nmlsDeLaBase ?? '').trim();
  return b === '' ? null : b;
}

/** Vacío a `null`, para no reintroducir la ambigüedad entre «no vino» y «vino vacío». */
const oNulo = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

export interface PerfilLeido {
  /** `null` = leyó y no hay fila. Distinto de `undefined`, que sería «no se leyó». */
  perfil: LoProfile | null;
  error: string | null;
}

export async function leerPerfil(employeeKey: number): Promise<PerfilLeido> {
  const { data, error } = await getSupabaseClient()
    .schema('org')
    .from('lo_profile')
    .select('*')
    .eq('employee_key', employeeKey)
    .limit(1);
  if (error) {
    return {
      perfil: null,
      error:
        /Could not find the table/i.test(error.message) || error.code === 'PGRST205'
          ? 'The SQL for this stage has not been applied yet: docs/sql/2026-09-lo-profile.sql'
          : error.message,
    };
  }
  return { perfil: (data?.[0] as LoProfile | undefined) ?? null, error: null };
}

/**
 * Guarda el perfil. Devuelve `null` si salió bien, y el mensaje si no.
 *
 * ⚠ `nmlsDeLaBase` entra para poder decidir el override: si lo que se escribió
 * es lo mismo que ya trae la sincronización, se guarda `null` y el perfil sigue
 * heredando. Sin esto, editar y volver a escribir el mismo número dejaría una
 * copia congelada que no se actualiza más.
 */
export async function guardarPerfil(
  employeeKey: number,
  borrador: LoProfileDraft,
  nmlsDeLaBase: string | null,
  hayFila: boolean
): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) return 'No active session: there is nobody to attribute this to.';

  const escrito = oNulo(borrador.nmls_override);
  const deLaBase = oNulo(nmlsDeLaBase);
  const override = escrito !== null && escrito === deLaBase ? null : escrito;

  const estados = borrador.operating_states
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ESTADO_VALIDO.test(s));
  /* Sin repetidos: la tabla no lo impide y dos veces «FL» no significa nada. */
  const unicos = [...new Set(estados)].sort();

  const campos = {
    operating_states: unicos,
    licenses: oNulo(borrador.licenses),
    nmls_override: override,
    lead_source: oNulo(borrador.lead_source),
    schedule: borrador.schedule,
    started_on: oNulo(borrador.started_on),
    interests: oNulo(borrador.interests),
  };

  /*
   * ⚠ CON `select()`, o sea `returning`: un insert o un update que no toca
   * ninguna fila --una policy que no aplica-- se parece a uno que funcionó. Es
   * la regla de siempre, y acá importa porque lo que se guarda es lo que
   * después se lee como el perfil de una persona.
   */
  const tabla = supabase.schema('org').from('lo_profile');
  const { data, error } = hayFila
    ? await tabla
        .update({ ...campos, updated_by: email, updated_at: new Date().toISOString() })
        .eq('employee_key', employeeKey)
        .select('employee_key')
    : await tabla
        .insert({ employee_key: employeeKey, ...campos, created_by: email })
        .select('employee_key');

  if (error) {
    if (error.code === '23514' || /violates check constraint/i.test(error.message)) {
      return 'The database rejected a value. States go as two capital letters (FL, VA), the schedule is full or part time, and text fields cannot be blank.';
    }
    if (error.code === '42501' || /permission denied|row-level security/i.test(error.message)) {
      return 'Your session can read this profile but not save it.';
    }
    return error.message;
  }
  if ((data?.length ?? 0) === 0) {
    return 'Nothing was saved: the write matched no row. Reload and try again.';
  }
  return null;
}

/**
 * ============================================================================
 * LOS ESTADOS SUGERIDOS — de dónde cerró, no dónde tiene licencia
 * ============================================================================
 *
 * Sale de `property_state` de los préstamos, y es una SUGERENCIA. Medido el
 * 2026-09-10: 10.702 de 26.191 préstamos traen el estado, y 21 de los 35 Loan
 * Officers activos matchean por nombre.
 *
 * ⚠ LA ATADURA ES EL NOMBRE, no una clave: ni `pipeline_loans` ni
 * `pipeline_resolved_loans` traen `loan_officer_person_code` --lo traen para el
 * processor y los LOA, no para el LO--. Así que catorce personas no van a tener
 * sugerencias, y eso es correcto: es mejor no sugerir que sugerir los estados
 * de otro.
 *
 * Y donde alguien CERRÓ no es donde tiene licencia. Por eso se ofrecen para
 * agregar de un clic, no se cargan solas.
 */
export async function estadosSugeridos(nombreCompleto: string): Promise<string[]> {
  const nombre = nombreCompleto.trim();
  if (nombre === '') return [];
  const supabase = getSupabaseClient().schema('pipeline_forecast');

  const [resueltos, abiertos] = await Promise.all([
    supabase.from('pipeline_resolved_loans').select('property_state').ilike('loan_officer', nombre),
    supabase.from('pipeline_loans').select('property_state').ilike('loan_officer', nombre),
  ]);
  /* Un error acá no rompe la pantalla: sin sugerencias se cargan a mano. Pero
     se distingue de «no hay»: se avisa en consola en vez de mentir con []. */
  for (const r of [resueltos, abiertos]) {
    if (r.error) console.warn('[perfil] no se pudieron leer estados sugeridos: ' + r.error.message);
  }

  const cuenta = new Map<string, number>();
  for (const r of [resueltos, abiertos]) {
    for (const fila of (r.data ?? []) as { property_state: string | null }[]) {
      const e = (fila.property_state ?? '').trim().toUpperCase();
      if (!ESTADO_VALIDO.test(e)) continue;
      cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
    }
  }
  /* Por volumen y no alfabético: donde más cerró es lo que más probablemente
     quiera marcar. */
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
}
