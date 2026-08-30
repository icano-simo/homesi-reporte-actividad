'use client';

import { getSupabaseClient } from '@/lib/supabase/client';

/*
 * ============================================================================
 * EL ROSTER DE RRHH Y LOS CAMBIOS ENTRE CARGAS — etapa ADMIN-1
 * ============================================================================
 *
 * Lee dos tablas y no calcula nada: `org.roster_v2` (el roster vigente) y
 * `org.roster_change_log` (altas, bajas y cambios detectados al comparar una
 * carga con la anterior).
 *
 * ---------------------------------------------------------------------------
 * ⚠ `branch_code` ACÁ ES EL BRANCH DEL ROSTER, NO DONDE LA PERSONA PRODUCE
 * ---------------------------------------------------------------------------
 * Es dónde RRHH tiene asignada a la persona. Un loan officer puede originar
 * préstamos en otro branch, y de hecho pasa: Outlook ya tuvo que separar las
 * dos cosas --el YTD se atribuye al branch DEL PRÉSTAMO y la proyección al
 * branch del ROSTER-- porque mezclarlas producía un doble conteo que nadie veía
 * (ver `lib/outlook/loadData.ts`).
 *
 * Esta pantalla NO lee `loan_records_v2` y no cruza las dos fuentes. Si algún
 * día lo hiciera, cada columna tiene que decir de cuál de los dos branches
 * habla, porque el mismo número con dos significados es el error más caro que
 * este proyecto ya cometió.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTA PANTALLA NO DA NI QUITA DE BAJA A NADIE
 * ---------------------------------------------------------------------------
 * Reporta. La decisión de desactivar a alguien se toma fuera, a mano, y es una
 * decisión pedida explícitamente: un archivo de RRHH incompleto desactivaría a
 * quien sí está trabajando. Lo único que esta pantalla escribe es el
 * `acknowledged` de una fila del log -- "ya lo vi", nunca "ya lo apliqué".
 */

export interface RosterPerson {
  person_code: string;
  display_name: string;
  /** El nombre tal como venía en el archivo, cuando se corrigió a mano. */
  name_in_file: string | null;
  country: string | null;
  branch_code: string | null;
  position: string | null;
  area: string | null;
  supervisor: string | null;
  supreme_email: string | null;
  is_active: boolean;
  /** 'user_addition' = la agregó la usuaria; RRHH no la tiene en sus archivos. */
  source_kind: string | null;
  /** true = algún campo del archivo se corrigió a mano. Ver `name_in_file`. */
  has_override: boolean;
  /** Fecha real de ingreso. ⚠ SÓLO Colombia: el archivo de USA no la trae. */
  date_started: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  left_detected_at: string | null;
  synced_at: string;
}

export interface RosterChange {
  id: number;
  person_code: string;
  display_name: string | null;
  country: string | null;
  branch_code: string | null;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  detected_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

export interface RosterBranch {
  branchCode: string;
  people: RosterPerson[];
}

export interface AdminData {
  branches: RosterBranch[];
  changes: RosterChange[];
  /**
   * ⚠ ¿Hay historia de cargas? — la única forma honesta de leer las fechas.
   *
   * `first_seen_at` y `last_seen_at` se llenan comparando cargas sucesivas del
   * roster. Los rosters cargaban en modo REPLACE y recién se pasaron a APPEND,
   * así que la historia arranca con la próxima subida y hoy las 108 filas las
   * tienen vacías.
   *
   * Una celda vacía se lee como un error de la pantalla. Mientras esto sea
   * `false`, la pantalla dice "sin registro" y explica por qué -- que es una
   * afirmación verdadera, a diferencia del blanco.
   */
  hayHistoriaDeCargas: boolean;
  diagnostics: {
    rosterRows: number;
    changeRows: number;
    /** El error de lectura, si lo hubo. Ver el bloque de abajo. */
    rosterError: string | null;
    changeError: string | null;
  };
}

/** Fecha corta y estable, sin depender de la zona horaria de quien mira. */
export function shortDate(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export async function loadAdminData(): Promise<AdminData> {
  const org = getSupabaseClient().schema('org');

  /*
   * ⚠ Los dos errores se capturan y se MUESTRAN, no se tragan.
   *
   * Con RLS, una tabla sin política devuelve cero filas y no un error, así que
   * "no hay datos" y "no tengo permiso" se ven igual en la pantalla. Se guarda
   * el error de cada lectura por separado para poder distinguir los tres casos
   * --sin permiso, sin datos, error real-- en vez de mostrar una tabla vacía
   * que no dice cuál de los tres es.
   */
  const [rosterRes, changeRes] = await Promise.all([
    org.from('roster_v2').select('*').order('branch_code', { ascending: true }).order('display_name', { ascending: true }),
    org.from('roster_change_log').select('*').order('detected_at', { ascending: false }),
  ]);

  const people = (rosterRes.data ?? []) as RosterPerson[];
  const changes = (changeRes.data ?? []) as RosterChange[];

  /*
   * Agrupado por branch y ordenado por CANTIDAD DE GENTE, como se pidió: el 700
   * es corporativo y tiene 35, el resto van de 1 a 15. Ordenar alfabéticamente
   * dejaría al más grande en el medio.
   *
   * Los que no traen branch van al final bajo una etiqueta explícita: un grupo
   * sin nombre se lee como un branch que se llama vacío.
   */
  const byBranch = new Map<string, RosterPerson[]>();
  for (const p of people) {
    const code = p.branch_code?.trim() || SIN_BRANCH;
    byBranch.set(code, [...(byBranch.get(code) ?? []), p]);
  }
  const branches: RosterBranch[] = [...byBranch.entries()]
    .map(([branchCode, list]) => ({
      branchCode,
      people: list.sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }))
    .sort((a, b) => {
      if (a.branchCode === SIN_BRANCH) return 1;
      if (b.branchCode === SIN_BRANCH) return -1;
      return b.people.length - a.people.length || a.branchCode.localeCompare(b.branchCode);
    });

  return {
    branches,
    changes,
    /* Basta con que UNA fila tenga la marca para que la historia haya empezado. */
    hayHistoriaDeCargas: people.some((p) => p.first_seen_at !== null || p.last_seen_at !== null),
    diagnostics: {
      rosterRows: people.length,
      changeRows: changes.length,
      rosterError: rosterRes.error?.message ?? null,
      changeError: changeRes.error?.message ?? null,
    },
  };
}

export const SIN_BRANCH = '(sin branch en el roster)';

/**
 * Marca una fila del log como revisada.
 *
 * ⚠ `acknowledged_by` sale de la SESIÓN, no de un campo -- mismo criterio que
 * `lib/outlook/save.ts`: si viniera del formulario, cualquiera podría firmar
 * con el nombre de otro, y la firma es la mitad del valor de guardar quién lo
 * revisó.
 *
 * Es lo ÚNICO que esta pantalla escribe, y no cambia el roster: dice "ya lo vi",
 * no "ya lo apliqué".
 */
export async function acknowledgeChange(id: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) throw new Error('No active session: there is nobody to attribute this to.');

  const { error } = await supabase
    .schema('org')
    .from('roster_change_log')
    .update({ acknowledged: true, acknowledged_by: email, acknowledged_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
