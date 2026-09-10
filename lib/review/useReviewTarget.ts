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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * EL PASO PUEDE SEÑALAR VARIAS COSAS — etapa RV6, punto 1
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El paso 1 de la fase 2 pide mirar `Project through` Y la tabla del
 * presupuesto, que son dos secciones distintas de la misma pantalla. Así que el
 * lugar del paso es un CONJUNTO, y el desplazamiento tiene que dejar ver a
 * todos: se centra el rectángulo que los abarca, no el primero.
 *
 * Si el conjunto no cabe en la banda libre --el caso normal cuando son dos
 * secciones separadas-- gana la regla que ya existía para una sección alta: se
 * le alinea el borde de arriba, porque lo primero es lo que se lee primero.
 */
function union(rs: readonly DOMRect[]): DOMRect | null {
  if (rs.length === 0) return null;
  let top = rs[0].top;
  let bottom = rs[0].bottom;
  for (const r of rs) {
    if (r.top < top) top = r.top;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  /*
   * Sin `new DOMRect`: sale de un `getBoundingClientRect` y lo único que el
   * centrado mira es la vertical. Un objeto plano evita depender de un
   * constructor global por una caja que no se dibuja.
   */
  return { top, bottom, height: bottom - top } as DOMRect;
}

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
/*
 * ============================================================================
 * ⚠ AL TOPE DE LA BANDA, Y NO CENTRADO — etapa RV18
 * ============================================================================
 *
 * Hasta RV17 esto CENTRABA el objetivo, y con el panel como globo en la esquina
 * tenía sentido: la banda libre era casi la ventana entera.
 *
 * Con el panel convertido en barra al pie, centrar deja media pantalla de
 * contenido DEBAJO del objetivo -- y esa mitad de abajo es justo la que la
 * barra tapa. Medido en el paso 1.4: centrado, la tarjeta de métricas quedaba
 * en y=531 con la barra arrancando en y=705, o sea 3 de sus 9 puntos tapados.
 * Alineando el objetivo al tope de la banda la página baja esos 326px de más y
 * la tarjeta pasa a y=205, visible entera.
 *
 * Y no es una regla nueva: es la que este mismo archivo ya aplicaba al objetivo
 * MÁS ALTO que la banda --«lo primero de la sección es lo que se lee primero»--
 * extendida a todos. Lo que el paso señala va arriba, y lo que sigue queda
 * abajo y a la vista.
 *
 * Lo que se pierde, dicho: el contexto que está ENCIMA del objetivo se va de
 * pantalla. En los ocho pasos del guion eso no dejó afuera nada que el paso
 * necesite -- el objetivo de cada uno es una sección entera, no un número
 * suelto dentro de otra.
 */
function necesitaMover(r: DOMRect): boolean {
  const b = banda();
  /* Con el borde de arriba dentro de la banda y no muy abajo ya está bien: así
     la operación sigue siendo idempotente y no le mueve la pantalla a quien
     está leyendo. Los 80px de tolerancia son los que ya tenía el caso alto. */
  return r.top < b.arriba - 4 || r.top > b.arriba + 80;
}

function centrarEnLaBanda(r: DOMRect): void {
  if (!necesitaMover(r)) return;
  const b = banda();

  const destino = r.top - b.arriba;

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
   * `false` = el paso tiene lugar y no está acá.
   */
  enSitio: boolean | null;
  /**
   * `true` mientras se lo está buscando y todavía no se cumplió el plazo.
   *
   * ⚠ ES EL TERCER ESTADO, y existe porque su falta producía una mentira. El
   * perfil trae sus datos DESPUÉS de pintar la ruta, así que durante los
   * primeros segundos la sección del paso no existe todavía -- y con sólo
   * `enSitio` eso era `false`, o sea «el paso no se contesta desde esta
   * pantalla», dicho EN la pantalla correcta.
   *
   * Es la misma confusión que la nota de `AGENTS.md`: una pantalla que todavía
   * no cargó dice exactamente lo mismo que una que no tiene el dato. Acá se
   * paga en la interfaz en vez de en una medición.
   */
  buscando: boolean;
}

export function useReviewTarget(selector: string | null, ruta: string): ReviewTargetState {
  /* La clave del sitio donde el elemento SE ENCONTRÓ, no un booleano. */
  const [hallado, setHallado] = useState<string | null>(null);
  /* Y la clave del sitio donde se DEJÓ DE BUSCAR, por el mismo motivo: al
     cambiar de paso o de ruta, el plazo del anterior no dice nada del nuevo. */
  const [vencido, setVencido] = useState<string | null>(null);
  const claveActual = selector === null ? null : selector + '|' + ruta;

  useEffect(() => {
    if (selector === null) return;

    let vivo = true;
    /* Los que ya están resaltados. Un `Set` porque el reintento vuelve a
       encontrar a los mismos y no hay que volver a marcarlos ni recentrar. */
    const marcados = new Set<Element>();
    let timer: ReturnType<typeof setInterval> | null = null;
    let observador: ResizeObserver | null = null;
    const clave = selector + '|' + ruta;

    const buscar = (): Element[] => {
      try {
        /*
         * `querySelectorAll` y no `querySelector`: una lista de CSS separada por
         * comas devuelve TODAS las coincidencias, y eso es lo que hace que
         * `target` pueda señalar dos secciones sin que este archivo sepa
         * cuántas son.
         */
        return Array.from(document.querySelectorAll(selector));
      } catch {
        /*
         * Un selector inválido tira. Se avisa por consola en vez de tratarlo
         * como «no está»: los dos se verían igual en la pantalla, y uno es un
         * error de tipeo en una fila de la base que nadie más va a notar.
         */
        console.warn('[review] gate_config.target no es un selector válido: ' + selector);
        return [];
      }
    };

    const recentrar = (): void => {
      const u = union(Array.from(marcados).map((el) => el.getBoundingClientRect()));
      if (u) centrarEnLaBanda(u);
    };

    /* Marca lo nuevo que haya aparecido. Devuelve cuántos se agregaron. */
    const revisar = (): number => {
      if (!vivo) return 0;
      let nuevos = 0;
      for (const el of buscar()) {
        if (marcados.has(el)) continue;
        marcados.add(el);
        el.classList.add('rv-target');
        nuevos += 1;
      }
      if (nuevos === 0) return 0;
      setHallado(clave);
      recentrar();
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
      if (observador === null && typeof ResizeObserver !== 'undefined') {
        observador = new ResizeObserver(() => {
          if (vivo) recentrar();
        });
        observador.observe(document.body);
      }
      return nuevos;
    };

    revisar();

    /*
     * ⚠ EL REINTENTO NO CORTA AL PRIMER HALLAZGO — esto es el punto 1.
     *
     * La versión anterior paraba en cuanto encontraba algo, y con dos selectores
     * eso deja al segundo sin resaltar para siempre: `.ol-topbar` vive en el
     * layout del módulo y está desde el primer cuadro, mientras la tabla del
     * presupuesto llega con los datos, segundos después. «Encontré uno» no es
     * «encontré los que el paso pide».
     *
     * Así que sigue mirando hasta el plazo, marcando lo que aparezca. Es la
     * misma leccion del séptimo caso de `AGENTS.md` --esperar al dato antes de
     * afirmar que no está-- aplicada a cada pieza y no a la primera.
     *
     * El plazo se cuenta en INTENTOS y no con `Date.now()`: es lo que
     * `react-hooks/purity` pide, y ademas lo que se espera es «la pantalla
     * termino de dibujar», que se cuenta en vueltas.
     */
    const MAX_INTENTOS = Math.ceil(PLAZO_MS / REINTENTO_MS);
    let intentos = 0;
    timer = setInterval(() => {
      intentos += 1;
      revisar();
      if (!vivo || intentos < MAX_INTENTOS) return;
      if (timer) clearInterval(timer);
      timer = null;
      /* Pasada la carga, el alto sólo cambia por lo que hace la persona, y ahí
         la pantalla es suya. */
      if (observador) observador.disconnect();
      observador = null;
      /*
       * Se deja de buscar, y se DICE -- pero sólo si no se encontró NADA. Con
       * uno de los dos resaltados el paso sí está en esta pantalla, y decir
       * «vencido» ahí mandaría a irse de la pantalla correcta.
       */
      if (marcados.size === 0) setVencido(clave);
    }, REINTENTO_MS);

    return () => {
      vivo = false;
      if (timer) clearInterval(timer);
      if (observador) observador.disconnect();
      /* El resaltado se saca al salir del paso o de la página. Sin esto queda
         una sección iluminada que ya no corresponde a nada. */
      for (const el of marcados) el.classList.remove('rv-target');
    };
  }, [selector, ruta]);

  const encontrado = hallado === claveActual;
  return {
    enSitio: selector === null ? null : encontrado,
    /* Hay selector, no se encontró, y el plazo de ESTA ruta no venció. */
    buscando: selector !== null && !encontrado && vencido !== claveActual,
  };
}
