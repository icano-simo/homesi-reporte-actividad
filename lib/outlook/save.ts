'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import type { Cadence, GrowthSegment, OutlookStrategy } from './project';

/*
 * ============================================================================
 * LA ESCRITURA DE OUTLOOK — un solo lugar (etapa OL2)
 * ============================================================================
 *
 * Tres funciones y ningún componente: los formularios arman el dato, esto lo
 * guarda. Está separado para que las cuatro reglas del modelo se puedan leer
 * juntas en vez de estar repartidas en tres pantallas.
 *
 * ---------------------------------------------------------------------------
 * 1. NUNCA SE ACTUALIZA NADA. Ni acá ni desde ningún lado.
 * ---------------------------------------------------------------------------
 * No hay una sola llamada a `.update()` ni a `.delete()` en este archivo, y no
 * es una convención que alguien pueda romper de buena fe: las tres tablas de
 * `outlook` tienen RLS con políticas de SELECT e INSERT y NINGUNA de UPDATE o
 * DELETE. Un `.update()` escrito acá mañana no rompería la historia, devolvería
 * un error. La base es la que garantiza el append-only; este archivo sólo se
 * abstiene de pelearse con ella.
 *
 * ---------------------------------------------------------------------------
 * 2. `set_by` SALE DE LA SESIÓN, NO DEL FORMULARIO.
 * ---------------------------------------------------------------------------
 * Mismo criterio que `BenchmarkEditor` del Business Plan. Si el autor viniera
 * de un campo, cualquiera podría firmar una decisión con el nombre de otro, y
 * la firma es la mitad del valor de guardar la historia.
 *
 * ---------------------------------------------------------------------------
 * 3. EL BENCHMARK RIGE DESDE EL PRIMER DÍA DEL MES SIGUIENTE.
 * ---------------------------------------------------------------------------
 * Lo calcula `effectiveFrom` de `loadOutlookData` y lo manda la app. El CHECK de
 * la base exige día 1 pero no puede exigir "mes siguiente": eso depende de
 * cuándo se mire y fijarlo en el esquema congelaría una fecha. Entonces la
 * garantía es de acá, y queda visible en el dato guardado.
 *
 * El motivo no es formal: el mes en curso ya se está midiendo contra el
 * benchmark anterior. Cambiarlo a mitad de camino reescribe la vara con la que
 * alguien ya está siendo evaluado.
 *
 * ---------------------------------------------------------------------------
 * 4. UNA EDICIÓN DE REGLA ES UNA REVISIÓN NUEVA Y COMPLETA.
 * ---------------------------------------------------------------------------
 * Los tramos de una regla se leen todos juntos o no se leen: "25% trimestral
 * desde septiembre, 10% mensual desde noviembre" es UNA decisión con dos
 * tramos. Guardar tramo por tramo haría imposible quitar uno sin borrar filas.
 *
 * Así que cada edición inserta la lista entera con `revision = max + 1`, y el
 * lector toma la revisión más alta (ver `loadData.ts`). Las anteriores quedan
 * enteras y legibles.
 */

/** Las cuatro que se editan acá. 'Own Production' no entra — ver `saveStrategyBenchmark`. */
export type EditableStrategy = Exclude<OutlookStrategy, 'Own Production'>;

/** El correo de la sesión. Es la firma de la decisión, y sin él no se guarda. */
async function authorEmail(): Promise<string> {
  const { data } = await getSupabaseClient().auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error('No hay sesión activa: nadie a quien atribuir esta decisión.');
  return email;
}

/**
 * Traduce el error de Postgres a algo que se pueda leer en la pantalla.
 *
 * ⚠ Los tres casos que importan son garantías del modelo, no fallas: si alguno
 * aparece, el mensaje tiene que explicar QUÉ regla se activó, porque el error
 * crudo de PostgREST ('violates check constraint ...') no le dice nada a quien
 * está cargando un presupuesto.
 */
function readable(err: { code?: string; message: string }): Error {
  if (err.code === '23514') {
    return new Error(
      'La base rechazó el valor. Las restricciones que aplican: el benchmark no puede ser negativo, ' +
        'la fecha tiene que ser el día 1 de un mes, el crecimiento no puede bajar de -100%, y ' +
        '"Own Production" no se puede guardar acá — su benchmark vive en org.employee_benchmark.'
    );
  }
  if (err.code === '23505') {
    return new Error(
      'Alguien más guardó una revisión de esta regla mientras editabas. Recargá la pantalla y volvé a aplicar el cambio ' +
        'sobre la última versión, para no tapar su decisión con la tuya.'
    );
  }
  if (err.code === '42501' || /permission denied|row-level security/i.test(err.message)) {
    return new Error('Tu sesión no tiene el permiso `outlook`, así que puede leer pero no guardar.');
  }
  return new Error(err.message);
}

