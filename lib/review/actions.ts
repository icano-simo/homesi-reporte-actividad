'use client';

/**
 * ============================================================================
 * MODO REVISIÓN — LAS ESCRITURAS
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Todas devuelven el error como TEXTO en vez de lanzarlo, y ninguna decide qué
 * mostrar: eso lo hace la pantalla.
 *
 * ---------------------------------------------------------------------------
 * ⚠ TODAS MIRAN LAS FILAS AFECTADAS, NO SÓLO `error`
 * ---------------------------------------------------------------------------
 * RLS FILTRA, NO RECHAZA. Un `update` que ninguna policy permite no devuelve
 * error: devuelve cero filas con `error: null`. Sin `.select()` y sin contar,
 * la pantalla diría "guardado" sobre algo que no pasó -- es el silencio que
 * BP42 documentó y que hizo que nadie pudiera completar un step durante
 * semanas.
 *
 * Así que cada función pide las filas de vuelta y trata el cero como un fallo
 * con un mensaje que dice QUÉ hacer, no qué pasó.
 */

import { getSupabaseClient } from '@/lib/supabase/client';
import type { ReviewResponse, ReviewSession, StepRef } from './types';

const rv = () => getSupabaseClient().schema('review');

/** El email de la sesión. Todas las escrituras lo necesitan: las policies lo exigen. */
async function emailDeLaSesion(): Promise<string> {
  const { data } = await getSupabaseClient().auth.getUser();
  return data.user?.email ?? '';
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

const NO_ACEPTO =
  'The database did not accept it. Either the review is not yours or your email is not in the ' +
  'roster — nothing was saved.';

/**
 * El `employee_key` de quien está mirando, o `null` si su email no está en el
 * roster activo.
 *
 * ⚠ HACE FALTA UNA LLAMADA APARTE, y no es redundante con la lista de
 * asignaciones. Las policies comparan contra esta función, así que para alguien
 * fuera del roster devuelve `null` y TODAS las consultas vuelven vacías con
 * `error: null`. Sin preguntarlo, la pantalla no puede distinguir:
 *
 *   · «no tenés nada asignado»          → cero filas, y estás en el roster
 *   · «no estás en el roster»           → cero filas, y nunca vas a ver nada
 *
 * Son dos situaciones con la misma forma y respuestas opuestas: la primera se
 * arregla asignando, la segunda no se arregla desde esta app. Medido: el usuario
 * de prueba de la sonda devuelve `null` acá, y su lista de revisiones vuelve
 * vacía sin un solo error.
 */
export async function leerMiEmployeeKey(): Promise<Resultado<number | null>> {
  const { data, error } = await rv().rpc('my_employee_key');
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: typeof data === 'number' ? data : null };
}

/**
 * Arranca una sesión, o devuelve la que ya está en curso.
 *
 * ⚠ NO CREA UNA SEGUNDA. Se busca primero la en curso de esa asignación y se
 * devuelve tal cual: el brief pide que una sesión abandonada se RETOME, no que
 * se abra otra. Y aunque el código lo intentara, la base lo impide --
 * `session_one_in_progress_idx` es único por Loan Officer.
 *
 * El cursor de una sesión nueva arranca en el primer paso del guion, que se
 * recibe por argumento en vez de asumirse `(1, 1)`: la fase 1 podría no
 * empezar en el paso 1 si alguien reordena el guion.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `esPractica` ES OBLIGATORIO, Y NO TIENE VALOR POR DEFECTO — etapa RV27
 * ---------------------------------------------------------------------------
 * La sesión hereda la marca de su asignación por una FK COMPUESTA contra
 * `(assignment_key, is_practice)`. O sea que omitir la columna NO es "queda en
 * false": sobre una asignación de práctica no existe la fila `(clave, false)`,
 * y la base rechaza la inserción con `23503`.
 *
 * Medido antes de tocar esto, contra la base de producción y sobre una
 * asignación de práctica construida para eso:
 *
 *   sin is_practice   23503  session_practice_matches_assignment
 *   con is_practice   entró
 *
 * Así que `Start practice` no fallaba por permisos ni por la pantalla: no
 * podía funcionar. Un parámetro OPCIONAL con `= false` habría dejado el mismo
 * defecto esperando al primer llamador que se olvide -- que es la familia del
 * valor por defecto que tapa la ausencia. Obligatorio, el compilador lo pide.
 */
