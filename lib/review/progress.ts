/**
 * ============================================================================
 * MODO REVISIÓN — EL AVANCE, DERIVADO
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Todo lo de acá es PURO: recibe el guion y las respuestas, y devuelve números.
 * Sin base y sin React, así que se puede probar sin navegador — que es lo que
 * hace que las reglas del guion tengan pruebas de verdad y no una captura.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NADA DE ESTO SE GUARDA
 * ---------------------------------------------------------------------------
 * Ni el avance, ni el porcentaje, ni si una sesión está abandonada. Se calculan
 * de dos cosas: los pasos que el guion tiene y las respuestas que hay.
 *
 * El motivo es el de `blocked` en BP42/BP46: un número guardado al lado de las
 * filas de las que sale queda libre de discrepar, y al desbloquearlo hay que
 * adivinar cuál era el bueno. Lo único que la sesión guarda es el CURSOR, que
 * es otra pregunta — dónde está la persona, no cuánto hizo.
 */

import type {
  ReviewResponse,
  ReviewScript,
  ReviewSession,
  ReviewStep,
  StepRef,
} from './types';

/* `StepRef` se re-exporta para no romper a quien ya lo importaba de acá. */
export type { StepRef };

/** Avance de una fase, para la lista de la máscara. */
export interface PhaseProgress {
  phase_no: number;
  label: string;
  module: string;
  done: number;
  total: number;
  /** `done` y `total` iguales, con `total > 0`. Ver la nota de `phaseDone`. */
  complete: boolean;
}

/** Los pasos del guion en el orden en que se recorren. */
export function orderedSteps(script: ReviewScript): ReviewStep[] {
  return [...script.steps].sort(
    (a, b) => a.phase_no - b.phase_no || a.step_in_phase - b.step_in_phase
  );
}

/** `true` si los dos apuntan al mismo paso. */
export function sameStep(a: StepRef, b: StepRef): boolean {
  return a.phase_no === b.phase_no && a.step_in_phase === b.step_in_phase;
}

const clave = (s: StepRef) => s.phase_no + ':' + s.step_in_phase;

/**
 * Los pasos que tienen respuesta, o sea los COMPLETOS.
 *
 * ⚠ TENER RESPUESTA ES ESTAR COMPLETO, y eso es una decisión del modelo, no un
 * atajo: la fila se escribe recién cuando la compuerta se cumplió --el
 * comentario, y los tres clics si el paso los pide--, así que una respuesta a
 * medias no existe. Guardar borradores obligaría a distinguir "contestado" de
 * "guardado", y son dos estados que la pantalla no necesita.
 *
 * Y se cuentan pasos DISTINTOS y no filas: la tabla es append-only, así que
 * corregir un comentario agrega una fila y no avanza nada.
 */
export function answeredSteps(responses: ReviewResponse[]): Set<string> {
  return new Set(responses.map(clave));
}

/** La respuesta VIGENTE de un paso: la última, porque la tabla es append-only. */
export function latestResponse(
  responses: ReviewResponse[],
  step: StepRef
): ReviewResponse | null {
  const mias = responses.filter((r) => sameStep(r, step));
  if (mias.length === 0) return null;
  return mias.reduce((a, b) => (a.answered_at >= b.answered_at ? a : b));
}

/**
 * Avance por fase, en el orden del guion.
 *
 * `total` sale de los PASOS del guion y no de una constante: es lo que hace que
 * partir una fase en dos sea un INSERT. Si el guion no declara pasos para una
 * fase, `total` es 0 y `complete` es `false` -- una fase vacía no está hecha,
 * está mal cargada, y decir que está completa esconde el problema.
 */
export function phaseProgress(
  script: ReviewScript,
  responses: ReviewResponse[]
): PhaseProgress[] {
  const hechos = answeredSteps(responses);
  return [...script.phases]
    .sort((a, b) => a.phase_no - b.phase_no)
    .map((f) => {
      const pasos = script.steps.filter((s) => s.phase_no === f.phase_no);
      const done = pasos.filter((s) => hechos.has(clave(s))).length;
      return {
        phase_no: f.phase_no,
        label: f.label,
        module: f.module,
        done,
        total: pasos.length,
        complete: pasos.length > 0 && done === pasos.length,
      };
    });
}

