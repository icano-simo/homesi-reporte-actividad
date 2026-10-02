#!/usr/bin/env node
/*
 * ============================================================================
 * NINGÚN TEXTO PASA POR EL SHELL — LA GUARDA MECÁNICA
 * ============================================================================
 *
 * Se engancha como hook `PreToolUse` de la herramienta Bash y BLOQUEA el
 * comando antes de que corra. Lee el JSON del hook por stdin y, si el comando
 * cae en una de las formas prohibidas, escribe el motivo en stderr y sale con
 * código 2 -- que es lo que el agente lee como «no se ejecutó, y por qué».
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE, Y POR QUÉ NO ALCANZABA LA NOTA
 * ---------------------------------------------------------------------------
 * La regla está escrita en `CLAUDE.md` y en `AGENTS.md`, con los tres modos de
 * falla medidos: los backslashes que se colapsan un nivel, el segundo heredoc
 * que se come al primero, y los backticks que se ejecutan como sustitución de
 * comandos y dejan huecos en silencio.
 *
 * Y aun así pasó CINCO veces, la última en el mismo turno en que la regla se
 * estaba documentando. La conclusión del usuario: «ya no es que falte saberlo».
 * Una regla que hay que acordarse funciona igual que una nota que nadie
 * consulta -- así que esto la vuelve mecánica.
 *
 * `scripts/commit.mjs` cubre UN caso --el mensaje de commit-- y lo cubre bien,
 * pero después de escribirlo. Esto cubre la familia entera y ANTES.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LO QUE NO HACE, dicho para que nadie lo suponga
 * ---------------------------------------------------------------------------
 * No entiende el shell ni lee lo que el comando escribiría: es un análisis de
 * la LÍNEA. Un comando raro puede colarse y uno legítimo puede caer -- para eso
 * están los permitidos explícitos. No es una frontera de seguridad: es la mano
 * que frena el reflejo.
 *
 * Y no bloquea nada si no entiende su propia entrada: ver el `catch` del final.
 */

import { pathToFileURL } from 'node:url';

const PERMITIDOS = [
  /* Windows: la única vía para borrar una junction, y está en el procedimiento
     documentado de los worktrees. Es un comando con una ruta, no texto. */
  /^\s*cmd\s+\/\/?c\s/i,
  /* `git commit -F archivo` es justamente la forma correcta. */
  /\bgit\s+commit\b[^|;&]*\s-F\s/,
  /* Y el script que envuelve todo esto. */
  /\bscripts[/\\]commit\.mjs\b/,
];

