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
   * ⚠ EL DESENLACE DE LA FASE 3 — etapa RV10.
   *
   * `null` = todavía no decidieron. `'elegido'` sale de que el funnel exista;
   * `'declinado'` es un botón que se apretó --«No por ahora»-- y por eso es lo
   * ÚNICO de esta compuerta que la persona declara. Lo que impide que sea una
   * casilla vacía es que el comentario sigue siendo obligatorio: declinar sin
   * decir por qué no cierra el paso.
   */
  desenlaceFunnel?: 'elegido' | 'declinado' | 'kept' | 'changed' | 'deferred' | null;
  /** El nombre del funnel elegido, para el registro del día. Ver `gateEvidence`. */
  funnelNombre?: string | null;
  /** Y su `enrollment_key`, como puntero a lo que pase después. */
  enrollmentKey?: number | null;
  /**
   * El funnel que había ANTES, cuando se lo cambia. Queda en la evidencia como
   * `replaced`: `change_funnel` cancela el anterior y `cancel_funnel` BORRA, así
   * que sin esto no queda rastro de qué se reemplazó.
   */
  funnelAnterior?: string | null;
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

/**
 * El link que el paso ofrece abrir, o `null`. Era `gate_config.mmi_link`.
 *
 * ⚠ SIN LECTORES DESDE RV21, y por eso está marcada en vez de borrada: el
 * `Open MMI` del paso 1.2 pasó a usar el perfil de MMI de LA PERSONA
 * --`https://new.mmi.run/nmls/<nmls efectivo>`, la regla de BP50-- porque el
 * genérico abría MMI y no a quien se está revisando.
 *
 * Y no quedó como respaldo a propósito: con `linkMmiDelLo ?? gateLink(paso)`,
 * la única persona sin NMLS era justo la que recibía el link genérico, o sea lo
 * contrario de «sin NMLS no hay link».
 *
 * ⚠ ESTA SE VA CON EL DATO: a diferencia de `allowsSecondFunnel`
 * --donde `allow_second` sigue significando algo y espera a BP39--, `mmi_link`
 * ya no puede significar nada útil: un link igual para todos en una pantalla
 * que revisa a una persona. El SQL de RV21 lo saca de `gate_config`, y cuando
 * eso esté aplicado, esta función se borra.
 */
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

/** Una flecha: dónde apunta y qué dice al lado. */
export interface StepArrow {
  target: string;
  text: string;
}

/**
 * LAS FLECHAS DE UN PASO — etapa RV14.
 *
 * `gate_config.arrows` es un ARREGLO, no un campo, y de esa forma sale el
 * sub-paso: con dos elementos, el primero lleva un OK que mueve la flecha al
 * segundo. No hay una regla que diga «esto es sólo para Outlook» -- hoy es el
 * único paso con dos flechas, y mañana cualquiera puede tenerlas sin tocar
 * código.
 *
 * ⚠ Y NO REUSA `target`, que es otra cosa: `target` dice DÓNDE ESTÁ EL PASO
 * --y decide el «andate al lugar del paso»-- mientras la flecha dice DÓNDE
 * MIRAR ADENTRO. Un paso puede estar en su sitio y la flecha señalar un número
 * dentro de esa sección.
 *
 * ⚠ `{lo}` SE SUSTITUYE POR LA CLAVE DE LA PERSONA REVISADA. La segunda flecha
 * del 2.1 apunta a la fila de ESA persona, y eso no se puede escribir en un
 * selector fijo. Es la única sustitución que hay, y existe para que agregar una
 * flecha siga siendo una fila y no una condición en el código.
 *
 * Todo lo que no sea un objeto con dos cadenas no vacías se descarta:
 * `gate_config` lo escribe una persona en SQL, y una fila mal cargada no puede
 * tumbar la máscara.
 *
 * ⚠ Y HOY DEVUELVE VACÍO PARA LOS OCHO PASOS — RV16 quitó `arrows` de las tres
 * filas que lo tenían, porque los textos tapaban lo que señalaban. Esto no
 * quedó sin uso: quedó **sin datos**, que es otra cosa. El por qué, lo que
 * falta decidir y cómo se vuelve a encender están en el encabezado de
 * `components/review/ReviewArrow.tsx` y en
 * `docs/sql/2026-09-review-arrows-off.sql`.
 */
