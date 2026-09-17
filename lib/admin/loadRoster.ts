'use client';

import { getSupabaseClient } from '@/lib/supabase/client';

/*
 * ============================================================================
 * EL ROSTER — etapa ADM1
 * ============================================================================
 *
 * Lee tres tablas y no calcula nada que la base pueda contestar:
 *
 *   org.roster_current    el roster canonico. Se refresca cuando RRHH sube su
 *                         archivo (`roster_us` / `roster_co` en `uploads.load_log`).
 *   org.hiring_tracking   el tablero de contrataciones, que se refresca al
 *                         subir el tablero de Monday.
 *   org.roster_change_log altas, bajas y cambios detectados entre dos cargas.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS DOS TABLAS QUE NO SE USAN, Y POR QUE NO
 * ---------------------------------------------------------------------------
 * `org.dim_employee` y `public.hr_active_roster` son rosters viejos mantenidos
 * A MANO: no se refrescan con las cargas, asi que una pantalla que se mantiene
 * sola no puede leerlos. Medido el 2026-09-17:
 *
 *   dim_employee        `synced_from_bigquery_at` en NULL en las 127 filas
 *   hr_active_roster    ultima subida 2026-08-07, y su `status` esta pegado al
 *                       pais -- Active/CO 44, Inactive/US 34, o sea que las 34
 *                       personas de USA figuran inactivas por venir de USA
 *
 * ⚠ Y `dim_employee` NO es lo mismo que un roster viejo a secas: sigue siendo
 * la fuente canonica para ATRIBUIR PRODUCCION, que es por donde cruzan Business
 * Plan y Outlook (`employee_key`). Lo que no es, es un roster de RRHH. Son dos
 * preguntas distintas y la respuesta correcta a una es falsa para la otra.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `branch_code` ACA ES EL BRANCH DEL ROSTER, NO DONDE LA PERSONA PRODUCE
 * ---------------------------------------------------------------------------
 * Es donde RRHH tiene asignada a la persona. Un loan officer puede originar
 * prestamos en otro branch, y de hecho pasa: Outlook ya tuvo que separar las
 * dos cosas --el YTD se atribuye al branch DEL PRESTAMO y la proyeccion al
 * branch del ROSTER-- porque mezclarlas producia un doble conteo que nadie veia
 * (ver `lib/outlook/loadData.ts`).
 *
 * ---------------------------------------------------------------------------
 * ⚠ SI ESTA PANTALLA APARECE VACIA, SON TRES CAUSAS DISTINTAS Y SE VEN IGUAL
 * ---------------------------------------------------------------------------
 *   sin GRANT a `authenticated`  ->  error "Could not find the table ... in the
 *                                    schema cache". PostgREST arma su cache con
 *                                    lo que el rol puede ver.
 *   con GRANT, sin politica RLS  ->  CERO FILAS y `error: null`. Indistinguible
 *                                    de una tabla vacia. ESTE es el peligroso.
 *   con las dos                  ->  las filas.
 *
 * RLS no rechaza: FILTRA. Por eso se guarda el error de cada lectura por
 * separado y la pantalla dice cual de los tres casos esta viendo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTA PANTALLA NO DA NI QUITA DE BAJA A NADIE
 * ---------------------------------------------------------------------------
 * Reporta. Lo unico que escribe es el `acknowledged` de una fila del log --
 * "ya lo vi", nunca "ya lo apliqué".
 */

