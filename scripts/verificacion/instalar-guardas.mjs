/*
 * ============================================================================
 * ENGANCHAR LAS GUARDAS DE HOOK — `npm run guarda:instalar`
 * ============================================================================
 *
 * Copia cada guarda a `~/.claude/hooks/` y la engancha como hook `PreToolUse`
 * en `~/.claude/settings.json`.
 *
 * ⚠ REEMPLAZA A `instalar-guarda-shell.mjs`, QUE INSTALABA UNA SOLA. Al sumar
 * la segunda guarda, copiar aquel archivo y cambiarle el nombre habría sido la
 * segunda copia de la misma decisión --copiar, comparar, enganchar, avisar-- y
 * las dos habrían divergido con el primer arreglo. Acá las guardas son una
 * LISTA y el procedimiento uno solo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ HAY UNA COPIA, Y CÓMO NO SE VUELVE «DOS COPIAS DE LA MISMA
 *   DECISIÓN»
 * ---------------------------------------------------------------------------
 * El hook lo lee el agente desde `~/.claude`, que está FUERA del repo -- y el
 * `.gitignore` ignora `.claude/` a propósito («config local del agente»). Así
 * que la lógica no puede vivir sólo en el repo, y la copia operativa no puede
 * vivir sólo en la máquina:
 *
 *   el repo    es la fuente: la lógica, su prueba y el porqué.
 *   ~/.claude  es la copia que corre.
 *
 * Este script las mantiene de acuerdo, y por eso IMPRIME si una copia estaba
 * distinta: una copia vieja enganchada es peor que ninguna, porque bloquea con
 * reglas que ya no son las de la fuente.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(homedir(), '.claude');
const DESTINO_DIR = join(CLAUDE, 'hooks');
const AJUSTES = join(CLAUDE, 'settings.json');

/**
 * Las guardas. `matcher` es la herramienta que interceptan.
 *
 * ⚠ `esperar-al-dato` mira `Write|Edit` y NO `Bash`: una sonda no es un
 * comando. Se escribe como archivo y se corre con `node sonda.mjs`, y ese
 * comando no contiene el código -- así que la única forma de verlo es al
 * escribirlo.
 */
const GUARDAS = [
  { archivo: 'sin-texto-al-shell.mjs', matcher: 'Bash' },
  { archivo: 'esperar-al-dato.mjs', matcher: 'Write|Edit' },
];

mkdirSync(DESTINO_DIR, { recursive: true });

let ajustes = {};
if (existsSync(AJUSTES)) {
  try {
    ajustes = JSON.parse(readFileSync(AJUSTES, 'utf8'));
  } catch (e) {
    console.error('no se pudo leer ' + AJUSTES + ': ' + e.message);
    console.error('No se toca nada. Arreglalo a mano y volve a correr esto.');
    process.exit(1);
  }
}

const hooks = ajustes.hooks ?? {};
const pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
let cambios = 0;

for (const g of GUARDAS) {
  const fuente = readFileSync(join(AQUI, g.archivo), 'utf8');
  const destino = join(DESTINO_DIR, g.archivo);
  const antes = existsSync(destino) ? readFileSync(destino, 'utf8') : null;
  writeFileSync(destino, fuente);
  if (antes === null) {
    console.log('copiada por primera vez: ' + destino);
    cambios += 1;
  } else if (antes === fuente) {
    console.log('la copia ya estaba al dia: ' + destino);
  } else {
    console.log('⚠ la copia estaba DISTINTA y se actualizo: ' + destino);
    cambios += 1;
  }

  const comando = 'node "' + destino.replace(/\\/g, '/') + '"';
  const clave = g.archivo.replace(/\.mjs$/, '');
  const yaEsta = pre.some((x) =>
    (x?.hooks ?? []).some((h) => typeof h?.command === 'string' && h.command.includes(clave))
  );
  if (yaEsta) {
    console.log('  el hook ya estaba enganchado (' + g.matcher + ')');
  } else {
    pre.push({ matcher: g.matcher, hooks: [{ type: 'command', command: comando }] });
    console.log('  enganchado para ' + g.matcher);
    cambios += 1;
  }
}

if (cambios > 0) {
  ajustes.hooks = { ...hooks, PreToolUse: pre };
  writeFileSync(AJUSTES, JSON.stringify(ajustes, null, 2) + '\n');
  console.log('\nescrito ' + AJUSTES);
} else {
  console.log('\nnada que cambiar en ' + AJUSTES);
}

console.log('Para desenganchar una: saca su entrada de `hooks.PreToolUse` en ' + AJUSTES + '.');
console.log('⚠ Un cambio de hooks se toma al ARRANCAR la sesion, no en el momento.');
