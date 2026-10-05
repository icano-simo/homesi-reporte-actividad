/**
 * ============================================================================
 * LOS DOS GRUPOS DE RECLUTAMIENTO — etapa ADM9
 * ============================================================================
 *
 * Isabella mira dos cosas distintas, con criterios distintos, y por eso son dos
 * grupos y no una lista ordenada:
 *
 *   salesforce_high   negociaciones prioritarias: `stage = 'Negotiation'` Y
 *                     `importance = 'High'`. Lo que puede cerrarse pronto y le
 *                     importa a alguien.
 *   hiring_process    gente del tablero de RRHH que todavía no está en el
 *                     roster. Ya tiene fecha de ingreso.
 *
 * Módulo PURO: sin Supabase y sin UI, para que las reglas se prueben sin
 * levantar nada. Lo consumen la pantalla de Admin y Outlook, y ésa es la razón
 * de que viva acá y no dentro de una de las dos -- los mismos criterios en dos
 * lugares distintos divergen, y en este repo ya pasó con `classifyLoan`.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTO NO REEMPLAZA A `lib/outlook/recruitment.ts`, Y NO SE SOLAPAN
 * ---------------------------------------------------------------------------
 * Aquel clasifica para PROYECTAR dinero: `in_hiring`, `in_offering`, `stale`,
 * `tentative`, y decide cuáles entran al presupuesto. Éste clasifica para
 * MOSTRAR a quién mirar. Son dos preguntas y las respuestas no coinciden: un
 * `tentative` de 2024 no proyecta y tampoco es prioritario, pero un `Low` con
 * cierre la semana que viene sí proyecta y NO es prioritario.
 *
 * Si alguna vez uno de los dos tiene que derivarse del otro, que sea
 * explícitamente y en un solo sentido. Dos clasificaciones que se copian
 * terminan contradiciéndose.
 *
 * ---------------------------------------------------------------------------
 * ⚠ DOS FILTROS QUE NO SE APLICAN ACÁ PORQUE YA VIENEN HECHOS
 * ---------------------------------------------------------------------------
 *   "todavía no en el roster"    lo hace `lending_marts.fct_future_loan_officer`:
 *                                quien entra al roster sale de la vista. Volver
 *                                a filtrarlo acá sería una segunda regla que
 *                                puede divergir de aquélla.
 *   "no está ya en el tablero"   lo hace la deduplicación por contención de esa
 *                                misma vista. Verificado el 2026-10-05: ninguna
 *                                fila de `salesforce` comparte nombre con una de
 *                                `hr_pipeline`.
 */

/** Los dos grupos. El resto de las filas no pertenece a ninguno. */
export type PriorityGroup = 'salesforce_high' | 'hiring_process';

/** El rótulo de cada grupo, en inglés como el resto de estos módulos. */
export const GROUP_LABEL: Record<PriorityGroup, string> = {
  salesforce_high: 'Priority negotiation',
  hiring_process: 'Hiring process',
};

/**
 * Qué significa la fecha de cada grupo. NO es la misma y la columna tiene que
 * decirlo: en uno es cuándo se espera cerrar la negociación, en el otro cuándo
 * la persona empieza a trabajar. Mostrarlas bajo un encabezado común --"Fecha"--
 * invita a compararlas, y comparar un cierre esperado con un ingreso no
 * significa nada.
 */
export const DATE_LABEL: Record<PriorityGroup, string> = {
  salesforce_high: 'Expected close',
  hiring_process: 'Start date',
};

/**
 * ⚠ Y LA OTRA COLUMNA TAMPOCO DICE LO MISMO EN LOS DOS GRUPOS — etapa ADM10.
 *
 * Las dos dibujan `recruiter`, y ese campo trae personas de oficios distintos
 * según de dónde salga la fila. Medido el 2026-10-05 contra la base:
 *
 *   origen `salesforce`    Maria Guerrero, Juanjo Cabrera   quienes NEGOCIAN
 *   origen `hr_pipeline`   Jessica Burden, Nancy Hancock    las HR REPS que
 *                                                           procesan el ingreso
 *
 * Sin rótulo, las cuatro se leen como lo mismo. Y pasó: al ver «Jessica Burden»
 * y «Nancy Hancock» en esa columna se las buscó como CANDIDATAS en
 * `org.hiring_tracking` y en `activity_report.future_loan_officer` --cero filas
 * en las dos, porque no son candidatas-- y la conclusión razonable fue que la
 * pantalla estaba leyendo algo que no corresponde.
 *
 * Es la misma familia que `DATE_LABEL`: un valor correcto de una fuente que el
 * lector no puede adivinar. La columna no cambia de dato, cambia de nombre.
 */
export const PERSON_LABEL: Record<PriorityGroup, string> = {
  salesforce_high: 'Recruiter',
  hiring_process: 'HR rep',
};

