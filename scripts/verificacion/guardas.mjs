/**
 * ============================================================================
 * GUARDAS DE VERIFICACIÓN
 * ============================================================================
 *
 * Cinco funciones que convierten en código cinco lecciones que ya nos costaron
 * caro. Están acá, en el repo, y no en el scratchpad de una sesión: una guarda
 * que se muere con la sesión es PEOR que una nota en `AGENTS.md`, porque la nota
 * al menos sobrevive para que alguien la lea.
 *
 * NO TOCAN LA BASE. Reciben el `page` o el `locator` de Playwright por
 * argumento, así que la sonda que se autentica contra producción sigue viviendo
 * fuera del repo. Esto se puede importar desde cualquier script:
 *
 *   import { crearArnes, leerTexto } from '<repo>/scripts/verificacion/guardas.mjs';
 *
 * El contexto completo de cada una está en `AGENTS.md`. Acá va lo justo para
 * entender qué previene y por qué falla como falla.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   1. leerTexto — la que más veces mordió
   ═══════════════════════════════════════════════════════════════════════════

   Cuatro veces en una sola serie:

     · tres leyendo `innerText` de un elemento con `text-transform: uppercase`,
       que devuelve `INACTIVE`, `STEPS` y `7 NODES` -- así que un
       `includes('7 node')` no matchea y la aserción falla por la mayúscula;
     · una leyendo `innerText` de un `<input type="month">`, que NO TIENE texto:
       su valor vive en `value`, y la conclusión fue "el subtítulo no se
       renderiza" cuando se renderizaba perfecto.

   `textContent` no aplica `text-transform`; `innerText` sí. Esa es toda la
   diferencia, y es invisible hasta que muerde.

   ⚠ Y EL ERROR DEL `<input>` DICE QUÉ HACER, no qué pasó. Un mensaje que
   nombra `inputValue()` ahorra el rato de mirar el DOM preguntándose por qué
   está vacío. */

const SIN_TEXTO = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Lee el texto de un locator, sin el `text-transform` aplicado.
 *
 * @param {import('playwright-core').Locator} locator
 * @param {{ colapsarEspacios?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function leerTexto(locator, opts = {}) {
  const { colapsarEspacios = true } = opts;

  const info = await locator.evaluate((el) => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    textContent: el.textContent ?? '',
    innerText: 'innerText' in el ? el.innerText : '',
    transform: getComputedStyle(el).textTransform,
  }));

  if (SIN_TEXTO.has(info.tag)) {
    throw new Error(
      `leerTexto: un <${info.tag.toLowerCase()}${info.type ? ' type="' + info.type + '"' : ''}> no tiene texto. ` +
        'Su valor está en `value`: usá `locator.inputValue()`. ' +
        '(Leyendo innerText de un <input type="month"> concluimos que el subtítulo no se renderizaba, y se renderizaba bien.)'
    );
  }

  const crudo = info.textContent;
  return colapsarEspacios ? crudo.replace(/\s+/g, ' ').trim() : crudo;
}

/**
 * ¿Este elemento tiene `text-transform`? Sirve para explicar una aserción que
 * falló: si `leerTexto` y lo que se ve en pantalla difieren, es por acá.
 *
 * @param {import('playwright-core').Locator} locator
 * @returns {Promise<{ transform: string, pintado: string, real: string, difieren: boolean }>}
 */
