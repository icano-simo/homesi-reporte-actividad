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
  /**
   * `true` si el Loan Officer tiene un funnel activo.
   *
   * ⚠ NO ES UNA DECLARACIÓN DE QUIEN REVISA, igual que `budgetListo`: sale de
   * `business_plan.enrollment`, que es la tabla que el botón `Select this
   * funnel` escribe. La pantalla no puede ponerlo en `true`.
   */
  funnelListo?: boolean;
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
export function stepTarget(step: ReviewStep, pendiente = false): string | null {
  /*
   * ═══════════════════════════════════════════════════════════════
   * ⚠ EL LUGAR PUEDE DEPENDER DEL ESTADO — etapa RV7
   * ═══════════════════════════════════════════════════════════════
   *
   * `target_pending` es dónde se HACE la acción del paso mientras no esté hecha;
   * `target` es dónde se CONTESTA. En el paso 3.1 son dos pantallas distintas:
   * sin funnel hay que ir al catálogo --`.bp-catalog`-- y con funnel se confirma
   * en la barra de decisión del perfil --`.bp-decision`--.
   *
   * ⚠ Y ES UNA CONDICIÓN, NO UNA LISTA. Declarar los dos juntos parece
   * equivalente y no lo es: `.bp-decision` sólo existe en el perfil, así que la
   * lista hacía que el panel se diera por «en sitio» en el catálogo y ofreciera
   * CONFIRMAR ahí, donde no hay nada que confirmar. Una lista dice «estas dos
   * cosas, juntas» --el caso de la fase 2, las dos en la misma pantalla-- y una
   * condición dice «esta o esta, según el estado».
   *
   * La clave ausente cae en `target`, que es el comportamiento de siempre.
   */
  const raw = pendiente && step.gate_config?.target_pending !== undefined
    ? step.gate_config.target_pending
    : step.gate_config?.target;
  /*
   * Un solo selector: tal cual. Y CSS YA SABE DECIR «estos dos» -- una lista
   * separada por comas es un selector válido, y `querySelectorAll` devuelve los
   * dos. Así que un `target` con coma funciona sin que este archivo lo sepa.
   */
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw.trim();
  /*
   * Y un ARRAY, que es la forma que se escribe en el SQL: `[".ol-topbar",
   * ".ol-year"]` se lee de un tirón y no obliga a contar comas dentro de una
   * cadena. Se junta en una sola lista de CSS, que es lo que el hook necesita.
   *
   * ⚠ DEVUELVE UNA CADENA Y NO UN ARRAY A PROPÓSITO. El hook usa este valor
   * como dependencia de su efecto: un array nuevo en cada render cambia de
   * identidad y el efecto correría para siempre. Una cadena es estable.
   */
  if (Array.isArray(raw)) {
    const partes = raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x !== '');
    return partes.length === 0 ? null : partes.join(', ');
  }
  return null;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * QUÉ EDITOR TIENE QUE ABRIRSE SOLO — etapa RV4
 * ══════════════════════════════════════════════════════════════════════
 *
 * `gate_config.open_editor` guarda el NOMBRE DE LA ESTRATEGIA cuyo editor de
 * presupuesto tiene que estar abierto al llegar al paso: `Own Production`,
 * `NPPM`, `B2B`, `Affinity`, `Recruitment`.
 *
 * Isabella llegó a la pantalla correcta y el paso no decía qué hacer ahí: no
 * sabía que había que abrir el editor de la regla. Desplazarse y resaltar no
 * alcanza cuando lo que hay que revisar está detrás de un clic.
 *
 * ⚠ Y ES UNA FILA, igual que `target`: el paso declara su lugar Y qué tiene que
 * estar abierto en él. Cambiar de estrategia --o pedir que no se abra nada-- es
 * un `update` de `gate_config`, no un despliegue.
 *
 * ⚠ La clave ausente se lee como «no abrir nada», que es el lado seguro: abrir
 * un editor que nadie pidió tapa la pantalla que la persona vino a mirar.
 */
export function stepOpenEditor(step: ReviewStep): string | null {
  const raw = step.gate_config?.open_editor;
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
 * ════════════════════════════════════════════════════════════════════════
 * SI EL PASO EXIGE UN FUNNEL ACTIVO — etapa RV6, punto 2
 * ════════════════════════════════════════════════════════════════════════
 *
 * ⚠ EL AGUJERO QUE ESTO CIERRA ES EL MÁS GRAVE DE LA SERIE. Isabella llegó al
 * paso 3.1 con Armando Tejeda SIN plan activo, escribió el comentario y cerró
 * la revisión entera. La fase 3 existe para que se elija un funnel, y se podía
 * terminar sin elegir ninguno: la compuerta pedía sólo el comentario.
 *
 * Tres orígenes, en este orden:
 *
 *   1. `gate_kind = 'funnel'` — lo explícito, cuando el SQL de RV6 se aplique;
 *   2. `gate_config.requires_funnel === false` — la salida deliberada, escrita;
 *   3. la fase 3, que es la fase de la decisión del funnel.
 *
 * ⚠ Y LA AUSENCIA DE LA CLAVE EXIGE, no exime. Es el lado seguro y es al revés
 * que `allow_second`: ahí lo restrictivo era no dejar un segundo plan, acá lo
 * restrictivo es pedir el primero. Una clave que falta no puede volver a abrir
 * el agujero -- para eso el punto 2 tiene que estar escrito.
 */
export function requiresFunnel(step: ReviewStep): boolean {
  if (step.gate_kind === 'funnel') return true;
  if (step.gate_config?.requires_funnel === false) return false;
  return step.phase_no === 3;
}

/**
 * Si el paso se puede guardar, y qué falta si no.
 *
 * El comentario se pide SIEMPRE, en las cuatro compuertas: el brief lo dice de
 * cada paso, y el modelo lo exige — `response.comment` es `not null` con un
 * `check` de longitud. Así que se comprueba primero y una sola vez.
 */
export function gateStatus(step: ReviewStep, draft: StepDraft): GateStatus {
  /*
   * ⚠ EL FUNNEL VA ANTES DEL COMENTARIO, Y EL ORDEN ES LA MITAD DEL ARREGLO.
   *
   * Sin funnel el panel NO dibuja el campo de comentario --elegir es lo primero
   * que el paso pide-- así que pedirlo primero diría «escribí un comentario»
   * al lado de una pantalla sin dónde escribirlo. El brief de RV6 lo pone en
   * este orden por eso: guía al catálogo, y el comentario aparece después.
   *
   * Las dos condiciones son obligatorias: sin funnel no se cierra, y con funnel
   * y sin comentario tampoco.
   */
  if (requiresFunnel(step) && draft.funnelListo !== true) {
    return { ok: false, falta: 'Pick a funnel first — this step is where that gets decided.' };
  }

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
