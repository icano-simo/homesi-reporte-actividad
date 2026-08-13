/**
 * Ventana de meses para el promedio de cierres.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 *
 * ⚠ SUPUESTO EXPLÍCITO, A CONFIRMAR CON EL NEGOCIO. El brief pide "promedio de
 * cierres últimos 3 meses" pero no dice si el mes en curso entra. Acá se
 * EXCLUYE: se toman los 3 meses calendario completos anteriores al actual.
 *
 * El motivo es que incluir el mes en curso deprime el promedio de todos por
 * igual y lo hace variar según el día en que se mire -- alguien evaluado un 3
 * de mes parecería estar peor que el mismo alguien evaluado un 28. Como este
 * promedio va a alimentar el GAP y el triage, esa inestabilidad tendría
 * consecuencias reales.
 *
 * La ventana usada se muestra en pantalla y viaja en `diagnostics`, así que si
 * el criterio no es el que el negocio quería, se ve enseguida.
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
