/**
 * ============================================================================
 * CÓMO SE ESCRIBE UN NÚMERO EN OUTLOOK — una sola definición (etapa OL7/OL8)
 * ============================================================================
 *
 * ⚠ ESTO ESTABA DUPLICADO, y se desincronizó en cuanto se tocó. Las dos vistas
 * tenían su propia copia; al cambiar una, la otra quedó con la convención vieja
 * y el módulo pasó a tener dos formas de escribir lo mismo. Es el mismo modo de
 * falla que este módulo evita en el cálculo --dos fórmulas para un número--
 * aplicado a la presentación.
 *
 * ---------------------------------------------------------------------------
 * TRES ESTADOS, Y NINGUNO NECESITA TEXTO — etapa OL8
 * ---------------------------------------------------------------------------
 *   ''          NO SE PUEDE SABER. Celda vacía. El mes en curso abierto por
 *               estrategia, el presupuesto de una estrategia que no tiene dónde
 *               guardarse, el benchmark de una estrategia fijada mes a mes.
 *   '0'         CERO, y el cero es un dato: nadie cerró nada ese mes.
 *   el número   con un decimal cuando no es entero, porque un pronóstico de
 *               pipeline no da entero y redondearlo escondería la diferencia
 *               con lo ya cerrado.
 *
 * ⚠ CERO Y AUSENCIA SIGUEN SIENDO DISTINTOS. Lo que se fue es el TEXTO: antes
 * decían `no data` y `–`, dos rótulos que había que aprender y que en una tabla
 * de doce columnas ocupaban más ancho que los números que venían a acompañar.
 * Un cero se escribe `0` y la ausencia se deja en blanco -- la distinción la
 * hace la presencia del número, que es la forma más barata de decirla.
 *
 * Unificarlos sí sería un error: haría que un mes flojo se lea como un dato
 * faltante. Es el mismo cuidado que con `branch_transferred`, donde un `false`
 * por defecto habría dicho "no hubo transferencia" cuando la verdad era "no se
 * sabe".
 */
export function fmt(n: number | null): string {
  if (n === null) return '';
  if (!n) return '0';
  if (Number.isInteger(n)) return String(n);
  /*
   * ⚠ REDONDEO DETERMINISTA, NO `toFixed`.
   *
   * `toFixed(1)` decide el medio punto segun la representacion BINARIA, no
   * segun el numero, asi que dos valores que valen lo mismo pueden redondear
   * para lados distintos. Medido en el 716: el pronostico de agosto vale
   * 9.350000000000001 y sale "9.4"; el total del ano vale exactamente 93.35 y
   * sale "93.3". Los dos son el mismo .35.
   *
   * La consecuencia se veia en la pantalla: la columna del ano mostraba
   * 74 + 15 + 4,4 = 93,4 y la fila del total decia 93,3. Un total que no da la
   * suma de sus filas, por 0,1, sin ninguna causa visible -- exactamente el
   * descuadre sin explicacion que este modulo evita en todos lados.
   *
   * El epsilon empuja el medio punto siempre para arriba (en valor absoluto),
   * asi que .35 redondea a .4 venga como venga del binario.
   */
  const escala = 10;
  const eps = n >= 0 ? 1e-9 : -1e-9;
  return (Math.round(n * escala + eps) / escala).toFixed(1);
}

/**
 * ============================================================================
 * ⚠ UN TOTAL ES LA SUMA DE LO QUE SE VE, NO DE LO QUE SE SABE
 * ============================================================================
 *
 * `composeYear` suma los valores EXACTOS, y cada mes se muestra redondeado a un
 * decimal por su cuenta. Con valores fraccionarios los dos no coinciden, y el
 * lector suma lo que ve: el NPPM del 733 tiene cuatro meses de 2,333 que salen
 * `2.3` --9,2 en pantalla-- y un año exacto de 16,33 que sale `16.3`. La fila
 * dice 16,3 y sus columnas suman 16,2.
 *
 * Medido antes de esto: 8 filas de 48 con esa diferencia de 0,1.
 *
 * Por eso el total que se muestra se calcula sobre los valores YA REDONDEADOS.
 * Se pierde una décima de precisión y se gana que la tabla cierre, que es lo que
 * una tabla de presupuesto tiene que hacer: nadie puede verificar un total que
 * no da la suma de sus partes, y un decimal escondido no es una explicación.
 *
 * ⚠ Es distinto del problema de `toFixed` que arregla `fmt`: aquel eran dos
 * redondeos del MISMO número dando distinto; éste es la suma de redondeos contra
 * el redondeo de la suma, que siempre pueden diferir. El primero era un bug; éste
 * es una elección entre dos totales igualmente ciertos.
 */
export function sumOfShown(values: (number | null)[]): number {
  const escala = 10;
  const r1 = (n: number) => Math.round(n * escala + (n >= 0 ? 1e-9 : -1e-9)) / escala;
  return r1(values.reduce<number>((a, v) => a + (v === null ? 0 : r1(v)), 0));
}
