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

/**
 * Una persona en proceso de contratacion — `activity_report.future_loan_officer`.
 *
 * ⚠ ESA TABLA YA JUNTA LAS DOS FUENTES, y por eso se lee ella y no las dos por
 * separado: `origen` dice de cual viene y `confianza` que tan firme es. Medido
 * el 2026-09-18, los 21:
 *
 *   hr_pipeline · confirmado    7    los 7 con `fecha_inicio`, ninguno con close
 *   salesforce  · probable      9    los 9 con `close_date`, ninguno con inicio
 *   salesforce  · ganado        2    idem
 *   salesforce  · tentative     3    idem, y sus close son de 2024 y 2025
 *
 * ⚠ LAS DOS FECHAS NO SON LA MISMA COSA Y NO SE PUEDEN MEZCLAR EN UNA COLUMNA.
 * `fecha_inicio` es el dia que la persona empieza; `close_date` es la fecha
 * ESPERADA de cierre de una oportunidad de Salesforce. Ponerlas juntas bajo un
 * rotulo comun --"fecha"-- haria que 21 filas se lean como 21 ingresos, que es
 * exactamente lo que este bloque tiene que evitar.
 */
export interface ReclutaRow {
  nombre: string;
  origen: string;
  confianza: string;
  cargo: string | null;
  branch_code: string | null;
  /** Solo `hr_pipeline`: el dia que empieza. */
  fecha_inicio: string | null;
  /** Solo `salesforce`: la fecha ESPERADA de cierre, no de ingreso. */
  close_date: string | null;
  synced_at: string;
}

/**
 * Un grupo del bloque de reclutamiento: una fuente y una confianza.
 *
 * El grupo es la unidad porque la fuente decide QUE FECHA se muestra. Una lista
 * plana con una columna de fecha obligaria a elegir una de las dos, y la que
 * quede afuera se leeria como un dato faltante y no como otro dato.
 */
