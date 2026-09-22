/*
 * ============================================================================
 * LOS DOS DESENLACES DE LA FASE 3, PROBADOS SIN NAVEGADOR
 * ============================================================================
 *
 * `gateStatus` y `gateEvidence` son puras. Node importa el `.ts` directo.
 *
 * Lo que hay que medir, y es lo que el brief de RV10 pidió:
 *
 *   · con funnel                    -> cierra
 *   · sin funnel Y CON MOTIVO       -> también cierra
 *   · sin comentario                -> NO cierra en ninguno de los dos
 *   · y la evidencia los distingue: `funnel_chosen` true contra false
 *
 * ⚠ La tercera es la que sostiene todo el diseño. Aceptar «no por ahora» relaja
 * la compuerta, y lo único que impide que eso la vuelve un botón vacío es que el
 * comentario siga siendo obligatorio: declinar sin decir por qué no cierra.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const { gateStatus, gateEvidence, requiereDecisionDeFunnel, promptDeLaRama, showsMmiLink } =
  await import(pathToFileURL(resolve(RAIZ, 'lib/review/gates.ts')).href);

/* El paso 3.1 como queda con el SQL de RV10 aplicado. */
const p31 = {
  phase_no: 3,
  step_in_phase: 1,
  label: 'Funnel selection',
  gate_kind: 'funnel',
  gate_config: {
    target: '.bp-catalog',
    allow_second: false,
    prompt_catalog: 'What catches your eye?',
    prompt_declined: 'Why not now?',
  },
};