export function stepArrows(step: ReviewStep, loEmployeeKey?: number | null): StepArrow[] {
  const crudo = (step.gate_config as { arrows?: unknown } | null | undefined)?.arrows;
  if (!Array.isArray(crudo)) return [];
  return crudo.flatMap((x): StepArrow[] => {
    if (typeof x !== 'object' || x === null) return [];
    const { target, text } = x as { target?: unknown; text?: unknown };
    if (typeof target !== 'string' || typeof text !== 'string') return [];
    if (target.trim() === '' || text.trim() === '') return [];
    const resuelto =
      typeof loEmployeeKey === 'number' ? target.replaceAll('{lo}', String(loEmployeeKey)) : target;
    /* Un `{lo}` sin clave para sustituir dejaría un selector que no matchea
       nada, y eso se lee como «la flecha no aparece». Mejor no ofrecerla. */
    return resuelto.includes('{lo}') ? [] : [{ target: resuelto, text }];
  });
}

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
 * ════════════════════════════════════════════════════════════════════════
 * LAS PREGUNTAS DE LAS DOS RAMAS — etapa RV10
 * ════════════════════════════════════════════════════════════════════════
 *
 * El paso pregunta una cosa distinta según la rama: mirando el catálogo, «qué
 * te llama la atención»; declinando, «por qué no». El `prompt` de
 * `review.step_prompt` sigue siendo el de la pantalla de decisión.
 *
 * ⚠ VIVEN EN `gate_config` Y ESO TIENE UN COSTO DICHO: `step_prompt` versiona un
 * prompt por paso --y cada respuesta guarda su `revision`-- y no tiene columna
 * de variante. Estas dos frases NO quedan versionadas. Se eligió eso antes que
 * agregarle una columna al modelo por dos cadenas.
 *
 * Y la ausencia cae al `prompt` del paso, que siempre existe: una clave que
 * falta deja la pregunta general, no una pantalla sin pregunta.
 */
