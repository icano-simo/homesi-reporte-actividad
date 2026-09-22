/*
 * ============================================================================
 * PRUEBA DEL INSTALADOR — que DESENGANCHE, y que no se lleve nada ajeno
 * ============================================================================
 *
 *   node scripts/verificacion/instalar-guardas.test.mjs
 *   npm run verificar:instalador
 *
 * ⚠ LAS DOS RAMAS, Y ACA LA SEGUNDA ES LA QUE IMPORTA MAS QUE NUNCA: un
 * reconciliador que borra un hook ajeno es peor que uno que no desengancha
 * nada, porque se lleva puesto algo que el usuario puso a mano y no avisa de
 * un modo que se entienda. Por eso hay mas casos de «esto NO se toca» que de
 * «esto se saca».
 *
 * Y las dos funciones que se prueban son puras a proposito: deciden la baja
 * sin escribir un `settings.json` de verdad.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { reconciliar, mismoContenido, GUARDAS } = await import(
  pathToFileURL(resolve(AQUI, 'instalar-guardas.mjs')).href
);
const { crearArnes } = await import(pathToFileURL(resolve(AQUI, 'guardas.mjs')).href);

const a = crearArnes({ minimo: 19 });

const DIR = 'C:\\Users\\alguien\\.claude\\hooks';
const cmd = (archivo) => 'node "C:/Users/alguien/.claude/hooks/' + archivo + '"';
const entrada = (matcher, ...comandos) => ({
  matcher,
  hooks: comandos.map((c) => ({ type: 'command', command: c })),
});
const VIVAS = ['sin-texto-al-shell.mjs', 'esperar-al-dato.mjs'];

/* ── 1. La baja, que es lo que esta version agrega ───────────────────────── */
{
  /* El caso real: una guarda revertida. Su archivo ya no esta en `GUARDAS`,
     pero el hook sigue enganchado apuntando a la copia. */
  const pre = [
    entrada('Bash', cmd('sin-texto-al-shell.mjs')),
    entrada('Write|Edit', cmd('una-guarda-revertida.mjs')),
  ];
  const r = reconciliar(pre, VIVAS, DIR);
  a.ck(r.desenganchadas.length === 1, '⚠ desengancha la guarda que ya no esta en la lista');
  a.ck(r.desenganchadas[0]?.archivo === 'una-guarda-revertida.mjs', 'y dice cual: ' + r.desenganchadas[0]?.archivo);
  a.ck(r.desenganchadas[0]?.matcher === 'Write|Edit', 'y sobre que herramienta corria, que es lo que deja de estar cubierto');
  a.ck(r.pre.length === 1, 'y la entrada entera se va, no queda un `hooks: []` huerfano');
  a.ck(r.pre[0]?.hooks?.[0]?.command === cmd('sin-texto-al-shell.mjs'), 'y la que sigue viva se queda');
}
{
  /* Una entrada con DOS hooks, uno vivo y uno muerto: se va el muerto, no la
     entrada. Si se fuera entera, desenganchar una guarda apagaria otra. */
  const pre = [entrada('Bash', cmd('sin-texto-al-shell.mjs'), cmd('vieja.mjs'))];
  const r = reconciliar(pre, VIVAS, DIR);
  a.ck(r.pre.length === 1 && r.pre[0].hooks.length === 1,
    'de una entrada con dos hooks se va solo el muerto');
  a.ck(r.pre[0].hooks[0].command === cmd('sin-texto-al-shell.mjs'), 'y el que queda es el vivo');
}
{
  /* La lista real del repo no tiene bajas pendientes contra si misma. */
  const pre = GUARDAS.map((g) => entrada(g.matcher, cmd(g.archivo)));
  const r = reconciliar(pre, GUARDAS.map((g) => g.archivo), DIR);
  a.ck(r.desenganchadas.length === 0, 'con la lista de GUARDAS al dia no desengancha nada');
  a.ck(r.pre.length === GUARDAS.length, 'y deja las ' + GUARDAS.length + ' entradas como estaban');
}

/* ── 2. Lo que NO se toca, que es la mitad que decide si sobrevive ───────── */
{
  /* Un hook del usuario, fuera de nuestro directorio. Ni se mira. */
  const ajeno = 'node "C:/Users/alguien/scripts/mi-hook-propio.mjs"';
  const r = reconciliar([entrada('Bash', ajeno)], VIVAS, DIR);
  a.ck(r.desenganchadas.length === 0, '⚠ un hook FUERA de ~/.claude/hooks no se toca aunque no este en la lista');
  a.ck(r.pre.length === 1 && r.pre[0].hooks[0].command === ajeno, 'y queda tal cual estaba');
}
{
  /* Uno que se llama igual que una guarda pero vive en otro lado: tampoco. */
  const ajeno = 'node "D:/otro/lado/esperar-al-dato.mjs"';
  const r = reconciliar([entrada('Write', ajeno)], [], DIR);
  a.ck(r.desenganchadas.length === 0, 'ni uno con el mismo nombre en otro directorio');
}
{
  /* Un comando nuestro que ademas nombra otro `.mjs` como argumento: el
     archivo se lee DESPUES del directorio, no en cualquier parte de la linea. */
  const r = reconciliar([entrada('Bash', cmd('sin-texto-al-shell.mjs') + ' otra-cosa.mjs')], VIVAS, DIR);
  a.ck(r.desenganchadas.length === 0,
    'un `.mjs` como ARGUMENTO no confunde a la lectura del nombre');
}
{
  /* Y lo que no se entiende, no se toca: es la misma decision que el `catch`
     de las guardas, que sale con 0 cuando no entiende su entrada. */
  const raro = 'node "C:/Users/alguien/.claude/hooks/"';
  const r = reconciliar([entrada('Bash', raro), { matcher: 'X' }, null], VIVAS, DIR);
  a.ck(r.desenganchadas.length === 0, 'un comando que no nombra un archivo no se desengancha');
  a.ck(r.pre.length === 1, 'y una entrada sin `hooks` no rompe ni se cuenta');
}
{
  /* Windows: la misma ruta con barras al reves y otra caja es la misma ruta. */
  const r = reconciliar(
    [entrada('Bash', 'node "c:\\users\\alguien\\.claude\\hooks\\vieja.mjs"')],
    VIVAS, DIR
  );
  a.ck(r.desenganchadas.length === 1,
    'la ruta se compara sin distinguir barra ni mayusculas, que es como las trata Windows');
}

/* ── 3. La comparacion de contenido, y el ruido que le sacamos ───────────── */
{
  const lf = 'const a = 1;\nconst b = 2;\n';
  const crlf = 'const a = 1;\r\nconst b = 2;\r\n';
  a.ck(mismoContenido(lf, crlf),
    '⚠ LF y CRLF del mismo texto son la MISMA copia: si no, cada checkout grita «DISTINTA»');
  a.ck(!mismoContenido(lf, 'const a = 1;\nconst b = 3;\n'),
    'y una diferencia de verdad sigue siendo distinta, que es lo que el aviso tiene que decir');
  a.ck(!mismoContenido(null, lf), 'y una copia que no existe no es igual a nada');
}

process.exitCode = a.resumen();
