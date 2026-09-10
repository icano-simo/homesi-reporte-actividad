/*
 * ============================================================================
 * ENGANCHAR LA GUARDA DEL SHELL — `npm run guarda:instalar`
 * ============================================================================
 *
 * Copia `sin-texto-al-shell.mjs` a `~/.claude/hooks/` y lo engancha como hook
 * `PreToolUse` de Bash en `~/.claude/settings.json`.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ HAY UNA COPIA, Y CÓMO NO SE VUELVE «DOS COPIAS DE LA MISMA
 *   DECISIÓN»
 * ---------------------------------------------------------------------------
 * El hook lo lee el agente desde `~/.claude`, que está FUERA del repo -- y el
 * `.gitignore` de este proyecto ignora `.claude/` a propósito («config local
 * del agente»). Así que la lógica no puede vivir sólo en el repo, y la copia
 * operativa no puede vivir sólo en la máquina:
 *
 *   el repo    es la fuente: tiene la lógica, su prueba y el porqué.
 *   ~/.claude  es la copia que corre.
 *
 * Este script es lo que las mantiene de acuerdo, y por eso IMPRIME si la copia
 * estaba distinta: una copia vieja que sigue enganchada es peor que ninguna,
 * porque bloquea con reglas que ya no son las de la fuente.
 *
 * Correlo después de cambiar la guarda. Y `npm run verificar:shell` corre su
 * prueba, que es lo que dice si las reglas siguen atrapando.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = join(AQUI, 'sin-texto-al-shell.mjs');
const CLAUDE = join(homedir(), '.claude');
const DESTINO_DIR = join(CLAUDE, 'hooks');
const DESTINO = join(DESTINO_DIR, 'sin-texto-al-shell.mjs');
const AJUSTES = join(CLAUDE, 'settings.json');

const fuente = readFileSync(FUENTE, 'utf8');

mkdirSync(DESTINO_DIR, { recursive: true });
const antes = existsSync(DESTINO) ? readFileSync(DESTINO, 'utf8') : null;
writeFileSync(DESTINO, fuente);
console.log(
  antes === null
    ? 'copiada por primera vez: ' + DESTINO
    : antes === fuente
      ? 'la copia ya estaba al dia: ' + DESTINO
      : '⚠ la copia estaba DISTINTA y se actualizo: ' + DESTINO
);

/* El enganche. Se preserva lo que haya: estos ajustes son del usuario, no
   nuestros. */
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

const comando = 'node "' + DESTINO.replace(/\\/g, '/') + '"';
const hooks = ajustes.hooks ?? {};
const pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
const yaEsta = pre.some((g) =>
  (g?.hooks ?? []).some((h) => typeof h?.command === 'string' && h.command.includes('sin-texto-al-shell'))
);

if (yaEsta) {
  console.log('el hook ya estaba enganchado en ' + AJUSTES);
} else {
  pre.push({ matcher: 'Bash', hooks: [{ type: 'command', command: comando }] });
  ajustes.hooks = { ...hooks, PreToolUse: pre };
  writeFileSync(AJUSTES, JSON.stringify(ajustes, null, 2) + '\n');
  console.log('enganchado en ' + AJUSTES);
}

console.log('\nPara desengancharla: saca esa entrada de `hooks.PreToolUse` en ' + AJUSTES + '.');
console.log('⚠ Un cambio de hooks se toma al ARRANCAR la sesion, no en el momento.');
