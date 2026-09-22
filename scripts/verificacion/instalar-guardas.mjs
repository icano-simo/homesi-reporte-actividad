/*
 * ============================================================================
 * ENGANCHAR Y DESENGANCHAR LAS GUARDAS DE HOOK — `npm run guarda:instalar`
 * ============================================================================
 *
 * Copia cada guarda a `~/.claude/hooks/` y la engancha como hook `PreToolUse`
 * en `~/.claude/settings.json`. Y --lo que agrega esta version-- DESENGANCHA
 * las que ya no estan en la lista.
 *
 * ⚠ REEMPLAZA A `instalar-guarda-shell.mjs`, QUE INSTALABA UNA SOLA. Al sumar
 * la segunda guarda, copiar aquel archivo y cambiarle el nombre habria sido la
 * segunda copia de la misma decision --copiar, comparar, enganchar, avisar-- y
 * las dos habrian divergido con el primer arreglo. Aca las guardas son una
 * LISTA y el procedimiento uno solo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ HAY UNA COPIA, Y CÓMO NO SE VUELVE «DOS COPIAS DE LA MISMA
 *   DECISIÓN»
 * ---------------------------------------------------------------------------
 * El hook lo lee el agente desde `~/.claude`, que esta FUERA del repo -- y el
 * `.gitignore` ignora `.claude/` a proposito («config local del agente»). Asi
 * que la logica no puede vivir solo en el repo, y la copia operativa no puede
 * vivir solo en la maquina:
 *
 *   el repo    es la fuente: la logica, su prueba y el porque.
 *   ~/.claude  es la copia que corre.
 *
 * Este script las mantiene de acuerdo, y por eso IMPRIME si una copia estaba
 * distinta: una copia vieja enganchada es peor que ninguna, porque bloquea con
 * reglas que ya no son las de la fuente.
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y POR QUÉ DESENGANCHA SOLO, EN VEZ DE TENER UNA OPCIÓN PARA HACERLO
 * ---------------------------------------------------------------------------
 * El caso real es una guarda que se REVIERTE: el commit que la saca borra su
 * archivo del repo, y el hook queda enganchado apuntando a una copia que la
 * fuente ya no tiene. Nadie va a acordarse de correr `--desenganchar` en ese
 * momento, porque en ese momento uno esta pensando en el revert.
 *
 * Una opcion que hay que acordarse de usar funciona igual que una nota, que es
 * la leccion que este repo lleva pagada tres veces. Asi que la baja no es una
 * opcion: es lo que pasa cuando la guarda no esta en `GUARDAS`.
 *
 * Y el limite, porque un reconciliador que borra lo que no es suyo es el que
 * alguien desengancha entero: SOLO toca hooks cuyo comando apunta a
 * `~/.claude/hooks/`. Un hook que el usuario haya puesto a mano, apuntando a
 * cualquier otro lado, no se mira ni se cuenta.
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
 * comando no contiene el codigo -- asi que la unica forma de verlo es al
 * escribirlo.
 *
 * ⚠ Y SACAR UNA FILA DE ACA LA DESENGANCHA. Es la contracara de agregarla, y
 * esta puesto asi para que revertir una guarda alcance con revertir su commit.
 */
export const GUARDAS = [
  { archivo: 'sin-texto-al-shell.mjs', matcher: 'Bash' },
  { archivo: 'esperar-al-dato.mjs', matcher: 'Write|Edit' },
];

/**
 * ¿La copia y la fuente dicen lo mismo?
 *
 * ⚠ NORMALIZA LOS FINALES DE LINEA, y no es cosmetico. Este repo tiene
 * `core.autocrlf = true` y ningun `.gitattributes`, asi que un archivo escrito
 * en LF vuelve del checkout en CRLF. Comparando byte a byte, el primer
 * `guarda:instalar` despues de cualquier merge gritaba «la copia estaba
 * DISTINTA» sobre dos archivos identicos linea por linea --medido: 8661 bytes
 * contra 8487, 174 CRLF contra 0, y la misma cadena al normalizar--.
 *
 * Y eso rompe justo lo que el aviso viene a hacer: un aviso que aparece cuando
 * no falta nada enseña a ignorarlo. El aviso tiene que significar «la logica
 * cambio», no «pasaste por un checkout».
 */
