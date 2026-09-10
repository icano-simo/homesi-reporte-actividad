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
 * ⚠ EL FOCO YA NO CUBRE TODA LA VISTA — desde que OL26 rehizo el branch de
 * Outlook por tipo de persona (rebase de `feat/ol26-vista-outlook` sobre esta
 * rama, 2026-09-10)
 * ---------------------------------------------------------------------------
 * `focusIndexed` seguía enfocando dos grupos: "Own Production/Recruitment por
 * persona" (`personasDe(bs)`/`bs.opensBy === 'loanOfficer'`) y "B2B/Affinity
 * por dueño" (`bs.owners`/`bs.opensBy === 'owner'`). OL26 sacó el segundo: B2B
 * ya no tiene fila propia (su presupuesto se resume en la reconciliación) y
 * Affinity pasó a ser una fila total, sin abrirse por Account Executive. Hoy
 * `focusIndexed` sólo tiene un llamador en la vista del branch, sobre
 * `personRows` (Own Production + Recruitment combinados).
 *
 * ⚠ DÓNDE SE VA A NOTAR: fase 2 de la revisión, en la vista del branch. El
 * foco cae bien sobre la fila de la persona en "Loan Officers — existing",
 * pero las filas de B2B y Affinity (si el branch las muestra) se ven SIN
 * filtrar -- no hay `bs.owners` que enfocar, porque esa forma de la tabla ya
 * no existe. No es un bug de este archivo: es una pérdida real del rediseño,
 * declarada en `app/outlook/branch/[code]/page.tsx` (la nota de `focoKey`) y
 * repetida acá porque es donde alguien va a buscar por qué el foco no cubre
 * todo.
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

/**
 * Lo mínimo que el foco necesita de una persona.
 *
 * ⚠ `null` ES UN VALOR LEGÍTIMO acá, y no una omisión: los dueños de Affinity
 * incluyen al USUARIO DE SISTEMA, que no es una persona y no tiene clave. Con
 * un foco puesto nunca coincide --que es lo correcto, no es la persona
 * revisada-- y sin foco pasa entero como todos.
 */
export interface ConEmployeeKey {
  employeeKey: number | null;
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

/**
 * ═════════════════════════════════════════════════════════════════════════
 * ENFOCAR SIN PERDER EL ÍNDICE — etapa RV7
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `focusOn` devuelve una lista nueva, y eso NO SIRVE donde el foco se aplica de
 * verdad. La vista del branch reparte el entero de cada estrategia entre las
 * personas ANTES de emitir filas:
 *
 *     const enteros = apportionByWeight(totalDeLaEstrategia, exactos);
 *     personas.map((lo, idx) => … enteros[idx] …)
 *
 * `enteros[idx]` está atado a la posición en la lista COMPLETA. Filtrar antes
 * del `map` renumera las posiciones, así que la persona visible se quedaría con
 * el presupuesto de otra -- y sumando bien, que es la peor forma de estar mal.
 *
 * ⚠ Y RECALCULAR EL REPARTO SOBRE LA LISTA ENFOCADA ES PEOR: `apportionByWeight`
 * reparte EL ENTERO DE LA ESTRATEGIA, así que con una sola persona el entero
 * completo cae en ella. La pantalla mostraría a la persona revisada con el
 * presupuesto de las ocho. Es el mismo mecanismo que ya documentó la vista del
 * branch cuando los pesos daban todos cero y el entero se volcaba en una fila.
 *
 * De ahí la forma: el índice se ata ANTES de filtrar y viaja con cada elemento.
 * Enfocar deja de poder cambiar un número, porque no toca el cálculo.
 */
export interface Enfocado<T> {
  item: T;
  /** La posición en la lista SIN enfocar, que es la que indexa el reparto. */
  idx: number;
}

/**
 * La lista con su índice original, enfocada.
 *
 * Con `focusEmployeeKey` en `null` devuelve todos --la app normal idéntica-- y
 * con una clave, sólo esa persona, cada uno sabiendo de qué posición vino.
 */
export function focusIndexed<T extends ConEmployeeKey>(
  personas: readonly T[],
  focusEmployeeKey: number | null
): readonly Enfocado<T>[] {
  const conIndice = personas.map((item, idx) => ({ item, idx }));
  if (focusEmployeeKey === null) return conIndice;
  return conIndice.filter(({ item }) => item.employeeKey === focusEmployeeKey);
}
