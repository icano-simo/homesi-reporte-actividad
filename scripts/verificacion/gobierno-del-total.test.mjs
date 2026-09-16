/*
 * ============================================================================
 * QUÉ FILA DE `budget_total` GOBIERNA — etapa OL41
 * ============================================================================
 *
 * Dos cosas, y la segunda es la que pidió el brief:
 *
 *   1. que el criterio haga lo que dice --confirmación no gobierna, liberación
 *      sí, y una liberación no es un cero--;
 *   2. que NO HAYA UNA SEGUNDA COPIA del criterio en el repo. Vivía tres veces
 *      --`lib/outlook/loadData.ts`, `lib/business-plan/loadData.ts` y el
 *      arrastre de `save.ts`-- y las tres decían lo mismo, que es justo lo que
 *      hace que nadie las note. Los comentarios de los dos lectores avisaban
 *      que separarlas era cuestión de que alguien cambiara una sin la otra;
 *      esta prueba lo mide en vez de pedirlo.
 *
 * `gobierno.ts` es puro y sin imports: Node lo carga directo, igual que
 * `ventana.ts` y `gates.ts`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const { gobierna, revisionQueGobierna, totalesVigentes, presupuestoDePersona, pisoDeRealtors } =
  await import(pathToFileURL(resolve(RAIZ, 'lib/outlook/gobierno.ts')).href);

/* 14 de OL41 + 9 del piso de realtors + 1 de que tampoco tiene copias — OL48. */
const a = crearArnes({ minimo: 14 + 10 });
const mes = (m) => m + '-01';
const numero = (rev, m, total) => ({ revision: rev, target_month: mes(m), total, confirmed_only: false });
const confirmacion = (rev, m) => ({ revision: rev, target_month: mes(m), total: null, confirmed_only: true });
const liberacion = (rev, m) => ({ revision: rev, target_month: mes(m), total: null, confirmed_only: false, released_to_rule: true });

/* ── 1. Las tres clases de fila ─────────────────────────────────────────── */
a.ck(gobierna(numero(1, '2026-10', 4)) === true, 'una fila con número gobierna');
a.ck(gobierna(confirmacion(2, '2026-10')) === false,
  '⚠ una confirmación NO gobierna: si contara, confirmar borraría el presupuesto');
a.ck(gobierna(liberacion(2, '2026-10')) === true,
  '⚠ una liberación SÍ gobierna: decide que no haya número');

/* El caso de Galo, tal cual estaba en la base: un número y cuatro
   confirmaciones encima. Manda la revisión 1, que es lo que nadie veía. */
const galo = [
  numero(1, '2026-10', 4), numero(1, '2026-11', 4), numero(1, '2026-12', 4),
  confirmacion(2, '2026-10'), confirmacion(3, '2026-10'),
  confirmacion(4, '2026-10'), confirmacion(5, '2026-10'),
];
a.ck(revisionQueGobierna(galo) === 1,
  'con cuatro confirmaciones encima sigue mandando la revisión 1 (' + revisionQueGobierna(galo) + ')');
a.ck(totalesVigentes(galo).byMonth['2026-10'] === 4, 'y su octubre sigue fijado en 4');

/* Y con la liberación que esta etapa agrega, sí se suelta. */
const soltado = [...galo, liberacion(6, '2026-10'), liberacion(6, '2026-11'), liberacion(6, '2026-12')];
const v = totalesVigentes(soltado);
a.ck(v.revision === 6, 'la liberación es la revisión vigente (' + v.revision + ')');
a.ck(Object.keys(v.byMonth).length === 0,
  '⚠ y no deja ningún mes con número: los tres vuelven a la regla');
a.ck(JSON.stringify(v.soltados.sort()) === JSON.stringify(['2026-10', '2026-11', '2026-12']),
  'y los nombra, porque «no está» y «se soltó» no son lo mismo para quien lo explique');

/* ⚠ SOLTAR NO ES FIJAR EN CERO. Es la distinción que sostiene el módulo. */
const cero = [numero(1, '2026-10', 0)];
a.ck(totalesVigentes(cero).byMonth['2026-10'] === 0 && totalesVigentes(cero).soltados.length === 0,
  'un cero fijado sigue siendo un número fijado, no una liberación');
a.ck(totalesVigentes([liberacion(1, '2026-10')]).byMonth['2026-10'] === undefined,
  'y una liberación no deja un 0 en su lugar');

/* Una revisión mixta: unos meses fijados y otros soltados, en la misma
   decisión -- que es como el editor guarda cuando se vacían algunas celdas. */
const mixta = [numero(3, '2026-10', 2), liberacion(3, '2026-11'), numero(3, '2026-12', 2)];
const vm = totalesVigentes(mixta);
a.ck(vm.byMonth['2026-10'] === 2 && vm.byMonth['2026-12'] === 2 && vm.byMonth['2026-11'] === undefined,
  'una revisión mixta fija unos meses y suelta otros');

/* Sin la columna --el SQL todavía no aplicado-- todo se comporta como antes. */
const sinColumna = [{ revision: 1, target_month: mes('2026-10'), total: 3, confirmed_only: false }];
a.ck(totalesVigentes(sinColumna).byMonth['2026-10'] === 3,
  'sin la columna `released_to_rule` el criterio es el de siempre');

/* ── 1b. El piso de los realtors, transversal a los tres — OL48 ─────────── */
/*
 * ⚠ LAS TRES PUERTAS Y EL PISO QUE LAS ATRAVIESA. Un realtor NPPM no cierra:
 * cierra su Loan Officer. Así que lo que el realtor proyecta ya pasa por él y
 * un total menor que la suma de sus realtors afirma algo imposible. No es una
 * preferencia entre dos números -- es que uno de los dos no puede ser cierto.
 */
