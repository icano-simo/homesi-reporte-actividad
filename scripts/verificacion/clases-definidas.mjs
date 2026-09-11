/**
 * ============================================================================
 * LAS CLASES QUE EL JSX PIDE, ¿EXISTEN EN ALGUNA HOJA?
 * ============================================================================
 *
 * Etapa RV3 — ARCHIVO NUEVO.
 *
 *     node scripts/verificacion/clases-definidas.mjs
 *     npm run verificar:clases
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ ES UN SCRIPT Y NO UNA NOTA
 * ---------------------------------------------------------------------------
 * `AGENTS.md` lo dice de la sexta guarda y vale igual acá: **una herramienta que
 * hay que recordar que existe se usa igual que una nota.** `exigirDefinidos`
 * está en `guardas.mjs` desde esta etapa, y si sólo se llamara desde el script
 * de verificación de quien se acuerde, el próximo `bp-hint` pasa igual.
 *
 * Así que esto se corre solo. `bp-hint` estuvo siete usos sin regla; el mismo
 * chequeo encontró `rv-intake__body` en su primera corrida.
 *
 * ---------------------------------------------------------------------------
 * ⚠ QUÉ NO HACE, dicho para que nadie le pida más
 * ---------------------------------------------------------------------------
 * No parsea CSS ni JSX. Busca texto, porque la pregunta no es «está bien
 * escrito» sino «existe en algún lado». Eso trae dos límites conocidos:
 *
 *   · una clase construida por partes --`'bp-' + tipo`-- no se ve. Las que se
 *     arman con un literal completo entre comillas sí.
 *   · una clase definida sólo dentro de un `@media` cuenta como definida, y
 *     está bien: existe.
 *
 * ⚠ Y ESCRIBÍ ACÁ QUE NO DABA FALSOS POSITIVOS. Daba: la primera versión leía
 * cualquier literal `'ol-…'` del archivo y reportó `.ol-t-`, que es el prefijo
 * de un `id={'ol-t-' + m}`. Se corrigió leyendo sólo dentro de `className={…}`,
 * y la afirmación se corrigió también — que es la mitad que importa: una nota
 * que promete más de lo que el código hace envejece peor que no tenerla.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { exigirDefinidos } from './guardas.mjs';

const RAIZ = process.argv[2] ?? process.cwd();

/** Todo lo que termine en una de las extensiones, bajo `dir`. */
function archivos(dir, exts, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, exts, acc);
    else if (exts.some((e) => n.endsWith(e))) acc.push(p);
  }
  return acc;
}

/*
 * TODAS las hojas del proyecto, concatenadas. Y todas y no las del módulo que
 * se está mirando: una clase puede estar definida en la hoja de otro módulo a
 * propósito --`bp-btn` la usan las cuatro pantallas de la revisión-- y eso no
 * es un problema, es reuso.
 */
const hojas = archivos(join(RAIZ, 'app'), ['.css'])
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

/*
 * ⚠ SÓLO LOS `className` CON UN LITERAL COMPLETO. Un `className={x ? 'a' : 'b'}`
 * se lee por el segundo patrón; un `'bp-' + tipo` no se lee y no se puede.
 */
const fuentes = [
  ...archivos(join(RAIZ, 'app'), ['.tsx']),
  ...archivos(join(RAIZ, 'components'), ['.tsx']),
];

/*
 * ⚠ LAS DOS RESTRICCIONES A LA VEZ, y llegar acá costó dos falsos positivos
 * míos sobre archivos que estaban bien:
 *
 *   1ª versión: cualquier literal `'bp-…'` / `'ol-…'` del archivo. Reportó
 *      `.ol-t-`, que es el prefijo de un `id={'ol-t-' + m}`. Demasiado amplia
 *      en QUÉ PARTE del archivo mira.
 *   2ª versión: cualquier literal dentro de un `className={…}`. Reportó `.sm`,
 *      `.month`, `.core`, `.healthy`, `.All` -- que son OPERANDOS de las
 *      comparaciones que eligen la clase, no clases. Demasiado amplia en QUÉ
 *      LITERALES toma.
 *
 * La correcta es la intersección: dentro de un `className` Y con forma de clase
 * de este proyecto. Ninguna de las dos alcanza sola.
 */
const pareceClase = (c) =>
  /^(?:bp|rv|ol|hub)-[a-z0-9_-]+$/.test(c) || /^(?:is|has)-[a-z0-9-]+$/.test(c);

const pedidas = new Map(); /* clase -> primer archivo que la pide */
for (const p of fuentes) {
  const texto = readFileSync(p, 'utf8');
  const donde = relative(RAIZ, p).replace(/\\/g, '/');
  const anotar = (c) => {
    if (!pedidas.has(c)) pedidas.set(c, donde);
  };
  for (const m of texto.matchAll(/className="([^"{}]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) anotar(c);
  }
  /*
   * Y las que se arman concatenando: `className={'rv-panel' + (x ? ' is-on' : '')}`.
   *
   * ⚠ SÓLO DENTRO DE UN `className={…}`, y esto es una corrección: la primera
   * versión barría CUALQUIER literal `'bp-…'` / `'ol-…'` del archivo, y reportó
   * `.ol-t-` como clase sin regla. No es una clase: es `id={'ol-t-' + m}`, el
   * prefijo de un identificador. Un falso positivo mío, en la primera corrida,
   * sobre un archivo que estaba bien.
   *
   * Lo que queda como límite conocido, y no se puede arreglar leyendo texto: un
   * nombre armado por partes --`'bp-' + tipo`-- no se ve. Se ven los literales
   * completos.
   */
  for (const m of texto.matchAll(/className=\{([^}]*)\}/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) {
      for (const c of q[1].split(/\s+/)) if (c && pareceClase(c)) anotar(c);
    }
  }
}

const lista = [...pedidas.keys()].sort();
console.log('clases pedidas por el JSX: ' + lista.length);
console.log('hojas leídas: ' + archivos(join(RAIZ, 'app'), ['.css']).length);

try {
  const n = exigirDefinidos(lista, hojas, {
    prefijo: '.',
    que: 'clases de CSS',
    dondeDice: 'ninguna hoja de `app/`',
  });
  console.log('\nSIN FALLAS (' + n + ' clases, todas con regla)');
  process.exit(0);
} catch (err) {
  console.log('\n' + err.message);
  /* Y de dónde sale cada una, que es lo que hace falta para arreglarlo. */
  const faltan = lista.filter((c) => !hojas.includes('.' + c));
  console.log('\nquién las pide:');
  for (const c of faltan) console.log('  .' + c + '   ' + pedidas.get(c));
  process.exit(1);
}
