/**
 * ============================================================================
 * LA PROYECCIÓN DE RECLUTAMIENTO — etapa OL20
 * ============================================================================
 *
 * Outlook proyecta a quien está en el roster. Esto agrega a la gente EN PROCESO
 * DE CONTRATACIÓN: cuánto se espera que produzca y desde cuándo.
 *
 * Módulo puro, sin Supabase y sin UI: las tres reglas de la etapa --quién
 * proyecta, cuánto y hasta cuándo-- se pueden verificar sin levantar nada.
 *
 * ---------------------------------------------------------------------------
 * ⚠ TODOS PROYECTAN BAJO RECRUITMENT, sin importar su branch
 * ---------------------------------------------------------------------------
 * Decisión del negocio: cualquiera que venga de este proceso cuenta en la
 * estrategia Recruitment y no en Own Production. Eso conecta con OL19 --
 * Recruitment se abre por quien tiene producción de esa estrategia, y ahora
 * también por quien está en proceso.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LA FUENTE ES `activity_report.future_loan_officer` Y NO LAS OTRAS DOS
 * ---------------------------------------------------------------------------
 * Trae las reglas ya aplicadas. Y el filtro es `producira`, NO `confianza`:
 * medido, de los 6 con `confianza = 'confirmado'` hay 4 que NO producen. El
 * filtro que uno escribiría primero da al revés.
 */

/** Los tres estados en que puede estar alguien del proceso, de cara a la vista. */
export type RecruitStage =
  /** `hr_pipeline`: ya tiene fecha de inicio. */
  | 'in_hiring'
  /** `salesforce` con confianza `ganado` o `probable`, y todavía vigente. */
  | 'in_offering'
  /** `salesforce` `probable` cuyo cierre quedó viejo sin fecha de inicio. */
  | 'stale'
  /** `salesforce` `tentative`: nadie lo cerró. */
  | 'tentative';

/** La etiqueta que va junto al nombre. En inglés, como el resto del módulo. */
export const STAGE_LABEL: Record<RecruitStage, string> = {
  in_hiring: 'In hiring',
  in_offering: 'In offering',
  stale: 'Unresolved',
  tentative: 'Tentative',
};

/**
 * ⚠ QUÉ ETAPAS ENTRAN AL PRESUPUESTO. Sólo dos.
 *
 *   in_hiring / in_offering   proyectan.
 *   tentative                 no. Son candidatos que nadie cerró, y medido, sus
 *                             `close_date` son de 2024 y 2025 -- la más reciente
 *                             de diciembre del año pasado. No es "sin cerrar",
 *                             es abandonado.
 *   stale                     no. Un reclutamiento cerrado hace más de un mes
 *                             que sigue sin fecha de inicio no es pipeline, es
 *                             un caso sin resolver; proyectarlo sería inventar
 *                             producción de alguien que quizás nunca entró.
 *
 * Los dos que no proyectan SE MUESTRAN igual, con su etiqueta y su `close_date`
 * a la vista. Una fila que dice "Tentative · closed 2024-06-14" se entiende sin
 * preguntar; una fila ausente no se entiende de ninguna manera.
 */
export function stageProjects(stage: RecruitStage): boolean {
  return stage === 'in_hiring' || stage === 'in_offering';
}

/**
 * ⚠ CUÁNTOS DÍAS HACE FALTA PARA QUE UN CIERRE QUEDE VIEJO.
 *
 * La regla es por FECHA y no por lista de nombres, a propósito: hoy los cuatro
 * vencidos son Eduardo Portella, John Edmead y Jonathan Osorio --cerrados el 30
 * de junio-- y Josué Hernández --el 25 de agosto--, y los otros cuatro
 * `probable` cierran el 30 de septiembre. Con una lista habría que mantenerla y
 * los del 30 de septiembre vencerían sin que nadie lo note; con la fecha, entran
 * cuando corresponde y salen solos.
 */
export const STALE_AFTER_DAYS = 30;

/** Lo mínimo que hace falta saber de una fila de la fuente para clasificarla. */
export interface RecruitSourceRow {
  origen: string;
  confianza: string;
  closeDate: string | null;
  startDate: string | null;
}

/**
 * En qué etapa está. `today` entra por parámetro y no se lee del reloj para que
 * la regla de los 30 días se pueda probar sin esperar un mes.
 */
export function classifyRecruit(row: RecruitSourceRow, today: string): RecruitStage {
  if (row.origen === 'hr_pipeline') return 'in_hiring';
  if (row.confianza === 'tentative') return 'tentative';
  /*
   * Con fecha de inicio ya no importa cuán viejo sea el cierre: el caso está
   * resuelto. Hoy ningún registro de Salesforce trae `fecha_inicio` --los 13
   * están vacíos-- pero el día que la fuente empiece a traerla, esta línea es
   * la que evita que un cierre viejo la descarte.
   */
  if (row.startDate) return 'in_offering';
  if (row.closeDate && diffDays(today, row.closeDate) > STALE_AFTER_DAYS) return 'stale';
  return 'in_offering';
}

/** Días de `desde` a `hasta`, en UTC. Positivo si `hasta` es anterior. */
function diffDays(hoy: string, fecha: string): number {
  const a = Date.parse(hoy + 'T00:00:00Z');
  const b = Date.parse(fecha + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / 86400000);
}

export interface Ramp {
  month1: number;
  month2: number;
  month3Plus: number;
}

