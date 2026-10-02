'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import {
  cambiosHuerfanos,
  esNivel,
  filasDeLaVersion,
  ordenarBranches,
  seccionesDeBranch,
  type CambioPedido,
  type Grilla,
  type MarginRow,
  type RosterParaBranches,
  type SeccionesDeBranch,
} from './margins-modelo';

/*
 * ============================================================================
 * MARGINS — la lectura y la escritura (etapa ADM3)
 * ============================================================================
 *
 * El MODELO --la grilla vigente y el historial-- vive en `margins-modelo.ts`,
 * que es puro y tiene su propia prueba. Acá queda lo que toca la red.
 *
 * ---------------------------------------------------------------------------
 * ⚠ HAY QUE LLAMAR A `.schema('margins')`
 * ---------------------------------------------------------------------------
 * El esquema está en `pgrst.db_schemas` --verificado el 2026-10-01-- pero no es
 * `public`, así que sin esa llamada PostgREST contesta que la tabla no existe.
 * No es un permiso que falte: es que se está preguntando en otro esquema.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SE LEE LA TABLA BASE, NO LA VISTA
 * ---------------------------------------------------------------------------
 * `branch_margin_vigente` contesta «cuánto vale hoy», que es lo que necesita
 * quien consume el margen. Esta pantalla necesita además el historial --que es
 * la relación entre versiones-- y la grilla completa que un guardado reescribe.
 * Las tres salen de la misma lectura.
 */

export {
  NIVELES,
  esMarcadorDeReclutamiento,
  grillaVigente,
  historial,
  seccionesDeBranch,
  type RosterParaBranches,
  type SeccionesDeBranch,
  type Celda,
  type Grilla,
  type Linea,
  type LineaDeHistorial,
  type MarginRow,
  type Nivel,
  type CambioPedido,
  type VersionDeHistorial,
} from './margins-modelo';

export interface MarginsData {
  /** Los branches que hay, ordenados. */
  branches: string[];
  /** Las tres secciones, derivadas del roster. Ver `seccionesDeBranch`. */
  secciones: SeccionesDeBranch;
  /**
   * El error de la lectura del roster, por separado del de los márgenes.
   *
   * ⚠ Y SE DISTINGUE DE «el roster vino vacío». Sin roster, TODOS los branches
   * caen en inactivo por la regla --nadie tiene productores-- y la pantalla
   * diría que la división entera dejó de operar. Un error que no se dice es una
   * afirmación falsa con forma de dato.
   */
  rosterError: string | null;
  /** Cuántas filas de roster llegaron. Cero con `error: null` es una policy. */
  rosterFilas: number;
  /** Todas las filas, por branch, ya saneadas. */
  porBranch: Map<string, MarginRow[]>;
  /** Cuántas filas se descartaron por no tener `version_num`. */
  sinVersion: number;
  /** Cuántas filas vienen de una edición de la app. Enciende el aviso. */
  deLaApp: number;
  /** Cuántas filas llegaron en total. Distingue «vacío» de «no llegó». */
  filas: number;
  /** El error de la lectura, dicho y no tragado. */
  error: string | null;
}

