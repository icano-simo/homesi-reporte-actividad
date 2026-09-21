/**
 * ============================================================================
 * LA GRILLA DE LA TABLA DEL BRANCH, EN UN SOLO LUGAR — etapa OL49
 * ============================================================================
 *
 * ⚠ POR QUÉ EXISTE ESTE ARCHIVO, y es el punto entero de la etapa.
 *
 * Hasta OL48 la composición era un `<tbody>` más de la tabla del branch, y esa
 * decisión la tomó OL45 por una razón medida: con dos tablas independientes,
 * octubre caía en x=1151 en una y en x=1177 en la otra. La nota de OL45 lo dice
 * así: «dos tablas independientes calculan sus columnas por su propio
 * contenido, así que igualarlas con las mismas celdas vacías las acerca y no
 * las alinea».
 *
 * OL49 pide dos tarjetas separadas, que reabre exactamente eso. Lo que lo
 * cierra son dos cosas, y hacen falta las dos:
 *
 *   1. `table-layout: fixed`, para que la columna NO la decida el contenido.
 *      Con `auto` --lo que había-- el navegador mide lo que hay adentro, y como
 *      las dos tablas tienen contenido distinto, nunca pueden coincidir. Medido
 *      en los 18 branches: los anchos daban CUATRO firmas distintas entre cinco
 *      branches, en los tres viewports.
 *   2. Un `<colgroup>` en PÍXELES, el mismo objeto para las dos tablas. En
 *      porcentajes el ancho dependería del contenedor, y dos tarjetas con
 *      distinto relleno volverían a desalinear. En píxeles, la grilla es la
 *      misma aunque las tarjetas no lo sean.
 *
 * ⚠ Y POR ESO ES UN COMPONENTE Y NO DOS LISTAS IGUALES. Dos copias de la misma
 * decisión es lo que este repo lleva documentado nueve veces: serían correctas
 * al escribirlas y divergirían con la primera que alguien edite -- y el síntoma
 * sería justo el que costó dos turnos, octubre a 26px de octubre.
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALEN LOS NÚMEROS
 * ---------------------------------------------------------------------------
 *
 * De medir el CONTENIDO de cada columna en los 18 branches, con todos los
 * grupos abiertos, no de elegirlos. Un ancho fijo elegido sobre cinco branches
 * recorta en el sexto. Lo que pide cada columna, medido con un `Range` sobre el
 * contenido de la celda --`scrollWidth` devolvía la columna entera, que es la
 * caja y no el texto--:
 *
 *   nombre     382px   «Arnaldo Ortega Betancourt» + dos etiquetas, en el 710
 *   benchmark   95px   la palabra «Benchmark» del encabezado
 *   mes         42px   «Mar», que es el rótulo más ancho
 *   año         45px   «2026»
 *   regla      202px   «4 realtors · 2 without production»
 *
 * Acá van con un poco de aire encima de eso, nunca por debajo: un ancho fijo
 * menor que su contenido no falla ruidosamente, recorta en silencio -- que es
 * el modo de fallar de BP36 y la razón por la que `ol-year.css` había puesto
 * `table-layout: auto` en primer lugar. Esa nota sigue siendo cierta para una
 * tabla sin `colgroup`; lo que la desactiva no es cambiar de opinión, es que
 * ahora los anchos están medidos y declarados.
 */

