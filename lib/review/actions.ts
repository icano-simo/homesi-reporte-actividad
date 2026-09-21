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
 */
export async function arrancarOSeguir(
  assignmentKey: number,
  loEmployeeKey: number,
  primerPaso: StepRef
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
