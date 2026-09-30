/*
 * ============================================================================
 * PRUEBA DE LA GUARDA DEL CONTEO SOBRE EL CODIGO
 * ============================================================================
 *
 *   node scripts/verificacion/contar-en-el-codigo.test.mjs
 *   npm run verificar:conteo
 *
 * ⚠ EL PRIMER CASO ES EL REAL, y sale del historial y no de mi cabeza: el
 * `grep -c "ALTO_BARRA = 42"` sobre `lib/review/useReviewTarget.ts` devolvio 1
 * sobre el comentario que explica que la constante se fue. Se corre contra el
 * archivo de VERDAD, tal como quedo mergeado.
 *
 * Y la otra mitad, la que decide si la guarda sobrevive: lo que tiene que DEJAR
 * PASAR. Un conteo cuyos dos numeros coinciden no confunde a nadie.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearArnes, sinComentarios as sinComentariosDelRepo } from './guardas.mjs';
import { decidir, leerConteo, sinComentarios } from './contar-en-el-codigo.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const a = crearArnes({ minimo: 17 });

/* ── 1. EL CASO REAL, contra el archivo mergeado ─────────────────────────── */
{
  const archivo = resolve(RAIZ, 'lib/review/useReviewTarget.ts');
  const r = decidir('ALTO_BARRA = 42', archivo);
  a.ck(r !== null,
    '⚠ atrapa el `grep -c "ALTO_BARRA = 42"` que me devolvio 1 sobre el comentario');
  a.ck(/en 1 linea\(s\) del ARCHIVO y en 0 del CODIGO/.test(r?.porque ?? ''),
    'y dice LOS DOS numeros: 1 en el archivo, 0 en el codigo — ' +
    (r?.porque ?? '').split('\n')[0]);
  a.ck(/exigirAusente/.test(r?.hacer ?? ''),
    'y nombra la herramienta que lo hace bien, que existia y no use');
}

/* ── 2. El comando, leido como lo escribe uno ────────────────────────────── */
{
  const c = leerConteo('grep -c "ALTO_BARRA = 42" lib/review/useReviewTarget.ts');
  a.ck(c !== null && c.patron === 'ALTO_BARRA = 42' && /useReviewTarget\.ts$/.test(c.ruta),
    'lee el patron y el archivo de un `grep -c` con comillas: ' + JSON.stringify(c));
  a.ck(leerConteo("grep -cn 'foo' a.ts") !== null, 'y con las banderas juntas (`-cn`)');
  a.ck(leerConteo('rg --count foo a.ts') !== null, 'y `rg --count`');
  a.ck(leerConteo('grep -n "foo" a.ts') === null,
    '⚠ y NO mira un `grep -n`: sin conteo no hay numero que leer como conclusion');
  a.ck(leerConteo('cat a.ts | grep -c foo') === null,
    '⚠ ni un `grep -c` despues de un pipe: ahi no lee un archivo');
  a.ck(leerConteo('grep -c foo a.ts b.ts') === null,
    'ni con dos archivos: el numero ya viene separado por archivo');
}

/* ── 3. LO QUE TIENE QUE PASAR ───────────────────────────────────────────── */
{
  const dir = mkdtempSync(join(tmpdir(), 'rv-conteo-'));
  const escribir = (n, s) => { const p = join(dir, n); writeFileSync(p, s, 'utf8'); return p; };
  try {
    /* Los dos numeros coinciden: no hay nada que confundir. */
    const igual = escribir('igual.ts', 'const x = 1;\nconst y = x + 1;\n');
    a.ck(decidir('const', igual) === null,
      '⚠ deja pasar un conteo cuyos dos numeros coinciden: no engaña a nadie');

    /* El nombre esta en el codigo Y en un comentario: el numero cambia, frena. */
    const mixto = escribir('mixto.ts', '/* usa FOO a proposito */\nconst FOO = 1;\n');
    a.ck(decidir('FOO', mixto) !== null,
      'frena cuando el patron esta en el codigo Y en un comentario');

    /* Una extension que no sabe leer. */
    const otro = escribir('cosa.txt', '// FOO\n');
    a.ck(decidir('FOO', otro) === null, 'y no opina sobre una extension que no sabe leer');

    /* Un patron que no compila como regex. */
    const ts = escribir('mal.ts', '// FOO(\nconst a = 1;\n');
    a.ck(decidir('FOO(', ts) === null,
      '⚠ ni sobre un patron que no compila: contar sin poder contar seria peor');

    /* Un archivo que no existe. */
    a.ck(decidir('FOO', join(dir, 'no-existe.ts')) === null, 'ni sobre un archivo que no esta');

    /* CSS: los `//` no son comentarios ahi. */
    const css = escribir('a.css', '/* .foo se fue */\n.bar { color: red; }\n');
    a.ck(decidir('foo', css) !== null, 'en CSS saca los bloques `/* */`');

    /* SQL: los `--`. */
    const sql = escribir('a.sql', '-- ya no se usa service_role\nselect 1;\n');
    a.ck(decidir('service_role', sql) !== null, 'y en SQL los `--`');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ── 4. La copia de `sinComentarios` no se separo de la del repo ─────────── */
{
  /*
   * ⚠ ESTA ES LA ASERCION QUE JUSTIFICA LA COPIA. El hook corre fuera del repo,
   * donde `guardas.mjs` no existe, asi que la copia es necesaria -- y «dos
   * copias de la misma decision» solo es tolerable si algo comprueba que no
   * divergieron. Esto es ese algo.
   */
  const casos = [
    ['ts', '/* a */\nconst x = 1; // b\n'],
    ['css', '/* a */\n.x { color: red; }\n'],
    ['sql', '-- a\nselect 1; /* b */\n'],
    ['py', '# a\nx = 1\n'],
  ];
  const distintos = casos.filter(([l, s]) => sinComentarios(s, l) !== sinComentariosDelRepo(s, l));
  a.ck(distintos.length === 0,
    '⚠ la copia de `sinComentarios` sigue dando lo mismo que la de `guardas.mjs`' +
    (distintos.length ? ' — difieren en: ' + distintos.map((d) => d[0]).join(', ') : ''));
}

process.exitCode = a.resumen();