/**
 * La rampa si nadie la fijó. Los mismos valores que siembra el SQL, repetidos
 * acá a propósito: así la etapa funciona antes de que se aplique la migración.
 * Cuando la tabla existe manda la tabla.
 */
export const DEFAULT_RAMP: Ramp = { month1: 0.25, month2: 0.5, month3Plus: 1 };

/** Cuántos meses hay de `desde` a `hasta`, los dos 'YYYY-MM'. */
function monthsBetween(desde: string, hasta: string): number {
  const [ya, ma] = desde.split('-').map(Number);
  const [yb, mb] = hasta.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export interface RecruitProjectionInput {
  /** Desde qué mes cuenta, 'YYYY-MM'. */
  producingFrom: string;
  /** Su producción mensual esperada. `null` = nadie la fijó -- ver la nota. */
  monthlyBenchmark: number | null;
  stage: RecruitStage;
  /** `true` cuando la proyección ya se vinculó a alguien del roster. */
  linked: boolean;
  ramp?: Ramp;
}

/**
 * ============================================================================
 * LO QUE APORTA UNA PROYECCIÓN, MES POR MES
 * ============================================================================
 *
 * Devuelve un valor por cada mes de `months` -- que son los que le quedan al
 * año, o sea que NUNCA incluyen el mes en curso.
 *
 * ⚠ TRES MOTIVOS PARA QUE UN MES DÉ CERO, y los tres son distintos:
 *
 *   antes de `producingFrom`   todavía no cuenta.
 *   sin benchmark              nadie fijó cuánto se espera. Es `null` en la
 *                              base y 0 acá, pero la VISTA lo muestra vacío:
 *                              cero afirmaría que no se espera producción.
 *   la etapa no proyecta       `tentative` o `stale`.
 *
 * ⚠ Y EL CUARTO, QUE ES EL QUE EVITA EL DOBLE CONTEO:
 *
 *   vencida sin vincular       `producingFrom` ya pasó y nadie confirmó a qué
 *                              persona del roster corresponde. Deja de contar.
 *
 * Pasada su fecha de inicio, una proyección sin vínculo es una de dos cosas: la
 * persona ya está en el roster --y contarla duplica-- o no entró --y contarla
 * inventa--. En los dos casos lo correcto es que no sume, y que aparezca
 * pidiendo decisión.
 *
 * El modo de falla que eso elige es deliberado: presupuesto CORTO Y VISIBLE
 * antes que inflado y silencioso. Un número inflado no lo detecta nadie porque
 * se ve plausible -- ya pasó en OL1b, con el total en 105 cuando eran 44.
 *
 * ⚠ Y UNA VEZ VINCULADA TAMPOCO SUMA: de ahí en más la persona la proyecta el
 * motor del roster, que es el que tiene su producción real.
 */
export function projectRecruit(
  months: string[],
  input: RecruitProjectionInput,
  currentMonth: string
): number[] {
  const cero = months.map(() => 0);
  if (!stageProjects(input.stage)) return cero;
  if (input.linked) return cero;
  if (input.monthlyBenchmark === null || input.monthlyBenchmark <= 0) return cero;
  if (isExpired(input.producingFrom, currentMonth)) return cero;

  const ramp = input.ramp ?? DEFAULT_RAMP;
  return months.map((m) => {
    const n = monthsBetween(input.producingFrom, m);
    if (n < 0) return 0;
    const pct = n === 0 ? ramp.month1 : n === 1 ? ramp.month2 : ramp.month3Plus;
    return (input.monthlyBenchmark as number) * pct;
  });
}

/**
 * ⚠ VENCIDA = su primer mes de producción es el actual o anterior.
 *
 * No es "la fecha pasó" a secas: el mes en curso también cuenta como vencido,
 * porque Outlook proyecta desde el mes SIGUIENTE. Una proyección que empieza
 * este mes ya no tiene ningún mes futuro propio que aportar; lo que produzca
 * este mes sale del pipeline, no de una proyección.
 */
export function isExpired(producingFrom: string, currentMonth: string): boolean {
  return producingFrom <= currentMonth;
}

/** Por qué una proyección no suma. `null` cuando sí suma. */
export type NotProjectingReason = 'stage' | 'linked' | 'no_benchmark' | 'expired';

export function notProjectingReason(
  input: RecruitProjectionInput,
  currentMonth: string
): NotProjectingReason | null {
  if (!stageProjects(input.stage)) return 'stage';
  if (input.linked) return 'linked';
  if (input.monthlyBenchmark === null || input.monthlyBenchmark <= 0) return 'no_benchmark';
  if (isExpired(input.producingFrom, currentMonth)) return 'expired';
  return null;
}

/**
 * El mes por defecto desde el que se espera que produzca, cuando nadie lo fijó.
 *
 * ⚠ EL MES SIGUIENTE AL DE ENTRADA, no el de entrada. Alguien que empieza el 14
 * de septiembre no produce un mes de septiembre; y si no hay fecha de entrada
 * --los 13 de Salesforce-- se cae al mes siguiente al actual, que es el primero
 * que Outlook puede proyectar.
 *
 * ⚠ NUNCA `close_date`. Esa es cuándo se cerró el reclutamiento, no cuándo
 * empieza a trabajar; usarla adelantaría la producción de todos.
 */
export function defaultProducingFrom(startDate: string | null, currentMonth: string): string {
  const base = startDate ? startDate.slice(0, 7) : currentMonth;
  const [y, m] = base.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}