export interface RosterPerson {
  person_code: string;
  display_name: string;
  name_in_file: string | null;
  country: string | null;
  branch_code: string | null;
  position: string | null;
  area: string | null;
  supervisor: string | null;
  supreme_email: string | null;
  is_active: boolean;
  source_kind: string | null;
  has_override: boolean;
  /** ⚠ SOLO Colombia: el archivo de USA no la trae (0 de 64 medido). */
  date_started: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  /** Cuando se detecto que ya no venia en el archivo. Por eso las bajas se conservan. */
  left_detected_at: string | null;
  synced_at: string;
  branch_is_active: boolean | null;
  branch_note: string | null;
  /**
   * ⚠ QUIEN PRODUCE — y NO se deduce del cargo.
   *
   * El cargo se equivoca en las dos direcciones, con un caso real de cada lado:
   * Aimmee Buendia Hinojosa es `LO ASSISTANT` y produce; July Castro es
   * `NonProducing Branch Manager` y produce. Por eso el indicador de Loan
   * Officers cuenta `is_producer` y no `position`.
   */
  is_producer: boolean;
  producer_set_by_hand: boolean;
  active_set_by_hand: boolean;
  /**
   * Realtor del programa NPPM.
   *
   * ⚠ Los 7 que lo tienen vienen con `is_producer = false` --medido, cero
   * solapamiento-- asi que NO se cuentan entre los Loan Officers: sumarlos en
   * los dos lados duplicaria el branch.
   */
  is_nppm_realtor: boolean;
}

/**
 * Una fila del tablero de contrataciones.
 *
 * ⚠ SE FILTRA POR `cuenta_como_proximo_ingreso` Y POR NADA MAS.
 *
 * Esa columna ya aplica la regla completa. Las otras dos que parecen servir, no
 * sirven, y medido hoy la diferencia no es teorica:
 *
 *   cuenta_como_proximo_ingreso    7      <- la que va
 *   es_nuevo                      17      <- 10 de mas: incluye canceladas y
 *                                            completadas, y el nombre invita a
 *                                            usarlo mal
 *   seccion                              texto del tablero, no una condicion
 */
