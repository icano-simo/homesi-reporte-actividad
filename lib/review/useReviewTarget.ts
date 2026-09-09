'use client';

/**
 * ============================================================================
 * LLEVAR LA PANTALLA AL LUGAR QUE EL PASO REVISA
 * ============================================================================
 *
 * Etapa RV2 — ARCHIVO NUEVO. Punto 3 del brief.
 *
 * El paso decía `Closings this year` y no señalaba nada: quien no sabe qué
 * mirar no lo encuentra. Este hook resuelve el selector de `gate_config.target`
 * contra la página actual, la desplaza hasta ahí y le pone `rv-target` mientras
 * el paso está activo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SE ESPERA AL ELEMENTO, NO SE BUSCA UNA VEZ
 * ---------------------------------------------------------------------------
 * El perfil del Loan Officer trae sus datos DESPUÉS de pintar la ruta, así que
 * en el primer cuadro la sección del paso todavía no existe. Buscarla una vez y
 * concluir «no está» es exactamente el séptimo caso de `AGENTS.md`: una pantalla
 * que no cargó dice lo mismo que una que no tiene el dato.
 *
 * Por eso reintenta hasta el plazo. Y cuando el plazo se agota sin encontrarlo,
 * eso NO se lee como «este paso no tiene lugar» — ver la nota de `stepTarget`.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NO HAY NADA QUE SINCRONIZAR AL NAVEGAR
 * ---------------------------------------------------------------------------
 * El estado no es un booleano `encontrado` que haya que apagar al cambiar de
 * ruta. Es LA CLAVE del sitio donde se encontró: `selector|ruta`. Al navegar, la
 * clave esperada cambia y `enSitio` pasa a `false` solo, sin un `setState` en la
 * limpieza que dispare un render de más.
 *
 * Mismo criterio que el `key` del panel y el `:has()` del corrimiento de la
 * barra: si la presencia ya dice el estado, no hay estado que copiar.
 */

import { useEffect, useState } from 'react';

/** Cuánto se espera a que la sección aparezca. El perfil tarda segundos. */
const PLAZO_MS = 12000;
const REINTENTO_MS = 250;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CENTRAR EN LO QUE QUEDA LIBRE, NO EN LA VENTANA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ ESTO ARREGLA UN DEFECTO MEDIDO. La primera versión usaba
 * `scrollIntoView({ block: 'center' })`, que centra en la VENTANA — y la
 * ventana no está libre: la barra de la revisión tapa los primeros 42px y el
 * panel del paso ocupa la esquina de abajo a la derecha, unos 370px de alto.
 *
 * Medido sobre los cinco pasos de la fase 1: el panel tapaba el **31%** de la
 * sección del paso 2. La sección que el paso señala, escondida detrás del panel
 * que la señala.
 *
 * Y por eso se midieron los cinco y no uno: `bp-q2-cards` y `bp-forensic` daban
 * 0% con el mismo código. Una sección no dice nada de las otras cuatro.
 *
 * La banda libre va del borde de abajo de la barra al borde de arriba del panel,
 * y el alto del panel SE LEE DEL DOM en vez de escribirse como constante: cambia
 * con el paso --el 2 tiene un campo de número más-- y una constante quedaría
 * vieja en cuanto alguien le agregue una línea al panel.
 */
const ALTO_BARRA = 42;
const AIRE = 10;

/** El tramo de ventana que no tapa ni la barra ni el panel del paso. */
function banda(): { arriba: number; abajo: number } {
  const panel = document.querySelector('.rv-panel');
  return {
    arriba: ALTO_BARRA + AIRE,
    abajo: panel ? panel.getBoundingClientRect().top - AIRE : window.innerHeight,
  };
}

/**
 * ⚠ SE PREGUNTA ANTES DE MOVER, y eso es lo que hace que se pueda repetir.
 *
 * Sin esto, volver a centrar cada vez que el documento cambia de alto le movería
 * la pantalla a alguien que ya está leyendo. Preguntando primero, la operación
 * es idempotente: si la sección ya se ve entera en la banda, no pasa nada.
 */
function necesitaCentrado(el: Element): boolean {
  const b = banda();
  const r = el.getBoundingClientRect();
  const alto = b.abajo - b.arriba;
  if (r.height > alto) {
    /* Más alta que la banda: alcanza con que EMPIECE dentro. */
    return r.top < b.arriba - 4 || r.top > b.arriba + 80;
  }
  return r.top < b.arriba - 4 || r.bottom > b.abajo + 4;
}

