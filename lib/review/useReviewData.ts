'use client';

/**
 * ============================================================================
 * MODO REVISIÓN — LAS LECTURAS
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Dos hooks, y la separación entre ellos no es cosmética:
 *
 *   `useReviewScript`   el GUION. Igual para todos y casi inmutable: tres
 *                       fases, ocho pasos, ocho textos. Lo lee cualquiera.
 *   `useMyReviews`      MIS asignaciones con sus sesiones y respuestas. Cambia
 *                       en cada paso que alguien completa.
 *
 * Juntos, cada respuesta guardada recargaría el guion — cincuenta filas que no
 * se movieron.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL ESQUEMA PUEDE NO ESTAR ALCANZABLE, Y ESO NO ES UN ERROR DEL USUARIO
 * ---------------------------------------------------------------------------
 * `review` es un esquema nuevo, y un esquema nuevo NO se expone solo en
 * PostgREST: hace falta `docs/sql/2026-09-review-expose-schema.sql`. Mientras no
 * esté, la respuesta es un 406 con `PGRST106`, y las pantallas tienen que decir
 * QUÉ FALTA en vez de romperse — mismo criterio que `useFunnelLibrary` con el
 * 404 de las tablas de BP.
 *
 * Se distingue del resto a propósito, y es lo que evita mandar a alguien a
 * mirar el lugar equivocado:
 *
 *   `PGRST106` / 406   el esquema no está expuesto
 *   `PGRST205` / 404   la tabla no existe
 *   403                falta un GRANT
 *   cero filas, sin error   una policy de RLS que no aplica
 */

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type {
  MyReview,
  ReviewAssignment,
  ReviewPhase,
  ReviewResponse,
  ReviewScript,
  ReviewSession,
  ReviewStep,
  ReviewStepPrompt,
} from './types';

/** Por qué no hay datos, cuando no los hay. */
export type ReviewUnavailable = 'schema-not-exposed' | 'tables-missing' | null;

interface Estado<T> {
  data: T | null;
  isLoading: boolean;
  /** `null` = hay datos. Si no, qué falta aplicar. */
  unavailable: ReviewUnavailable;
  error: string | null;
}

const rv = () => getSupabaseClient().schema('review');

/**
 * Traduce el error de PostgREST a QUÉ FALTA.
 *
 * `code` y no el texto del mensaje: el mensaje cambia entre versiones y el
 * código no. Y devolver `null` para cualquier otro error es deliberado — un
 * error que no es "falta aplicar algo" tiene que salir como error y no
 * disfrazarse de pantalla pendiente.
 */
