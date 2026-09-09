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
  answered_at: string;
  answered_by: string;
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
}