export function promptDeLaRama(step: ReviewStep, rama: 'catalogo' | 'declinado'): string | null {
  const clave = rama === 'catalogo' ? 'prompt_catalog' : 'prompt_declined';
  const raw = step.gate_config?.[clave];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * `true` si el paso permite dejar activo un segundo funnel.
 *
 * Hoy `false` en el guion, y es la mitad (b) de la fase 3 que espera a BP39.
 * Habilitarla es un UPDATE de una fila, no un despliegue.
 *
 * ⚠ La ausencia de la clave se lee como `false`, no como `true`: dejar dos
 * planes activos hoy rompería la pantalla del plan, que toma `data[0]` de una
 * consulta sin `order by`. El lado seguro de fallar es el restrictivo.
 *
 * ⚠ Y HOY NO LA LLAMA NADIE — etapa RV21, y queda dicho en vez de borrarla.
 *
 * Su único consumidor era el párrafo de cuatro renglones del paso 3.1, que
 * explicaba por qué no se puede un segundo plan; ese texto salió de la vista
 * (el criterio de siempre: si necesita tres renglones, no va en la pantalla).
 * El panel nunca ofreció un control para elegir un segundo funnel, así que
 * quitar el párrafo no habilitó nada.
 *
 * Se conserva porque `allow_second` SIGUE EN EL DATO y sigue significando lo
 * mismo: el día que la fase 3 ofrezca la opción, ésta es la lectura correcta —
 * con la ausencia leída como `false`, que es la parte que cuesta redescubrir.
 * Es el mismo caso que `stepArrows` desde RV16: sin datos no es lo mismo que
 * sin uso.
 */
export function allowsSecondFunnel(step: ReviewStep): boolean {
  return step.gate_config?.allow_second === true;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * SI EL PASO EXIGE UNA DECISIÓN SOBRE EL FUNNEL — RV6, redefinido en RV10
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
/*
 * ⚠ SE LLAMABA `requiresFunnel`, Y EL NOMBRE PASÓ A MENTIR — RV10.
 *
 * Hasta RV9 el paso exigía que hubiera un funnel. Desde RV10 exige una DECISIÓN:
 * cierra con funnel elegido, o sin funnel y con el motivo escrito. El valor de
 * `gate_kind` sigue siendo `funnel` --un valor nuevo por cada matiz convierte la
 * columna en una lista de casos particulares-- pero el helper se renombra,
 * porque leer «requires funnel» dos etapas más tarde hace creer que sigue
 * exigiéndolo.
 */
export function requiereDecisionDeFunnel(step: ReviewStep): boolean {
  /*
   * ⚠ LA EXENCIÓN VA PRIMERO, y el orden es el arreglo.
   *
   * Estaba tercera, después de `gate_kind === 'funnel'`, así que no podía eximir
   * al único paso que tiene ese `gate_kind` -- o sea, al único donde alguien
   * querría usarla. La nota prometía una salida escrita y el orden de los `if`
   * la anulaba.
   *
   * Una exención explícita tiene que mirarse antes que cualquier regla que la
   * implique: si no, es una promesa que el código no cumple.
   */
  if (step.gate_config?.requires_funnel === false) return false;
  if (step.gate_kind === 'funnel') return true;
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
  /*
   * ⚠ LOS DOS DESENLACES, Y EL COMENTARIO EN LOS DOS — RV10.
   *
   * Antes esto pedía el funnel y punto. Ahora pide una DECISIÓN: elegir uno, o
   * decir que no por ahora. Lo que NO se relaja es el comentario, que se
   * comprueba abajo para los dos caminos -- lo que hoy no se puede es cerrar el
   * paso sin decir nada, y eso no cambia.
   *
   * `funnelListo` gana sobre `desenlaceFunnel`: si el funnel existe, la decisión
   * ya está tomada aunque nadie haya apretado nada. Un botón de «no por ahora»
   * apretado antes no puede desmentir una fila de `enrollment`.
   */
  if (requiereDecisionDeFunnel(step)) {
    /*
     * ⚠ CON FUNNEL, TENER FUNNEL NO ALCANZA — RV11.
     *
     * Hasta acá, que existiera un enrolamiento cerraba el paso: la decisión se
     * daba por tomada porque había plan. Pero «ya tenía uno» no es «alguien lo
     * miró hoy», y la fase 3 existe para lo segundo. Así que con funnel hay que
     * decir QUÉ se decidió sobre él: seguir, cambiarlo, o dejarlo por ahora.
     *
     * Las tres cierran; lo que no cierra es no haber dicho ninguna. Y el
     * comentario sigue siendo obligatorio en todas, que es lo único que impide
     * que esto sea un botón que se aprieta sin pensar.
     */
    const dijoAlgo =
      draft.desenlaceFunnel === 'declinado' ||
      draft.desenlaceFunnel === 'kept' ||
      draft.desenlaceFunnel === 'changed' ||
      draft.desenlaceFunnel === 'deferred';
    const decidido = dijoAlgo || draft.funnelListo === true;
    if (!decidido) {
      return {
        ok: false,
        falta: 'Decide first: pick a funnel, or say it is not happening now.',
      };
    }
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
 * Qué acto se registra, de los cinco.
 *
 * `picked` es el respaldo cuando hay funnel y nadie apretó nada: pasó por el
 * catálogo y eligió. No se inventa un sexto valor para «no sé» -- si hay funnel
 * y no hubo botón, lo que hubo fue una elección.
 */
function decisionDelFunnel(draft: StepDraft): string {
  switch (draft.desenlaceFunnel) {
    case 'kept':
      return 'kept';
    case 'changed':
      return 'changed';
    case 'deferred':
      return 'deferred';
    default:
      return 'picked';
  }
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
    /*
     * ═══════════════════════════════════════════════════════════════
     * ⚠ EL DESENLACE SE REGISTRA, NO SE DEDUCE — RV10
     * ═══════════════════════════════════════════════════════════════
     *
     * Sin esta fila, «decidieron no elegir» y «falta el paso» se ven igual en el
     * intake, y el motivo se pierde. Con ella, el intake dice qué se decidió.
     *
     * ⚠ Y ACÁ SÍ SE COPIA EL NOMBRE, al revés que con el benchmark. Ahí no se
     * copia porque `org.employee_benchmark` es la fuente viva del número y dos
     * copias pueden discrepar. Acá la respuesta ES la fuente: es el registro de
     * una decisión con fecha, y `cancel_funnel` BORRA enrolamientos. Si el plan
     * se cancela en noviembre, el intake tiene que seguir diciendo que el 9 de
     * septiembre se eligió éste. El `enrollment_key` va como puntero a lo que
     * pasó después; el nombre, como el hecho de ese día.
     */
    case 'funnel':
      /*
       * ⚠ DOS CAMPOS QUE NO SON EL MISMO — RV11.
       *
       * `funnel_chosen` es el ESTADO al final del paso: ¿queda un funnel activo?
       * `decision` es el ACTO: qué hizo la persona. Uno no se deduce del otro en
       * la dirección que importa -- `kept` y `deferred` dejan el mismo estado y
       * son la diferencia entre confirmar y no mirar, que es justo lo que la
       * fase 3 viene a registrar.
       *
       *   picked    no tenía, eligió          declined  no tenía, no eligió
       *   kept      tenía, lo confirmó        changed   tenía, lo reemplazó
       *   deferred  tenía, lo dejó así por ahora
       */
      return draft.funnelListo === true
        ? {
            funnel_chosen: true,
            decision: decisionDelFunnel(draft),
            ...(draft.funnelNombre ? { funnel_name: draft.funnelNombre } : {}),
            ...(draft.funnelAnterior ? { replaced: draft.funnelAnterior } : {}),
            ...(typeof draft.enrollmentKey === 'number'
              ? { enrollment_key: draft.enrollmentKey }
              : {}),
          }
        : { funnel_chosen: false, decision: 'declined' };
    case 'number':
      return { benchmark_set: true };
    case 'budget':
      return { budget_saved: true };
    default:
      return null;
  }
}