/**
 * El benchmark mensual de una estrategia para un Loan Officer.
 *
 * ⚠ 'Own Production' NO es un caso que falte implementar: el CHECK de la tabla
 * lo prohíbe a propósito, porque ese benchmark ya vive en
 * `org.employee_benchmark` y se edita en el perfil del Business Plan. Si esta
 * tabla pudiera guardarlo habría dos valores para el mismo dato y ninguna forma
 * de saber cuál manda. El tipo `EditableStrategy` lo deja fuera en compilación;
 * la base lo deja fuera en ejecución. Las dos barreras son a propósito: la
 * primera evita el error, la segunda lo hace imposible.
 */
export async function saveStrategyBenchmark(input: {
  employeeKey: number;
  strategy: EditableStrategy;
  monthlyBenchmark: number;
  /** El primer día del mes siguiente. Lo provee `OutlookData.effectiveFrom`. */
  effectiveFrom: string;
  note: string | null;
}): Promise<void> {
  const set_by = await authorEmail();
  const { error } = await getSupabaseClient().schema('outlook').from('strategy_benchmark').insert({
    employee_key: input.employeeKey,
    strategy: input.strategy,
    monthly_benchmark: input.monthlyBenchmark,
    effective_from: input.effectiveFrom,
    set_by,
    note: input.note,
  });
  if (error) throw readable(error);
}

/**
 * El benchmark de un realtor NPPM, por NOMBRE.
 *
 * Es la única clave que existe: un NPPM no es empleado y no tiene código. Y es
 * del realtor, no del par (realtor, Loan Officer) — el mismo realtor trabaja con
 * varias personas y en varias branches, y decidir cuánto "le toca" a cada una
 * es justamente la asignación que este módulo no construye.
 *
 * Se guarda el nombre TAL COMO VIENE de los datos y la comparación se hace
 * normalizando en la app, igual que `aliasIndex`: los datos traen 'FRED A GOMEZ'
 * y 'Fred A Gomez' para la misma persona.
 */
export async function saveNppmBenchmark(input: {
  nppmRealtor: string;
  monthlyBenchmark: number;
  effectiveFrom: string;
  note: string | null;
}): Promise<void> {
  const set_by = await authorEmail();
  const { error } = await getSupabaseClient().schema('outlook').from('nppm_benchmark').insert({
    nppm_realtor: input.nppmRealtor,
    monthly_benchmark: input.monthlyBenchmark,
    effective_from: input.effectiveFrom,
    set_by,
    note: input.note,
  });
  if (error) throw readable(error);
}

/**
 * Una revisión nueva y completa de la regla de crecimiento de (persona,
 * estrategia). Acá SÍ entra 'Own Production': su benchmark se lee de otra tabla,
 * pero cuánto crece se decide en este módulo como las otras cuatro.
 *
 * @returns la revisión que quedó escrita.
 */
export async function saveGrowthRuleRevision(input: {
  employeeKey: number;
  strategy: OutlookStrategy;
  segments: GrowthSegment[];
  note: string | null;
}): Promise<number> {
  if (input.segments.length === 0) {
    /*
     * Una revisión sin tramos no se puede representar: la revisión existe porque
     * existen sus filas. "Que no crezca" se dice con un tramo de 0% --el CHECK
     * lo admite explícitamente, es una meseta-- y así queda firmado quién lo
     * decidió, que es lo que una revisión fantasma no podría contar.
     */
    throw new Error('Una regla necesita al menos un tramo. Para que no crezca, poné 0%.');
  }

  const set_by = await authorEmail();
  const supabase = getSupabaseClient();

  /*
   * ⚠ La revisión siguiente se lee de la BASE, no de lo que la pantalla tenía
   * cargado. Entre que se abrió el editor y que se apretó Guardar puede haber
   * pasado la edición de otra persona, y escribir `revision + 1` sobre un número
   * viejo tiraría dos revisiones distintas con el mismo número.
   *
   * Y si aun así hay carrera --dos guardados en el mismo instante-- el UNIQUE
   * (employee_key, strategy, revision, segment_order) la corta y el segundo
   * recibe el 23505 que `readable` traduce a "recargá y volvé a aplicar". La
   * lectura evita el choque en el caso normal; la restricción lo hace imposible
   * en el caso raro.
   */
  const { data: existing, error: readError } = await supabase
    .schema('outlook')
    .from('growth_rule')
    .select('revision')
    .eq('employee_key', input.employeeKey)
    .eq('strategy', input.strategy)
    .order('revision', { ascending: false })
    .limit(1);
  if (readError) throw readable(readError);
  const revision = (existing?.[0]?.revision ?? 0) + 1;

  const rows = input.segments.map((seg, i) => ({
    employee_key: input.employeeKey,
    strategy: input.strategy,
    revision,
    segment_order: i + 1,
    from_month: seg.fromMonth + '-01',
    cadence: seg.cadence as Cadence,
    growth_pct: seg.growthPct,
    set_by,
    note: input.note,
  }));

  /*
   * Un solo INSERT con todas las filas: PostgREST lo manda como una sentencia y
   * Postgres la corre en una transacción. Que la revisión entre entera o no
   * entre importa, porque media revisión guardada es una regla que dice algo que
   * nadie decidió.
   */
  const { error } = await supabase.schema('outlook').from('growth_rule').insert(rows);
  if (error) throw readable(error);
  return revision;
}
