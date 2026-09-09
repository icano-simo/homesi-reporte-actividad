/**
 * ============================================================================
 * LAS COMPUERTAS: QUÉ HACE FALTA PARA CERRAR UN PASO
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Puro. Recibe el paso del guion y el borrador de lo que la persona hizo, y
 * dice si se puede guardar — y si no, POR QUÉ no.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL «POR QUÉ NO» ES LA MITAD QUE IMPORTA
 * ---------------------------------------------------------------------------
 * Un botón deshabilitado sin motivo es el peor control posible: la persona no
 * sabe si falta algo o si la app está rota. Así que `gateStatus` devuelve
 * siempre una razón cuando falta algo, y la pantalla la muestra al lado del
 * botón — nunca sólo lo apaga.
 *
 * Es la misma decisión que hizo que `isBlocked` describa en vez de prohibir: un
 * control que no explica obliga a adivinar.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS CLAVES DE `gate_config` SE LEEN CON CUIDADO
 * ---------------------------------------------------------------------------
 * El guion se edita por SQL, así que `gate_config` es `Record<string, unknown>`
 * y acá se estrecha al leerlo. Las que el guion aplicado usa hoy:
 *
 *   `number`  →  { mmi_link: 'https://…' }
 *   `clicks`  →  { required_clicks: ['total_pipeline', 'healthy_loans'] }
 *   `comment` →  { allow_second: false }        (sólo en la fase 3)
 *
 * Y NO se asume que estén: una clave que falta se trata como «esta compuerta no
 * pide eso», no como un error. Un guion recién editado no puede dejar la
 * pantalla sin botón.
 */

import type { ReviewStep } from './types';

/** Lo que la persona hizo en el paso, todavía sin guardar. */
export interface StepDraft {
  comment: string;
  /** El número del paso 2. `null` = no escribió ninguno. */
  numero?: number | null;
  /** Los identificadores que ya se clickearon en el paso 4. */
  clicks?: readonly string[];
  /** `true` si el presupuesto de la fase 2 quedó confirmado. */
  budgetListo?: boolean;
}

export interface GateStatus {
  /** `true` si el paso se puede guardar. */
  ok: boolean;
  /**
   * Qué falta, en la voz de quien mira. `null` sólo cuando `ok` es `true`.
   *
   * En inglés porque es texto de pantalla — el resto de los comentarios de este
   * repo van en español, la copia va en inglés.
   */
  falta: string | null;
}

