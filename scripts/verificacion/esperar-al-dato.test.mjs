/*
 * ============================================================================
 * PRUEBA DE LA GUARDA `esperar-al-dato`
 * ============================================================================
 *
 *   node scripts/verificacion/esperar-al-dato.test.mjs
 *   npm run verificar:espera
 *
 * ⚠ LAS DOS RAMAS, Y LA SEGUNDA ES LA QUE DECIDE SI SOBREVIVE.
 *
 * Que atrape el caso real es la mitad fácil. La otra mitad --que DEJE PASAR lo
 * legítimo-- es la que decide si alguien la desengancha, y desengancharla se
 * lleva también lo que sí cubría. Por eso hay más casos de «esto tiene que
 * pasar» que de «esto tiene que frenar».
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { decidir } = await import(pathToFileURL(resolve(AQUI, 'esperar-al-dato.mjs')).href);
const { crearArnes } = await import(pathToFileURL(resolve(AQUI, 'guardas.mjs')).href);

const a = crearArnes({ minimo: 17 });
const RUTA = 'C:/tmp/scratchpad/sonda.mjs';

/* ── 1. Lo que TIENE que frenar ──────────────────────────────────────────── */
{
  /* El caso real, tal cual estaba escrito. */
  const sonda = [
    "import { crearArnes } from '../repo/scripts/verificacion/guardas.mjs';",
    "await page.waitForFunction(() => document.querySelector('tr.ol-total') !== null, null, { timeout: 300000 });",
    'await page.waitForTimeout(700);',
  ].join('\n');
  const r = decidir(RUTA, sonda);
  a.ck(r !== null, '⚠ frena el caso real: importa `guardas.mjs` y espera a mano igual');
  a.ck(r !== null && /esperarDato/.test(r.hacer), 'y el mensaje dice qué usar en su lugar');
  a.ck(r !== null && /waitForTimeout` NO esta bloqueado/.test(r.hacer),
    'y aclara que `waitForTimeout` no está bloqueado, para que nadie lo saque de más');
}
{
  /* Con `import(...)` dinámico, que es como lo cargan las sondas de este repo. */
  const sonda = [
    "const { crearArnes } = await import(pathToFileURL(RAIZ + '/scripts/verificacion/guardas.mjs').href);",
    'await p2.waitForFunction(() => document.querySelector("tr.ol-total") !== null);',
  ].join('\n');
  a.ck(decidir(RUTA, sonda) !== null,
    'también con `import()` dinámico y otro nombre de página (`p2`)');
}

/* ── 2. Lo que NO tiene que frenar — la mitad que decide ──────────────────── */
{
  /* `waitForTimeout` solo: legítimo para dejar asentar un clic. */
  const sonda = [
    "import { crearArnes } from '../guardas.mjs';",
    'await page.click(".grp");',
    'await page.waitForTimeout(600);',
  ].join('\n');
  a.ck(decidir(RUTA, sonda) === null,
    '⚠ NO frena `waitForTimeout` solo: se usa para dejar asentar un clic y no hay con qué reemplazarlo');
}
{
  /* La sonda que YA usa `esperarDato`: es el caso bueno. */
  const sonda = [
    "import { crearArnes, esperarDato } from '../guardas.mjs';",
    "await esperarDato(page, 'la fila del branch', () => document.querySelector('td.lbl')?.textContent ?? false);",
  ].join('\n');
  a.ck(decidir(RUTA, sonda) === null, 'NO frena a la que ya usa `esperarDato`');
}
{
  /* Un archivo que NO importa `guardas.mjs`: el LÍMITE declarado. */
  const sonda = [
    "import { chromium } from 'playwright-core';",
    'await page.waitForFunction(() => document.title !== "");',
  ].join('\n');
  a.ck(decidir(RUTA, sonda) === null,
    '⚠ NO frena un archivo sin `guardas.mjs`: es el límite, y estirarlo sería una regla sobre la forma');
}
{
  /* `guardas.mjs` mismo, donde `esperarDato` está implementada. */
  const impl = [
    'export async function esperarDato(page, descripcion, predicado, opts = {}) {',
    '  handle = await page.waitForFunction(predicado, arg, { timeout });',
    '}',
    "import x from './guardas.mjs';",
  ].join('\n');
  a.ck(decidir('/repo/scripts/verificacion/guardas.mjs', impl) === null,
    'NO se frena a sí misma: `esperarDato` se implementa con `waitForFunction`');
  a.ck(decidir('C:\\repo\\scripts\\verificacion\\guardas.mjs', impl) === null,
    'y tampoco con separadores de Windows');
}
{
  /* Prosa que MENCIONA la palabra: un comentario, una nota, este archivo. */
  const nota = [
    "import { crearArnes } from '../guardas.mjs';",
    '/* Antes esto usaba page.waitForFunction y por eso fallaba. Ahora usa esperarDato. */',
  ].join('\n');
  a.ck(decidir(RUTA, nota) === null,
    '⚠ NO frena una MENCIÓN sin llamada: `page.waitForFunction` nombrado en prosa no lleva paréntesis');
}
{
  /* Contenido vacío o que no es texto: nada que decidir. */
  a.ck(decidir(RUTA, '') === null, 'contenido vacío no frena');
  a.ck(decidir(RUTA, undefined) === null, 'y algo que no es texto tampoco');
  a.ck(decidir(undefined, "import '../guardas.mjs';\npage.waitForFunction(") !== null,
    'y sin ruta igual decide por el contenido: un `Edit` puede no traerla');
}

/* ── 2b. El falso positivo que dio en su PRIMER uso real ─────────────────── */
{
  /*
   * ⚠ ENGANCHADA, LO PRIMERO QUE BLOQUEÓ FUE LA SONDA QUE VENÍA A PROBARLA: un
   * archivo con `guardas.mjs` y la espera a mano dentro de CADENAS, como datos.
   * Es `exigirAusente` un nivel más allá -- allá el patrón aparece a propósito
   * en los comentarios, acá en las cadenas de fixture de una prueba.
   */
  const sondaSobreLaGuarda = [
    "import { spawn } from 'node:child_process';",
    'const casos = [',
    '  { entrada: { tool_input: { content:',
    '      "import { crearArnes } from \'../guardas.mjs\';" +',
    '      "await page.waitForFunction(() => true);" } } },',
    '];',
  ].join('\n');
  a.ck(decidir('C:/tmp/probar-hook.mjs', sondaSobreLaGuarda) === null,
    '⚠ NO frena un archivo que sólo menciona el patrón en cadenas de fixture');
}
{
  /* Y una llamada DE VERDAD sigue frenando aunque haya fixtures alrededor. */
  const mixto =
    "import { crearArnes } from '../guardas.mjs';\n" +
    '  "await page.waitForFunction(soy un fixture)",\n' +
    'await page.waitForFunction(() => document.title !== "");\n';
  a.ck(decidir('C:/tmp/sonda.mjs', mixto) !== null,
    'y una llamada de verdad frena igual, con fixtures en el mismo archivo');
}

/* ── 3. Y que el mensaje sirva ───────────────────────────────────────────── */
{
  const r = decidir(RUTA, "import '../guardas.mjs';\npage.waitForFunction(() => true);");
  a.ck(r !== null && r.porque.includes('fila undefined'),
    'el mensaje trae el caso real que la motivó, no una regla abstracta');
  a.ck(r !== null && r.nombre.length < 80, 'y el nombre entra en una línea');
}

process.exitCode = a.resumen();
