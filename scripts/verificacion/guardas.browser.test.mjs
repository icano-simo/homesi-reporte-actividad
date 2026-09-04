/**
 * ============================================================================
 * PRUEBA DE LAS TRES GUARDAS QUE NECESITAN NAVEGADOR
 * ============================================================================
 *
 *   node scripts/verificacion/guardas.browser.test.mjs <ruta a playwright-core>
 *
 * `playwright-core` NO está en el repo a propósito: traerlo por cinco funciones
 * serían 300MB de dependencia. Se le pasa la ruta del que ya usa la sonda.
 *
 * ⚠ NO NECESITA SERVIDOR NI BASE. Las tres se prueban contra HTML armado acá
 * mismo con `page.setContent`, que es lo que las hace verificables sin montar
 * nada -- y lo que hace que esta prueba siga funcionando cuando la app cambie.
 *
 * Y la dirección que importa sigue siendo que ATRAPEN, no que pasen: cada caso
 * construye el error real que la guarda existe para detectar.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { crearArnes, leerTexto, diagnosticarTexto, esperarDato, medirRuta } from './guardas.mjs';

const rutaPlaywright = process.argv[2];
if (!rutaPlaywright) {
  console.error('Falta la ruta a playwright-core. Ej:');
  console.error('  node scripts/verificacion/guardas.browser.test.mjs /ruta/al/scratchpad/node_modules/playwright-core/index.mjs');
  process.exit(2);
}
/*
 * ⚠ `pathToFileURL` y no la ruta pelada: en Windows un `import()` de una ruta
 * absoluta falla con ERR_UNSUPPORTED_ESM_URL_SCHEME, porque toma la letra de
 * unidad como protocolo -- "Received protocol 'c:'". Se acepta cualquiera de
 * las dos formas para que quien la corra no tenga que saber esto.
 */
if (!/^file:\/\//.test(rutaPlaywright) && !existsSync(rutaPlaywright)) {
  console.error('No existe: ' + rutaPlaywright);
  process.exit(2);
}
const { chromium } = await import(
  /^file:\/\//.test(rutaPlaywright) ? rutaPlaywright : pathToFileURL(rutaPlaywright).href
);