export async function arrancarOSeguir(
  assignmentKey: number,
  loEmployeeKey: number,
  primerPaso: StepRef,
  esPractica: boolean
): Promise<Resultado<ReviewSession>> {
  const yaHay = await rv()
    .from('session')
    .select('*')
    .eq('assignment_key', assignmentKey)
    .eq('status', 'in_progress')
    /*
     * `limit(1)` CON `order`: sin ordenar, "la primera" es la que la base
     * devuelva. Acá no puede haber dos --el índice único lo impide-- así que el
     * orden no cambia el resultado; está para que la consulta no dependa de una
     * garantía que vive en otro archivo. Es el defecto que `useEnrollment`
     * tiene hoy y que BP39 va a tener que arreglar.
     */
    .order('started_at', { ascending: false })
    .limit(1);
  if (yaHay.error) return { ok: false, error: yaHay.error.message };
  const enCurso = (yaHay.data ?? [])[0] as ReviewSession | undefined;
  if (enCurso) return { ok: true, data: enCurso };

  const nueva = await rv()
    .from('session')
    .insert({
      assignment_key: assignmentKey,
      lo_employee_key: loEmployeeKey,
      is_practice: esPractica,
      current_phase: primerPaso.phase_no,
      current_step_in_phase: primerPaso.step_in_phase,
      started_by: await emailDeLaSesion(),
    })
    .select('*');
  if (nueva.error) return { ok: false, error: nueva.error.message };
  const fila = (nueva.data ?? [])[0] as ReviewSession | undefined;
  if (!fila) return { ok: false, error: NO_ACEPTO };
  return { ok: true, data: fila };
}

/**
 * Borra UNA sesión de práctica y sus respuestas, para volver a empezarla.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ES LA ÚNICA ESCRITURA DE TODO EL MÓDULO QUE BORRA, Y NO PASA POR RLS
 * ---------------------------------------------------------------------------
 * `review` no tiene ninguna policy de DELETE --decisión de RV1, el intake se
 * conserva-- así que esto NO puede hacerse con un `.delete()`: ese intento no
 * falla, devuelve cero filas con `error: null`, que es el silencio de siempre.
 *
 * Lo hace `review.reiniciar_practica`, `security definer`, que comprueba tres
 * cosas antes de tocar nada: que la sesión exista, que sea de práctica, y que
 * quien llama sea el revisor de esa asignación. Las tres se niegan con una
 * excepción, así que acá un `error` es un NO de la base y no un fallo de red.
 *
 * ⚠ Y NO SE MIRA SÓLO `error`. La función devuelve cuántas filas borró, y ese
 * número es lo que distingue «reinicié» de «corrió y no había nada»: un
 * `sesiones_borradas = 0` con `error: null` sería la misma mentira tranquila
 * que un update sin `returning`.
 */
export async function reiniciarPractica(
  sessionKey: number
): Promise<Resultado<{ respuestas: number; sesiones: number }>> {
  const { data, error } = await rv().rpc('reiniciar_practica', { p_session_key: sessionKey });
  if (error) return { ok: false, error: error.message };
  /*
   * `returns table (...)` llega como arreglo de una fila. Se estrecha acá y no
   * se confía en la forma: un `rpc` devuelve `any`, así que sin esto el conteo
   * de abajo sería una aserción del tipo y no una lectura del dato.
   */
  const filas = (data ?? []) as { respuestas_borradas: number; sesiones_borradas: number }[];
  const fila = filas[0];
  if (!fila || Number(fila.sesiones_borradas) === 0) {
    return {
      ok: false,
      error:
        'The database ran the reset and deleted nothing. That practice session may already be gone — reload the list.',
    };
  }
  return {
    ok: true,
    data: {
      respuestas: Number(fila.respuestas_borradas),
      sesiones: Number(fila.sesiones_borradas),
    },
  };
}