export interface HiringRow {
  nombre: string;
  cargo: string | null;
  branch_en_el_tablero: string | null;
  fecha_inicio: string | null;
  person_code: string | null;
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

/** Un cargo y su gente. El orden lo decide la cantidad, no el alfabeto. */
export interface SeccionDeCargo {
  cargo: string;
  people: RosterPerson[];
}

/**
 * Los indicadores.
 *
 * ⚠ TODOS SOBRE LAS PERSONAS ACTIVAS, salvo `inactivas`, que es su complemento.
 *
 * El encuadre se nombra porque mezclarlo es facil y da un total que cuadra por
 * casualidad: `colombia (43) + usa incluyendo bajas (68)` da 111, que es
 * exactamente el total de activas -- por dos errores que se compensan, las 4
 * personas `CO/US` que quedarian afuera y las 4 bajas que entrarian. Dos
 * numeros correctos, una suma correcta, y una composicion que no es la que
 * dice ser.
 */
export interface Indicadores {
  activas: number;
  loanOfficers: number;
  nppm: number;
  colombia: number;
  usa: number;
  coUs: number;
  inactivas: number;
}

export interface AdminData {
  /** Solo activas, agrupadas por cargo. Las bajas se conservan y no se listan. */
  secciones: SeccionDeCargo[];
  indicadores: Indicadores;
  proximosIngresos: HiringRow[];
  changes: RosterChange[];
  /** `max(synced_at)` de cada fuente, que es lo que la pantalla muestra como "actualizado". */
  actualizado: { roster: string | null; contrataciones: string | null };
  diagnostics: {
    rosterRows: number;
    hiringRows: number;
    changeRows: number;
    rosterError: string | null;
    hiringError: string | null;
    changeError: string | null;
  };
}

/** Fecha corta y estable, sin depender de la zona horaria de quien mira. */
export function shortDate(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Fecha y hora, para el sello de actualizacion. */
export function shortDateTime(iso: string | null): string | null {
  return iso ? iso.slice(0, 16).replace('T', ' ') : null;
}

export const SIN_CARGO = '(sin cargo en el roster)';
export const SIN_BRANCH = '—';

export async function loadAdminData(): Promise<AdminData> {
  const org = getSupabaseClient().schema('org');

  /*
   * ⚠ Los tres errores se capturan y se MUESTRAN, no se tragan. Ver la nota de
   * las tres causas en la cabecera: cero filas con `error: null` es una policy
   * que no aplica, no una tabla vacia.
   */
  const [rosterRes, hiringRes, changeRes] = await Promise.all([
    org
      .from('roster_current')
      .select('*')
      .order('position', { ascending: true })
      .order('display_name', { ascending: true }),
    org
      .from('hiring_tracking')
      .select('nombre, cargo, branch_en_el_tablero, fecha_inicio, person_code, synced_at')
      .eq('cuenta_como_proximo_ingreso', true)
      .order('fecha_inicio', { ascending: true, nullsFirst: false })
      .order('nombre', { ascending: true }),
    org.from('roster_change_log').select('*').order('detected_at', { ascending: false }),
  ]);

  const people = (rosterRes.data ?? []) as RosterPerson[];
  const proximosIngresos = (hiringRes.data ?? []) as HiringRow[];
  const changes = (changeRes.data ?? []) as RosterChange[];

  const activas = people.filter((p) => p.is_active);

  /*
   * Las secciones salen del cargo tal como viene, sin normalizar.
   *
   * ⚠ Normalizarlo --mayusculas, plurales, sinonimos-- seria una regla sobre la
   * FORMA del texto, y juntaria cargos que RRHH escribe distinto porque SON
   * distintos: `Producing Branch Manager` y `NonProducing Branch Manager` se
   * parecen mas entre si que muchos de los que si son el mismo. Lo unico que se
   * hace es recortar los espacios del borde, que el archivo trae de mas.
   */
  const porCargo = new Map<string, RosterPerson[]>();
  for (const p of activas) {
    const cargo = p.position?.trim() || SIN_CARGO;
    porCargo.set(cargo, [...(porCargo.get(cargo) ?? []), p]);
  }

  const secciones: SeccionDeCargo[] = [...porCargo.entries()]
    .map(([cargo, list]) => ({
      cargo,
      people: [...list].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }))
    .sort((a, b) => {
      /* El grupo sin cargo va ultimo: no es un cargo que se llame vacio. */
      if (a.cargo === SIN_CARGO) return 1;
      if (b.cargo === SIN_CARGO) return -1;
      return b.people.length - a.people.length || a.cargo.localeCompare(b.cargo);
    });

  const pais = (p: RosterPerson) => (p.country ?? '').trim().toUpperCase();

  return {
    secciones,
    indicadores: {
      activas: activas.length,
      loanOfficers: activas.filter((p) => p.is_producer).length,
      nppm: activas.filter((p) => p.is_nppm_realtor).length,
      colombia: activas.filter((p) => pais(p) === 'CO').length,
      usa: activas.filter((p) => pais(p) === 'US').length,
      coUs: activas.filter((p) => pais(p) === 'CO/US').length,
      inactivas: people.length - activas.length,
    },
    proximosIngresos,
    changes,
    actualizado: {
      roster: people.reduce<string | null>((max, p) => (max === null || p.synced_at > max ? p.synced_at : max), null),
      contrataciones: proximosIngresos.reduce<string | null>(
        (max, h) => (max === null || h.synced_at > max ? h.synced_at : max),
        null
      ),
    },
    diagnostics: {
      rosterRows: people.length,
      hiringRows: proximosIngresos.length,
      changeRows: changes.length,
      rosterError: rosterRes.error?.message ?? null,
      hiringError: hiringRes.error?.message ?? null,
      changeError: changeRes.error?.message ?? null,
    },
  };
}

/**
 * Marca una fila del log como revisada.
 *
 * ⚠ `acknowledged_by` sale de la SESION, no de un campo -- mismo criterio que
 * `lib/outlook/save.ts`: si viniera del formulario, cualquiera podria firmar
 * con el nombre de otro, y la firma es la mitad del valor de guardar quien lo
 * reviso.
 *
 * Es lo UNICO que esta pantalla escribe, y no cambia el roster.
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