const p = (fijado, regla, piso) => presupuestoDePersona({ fijado, regla, pisoDeRealtors: piso });

a.ck(p(5, 3, 0).valor === 5 && p(5, 3, 0).subioPorRealtors === false,
  'sin realtors, el total fijado manda sobre la regla');
a.ck(p(undefined, 3, 0).valor === 3, 'y sin total fijado manda la regla');
a.ck(p(5, 3, 2).valor === 5 && p(5, 3, 2).subioPorRealtors === false,
  'un piso menor que el total fijado no lo toca');
a.ck(p(1, 3, 2).valor === 2 && p(1, 3, 2).subioPorRealtors === true,
  '⚠ pero un piso mayor LEVANTA un total fijado, y lo dice');
a.ck(p(undefined, 1, 2).valor === 2 && p(undefined, 1, 2).subioPorRealtors === true,
  '⚠ y levanta también a quien proyecta por regla: es el caso del 776');
/*
 * ⚠ IGUAL NO ES MAYOR, y la distinción no es cosmética: con `>=` el rótulo
 * `raised by NPPM` aparecería en toda persona cuyo número coincide con su piso
 * por cualquier motivo, y un rótulo que sale cuando no pasa nada enseña a
 * ignorarlo. Medido en pantalla: Matthew Gomez Bruckner está en 1 con un piso
 * de 1, y no lleva rótulo.
 */
a.ck(p(2, 1, 2).valor === 2 && p(2, 1, 2).subioPorRealtors === false,
  '⚠ un piso IGUAL al total no lo levanta: sube sólo cuando pide MÁS');
/*
 * ⚠ Y UN CERO FIJADO CON PISO CERO SIGUE SIENDO CERO. Cero es una decisión
 * --«este mes espero cero préstamos»-- y el piso no la borra si nadie pide
 * más. Es la misma distinción que sostiene el módulo entero.
 */
a.ck(p(0, 4, 0).valor === 0 && p(0, 4, 0).subioPorRealtors === false,
  'un cero fijado con piso cero sigue en cero: el piso no inventa producción');

/* Y la suma del piso, que vive acá porque la leen tres lugares. */
const rs = [{ byMonth: { '2026-10': 2, '2026-11': 1 } }, { byMonth: { '2026-10': 1 } }];
a.ck(pisoDeRealtors(rs, '2026-10') === 3, 'el piso suma a todos los realtors del mes (3)');
a.ck(pisoDeRealtors(rs, '2026-12') === 0 && pisoDeRealtors([], '2026-10') === 0,
  'y un mes sin nada, o una persona sin realtors, da 0 y no `NaN`');

/* ── 2. Que no haya una segunda definición ──────────────────────────────── */
const fuentes = [];
const recorrer = (dir) => {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '.next' || nombre === '.git') continue;
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.(ts|tsx)$/.test(nombre)) fuentes.push(p);
  }
};
for (const d of ['lib', 'app']) recorrer(join(RAIZ, d));
/*
 * La forma del criterio, tal como estaba escrita en los tres lugares:
 * `confirmed_only` comparado dentro de una expresión que decide. Se busca el
 * USO en código y no la palabra --los comentarios la nombran a propósito, y
 * deben poder seguir nombrándola--, así que se piden las dos mitades en la
 * misma línea.
 */
const copias = fuentes.filter((p) => {
  if (p.endsWith(join('lib', 'outlook', 'gobierno.ts'))) return false;
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .some((l) => /confirmed_only/.test(l) && /!==\s*true|===\s*true|!=\s*true/.test(l));
});
console.log('archivos que deciden sobre `confirmed_only` fuera de gobierno.ts: ' +
  JSON.stringify(copias.map((p) => p.slice(RAIZ.length + 1))));
a.ck(copias.length === 0,
  '⚠ el criterio vive en UN solo archivo: ' + JSON.stringify(copias.map((p) => p.slice(RAIZ.length + 1))));
a.ck(fuentes.length > 100, 'y se recorrió el repo de verdad: ' + fuentes.length + ' archivos');

/*
 * ⚠ Y LO MISMO CON EL PISO — OL48. Llegó escrito TRES veces en el mismo turno
 * --`projectBranch`, `loanOfficerRowsOf` y la composición de la pantalla-- y
 * las tres contestan «cuánto de esta persona ya viene por sus realtors»: dos lo
 * usan como piso y una lo resta. Eran correctas las tres, que es exactamente lo
 * que las hace divergir en el primer cambio.
 *
 * Se busca la SUMA sobre `nppmRealtors` y no la palabra --los comentarios la
 * nombran a propósito y tienen que poder seguir nombrándola--, así que se piden
 * las dos mitades en la misma línea de código.
 */
const sumas = fuentes.filter((ruta) => {
  if (ruta.endsWith(join('lib', 'outlook', 'gobierno.ts'))) return false;
  return readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .some((l) => /nppmRealtors/.test(l) && /\.reduce\(/.test(l));
});
console.log('archivos que suman `nppmRealtors` fuera de gobierno.ts: ' +
  JSON.stringify(sumas.map((ruta) => ruta.slice(RAIZ.length + 1))));
a.ck(sumas.length === 0,
  '⚠ el piso de los realtors también vive en UN solo archivo: ' +
    JSON.stringify(sumas.map((ruta) => ruta.slice(RAIZ.length + 1))));

process.exitCode = a.resumen();
