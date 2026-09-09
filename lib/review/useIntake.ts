'use client';

/**
 * ============================================================================
 * EL INTAKE: LO QUE SE DIJO EN LAS REVISIONES DE UNA PERSONA
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO. Punto 5 del brief.
 *
 * ---------------------------------------------------------------------------
 * ⚠ MUESTRA EL TEXTO QUE SE CONTESTÓ, NO EL VIGENTE
 * ---------------------------------------------------------------------------
 * Acá se cobra `response.prompt_revision`. Cada respuesta guarda contra qué
 * versión de la pregunta se contestó, así que el intake lee EL PROMPT DE ESA
 * REVISIÓN y no el más nuevo.
 *
 * Sin eso, Isabella edita un texto y el intake de marzo empieza a decir que
 * Nathan contestó la pregunta de septiembre. Es la misma razón por la que el
 * plan se COPIA al activar un funnel: lo que pasó no se reescribe cuando
 * cambian las reglas.
 *
 * Por eso se leen TODAS las revisiones de `step_prompt`, no la última: la
 * lectura del guion que usa la máscara se queda con la más alta, y ésta
 * necesita las viejas.
 *
 * ---------------------------------------------------------------------------
 * ⚠ QUIÉN LO PUEDE VER LO DECIDE RLS, Y NO ES TODO EL MUNDO
 * ---------------------------------------------------------------------------
 * `response_select` deja leer a quien tiene `review_admin` o es el revisor de
 * esa asignación. Así que en el perfil de un Loan Officer, alguien más del
 * portal ve CERO respuestas con `error: null` — el silencio de siempre.
 *
 * Este hook devuelve `visible` para que la pantalla pueda decir «no tenés
 * permiso para verlo» en vez de «no hay nada», que son dos cosas distintas. Si
 * Isabella decide que el intake sea legible por todo el portal, eso es una
 * policy más y no un cambio acá.
 */

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type {
  ReviewPhase,
  ReviewResponse,
  ReviewSession,
  ReviewStep,
  ReviewStepPrompt,
} from './types';
import type { ReviewUnavailable } from './useReviewData';

const rv = () => getSupabaseClient().schema('review');

/** Una respuesta ya resuelta contra su pregunta y su paso. */
export interface IntakeAnswer {
  phase_no: number;
  step_in_phase: number;
  stepLabel: string;
  /** El prompt de la revisión CONTESTADA. `null` si esa revisión ya no está. */
  prompt: string | null;
  /** `true` si el texto de la pregunta cambió desde que se contestó. */
  promptDesactualizado: boolean;
  comment: string;
  answeredAt: string;
  answeredBy: string;
  gate: Record<string, unknown> | null;
}

/** Una revisión, con sus respuestas agrupadas por fase. */
export interface IntakeSession {
  session: ReviewSession;
  reviewerEmail: string;
  fases: { phase_no: number; label: string; answers: IntakeAnswer[] }[];
}

export interface IntakeState {
  sessions: IntakeSession[] | null;
  isLoading: boolean;
  unavailable: ReviewUnavailable;
  error: string | null;
  /**
   * `false` = hay revisiones de esta persona pero RLS no deja ver sus
   * respuestas. NO es lo mismo que no haber contestado nada.
   */
  visible: boolean;
  reload: () => void;
}

function queFalta(e: { code?: string } | null): ReviewUnavailable {
  if (!e) return null;
  if (e.code === 'PGRST106') return 'schema-not-exposed';
  if (e.code === 'PGRST205' || e.code === '42P01') return 'tables-missing';
  return null;
}