export interface GrupoDeReclutamiento {
  origen: string;
  confianza: string;
  /** `inicio` = empieza ese dia. `close` = se espera cerrar ese dia. */
  fecha: 'inicio' | 'close';
  gente: ReclutaRow[];
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

/**
 * Un branch y su gente. El orden lo decide la cantidad, no el alfabeto.
 *
 * ⚠ AGRUPAR POR BRANCH Y NO POR CARGO tiene una consecuencia buena que conviene
 * dejar dicha: son 15 grupos y no 42. Agrupar por cargo daba 24 secciones de una
 * sola persona sobre 42, o sea media pagina de encabezados -- y juntarlos habria
 * pedido una regla sobre como se ESCRIBE el cargo, que es el error que este repo
 * lleva documentado cuatro veces. El branch no tiene ese problema: es un codigo.
 */
export interface BranchDelRoster {
  branchCode: string;
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
  /** Solo activas, agrupadas por branch. Las bajas se conservan y no se listan. */
  branches: BranchDelRoster[];
  indicadores: Indicadores;
  /** Los 21 en proceso, agrupados por fuente y confianza. */
  reclutamiento: GrupoDeReclutamiento[];
  changes: RosterChange[];
  /** `max(synced_at)` de cada fuente, que es lo que la pantalla muestra como "actualizado". */
  actualizado: { roster: string | null; reclutamiento: string | null };
  diagnostics: {
    rosterRows: number;
    reclutaRows: number;
    changeRows: number;
    rosterError: string | null;
    reclutaError: string | null;
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
/** Lo que se dibuja en el lugar de un dato que no vino. */
export const SIN_BRANCH = '—';
/** El grupo de quien no trae branch. Hoy no hay ninguno, y la rama se queda. */
export const SIN_BRANCH_GRUPO = '(sin branch en el roster)';

/**
 * Cuanto hace de una fecha, en meses redondeados hacia abajo.
 *
 * ⚠ NOMBRA, NO INTERPRETA. Devuelve "hace 15 meses", no "probablemente
 * abandonado": lo segundo es una afirmacion de negocio, y una afirmacion al
 * lado de un numero hay que poder sostenerla en todos los casos donde se
 * enciende. Que 15 meses es mucho lo decide quien mira.
 */
export function haceCuanto(iso: string | null, hoy = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const meses =
    (hoy.getUTCFullYear() - d.getUTCFullYear()) * 12 + (hoy.getUTCMonth() - d.getUTCMonth());
  /* ⚠ Una fecha futura no es "hace 0 meses". Hoy los 14 `close_date` van de
     2024-06 a 2026-09, pero nada impide que manana entre una de 2027, y
     "hace -3 meses" seria un numero que dice lo contrario de lo que pasa. */
  if (meses < 0) return meses === -1 ? 'en 1 mes' : 'en ' + -meses + ' meses';
  if (meses === 0) return 'este mes';
  if (meses === 1) return 'hace 1 mes';
  return 'hace ' + meses + ' meses';
}

/**
 * El orden de los grupos de reclutamiento, del mas firme al mas dudoso.
 *
 * ⚠ ESCRITO A MANO Y NO DERIVADO DEL DATO. Ordenar por cantidad pondria los 9
 * `probable` arriba de los 7 `confirmado`, y lo que decide la lectura no es
 * cuantos hay sino que tan firme es cada grupo. Un valor que no este en esta
 * lista va al final y se ve: no se descarta.
 */
const ORDEN_CONFIANZA = ['confirmado', 'ganado', 'probable', 'tentative'];

export async function loadAdminData(): Promise<AdminData> {
  const supabase = getSupabaseClient();
  const org = supabase.schema('org');

  /*
   * ⚠ Los tres errores se capturan y se MUESTRAN, no se tragan. Ver la nota de
   * las tres causas en la cabecera: cero filas con `error: null` es una policy
   * que no aplica, no una tabla vacia.
   */
  const [rosterRes, reclutaRes, changeRes] = await Promise.all([
    org
      .from('roster_current')
      .select('*')
      .order('branch_code', { ascending: true })
      .order('display_name', { ascending: true }),
    supabase
      .schema('activity_report')
      .from('future_loan_officer')
      .select('nombre, origen, confianza, cargo, branch_code, fecha_inicio, close_date, synced_at')
      .order('nombre', { ascending: true }),
    org.from('roster_change_log').select('*').order('detected_at', { ascending: false }),
  ]);

  const people = (rosterRes.data ?? []) as RosterPerson[];
  const reclutas = (reclutaRes.data ?? []) as ReclutaRow[];
  const changes = (changeRes.data ?? []) as RosterChange[];

  const activas = people.filter((p) => p.is_active);

  const porBranch = new Map<string, RosterPerson[]>();
  for (const p of activas) {
    const code = p.branch_code?.trim() || SIN_BRANCH_GRUPO;
    porBranch.set(code, [...(porBranch.get(code) ?? []), p]);
  }

  const branches: BranchDelRoster[] = [...porBranch.entries()]
    .map(([branchCode, list]) => ({
      branchCode,
      people: [...list].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }))
    .sort((a, b) => {
      /* El grupo sin branch va ultimo: no es un branch que se llame vacio. */
      if (a.branchCode === SIN_BRANCH_GRUPO) return 1;
      if (b.branchCode === SIN_BRANCH_GRUPO) return -1;
      return b.people.length - a.people.length || a.branchCode.localeCompare(b.branchCode);
    });

  /*
   * Los grupos de reclutamiento. La clave es `origen + confianza` porque las dos
   * juntas son lo que decide que fecha significa algo, y el grupo se queda con
   * la que su fuente llena: `hr_pipeline` trae inicio, `salesforce` trae close.
   */
  const porGrupo = new Map<string, ReclutaRow[]>();
  for (const r of reclutas) {
    const clave = (r.origen ?? '?') + ' ' + (r.confianza ?? '?');
    porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), r]);
  }
  const reclutamiento: GrupoDeReclutamiento[] = [...porGrupo.entries()]
    .map(([clave, gente]) => {
      const [origen, confianza] = clave.split(' ');
      return {
        origen,
        confianza,
        fecha: (origen === 'hr_pipeline' ? 'inicio' : 'close') as 'inicio' | 'close',
        gente: [...gente].sort((a, b) => (a.fecha_inicio ?? a.close_date ?? '').localeCompare(b.fecha_inicio ?? b.close_date ?? '')),
      };
    })
    .sort((a, b) => {
      const ia = ORDEN_CONFIANZA.indexOf(a.confianza);
      const ib = ORDEN_CONFIANZA.indexOf(b.confianza);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.origen.localeCompare(b.origen);
    });

  const pais = (p: RosterPerson) => (p.country ?? '').trim().toUpperCase();

  return {
    branches,
    indicadores: {
      activas: activas.length,
      loanOfficers: activas.filter((p) => p.is_producer).length,
      nppm: activas.filter((p) => p.is_nppm_realtor).length,
      colombia: activas.filter((p) => pais(p) === 'CO').length,
      usa: activas.filter((p) => pais(p) === 'US').length,
      coUs: activas.filter((p) => pais(p) === 'CO/US').length,
      inactivas: people.length - activas.length,
    },
    reclutamiento,
    changes,
    actualizado: {
      roster: people.reduce<string | null>((max, p) => (max === null || p.synced_at > max ? p.synced_at : max), null),
      reclutamiento: reclutas.reduce<string | null>(
        (max, r) => (max === null || r.synced_at > max ? r.synced_at : max),
        null
      ),
    },
    diagnostics: {
      rosterRows: people.length,
      reclutaRows: reclutas.length,
      changeRows: changes.length,
      rosterError: rosterRes.error?.message ?? null,
      reclutaError: reclutaRes.error?.message ?? null,
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