/**
 * ⚠ LOS DOS RECLUTADORES, COMO GUARDA HACIA ADELANTE.
 *
 * Al 2026-10-05 las 14 filas de Salesforce son de uno de los dos, así que este
 * filtro HOY NO EXCLUYE A NADIE. Se deja igual: el día que un tercero cargue un
 * candidato, el grupo prioritario no debería crecer sin que nadie lo decida.
 *
 * Que no excluya a nadie hoy es la razón por la que conviene que esté escrito --
 * si se omite, nadie va a notar su falta hasta que ya haya pasado.
 *
 * ⚠ LA COMPARACIÓN ES EXACTA, Y AHÍ HAY UNA TRAMPA. Verificado byte por byte:
 * la base guarda 'Maria Guerrero' SIN TILDE. El día que la fuente escriba
 * 'María Guerrero', la fila deja de ser prioritaria y cae en `otro_reclutador`
 * -- sin error, sin aviso, con el grupo encogiéndose solo.
 *
 * Y el orden de `exclusionReason` lo hace más silencioso todavía: el reclutador
 * se mira ÚLTIMO, así que una fila `Low` de un reclutador mal escrito igual
 * reporta `no_prioritario`. Sólo una fila `High` revelaría el problema.
 *
 * ⚠ Y HOY MARÍA NO TIENE NINGUNA `High`. Medido en ADM10: sus once filas están
 * en `Negotiation` y las once son `Low`. O sea que esta entrada de la lista
 * **no la ejerce ningún dato real**, y su prueba la ejerce con una fila sin
 * nombre -- que es lo correcto, porque una prueba que la ejerciera con un
 * nombre propio estaría afirmando una importancia que la base no dice.
 */
export const PRIORITY_RECRUITERS = ['Maria Guerrero', 'Juanjo Cabrera'] as const;

/** El `stage` de Salesforce que cuenta como negociación abierta. */
export const PRIORITY_STAGE = 'Negotiation';

/**
 * ⚠ ESTRICTAMENTE `High`, Y NO SE AMPLÍA.
 *
 * Definido por Isabella. El grupo PUEDE QUEDAR VACÍO algún día y eso es
 * correcto: significa que no hay nadie prioritario en negociación. Por eso la
 * pantalla tiene que decir que está vacío en vez de desaparecer -- una sección
 * ausente se lee como "esto no existe", y una vacía con su motivo se lee como
 * "no hay nadie hoy", que es la verdad.
 *
 * ⚠ `importance` NO tiene CHECK que la acote, ni en Supabase ni en BigQuery.
 * Hoy toma 'High', 'Low' y 'Medium'; un valor nuevo entraría sin avisar y
 * simplemente no sería prioritario. Comparar por igualdad --y no por "distinto
 * de Low"-- es lo que hace que un valor desconocido caiga del lado seguro.
 */
export const PRIORITY_IMPORTANCE = 'High';

/** Lo mínimo que hace falta de una fila para agruparla y dibujarla. */
export interface PriorityRow {
  nombre: string;
  /** 'salesforce' | 'hr_pipeline'. Es lo que decide qué fecha significa qué. */
  origen: string;
  /** El `stage` de Salesforce. Nulo en las de `hr_pipeline`. */
  stage: string | null;
  /** 'High' | 'Low' | 'Medium' | null. Nulo es "nadie lo triagó". */
  importance: string | null;
  recruiter: string | null;
  branchCode: string | null;
  /** Cierre esperado. Sólo en las de Salesforce. */
  closeDate: string | null;
  /** Fecha de ingreso. Sólo en las del tablero. */
  startDate: string | null;
  /** Si va a originar. Falso en Business Development y LO Assistant. */
  producira: boolean;
}

/** A qué grupo pertenece, o `null` si a ninguno. */
export function groupOf(row: PriorityRow): PriorityGroup | null {
  if (row.origen === 'hr_pipeline') return 'hiring_process';

  if (
    row.origen === 'salesforce' &&
    row.stage === PRIORITY_STAGE &&
    row.importance === PRIORITY_IMPORTANCE &&
    row.recruiter !== null &&
    (PRIORITY_RECRUITERS as readonly string[]).includes(row.recruiter)
  ) {
    return 'salesforce_high';
  }

  return null;
}

/**
 * Por qué una fila quedó fuera. Para contestar "¿y por qué no está fulano?" sin
 * tener que releer el criterio.
 *
 * ⚠ `sin_triage` NO ES "baja prioridad". Nadie les fijó importancia todavía --
 * al 2026-10-05 son tres--, así que la respuesta a quien pregunte es que falta
 * que un reclutador los triage, NO que se los descartó. Son dos cosas distintas
 * y colapsarlas en "no prioritario" pierde la única que es accionable.
 */
export type ExclusionReason =
  /** `importance` baja o media: triado y no prioritario. */
  | 'no_prioritario'
  /** `importance` nula: NADIE LO TRIAGÓ. Ver arriba. */
  | 'sin_triage'
  /** No está en `Negotiation` -- cerrado, ganado o perdido. */
  | 'fuera_de_negociacion'
  /** De un reclutador que no es ninguno de los dos. */
  | 'otro_reclutador';

