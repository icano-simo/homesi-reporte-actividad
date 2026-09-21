/*
 * ============================================================================
 * EL APORTE DE LOS REALTORS NPPM — etapa BP54
 * ============================================================================
 *
 *   node scripts/verificacion/nppm-piso.test.mjs
 *
 * Dos cosas, y la segunda es la que pidió el brief:
 *
 *   1. que las cuatro reglas hagan lo que dicen --sólo donde proyecta, sin
 *      dueño no suma, un vínculo viejo no suma, y manda lo fijado--;
 *   2. que NO HAYA UNA SEGUNDA COPIA de la derivación en el repo. Vivía adentro
 *      de `lib/outlook/loadData.ts`, y el perfil del Business Plan necesitaba
 *      el mismo número sin poder pedírselo --hay un ciclo de imports--. Si
 *      alguien la reescribe de aquel lado, los dos módulos vuelven a decir
 *      distinto y nada avisa. Esta prueba lo mide en vez de pedirlo.
 *
 * Es la misma forma que `gobierno-del-total.test.mjs` de OL41, por el mismo
 * motivo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
/*
 * ⚠ SE CARGA CON NODE PELADO, y por eso `nppmPiso.ts` importa
 * `../pipeline/aggregate.ts` CON la extensión: Node ESM la exige en un import
 * relativo. Medido -- sin ella, «Cannot find module». Lo habilita
 * `allowImportingTsExtensions` en `tsconfig.json`, que es seguro porque
 * `noEmit` es true; el porqué está escrito ahí.
 */
const { aportesPorPersona, proyeccionPorRealtor } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/outlook/nppmPiso.ts')).href);

/* 13 de las reglas + 2 de que no haya copias. */
const a = crearArnes({ minimo: 15 });
const MESES = ['2026-10', '2026-11', '2026-12'];

/* ── 1. La proyección se reparte POR BRANCH ──────────────────────────────── */
{
  const realtors = [
    { realtorCode: 'a', displayName: 'A', branchCode: '703', benchmark: 1 },
    { realtorCode: 'b', displayName: 'B', branchCode: '703', benchmark: 1 },
    { realtorCode: 'c', displayName: 'C', branchCode: '776', benchmark: 2 },
  ];
  const p = proyeccionPorRealtor(realtors, MESES);
  a.ck(p.get('a')['2026-10'] + p.get('b')['2026-10'] === 2,
    'las partes de un branch suman el total redondeado de ese branch (1+1=2)');
  a.ck(p.get('c')['2026-10'] === 2,
    '⚠ y el otro branch se reparte APARTE: el 776 da 2 sin importar lo del 703');
  /*
   * ⚠ EL CASO QUE JUSTIFICA EL REDONDEO POR BRANCH. Tres realtors de 0.33
   * suman 0.99 → 1, y ese 1 va a UNO de los tres. Si cada loader redondeara por
   * su cuenta, uno podría dar 0 a los tres y el otro 1 a uno: «casi iguales».
   */
  const tercios = [
    { realtorCode: 'x', displayName: 'X', branchCode: '733', benchmark: 0.33 },
    { realtorCode: 'y', displayName: 'Y', branchCode: '733', benchmark: 0.33 },
    { realtorCode: 'z', displayName: 'Z', branchCode: '733', benchmark: 0.33 },
  ];
  const t = proyeccionPorRealtor(tercios, MESES);
  const suma = ['x', 'y', 'z'].reduce((s, k) => s + t.get(k)['2026-10'], 0);
  a.ck(suma === 1, '⚠ tres de 0.33 dan UNO en total, no cero ni tres: ' + suma);
  a.ck([t.get('x'), t.get('y'), t.get('z')].filter((r) => r['2026-10'] === 1).length === 1,
    'y ese 1 le toca a exactamente uno');
}

/* ── 2. Las cuatro reglas ────────────────────────────────────────────────── */
const realtors = [
  { realtorCode: 'r1', displayName: 'Realtor Uno', branchCode: '703', benchmark: 2 },
  { realtorCode: 'r2', displayName: 'Realtor Dos', branchCode: '703', benchmark: 1 },
  { realtorCode: 'r3', displayName: 'Realtor Tres', branchCode: '776', benchmark: 3 },
];