export function mismoContenido(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

/** Windows compara rutas sin distinguir mayusculas ni el sentido de la barra. */
const normRuta = (s) => s.replace(/\\/g, '/').toLowerCase();

/**
 * Saca de `pre` los hooks que apuntan a `dirHooks` y cuyo archivo ya no esta
 * en `vivas`. Devuelve la lista nueva y las bajas, sin tocar el original.
 *
 * Es pura a proposito: lo que decide una baja se prueba sin escribir un
 * `settings.json` de verdad.
 *
 * @param {unknown[]} pre entradas de `hooks.PreToolUse`
 * @param {string[]} vivas nombres de archivo que siguen en `GUARDAS`
 * @param {string} dirHooks el directorio de las copias
 */
export function reconciliar(pre, vivas, dirHooks) {
  const dir = normRuta(dirHooks);
  const vivasNorm = new Set(vivas.map((v) => v.toLowerCase()));
  const desenganchadas = [];

  const esNuestro = (comando) =>
    typeof comando === 'string' && normRuta(comando).includes(dir + '/');

  /* El nombre del archivo que corre ese comando, o null si no se puede leer.
     Se busca DESPUES del directorio nuestro, no en cualquier parte de la
     linea: un comando puede nombrar otro `.mjs` como argumento. */
  const archivoDe = (comando) => {
    const s = normRuta(comando);
    const i = s.indexOf(dir + '/');
    const resto = s.slice(i + dir.length + 1);
    const m = resto.match(/^([a-z0-9._-]+\.mjs)/);
    return m ? m[1] : null;
  };

  const nueva = [];
  for (const entrada of Array.isArray(pre) ? pre : []) {
    const hooks = Array.isArray(entrada?.hooks) ? entrada.hooks : [];
    const quedan = hooks.filter((h) => {
      const c = h?.command;
      if (!esNuestro(c)) return true; // no es nuestro: no se mira
      const archivo = archivoDe(c);
      if (archivo === null) return true; // no se entiende: no se toca
      if (vivasNorm.has(archivo)) return true;
      desenganchadas.push({ archivo, comando: c, matcher: entrada?.matcher ?? '?' });
      return false;
    });
    /* Una entrada que se queda sin hooks propios se va entera; una que tenia
       otros hooks conserva los otros. */
    if (quedan.length > 0) nueva.push(hooks.length === quedan.length ? entrada : { ...entrada, hooks: quedan });
  }
  return { pre: nueva, desenganchadas };
}

/* ========================================================================== */
/* Lo de abajo sólo corre cuando se ejecuta el archivo, no al importarlo.      */
/* ========================================================================== */
const ejecutado = process.argv[1] && normRuta(process.argv[1]) === normRuta(fileURLToPath(import.meta.url));
if (ejecutado) principal();

function principal() {
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
  let pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  let cambios = 0;

  /* 1. Las bajas primero: si una guarda se revirtio, lo primero que hay que
        hacer es dejar de correrla. */
  const { pre: podada, desenganchadas } = reconciliar(pre, GUARDAS.map((g) => g.archivo), DESTINO_DIR);
  pre = podada;
  for (const d of desenganchadas) {
    console.log('⚠ DESENGANCHADA: ' + d.archivo + ' (' + d.matcher + ') -- ya no esta en la lista de guardas');
    console.log('  la copia queda en ' + join(DESTINO_DIR, d.archivo) + ' y no corre mas; borrala si querés');
    cambios += 1;
  }

  /* 2. Y las altas. */
  for (const g of GUARDAS) {
    const fuente = readFileSync(join(AQUI, g.archivo), 'utf8');
    const destino = join(DESTINO_DIR, g.archivo);
    const antes = existsSync(destino) ? readFileSync(destino, 'utf8') : null;
    writeFileSync(destino, fuente);
    if (antes === null) {
      console.log('copiada por primera vez: ' + destino);
      cambios += 1;
    } else if (mismoContenido(antes, fuente)) {
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

  console.log('Para desenganchar una: sacala de `GUARDAS` y corré esto de nuevo.');
  console.log('⚠ Un cambio de hooks se toma al ARRANCAR la sesion, no en el momento.');
}
