import { pathToFileURL } from 'node:url';
import { readFileSync, statSync } from 'node:fs';

/*
 * ============================================================================
 * UN CONTEO SOBRE EL ARCHIVO NO ES UN CONTEO SOBRE EL CÓDIGO
 * ============================================================================
 *
 * Se engancha como hook `PreToolUse` de `Bash` y de `Grep`, y frena un conteo
 * cuyo resultado CAMBIA al sacar los comentarios -- que es exactamente cuando
 * ese número engaña.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ, Y POR QUÉ LA HERRAMIENTA NO ALCANZÓ
 * ---------------------------------------------------------------------------
 * `exigirAusente` existe desde hace etapas, está en `guardas.mjs`, está
 * mergeada, y su cabecera cuenta SIETE veces que una comprobación buscó un
 * nombre prohibido sobre el TEXTO y lo encontró en el comentario que explica
 * por qué está prohibido.
 *
 * La octava la cometí con la herramienta ya disponible y escrita por mí: para
 * confirmar que un arreglo seguía puesto corrí
 *
 *     grep -c "ALTO_BARRA = 42" lib/review/useReviewTarget.ts     ->  1
 *
 * y ese 1 era el COMENTARIO que explica que la constante se fue. Miré el
 * archivo en vez del código, que es literalmente lo que esa función existe
 * para no hacer.
 *
 * ⚠ Y ESO DICE ALGO QUE LAS OTRAS SIETE NO DECÍAN. Con el shell, con la espera
 * y con el `service_role`, la respuesta fue una guarda que bloquea porque la
 * regla escrita no alcanzaba. Acá la HERRAMIENTA ya existía y tampoco alcanzó:
 *
 *   > Una herramienta que hay que acordarse de usar se usa igual que una nota.
 *
 * Así que la misma respuesta, un nivel más abajo: en vez de recordar usar
 * `exigirAusente`, que el conteo que engaña no se pueda leer sin verlo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL PREDICADO ES SOBRE LA RESPUESTA, NO SOBRE LA FORMA DEL COMANDO
 * ---------------------------------------------------------------------------
 * No bloquea «un grep con -c». Bloquea un conteo cuyo resultado sobre el
 * archivo DIFIERE del resultado sobre el código. Si los dos números coinciden
 * --el caso normal-- no pasa nada, porque no hay nada que confundir.
 *
 * Y cuando bloquea, DA LOS DOS NÚMEROS. Eso es deliberado: el bloqueo contesta
 * la pregunta que se estaba haciendo, en las dos lecturas posibles. Una guarda
 * que sólo dice «no» obliga a buscarle la vuelta; ésta deja a quien la leyó
 * sabiendo más que antes, y por eso no es la que alguien desengancha.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LOS LÍMITES, Y EL ÚLTIMO ES EL QUE IMPORTA
 * ---------------------------------------------------------------------------
 * 1. Sólo `grep`/`rg` con un flag de conteo sobre UN archivo que exista, y la
 *    herramienta `Grep` con `output_mode: "count"`. Ni `git grep`, ni varios
 *    archivos, ni un directorio.
 *
 * 2. El patrón se interpreta como expresión regular de JavaScript. Un patrón
 *    de `grep` que signifique otra cosa daría otro número; si no compila, no
 *    bloquea.
 *
 * 3. Sólo entiende comentarios de `ts/tsx/js/mjs/jsx`, `css`, `sql` y `py`.
 *    Otra extensión pasa sin mirar.
 *
 * 4. ⚠ Y NO CUBRE LEER EL ARCHIVO Y CONTAR A OJO. Nada puede: la confusión no
 *    está en el comando sino en la conclusión que alguien saca. Acá se acaba lo
 *    que una guarda puede hacer, y lo que queda es el hábito de preguntarse
 *    qué parte del archivo contestó.
 */