{
  /* Regla 2: sin dueño no suma en ningún lado. */
  const res = aportesPorPersona({ realtors, duenos: [], fijados: {}, months: MESES });
  a.ck(res.size === 0, '⚠ sin dueño no suma en ningún lado: nadie recibe nada');
}
{
  /* El caso normal: dos realtors del 703, un dueño cada uno. */
  const duenos = [
    { realtorCode: 'r1', ownerEmployeeKey: 10, ownerPrimaryBranch: '703' },
    { realtorCode: 'r2', ownerEmployeeKey: 11, ownerPrimaryBranch: '703' },
  ];
  const res = aportesPorPersona({ realtors, duenos, fijados: {}, months: MESES });
  a.ck(res.get(10)?.length === 1 && res.get(11)?.length === 1,
    'cada dueño recibe a su realtor');
  a.ck(res.get(10)[0].byMonth['2026-10'] + res.get(11)[0].byMonth['2026-10'] === 3,
    'y las dos partes suman el total del branch (2+1=3)');
  a.ck(res.get(10)[0].fuente === 'projection', 'sin total fijado, la fuente es la proyección');
  a.ck(res.get(10)[0].displayName === 'Realtor Uno', 'y viaja el nombre, para la fila de detalle');
}
{
  /* Regla 3: el vínculo quedó en otro branch. */
  const duenos = [{ realtorCode: 'r1', ownerEmployeeKey: 10, ownerPrimaryBranch: '716' }];
  const res = aportesPorPersona({ realtors, duenos, fijados: {}, months: MESES });
  a.ck(res.size === 0,
    '⚠ un vínculo viejo NO suma: el realtor proyecta en el 703 y su dueño es del 716');
}
{
  /* Regla 1: un realtor que no está entre los que proyectan no aporta. */
  const duenos = [{ realtorCode: 'fantasma', ownerEmployeeKey: 10, ownerPrimaryBranch: '703' }];
  const res = aportesPorPersona({ realtors, duenos, fijados: {}, months: MESES });
  a.ck(res.size === 0, 'un dueño de un realtor que no proyecta hoy no recibe nada');
}
{
  /* Regla 4: manda lo fijado. */
  const duenos = [{ realtorCode: 'r1', ownerEmployeeKey: 10, ownerPrimaryBranch: '703' }];
  const fijados = { r1: { '2026-10': 9, '2026-11': 9, '2026-12': 9 } };
  const res = aportesPorPersona({ realtors, duenos, fijados, months: MESES });
  a.ck(res.get(10)[0].byMonth['2026-10'] === 9,
    '⚠ manda lo FIJADO sobre la proyección (9, no 2)');
  a.ck(res.get(10)[0].fuente === 'fixed', 'y la fuente lo dice, para que la pantalla lo pueda explicar');
}
{
  /* Un dueño con DOS realtors: el piso es la suma. */
  const duenos = [
    { realtorCode: 'r1', ownerEmployeeKey: 10, ownerPrimaryBranch: '703' },
    { realtorCode: 'r2', ownerEmployeeKey: 10, ownerPrimaryBranch: '703' },
  ];
  const res = aportesPorPersona({ realtors, duenos, fijados: {}, months: MESES });
  const piso = res.get(10).reduce((s, x) => s + (x.byMonth['2026-10'] ?? 0), 0);
  a.ck(res.get(10).length === 2 && piso === 3,
    'un dueño con dos realtors los recibe a los dos, y su piso es la suma (3)');
}
{
  /* Y que no se mute la entrada: el mismo `byMonth` fijado no se comparte. */
  const duenos = [{ realtorCode: 'r1', ownerEmployeeKey: 10, ownerPrimaryBranch: '703' }];
  const fijados = { r1: { '2026-10': 4 } };
  const res = aportesPorPersona({ realtors, duenos, fijados, months: MESES });
  res.get(10)[0].byMonth['2026-10'] = 99;
  a.ck(fijados.r1['2026-10'] === 4,
    '⚠ el resultado es una copia: tocarlo no le cambia el dato al que lo pasó');
}

/* ── 3. Que no haya una segunda copia de la derivación ───────────────────── */
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
 * ⚠ LA PRIMERA VERSIÓN DE ESTA GUARDA PREGUNTÓ POR LA FORMA Y NO POR EL
 * SIGNIFICADO, y por eso acusó al archivo equivocado. Buscaba
 * `ownerFueraDeBranch` cerca de un condicional, y eso está en la PANTALLA
 * --cuatro veces-- para dibujar la etiqueta «owner outside branch» y vaciar el
 * selector. Eso no es una segunda derivación: es el renderizado de lo que el
 * módulo ya decidió.
 *
 * Y mientras acusaba a la pantalla, la copia de verdad estaba en otro lado y
 * era mía: `nppmRealtorBudget` seguía repartiendo con su propio
 * `apportionByWeight` sobre los benchmarks de los realtors, o sea dos
 * implementaciones del MISMO reparto -- la que arma la fila del realtor y la
 * que arma el piso. Las dos correctas el día que se escribieron.
 *
 * Lo que la guarda pregunta ahora es eso: repartir un total entre benchmarks de
 * realtors es la decisión, y tiene que estar en un solo archivo.
 */
const copias = fuentes.filter((ruta) => {
  if (ruta.endsWith(join('lib', 'outlook', 'nppmPiso.ts'))) return false;
  return readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .some((l) => /apportionByWeight\(/.test(l) && /realtors?\b|benchmark/.test(l));
});
console.log('archivos que reparten entre benchmarks de realtors, fuera de nppmPiso.ts: ' +
  JSON.stringify(copias.map((p) => p.slice(RAIZ.length + 1))));
a.ck(copias.length === 0,
  '⚠ el reparto entre realtors vive en UN solo archivo: ' +
    JSON.stringify(copias.map((p) => p.slice(RAIZ.length + 1))));
a.ck(fuentes.length > 100, 'y se recorrió el repo de verdad: ' + fuentes.length + ' archivos');

process.exitCode = a.resumen();