/**
 * ---------------------------------------------------------------------------
 * ⚠ DOS COSAS QUE SE DESCUBRIERON MIDIENDO, Y NO SE DEDUCEN DE LA
 *   DOCUMENTACIÓN DE `table-layout`
 * ---------------------------------------------------------------------------
 *
 * La primera versión de esto puso `table-layout: fixed; width: auto` y el
 * colgroup de abajo, y NO ALINEÓ: los nueve primeros meses caían en la misma x
 * y octubre se corría 84px. Preguntándole a la página --y no volviendo a
 * escribir la regla-- salieron las dos causas:
 *
 * 1. **`fixed` con `width: auto` NO es fixed.** Medido: la tabla decía
 *    `table-layout: fixed` y a la vez le daba 46px a un mes que el colgroup
 *    pedía en 44, y 118px a un benchmark pedido en 96 -- exactamente los
 *    anchos que había dado el layout automático antes de esta etapa. Sin un
 *    ancho definido, el navegador usa el algoritmo automático igual, y el
 *    colgroup pasa a ser un MÍNIMO en vez de la medida. Por eso la tabla lleva
 *    un `width` explícito, que es `anchoDeLaGrilla` y no un número aparte.
 *
 *    Es la firma de siempre: el resultado no se explicaba por el mecanismo
 *    --un layout fijo no puede decidir por contenido-- así que tenía razón el
 *    mecanismo y lo que fallaba era la premisa.
 *
 * 2. **La fila de bandas empuja las columnas que abarca.** Ahí estaba el salto
 *    de 84px, y sólo en la tabla de arriba, porque es la única con esa fila.
 *    Por eso el mes del PRONÓSTICO tiene ancho propio: la grilla no exige que
 *    los doce meses midan lo mismo, exige que las DOS TABLAS midan igual.
 *
 * ⚠ Y UNA TERCERA, QUE LA ENCONTRÓ LA CAPTURA Y NO LA MEDICIÓN. Con los anchos
 * ya fijos, la pantalla decía `FORECAST (...` y `BUDGET (OCT–...`: `table.piv
 * th` trae `overflow: hidden; text-overflow: ellipsis` --puesto ahí
 * explícitamente «con table-layout: fixed»-- que con el layout automático de
 * antes no se disparaba nunca porque la columna crecía.
 *
 * Lo grave no fue el recorte sino que mi medición lo había aprobado: medí el
 * ancho del texto con un `Range` sobre la celda y dio 111px, así que le puse
 * 120 y la aserción pasó en verde. El `Range` mide lo que se ESTÁ MOSTRANDO, y
 * lo que se mostraba ya estaba recortado -- medí el resultado de mi propia
 * restricción y lo leí como el requisito. Un texto recortado y un texto que
 * entra justo miden exactamente lo mismo.
 *
 * Medido de nuevo clonando el texto fuera del layout, sin restricción de ancho:
 * `Forecast (Sep)` pide 147 y no 111, `Budget (Oct–Dec)` 171 y no 131, `Mar`
 * 46 y no 42, `Benchmark` 108 y no 95. Los números de abajo salen de ESA
 * medición, y la sonda comprueba el recorte con `scrollWidth > clientWidth`,
 * que no depende de reconocer el daño.
 *
 * Aun así los rótulos de banda no deciden la grilla: `ol-year.css` les permite
 * envolver en dos líneas dentro de `.ol-grid`. Un rótulo de banda es texto que
 * describe la sección, y hacer que doce columnas de números se ensanchen para
 * que entre en una línea es dejar que la decoración mande sobre el dato.
 */

/** Los anchos de la grilla, en píxeles. Un solo lugar. */
export const OL_GRID = {
  /** El nombre: 382px de contenido máximo, con aire para un nombre más largo. */
  lbl: 392,
  /** «Benchmark», el rótulo, pide 108px. */
  bench: 112,
  /** Un mes cualquiera: «Mar» y «May» son los rótulos más anchos, 46px. */
  mes: 48,
  /**
   * El mes del pronóstico, que además carga con el rótulo de su banda. Con las
   * bandas envolviendo, `Forecast` entra en una línea y `(Sep)` en la otra.
   */
  mesForecast: 120,
  /** La columna del año: «2026» pide 50px. */
  tot: 56,
  /** «4 realtors · 2 without production», 202px. */
  regla: 208,
} as const;

/** El ancho de un mes, que depende de si es el del pronóstico. */
function anchoDelMes(mes: string, currentMonth: string): number {
  return mes === currentMonth ? OL_GRID.mesForecast : OL_GRID.mes;
}

/**
 * El ancho total de la tabla.
 *
 * ⚠ ES LA SUMA, CALCULADA, y no una constante al lado: un total escrito a mano
 * deja de coincidir con las columnas la primera vez que alguien toca una, y el
 * síntoma sería que `fixed` reparte la diferencia -- o sea, otra vez las dos
 * tablas desalineadas, por una razón nueva.
 */
export function anchoDeLaGrilla(months: readonly string[], currentMonth: string): number {
  const meses = months.reduce((a, m) => a + anchoDelMes(m, currentMonth), 0);
  return OL_GRID.lbl + OL_GRID.bench + meses + OL_GRID.tot + OL_GRID.regla;
}

/**
 * El `<colgroup>` de la tabla del branch.
 *
 * ⚠ EL ORDEN ES EL DE LAS CELDAS, y no hay forma de que el tipo lo verifique:
 * un `<col>` de más o de menos corre toda la grilla de una tabla sola, que es
 * exactamente el defecto que esto viene a evitar. Por eso la sonda de OL49 no
 * comprueba el colgroup sino la CONSECUENCIA --que la x de cada mes coincida en
 * las dos tablas-- y lo hace en los 18 branches y en tres viewports.
 */
export default function OlColgroup({
  months,
  currentMonth,
}: {
  months: readonly string[];
  currentMonth: string;
}) {
  return (
    <colgroup>
      <col style={{ width: OL_GRID.lbl }} />
      <col style={{ width: OL_GRID.bench }} />
      {months.map((m) => (
        <col key={m} style={{ width: anchoDelMes(m, currentMonth) }} />
      ))}
      <col style={{ width: OL_GRID.tot }} />
      <col style={{ width: OL_GRID.regla }} />
    </colgroup>
  );
}