function centrarEnLaBanda(el: Element): void {
  if (!necesitaCentrado(el)) return;
  const b = banda();
  const alto = b.abajo - b.arriba;
  const r = el.getBoundingClientRect();

  /*
   * Una sección más alta que la banda no se puede centrar sin que sobresalga
   * por los dos lados. Se le alinea el borde de arriba: lo primero de la
   * sección es lo que se lee primero.
   */
  const destino =
    r.height > alto ? r.top - b.arriba : r.top + r.height / 2 - (b.arriba + alto / 2);

  /*
   * `scrollBy` y no `scrollTo`: el desplazamiento es relativo a donde estamos,
   * que es lo que los rectángulos ya expresan. Y el navegador lo recorta solo
   * contra los límites del documento — una sección que está arriba de todo se
   * queda arriba de todo, sin scroll negativo.
   */
  window.scrollBy({ top: destino, behavior: 'smooth' });
}

export interface ReviewTargetState {
  /**
   * `null`  = el paso no declara lugar; no hay requisito de estar en ninguno.
   * `true`  = el lugar del paso está en esta página, resaltado.
   * `false` = el paso tiene lugar y no es acá.
   */
  enSitio: boolean | null;
}

export function useReviewTarget(selector: string | null, ruta: string): ReviewTargetState {
  /* La clave del sitio donde el elemento SE ENCONTRÓ, no un booleano. */
  const [hallado, setHallado] = useState<string | null>(null);
  const claveActual = selector === null ? null : selector + '|' + ruta;

  useEffect(() => {
    if (selector === null) return;

    let vivo = true;
    let marcado: Element | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let observador: ResizeObserver | null = null;
    let cierre: ReturnType<typeof setTimeout> | null = null;

    const buscar = (): Element | null => {
      try {
        return document.querySelector(selector);
      } catch {
        /*
         * Un selector inválido tira. Se avisa por consola en vez de tratarlo
         * como «no está»: los dos se verían igual en la pantalla, y uno es un
         * error de tipeo en una fila de la base que nadie más va a notar.
         */
        console.warn('[review] gate_config.target no es un selector válido: ' + selector);
        return null;
      }
    };

    const intentar = (): boolean => {
      const el = buscar();
      if (!el || !vivo) return false;
      marcado = el;
      el.classList.add('rv-target');
      centrarEnLaBanda(el);
      setHallado(selector + '|' + ruta);

      /*
       * ⚠ Y SE VUELVE A CENTRAR MIENTRAS EL DOCUMENTO CAMBIE DE ALTO.
       *
       * Centrar una sola vez, en el momento en que la sección aparece, está mal:
       * el perfil del Loan Officer sigue creciendo detrás --las tarjetas, el
       * gráfico, las notas-- y lo que se centró termina en otro lado.
       *
       * Medido: la sección del paso 2 quedaba con el 91% tapado por el panel,
       * con `scrollY` en 0. El desplazamiento se había calculado contra un
       * documento de la mitad del alto final, dio casi cero, y no se rehizo.
       *
       * El disparador es el cambio de alto del documento, no un temporizador
       * inventado. Y `centrarEnLaBanda` pregunta antes de mover, así que esto no
       * le arrebata la pantalla a nadie: si la sección ya se ve, no hace nada.
       */
      if (typeof ResizeObserver !== 'undefined') {
        observador = new ResizeObserver(() => {
          if (vivo && marcado) centrarEnLaBanda(marcado);
        });
        observador.observe(document.body);
        /* Con plazo: pasada la carga, el alto sólo cambia por lo que hace la
           persona, y ahí la pantalla es suya. */
        cierre = setTimeout(() => {
          if (observador) observador.disconnect();
          observador = null;
        }, PLAZO_MS);
      }
      return true;
    };

    if (!intentar()) {
      const limite = Date.now() + PLAZO_MS;
      timer = setInterval(() => {
        if (!vivo || intentar() || Date.now() > limite) {
          if (timer) clearInterval(timer);
          timer = null;
        }
      }, REINTENTO_MS);
    }

    return () => {
      vivo = false;
      if (timer) clearInterval(timer);
      if (cierre) clearTimeout(cierre);
      if (observador) observador.disconnect();
      /* El resaltado se saca al salir del paso o de la página. Sin esto queda
         una sección iluminada que ya no corresponde a nada. */
      if (marcado) marcado.classList.remove('rv-target');
    };
  }, [selector, ruta]);

  return { enSitio: selector === null ? null : hallado === claveActual };
}
