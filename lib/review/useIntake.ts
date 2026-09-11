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
 * ⚠ EL INTAKE ES DEL EQUIPO, Y ESO CAMBIÓ QUÉ PUEDE DECIR ESTA PANTALLA
 * ---------------------------------------------------------------------------
 * `session_select` y `response_select` pasaron a `review.has_access()` a secas
 * --o sea, `commercial_activity`--. Antes pedían además `review_admin` o ser el
 * revisor de esa asignación, y eso hacía que Isabella no pudiera leer la
 * revisión que hizo Fernando: un registro compartido detrás de un permiso
 * personal.
 *
 * Escribir NO cambió: `response_insert` sigue pidiendo `owns_session`. Se lee
 * en equipo y se escribe de a uno.
 *
 * ⚠ Y POR ESO ESTE HOOK YA NO DEVUELVE `visible`. Las dos policies son ahora
 * EL MISMO predicado, así que «veo la sesión pero no sus respuestas» dejó de
 * ser un estado posible: quien ve una ve las otras, y quien no tiene el claim
 * no ve ninguna de las dos --ni llega a Business Plan--. Medido: tres personas
 * con `commercial_activity` y sin `review_admin` leen las 3 respuestas de una
 * sesión que no es suya.
 *
 * ⚠ SI ALGUNA VEZ `response_select` SE VUELVE MÁS ESTRECHA QUE `session_select`,
 * este estado tiene que volver: ahí cero respuestas sobre una sesión visible
 * vuelve a significar dos cosas. Hoy significa una sola, y decirla mal era peor
 * que no decir nada.
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
  /** Sólo las revisiones CERRADAS, con sus respuestas. Ver la nota de RV4. */
  sessions: IntakeSession[] | null;
  /**
   * Cuántas revisiones de esta persona están EN CURSO. Se cuentan y no se
   * muestran: su contenido se está escribiendo, pero «hay una sin cerrar» es
   * distinto de «no hay nada», y sin este número la pantalla no podía decirlo.
   */
  enCurso: number;
  isLoading: boolean;
  unavailable: ReviewUnavailable;
  error: string | null;
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
    enCurso: 0,
    isLoading: true,
    unavailable: null,
    error: null,
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
         * ⚠ EL CONTENIDO, SÓLO DE LAS CERRADAS — etapa RV4.
         *
         * RV1 traía también las en curso, con el argumento de que una revisión a
         * medias ya tiene comentarios que valen. Probado por Isabella, el
         * argumento estaba mal: el intake apareció en el perfil MIENTRAS ella
         * revisaba, o sea que la pantalla mostraba como registro algo que
         * todavía se estaba escribiendo, y encima al lado del panel donde se
         * escribe.
         *
         * Un registro es de lo que YA PASÓ. Lo que está en curso se ve en la
         * máscara, que es su lugar, y al cerrar hay un resumen completo antes de
         * soltarla -- ver `ReviewSummary`.
         *
         * ⚠ PERO SE TRAEN LAS DOS Y SE FILTRA ACÁ, que es el cambio de RV23. El
         * `.eq('status', 'completed')` de RV4 hacía que una persona con una
         * revisión abierta y ninguna cerrada fuera INDISTINGUIBLE de una sin
         * ninguna revisión: las dos daban cero filas y el perfil no dibujaba
         * nada. Hoy le pasa a Aimmee Buendia --sesión 61, 7 de 8 contestados--
         * y a Luis Silva. Contar no es mostrar: el contenido de la abierta
         * sigue sin verse, y lo único que se dice es que existe.
         */
        const sesRes = await rv()
          .from('session')
          .select('*')
          .eq('lo_employee_key', loEmployeeKey)
          .order('started_at', { ascending: false });
        if (cancelado) return;

        const falta = queFalta(sesRes.error);
        if (falta) {
          setEstado({ sessions: null, enCurso: 0, isLoading: false, unavailable: falta, error: null });
          return;
        }
        if (sesRes.error) throw new Error(sesRes.error.message);
        const todas = (sesRes.data ?? []) as ReviewSession[];
        const sesiones = todas.filter((s) => s.status === 'completed');
        const enCurso = todas.filter((s) => s.status === 'in_progress').length;

        if (sesiones.length === 0) {
          setEstado({ sessions: [], enCurso, isLoading: false, unavailable: null, error: null });
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
         * ⚠ ACÁ VIVÍA EL HEURÍSTICO DE «NO TENÉS PERMISO», Y SE FUE — etapa RV23.
         *
         * Decía: cero respuestas sobre una sesión cerrada es RLS, «porque una
         * sesión cerrada tiene respuestas por construcción». Las dos mitades
         * están mal hoy:
         *
         *   · el permiso ya no puede filtrar --las dos policies son el mismo
         *     predicado--, así que la causa que elegía no ocurre;
         *   · y la construcción que invocaba es de la APP, no de la base: la
         *     sesión 62 se cerró por REST sin una sola respuesta y existe.
         *
         * Resultado: en el perfil de Luis Silva decía «no podés leer los
         * comentarios» cuando el permiso estaba y los comentarios no existían.
         * Dos causas con el mismo síntoma --cero filas-- y el código eligiendo
         * la que ya no pasa.
         *
         * La distinción que SÍ se puede sostener es la que queda: hay
         * respuestas, o la revisión se cerró sin ninguna. Eso lo dice la
         * pantalla con `fases.length`, sin una bandera aparte.
         */

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
          enCurso,
          isLoading: false,
          unavailable: null,
          error: null,
        });
      } catch (err) {
        if (!cancelado) {
          setEstado({
            sessions: null,
            enCurso: 0,
            isLoading: false,
            unavailable: null,
            error: err instanceof Error ? err.message : String(err),
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