export async function diagnosticarTexto(locator) {
  const info = await locator.evaluate((el) => ({
    transform: getComputedStyle(el).textTransform,
    pintado: 'innerText' in el ? el.innerText : '',
    real: el.textContent ?? '',
  }));
  return { ...info, difieren: info.pintado.trim() !== info.real.trim() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. esperarDato — esperar AL DATO, no a cualquier señal de vida
   ═══════════════════════════════════════════════════════════════════════════

   Sondeé doce empleados leyendo el nombre del subtítulo y los doce dieron "no
   está en la población del módulo". Once eran falsos: la pantalla dibuja `—`
   mientras los datos no llegaron, y yo había esperado a que aparecieran las
   TARJETAS -- que las dibuja otra carga.

   Y uno era real, que es la otra mitad de la lección.

   ⚠ POR ESO `descripcion` ES OBLIGATORIA. No es para el mensaje: es para que
   quien escribe la espera tenga que NOMBRAR el dato que va a leer. Nombrarlo es
   lo que impide esperar a la señal equivocada. */

/**
 * Espera hasta que el dato que se va a leer esté realmente ahí.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} descripcion  Qué se está esperando, en palabras. Obligatorio.
 * @param {(arg?: any) => boolean} predicadoEnElNavegador  Corre en la página.
 * @param {{ timeout?: number, arg?: any }} [opts]  `arg` viaja al navegador y
 *   llega como parámetro del predicado. Hace falta más de lo que parece: el
 *   predicado corre en la página, así que no ve ninguna variable de Node, y la
 *   espera correcta muchas veces es "el título ya dice ESTE nombre" -- que es un
 *   valor que está acá. Sin él la espera se degrada a "hay un título", que es
 *   justo la señal equivocada que esta función existe para evitar.
 * @returns {Promise<any>} Lo que devolvió el predicado la vez que se cumplió.
 *   Es la mitad que faltaba: la función existe para que se espere AL DATO QUE SE
 *   VA A LEER, y devolverlo permite leer ESE y no volver a buscarlo con otro
 *   selector -- que es como se vuelve a esperar una cosa y medir otra.
 *
 *   ⚠ EL PREDICADO TIENE QUE DEVOLVER UN VALOR PLANO. Un nodo del DOM no
 *   viaja: Playwright NO falla, devuelve la cadena `'ref: <Node>'`, que se lee
 *   como un dato y no lo es. Lo comprobado, no lo supuesto -- yo escribí que
 *   tiraba y la aserción de `guardas.browser.test.mjs` dijo que no.
 */
export async function esperarDato(page, descripcion, predicadoEnElNavegador, opts = {}) {
  const { timeout = 120000, arg = undefined } = opts;
  if (typeof descripcion !== 'string' || descripcion.trim() === '') {
    throw new Error(
      'esperarDato: falta `descripcion`. Nombrar el dato que se va a leer es lo que ' +
        'impide esperar a la señal equivocada -- esperar a las tarjetas y leer un campo ' +
        'que lo llena otra carga da doce falsos negativos seguidos.'
    );
  }
  let handle;
  try {
    handle = await page.waitForFunction(predicadoEnElNavegador, arg, { timeout });
  } catch {
    throw new Error(
      `esperarDato: "${descripcion}" no llegó en ${timeout}ms. ` +
        'Antes de concluir que el dato no existe: una pantalla que todavía no cargó dice ' +
        'exactamente lo mismo que una que no tiene el dato.'
    );
  }
  /* `jsonValue` no falla con un valor que no viaja: devuelve un marcador.
     El `catch` queda igual porque el handle puede quedar huérfano si la página
     navega entremedio, y en ese caso la espera YA se cumplió -- devolver
     `undefined` es correcto y tirar no lo sería. */
  try {
    return await handle.jsonValue();
  } catch {
    return undefined;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. medirRuta — el compile en frío se cobra en la primera medición
   ═══════════════════════════════════════════════════════════════════════════

   Estuve a punto de reportar que una ventana de 12 meses aceleró una ruta 3×:
   7,9s a 2,5s. La ventana no descartaba NI UN snapshot. Los 7,9s eran el
   compile en frío de Next en dev.

   Lo que lo delató no fue el número sino que no se explicaba por el mecanismo.
   Esta función hace que no haga falta darse cuenta. */

/**
 * Mide una ruta con una corrida de CALENTAMIENTO que se descarta.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} url
 * @param {{ corridas?: number, timeout?: number }} [opts]
 * @returns {Promise<{ calentamiento: number, corridas: number[], mediana: number }>}
 */
export async function medirRuta(page, url, opts = {}) {
  const { corridas = 3, timeout = 180000 } = opts;

  const unaVez = async () => {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return Date.now() - t0;
  };

  /* La primera SIEMPRE se tira. No es opcional ni configurable: hacerla
     opcional devuelve el problema a quien se acuerde de pedirla. */
  const calentamiento = await unaVez();

  const medidas = [];
  for (let i = 0; i < corridas; i++) medidas.push(await unaVez());

  const ordenadas = [...medidas].sort((a, b) => a - b);
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)];
  return { calentamiento, corridas: medidas, mediana };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. crearArnes — cero fallas sobre cero pruebas se ve igual que cero sobre 17
   ═══════════════════════════════════════════════════════════════════════════

   Un script imprimió `SIN FALLAS` sin haber ejecutado una sola aserción: el
   `import` del módulo bajo prueba falló, no había `catch`, y el `finally` corrió
   con el contador todavía en cero.

   ⚠ EL MÍNIMO VA ESCRITO A MANO. Derivarlo del propio recorrido lo haría
   coincidir siempre, que es justo el problema que viene a resolver. */

/**
 * @param {{ minimo: number, log?: (s: string) => void }} opts
 */
export function crearArnes({ minimo, log = console.log }) {
  if (!Number.isInteger(minimo) || minimo < 1) {
    throw new Error('crearArnes: `minimo` tiene que ser el número de aserciones esperadas, escrito a mano.');
  }
  let fallas = 0;
  let corridas = 0;

  /** @param {boolean} condicion @param {string} mensaje */
  const ck = (condicion, mensaje) => {
    corridas++;
    if (!condicion) fallas++;
    log((condicion ? '  OK   ' : '  ** FALLA ** ') + mensaje);
    return condicion;
  };

  /** Imprime el resumen y devuelve el código de salida sugerido. */
  const resumen = () => {
    if (corridas < minimo) {
      log(`\n** RESUMEN INVALIDO ** corrieron ${corridas} de ${minimo} aserciones: se cortó antes de terminar`);
      return 1;
    }
    log(fallas === 0 ? `\nSIN FALLAS (${corridas} aserciones)` : `\n${fallas} FALLAS de ${corridas}`);
    return fallas === 0 ? 0 : 1;
  };

  return { ck, resumen, get fallas() { return fallas; }, get corridas() { return corridas; } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. chequearChoqueDeClases — una clase redefinida rompe donde ya estaba
   ═══════════════════════════════════════════════════════════════════════════

   `.bp-pill` estaba definida desde antes, con su geometría, y la usaba otra
   pantalla con tres variantes. La redefiní para una pantalla nueva y, como la
   mía venía después en el archivo, le ganó: la pantalla ajena cambió de forma,
   padding, tamaño y peso sin que nadie lo pidiera.

   Lo que lo hizo invisible: las variantes sobreescriben COLOR y BORDE, que es
   lo que se mira primero, así que seguía viéndose bien. */

/**
 * Devuelve los selectores de clase de `cssNuevo` que ya existen en `cssExistente`.
 *
 * @param {string} cssExistente
 * @param {string} cssNuevo
 * @returns {string[]}
 */
export function chequearChoqueDeClases(cssExistente, cssNuevo) {
  /* Sólo las reglas de primer nivel: `.x {` al principio de línea. Una clase
     que aparece únicamente como parte de un selector compuesto --`a.x`,
     `.y .x`-- no se está DEFINIENDO, se está usando. */
  const declaradas = (css) => {
    const out = new Set();
    for (const m of css.matchAll(/^\.([A-Za-z0-9_-]+)(?=[\s,{:])/gm)) out.add(m[1]);
    return out;
  };

  const existentes = declaradas(cssExistente);
  return [...declaradas(cssNuevo)].filter((c) => existentes.has(c)).sort();
}

/**
 * La versión que falla en vez de devolver: para usar antes de escribir el
 * archivo, que es el único momento en que sirve.
 *
 * @param {string} cssExistente
 * @param {string} cssNuevo
 */
export function exigirSinChoques(cssExistente, cssNuevo) {
  const choques = chequearChoqueDeClases(cssExistente, cssNuevo);
  if (choques.length) {
    throw new Error(
      'chequearChoqueDeClases: estas clases YA existen y se estarían redefiniendo: ' +
        choques.join(', ') +
        '. Elegí otro nombre -- no "mejores" la existente de paso, porque quien la usa no está ' +
        'en la pantalla que estás mirando.'
    );
  }
}


/* ═══════════════════════════════════════════════════════════════════════
   6. exigirAusente — comprobar una ausencia sobre el CODIGO, no sobre el archivo
   ═══════════════════════════════════════════════════════════════════════

   Seis veces en una sola serie una guarda mia busco un nombre prohibido sobre
   el archivo y lo encontro EN EL COMENTARIO QUE EXPLICA POR QUE ESTA PROHIBIDO.
   Las seis veces el archivo estaba bien y la guarda dijo que no:

     `max-width: 46%`     en la nota que explica por que se saco
     `bp-field__label`    en la nota que dice que estaba inventada
     `a.ck(true,`         en la nota que dice que era una tautologia
     `useMemo`            en la nota que dice que no memoizaba nada
     y dos mas, buscando un texto retipeado de memoria en vez de leido.

   > Una guarda que comprueba una AUSENCIA tiene que mirar el codigo, no el
   > archivo: los comentarios son justamente donde el nombre prohibido aparece
   > a proposito.

   ⚠ Y ESTA EN EL REPO Y NO EN UN SCRATCHPAD por una razon concreta: el helper
   existia desde la tercera vez, escrito, y no lo agarre hasta la sexta. La
   regla existia; el habito no. Una herramienta que hay que recordar que existe
   se usa igual que una nota. */

/** Saca comentarios de bloque, de linea y de JSX segun el lenguaje. */
export function sinComentarios(texto, lenguaje = 'ts') {
  let s = texto;
  if (lenguaje === 'sql') {
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    return s.replace(/--[^\n]*/g, '');
  }
  if (lenguaje === 'py') return s.replace(/#[^\n]*/g, '');
  /* JSX primero: `{/* ... *\/}` envuelve un comentario de bloque, y sacar el
     bloque antes dejaria las llaves sueltas. */
  s = s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  if (lenguaje !== 'css') s = s.replace(/\/\/[^\n]*/g, '');
  return s;
}

/**
 * Falla si alguno de `prohibidos` aparece en el CODIGO de `texto`.
 *
 * @param {string} texto      el contenido del archivo
 * @param {string[]} prohibidos
 * @param {{ lenguaje?: string, donde?: string }} [opts]
 * @returns {number} cuantos se comprobaron, para poder contarlo en el arnes
 */
export function exigirAusente(texto, prohibidos, opts = {}) {
  const { lenguaje = 'ts', donde = 'el archivo' } = opts;
  if (!Array.isArray(prohibidos) || prohibidos.length === 0) {
    throw new Error(
      'exigirAusente: la lista de prohibidos esta vacia. Una guarda sin nada que buscar pasa ' +
        'siempre, que es el problema que `crearArnes` existe para detectar.'
    );
  }
  const codigo = sinComentarios(texto, lenguaje);
  const malos = prohibidos.filter((p) => codigo.includes(p));
  if (malos.length) {
    throw new Error(
      'exigirAusente: en ' + donde + ' quedaron en el CODIGO: ' + malos.join(', ') +
        '. (Si aparecen solo en un comentario, esta funcion no los cuenta -- por eso existe.)'
    );
  }
  return prohibidos.length;
}
