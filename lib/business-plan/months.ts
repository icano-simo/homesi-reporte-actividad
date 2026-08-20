/**
 * Ventanas de meses del módulo.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 * Etapa BP5 — el supuesto se resolvió. El negocio cerró la regla: el promedio
 *             que manda SÍ incluye el mes en curso, con su proyección.
 *
 * Quedan dos ventanas y hacen falta las dos, porque son diagnósticos distintos:
 *
 *   `currentWindowMonths`  jun + jul + AGOSTO PROYECTADO   -> alimenta el GAP
 *   `lastCompleteMonths`   may + jun + jul                 -> contexto
 *
 * Histórico bajo + proyección baja = problema sostenido. Histórico bueno +
 * proyección baja = se le secó el pipeline este mes. Histórico bajo +
 * proyección buena = ya está reaccionando. El GAP sale SIEMPRE del primero.
 *
 * El mes en curso se deriva de la fecha del sistema. No hay ningún mes
 * hardcodeado: en septiembre la ventana pasa sola a jul + ago + sep proyectado.
 */

/** 'YYYY-MM' de una fecha, en hora local (el mes calendario es local). */
function toYearMonth(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Los `count` meses completos inmediatamente anteriores al mes de `reference`,
 * en orden cronológico.
 *
 * Ej. referencia = 13 ago 2026, count = 3 -> ['2026-05', '2026-06', '2026-07']
 */
export function lastCompleteMonths(reference: Date, count: number): string[] {
  const months: string[] = [];
  for (let back = count; back >= 1; back--) {
    // Día 1 evita el clásico desborde de "31 de marzo menos un mes".
    months.push(toYearMonth(new Date(reference.getFullYear(), reference.getMonth() - back, 1)));
  }
  return months;
}

/** "2026-05" -> "May 2026", para mostrar la ventana en pantalla. */
export function formatYearMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (names[month - 1] ?? ym) + ' ' + year;
}

/** 'YYYY-MM' del mes de `reference`. */
export function currentYearMonth(reference: Date): string {
  return toYearMonth(reference);
}

/**
 * La ventana del Qualifier 1: los `count - 1` meses cerrados anteriores más el
 * mes en curso, que va último y es el que se reemplaza por la proyección.
 *
 * Ej. referencia = 13 ago 2026, count = 3 -> ['2026-06', '2026-07', '2026-08']
 */
export function currentWindowMonths(reference: Date, count: number): string[] {
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back--) {
    months.push(toYearMonth(new Date(reference.getFullYear(), reference.getMonth() - back, 1)));
  }
  return months;
}

/** Los 12 meses del año de `reference`, para el gráfico de barras. */
export function monthsOfYear(reference: Date): string[] {
  const year = reference.getFullYear();
  return Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
}

/** "2026-05" -> "May". Etiqueta corta para el eje del gráfico. */
export function shortMonth(ym: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[Number(ym.split('-')[1]) - 1] ?? ym;
}
