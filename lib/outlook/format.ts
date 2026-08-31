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
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
