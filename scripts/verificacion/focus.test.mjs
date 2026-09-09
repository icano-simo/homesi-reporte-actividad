/*
 * ============================================================================
 * EL FOCO DE LA REVISIÓN, PROBADO SIN NAVEGADOR
 * ============================================================================
 *
 * `lib/review/focus.ts` es puro: recibe una lista y devuelve una lista. Así que
 * se prueba acá, sin servidor, sin base y sin sesión.
 *
 * ⚠ Y ESTE ARCHIVO VIVE EN EL REPO A PROPÓSITO. Las aserciones de RV1 existían
 * y estaban en un scratchpad de sesión, así que cuando llegó el momento de
 * cablear el foco no había nada que correr. Es la lección de `guardas.mjs`: una
 * prueba que se muere con la sesión se usa igual que una nota.
 *
 * Node importa el `.ts` directamente --quita los tipos-- así que no hace falta
 * ningún paso de compilación.
 *
 * ---------------------------------------------------------------------------
 * LA PRIMERA ASERCIÓN ES LA QUE MANDA
 * ---------------------------------------------------------------------------
 * **Enfocar no puede cambiar los números.** La vista del branch reparte el
 * entero de cada estrategia entre las personas ANTES de emitir filas, y
 * `enteros[idx]` está atado a la posición en la lista COMPLETA. Este archivo
 * reproduce ese reparto y comprueba que la fila visible se queda con SU parte y
 * no con la de otra.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');

const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const { focusOn, hiddenCount, focusIsAbsent, focusIndexed } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/review/focus.ts')).href);
const { apportionByWeight } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/pipeline/aggregate.ts')).href);

/* Ocho personas, como un branch de verdad. */
const ocho = [
  { employeeKey: 11, fullName: 'Uno' },
  { employeeKey: 12, fullName: 'Dos' },
  { employeeKey: 13, fullName: 'Tres' },
  { employeeKey: 14, fullName: 'Cuatro' },
  { employeeKey: 15, fullName: 'Cinco' },
  { employeeKey: 16, fullName: 'Seis' },
  { employeeKey: 17, fullName: 'Siete' },
  { employeeKey: 18, fullName: 'Ocho' },
];