const a = crearArnes({ minimo: 37 });
try {
  /* ═══ 1. Quién exige la decisión ═══ */
  console.log('\n=== 1. la exigencia ===');
  a.ck(requiereDecisionDeFunnel(p31) === true, 'el paso 3.1 exige una decisión');
  a.ck(requiereDecisionDeFunnel({ ...p31, gate_kind: 'comment', phase_no: 1 }) === false,
    'un paso de la fase 1 no');
  a.ck(requiereDecisionDeFunnel({ ...p31, gate_config: { requires_funnel: false } }) === false,
    'y la salida deliberada sigue existiendo, escrita');

  /* ═══ 2. LOS DOS DESENLACES CIERRAN ═══ */
  console.log('\n=== 2. los dos desenlaces ===');
  const conFunnel = gateStatus(p31, {
    comment: 'Recruitment porque el pipeline no alcanza',
    funnelListo: true,
  });
  console.log('  con funnel        -> ' + JSON.stringify(conFunnel));
  a.ck(conFunnel.ok === true, 'con funnel y comentario, cierra');

  const declinado = gateStatus(p31, {
    comment: 'No ahora: arranca en dos semanas y no tiene pipeline propio todavía',
    funnelListo: false,
    desenlaceFunnel: 'declinado',
  });
  console.log('  declinado         -> ' + JSON.stringify(declinado));
  a.ck(declinado.ok === true,
    'SIN FUNNEL Y CON MOTIVO, TAMBIÉN CIERRA -- es el desenlace que RV9 prohibía');

  /* ═══ 3. Y LO QUE NO SE RELAJA ═══ */
  console.log('\n=== 3. el comentario, en los dos ===');
  const declinadoMudo = gateStatus(p31, {
    comment: '   ',
    funnelListo: false,
    desenlaceFunnel: 'declinado',
  });
  console.log('  declinado sin decir nada -> ' + JSON.stringify(declinadoMudo));
  a.ck(declinadoMudo.ok === false,
    'DECLINAR SIN MOTIVO NO CIERRA: es lo único que no se relaja');
  a.ck(/comment/i.test(declinadoMudo.falta ?? ''),
    'y el motivo que da es el comentario: "' + declinadoMudo.falta + '"');

  const conFunnelMudo = gateStatus(p31, { comment: '', funnelListo: true });
  a.ck(conFunnelMudo.ok === false && /comment/i.test(conFunnelMudo.falta ?? ''),
    'y con funnel pero sin comentario, tampoco');

  /* ═══ 4. Sin decidir nada ═══ */
  console.log('\n=== 4. sin decidir ===');
  const sinDecidir = gateStatus(p31, { comment: 'algo', funnelListo: false });
  console.log('  sin decidir       -> ' + JSON.stringify(sinDecidir));
  a.ck(sinDecidir.ok === false, 'sin funnel y sin haber declinado, no cierra');
  a.ck(/decide/i.test(sinDecidir.falta ?? ''),
    'y pide DECIDIR, no un funnel: "' + sinDecidir.falta + '"');

  /*
   * ⚠ Y EL FUNNEL GANA SOBRE EL BOTÓN. Si la fila de `enrollment` existe, la
   * decisión está tomada aunque alguien haya apretado «no por ahora» antes.
   */
  const ambos = gateStatus(p31, {
    comment: 'lo elegimos igual',
    funnelListo: true,
    desenlaceFunnel: 'declinado',
  });
  a.ck(ambos.ok === true,
    'un «no por ahora» viejo no desmiente una fila de enrollment');

  /* ═══ 5. LA EVIDENCIA DISTINGUE LOS DOS ═══ */
  console.log('\n=== 5. la evidencia ===');
  const evElegido = gateEvidence(p31, {
    comment: 'x',
    funnelListo: true,
    funnelNombre: 'Recruitment - DYS',
  });
  console.log('  elegido    -> ' + JSON.stringify(evElegido));
  a.ck(evElegido.funnel_chosen === true, 'el elegido queda con `funnel_chosen: true`');
  a.ck(evElegido.funnel_name === 'Recruitment - DYS',
    'Y CON EL NOMBRE DEL DÍA: `cancel_funnel` borra enrolamientos, así que el ' +
    'intake tiene que poder decir qué se eligió aunque el plan ya no exista');

  const evDeclinado = gateEvidence(p31, {
    comment: 'x',
    funnelListo: false,
    desenlaceFunnel: 'declinado',
  });
  console.log('  declinado  -> ' + JSON.stringify(evDeclinado));
  a.ck(evDeclinado.funnel_chosen === false,
    'el declinado queda REGISTRADO como `funnel_chosen: false`, no como ausencia');
  a.ck(!('funnel_name' in evDeclinado),
    'y sin nombre, porque no hay ninguno que nombrar');
  a.ck(evDeclinado !== null,
    'y NO es `null`: sin la fila, el intake diría «falta el paso» y el motivo se ' +
    'perdería');

  a.ck(JSON.stringify(evElegido) !== JSON.stringify(evDeclinado),
    'los dos desenlaces son distinguibles en la base');

  /* ═══ 6. LA RAMA CON FUNNEL: tres salidas ═══ */
  console.log('\n=== 6. con funnel, tres salidas ===');

  /*
   * ⚠ La de arriba es la distinción que sostiene esta rama: con funnel, TENER
   * funnel ya no alcanza para cerrar. Hay que decir qué se decidió sobre él.
   */
  const conFunnelSinDecir = gateStatus(p31, { comment: 'ok', funnelListo: true });
  console.log('  con funnel y sin decir nada -> ' + JSON.stringify(conFunnelSinDecir));
  a.ck(conFunnelSinDecir.ok === true,
    'tener funnel sigue cerrando el paso: es el respaldo de quien vino del ' +
    'catálogo y eligió, donde el botón no se aprieta');

  for (const [rama, esperado] of [['kept', 'kept'], ['changed', 'changed'],
                                  ['deferred', 'deferred']]) {
    const g = gateStatus(p31, { comment: 'porque sí', funnelListo: true, desenlaceFunnel: rama });
    a.ck(g.ok === true, 'con funnel y «' + rama + '» + comentario, cierra');
    const ev = gateEvidence(p31, {
      comment: 'x', funnelListo: true, desenlaceFunnel: rama, funnelNombre: 'A',
      ...(rama === 'changed' ? { funnelAnterior: 'B' } : {}),
    });
    console.log('  ' + rama.padEnd(9) + ' -> ' + JSON.stringify(ev));
    a.ck(ev.decision === esperado,
      'y la evidencia guarda el ACTO: decision=' + ev.decision);
  }

  /* Y sin comentario, ninguna de las tres cierra. */
  for (const rama of ['kept', 'changed', 'deferred']) {
    const g = gateStatus(p31, { comment: '  ', funnelListo: true, desenlaceFunnel: rama });
    a.ck(g.ok === false, '«' + rama + '» sin comentario NO cierra');
  }

  /*
   * ⚠ LA DISTINCIÓN QUE JUSTIFICA `decision`: `kept` y `deferred` dejan el mismo
   * estado --el mismo funnel activo-- y son la diferencia entre confirmar y no
   * mirar. Sin el campo, en la base se ven idénticos.
   */
  const evKept = gateEvidence(p31, {
    comment: 'x', funnelListo: true, desenlaceFunnel: 'kept', funnelNombre: 'A' });
  const evDeferred = gateEvidence(p31, {
    comment: 'x', funnelListo: true, desenlaceFunnel: 'deferred', funnelNombre: 'A' });
  a.ck(evKept.funnel_chosen === evDeferred.funnel_chosen,
    'confirmar y postergar dejan el MISMO estado: funnel_chosen igual en los dos');
  a.ck(evKept.decision !== evDeferred.decision,
    'Y SIN EMBARGO SE DISTINGUEN, que es para lo que existe `decision`: ' +
    evKept.decision + ' contra ' + evDeferred.decision);

  const evCambio = gateEvidence(p31, {
    comment: 'x', funnelListo: true, desenlaceFunnel: 'changed',
    funnelNombre: 'Nuevo', funnelAnterior: 'Viejo' });
  a.ck(evCambio.replaced === 'Viejo',
    'y el cambio deja rastro de lo que reemplazó: `cancel_funnel` BORRA, así que ' +
    'sin esto no queda nada de lo que había');

  /* ═══ 7. Las preguntas de las dos ramas ═══ */
  console.log('\n=== 6. las dos preguntas ===');
  a.ck(promptDeLaRama(p31, 'catalogo') === 'What catches your eye?',
    'la del catálogo sale de `gate_config`');
  a.ck(promptDeLaRama(p31, 'declinado') === 'Why not now?', 'y la de declinar');
  a.ck(promptDeLaRama({ ...p31, gate_config: { target: '.x' } }, 'catalogo') === null,
    'y la ausencia da `null`, que el panel resuelve con el prompt del paso: una ' +
    'clave que falta deja la pregunta general, no una pantalla sin pregunta');

  /* ═══ 8. El enlace de MMI: la PRESENCIA decide, el valor no ═══
   *
   * ⚠ Las cinco importan por lo que RV21 rompió: al dejar de leer el valor se
   * fue con él la condición, y el `Open MMI` salió en los ocho pasos. Las dos
   * últimas son las que fijan que el arreglo NO dependa de aplicar el SQL: hoy
   * el valor es una URL y mañana `true`, y la respuesta tiene que ser la misma.
   */
  console.log('\n=== 7. el enlace de MMI ===');
  const p12 = { phase_no: 1, step_in_phase: 2, gate_kind: 'comment' };
  a.ck(showsMmiLink({ ...p12, gate_config: { target: '.bp-stats', mmi_link: true } }) === true,
    'con la clave puesta, el paso ofrece el enlace');
  a.ck(showsMmiLink({ ...p12, gate_config: { target: '.bp-stats' } }) === false,
    'sin la clave, no -- que es el caso de los otros siete pasos');
  a.ck(showsMmiLink({ ...p12, gate_config: null }) === false,
    'y un `gate_config` en `null` tampoco lo ofrece');
  a.ck(showsMmiLink({ ...p12 }) === false,
    'ni un paso sin `gate_config`: «no lo leí» no puede pasar por «acá va»');
  const comoEstaHoy = showsMmiLink({ ...p12, gate_config: { mmi_link: 'https://mmi.io' } });
  const comoQuedaConElSql = showsMmiLink({ ...p12, gate_config: { mmi_link: true } });
  a.ck(comoEstaHoy === true && comoQuedaConElSql === true,
    'la URL de hoy y el `true` del SQL dan lo mismo: el arreglo no espera la ' +
    'migración, y la migración no lo rompe');
} finally {
  process.exitCode = a.resumen();
}
