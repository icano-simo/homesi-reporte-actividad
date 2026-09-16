/*
 * ============================================================================
 * LO QUE NO ESTABA EN PANTALLA NO SE BORRA — etapa OL38
 * ============================================================================
 *
 * `filasFueraDeVentana` es pura: Node importa el `.ts` directo, igual que
 * `desenlace.test.mjs` con `gates.ts`.
 *
 * Los dos casos reales que la motivan, y van los dos porque son direcciones
 * distintas del mismo error:
 *
 *   · Adriana Espinoza tenía own_production hasta marzo de 2027 y se le borró
 *     al guardar una revisión de oct–dic. DESPUÉS de la ventana.
 *   · Gian Laino y Juseth Castro tienen B2B de septiembre vigente, que también
 *     queda fuera --la ventana son los meses que FALTAN-- y se iba en su
 *     próxima edición. ANTES de la ventana.
 *
 * ⚠ Y la que sostiene el diseño es la cuarta: un bucket vaciado DENTRO de la
 * ventana tiene que seguir borrándose. Si el arrastre se lo llevara puesto,
 * «este mes no hago B2B» dejaría de poder decirse, y eso es lo que esta etapa
 * NO puede romper.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const { filasFueraDeVentana } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/outlook/ventana.ts')).href);

const a = crearArnes({ minimo: 12 });
const VENTANA = ['2026-10', '2026-11', '2026-12'];
const mes = (m) => m + '-01';

/* La revisión vigente de Adriana antes de que se le borrara 2027, más una
   revisión vieja que no tiene que participar de nada. */
const adriana = [
  { revision: 1, target_month: mes('2026-10'), bucket: 'own_production', value: 1 },
  { revision: 1, target_month: mes('2026-11'), bucket: 'own_production', value: 1 },
  { revision: 1, target_month: mes('2026-12'), bucket: 'own_production', value: 1 },
  { revision: 1, target_month: mes('2027-01'), bucket: 'own_production', value: 1 },
  { revision: 1, target_month: mes('2027-02'), bucket: 'own_production', value: 1 },
  { revision: 1, target_month: mes('2027-03'), bucket: 'own_production', value: 2 },
  { revision: 0, target_month: mes('2027-01'), bucket: 'b2b', value: 9 },
];
const arr = filasFueraDeVentana(adriana, 1, VENTANA);
a.ck(arr.length === 3, 'de la revisión vigente se arrastran los 3 meses de 2027 (' + arr.length + ')');
a.ck(arr.every((f) => f.target_month.startsWith('2027')), 'y son exactamente los de 2027');
a.ck(arr.some((f) => f.value === 2), 'con su valor, no con un cero: marzo vale 2');
a.ck(!arr.some((f) => f.revision === 0),
  '⚠ y NADA de la revisión 0, que ya no gobierna -- arrastrar desde ella resucitaría un dato muerto');

/* Gian: B2B de septiembre, que queda ANTES de la ventana. Fuera es fuera. */
const gian = [
  { revision: 1, target_month: mes('2026-09'), bucket: 'b2b', value: 1 },
  { revision: 1, target_month: mes('2026-10'), bucket: 'b2b', value: 1 },
  { revision: 1, target_month: mes('2026-11'), bucket: 'b2b', value: 1 },
  { revision: 1, target_month: mes('2026-12'), bucket: 'b2b', value: 1 },
];
const arrG = filasFueraDeVentana(gian, 1, VENTANA);
a.ck(arrG.length === 1 && arrG[0].target_month === mes('2026-09'),
  'un mes ANTERIOR a la ventana también se arrastra: septiembre');

/* ⚠ Lo que NO tiene que pasar: que el arrastre salve lo que se borró adrede. */
const dentro = filasFueraDeVentana(gian, 1, VENTANA).filter((f) =>
  VENTANA.includes(f.target_month.slice(0, 7)));
a.ck(dentro.length === 0,
  '⚠ nada de DENTRO de la ventana se arrastra: vaciar B2B de octubre lo borra, que es la decisión');

/* Una ventana que no cubre nada de lo guardado: se arrastra todo lo vigente. */
const todo = filasFueraDeVentana(gian, 1, ['2025-01']);
a.ck(todo.length === 4, 'con una ventana ajena se conserva la revisión vigente entera');

/* Y una que las cubre todas: no se arrastra nada. */
const nada = filasFueraDeVentana(gian, 1, ['2026-09', ...VENTANA]);
a.ck(nada.length === 0, 'y con la ventana completa no se arrastra nada');

/* Sin filas previas --el primer guardado de alguien-- no hay qué arrastrar. */
a.ck(filasFueraDeVentana([], 0, VENTANA).length === 0, 'sin revisiones previas no arrastra nada');

/* No toca lo que recibe: el llamador arma las filas nuevas con esto al lado. */
const antes = JSON.stringify(gian);
filasFueraDeVentana(gian, 1, VENTANA);
a.ck(JSON.stringify(gian) === antes, 'y no muta lo que recibe');

/*
 * ⚠ LA PRUEBA DE QUE LA PRUEBA MIDE. Si `filasFueraDeVentana` devolviera todo
 * --o nada-- sin mirar la ventana, las de arriba podrían seguir en verde por
 * casualidad. Éstas dos no: el mismo conjunto con dos ventanas distintas tiene
 * que dar resultados distintos.
 */
const conUna = filasFueraDeVentana(gian, 1, VENTANA).length;
const conOtra = filasFueraDeVentana(gian, 1, ['2026-09', '2026-10']).length;
a.ck(conUna !== conOtra, 'la ventana cambia el resultado: ' + conUna + ' contra ' + conOtra);
a.ck(conOtra === 2, 'y con oct–sep quedan afuera noviembre y diciembre (' + conOtra + ')');

process.exitCode = a.resumen();