/** Los identificadores que el paso pide clickear. Vacío si no pide ninguno. */
export function requiredClicks(step: ReviewStep): string[] {
  const raw = step.gate_config?.required_clicks;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

/** El link que el paso ofrece abrir, o `null`. Hoy sólo MMI, en el paso 2. */
export function gateLink(step: ReviewStep): string | null {
  const raw = step.gate_config?.mmi_link;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A QUÉ ELEMENTO APUNTA EL PASO — etapa RV2
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un selector de CSS, en `gate_config.target`. La pantalla se desplaza hasta
 * ahí y lo resalta mientras el paso está activo.
 *
 * ⚠ VA EN `gate_config` Y NO EN CÓDIGO porque agregar un paso tiene que seguir
 * siendo una fila. Y como es un selector cualquiera, un paso nuevo puede apuntar
 * a una clase QUE YA EXISTE sin tocar la pantalla: los dos pasos de Outlook
 * apuntan a `.ol-topbar` y `.ol-editor`, que estaban desde OL22.
 *
 * ⚠ `null` Y «NO ENCONTRADO» SON DISTINTOS, y el panel los trata distinto:
 *
 *   · `null`  = el paso no declara lugar. No hay requisito: se contesta desde
 *               donde sea. Es el estado de los pasos antes de esta etapa.
 *   · un selector que no está en la página = el paso SÍ tiene lugar y no
 *               estamos ahí. El panel no ofrece el campo y dice a dónde ir.
 *
 * Darles el mismo valor --por ejemplo tratar «no lo encuentro» como «no pide
 * lugar»-- haría que un selector con un error de tipeo se comportara igual que
 * un paso sin lugar, y nadie se enteraría nunca. Es el respaldo que hace que la
 * ausencia no se note.
 */
export function stepTarget(step: ReviewStep): string | null {
  const raw = step.gate_config?.target;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * `true` si el paso permite dejar activo un segundo funnel.
 *
 * Hoy `false` en el guion, y es la mitad (b) de la fase 3 que espera a BP39: la
 * opción se dibuja deshabilitada diciendo por qué. Habilitarla es un UPDATE de
 * una fila, no un despliegue.
 *
 * ⚠ La ausencia de la clave se lee como `false`, no como `true`: dejar dos
 * planes activos hoy rompería la pantalla del plan, que toma `data[0]` de una
 * consulta sin `order by`. El lado seguro de fallar es el restrictivo.
 */
export function allowsSecondFunnel(step: ReviewStep): boolean {
  return step.gate_config?.allow_second === true;
}

/**
 * Si el paso se puede guardar, y qué falta si no.
 *
 * El comentario se pide SIEMPRE, en las cuatro compuertas: el brief lo dice de
 * cada paso, y el modelo lo exige — `response.comment` es `not null` con un
 * `check` de longitud. Así que se comprueba primero y una sola vez.
 */
export function gateStatus(step: ReviewStep, draft: StepDraft): GateStatus {
  if (draft.comment.trim() === '') {
    return { ok: false, falta: 'Write a comment to close this step.' };
  }

  switch (step.gate_kind) {
    case 'number': {
      /*
       * `null` y `0` no son lo mismo: cero es una decisión --un benchmark de
       * cero cierres es una respuesta-- y `null` es que nadie escribió nada.
       * Es la distinción que sostiene `org.employee_benchmark`, donde un
       * benchmark sin fijar se guarda `null` y no `0`.
       */
      if (draft.numero === null || draft.numero === undefined) {
        return { ok: false, falta: 'Set the benchmark number as well as the comment.' };
      }
      if (!Number.isFinite(draft.numero) || draft.numero < 0) {
        return { ok: false, falta: 'The benchmark has to be a number, and not a negative one.' };
      }
      return { ok: true, falta: null };
    }

    case 'clicks': {
      const pedidos = requiredClicks(step);
      const hechos = new Set(draft.clicks ?? []);
      const faltan = pedidos.filter((c) => !hechos.has(c));
      if (faltan.length === 0) return { ok: true, falta: null };
      /*
       * ⚠ DICE CUÁLES faltan, no cuántos. «2 of 3 opened» obliga a adivinar
       * cuál es el que queda, y son tres números en tres lugares distintos de
       * la pantalla.
       */
      return {
        ok: false,
        falta: 'Open ' + faltan.map(enPalabras).join(' and ') + ' before closing this step.',
      };
    }

    case 'budget': {
      if (draft.budgetListo !== true) {
        return { ok: false, falta: 'Save the budget together with this comment.' };
      }
      return { ok: true, falta: null };
    }

    case 'comment':
    default:
      /*
       * ⚠ EL `default` VA CON `comment` A PROPÓSITO. `gate_kind` viene de la
       * base, así que un valor que este código no conoce --uno nuevo, agregado
       * por SQL-- caería acá. Y la caída segura es pedir sólo el comentario:
       * la alternativa sería un paso que no se puede cerrar nunca, o uno que se
       * cierra sin su compuerta. Lo primero deja la revisión trabada; lo
       * segundo miente sobre lo que se hizo.
       *
       * De las dos, trabar es peor: la revisión existe para poder registrarse.
       */
      return { ok: true, falta: null };
  }
}

/**
 * El identificador de un clic, en palabras.
 *
 * `total_pipeline` → `Total pipeline`. La tabla NO está en el código: se
 * derivan del propio identificador, así que agregar un clic al guion por SQL no
 * necesita tocar esto. Si el nombre derivado quedara mal, la respuesta es
 * cambiar el identificador en la base.
 */
export function enPalabras(id: string): string {
  const limpio = id.replace(/_/g, ' ').trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/**
 * Lo que se guarda en `response.gate`: la EVIDENCIA de la compuerta.
 *
 * ⚠ NUNCA el benchmark ni el presupuesto. Ésos viven en `org.employee_benchmark`
 * y en las tablas de Outlook, que ya son append-only y con autor; copiarlos acá
 * daría dos fuentes para el mismo número, libres de discrepar. Lo que se guarda
 * del paso 2 es que se fijó, no cuánto.
 *
 * Devuelve `null` cuando no hay nada que guardar: un `{}` afirmaría que la
 * compuerta produjo algo vacío, y no es lo mismo que no producir nada.
 */
export function gateEvidence(step: ReviewStep, draft: StepDraft): Record<string, unknown> | null {
  switch (step.gate_kind) {
    case 'clicks': {
      const pedidos = requiredClicks(step);
      const hechos = (draft.clicks ?? []).filter((c) => pedidos.includes(c));
      return hechos.length === 0 ? null : { clicked: hechos };
    }
    case 'number':
      return { benchmark_set: true };
    case 'budget':
      return { budget_saved: true };
    default:
      return null;
  }
}
