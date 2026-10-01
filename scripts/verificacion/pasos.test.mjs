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

/* El número sale de contar los `a.ck(` del archivo, no de mirar una corrida:
   un mínimo copiado del resultado no puede contradecirlo. */
const a = crearArnes({ minimo: 26 });
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

  /* ── EL COMENTARIO SOLO CIERRA EL PASO — etapa RV33 ──────────────────── */
  /*
   * ⚠ ESTE BLOQUE DECÍA LO CONTRARIO, Y ESTÁ BIEN QUE HAYA DADO ROJO.
   *
   * RV32 hizo que `seen_on_site` decidiera dos cosas: si el paso cerraba y si
   * contaba en el avance. El pedido original no decía eso --fue un error al
   * pasarlo-- así que RV33 le saca las dos.
   *
   * Lo que `seen_on_site` SIGUE decidiendo es una sola, y es presentación: si
   * el panel entra editando o entra mostrando lo que se dijo. Un paso que sólo
   * tiene texto escrito por adelantado entra EDITANDO, que es el punto -- por
   * eso `vistoEnSitio` se queda y se prueba.
   *
   * Las dos funciones son puras, así que se prueban acá y no en una sonda.
   * `answeredSteps` es el ÚNICO lugar que define «paso hecho»: de él cuelgan
   * `phaseProgress`, `overallPercent`, `resumeCursor` e `isComplete`.
   */
  const resp = (f, s, visto) => ({
    session_key: 1, phase_no: f, step_in_phase: s, prompt_revision: 1,
    comment: 'x', gate: null, answered_at: '2026-09-30T00:0' + s + ':00Z',
    answered_by: 'x@y.z',
    ...(visto === undefined ? {} : { seen_on_site: visto }),
  });

  a.ck(vistoEnSitio(resp(1, 1, true)) === true, 'lo escrito parado en el paso se lee como hecho');
  a.ck(vistoEnSitio(resp(1, 1, false)) === false, 'y lo escrito por adelantado, no');
  a.ck(vistoEnSitio(resp(1, 1, undefined)) === true,
    '⚠ y `undefined` CUENTA: es la columna sin aplicar todavia, no una respuesta sin confirmar. ' +
    'Leerlo como `false` abriría editando cada paso ya contestado el día del merge');

  /*
   * ⚠ Y `answeredSteps` CUENTA LAS TRES — RV33 lo devuelve a contar respuestas.
   *
   * Mide la ida y la vuelta: el avance dice 3 de 3 y no 2, y un paso escrito
   * desde la ventana de las otras preguntas cuenta como contestado. La
   * consecuencia está escrita en `progress.ts`: `resumeCursor` saltea un paso
   * que sólo tiene texto adelantado, y la persona lo encuentra por la lista.
   */
  const hechos = answeredSteps([resp(1, 1, true), resp(1, 2, false), resp(1, 3, undefined)]);
  a.ck(hechos.has('1:1') && hechos.has('1:2') && hechos.has('1:3'),
    '⚠ `answeredSteps` cuenta las tres, tengan o no la marca: ' + [...hechos].sort().join(' '));

  /* Y no cuenta dos veces el mismo paso: la tabla es append-only y un paso
     reescrito tiene dos filas. */
  const dosFilas = answeredSteps([resp(2, 1, true), { ...resp(2, 1, false), answered_at: '2026-10-01T00:00:00Z' }]);
  a.ck(dosFilas.size === 1 && dosFilas.has('2:1'),
    '⚠ dos filas del mismo paso son UN paso hecho (' + dosFilas.size + ')');

  /*
   * Y la compuerta, que es la otra mitad: cierra con el comentario solo.
   *
   * ⚠ LA SEGUNDA LE PASA `vistoEnSitio: false` A PROPÓSITO, y tiene que cerrar
   * igual. `StepDraft` ya no declara ese campo, así que en TypeScript esto no
   * compilaría -- y por eso vale acá: si alguien vuelve a leerlo desde
   * `gateStatus`, esta aserción se pone roja y la de arriba no.
   */
  const base = { phase_no: 1, step_in_phase: 9, label: 'x', gate_kind: 'comment', gate_config: null };
  a.ck(gateStatus(base, { comment: 'algo' }).ok === true,
    '⚠ la compuerta CIERRA con el comentario solo');
  a.ck(gateStatus(base, { comment: 'algo', vistoEnSitio: false }).ok === true,
    '⚠ y cierra igual con una marca de «no confirmado» encima: nadie la lee');
  /* Y el caso donde tiene que decir NO, que es lo que prueba que mide algo. */
  a.ck(gateStatus(base, { comment: '   ' }).ok === false,
    '⚠ y sin comentario NO cierra -- tres espacios no son un comentario');
  a.ck(gateStatus(base, { comment: '' }).falta?.includes('comment') === true,
    'y dice que lo que falta es el comentario');
} finally {
  process.exitCode = a.resumen();
}