/** Los lenguajes cuyos comentarios se saben sacar, por extensión. */
const LENGUAJE = {
  ts: 'ts', tsx: 'ts', js: 'ts', mjs: 'ts', cjs: 'ts', jsx: 'ts',
  css: 'css', sql: 'sql', py: 'py',
};

/**
 * Saca comentarios de bloque y de línea.
 *
 * ⚠ ES UNA COPIA DE `sinComentarios` DE `guardas.mjs`, y eso normalmente sería
 * la segunda copia de la misma decisión. Acá es deliberado y tiene una razón
 * concreta: este archivo se copia a `~/.claude/hooks/` y corre FUERA del repo,
 * donde `guardas.mjs` no existe. Es la misma razón por la que las otras tres
 * guardas de hook tampoco importan nada.
 *
 * Lo que sí hay que saber: si una cambia, la otra no se entera. Por eso su
 * prueba compara las dos sobre el mismo texto -- ver `contar-en-el-codigo.test.mjs`.
 */
export function sinComentarios(texto, lenguaje = 'ts') {
  let s = texto;
  if (lenguaje === 'sql') {
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    return s.replace(/--[^\n]*/g, '');
  }
  if (lenguaje === 'py') return s.replace(/#[^\n]*/g, '');
  s = s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  if (lenguaje !== 'css') s = s.replace(/\/\/[^\n]*/g, '');
  return s;
}

/** Cuántas LÍNEAS matchean, que es lo que `grep -c` cuenta. */
function lineasQueMatchean(texto, re) {
  let n = 0;
  for (const l of texto.split(/\r?\n/)) {
    re.lastIndex = 0;
    if (re.test(l)) n += 1;
  }
  return n;
}

/** Parte una línea de shell respetando comillas. */
function partir(cmd) {
  const out = [];
  let act = '';
  let comilla = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (comilla !== null) {
      if (c === comilla) comilla = null;
      else act += c;
      continue;
    }
    if (c === '"' || c === "'") { comilla = c; continue; }
    if (/\s/.test(c)) { if (act !== '') { out.push(act); act = ''; } continue; }
    act += c;
  }
  if (act !== '') out.push(act);
  return out;
}

/**
 * ¿Este comando es un conteo de `grep`/`rg` sobre un archivo?
 *
 * Devuelve `{ patron, ruta }` o `null`. Sólo mira el ÚLTIMO segmento de una
 * tubería o cadena: un `grep -c` en el medio de un pipe cuenta sobre otra cosa
 * y no sobre un archivo.
 */
export function leerConteo(comando) {
  if (typeof comando !== 'string' || comando.trim() === '') return null;
  /* Un pipe o un `&&` cambian la entrada: sólo se mira el último tramo, que es
     donde un `grep <patron> <archivo>` lee de verdad un archivo. */
  const tramo = comando.split(/\|\||&&|;|\|/).pop();
  const t = partir(tramo.trim());
  if (t.length < 3) return null;
  const i = t.findIndex((x) => x === 'grep' || x === 'rg' || x === 'egrep');
  if (i < 0) return null;
  const resto = t.slice(i + 1);
  const banderas = [];
  let k = 0;
  while (k < resto.length && resto[k].startsWith('-') && resto[k] !== '-') {
    banderas.push(resto[k]);
    k += 1;
  }
  /* Sólo los conteos: es el número lo que se lee como una conclusión. */
  const cuenta = banderas.some((b) => b === '--count' || (/^-[a-zA-Z]+$/.test(b) && b.includes('c')));
  if (!cuenta) return null;
  const patron = resto[k];
  const rutas = resto.slice(k + 1).filter((x) => !x.startsWith('-'));
  if (patron === undefined || rutas.length !== 1) return null;
  return { patron, ruta: rutas[0] };
}

/**
 * ¿El conteo cambia al sacar los comentarios?
 *
 * @returns {{ nombre: string, porque: string, hacer: string } | null}
 */
