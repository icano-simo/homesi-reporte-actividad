import { pathToFileURL } from 'node:url';

/*
 * ============================================================================
 * ESPERAR AL DATO, NO A CUALQUIER SEÑAL DE VIDA — la guarda
 * ============================================================================
 *
 * `esperarDato` vive en `guardas.mjs` desde hace etapas y hace exactamente lo
 * que hace falta: espera, y OBLIGA a nombrar el dato que se va a leer. Nombrarlo
 * es lo que impide esperar la señal equivocada.
 *
 * Y no se usó. Una sonda esperó `document.querySelector('tr.ol-total') !== null`
 * --«apareció ALGUNA fila de total»-- y después leyó otra cosa: la fila del
 * branch, que es un `tr.ol-total` FUERA de la composición y con rótulo `Branch
 * NNN`. En el branch más cargado leyó antes de que esa fila existiera y devolvió
 * `fila undefined`, que se reportó como «11 de 12» y se leyó como si la etapa
 * hubiera roto ese branch. Volcada la página, el branch estaba entero.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ UNA GUARDA Y NO UNA NOTA MÁS
 * ---------------------------------------------------------------------------
 * Es la TERCERA herramienta propia que existe, resuelve el caso, y no se agarra:
 *
 *   `exigirAusente`   dos veces -- la segunda, sobre `pg_proc`
 *   `sin-comentarios` una
 *   `esperarDato`     ésta
 *
 * La nota ya estaba escrita las tres veces. Lo único que funcionó con el shell
 * no fue la regla escrita sino la guarda que frena la mano antes de que el
 * comando corra. Ésta hace lo mismo un paso antes: frena la ESCRITURA del
 * archivo.
 *
 * ---------------------------------------------------------------------------
 * EL PREDICADO, Y POR QUÉ ES ASÍ DE ESTRECHO
 * ---------------------------------------------------------------------------
 *
 *   `page.waitForFunction(` en un archivo que YA IMPORTA `guardas.mjs`.
 *
 * O sea: el autor tenía la herramienta en la mano y esperó a mano igual. Eso es
 * lo que distingue este caso de una espera legítima, y es lo que lo hace casi
 * sin falsos positivos.
 *
 * ⚠ NO BLOQUEA `waitForTimeout`. Se usa legítimamente para dejar asentar un
 * clic o una animación, y no hay nada que lo reemplace. Bloquearlo sería la
 * guarda que alguien desengancha -- y ahí se pierde también lo que sí cubría.
 *
 * ⚠ Y NO BLOQUEA UN `waitForFunction` EN UN ARCHIVO QUE NO IMPORTA
 * `guardas.mjs`. Ése es el LÍMITE, dicho para que nadie lo estire: sin ese
 * import no hay señal que distinga una espera a mano legítima --un script
 * suelto, una sonda de otra cosa-- de una que debería usar la herramienta.
 * Estirarlo a «cualquier `waitForFunction`» sería una regla sobre la FORMA del
 * texto y no sobre su significado, que es el error que este repo lleva
 * documentado siete veces.
 *
 * `guardas.mjs` queda exento a propósito: `esperarDato` está implementada ahí, y
 * por dentro llama a `page.waitForFunction`. Es la única que debe.
 */

/** El archivo tiene la herramienta a mano. */
/*
 * ⚠ LAS TRES FORMAS, Y LA TERCERA LA ENCONTRÓ SU PROPIA PRUEBA. La primera
 * versión pedía `from` o `import(`, y se le escapaba el import sin `from`:
 *
 *   import { crearArnes } from '.../guardas.mjs'       estático
 *   await import(pathToFileURL(... 'guardas.mjs'))     dinámico, el de las sondas
 *   import '.../guardas.mjs'                           sin `from`
 */
const IMPORTA_GUARDAS = /\b(?:from|import)\s*['"][^'"]*guardas\.mjs['"]|import\([^)]*guardas\.mjs/;