const a = crearArnes({ minimo: 22 });
try {
  /* ═══════════════════════════════════════════════════════════════════
     1. ENFOCAR NO PUEDE CAMBIAR LOS NÚMEROS
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n=== 1. el reparto no cambia al enfocar ===');

  /* El peso de cada uno: su presupuesto exacto del mes. */
  const pesos = [3.4, 1.2, 0.6, 2.9, 0.1, 4.4, 1.9, 0.5];
  const TOTAL = 15; /* el entero de la estrategia */
  const enteros = apportionByWeight(TOTAL, pesos);
  console.log('  total=' + TOTAL + '  repartido=' + JSON.stringify(enteros));

  a.ck(enteros.reduce((x, y) => x + y, 0) === TOTAL,
    'las partes suman el total del branch: ' + enteros.reduce((x, y) => x + y, 0));

  /* La forma CORRECTA: el índice se ata antes de filtrar. */
  const foco = 16; /* «Seis», la sexta persona */
  const visibles = focusIndexed(ocho, foco);
  a.ck(visibles.length === 1, 'enfocado queda una fila: ' + visibles.length);
  a.ck(visibles[0].idx === 5,
    'y conserva su POSICIÓN original, que es la que indexa el reparto: idx=' +
    visibles[0].idx);
  a.ck(enteros[visibles[0].idx] === enteros[5],
    'así que la fila visible muestra SU parte: ' + enteros[visibles[0].idx]);

  /*
   * ⚠ Y LA FORMA EQUIVOCADA, MEDIDA. Recalcular el reparto sobre la lista
   * enfocada vuelca el entero de la estrategia en la única persona que queda.
   * Es el defecto que `focusIndexed` existe para no tener.
   */
  const soloUno = focusOn(ocho, foco);
  const pesosDeUno = soloUno.map((p) => pesos[ocho.indexOf(p)]);
  const malRepartido = apportionByWeight(TOTAL, pesosDeUno);
  console.log('  recalculado sobre la lista enfocada -> ' + JSON.stringify(malRepartido));
  a.ck(malRepartido[0] === TOTAL,
    'RECALCULAR VUELCA EL ENTERO DE LA ESTRATEGIA EN ELLA: ' + malRepartido[0] +
    ' contra los ' + enteros[5] + ' que le tocan');
  a.ck(malRepartido[0] !== enteros[5],
    'o sea que las dos formas NO dan lo mismo, y por eso el índice se ata antes');

  /* Y sin foco, el reparto y las posiciones son los de siempre. */
  const todos = focusIndexed(ocho, null);
  a.ck(todos.length === 8, 'sin foco pasan los ocho: ' + todos.length);
  a.ck(todos.every((x, i) => x.idx === i), 'y cada uno con su posición');
  a.ck(todos.every((x, i) => x.item === ocho[i]),
    'y con el MISMO objeto, no una copia');

  /* ═══════════════════════════════════════════════════════════════════
     2. `null` NO ES «MOSTRAR A NADIE»
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n=== 2. sin revisión, la app queda idéntica ===');
  a.ck(focusOn(ocho, null) === ocho,
    'devuelve EL MISMO array, no una copia: una tabla de ocho filas no crea ' +
    'basura en cada render');
  a.ck(hiddenCount(ocho, null) === 0, 'no esconde a nadie');
  a.ck(focusIsAbsent(ocho, null) === false,
    'y nadie está ausente: sin revisión no hay a quién buscar');

  /* ═══════════════════════════════════════════════════════════════════
     3. CUÁNTOS SE ESCONDIERON, PARA PODER DECIRLO
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n=== 3. lo que la pantalla tiene que decir ===');
  a.ck(hiddenCount(ocho, foco) === 7, 'siete escondidos: ' + hiddenCount(ocho, foco));
  a.ck(focusIsAbsent(ocho, foco) === false, 'y el enfocado no está ausente: está');

  /* La persona que NO participa de la estrategia. */
  const tres = ocho.slice(0, 3);
  a.ck(focusOn(tres, foco).length === 0, 'no participa: cero filas');
  a.ck(focusIsAbsent(tres, foco) === true,
    'y eso se distingue de «el branch no tiene gente»: focusIsAbsent = true');
  a.ck(hiddenCount(tres, foco) === 3,
    'con las tres escondidas: ' + hiddenCount(tres, foco));

  /*
   * ⚠ LA DISTINCIÓN QUE IMPORTA: una estrategia SIN NADIE no es «no participa».
   * La primera es del branch --nadie tiene cierres ni presupuesto ahí-- y la
   * segunda es de la persona. La pantalla las dice distinto, así que
   * `focusIsAbsent` tiene que separarlas.
   */
  a.ck(focusIsAbsent([], foco) === false,
    'una lista VACÍA no es «no participa»: no hay nadie a quien no incluir');
  a.ck(hiddenCount([], foco) === 0, 'y no esconde nada');

  /* ═══════════════════════════════════════════════════════════════════
     4. EL USUARIO DE SISTEMA, QUE NO ES UNA PERSONA
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n=== 4. el dueño sin employeeKey ===');
  const duenos = [
    { employeeKey: 21, owner: 'Shirley Camargo', isPerson: true },
    { employeeKey: null, owner: 'unassigned owner', isPerson: false },
    { employeeKey: 22, owner: 'David Alvarez', isPerson: true },
  ];
  a.ck(focusIndexed(duenos, null).length === 3,
    'sin foco pasan los tres, el de sistema incluido');
  const soloShirley = focusIndexed(duenos, 21);
  a.ck(soloShirley.length === 1 && soloShirley[0].idx === 0,
    'con foco queda la persona, en su posición');
  a.ck(focusIndexed(duenos, 99).length === 0,
    'y un `employeeKey` en null NUNCA coincide con un foco: el usuario de ' +
    'sistema no es la persona revisada');
  a.ck(focusIsAbsent(duenos, 99) === true,
    'así que si el revisado no es dueño de nada acá, se dice');

  /* ═══════════════════════════════════════════════════════════════════
     5. QUE EL FILTRO SEA EXACTO
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n=== 5. el filtro no se pasa de listo ===');
  a.ck(focusOn(ocho, 13).length === 1, 'una clave que está: una fila');
  a.ck(focusOn(ocho, 999).length === 0, 'una que no está: ninguna');
  const repetido = [{ employeeKey: 5 }, { employeeKey: 5 }, { employeeKey: 6 }];
  a.ck(focusIndexed(repetido, 5).length === 2,
    'y si la lista trae la misma clave dos veces, salen las dos: filtrar no ' +
    'es deduplicar, y esconder una fila real sería peor');
} finally {
  process.exitCode = a.resumen();
}