export async function loadMargins(): Promise<MarginsData> {
  const supabase = getSupabaseClient();
  /*
   * ⚠ LAS DOS LECTURAS VAN EN PARALELO Y CON SU ERROR CADA UNA. El roster no
   * depende de los márgenes, y mezclar los dos errores haría que una policy que
   * no aplica en `org.roster_current` se leyera como un problema de márgenes.
   *
   * `org.roster_current` tiene policy para `admin` --`roster_v2_admin`--, así
   * que esta pantalla la lee con el claim que ya tiene. Verificado en el
   * catálogo, no supuesto.
   */
  const [res, rosterRes] = await Promise.all([
    supabase
      .schema('margins')
      .from('branch_margin')
      .select(
        'margin_key, branch_code, loan_type, tipo_de_margen, version, version_num, ' +
          'valor_bps, origen, changed_by, changed_at, reason'
      )
      .order('branch_code', { ascending: true })
      .order('loan_type', { ascending: true })
      .order('version_num', { ascending: true }),
    supabase.schema('org').from('roster_current').select('branch_code, is_producer, is_active'),
  ]);

  /*
   * ⚠ LOS TRES CASOS SE DISTINGUEN, igual que en el roster. Con RLS, una policy
   * que no aplica devuelve CERO FILAS y `error: null`, que es indistinguible de
   * una tabla vacía si la pantalla no los separa. Y acá hay un caso concreto
   * esperando: la policy de SELECT pedía `homesi`, `outlook` o `analytics`, no
   * `admin` -- el SQL de esta etapa la agrega, y hasta que se aplique alguien
   * con `admin` solo ve esta pantalla vacía y sin error.
   */
  const error = res.error ? res.error.message : null;
  /*
   * ⚠ `as unknown as` y no `as` a secas: sin tipos generados, PostgREST tipa el
   * `data` de un `select` con columnas nombradas como `GenericStringError[]`, y
   * TypeScript tiene razón en que no se parece a `MarginRow`. El doble paso dice
   * «sé que esto no se puede comprobar acá», que es justo lo que pasa: lo que
   * garantiza la forma es el `select` de arriba, no el tipo.
   */
  const crudas = (res.data ?? []) as unknown as MarginRow[];

  const porBranch = new Map<string, MarginRow[]>();
  const codigos = new Set<string>();
  let sinVersion = 0;
  let deLaApp = 0;

  for (const f of crudas) {
    if (f.version_num === null || !esNivel(f.tipo_de_margen)) {
      sinVersion++;
      continue;
    }
    if (f.origen !== 'archivo') deLaApp++;
    codigos.add(f.branch_code);
    porBranch.set(f.branch_code, [...(porBranch.get(f.branch_code) ?? []), f]);
  }

  const roster = (rosterRes.error ? [] : (rosterRes.data ?? [])) as unknown as RosterParaBranches[];
  const branches = ordenarBranches(codigos);

  return {
    branches,
    secciones: seccionesDeBranch(branches, roster),
    rosterError: rosterRes.error ? rosterRes.error.message : null,
    rosterFilas: roster.length,
    porBranch,
    sinVersion,
    deLaApp,
    filas: crudas.length,
    error,
  };
}

export interface Guardado {
  error: string | null;
  versionNum: number | null;
  filas: number;
}

/**
 * ============================================================================
 * GUARDAR — una versión nueva con la grilla COMPLETA
 * ============================================================================
 *
 * ⚠ VA EN UN SOLO `insert`. Las 28 o 42 filas entran en una sentencia, así que
 * si dos guardados del mismo branch se cruzan, el segundo choca con la PK
 * --`branch|tipo|nivel|version`-- y falla ENTERO. Veintiocho inserts sueltos
 * dejarían media versión escrita, que es peor que no escribir: la vista tomaría
 * lo nuevo para unas líneas y lo viejo para otras, y las dos mitades serían
 * números correctos.
 */
export async function guardarVersion(
  branchCode: string,
  grilla: Grilla,
  cambios: CambioPedido[],
  motivo: string,
  autor: string
): Promise<Guardado> {
  /*
   * ⚠ Un cambio que no cae sobre una línea vigente se rechaza ACÁ y no se
   * ignora. Escribir una línea que el branch no tiene es inventarle una fila
   * --`Region` a un branch que no la tiene-- y lo que se vería después es una
   * columna que nadie pidió, con un valor que nadie puede explicar.
   */
  const huerfanos = cambiosHuerfanos(grilla, cambios);
  if (huerfanos.length > 0) {
    return {
      error:
        'These lines do not exist for branch ' +
        branchCode +
        ': ' +
        huerfanos.map((h) => h.loanType + ' / ' + h.nivel).join(', '),
      versionNum: null,
      filas: 0,
    };
  }

  const filas = filasDeLaVersion(
    branchCode,
    grilla,
    cambios,
    motivo,
    autor,
    new Date().toISOString()
  );

  const res = await getSupabaseClient()
    .schema('margins')
    .from('branch_margin')
    .insert(filas)
    .select('margin_key');

  if (res.error) return { error: res.error.message, versionNum: null, filas: 0 };

  /*
   * ⚠ Y SE CUENTA LO QUE TOCÓ. `select` después del insert devuelve las filas
   * escritas: un insert que no escribe nada y uno que escribió las 28 se ven
   * igual si nadie los cuenta, y eso en este repo ya costó una vez.
   */
  const escritas = (res.data ?? []).length;
  const versionNum = grilla.versionMaxima + 1;
  if (escritas !== filas.length) {
    return {
      error: 'Saved ' + escritas + ' of ' + filas.length + ' lines. The version is incomplete.',
      versionNum,
      filas: escritas,
    };
  }
  return { error: null, versionNum, filas: escritas };
}

/** El correo de la sesión, que es lo que va en `changed_by`. */
export async function correoDeLaSesion(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getUser();
  return data.user?.email ?? null;
}