export function exclusionReason(row: PriorityRow): ExclusionReason | null {
  if (groupOf(row) !== null) return null;
  if (row.origen !== 'salesforce') return null;

  if (row.stage !== PRIORITY_STAGE) return 'fuera_de_negociacion';
  if (row.importance === null) return 'sin_triage';
  if (row.importance !== PRIORITY_IMPORTANCE) return 'no_prioritario';
  if (row.recruiter === null || !(PRIORITY_RECRUITERS as readonly string[]).includes(row.recruiter)) {
    return 'otro_reclutador';
  }
  return null;
}

/**
 * La fecha que le corresponde al grupo, y si quedó en el pasado.
 *
 * ⚠ UNA FECHA VENCIDA ES UN DATO, NO UN ERROR, y por eso se marca en vez de
 * ocultarse. Son CUATRO al 2026-10-05, y van en direcciones opuestas:
 *
 *   Luis Landaverde    cierre esperado 2024-06-14 -- más de un año vencido. Sin
 *                      marcarlo, la fila se lee como si estuviera por cerrarse.
 *   Jorge Betancur     ingreso 2026-08-17, hace casi dos meses. Sin marcarlo,
 *                      se lee como un ingreso próximo.
 *   Rosario Lopez      ingreso 2026-10-01. Ya debería estar en el roster.
 *
 * Es la misma señal con dos significados: una negociación que no avanzó, y
 * alguien que debería haber entrado y no figura en el roster.
 *
 * ⚠ Y HOY EL GRUPO 1 TIENE UNA SOLA FILA, Y ESTÁ VENCIDA. Medido en ADM10:
 * `Negotiation` + `High` + los dos reclutadores devuelve **Luis Landaverde** y
 * nadie más. Esta nota decía «las dos filas» y nombraba a Otoniel Gomez, que
 * contra la base es `Low` -- ver la cabecera de `prioridades.test.mjs`.
 *
 * Que el grupo quede en uno, o en cero, es un resultado posible y no un fallo:
 * significa que no hay más de una negociación prioritaria abierta.
 */
export interface PriorityDate {
  group: PriorityGroup;
  /** El rótulo de la columna. Dice QUÉ fecha es. */
  label: string;
  /** La fecha, o null si la fila no la tiene. */
  date: string | null;
  /** `true` si ya pasó. Null si no hay fecha. */
  overdue: boolean | null;
}

export function priorityDate(
  row: PriorityRow,
  group: PriorityGroup,
  today: string,
): PriorityDate {
  const date = group === 'hiring_process' ? row.startDate : row.closeDate;
  return {
    group,
    label: DATE_LABEL[group],
    date,
    overdue: date === null ? null : date < today,
  };
}

/**
 * ⚠ QUIÉN NO VA A PRODUCIR, ROTULADO Y NO QUITADO.
 *
 * Al 2026-10-05 dos del tablero tienen `producira = false`: Jorge Betancur y
 * Maria "Cris" Oviedo Clavijo. Son Business Development y LO Assistant -- entran
 * a la empresa pero no van a originar.
 *
 * Se MUESTRAN, porque la pantalla habla del proceso de contratación y ellos
 * están en él. Pero si alguien suma la sección esperando futuros originadores,
 * los cuenta de más: el rótulo es lo que separa "entra" de "va a producir".
 */
export function willNotProduce(row: PriorityRow): boolean {
  return !row.producira;
}

/** Los dos grupos armados, cada uno con sus filas en el orden de la pantalla. */
export interface PriorityGroups {
  salesforce_high: PriorityRow[];
  hiring_process: PriorityRow[];
  /** Las que no entraron, con el motivo. Para poder contestar por qué. */
  excluded: { row: PriorityRow; reason: ExclusionReason }[];
}

/**
 * Arma los dos grupos a partir de las filas crudas.
 *
 * El orden dentro de cada uno es por FECHA ascendente --lo más próximo arriba--
 * y las filas sin fecha al final: una lista de "a quién mirar" ordenada por
 * nombre obliga a leerla entera para encontrar lo urgente.
 */
export function buildPriorityGroups(rows: PriorityRow[], today: string): PriorityGroups {
  const out: PriorityGroups = { salesforce_high: [], hiring_process: [], excluded: [] };

  for (const row of rows) {
    const group = groupOf(row);
    if (group === null) {
      const reason = exclusionReason(row);
      if (reason !== null) out.excluded.push({ row, reason });
      continue;
    }
    out[group].push(row);
  }

  const porFecha = (g: PriorityGroup) => (a: PriorityRow, b: PriorityRow) => {
    const fa = priorityDate(a, g, today).date;
    const fb = priorityDate(b, g, today).date;
    if (fa === null && fb === null) return a.nombre.localeCompare(b.nombre);
    if (fa === null) return 1;
    if (fb === null) return -1;
    return fa.localeCompare(fb) || a.nombre.localeCompare(b.nombre);
  };

  out.salesforce_high.sort(porFecha('salesforce_high'));
  out.hiring_process.sort(porFecha('hiring_process'));

  return out;
}
