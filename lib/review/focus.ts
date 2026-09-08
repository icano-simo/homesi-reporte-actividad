/**
 * ============================================================================
 * EL FOCO DE LA REVISIÓN: UNA SOLA PERSONA A LA VISTA
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * En modo revisión, la vista del branch de Outlook tiene que mostrar SÓLO al
 * Loan Officer que se está revisando. Hoy muestra a todos, y el brief lo pide
 * en el punto 7 como una de las dos cosas que no existen.
 *
 * ---------------------------------------------------------------------------
 * ⚠ PURO, Y FUERA DEL MÓDULO OUTLOOK
 * ---------------------------------------------------------------------------
 * No lee la base, no usa React y no importa nada de `lib/outlook`. Recibe una
 * lista y devuelve una lista, así que se prueba sin navegador y sin sesión —
 * que es lo que permite verificarlo aunque el modo revisión todavía no se pueda
 * recorrer de punta a punta.
 *
 * Y vive en `lib/review` y no en `lib/outlook` porque la regla es de la
 * REVISIÓN: Outlook no tiene por qué saber que existe un modo que lo enfoca.
 * Lo único que Outlook hace es preguntar.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `null` NO ES «MOSTRAR A NADIE»
 * ---------------------------------------------------------------------------
 * `focusEmployeeKey === null` significa que no hay revisión en curso, y
 * entonces la lista pasa entera: la app normal queda idéntica. Es la misma
 * distinción que sostiene el resto del módulo — no vino no es vino vacío — y
 * acá evita el peor error posible, que es que una pantalla de Outlook se quede
 * sin gente porque alguien no arrancó una revisión.
 */

/** Lo mínimo que el foco necesita de una persona. */
export interface ConEmployeeKey {
  employeeKey: number;
}

/**
 * La lista, enfocada.
 *
 * Con `focusEmployeeKey` en `null` devuelve **el mismo array**, no una copia:
 * así el caso normal no crea basura en cada render de una tabla de ocho filas,
 * y una comparación por identidad aguas arriba sigue funcionando.
 */
export function focusOn<T extends ConEmployeeKey>(
  personas: readonly T[],
  focusEmployeeKey: number | null
): readonly T[] {
  if (focusEmployeeKey === null) return personas;
  return personas.filter((p) => p.employeeKey === focusEmployeeKey);
}

/**
 * ⚠ CUÁNTAS SE ESCONDIERON, para poder decirlo.
 *
 * Enfocar sin decirlo es peor que no enfocar: quien mire la pantalla del branch
 * va a ver una sola persona donde antes había ocho y no va a saber si el branch
 * se quedó sin gente o si la vista está filtrada. Con este número la pantalla
 * puede decir «7 more hidden while reviewing Nathan».
 *
 * Es la lección de `Branch Out of Division`: un caso nuevo abre un camino, y el
 * camino hay que recorrerlo. Acá el camino nuevo es «una tabla con una fila».
 */
export function hiddenCount<T extends ConEmployeeKey>(
  personas: readonly T[],
  focusEmployeeKey: number | null
): number {
  if (focusEmployeeKey === null) return 0;
  return personas.length - focusOn(personas, focusEmployeeKey).length;
}

/**
 * `true` si la persona enfocada NO está en la lista.
 *
 * Hace falta porque enfocar puede dejar la lista en CERO, y eso no es lo mismo
 * que un branch sin gente: significa que el Loan Officer que se revisa no
 * participa de esta estrategia, o no es de este branch. La pantalla lo tiene que
 * decir con esas palabras, porque una tabla vacía sin explicación se lee como
 * un dato que falta.
 */
export function focusIsAbsent<T extends ConEmployeeKey>(
  personas: readonly T[],
  focusEmployeeKey: number | null
): boolean {
  if (focusEmployeeKey === null) return false;
  return personas.length > 0 && focusOn(personas, focusEmployeeKey).length === 0;
}
