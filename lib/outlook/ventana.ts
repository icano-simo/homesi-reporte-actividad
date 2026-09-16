/**
 * ============================================================================
 * LO QUE NO ESTABA EN PANTALLA NO SE BORRA — etapa OL38
 * ============================================================================
 *
 * Una revisión reemplaza al conjunto: la lectura se queda con la más alta,
 * entera, y no la completa con la anterior (ver `loadData.ts`). Eso es
 * deliberado DENTRO de lo que se editó --no repetir un bucket es como se dice
 * «este mes no hago B2B»-- pero fuera de la ventana del editor no hay ninguna
 * decisión que respetar: nadie eligió borrar enero de 2027 editando octubre.
 *
 * Y no es hipotético en ninguna de las dos direcciones:
 *
 *   · Adriana Espinoza tenía own_production hasta marzo de 2027 en su revisión
 *     1; la 2 se guardó con oct–dic de 2026 y los tres meses se fueron con
 *     ella. DESPUÉS de la ventana.
 *   · Gian Laino y Juseth Castro tienen B2B de septiembre vigente, que también
 *     queda fuera --la ventana son los meses que FALTAN-- y se habría ido en su
 *     próxima edición. ANTES de la ventana. Fuera es fuera.
 *
 * Por eso la ventana la pasa el llamador y no se deduce de lo que se guarda:
 * «no vino porque se decidió» y «no vino porque no estaba en pantalla» son
 * cosas distintas, y sólo quien dibujó la pantalla sabe cuál es cuál. Es la
 * misma distinción que sostiene el resto del módulo --un cero es una decisión,
 * vacío es que nadie decidió-- corrida un nivel: acá lo que se distingue es la
 * AUSENCIA de una fila.
 *
 * ⚠ VIVE EN SU PROPIO ARCHIVO, sin un solo import, para que su prueba pueda
 * importarla sin arrastrar el cliente de Supabase ni el alias `@/lib` -- que es
 * justo lo que impide a Node cargar `save.ts` directo.
 */
export function filasFueraDeVentana<T extends { revision: number; target_month: string }>(
  filas: T[],
  revisionVigente: number,
  windowMonths: string[]
): T[] {
  const ventana = new Set(windowMonths);
  return filas.filter(
    (f) => f.revision === revisionVigente && !ventana.has(f.target_month.slice(0, 7))
  );
}