/** Cada regla: cómo se detecta, qué pasó cuando no estaba, y qué hacer. */
const REGLAS = [
  {
    nombre: 'heredoc',
    prueba: /<<-?<?\s*['"]?[A-Za-z_]/,
    porque:
      'un heredoc pasa el texto por el shell: los backslashes se colapsan un nivel, los backticks ' +
      'se EJECUTAN --y el resultado vacío reemplaza al fragmento, sin fallar-- y dos heredocs en ' +
      'la misma llamada se comen uno al otro. Las comillas simples no protegen del backtick que ' +
      'esté fuera del heredoc.',
    hacer: 'escribí el archivo con Write y corré `node archivo.mjs` / `python archivo.py`.',
  },
  {
    nombre: 'código como argumento',
    /*
     * ⚠ `-p` Y `--print` SE AGREGAN DESPUÉS DE QUE LA GUARDA LOS DEJARA PASAR.
     *
     * El patrón perseguía `-e` y `-c`, y `node -p "Object.keys(require('./package.json').scripts)"`
     * corrió sin rebotar -- código viajando como argumento, que es exactamente
     * lo que esta fila existe para frenar. `node -p` es `--print`, o sea `-e`
     * más un `console.log`: el mismo mecanismo con otra letra.
     *
     * Van en ESTA fila y no en una nueva: es la misma decisión, y dos filas que
     * deciden lo mismo divergen con el primer edit.
     *
     * ⚠ Y `-p` SÓLO PARA LOS INTÉRPRETES DE ESTA LISTA. `-p` es una bandera
     * comunísima --`mkdir -p`, `npm run -p`, `docker run -p`-- así que la letra
     * sola no dice nada; lo que la vuelve código es de quién es. Por eso el
     * patrón sigue exigiendo el intérprete pegado adelante, y por eso `grep -p`
     * o `mkdir -p` no la tocan.
     */
    /*
     * ⚠ `sobre: 'ambas'` — Y ESTO CORRIGE LA NOTA DE AGENTS.md, QUE DECÍA QUE
     * LAS REGLAS DE BANDERA NO LO NECESITAN.
     *
     * Decía: «las que persiguen una BANDERA siguen mirando el comando entero,
     * porque una bandera nunca está entrecomillada». Es cierto del comando que
     * se EJECUTA y falso del que BUSCA esa bandera como texto. Frenó esto, que
     * es prosa sobre la guarda y no código:
     *
     *     grep -n "node -e`, `python -c" AGENTS.md
     *
     * Y no afloja nada: en un `node -e "..."` de verdad la bandera va FUERA de
     * las comillas, así que ignorar lo entrecomillado no la pierde. Los casos
     * de `SIGUE_BLOQUEANDO` lo afirman en vez de confiar en este párrafo.
     */
    sobre: 'ambas',
    prueba:
      /\b(node|python|python3|perl|ruby|bash|sh|zsh|pwsh|powershell)\s+(-e|--eval|-p|--print|-c|-Command|-EncodedCommand)\b/i,
    porque:
      'el código viaja como argumento, así que el shell lo toca antes de que llegue al intérprete. ' +
      'Es el mismo mecanismo del heredoc con otra cara.',
    hacer: 'Write a un archivo y correr el archivo. El umbral NO es la longitud: también los de una línea.',
  },
  {
    nombre: 'mensaje de commit en la línea',
    prueba: /\bgit\s+commit\b[^|;&]*(-m|--message|-am)\b/,
    porque:
      'ya se comió cinco identificadores de un mensaje: los backticks de `disabled={busy}` se ' +
      'ejecutaron y el mensaje quedó con huecos. No falla: reemplaza.',
    hacer:
      'escribí el mensaje con Write y usá `node scripts/commit.mjs <archivo>`, que además lo lee de ' +
      'vuelta y lo compara contra el archivo.',
  },
  {
    nombre: 'cuerpo de PR en la línea',
    /*
     * ⚠ `--title` NO ENTRA, Y ANTES SÍ. SEGUNDO FALSO POSITIVO DE ESTA GUARDA.
     *
     * El patrón era `--(body|title)` y bloqueaba esto, que está bien:
     *
     *   gh pr create --title "docs(outlook): el caso ya no tiene filas" \
     *                --body-file <archivo>
     *
     * El cuerpo iba por archivo --o sea que no tocaba el shell-- y aun así el
     * `--title` disparaba la regla. Un título es una línea corta de prosa sin
     * backticks; el riesgo que esta guarda persigue es el del CUERPO, que casi
     * siempre los tiene. Bloquear el título no evitaba nada y dejaba sin salida:
     * `gh pr create` no tiene `--title-file`.
     *
     * Se agrega `-b`, que es el atajo de `--body` y faltaba.
     *
     * ⚠ `--body-file` NO matchea, y no por casualidad: el `\s+` de después exige
     * un espacio, y ahí va `-file`. Si algún día se saca ese `\s+`, hay que
     * excluirlo a mano.
     *
     * ⚠ `(?<![\w-])` ANTES DE `-b`: sin eso, `--base main` matchearía por el
     * `-b` de 'base'. Con el lookbehind, sólo matchea `-b` como bandera suelta.
     */
    prueba: /\bgh\b[^|;&]*\b(pr|issue)\b[^|;&]*(--body|(?<![\w-])-b)\s+(?!-)/,
    porque: 'mismo mecanismo que el mensaje de commit, y el cuerpo de un PR casi siempre tiene backticks.',
    hacer: 'usá `--body-file archivo`. El `--title` en la línea está bien: es una línea de prosa, no un cuerpo.',
  },
  {
    nombre: 'texto redirigido a un archivo',
    /*
     * ⚠ `(?<![0-9&])` Y `(?!&)`: EL PRIMER FALSO POSITIVO DE ESTA GUARDA.
     *
     * Bloqueó `echo "faltantes: $(npm ls --depth=0 2>&1 | grep -ciE '...')"`,
     * que no escribe ningún archivo. El `>` que matcheaba era el de `2>&1`
     * DENTRO de la sustitución de comando: entre el `echo` y ese `>` no hay
     * ningún `|`, `;` ni `&`, así que `[^|;&]*` llegaba sin problema.
     *
     * Las dos condiciones dicen lo que faltaba: un `>` precedido por un dígito
     * es un descriptor --`2>`-- y uno seguido de `&` es una duplicación de
     * descriptor --`>&2`--. Ninguno de los dos escribe texto a un archivo.
     *
     * ⚠ Y QUEDA UN HUECO CONOCIDO, dicho acá en vez de descubierto después:
     * `echo hola 2>&1 > salida.txt` NO se bloquea, porque `[^|;&]*` no puede
     * cruzar el `&` de `2>&1` para llegar al segundo `>`. Es la dirección
     * correcta para equivocarse --deja pasar una escritura rara en vez de
     * frenar un comando legítimo-- y el motivo es el de siempre: una guarda que
     * bloquea lo legítimo es la que alguien desengancha, y ahí se pierde
     * también lo que sí cubría.
     */
    /*
     * ⚠ `sobre: 'ambas'` — UN `>` ENTRE COMILLAS NO ES UNA REDIRECCIÓN.
     *
     * Frenó `printf "%s -> "` y `echo "... <a> o Link"`: la flecha estaba
     * adentro del texto que se iba a imprimir. Ver la nota de `sinCadenas`.
     */
    sobre: 'ambas',
    prueba: /\b(echo|printf)\b[^|;&]*(?<![0-9&])>>?\s*(?!&)(?!\/dev\/null|\$null|nul\b)\S/i,
    porque:
      'es escribir un archivo con el shell de intermediario: el contenido pasa por expansión y ' +
      'sustitución antes de llegar al disco.',
    hacer: 'Write. Un `echo` sin redirección --un mensaje en la salida-- no está bloqueado.',
  },
  {
    nombre: 'sed -i con escapes',
    /*
     * ⚠ `sobre: 'simples'` Y NO `'ambas'`, y la diferencia es el punto.
     *
     * Frenó `grep -n "sed -i\` con backtick" AGENTS.md`, donde `sed -i` era
     * parte del PATRÓN de búsqueda. Pero dentro de comillas DOBLES un backtick
     * sigue expandiendo, así que ignorarlas dejaría pasar `sed -i "s/$x/y/"`,
     * que es exactamente lo que esta regla existe para atrapar.
     *
     * ⚠ Y QUEDA UN HUECO CONOCIDO, dicho acá en vez de descubierto después: un
     * `grep "sed -i ..."` con el patrón entre comillas DOBLES y un backtick
     * adentro sigue frenando. Es la dirección correcta para equivocarse --un
     * caso raro de búsqueda contra un caso real de escritura-- y la salida está
     * a mano: comillas simples en el patrón.
     */
    sobre: 'simples',
    prueba: /\bsed\b[^|;&]*-i\b[^|;&]*[`$\\]/,
    porque:
      'una sustitución con backticks, `$` o backslashes llega distinta de como se escribió, y un ' +
      '`sed` que no matchea NO FALLA: deja el archivo igual y sale con 0.',
    hacer: 'Edit, que falla ruidosamente si el patrón no está y no pasa por el shell.',
  },
];

/**
 * ============================================================================
 * LO QUE VA ENTRE COMILLAS NO ES SINTAXIS DEL SHELL
 * ============================================================================
 *
 * Tres falsos positivos seguidos, los tres del mismo mecanismo: la guarda leía
 * la FORMA del comando y encontraba su patrón DENTRO DE UNA CADENA, donde el
 * carácter es texto y no un operador. Medidos:
 *
 *     printf "%s -> " "$f"                    -> «texto redirigido a un archivo»
 *     echo "=== hay algun <a> o Link"         -> idem
 *     grep -n "sed -i\` con backtick" AGENTS  -> «sed -i con escapes»
 *
 * En los tres, lo que el shell hace es imprimir o buscar un texto. Nada se
 * escribe en ningún archivo y ningún `sed` corre.
 *
 * ⚠ Y REPORTÉ MAL LA CAUSA LA PRIMERA VEZ. Dije que el culpable era el
 * `2>/dev/null` de la misma línea, y medido, ese comando PASA: la regla ya
 * excluye `/dev/null` y los descriptores numéricos. Lo que frenaba era la
 * flecha del `printf`. Un diagnóstico plausible, escrito sin correr la función.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS DOS COMILLAS NO PROTEGEN LO MISMO, Y POR ESO SON DOS MODOS
 * ---------------------------------------------------------------------------
 * Para una REDIRECCIÓN da igual: `>` entre comillas simples o dobles es texto
 * en los dos casos.
 *
 * Para un BACKTICK no: dentro de comillas dobles, `` ` `` y `$` SIGUEN
 * expandiendo --que es justo el peligro que esta guarda persigue-- y dentro de
 * simples, no. Así que la regla del `sed -i` sólo puede ignorar lo que va entre
 * comillas SIMPLES. Borrar también las dobles la dejaría ciega para
 * `sed -i "s/$x/y/"`, que es un caso real.
 *
 * Esto NO es aflojar el patrón: es dejar de mirar donde el carácter no tiene su
 * significado. Lo de afuera de las comillas se sigue mirando igual.
 */
const MODOS = {
  /* Ambas comillas: un `>` es texto adentro de cualquiera de las dos. */
  ambas: /'[^']*'|"[^"]*"/g,
  /* Sólo simples: las dobles dejan expandir backticks y `$`. */
  simples: /'[^']*'/g,
};

/**
 * El comando con el contenido de las cadenas reemplazado por espacios.
 *
 * ⚠ SE REEMPLAZA POR ESPACIOS Y NO SE BORRA, para no pegar dos trozos que
 * estaban separados: `echo "a"> b` y `echo "a" > b` tienen que seguir dando lo
 * mismo, y borrando la cadena el primero quedaría `echo > b` igual -- pero
 * `git commit -m"x"-F` pegaría dos banderas que no se tocaban.
 */
export function sinCadenas(comando, modo = 'ambas') {
  return comando.replace(MODOS[modo], (m) => ' '.repeat(m.length));
}

export function decidir(comando) {
  if (typeof comando !== 'string' || comando.trim() === '') return null;
  if (PERMITIDOS.some((p) => p.test(comando))) return null;
  for (const r of REGLAS) {
    /*
     * `sobre` dice qué parte del comando mira la regla. Sin él, mira el comando
     * entero -- que es lo correcto para las que persiguen una BANDERA
     * (`-e`, `-c`, `--body`, `-m`), porque una bandera nunca está entre
     * comillas, y para el heredoc, cuyo `<<` tampoco.
     */
    const texto = r.sobre === undefined ? comando : sinCadenas(comando, r.sobre);
    if (r.prueba.test(texto)) return r;
  }
  return null;
}

export { REGLAS, PERMITIDOS };

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
    /* ⚠ SI NO ENTIENDE LA ENTRADA, NO BLOQUEA. Una guarda que rompe todos los
       comandos cuando cambia el formato del hook es peor que la falla que viene
       a evitar: la primera reacción de cualquiera sería desengancharla, y ahí
       se pierde también lo que sí cubría. */
    process.exit(0);
  }

  const regla = decidir(entrada?.tool_input?.command ?? '');
  if (regla === null) process.exit(0);

  process.stderr.write(
    'BLOQUEADO por scripts/verificacion/sin-texto-al-shell.mjs -- ' + regla.nombre + '.\n\n' +
      'POR QUE: ' + regla.porque + '\n\n' +
      'QUE HACER: ' + regla.hacer + '\n\n' +
      'La regla completa esta en CLAUDE.md ("El problema no es el heredoc: es cualquier texto que\n' +
      'pase por el shell") y en AGENTS.md. Si este caso es un falso positivo, decilo en el reporte\n' +
      'en vez de buscarle la vuelta al patron: la lista de permitidos se corrige con un caso.\n'
  );
  process.exit(2);
}