/**
 * Guarda la respuesta de un paso. ESO es completar el paso.
 *
 * ⚠ SE GUARDA AL COMPLETARSE, NO AL AVANZAR -- punto 4 del brief. Volver al
 * paso 2 desde el 5 no borra nada porque nada se borra nunca: la tabla es
 * append-only y corregir un comentario agrega una fila.
 *
 * `promptRevision` es la revisión que la persona VIO. Va por argumento y no se
 * vuelve a leer de la base acá: leerla de nuevo podría traer una más nueva si
 * alguien editó el texto mientras la revisión estaba abierta, y entonces la
 * respuesta quedaría atada a una pregunta que quien contestó no leyó.
 */
export async function guardarPaso(
  sessionKey: number,
  paso: StepRef,
  promptRevision: number,
  comment: string,
  gate: Record<string, unknown> | null
): Promise<Resultado<ReviewResponse>> {
  const texto = comment.trim();
  if (texto === '') return { ok: false, error: 'The comment cannot be empty.' };

  const r = await rv()
    .from('response')
    .insert({
      session_key: sessionKey,
      phase_no: paso.phase_no,
      step_in_phase: paso.step_in_phase,
      prompt_revision: promptRevision,
      comment: texto,
      gate,
      answered_by: await emailDeLaSesion(),
    })
    .select('*');
  if (r.error) return { ok: false, error: r.error.message };
  const fila = (r.data ?? [])[0] as ReviewResponse | undefined;
  /*
   * Cero filas acá tiene una causa concreta y vale nombrarla: la policy exige
   * que la sesión esté `in_progress`. Una revisión ya cerrada no acepta
   * respuestas nuevas, para que la fecha de completada siga significando algo.
   */
  if (!fila) {
    return {
      ok: false,
      error:
        'Nothing was saved. This review may already be closed — a completed review does not take ' +
        'new comments, so that its date keeps meaning something.',
    };
  }
  return { ok: true, data: fila };
}

/**
 * Mueve el cursor. NO avanza el trabajo: sólo dice dónde está la persona.
 *
 * ⚠ ES UNA LLAMADA APARTE de `guardarPaso`, y a propósito: el botón `Continue`
 * no navega solo. Se habilita cuando el paso se completa y la persona decide
 * cuándo pasar -- un redirect automático mientras están conversando con el Loan
 * Officer les mueve la pantalla debajo del cursor.
 */
export async function moverCursor(
  sessionKey: number,
  destino: StepRef
): Promise<Resultado<ReviewSession>> {
  const r = await rv()
    .from('session')
    .update({ current_phase: destino.phase_no, current_step_in_phase: destino.step_in_phase })
    .eq('session_key', sessionKey)
    .select('*');
  if (r.error) return { ok: false, error: r.error.message };
  const fila = (r.data ?? [])[0] as ReviewSession | undefined;
  if (!fila) return { ok: false, error: NO_ACEPTO };
  return { ok: true, data: fila };
}

/**
 * Cierra la revisión.
 *
 * `completed_at` se manda desde el cliente porque el `check` de la base exige
 * que esté cuando el estado es `completed`, y un `update` no puede llamar a
 * `now()` sin un trigger. La hora del cliente puede estar corrida; lo que
 * importa es el día, y para eso alcanza.
 *
 * ⚠ NO comprueba acá que el guion esté completo: eso lo decide la pantalla con
 * `isComplete`, que ya tiene el guion y las respuestas. Repetir la regla acá
 * daría dos lugares donde puede cambiar una sola.
 */
export async function cerrarSesion(sessionKey: number): Promise<Resultado<ReviewSession>> {
  const r = await rv()
    .from('session')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('session_key', sessionKey)
    .select('*');
  if (r.error) return { ok: false, error: r.error.message };
  const fila = (r.data ?? [])[0] as ReviewSession | undefined;
  if (!fila) return { ok: false, error: NO_ACEPTO };
  return { ok: true, data: fila };
}
