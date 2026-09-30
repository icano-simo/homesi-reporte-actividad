/*
 * ============================================================================
 * EL PASO DE AL LADO, PROBADO SIN NAVEGADOR
 * ============================================================================
 *
 * `pasoAnterior` y `pasoSiguiente` son puras: reciben el guion y un cursor, y
 * devuelven un paso. Así que se prueban acá, sin servidor, sin base y sin
 * sesión. Node importa el `.ts` directamente.
 *
 * ---------------------------------------------------------------------------
 * LO QUE IMPORTA MEDIR
 * ---------------------------------------------------------------------------
 * · que CRUCEN DE FASE: el anterior de 2.1 es 1.5, no `null`. Es el caso que
 *   el brief pidió y el único camino que la máscara nunca recorrió.
 * · que el primero no tenga anterior: sin eso habría que decidir qué significa
 *   «antes del principio», y no significa nada.
 * · que un cursor que no está en el guion dé `null` en las dos direcciones, en
 *   vez de devolver el primero o el último por accidente de índice.
 *
 * ⚠ El guion de prueba NO está ordenado a propósito: las funciones ordenan por
 * (fase, paso) y no confían en el orden en que vienen las filas. Si alguien
 * quitara el `orderedSteps` de adentro, estas aserciones lo dirían.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const { pasoAnterior, pasoSiguiente, orderedSteps, answeredSteps, vistoEnSitio } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/review/progress.ts')).href);
const { gateStatus } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/review/gates.ts')).href);

const paso = (f, s, label) => ({
  phase_no: f,
  step_in_phase: s,
  label,
  gate_kind: 'comment',
  gate_config: null,
});

/* Desordenado a propósito: 3.1 primero y 1.5 en el medio. */
const script = {
  phases: [
    { phase_no: 1, title: 'Business Plan', module: 'business-plan' },
    { phase_no: 2, title: 'Outlook', module: 'outlook' },
    { phase_no: 3, title: 'Funnel', module: 'business-plan' },
  ],
  steps: [
    paso(3, 1, 'Funnel selection'),
    paso(1, 2, 'Benchmark'),
    paso(2, 2, 'Budget'),
    paso(1, 1, 'The year'),
    paso(2, 1, 'Project through'),
    paso(1, 5, 'Risk status'),
    paso(1, 3, 'Future performance'),
    paso(1, 4, 'Pipeline'),
  ],
  prompts: [],
};

const en = (f, s) => ({ phase_no: f, step_in_phase: s });
const nombre = (p) => (p === null ? null : p.phase_no + '.' + p.step_in_phase);

