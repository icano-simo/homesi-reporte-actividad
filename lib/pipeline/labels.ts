/*
 * ============================================================================
 * LOS PLACEHOLDERS DE FILA VACÍA — una sola definición de cada uno
 * ============================================================================
 *
 * Cuando un préstamo no trae programa, tipo o estado de la propiedad, el
 * ranking lo agrupa igual bajo una etiqueta. Estas son esas etiquetas.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ ESTO ES UN ARCHIVO Y NO TRES CONSTANTES SUELTAS
 * ---------------------------------------------------------------------------
 * Hasta esta etapa había SIETE definiciones para tres textos:
 *
 *   'Sin programa'  lib/pipeline/analytics.ts       (sin exportar)
 *                   app/pipeline/TabAnalytics.tsx   (copia, para el drill-down)
 *   'Sin tipo'      lib/pipeline/analytics.ts       (sin exportar)
 *                   app/pipeline/TabAnalytics.tsx   (copia, para el color)
 *                   app/pipeline/TabAnalytics.tsx   (copia, para el drill-down)
 *                   lib/pipeline/trends.ts          (literal suelto)
 *   'Sin estado'    lib/pipeline/analytics.ts       (exportado -- el único bien)
 *
 * Y no era un descuido: había un comentario que declaraba la duplicación y
 * advertía "si el texto cambia algún día en analytics.ts, este archivo hay que
 * actualizarlo a mano también".
 *
 * El problema es que el drill-down COMPARA POR TEXTO para saber qué préstamos
 * cayeron en la fila donde alguien hizo clic:
 *
 *     .filter((l) => (l.loanType.trim() || NO_TYPE_LABEL) === row.label)
 *
 * Con dos copias, cambiar una sola deja la fila visible y el detalle vacío. No
 * falla, no avisa, compila igual, y sólo se nota si alguien hace clic justo en
 * esa fila. Un comentario que dice "tienen que ser el mismo texto" es una
 * advertencia; que sea imposible desincronizarlas es un arreglo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ ACÁ Y NO EXPORTADAS DESDE `analytics.ts`
 * ---------------------------------------------------------------------------
 * Porque `trends.ts` también las necesita, y hacer que `trends.ts` importe de
 * `analytics.ts` ataría dos módulos hermanos que no tienen ninguna otra
 * relación, sólo para compartir un string. Este archivo no importa nada: es una
 * hoja del grafo de dependencias y no puede formar un ciclo con nadie, ni hoy
 * ni cuando aparezca el cuarto consumidor.
 */

/** Préstamo sin `loanProgram`. */
export const NO_PROGRAM_LABEL = 'No program';

/** Préstamo sin `loanType`. */
export const NO_TYPE_LABEL = 'No type';

/** Préstamo sin `propertyState`. */
export const NO_PROPERTY_STATE_LABEL = 'No state';