const a = crearArnes({ minimo: 17 });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();

  /* ── leerTexto ── */
  console.log('=== leerTexto: el text-transform y el <input> ===');
  await page.setContent(`
    <style>
      .grito { text-transform: uppercase; }
      .titulo { text-transform: capitalize; }
    </style>
    <span class="grito" id="a">7 nodes</span>
    <span class="titulo" id="b">sales coaching</span>
    <span id="c">  texto   con    espacios  </span>
    <input id="d" type="month" value="2026-09">
    <textarea id="e">algo</textarea>
    <select id="f"><option>uno</option></select>
  `);

  /* El caso que mordió tres veces: innerText devuelve `7 NODES`. */
  const diag = await diagnosticarTexto(page.locator('#a'));
  console.log('  #a: pintado=' + JSON.stringify(diag.pintado) + ' real=' + JSON.stringify(diag.real) + ' transform=' + diag.transform);
  a.ck(diag.difieren, 'diagnosticarTexto detecta que lo pintado difiere del texto real');
  a.ck(diag.pintado === '7 NODES', 'innerText devuelve "7 NODES" -- el text-transform aplicado');
  a.ck((await leerTexto(page.locator('#a'))) === '7 nodes',
       'leerTexto devuelve "7 nodes": un includes("7 node") ahora matchea');
  a.ck((await leerTexto(page.locator('#b'))) === 'sales coaching',
       'y con capitalize tambien devuelve el original');
  a.ck((await leerTexto(page.locator('#c'))) === 'texto con espacios', 'colapsa los espacios');
  a.ck((await leerTexto(page.locator('#c'), { colapsarEspacios: false })).includes('   '),
       'salvo que se le pida lo contrario');

  /* El caso del <input type="month">: tiene que FALLAR y decir qué hacer. */
  for (const [sel, etiqueta] of [['#d', 'input type=month'], ['#e', 'textarea'], ['#f', 'select']]) {
    let msg = null;
    try {
      await leerTexto(page.locator(sel));
    } catch (e) {
      msg = e.message;
    }
    if (sel === '#d') console.log('  el error del input dice: "' + String(msg).slice(0, 108) + '..."');
    a.ck(msg !== null && msg.includes('inputValue()'),
         'un <' + etiqueta + '> FALLA y nombra inputValue(): dice que hacer, no que paso');
  }
  a.ck((await page.locator('#d').inputValue()) === '2026-09',
       'y por ese camino el valor SI se lee: nunca fue que no se renderizara');

  /* ── esperarDato ── */
  console.log('\n=== esperarDato: al dato, no a cualquier senal de vida ===');
  await page.setContent(`
    <div id="tarjetas">ya estoy</div>
    <div id="nombre">—</div>
    <script>
      setTimeout(() => { document.getElementById('nombre').textContent = 'Haydee Tito-Pace'; }, 700);
    </script>
  `);
  /* Sin descripcion, se niega. */
  let msgDesc = null;
  try {
    await esperarDato(page, '', () => true);
  } catch (e) {
    msgDesc = e.message;
  }
  a.ck(msgDesc !== null && /descripcion/i.test(msgDesc),
       'sin `descripcion` se niega: nombrar el dato es lo que impide esperar a la senal equivocada');

  await esperarDato(page, 'el subtitulo trae un nombre', () => {
    const el = document.querySelector('#nombre');
    return !!el && el.textContent.trim() !== '\u2014';
  }, { timeout: 5000 });
  a.ck((await leerTexto(page.locator('#nombre'))) === 'Haydee Tito-Pace',
       'esperando AL DATO, se lee el nombre y no el guion del estado de carga');

  /* Y que el timeout explique la trampa. */
  let msgTimeout = null;
  try {
    await esperarDato(page, 'un dato que nunca llega', () => false, { timeout: 400 });
  } catch (e) {
    msgTimeout = e.message;
  }
  console.log('  el timeout dice: "' + String(msgTimeout).slice(-96) + '"');
  a.ck(msgTimeout !== null && /no tiene el dato/.test(msgTimeout),
       'y al vencer avisa que una pantalla sin cargar dice lo mismo que una sin el dato');

  /* ── medirRuta ── */
  console.log('\n=== medirRuta: la corrida de calentamiento ===');
  /*
   * ⚠ SE CUENTAN LAS NAVEGACIONES DE VERDAD.
   *
   * La primera version de esta prueba afirmaba
   * `!r.corridas.includes(r.calentamiento) || r.corridas.length === 3`, que es
   * una TAUTOLOGIA: el segundo termino siempre era cierto, asi que la asercion
   * no podia fallar. Una asercion que no puede fallar es peor que ninguna,
   * porque ocupa el lugar de una que si mide.
   *
   * Lo que hay que demostrar es que hace UNA navegacion mas que las corridas
   * pedidas, y que la descartada es la primera.
   */
  let navegaciones = 0;
  const contar = () => { navegaciones++; };
  page.on('framenavigated', contar);
  const r = await medirRuta(page, 'data:text/html,<p>hola</p>', { corridas: 3, timeout: 20000 });
  page.off('framenavigated', contar);
  console.log('  calentamiento=' + r.calentamiento + 'ms  corridas=' + JSON.stringify(r.corridas) +
              '  mediana=' + r.mediana + '  navegaciones=' + navegaciones);
  a.ck(r.corridas.length === 3, 'devuelve las 3 corridas pedidas');
  a.ck(navegaciones === 4, 'y navego CUATRO veces: la de calentamiento se descarta, no se saltea');
  const ordenadas = [...r.corridas].sort((x, y) => x - y);
  a.ck(r.mediana === ordenadas[1], 'la mediana sale de las 3 que cuentan y no del promedio');
  a.ck(typeof r.calentamiento === 'number' && r.calentamiento > 0,
       'el calentamiento se devuelve APARTE, para poder mirarlo si el numero sorprende');
} finally {
  await browser.close();
  process.exit(a.resumen());
}