/*
 * ============================================================================
 * ⚠ Y LAS CADENAS TAMPOCO CUENTAN — el falso positivo que dio en su primer uso
 * ============================================================================
 *
 * Enganchada, lo primero que bloqueó fue la sonda que venía a PROBARLA: un
 * archivo cuyo contenido incluye `'../guardas.mjs'` y `page.waitForFunction(`
 * dentro de CADENAS, como datos de prueba. No importa nada ni espera nada --
 * describe código.
 *
 * Es `exigirAusente` un nivel más allá. Aquella dice que el nombre prohibido
 * aparece a propósito en los COMENTARIOS; acá aparece a propósito en las
 * CADENAS de una prueba o de una sonda sobre la guarda misma. La regla que sale:
 *
 *   **Una guarda que mira el texto de un archivo tiene que descartar los dos
 *   lugares donde el patrón aparece por diseño: los comentarios y las cadenas.**
 *
 * Se descartan las líneas que, ya sin espacios, ARRANCAN con una comilla: así
 * se ve una línea de fixture --`"await page.waitForFunction(...)",`-- y no se ve
 * nunca una llamada de verdad, que empieza con `await`, `const`, `return` o el
 * nombre de la página. Es una regla de forma, y se acota a propósito a eso: la
 * alternativa era parsear JS en un hook.
 */
function sinCadenasDeFixture(texto) {
  return texto
    .split(/\r?\n/)
    .filter((l) => !/^\s*['"`]/.test(l))
    .join('\n');
}

/** La espera escrita a mano. `page` o cualquier nombre de variable de página. */
const ESPERA_A_MANO = /\.waitForFunction\s*\(/;

/** El propio `guardas.mjs`, que es donde `esperarDato` está implementada. */
const ES_LA_IMPLEMENTACION = /guardas\.mjs$/;

/**
 * ¿Este contenido, escrito en esta ruta, esquiva `esperarDato` teniéndola?
 *
 * @param {string} ruta      dónde se va a escribir
 * @param {string} contenido qué se va a escribir
 * @returns {{ nombre: string, porque: string, hacer: string } | null}
 */
export function decidir(ruta, contenido) {
  if (typeof contenido !== 'string' || contenido === '') return null;
  if (typeof ruta === 'string' && ES_LA_IMPLEMENTACION.test(ruta.replace(/\\/g, '/'))) return null;
  /* Sin las líneas de fixture: ver `sinCadenasDeFixture`. */
  const codigo = sinCadenasDeFixture(contenido);
  if (!IMPORTA_GUARDAS.test(codigo)) return null;
  if (!ESPERA_A_MANO.test(codigo)) return null;
  return {
    nombre: 'waitForFunction a mano teniendo `esperarDato` importada',
    porque:
      'este archivo ya importa `guardas.mjs`, asi que tiene `esperarDato` a mano, y espera a mano igual.\n' +
      'Una espera escrita a mano espera «aparecio ALGO» y despues se lee otra cosa: eso devolvio\n' +
      '`fila undefined` en el branch mas cargado y se reporto como si la etapa lo hubiera roto.\n' +
      '`esperarDato` EXIGE nombrar el dato que se va a leer, y nombrarlo es lo que impide esperar\n' +
      'la señal equivocada.',
    hacer:
      'usa `esperarDato(page, "<que dato>", () => ..., { timeout })` y leé lo que devuelve, en vez de\n' +
      'volver a buscarlo con otro selector. `waitForTimeout` NO esta bloqueado: sirve para dejar\n' +
      'asentar un clic.',
  };
}

export { IMPORTA_GUARDAS, ESPERA_A_MANO };

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
    /* ⚠ SI NO ENTIENDE LA ENTRADA, NO BLOQUEA. Igual que la del shell: una
       guarda que rompe toda escritura cuando cambia el formato del hook es peor
       que la falla que viene a evitar, porque la primera reacción de cualquiera
       seria desengancharla. */
    process.exit(0);
  }

  const ti = entrada?.tool_input ?? {};
  /* `Write` trae `content`; `Edit` trae `new_string`. Los dos escriben. */
  const contenido = typeof ti.content === 'string' ? ti.content : (ti.new_string ?? '');
  const regla = decidir(ti.file_path ?? '', contenido);
  if (regla === null) process.exit(0);

  process.stderr.write(
    'BLOQUEADO por scripts/verificacion/esperar-al-dato.mjs -- ' + regla.nombre + '.\n\n' +
      'POR QUE: ' + regla.porque + '\n\n' +
      'QUE HACER: ' + regla.hacer + '\n\n' +
      'El limite de esta guarda esta escrito en su cabecera: NO cubre un archivo que no importe\n' +
      '`guardas.mjs`. Si este caso es un falso positivo, decilo en el reporte en vez de buscarle la\n' +
      'vuelta al patron.\n'
  );
  process.exit(2);
}