export function decidir(patron, ruta) {
  if (typeof patron !== 'string' || typeof ruta !== 'string') return null;
  const ext = (ruta.split('.').pop() ?? '').toLowerCase();
  const lenguaje = LENGUAJE[ext];
  if (lenguaje === undefined) return null;
  let texto;
  try {
    if (!statSync(ruta).isFile()) return null;
    texto = readFileSync(ruta, 'utf8');
  } catch {
    /* No existe o no se puede leer: no es asunto de esta guarda. */
    return null;
  }
  let re;
  try {
    re = new RegExp(patron);
  } catch {
    /* Un patrón que no compila como regex de JS: no se puede contar sin
       mentir, así que no se opina. */
    return null;
  }
  const enElArchivo = lineasQueMatchean(texto, re);
  const enElCodigo = lineasQueMatchean(sinComentarios(texto, lenguaje), re);
  if (enElArchivo === enElCodigo) return null;
  return {
    nombre: 'un conteo que cambia al sacar los comentarios',
    porque:
      'en `' + ruta + '`, el patron `' + patron + '` aparece en ' + enElArchivo +
      ' linea(s) del ARCHIVO y en ' + enElCodigo + ' del CODIGO.\n' +
      'La diferencia son comentarios, que es justo donde un nombre aparece A PROPOSITO -- para\n' +
      'explicar por que ya NO esta. Este repo lleva siete casos de esa confusion, y el octavo fue\n' +
      'un `grep -c "ALTO_BARRA = 42"` que devolvio 1 sobre el comentario que decia que la\n' +
      'constante se habia ido.',
    hacer:
      'ya tenes la respuesta: ' + enElCodigo + ' en el codigo, ' + enElArchivo + ' contando los\n' +
      'comentarios. Si lo que hace falta es una comprobacion y no una mirada, usa\n' +
      '`exigirAusente(texto, [...], { lenguaje })` de `scripts/verificacion/guardas.mjs`, que mira\n' +
      'el codigo por definicion.',
  };
}

/* ── El hook ────────────────────────────────────────────────────────────────
   Corre sólo como entrypoint, así que la prueba puede importar `decidir` sin
   que esto lea stdin ni termine el proceso. */
const comoEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (comoEntrypoint) {
  let crudo = '';
  process.stdin.setEncoding('utf8');
  for await (const trozo of process.stdin) crudo += trozo;

  let entrada = {};
  try {
    entrada = JSON.parse(crudo || '{}');
  } catch {
    /* ⚠ SI NO ENTIENDE LA ENTRADA, NO BLOQUEA. Igual que las otras tres. */
    process.exit(0);
  }

  const ti = entrada?.tool_input ?? {};
  let patron = null;
  let ruta = null;
  if (typeof ti.command === 'string') {
    const c = leerConteo(ti.command);
    if (c !== null) { patron = c.patron; ruta = c.ruta; }
  } else if (ti.output_mode === 'count' && typeof ti.pattern === 'string') {
    /* La herramienta `Grep` no pasa por el shell: sin este brazo, la guarda
       cubriria el comando y no la via que mas se usa. */
    patron = ti.pattern;
    ruta = typeof ti.path === 'string' ? ti.path : null;
  }
  if (patron === null || ruta === null) process.exit(0);

  const regla = decidir(patron, ruta);
  if (regla === null) process.exit(0);

  process.stderr.write(
    'BLOQUEADO por scripts/verificacion/contar-en-el-codigo.mjs -- ' + regla.nombre + '.\n\n' +
      'POR QUE: ' + regla.porque + '\n\n' +
      'QUE HACER: ' + regla.hacer + '\n\n' +
      'Frena solo cuando los dos numeros DIFIEREN, o sea cuando el conteo engaña. Sus limites\n' +
      'estan en su cabecera, y el ultimo es que no cubre leer el archivo y contar a ojo: ahi se\n' +
      'acaba lo que una guarda puede hacer.\n'
  );
  process.exit(2);
}
