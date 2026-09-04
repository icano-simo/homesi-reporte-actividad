/**
 * ============================================================================
 * PRUEBA DE LAS GUARDAS
 * ============================================================================
 *
 *   node scripts/verificacion/guardas.test.mjs
 *
 * ⚠ LA DIRECCIÓN QUE IMPORTA ES QUE ATRAPEN, no que pasen.
 *
 * Una guarda que devuelve verde con datos buenos no demuestra nada: el `SIN
 * FALLAS` sobre cero aserciones también era verde. Así que cada caso de acá
 * construye el error que la guarda existe para atrapar y verifica que FALLE.
 *
 * Las tres guardas que necesitan un navegador --`leerTexto`, `esperarDato`,
 * `medirRuta`-- se prueban aparte, desde el entorno de la sonda: `playwright`
 * no está en el repo a propósito, y agregarlo por una prueba sería traer una
 * dependencia de 300MB para cinco funciones. Su prueba vive en
 * `guardas.browser.test.mjs`, que se corre con la sonda.
 */
import { crearArnes, chequearChoqueDeClases, exigirSinChoques } from './guardas.mjs';

let fallas = 0;
let corridas = 0;
const ck = (c, m) => {
  corridas++;
  if (!c) fallas++;
  console.log((c ? '  OK   ' : '  ** FALLA ** ') + m);
};
/* Escrito a mano, como pide la propia guarda que estamos probando. */
const MINIMO = 14;

/** Corre `fn` y devuelve el mensaje del error, o `null` si no lanzó. */
function atrapa(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

console.log('=== crearArnes: el resumen no puede mentir ===');
{
  /* El caso real: se cortó antes de la primera aserción. */
  const salida = [];
  const a = crearArnes({ minimo: 17, log: (s) => salida.push(s) });
  const codigo = a.resumen();
  ck(salida.join(' ').includes('RESUMEN INVALIDO'),
     'con CERO aserciones dice RESUMEN INVALIDO y no "SIN FALLAS"');
  ck(codigo === 1, 'y devuelve codigo de salida 1');
}
{
  /* Se cortó a mitad: 3 de 17. Es el caso que de verdad engaña, porque hubo
     verdes en pantalla. */
  const salida = [];
  const a = crearArnes({ minimo: 17, log: (s) => salida.push(s) });
  a.ck(true, 'una');
  a.ck(true, 'dos');
  a.ck(true, 'tres');
  a.resumen();
  ck(salida.join(' ').includes('RESUMEN INVALIDO'),
     'con TRES verdes de 17 esperadas tambien lo dice: los verdes no alcanzan');
  ck(salida.join(' ').includes('3 de 17'), 'y dice cuantas corrieron de cuantas');
}
{
  const salida = [];
  const a = crearArnes({ minimo: 2, log: (s) => salida.push(s) });
  a.ck(true, 'una');
  a.ck(false, 'dos');
  const codigo = a.resumen();
  ck(salida.join(' ').includes('1 FALLAS de 2'), 'con una falla real la reporta');
  ck(codigo === 1, 'y devuelve 1');
}
{
  const salida = [];
  const a = crearArnes({ minimo: 2, log: (s) => salida.push(s) });
  a.ck(true, 'una');
  a.ck(true, 'dos');
  const codigo = a.resumen();
  ck(salida.join(' ').includes('SIN FALLAS (2 aserciones)'), 'y solo dice SIN FALLAS cuando corrieron todas');
  ck(codigo === 0, 'con codigo 0');
}
ck(atrapa(() => crearArnes({ minimo: 0 })) !== null, 'un minimo de 0 se rechaza: seria un arnes que nunca invalida');
ck(atrapa(() => crearArnes({})) !== null, 'y sin minimo tambien');

console.log('\n=== chequearChoqueDeClases: el caso real de .bp-pill ===');
{
  /* Reproducción del caso: `.bp-pill` ya existía con sus variantes, y una
     pantalla nueva la redefinió. */
  const existente = [
    '.bp-pill {',
    '  border-radius: var(--radius-sm);',
    '  font-size: 10px;',
    '}',
    '.bp-pill--sky {',
    '  background: var(--accent-soft);',
    '}',
  ].join('\n');
  const nuevo = [
    '.bp-pill {',
    '  border-radius: var(--radius-full);',
    '  font-size: 11px;',
    '}',
    '.bp-nuevo {',
    '  color: red;',
    '}',
  ].join('\n');

  const choques = chequearChoqueDeClases(existente, nuevo);
  console.log('  choques detectados: ' + JSON.stringify(choques));
  ck(choques.length === 1 && choques[0] === 'bp-pill', 'detecta que .bp-pill ya existia');
  const msg = atrapa(() => exigirSinChoques(existente, nuevo));
  ck(msg !== null && msg.includes('bp-pill'), 'y `exigirSinChoques` FALLA nombrando la clase');
  ck(msg !== null && /otro nombre/i.test(msg), 'diciendo que hay que elegir otro nombre, no mejorar la existente');
}
{
  /* Y que no invente choques donde no hay. Un selector COMPUESTO usa la clase,
     no la define: `a.bp-btn` no debe contar como redefinir `.bp-btn`. */
  const existente = 'a.bp-btn {\n  text-decoration: none;\n}\n.bp-otra .bp-hija {\n  color: red;\n}';
  const nuevo = '.bp-btn {\n  padding: 4px;\n}\n.bp-hija {\n  margin: 0;\n}';
  const choques = chequearChoqueDeClases(existente, nuevo);
  console.log('  con selectores compuestos: ' + JSON.stringify(choques));
  ck(choques.length === 0,
     'un selector compuesto (`a.bp-btn`, `.bp-otra .bp-hija`) NO cuenta como definicion');
  ck(atrapa(() => exigirSinChoques(existente, nuevo)) === null, 'asi que no falla de mas');
}
{
  /* Varias a la vez, ordenadas: el mensaje tiene que listarlas todas. */
  const existente = '.a {\n}\n.b {\n}\n.c {\n}';
  const nuevo = '.c {\n}\n.a {\n}\n.z {\n}';
  ck(JSON.stringify(chequearChoqueDeClases(existente, nuevo)) === '["a","c"]',
     'lista todas las que chocan, ordenadas');
}

if (corridas < MINIMO) {
  console.log(`\n** RESUMEN INVALIDO ** corrieron ${corridas} de ${MINIMO}`);
  process.exit(1);
} else {
  console.log(fallas === 0 ? `\nSIN FALLAS (${corridas} aserciones)` : `\n${fallas} FALLAS de ${corridas}`);
  process.exit(fallas === 0 ? 0 : 1);
}