export function useIntake(loEmployeeKey: number | null, habilitado = true): IntakeState {
  const [estado, setEstado] = useState<Omit<IntakeState, 'reload'>>({
    sessions: null,
    isLoading: true,
    unavailable: null,
    error: null,
    visible: true,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    /*
     * ⚠ NO se escribe `sessions: []` acá, y son dos razones distintas.
     *
     * La primera es de significado: una lista vacía dice «esta persona no tiene
     * revisiones», y lo que pasa es que NADIE PREGUNTÓ. Son los dos estados que
     * no hay que compensar — el mismo criterio que hace que un benchmark sin
     * fijar se guarde como `null` y no como `0`. `isLoading` sigue en `true`,
     * que es lo que de verdad describe «no se consultó».
     *
     * La segunda es de React: un `setState` sincrónico en el cuerpo de un
     * efecto dispara un render en cascada, y `react-hooks/set-state-in-effect`
     * lo marca como error. Es el mismo corte que usan los otros dos hooks de
     * `review`.
     */
    if (!habilitado || loEmployeeKey === null) return;
    let cancelado = false;
    (async () => {
      try {
        /*
         * Las sesiones de ESTA persona. `lo_employee_key` está en la sesión
         * --copiado y clavado por la FK compuesta-- así que no hace falta pasar
         * por la asignación para filtrar.
         *
         * Las EN CURSO también: el brief pide comparar varias revisiones, y una
         * a medias ya tiene comentarios que valen. Se marca cuál es cuál con su
         * `status`.
         */
        const sesRes = await rv()
          .from('session')
          .select('*')
          .eq('lo_employee_key', loEmployeeKey)
          .order('started_at', { ascending: false });
        if (cancelado) return;

        const falta = queFalta(sesRes.error);
        if (falta) {
          setEstado({ sessions: null, isLoading: false, unavailable: falta, error: null, visible: true });
          return;
        }
        if (sesRes.error) throw new Error(sesRes.error.message);
        const sesiones = (sesRes.data ?? []) as ReviewSession[];

        if (sesiones.length === 0) {
          setEstado({ sessions: [], isLoading: false, unavailable: null, error: null, visible: true });
          return;
        }

        const [resRes, fasesRes, pasosRes, textosRes] = await Promise.all([
          rv().from('response').select('*').in('session_key', sesiones.map((s) => s.session_key)),
          rv().from('phase').select('*').order('phase_no'),
          rv().from('step').select('*').order('phase_no').order('step_in_phase'),
          /* TODAS las revisiones, no la última: ver la nota de arriba. */
          rv().from('step_prompt').select('*'),
        ]);
        if (cancelado) return;
        if (resRes.error) throw new Error(resRes.error.message);

        const respuestas = (resRes.data ?? []) as ReviewResponse[];
        const fases = (fasesRes.data ?? []) as ReviewPhase[];
        const pasos = (pasosRes.data ?? []) as ReviewStep[];
        const textos = (textosRes.data ?? []) as ReviewStepPrompt[];

        /*
         * ⚠ CERO RESPUESTAS CON SESIONES QUE EXISTEN = RLS FILTRÓ.
         *
         * Se distingue de «no contestó nada» mirando si alguna sesión tiene un
         * cursor más allá del primer paso, que es la señal de que algo se
         * contestó. No es perfecta --alguien puede haber abierto y no contestado
         * nada-- así que la pantalla dice las dos posibilidades en vez de elegir.
         */
        const algunaAvanzo = sesiones.some(
          (s) => s.status === 'completed' || s.current_phase > 1 || s.current_step_in_phase > 1
        );
        const visible = respuestas.length > 0 || !algunaAvanzo;

        /* El prompt de una revisión concreta. `null` si esa fila ya no está. */
        const promptDe = (r: ReviewResponse): ReviewStepPrompt | null =>
          textos.find(
            (t) =>
              t.phase_no === r.phase_no &&
              t.step_in_phase === r.step_in_phase &&
              t.revision === r.prompt_revision
          ) ?? null;
        const revisionMasAlta = (r: ReviewResponse): number =>
          Math.max(
            0,
            ...textos
              .filter((t) => t.phase_no === r.phase_no && t.step_in_phase === r.step_in_phase)
              .map((t) => t.revision)
          );

        const armadas: IntakeSession[] = sesiones.map((s) => {
          const mias = respuestas.filter((r) => r.session_key === s.session_key);
          return {
            session: s,
            reviewerEmail: s.started_by,
            fases: fases
              .map((f) => {
                const deLaFase = mias
                  .filter((r) => r.phase_no === f.phase_no)
                  /*
                   * La VIGENTE de cada paso: la tabla es append-only, así que
                   * corregir un comentario agrega una fila. El intake muestra
                   * la última, no las tres.
                   */
                  .reduce<ReviewResponse[]>((acc, r) => {
                    const i = acc.findIndex((x) => x.step_in_phase === r.step_in_phase);
                    if (i === -1) return [...acc, r];
                    if (r.answered_at > acc[i].answered_at) acc[i] = r;
                    return acc;
                  }, [])
                  .sort((a, b) => a.step_in_phase - b.step_in_phase);
                return {
                  phase_no: f.phase_no,
                  label: f.label,
                  answers: deLaFase.map<IntakeAnswer>((r) => {
                    const t = promptDe(r);
                    return {
                      phase_no: r.phase_no,
                      step_in_phase: r.step_in_phase,
                      stepLabel:
                        pasos.find(
                          (x) => x.phase_no === r.phase_no && x.step_in_phase === r.step_in_phase
                        )?.label ?? 'step ' + r.step_in_phase,
                      prompt: t?.prompt ?? null,
                      promptDesactualizado: r.prompt_revision < revisionMasAlta(r),
                      comment: r.comment,
                      answeredAt: r.answered_at,
                      answeredBy: r.answered_by,
                      gate: r.gate,
                    };
                  }),
                };
              })
              /* Una fase sin respuestas no se dibuja: el intake es lo que se
                 dijo, no un formulario vacío. */
              .filter((f) => f.answers.length > 0),
          };
        });

        setEstado({
          sessions: armadas,
          isLoading: false,
          unavailable: null,
          error: null,
          visible,
        });
      } catch (err) {
        if (!cancelado) {
          setEstado({
            sessions: null,
            isLoading: false,
            unavailable: null,
            error: err instanceof Error ? err.message : String(err),
            visible: true,
          });
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [loEmployeeKey, habilitado, tick]);

  return { ...estado, reload };
}
