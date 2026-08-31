/**
 * ============================================================================
 * CÓMO SE ESCRIBE UN NÚMERO EN OUTLOOK — una sola definición (etapa OL7)
 * ============================================================================
 *
 * ⚠ ESTO ESTABA DUPLICADO, y se desincronizó en cuanto se tocó. Las dos vistas
 * tenían su propia copia de `fmt`; al cambiar el em-dash por `no data` en la
 * vista 2, la vista 1 se quedó con el guión y el módulo pasó a tener dos
 * convenciones para lo mismo. Es el mismo modo de falla que este módulo evita en
 * el cálculo --dos fórmulas para un número-- aplicado a la presentación.
 *
 * ---------------------------------------------------------------------------
 * TRES ESTADOS, Y LOS TRES SE VEN DISTINTO
 * ---------------------------------------------------------------------------
 *   `no data`   no se puede saber. El mes en curso abierto por estrategia, el
 *               presupuesto de alguien cuyo pronóstico se carga a otro branch,
 *               el benchmark de una estrategia fijada mes a mes.
 *   `–`         CERO, y el cero es un dato: nadie cerró nada ese mes.
 *   el número   con un decimal cuando no es entero, porque un pronóstico de
 *               pipeline no da entero y redondearlo escondería la diferencia
 *               con lo ya cerrado.
 *
 * ⚠ `no data` y `–` NO se unifican. Reemplazar el cero por `no data` diría que
 * no sabemos algo que sí sabemos, y es lo que hace que un mes flojo se lea como
 * un dato faltante -- que es peor que el guión que vino a reemplazar.
 */
export function fmt(n: number | null): string {
  if (n === null) return 'no data';
  if (!n) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