const a = crearArnes({ minimo: 25 });
try {
  /* ═══ 1. El orden, del que sale todo lo demás ═══ */
  console.log('\n=== 1. el orden del guion ===');
  const orden = orderedSteps(script).map((s) => s.phase_no + '.' + s.step_in_phase);
  console.log('  ' + orden.join('  '));
  a.ck(orden.join(',') === '1.1,1.2,1.3,1.4,1.5,2.1,2.2,3.1',
    'ordena por fase y paso aunque las filas vengan desordenadas: ' + orden.join(','));

  /* ═══ 2. Dentro de una fase ═══ */
  console.log('\n=== 2. dentro de una fase ===');
  a.ck(nombre(pasoAnterior(script, en(1, 4))) === '1.3',
    'el anterior de 1.4 es 1.3: ' + nombre(pasoAnterior(script, en(1, 4))));
  a.ck(nombre(pasoSiguiente(script, en(1, 4))) === '1.5',
    'y el siguiente es 1.5: ' + nombre(pasoSiguiente(script, en(1, 4))));

  /* ═══ 3. CRUZANDO DE FASE -- el caso del brief ═══ */
  console.log('\n=== 3. cruzando de fase ===');
  const a21 = pasoAnterior(script, en(2, 1));
  console.log('  anterior de 2.1 -> ' + nombre(a21) + '  «' + (a21 && a21.label) + '»');
  a.ck(nombre(a21) === '1.5',
    'EL ANTERIOR DE 2.1 ES 1.5, cruzando de fase: ' + nombre(a21));
  a.ck(a21 !== null && a21.label === 'Risk status',
    'y trae su rótulo, que es lo que el botón muestra: ' + (a21 && a21.label));
  a.ck(nombre(pasoAnterior(script, en(3, 1))) === '2.2',
    'el anterior de 3.1 es 2.2 -- de Business Plan a Outlook, hacia atrás: ' +
    nombre(pasoAnterior(script, en(3, 1))));
  a.ck(nombre(pasoSiguiente(script, en(1, 5))) === '2.1',
    'y hacia adelante 1.5 sigue dando 2.1, como siempre: ' +
    nombre(pasoSiguiente(script, en(1, 5))));

  /* ═══ 4. Los bordes ═══ */
  console.log('\n=== 4. los bordes ===');
  a.ck(pasoAnterior(script, en(1, 1)) === null,
    'EL PRIMERO NO TIENE ANTERIOR: ' + nombre(pasoAnterior(script, en(1, 1))));
  a.ck(pasoSiguiente(script, en(3, 1)) === null,
    'y el último no tiene siguiente: ' + nombre(pasoSiguiente(script, en(3, 1))));
  a.ck(nombre(pasoSiguiente(script, en(1, 1))) === '1.2',
    'pero el primero sí tiene siguiente: ' + nombre(pasoSiguiente(script, en(1, 1))));
  a.ck(nombre(pasoAnterior(script, en(3, 1))) === '2.2',
    'y el último sí tiene anterior: ' + nombre(pasoAnterior(script, en(3, 1))));

  /* ═══ 5. Un cursor que no existe ═══ */
  console.log('\n=== 5. un cursor fuera del guion ===');
  a.ck(pasoAnterior(script, en(9, 9)) === null,
    'un paso que no está en el guion no tiene anterior');
  a.ck(pasoSiguiente(script, en(9, 9)) === null, 'ni siguiente');
  a.ck(pasoAnterior(script, en(1, 99)) === null,
    'y tampoco uno con la fase buena y el paso inventado -- no se cae al último ' +
    'de la fase por accidente de índice');

  /* ═══ 6. Un guion de un solo paso ═══ */
  console.log('\n=== 6. un guion de un paso ===');
  const solo = { ...script, steps: [paso(1, 1, 'Único')] };
  a.ck(pasoAnterior(solo, en(1, 1)) === null, 'sin anterior');
  a.ck(pasoSiguiente(solo, en(1, 1)) === null, 'y sin siguiente');

  /* ═══ 7. Ida y vuelta ═══ */
  console.log('\n=== 7. ida y vuelta ===');
  const ok = orderedSteps(script).slice(1).every((s) => {
    const atras = pasoAnterior(script, s);
    return atras !== null && nombre(pasoSiguiente(script, atras)) === nombre(s);
  });
  a.ck(ok,
    'para TODOS los pasos menos el primero, el siguiente del anterior es uno mismo');

  /* ── TENER TEXTO NO ES TENER EL PASO HECHO — etapa RV32 ─────────────── */
  /*
   * Las dos funciones que deciden esto son puras, asi que se prueban acá y no
   * en una sonda: `vistoEnSitio` lee el tercer estado y `answeredSteps` es el
   * UNICO lugar que define «paso hecho» -- de el cuelgan `phaseProgress`,
   * `overallPercent`, `resumeCursor` e `isComplete`.
   */
  const resp = (f, s, visto) => ({
    session_key: 1, phase_no: f, step_in_phase: s, prompt_revision: 1,
    comment: 'x', gate: null, answered_at: '2026-09-30T00:0' + s + ':00Z',
    answered_by: 'x@y.z',
    ...(visto === undefined ? {} : { seen_on_site: visto }),
  });

  a.ck(vistoEnSitio(resp(1, 1, true)) === true, 'una respuesta confirmada cuenta');
  a.ck(vistoEnSitio(resp(1, 1, false)) === false, 'y una escrita por adelantado, no');
  a.ck(vistoEnSitio(resp(1, 1, undefined)) === true,
    '⚠ y `undefined` CUENTA: es la columna sin aplicar todavia, no una respuesta sin confirmar. ' +
    'Leerlo como `false` trabaría cada revisión abierta el día del merge');

  const hechos = answeredSteps([resp(1, 1, true), resp(1, 2, false), resp(1, 3, undefined)]);
  a.ck(hechos.has('1:1') && !hechos.has('1:2') && hechos.has('1:3'),
    '⚠ `answeredSteps` deja afuera el paso que sólo tiene texto: ' + [...hechos].sort().join(' '));

  /*
   * ⚠ Y LO MIRADO NO SE DES-MIRA. La tabla es append-only: después de
   * confirmar, escribir ese mismo paso desde el panel de las nueve agrega una
   * fila SIN la marca. Mirar sólo la última desharía el paso.
   */
  const dosFilas = answeredSteps([resp(2, 1, true), { ...resp(2, 1, false), answered_at: '2026-10-01T00:00:00Z' }]);
  a.ck(dosFilas.has('2:1'),
    '⚠ un paso confirmado y después reescrito por adelantado SIGUE hecho');

  /* Y la compuerta, que es la otra mitad: sin el tilde no cierra. */
  const base = { phase_no: 1, step_in_phase: 9, label: 'x', gate_kind: 'comment', gate_config: null };
  a.ck(gateStatus(base, { comment: 'algo', vistoEnSitio: false }).ok === false,
    '⚠ la compuerta NO cierra con comentario y sin confirmar');
  a.ck(gateStatus(base, { comment: 'algo', vistoEnSitio: true }).ok === true,
    'y sí con las dos');
  a.ck(gateStatus(base, { comment: '', vistoEnSitio: true }).falta?.includes('comment') === true,
    '⚠ y con el tilde puesto y sin texto pide el COMENTARIO primero: pedir que confirme lo que ' +
    'mira antes de que escriba es pedir lo segundo antes de lo primero');
} finally {
  process.exitCode = a.resumen();
}