/** Porcentaje entero sobre TODOS los pasos del guion. 0 si no hay pasos. */
export function overallPercent(script: ReviewScript, responses: ReviewResponse[]): number {
  const total = script.steps.length;
  if (total === 0) return 0;
  const hechos = answeredSteps(responses);
  const done = script.steps.filter((s) => hechos.has(clave(s))).length;
  return Math.round((done / total) * 100);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA HABILITACIÓN PROGRESIVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un paso está disponible si TODOS los anteriores del guion están completos.
 * Cruza fases: el primer paso de la fase 2 pide la fase 1 entera.
 *
 * ⚠ Y UN PASO YA CONTESTADO SIGUE DISPONIBLE. El brief lo pide en el punto 4 --
 * "volver al paso 2 desde el 5 no borra nada"-- y sin esta línea la regla de
 * arriba lo cerraría igual: al volver al 2, sus anteriores están completos, así
 * que abre; pero si alguien saltara al 5 con el 4 sin contestar, el 5 cierra.
 * Es la diferencia entre "no llegaste todavía" y "ya pasaste por acá".
 */
export function isStepUnlocked(
  script: ReviewScript,
  responses: ReviewResponse[],
  step: StepRef
): boolean {
  const hechos = answeredSteps(responses);
  if (hechos.has(clave(step))) return true;
  for (const s of orderedSteps(script)) {
    if (sameStep(s, step)) return true;
    if (!hechos.has(clave(s))) return false;
  }
  /* El paso no está en el guion. No se habilita: no existe. */
  return false;
}

/**
 * El paso al que lleva `Save and exit` cuando alguien vuelve: el PRIMERO
 * incompleto del guion.
 *
 * ⚠ Y NO EL CURSOR GUARDADO, a propósito. Si alguien completó el 1 y el 2,
 * volvió a mirar el 1 y salió, el cursor dice 1 y ahí no hay nada que hacer.
 * Lo que la persona necesita al reentrar es dónde seguir, y eso es el primero
 * que falta. Lo hecho queda visible igual, que es la otra mitad del punto 4.
 *
 * Con el guion entero completo devuelve `null`: no hay dónde seguir.
 */
export function resumeCursor(
  script: ReviewScript,
  responses: ReviewResponse[]
): StepRef | null {
  const hechos = answeredSteps(responses);
  for (const s of orderedSteps(script)) {
    if (!hechos.has(clave(s))) return { phase_no: s.phase_no, step_in_phase: s.step_in_phase };
  }
  return null;
}

/** `true` si no queda ningún paso del guion sin contestar. */
export function isComplete(script: ReviewScript, responses: ReviewResponse[]): boolean {
  return script.steps.length > 0 && resumeCursor(script, responses) === null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ABANDONADA: SE DERIVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Una sesión abandonada es una `in_progress` que no se toca desde hace días.
 * No es un tercer estado en la base: guardarlo obligaría a que algo la marque
 * --un cron, o la propia pantalla al abrirla-- y a decidir qué pasa cuando la
 * persona vuelve, que sería devolverla a `in_progress` y entonces el estado no
 * diría nada que la fecha no diga mejor. Es `blocked` de BP46 otra vez.
 *
 * "Sin tocar" se mide contra la última RESPUESTA, y si no hay ninguna contra
 * `started_at`: una sesión que se abrió y no contestó nada lleva sin tocarse
 * desde que se abrió.
 *
 * El umbral se pasa por argumento y no vive acá: dos días es razonable para una
 * revisión con SLA semanal y no lo es para otra cosa, y un número correcto en
 * general no existe -- la misma razón por la que `medirRuta` no fija el timeout.
 */
export function lastTouchedAt(session: ReviewSession, responses: ReviewResponse[]): string {
  const mias = responses.filter((r) => r.session_key === session.session_key);
  if (mias.length === 0) return session.started_at;
  return mias.reduce((a, b) => (a.answered_at >= b.answered_at ? a : b)).answered_at;
}

export function isAbandoned(
  session: ReviewSession,
  responses: ReviewResponse[],
  opts: { now: Date; staleDays: number }
): boolean {
  if (session.status !== 'in_progress') return false;
  const tocada = new Date(lastTouchedAt(session, responses)).getTime();
  if (Number.isNaN(tocada)) return false;
  const dias = (opts.now.getTime() - tocada) / 86_400_000;
  return dias >= opts.staleDays;
}

/**
 * Días hasta el SLA, contra el día de HOY y no contra el instante.
 *
 * `due_on` es una fecha de calendario, así que comparar instantes haría que
 * "vence hoy" pasara a "venció" a mitad de la tarde. Se comparan las dos como
 * `YYYY-MM-DD` en la zona local de quien mira.
 *
 * Negativo = vencida. Cero = vence hoy.
 */
export function daysUntilDue(dueOn: string, now: Date): number {
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [a, m, d] = dueOn.split('-').map(Number);
  if (!a || !m || !d) return 0;
  const vence = new Date(a, m - 1, d).getTime();
  return Math.round((vence - hoy) / 86_400_000);
}
