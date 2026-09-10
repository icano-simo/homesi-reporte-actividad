'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import type { Cadence, GrowthSegment, OutlookStrategy, ProjectionMode } from './project';
import type { BudgetBucket } from './loadData';

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
  if (!email) throw new Error('No active session: there is nobody to attribute this decision to.');
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
/**
 * ⚠ `opts` EXISTE PARA QUE ESTA FUNCIÓN SIRVA A MÁS DE UNA ETAPA — etapa OL26.
 * Los mensajes de 23514 y PGRST205 nombraban las restricciones y el archivo
 * SQL de OL4 a secas, que era correcto mientras sólo OL4 los usaba. El
 * presupuesto compuesto tiene sus propias restricciones (el sujeto XOR, los
 * buckets de un realtor) y su propio SQL -- sin `opts`, sus errores habrían
 * mostrado "Own Production no se puede guardar acá" para un problema que no
 * tiene nada que ver con Own Production. Sin override, los dos mensajes caen
 * a los de OL4, así que ningún llamado existente cambia.
 */
function readable(err: { code?: string; message: string }, opts?: { sqlFile?: string; checkMessage?: string }): Error {
  if (err.code === '23514') {
    return new Error(
      opts?.checkMessage ??
        'The database rejected this value. The constraints that apply: a benchmark cannot be negative, ' +
          'a date must be the 1st of a month, growth cannot go below -100%, and ' +
          '"Own Production" cannot be stored here — its benchmark lives in org.employee_benchmark.'
    );
  }
  if (err.code === '23505') {
    return new Error(
      'Someone else saved a revision while you were editing. Reload and apply your change on top of the latest ' +
        'version, so you do not overwrite their decision with yours.'
    );
  }
  /*
   * PGRST205: la tabla no está en el cache de esquema de PostgREST, o sea que no
   * existe. Pasa con las dos tablas de OL4 hasta que se aplique su SQL, y el
   * mensaje crudo --"Could not find the table in the schema cache"-- no le dice
   * a nadie qué hacer. Este sí.
   */
  if (err.code === 'PGRST205' || /Could not find the table/i.test(err.message)) {
    return new Error(
      `This stage's SQL has not been applied yet: ${opts?.sqlFile ?? 'docs/sql/2026-08-outlook-monthly-mode.sql'}. ` +
        'Nothing was saved and the projection did not change.'
    );
  }
  if (err.code === '42501' || /permission denied|row-level security/i.test(err.message)) {
    return new Error('Your session does not have the `outlook` claim, so it can read but not save.');
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
/**
 * ============================================================================
 * ⚠ DE QUIÉN ES UNA DECISIÓN: de una persona o de un branch — etapa OL11
 * ============================================================================
 *
 * Es una unión discriminada y NO un objeto con los dos campos opcionales, para
 * que el mismo error que la base rechaza sea IMPOSIBLE de escribir acá. Las
 * cuatro tablas de `outlook` tienen un CHECK
 * `(employee_key is not null) <> (branch_code is not null)`: exactamente uno.
 * Con dos opcionales, pasar los dos o ninguno compila y falla en runtime como
 * un 23514 que hay que traducir; con la unión, no compila.
 *
 * Es el mismo criterio que el CHECK que prohíbe 'Own Production' en
 * `strategy_benchmark`: convertir una convención en una imposibilidad.
 */
export type OutlookSubject =
  | { kind: 'employee'; employeeKey: number }
  | { kind: 'branch'; branchCode: string };

/** Las columnas del sujeto para un INSERT. Exactamente una, como el CHECK. */
function subjectColumns(s: OutlookSubject): { employee_key: number } | { branch_code: string } {
  return s.kind === 'employee' ? { employee_key: s.employeeKey } : { branch_code: s.branchCode };
}

/**
 * La columna y el valor por los que se filtra al sujeto.
 *
 * ⚠ Devuelve el par y no la query ya filtrada: envolver el builder de Supabase
 * en un genérico hace explotar su inferencia --`Type instantiation is
 * excessively deep`, medido-- así que el `.eq()` lo aplica quien arma la
 * consulta.
 *
 * ⚠ Un `.eq('employee_key', k)` no ve las filas de branch --su `employee_key` es
 * NULL y en SQL NULL no es igual a nada-- así que los dos sujetos no pueden
 * leerse la revisión el uno al otro ni por accidente.
 */
function subjectFilter(s: OutlookSubject): [string, string | number] {
  return s.kind === 'employee' ? ['employee_key', s.employeeKey] : ['branch_code', s.branchCode];
}

export async function saveStrategyBenchmark(input: {
  subject: OutlookSubject;
  strategy: EditableStrategy;
  monthlyBenchmark: number;
  /** El primer día del mes siguiente. Lo provee `OutlookData.effectiveFrom`. */
  effectiveFrom: string;
  note: string | null;
}): Promise<void> {
  const set_by = await authorEmail();
  const { error } = await getSupabaseClient().schema('outlook').from('strategy_benchmark').insert({
    ...subjectColumns(input.subject),
    strategy: input.strategy,
    monthly_benchmark: input.monthlyBenchmark,
    effective_from: input.effectiveFrom,
    set_by,
    note: input.note,
  });
  if (error) throw readable(error);
}

/**
 * El benchmark de un realtor NPPM, POR `realtor_code`.
 *
 * Es del realtor, no del par (realtor, Loan Officer) — el mismo realtor trabaja
 * con varias personas y en varias branches, y decidir cuánto "le toca" a cada
 * una es justamente la asignación que este módulo no construye.
 *
 * ⚠ ANTES LA CLAVE ERA EL NOMBRE, y por eso se guardaba tal como venía y se
 * comparaba normalizando en la app. Eso no alcanzaba: los nombres llegan crudos
 * de Salesforce y la normalización unía 'fred gomez' con 'FRED GOMEZ' pero no
 * 'FRED A GOMEZ' con 'FRED GOMEZ'. Dos personas guardando desde grafías
 * distintas creaban dos filas del mismo NPPM, sin fallar y con las dos filas
 * viéndose plausibles.
 *
 * SE ESCRIBEN LAS TRES COLUMNAS, y ninguna sobra:
 *
 *   realtor_code   la clave. Inmutable, de `dim_nppm_realtor_v2`.
 *   display_name   el nombre de la dimensión. Es el del MOMENTO en que se
 *                  guardó, y por eso se persiste en vez de resolverse al leer:
 *                  sirve para reconocer la fila si algún día hay que auditar.
 *   nppm_realtor   el MISMO `display_name`, porque la columna sigue siendo NOT
 *                  NULL y hay que mandar algo.
 *
 * ⚠ POR QUÉ EN `nppm_realtor` VA EL DISPLAY Y NO EL NOMBRE CRUDO. La copia de
 * auditoría sirve para contestar "de quién es esta fila", y para eso el nombre
 * canónico es mejor que la grafía de Salesforce: la fila ya no se crea DESDE una
 * grafía, se crea desde un código. Guardar el crudo reproduciría el desorden que
 * el código vino a resolver, en la única columna que quedaba libre de él.
 *
 * Cuando corra el `DROP NOT NULL` sobre `nppm_realtor`, esta escritura se puede
 * quitar y la columna queda sólo con las filas históricas -- que hoy son cero.
 */
export async function saveNppmBenchmark(input: {
  /** La clave. Sin esto la fila no se puede ubicar al leer. */
  realtorCode: string;
  /** El nombre de la dimensión, tal como se ve hoy. */
  displayName: string;
  monthlyBenchmark: number;
  effectiveFrom: string;
  note: string | null;
}): Promise<void> {
  /*
   * Una guarda redundante, y a propósito: sin `realtor_code` la fila entra --la
   * columna es nullable-- y el loader no la puede ubicar, así que el benchmark
   * queda guardado y la pantalla no lo muestra. Un fallo sin síntoma. Que falle
   * acá y ruidosamente es mejor que descubrirlo cuando alguien pregunte por qué
   * su número no aparece.
   */
  if (!input.realtorCode.trim()) {
    throw new Error(
      'No se puede guardar un benchmark de NPPM sin realtor_code: la fila ' +
        'quedaría escrita y la pantalla no la mostraría.'
    );
  }

  const set_by = await authorEmail();
  const { error } = await getSupabaseClient().schema('outlook').from('nppm_benchmark').insert({
    realtor_code: input.realtorCode,
    display_name: input.displayName,
    /* NOT NULL todavía; el mismo display. Ver la nota de arriba. */
    nppm_realtor: input.displayName,
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
  subject: OutlookSubject;
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
    throw new Error('A rule needs at least one segment. For no growth, use 0%.');
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
  const [subjCol, subjVal] = subjectFilter(input.subject);
  const { data: existing, error: readError } = await supabase
    .schema('outlook')
    .from('growth_rule')
    .select('revision')
    .eq(subjCol, subjVal)
    .eq('strategy', input.strategy)
    .order('revision', { ascending: false })
    .limit(1);
  if (readError) throw readable(readError);
  const revision = (existing?.[0]?.revision ?? 0) + 1;

  const rows = input.segments.map((seg, i) => ({
    ...subjectColumns(input.subject),
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

/*
 * ============================================================================
 * EL SEGUNDO MODO — meses fijados a mano (etapa OL4)
 * ============================================================================
 *
 * Mismas cuatro reglas de arriba: nunca se actualiza, `set_by` sale de la
 * sesión, rige desde el mes siguiente y una edición es una revisión nueva y
 * completa.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SON DOS INSERTS EN DOS TABLAS, Y EL ORDEN IMPORTA
 * ---------------------------------------------------------------------------
 * Guardar en modo mes a mes escribe los números y DESPUÉS activa el modo.
 * PostgREST no da transacción entre dos tablas, así que hay que elegir qué pasa
 * si el segundo falla, y las dos mitades no son simétricas:
 *
 *   números y después modo  ->  falla el modo: los números quedan guardados y
 *                               sin aplicar. La proyección no cambia. Se
 *                               reintenta y queda.
 *
 *   modo y después números  ->  falla lo segundo: el modo quedó en `monthly` y
 *                               NO hay números. Todos los meses proyectan 0, en
 *                               la pantalla de todos, sin que nadie lo haya
 *                               pedido.
 *
 * El primero deja el trabajo a medias; el segundo cambia el presupuesto a cero.
 * Por eso los números van primero.
 */

/** Los meses fijados de una estrategia. Devuelve la revisión escrita. */
export async function saveMonthlyTargets(input: {
  subject: OutlookSubject;
  strategy: OutlookStrategy;
  /** 'YYYY-MM' → número. Los meses que no vengan quedan sin fijar (0). */
  targets: Record<string, number>;
  note: string | null;
}): Promise<number> {
  const months = Object.keys(input.targets).sort();
  if (months.length === 0) {
    throw new Error('There is no month to set.');
  }

  const set_by = await authorEmail();
  const supabase = getSupabaseClient();

  /* La revisión siguiente se lee de la BASE, no de la pantalla -- ver arriba. */
  const [subjCol, subjVal] = subjectFilter(input.subject);
  const { data: existing, error: readError } = await supabase
    .schema('outlook')
    .from('monthly_target')
    .select('revision')
    .eq(subjCol, subjVal)
    .eq('strategy', input.strategy)
    .order('revision', { ascending: false })
    .limit(1);
  if (readError) throw readable(readError);
  const revision = (existing?.[0]?.revision ?? 0) + 1;

  const rows = months.map((m) => ({
    ...subjectColumns(input.subject),
    strategy: input.strategy,
    revision,
    target_month: m + '-01',
    target: input.targets[m],
    set_by,
    note: input.note,
  }));

  const { error } = await supabase.schema('outlook').from('monthly_target').insert(rows);
  if (error) throw readable(error);
  return revision;
}

/**
 * Qué modo rige para (persona, estrategia).
 *
 * ⚠ Esto NO borra nada del otro modo. La regla de crecimiento y los meses
 * fijados conviven guardados; lo único que cambia es cuál de los dos se aplica.
 * Volver al modo anterior lo reactiva tal como estaba -- que es lo que hace que
 * probar "¿y si lo fijo a mano?" no cueste perder la regla.
 */
export async function setProjectionMode(input: {
  subject: OutlookSubject;
  strategy: OutlookStrategy;
  mode: ProjectionMode;
  note: string | null;
}): Promise<void> {
  const set_by = await authorEmail();
  const { error } = await getSupabaseClient().schema('outlook').from('projection_mode').insert({
    ...subjectColumns(input.subject),
    strategy: input.strategy,
    mode: input.mode,
    set_by,
    note: input.note,
  });
  if (error) throw readable(error);
}

/**
 * ============================================================================
 * LA PROYECCIÓN DE UN RECLUTA — etapa OL20
 * ============================================================================
 *
 * Una revisión nueva, nunca un UPDATE: `outlook.recruitment_projection` no tiene
 * política de UPDATE ni de DELETE, así que corregir una fecha deja ver qué decía
 * antes y quién lo cambió.
 *
 * ⚠ LA REVISIÓN SIGUIENTE SE LEE DE LA BASE, no de lo que la pantalla tenía
 * cargado. Entre que se abrió el editor y que se apretó Guardar puede haber
 * pasado la edición de otra persona, y escribir `revision + 1` sobre un número
 * viejo tiraría dos revisiones con el mismo número. El UNIQUE
 * (identity, revision) corta la carrera si aun así ocurre.
 */
export async function saveRecruitProjection(input: {
  identity: string;
  source: 'future_loan_officer' | 'manual';
  personName: string;
  role: 'loan_officer' | 'nppm';
  branchCode: string;
  startDate: string | null;
  producingFrom: string;
  /** `null` = nadie fijó cuánto se espera. Distinto de 0, que es "no produce". */
  monthlyBenchmark: number | null;
  nmls: string | null;
  note: string | null;
}): Promise<number> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.producingFrom)) {
    throw new Error('"Producing from" must be a month.');
  }
  if (!input.branchCode.trim()) throw new Error('A projection needs a branch.');
  if (!input.personName.trim()) throw new Error('A projection needs a name.');

  const set_by = await authorEmail();
  const supabase = getSupabaseClient();
  const { data: existing, error: readError } = await supabase
    .schema('outlook')
    .from('recruitment_projection')
    .select('revision')
    .eq('identity', input.identity)
    .order('revision', { ascending: false })
    .limit(1);
  if (readError) throw readable(readError);
  const revision = (existing?.[0]?.revision ?? 0) + 1;

  const { error } = await supabase.schema('outlook').from('recruitment_projection').insert({
    identity: input.identity,
    revision,
    source: input.source,
    person_name: input.personName.trim(),
    role: input.role,
    branch_code: input.branchCode.trim(),
    start_date: input.startDate,
    producing_from: input.producingFrom,
    monthly_benchmark: input.monthlyBenchmark,
    nmls: input.nmls,
    set_by,
    note: input.note,
  });
  if (error) throw readable(error);
  return revision;
}

/**
 * La rampa de adaptación, global. Una revisión nueva por cambio.
 *
 * ⚠ LOS TRES PORCENTAJES VAN JUNTOS en una fila. Guardarlos por separado
 * permitiría una rampa a medias --mes 1 al 40% y mes 2 todavía al 50%-- que
 * nadie decidió.
 */
export async function saveRecruitRamp(input: {
  month1: number;
  month2: number;
  month3Plus: number;
  note: string | null;
}): Promise<number> {
  for (const [etiqueta, v] of [
    ['month 1', input.month1],
    ['month 2', input.month2],
    ['month 3 onwards', input.month3Plus],
  ] as const) {
    if (!(v >= 0 && v <= 1)) throw new Error(`The ${etiqueta} percentage has to be between 0% and 100%.`);
  }
  const set_by = await authorEmail();
  const supabase = getSupabaseClient();
  const { data: existing, error: readError } = await supabase
    .schema('outlook')
    .from('recruitment_ramp')
    .select('revision')
    .order('revision', { ascending: false })
    .limit(1);
  if (readError) throw readable(readError);
  const revision = (existing?.[0]?.revision ?? 0) + 1;
  const { error } = await supabase.schema('outlook').from('recruitment_ramp').insert({
    revision,
    month_1_pct: input.month1,
    month_2_pct: input.month2,
    month_3_plus_pct: input.month3Plus,
    set_by,
    note: input.note,
  });
  if (error) throw readable(error);
  return revision;
}

/**
 * Vincular una proyección con alguien del roster, o desvincularla.
 *
 * ⚠ DESVINCULAR ES UNA FILA NUEVA CON `employeeKey` EN NULL, no un DELETE. La
 * vigente es la más reciente, así que un vínculo equivocado se corrige sin
 * perder el rastro de quién lo puso.
 *
 * ⚠ Y ESTO ES LO QUE EVITA EL DOBLE CONTEO: una proyección vinculada deja de
 * aportar, porque de ahí en más la persona la proyecta el motor del roster, que
 * es el que tiene su producción real.
 */
export async function saveRecruitLink(input: {
  identity: string;
  employeeKey: number | null;
  note: string | null;
}): Promise<void> {
  const linked_by = await authorEmail();
  const supabase = getSupabaseClient();
  const { error } = await supabase.schema('outlook').from('recruitment_link').insert({
    identity: input.identity,
    employee_key: input.employeeKey,
    linked_by,
    note: input.note,
  });
  if (error) throw readable(error);
}

/**
 * ============================================================================
 * EL PRESUPUESTO COMPUESTO POR PLAN DE NEGOCIO — etapa OL26, punto 5
 * ============================================================================
 *
 * Dos tablas nuevas, `outlook.person_budget_total` y
 * `outlook.person_budget_breakdown` -- ver `docs/sql/2026-09-outlook-budget-composition.sql`.
 * Mismas cuatro reglas de siempre: nunca se actualiza, `set_by` sale de la
 * sesión, cada edición es una revisión nueva y completa, y la revisión
 * siguiente se lee de la BASE, no de la pantalla.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL SUJETO ES UNA PERSONA O UN REALTOR, NUNCA UN BRANCH — a diferencia de
 * `OutlookSubject`. Unión discriminada por el mismo motivo: el CHECK
 * `(employee_key is not null) <> (nppm_realtor_code is not null)` de las dos
 * tablas se vuelve imposible de violar en compilación, no sólo en runtime.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL ORDEN DE GUARDADO: EL TOTAL PRIMERO — mismo criterio que
 * `change_funnel` y que el modo mes a mes de OL4.
 * ---------------------------------------------------------------------------
 * Si el desglose fallara después de guardar el total, el total ya escrito no
 * se pierde: queda vigente y sin desglose todavía, que es exactamente lo que
 * la pantalla puede mostrar (un total con "sin desglose cargado"). Guardar el
 * desglose primero y que el total fallara después dejaría un desglose sin
 * total contra el que compararse -- la mitad que no se puede mostrar sola.
 *
 * ⚠ EL REALTOR SE IDENTIFICA POR CÓDIGO, NO POR NOMBRE — re-cableado al
 * rebasar sobre main, etapa del `realtor_code`. Ver
 * `docs/sql/2026-09-person-budget-realtor-code.sql`: la columna se renombró
 * de `nppm_realtor` a `nppm_realtor_code` porque el nombre no identifica a
 * nadie ('FRED A GOMEZ' contra 'FRED GOMEZ'). Mismo criterio que ya usa
 * `saveNppmBenchmark` para `nppm_benchmark`.
 */
export type PersonSubject =
  | { kind: 'employee'; employeeKey: number }
  | { kind: 'realtor'; realtorCode: string };

function personSubjectColumns(s: PersonSubject): { employee_key: number } | { nppm_realtor_code: string } {
  return s.kind === 'employee' ? { employee_key: s.employeeKey } : { nppm_realtor_code: s.realtorCode };
}

function personSubjectFilter(s: PersonSubject): [string, string | number] {
  return s.kind === 'employee' ? ['employee_key', s.employeeKey] : ['nppm_realtor_code', s.realtorCode];
}

const BUDGET_SQL_FILE = 'docs/sql/2026-09-outlook-budget-composition.sql';

/**
 * La revisión que sigue para este sujeto, leída de la BASE y no de la
 * pantalla. Cuenta las confirmaciones además de los totales: el número de
 * revisión es el orden en que se escribieron las cosas, no una cuenta de
 * totales fijados.
 */
async function siguienteRevisionDelTotal(subject: PersonSubject, sqlFile: string): Promise<number> {
  const [subjCol, subjVal] = personSubjectFilter(subject);
  const { data: existing, error } = await getSupabaseClient()
    .schema('outlook')
    .from('person_budget_total')
    .select('revision')
    .eq(subjCol, subjVal)
    .order('revision', { ascending: false })
    .limit(1);
  if (error) throw readable(error, { sqlFile });
  return (existing?.[0]?.revision ?? 0) + 1;
}

/** El total fijado a mano, mes por mes. Devuelve la revisión escrita. */
export async function savePersonBudgetTotal(input: {
  subject: PersonSubject;
  /** 'YYYY-MM' → total. Los meses que no vengan quedan sin fijar. */
  targets: Record<string, number>;
  note: string | null;
}): Promise<number> {
  const months = Object.keys(input.targets).sort();
  if (months.length === 0) throw new Error('There is no month to set.');

  const set_by = await authorEmail();
  const revision = await siguienteRevisionDelTotal(input.subject, BUDGET_SQL_FILE);

  const rows = months.map((m) => ({
    ...personSubjectColumns(input.subject),
    revision,
    target_month: m + '-01',
    total: input.targets[m],
    /* Explícito, aunque la columna tenga default: esta fila SÍ gobierna. */
    confirmed_only: false,
    set_by,
    note: input.note,
  }));

  const { error } = await getSupabaseClient().schema('outlook').from('person_budget_total').insert(rows);
  if (error) throw readable(error, { sqlFile: BUDGET_SQL_FILE });
  return revision;
}

const CONFIRM_SQL_FILE = 'docs/sql/2026-09-person-budget-confirm-reviewed.sql';

/**
 * ============================================================================
 * CONFIRMAR SIN FIJAR — etapa RV15
 * ============================================================================
 *
 * «Revisé el presupuesto de esta persona y está bien como está.» Escribe una
 * revisión de `person_budget_total` con `confirmed_only = true` y `total`
 * nulo: una fila con autor y fecha, que es lo que la compuerta del paso 2.2
 * busca --cualquier fila de esa persona posterior al arranque de la sesión-- y
 * que NO cambia ningún número.
 *
 * ⚠ POR QUÉ NO ESCRIBE EL NÚMERO QUE SE ACEPTÓ, que es lo primero que uno
 * pensaría (una fila igual a la anterior):
 *
 *   * Si la persona proyecta por regla --hoy TODAS, `person_budget_total`
 *     quedó en cero filas--, no hay número anterior que repetir. El único
 *     candidato es el que proyecta la regla, y fijarlo es un CAMBIO DE
 *     GOBIERNO: OL26e dice «person_budget_total manda cuando existe, la regla
 *     cuando no», y la propia pantalla lo avisa antes de guardar. Confirmar
 *     una revisión congelaría la proyección de esa persona, y la próxima vez
 *     que cambie su benchmark el número dejaría de seguirlo sin que nadie
 *     haya decidido eso.
 *   * Si la persona SÍ tiene total fijado, repetir los números funcionaría --
 *     pero entonces habría dos mecanismos para un mismo acto, y el editor
 *     tendría que elegir según lo que haya en la base. Una confirmación que
 *     nunca toca números es la misma en los dos casos.
 *   * Y el editor no puede calcular honestamente el total proyectado: conoce
 *     la tasa de Own Production, no el efectivo multi-bucket de la tabla del
 *     branch. Escribir un número que no sabe sería inventarlo.
 *
 * El lector ignora estas filas al calcular la revisión vigente (ver
 * `loadData.ts`), así que una confirmación nunca mueve un mes de la regla al
 * total NI le quita el gobierno a un total ya fijado -- que es lo que pasaría
 * si una revisión con totales nulos contara como la vigente.
 *
 * Devuelve la revisión escrita.
 */
export async function confirmPersonBudgetReviewed(input: {
  subject: PersonSubject;
  /** Los meses que la revisión abarcó: el horizonte que estaba en pantalla. */
  months: string[];
  note: string | null;
}): Promise<number> {
  const months = [...input.months].sort();
  if (months.length === 0) throw new Error('There is no month to confirm.');

  const set_by = await authorEmail();
  const revision = await siguienteRevisionDelTotal(input.subject, CONFIRM_SQL_FILE);

  const rows = months.map((m) => ({
    ...personSubjectColumns(input.subject),
    revision,
    target_month: m + '-01',
    total: null,
    confirmed_only: true,
    set_by,
    note: input.note,
  }));

  /*
   * ⚠ CON `returning`, y acá no es decorativo: un insert que escribe menos
   * filas de las que se le dieron se parece a uno que funcionó, y toda la
   * razón de esta función es dejar rastro. Si no volvieron las filas, no hay
   * confirmación que reportar.
   */
  const { data, error } = await getSupabaseClient()
    .schema('outlook')
    .from('person_budget_total')
    .insert(rows)
    .select('person_budget_total_key');
  if (error) throw readable(error, { sqlFile: CONFIRM_SQL_FILE });
  if ((data?.length ?? 0) !== rows.length) {
    throw new Error(
      `The confirmation was not recorded: ${data?.length ?? 0} of ${rows.length} rows came back.`
    );
  }
  return revision;
}

/**
 * El desglose informativo, por bucket y por mes. UNA revisión cubre TODOS
 * los buckets y meses de un mismo guardado -- es una sola decisión, "así es
 * como se explica el total", no una por bucket.
 *
 * ⚠ NO SE VALIDA QUE SUME EL TOTAL, a propósito: eso se muestra en pantalla
 * (ver el delta de `BudgetEditor`), no se rechaza el guardado ni se fuerza un
 * reescalado que inventaría de dónde sale la diferencia.
 *
 * Devuelve la revisión escrita.
 */
export async function savePersonBudgetBreakdown(input: {
  subject: PersonSubject;
  /** bucket → mes → valor. Sólo se guardan los pares presentes. */
  breakdown: Partial<Record<BudgetBucket, Record<string, number>>>;
  note: string | null;
}): Promise<number> {
  const entries: { bucket: BudgetBucket; month: string; value: number }[] = [];
  for (const bucket of Object.keys(input.breakdown) as BudgetBucket[]) {
    const byMonth = input.breakdown[bucket] ?? {};
    for (const m of Object.keys(byMonth)) entries.push({ bucket, month: m, value: byMonth[m] });
  }
  if (entries.length === 0) throw new Error('There is no month to set.');

  /*
   * ⚠ EL MISMO CHECK QUE LA BASE, TAMBIÉN ACÁ. La base lo rechaza igual --
   * `person_budget_breakdown_realtor_buckets_check`-- pero un realtor con
   * quince meses en cuatro buckets vería fallar el INSERT entero por uno solo
   * fuera de norma, con un 23514 crudo. Cortarlo antes evita mandar la
   * consulta para descubrir un error que ya se puede ver acá.
   */
  if (input.subject.kind === 'realtor' && entries.some((e) => e.bucket === 'b2b' || e.bucket === 'nppm')) {
    throw new Error('An NPPM realtor only has Own Production and Business Plan in the breakdown — B2B and NPPM do not apply.');
  }

  const set_by = await authorEmail();
  const supabase = getSupabaseClient();

  const [subjCol, subjVal] = personSubjectFilter(input.subject);
  const { data: existing, error: readError } = await supabase
    .schema('outlook')
    .from('person_budget_breakdown')
    .select('revision')
    .eq(subjCol, subjVal)
    .order('revision', { ascending: false })
    .limit(1);
  if (readError) throw readable(readError, { sqlFile: BUDGET_SQL_FILE });
  const revision = (existing?.[0]?.revision ?? 0) + 1;

  const rows = entries.map((e) => ({
    ...personSubjectColumns(input.subject),
    revision,
    target_month: e.month + '-01',
    bucket: e.bucket,
    value: e.value,
    set_by,
    note: input.note,
  }));

  const { error } = await supabase.schema('outlook').from('person_budget_breakdown').insert(rows);
  if (error)
    throw readable(error, {
      sqlFile: BUDGET_SQL_FILE,
      checkMessage:
        'The database rejected this value. A budget value cannot be negative, and an NPPM realtor cannot have B2B or NPPM in the breakdown.',
    });
  return revision;
}