function queFalta(e: { code?: string } | null): ReviewUnavailable {
  if (!e) return null;
  if (e.code === 'PGRST106') return 'schema-not-exposed';
  if (e.code === 'PGRST205' || e.code === '42P01') return 'tables-missing';
  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EL GUION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Los textos llegan TODOS y se queda la revisión más alta de cada paso acá, no
 * en SQL: PostgREST no tiene `distinct on`, y hacer una consulta por paso serían
 * ocho viajes para ocho filas. Con ocho pasos y una revisión cada uno son ocho
 * filas en total; el día que haya cinco revisiones de cada uno serán cuarenta,
 * que sigue siendo una consulta.
 */
export function useReviewScript(
  /**
   * `false` = no consultar. El corte va ADENTRO del hook y no en la llamada:
   * llamar un hook condicionalmente rompe el orden de hooks de React.
   */
  habilitado = true
): Estado<ReviewScript> & { reload: () => void } {
  const [estado, setEstado] = useState<Estado<ReviewScript>>({
    data: null,
    isLoading: true,
    unavailable: null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!habilitado) return;
    let cancelado = false;
    (async () => {
      try {
        const [fasesRes, pasosRes, textosRes] = await Promise.all([
          rv().from('phase').select('*').order('phase_no'),
          rv().from('step').select('*').order('phase_no').order('step_in_phase'),
          rv().from('step_prompt').select('*'),
        ]);
        if (cancelado) return;

        const falta = queFalta(fasesRes.error) ?? queFalta(pasosRes.error);
        if (falta) {
          setEstado({ data: null, isLoading: false, unavailable: falta, error: null });
          return;
        }
        if (fasesRes.error) throw new Error(fasesRes.error.message);
        if (pasosRes.error) throw new Error(pasosRes.error.message);

        /* La revisión vigente de cada paso: la más alta. */
        const porPaso = new Map<string, ReviewStepPrompt>();
        for (const t of (textosRes.data ?? []) as ReviewStepPrompt[]) {
          const k = t.phase_no + ':' + t.step_in_phase;
          const previo = porPaso.get(k);
          if (!previo || t.revision > previo.revision) porPaso.set(k, t);
        }

        setEstado({
          data: {
            phases: (fasesRes.data ?? []) as ReviewPhase[],
            steps: (pasosRes.data ?? []) as ReviewStep[],
            prompts: [...porPaso.values()],
          },
          isLoading: false,
          unavailable: null,
          error: null,
        });
      } catch (err) {
        if (!cancelado) {
          setEstado({
            data: null,
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
  }, [tick, habilitado]);

  return { ...estado, reload };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MIS REVISIONES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ NO FILTRA POR REVISOR EN LA CONSULTA, y es correcto: lo hace RLS,
 * comparando el email de la sesión contra `assignment.reviewer_employee_key`.
 *
 * Filtrar acá TAMBIÉN sería duplicar la regla en un lugar donde no protege
 * nada, y el día que las dos divergieran ganaría la de la base — así que la de
 * acá sólo podría esconder filas que sí corresponden. Quien tiene
 * `review_admin` ve todas, y esa diferencia también sale de la policy.
 *
 * El nombre del Loan Officer se lee de `org.dim_employee` por separado: la
 * asignación guarda la clave, no el nombre, para que renombrar a alguien no
 * deje asignaciones diciendo el nombre viejo.
 */
export function useMyReviews(
  /** `false` = no consultar. Ver la nota de `useReviewScript`. */
  habilitado = true
): Estado<MyReview[]> & {
  reload: () => void;
  /**
   * Quién es quien mira, para `review`. `null` = su email no está en el roster
   * activo, y entonces NUNCA va a ver una asignación: las policies comparan
   * contra `review.my_employee_key()`.
   *
   * ⚠ SIN ESTO, «no tengo nada asignado» y «no estoy en el roster» son la
   * misma pantalla: cero filas con `error: null` en los dos casos. Y las
   * respuestas son opuestas -- la primera se arregla asignando, la segunda no se
   * arregla desde esta app.
   *
   * `undefined` mientras la pregunta viaja, que tampoco es lo mismo que `null`.
   */
  myEmployeeKey: number | null | undefined;
  /**
   * `true` si esta sesión puede ASIGNAR. Sale de `review.can_assign()`, o sea
   * de la MISMA función que protege las escrituras.
   *
   * ⚠ SE PREGUNTA A LA BASE Y NO SE LEE EL CLAIM EN EL CLIENTE, por dos
   * razones: el cliente de navegador devuelve el usuario SIN
   * `app_metadata.allowed_apps` --verificado, y es por eso que el layout raíz
   * lee los claims en el servidor-- y porque preguntando no hay dos criterios
   * que puedan divergir.
   *
   * `undefined` mientras viaja, que no es lo mismo que `false`.
   */
  canAssign: boolean | undefined;
} {
  const [estado, setEstado] = useState<Estado<MyReview[]>>({
    data: null,
    isLoading: true,
    unavailable: null,
    error: null,
  });
  const [yo, setYo] = useState<number | null | undefined>(undefined);
  const [puedeAsignar, setPuedeAsignar] = useState<boolean | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!habilitado) return;
    let cancelado = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        /* Se pregunta ANTES de la lista: si la respuesta es `null`, la lista
           vacia que venga despues ya se puede explicar. */
        const [quienSoy, asigna] = await Promise.all([
          rv().rpc('my_employee_key'),
          rv().rpc('can_assign'),
        ]);
        if (cancelado) return;
        if (!quienSoy.error) setYo(typeof quienSoy.data === 'number' ? quienSoy.data : null);
        if (!asigna.error) setPuedeAsignar(asigna.data === true);

        const asigRes = await rv()
          .from('assignment')
          .select('*')
          .eq('is_active', true)
          .order('due_on');
        if (cancelado) return;

        const falta = queFalta(asigRes.error);
        if (falta) {
          setEstado({ data: null, isLoading: false, unavailable: falta, error: null });
          return;
        }
        if (asigRes.error) throw new Error(asigRes.error.message);
        const asignaciones = (asigRes.data ?? []) as ReviewAssignment[];

        if (asignaciones.length === 0) {
          setEstado({ data: [], isLoading: false, unavailable: null, error: null });
          return;
        }

        const claves = asignaciones.map((x) => x.assignment_key);
        const [sesRes, empRes] = await Promise.all([
          rv().from('session').select('*').in('assignment_key', claves).order('started_at'),
          supabase
            .schema('org')
            .from('dim_employee')
            .select('employee_key, full_name')
            .in('employee_key', [...new Set(asignaciones.map((x) => x.lo_employee_key))]),
        ]);
        if (cancelado) return;
        if (sesRes.error) throw new Error(sesRes.error.message);

        const sesiones = (sesRes.data ?? []) as ReviewSession[];
        let respuestas: ReviewResponse[] = [];
        if (sesiones.length > 0) {
          const resRes = await rv()
            .from('response')
            .select('*')
            .in('session_key', sesiones.map((s) => s.session_key));
          if (cancelado) return;
          if (resRes.error) throw new Error(resRes.error.message);
          respuestas = (resRes.data ?? []) as ReviewResponse[];
        }

        const nombre = new Map(
          ((empRes.data ?? []) as { employee_key: number; full_name: string }[]).map((e) => [
            e.employee_key,
            e.full_name,
          ])
        );

        const filas: MyReview[] = asignaciones.map((asignacion) => {
          /*
           * La sesión VIGENTE de la asignación: la en curso si hay, y si no la
           * última terminada.
           *
           * Nunca hay dos en curso de la misma asignación --el índice único
           * parcial de la base lo impide-- así que `find` no elige entre dos.
           * Y con varias terminadas vale la más nueva: es la que la pantalla
           * tiene que mostrar como "última revisión".
           */
          const mias = sesiones.filter((s) => s.assignment_key === asignacion.assignment_key);
          const enCurso = mias.find((s) => s.status === 'in_progress') ?? null;
          const ultima =
            mias.length === 0
              ? null
              : mias.reduce((a, b) => (a.started_at >= b.started_at ? a : b));
          const session = enCurso ?? ultima;
          return {
            assignment: asignacion,
            /* Sin nombre no se inventa una clave con forma de persona: el
               fallback lo dice. Es el error que BP41 encontró con `employee 25`. */
            loName: nombre.get(asignacion.lo_employee_key) ?? 'employee ' + asignacion.lo_employee_key,
            session,
            responses: session
              ? respuestas.filter((r) => r.session_key === session.session_key)
              : [],
          };
        });

        setEstado({ data: filas, isLoading: false, unavailable: null, error: null });
      } catch (err) {
        if (!cancelado) {
          setEstado({
            data: null,
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
  }, [tick, habilitado]);

  return { ...estado, reload, myEmployeeKey: yo, canAssign: puedeAsignar };
}
