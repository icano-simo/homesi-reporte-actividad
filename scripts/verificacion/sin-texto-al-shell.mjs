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
    prueba:
      /\b(node|python|python3|perl|ruby|bash|sh|zsh|pwsh|powershell)\s+(-e|--eval|-c|-Command|-EncodedCommand)\b/i,
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
    prueba: /\bgh\b[^|;&]*\b(pr|issue)\b[^|;&]*--(body|title)\s+(?!-)/,
    porque: 'mismo mecanismo que el mensaje de commit, y el cuerpo de un PR casi siempre tiene backticks.',
    hacer: 'usá `--body-file archivo`.',
  },
  {
    nombre: 'texto redirigido a un archivo',
    prueba: /\b(echo|printf)\b[^|;&]*>>?\s*(?!\/dev\/null|\$null|nul\b)\S/i,
    porque:
      'es escribir un archivo con el shell de intermediario: el contenido pasa por expansión y ' +
      'sustitución antes de llegar al disco.',
    hacer: 'Write. Un `echo` sin redirección --un mensaje en la salida-- no está bloqueado.',
  },
  {
    nombre: 'sed -i con escapes',
    prueba: /\bsed\b[^|;&]*-i\b[^|;&]*[`$\\]/,
    porque:
      'una sustitución con backticks, `$` o backslashes llega distinta de como se escribió, y un ' +
      '`sed` que no matchea NO FALLA: deja el archivo igual y sale con 0.',
    hacer: 'Edit, que falla ruidosamente si el patrón no está y no pasa por el shell.',
  },
];

export function decidir(comando) {
  if (typeof comando !== 'string' || comando.trim() === '') return null;
  if (PERMITIDOS.some((p) => p.test(comando))) return null;
  for (const r of REGLAS) if (r.prueba.test(comando)) return r;
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
