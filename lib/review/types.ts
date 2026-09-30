/**
 * ============================================================================
 * MODO REVISIÓN — LOS TIPOS
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Espejan las seis tablas de `docs/sql/2026-09-review-mode.sql`. Ahí están las
 * razones de cada decisión de modelo; acá sólo las que un lector de TypeScript
 * necesita para no usar mal un campo.
 */

/**
 * La posición de un paso en el guion. Vive acá y no en `progress.ts` porque la
 * necesitan los tres archivos --tipos, lógica y escrituras-- y `progress.ts` es
 * lógica, no el lugar donde se declaran las formas.
 */
export interface StepRef {
  phase_no: number;
  step_in_phase: number;
}

/**
 * Lo que hace falta ADEMÁS del comentario para cerrar un paso.
 *
 * ⚠ `funnel` TODAVÍA NO EXISTE EN LA BASE. El `check` de `review.step` admite
 * los otros cuatro, así que ninguna fila lo trae hoy: entra acá para que el
 * código esté listo cuando se aplique `2026-09-review-rv6.sql`, y mientras tanto
 * el requisito del funnel sale de la fase --ver `requiresFunnel`--.
 *
 * El orden importa: el código primero, el SQL después. Al revés, una fila con
 * `gate_kind = 'funnel'` contra el código viejo cae en el `default` de
 * `gateStatus`, que pide sólo el comentario -- el agujero que esta etapa cierra.
 */
export type GateKind = 'comment' | 'number' | 'clicks' | 'budget' | 'funnel';

/** Los dos estados que se GUARDAN. `abandoned` se deriva — ver `progress.ts`. */
export type SessionStatus = 'in_progress' | 'completed';

export interface ReviewPhase {
  phase_no: number;
  label: string;
  /**
   * Qué módulo visita la fase: `business_plan`, `outlook`.
   *
   * No es decorativo — es lo que le permite a la máscara saber que entrar a una
   * fase significa cruzar de módulo, y avisar que está cargando, sin que el
   * número de fase esté escrito en el código.
   */
  module: string;
}

export interface ReviewStep {
  phase_no: number;
  /** Dentro de la fase, no global. `1 of 2` de la fase 2 es este número. */
  step_in_phase: number;
  label: string;
  gate_kind: GateKind;
  /**
   * Lo que la compuerta necesita y no es texto: el link a MMI del paso 2, y
   * qué números hay que abrir en el paso 4.
   *
   *   `{ link: { label, url } }`      para `number`
   *   `{ clicks: ['total_pipeline'] }` para `clicks`
   *
   * `unknown` y no un tipo cerrado: el guion cambia por SQL, así que la
   * pantalla tiene que estrecharlo al leerlo y no confiar en la forma.
   */
  gate_config: Record<string, unknown> | null;
}

export interface ReviewStepPrompt {
  phase_no: number;
  step_in_phase: number;
  revision: number;
  prompt: string;
  /** `null` = no hay ayuda, que no es lo mismo que una ayuda vacía. */
  helper: string | null;
}

/**
 * El guion entero, ya resuelto: las fases en orden, sus pasos en orden, y el
 * texto VIGENTE de cada paso.
 */
export interface ReviewScript {
  phases: ReviewPhase[];
  steps: ReviewStep[];
  /** La revisión más alta de cada paso. La que se le muestra a la persona. */
  prompts: ReviewStepPrompt[];
}

export interface ReviewAssignment {
  assignment_key: number;
  reviewer_employee_key: number;
  lo_employee_key: number;
  /** El SLA: `YYYY-MM-DD`. Es un vencimiento de calendario, no un instante. */
  due_on: string;
  is_active: boolean;
  created_by: string;
  /**
   * ⚠ ASIGNACIÓN DE PRÁCTICA — RV24. Su sesión se guarda y no cuenta.
   *
   * Vive acá y no sólo en la sesión porque una práctica SIN EMPEZAR también es
   * una práctica: leerla de la sesión la mandaría al grupo de las reales hasta
   * el primer `Start practice`. Y `review.session` la copia atada por FK
   * compuesta, así que cuando la sesión existe las dos dicen lo mismo.
   */
  is_practice: boolean;
}

export interface ReviewSession {
  session_key: number;
  assignment_key: number;
  lo_employee_key: number;
  status: SessionStatus;
  /**
   * ⚠ EL CURSOR, QUE NO ES EL AVANCE. Es dónde está la persona; cuánto completó
   * se deriva de las respuestas. Quien completó cinco pasos y volvió al segundo
   * está en el segundo con cinco hechos, y una sola cifra no dice las dos cosas.
   */
  current_phase: number;
  current_step_in_phase: number;
  started_at: string;
  started_by: string;
  completed_at: string | null;
  /**
   * ⚠ SESIÓN DE PRÁCTICA — RV24. Se guarda y no cuenta.
   *
   * Es copia de `assignment.is_practice` y NO puede divergir: las une una FK
   * compuesta contra `assignment_practice_pin_uk`, el mismo mecanismo que ata
   * el Loan Officer. Escribir otra marca acá es una violación de integridad.
   *
   * Lo que decide de verdad no es esta columna sino quién la lee: los pasos que
   * escriben hacia afuera pasan por `lib/review/puertaDeEscritura.ts`.
   */
  is_practice: boolean;
}

export interface ReviewResponse {
  response_key: number;
  session_key: number;
  phase_no: number;
  step_in_phase: number;
  /** Contra qué versión de la pregunta se contestó. Ver la sección 4 del SQL. */
  prompt_revision: number;
  comment: string;
  /**
   * Sólo la EVIDENCIA de la compuerta — los clics del paso 4. Nunca el
   * benchmark ni el presupuesto: ésos viven en sus tablas, y copiarlos daría
   * dos fuentes para el mismo número.
   */
  gate: Record<string, unknown> | null;
  /**
   * ═════════════════════════════════════════════════════════════════════════
   * ⚠ TRES ESTADOS, Y EL TERCERO ES «LA COLUMNA TODAVÍA NO EXISTE» — RV32
   * ═════════════════════════════════════════════════════════════════════════
   *
   * La persona miró la pantalla que el paso señala, además de escribir el
   * comentario. Un texto escrito por adelantado desde el panel de las nueve
   * preguntas nace en `false` y pasa a `true` al llegar al paso.
   *
   *   `true`       lo escribió y lo miró
   *   `false`      hay texto y todavía no lo miró
   *   `undefined`  la migración de RV32 no está aplicada
   *
   * El tercero no es paranoia: con `select('*')` una columna que no existe
   * simplemente no viaja, así que el código puede mergearse antes que el SQL
   * -- y mientras tanto tiene que comportarse como antes, que es contar el
   * paso como hecho. Leerlo como `false` dejaría toda revisión abierta trabada
   * el día del merge y antes de que nadie aplique nada.
   *
   * Quien lo lea usa `vistoEnSitio()` de `progress.ts` y no la propiedad
   * pelada, justamente para no volver a mezclar `undefined` con `false`.
   */
  seen_on_site?: boolean;
  answered_at: string;
  answered_by: string;
}

/**
 * `Other`: lo importante que no pertenece a ningún paso.
 *
 * ⚠ No tiene `phase_no`, `step_in_phase` ni `prompt_revision`, y ésa es toda la
 * diferencia: es una nota de la SESIÓN. Ponerla como noveno paso habría metido
 * una fila falsa en `review.step`, que es lo que cuenta el `5 of 5`.
 */
export interface ReviewNote {
  note_key: number;
  session_key: number;
  body: string;
  created_at: string;
  created_by: string;
}

/** Una fila de `Mis revisiones`: la asignación con su sesión, si tiene. */
export interface MyReview {
  assignment: ReviewAssignment;
  loName: string;
  /**
   * La sesión vigente de esta asignación, o `null` si nunca se empezó.
   *
   * `null` no es lo mismo que una sesión sin respuestas: la primera es "no
   * arrancó", la segunda es "arrancó y no contestó nada". La pantalla las dice
   * distinto.
   */
  session: ReviewSession | null;
  /** Las respuestas de esa sesión. Vacío si no hay sesión. */
  responses: ReviewResponse[];
  /**
   * Las notas de esa sesión — el `Other` de RV32.
   *
   * ⚠ Vacío también cuando la migración no está aplicada: la lectura falla y se
   * avisa por consola. Los dos casos dibujan lo mismo, y el que importa --que
   * falte el SQL-- lo ve quien lo aplica, no quien revisa.
   */
  notes: ReviewNote[];
}
