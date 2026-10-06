/*
 * ============================================================================
 * LOS DOS GRUPOS DE RECLUTAMIENTO — etapa ADM9
 * ============================================================================
 *
 *   node scripts/verificacion/prioridades.test.mjs
 *
 * `lib/recruitment/prioridades.ts` es puro: Node importa el `.ts` directo,
 * igual que `ventana-de-edicion.test.mjs`.
 *
 * Los casos salen de las 21 filas reales de `activity_report.future_loan_officer`
 * CONSULTADAS, no transcriptas -- ver abajo--, y los que importan son los que
 * separan reglas parecidas:
 *
 *   · Victoria Zambrano es `High` y NO entra: está en Closed Won, no en
 *     Negotiation. Si el criterio fuera sólo la importancia, entraría.
 *   · Luis Landaverde entra CON el cierre vencido hace más de un año. Vencido
 *     no es excluido -- es marcado.
 *   · La segunda entrada de `PRIORITY_RECRUITERS` --María Guerrero-- se ejerce
 *     con una fila SIN NOMBRE: sin ella la lista quedaba probada por una sola
 *     de sus dos entradas. Ver la nota de esa prueba: ahí estuvo Otoniel Gomez
 *     y es justamente lo que no hay que hacer.
 *   · Jorge Betancur entra al grupo del tablero con fecha de ingreso PASADA, que
 *     es la misma señal en la otra dirección.
 *   · Los tres sin `importance` quedan fuera por `sin_triage` y NO por
 *     `no_prioritario`. Es la distinción que el brief pidió preservar.
 *
 * ---------------------------------------------------------------------------
 * ⚠ UN NOMBRE REAL EN UNA PRUEBA ES UNA AFIRMACIÓN SOBRE EL DATO
 * ---------------------------------------------------------------------------
 * ⚠ Y EL EJEMPLO DE OTONIEL NO ERA UN ERROR DE TRANSCRIPCIÓN. Esto decía que sí
 * --dos veces, en direcciones opuestas-- y las dos eran falsas. Lo que pasó:
 *
 *     14:30 (hora del usuario)    medido por él:   importance = High
 *     20:45:39+00 (`synced_at`)   el sync reescribe la tabla
 *     después                     medido en ADM10: importance = Low
 *
 *     {"nombre":"Otoniel Gomez","stage":"Negotiation","importance":"Low",
 *      "recruiter":"Maria Guerrero","producira":true,"branch_code":"710",
 *      "synced_at":"2026-10-05 20:45:39.112+00"}
 *
 * `importance` la edita un reclutador en Salesforce y esta tabla NO guarda
 * historia, así que las dos lecturas eran correctas y el dato se movió entre
 * ellas. Ver «Un dato que alguien edita, en una tabla sin historia, cambia la
 * respuesta sola» en AGENTS.md.
 *
 * Lo que sí sobrevive, con independencia de cuál valor era el de ese día:
 *
 *   · un nombre real sólo entra CON EL JSON de su lectura al lado;
 *   · y lo que prueba una REGLA va sin nombre, con `sf()` y `rrhh()`.
 *
 * Un nombre propio no agrega poder de prueba: agrega una afirmación sobre una
 * persona que nadie va a volver a medir -- y acá convirtió un valor que se
 * MUEVE en un hecho que sobrevivió dos turnos.
 */
import { strict as assert } from 'node:assert';
import {
  groupOf,
  exclusionReason,
  priorityDate,
  willNotProduce,
  buildPriorityGroups,
  GROUP_LABEL,
  DATE_LABEL,
} from '../../lib/recruitment/prioridades.ts';

const HOY = '2026-10-05';

/** Una fila con los valores por defecto de Salesforce; se sobreescribe lo que importa. */
function sf(extra) {
  return {
    nombre: 'X',
    origen: 'salesforce',
    stage: 'Negotiation',
    importance: 'Low',
    recruiter: 'Maria Guerrero',
    branchCode: '710',
    closeDate: '2026-09-30',
    startDate: null,
    producira: true,
    ...extra,
  };
}

function rrhh(extra) {
  return {
    nombre: 'Y',
    origen: 'hr_pipeline',
    stage: null,
    importance: null,
    recruiter: 'Jessica Burden',
    branchCode: '710',
    closeDate: null,
    startDate: '2026-10-16',
    producira: true,
    ...extra,
  };
}

let fallas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    console.log(`  OK   ${nombre}`);
  } catch (err) {
    fallas++;
    console.error(`  FALLA ${nombre}\n        ${err.message}`);
  }
}

console.log('\nGRUPO 1 — negociaciones prioritarias\n');

prueba('High en Negotiation de un reclutador de la lista entra', () => {
  assert.equal(groupOf(sf({ nombre: 'Luis Landaverde', importance: 'High', recruiter: 'Juanjo Cabrera' })), 'salesforce_high');
});

prueba('Victoria: High pero Closed Won NO entra', () => {
  const v = sf({ nombre: 'Victoria Zambrano', importance: 'High', stage: 'Closed Won', recruiter: 'Juanjo Cabrera' });
  assert.equal(groupOf(v), null);
  assert.equal(exclusionReason(v), 'fuera_de_negociacion');
});

prueba('Low en Negotiation NO entra, y el motivo es no_prioritario', () => {
  /*
   * ⚠ ACÁ DECÍA 'Otoniel Gomez', Y ERA FALSO. Otoniel es `High` en la base y
   * ENTRA al grupo -- ver la prueba de abajo. El nombre llegó acá desde una
   * transcripción a mano que lo puso en `Low`, y una vez escrito en una prueba
   * con su nombre, el error se lee como un hecho verificado.
   *
   * La regla que esta prueba comprueba está bien; lo que estaba mal era el
   * ejemplo. Eduardo Portella sí es `Low`, medido.
   */
  const o = sf({ nombre: 'Eduardo Portella', importance: 'Low' });
  assert.equal(groupOf(o), null);
  assert.equal(exclusionReason(o), 'no_prioritario');
});

prueba('⚠ la segunda entrada de PRIORITY_RECRUITERS, ejercida SIN nombre propio', () => {
  /*
   * ⚠ ESTA PRUEBA TAPA UN HUECO, no repite la de arriba.
   *
   * La primera prueba del archivo usa a Luis, que es de Juanjo Cabrera. Sin
   * ésta, `PRIORITY_RECRUITERS` quedaría probado por una sola de sus dos
   * entradas --y por la de afuera, que verifica el rechazo--.
   *
   * Importa porque la comparación es por igualdad exacta: el día que la fuente
   * escriba 'María Guerrero' con tilde, la fila deja de ser prioritaria sin que
   * nada falle, y cae en `otro_reclutador`. Hoy la base dice 'Maria Guerrero'
   * sin tilde, verificado byte por byte.
   *
   * ⚠ Y VA SIN NOMBRE DE PERSONA, que es la corrección de ADM10. Acá estuvo
   * Otoniel Gomez con `importance: 'High'`, y medido contra la base el
   * 2026-10-05 --con el sync de ese día-- Otoniel es `Low`:
   *
   *     {"nombre":"Otoniel Gomez","stage":"Negotiation","importance":"Low",
   *      "recruiter":"Maria Guerrero","producira":true,"branch_code":"710"}
   *
   * O sea que el valor se escribió mal, se "corrigió" al revés, y las dos veces
   * quedó blindado por una prueba que lo nombraba. Lo que esta prueba tiene que
   * comprobar es la REGLA --que la segunda entrada de la lista entra-- y para
   * eso el nombre no hace falta. Sin nombre no puede volver a afirmar de más.
   */
  const deMaria = sf({ importance: 'High', recruiter: 'Maria Guerrero' });
  assert.equal(groupOf(deMaria), 'salesforce_high');
  assert.equal(exclusionReason(deMaria), null);
});

prueba('⚠ Otoniel Gomez, con el valor MEDIDO: Low, y por eso NO entra', () => {
  /*
   * El único lugar del archivo donde su nombre aparece, y con el JSON de la
   * base al lado --ver la prueba de arriba--. Si mañana la fuente lo pasa a
   * `High`, esta prueba se pone roja y obliga a volver a mirar; hoy afirma lo
   * que la base dice.
   */
  const otoniel = sf({ nombre: 'Otoniel Gomez', importance: 'Low', recruiter: 'Maria Guerrero' });
  assert.equal(groupOf(otoniel), null);
  assert.equal(exclusionReason(otoniel), 'no_prioritario');
});

prueba('Medium tampoco: el criterio es estrictamente High', () => {
  assert.equal(groupOf(sf({ importance: 'Medium' })), null);
});

prueba('⚠ sin importance es sin_triage, NO no_prioritario', () => {
  const e = sf({ nombre: 'Eniel Garcia de la Torre', importance: null });
  assert.equal(exclusionReason(e), 'sin_triage');
  assert.notEqual(exclusionReason(e), 'no_prioritario');
});

prueba('un reclutador de afuera no entra aunque sea High en Negotiation', () => {
  const x = sf({ importance: 'High', recruiter: 'Otra Persona' });
  assert.equal(groupOf(x), null);
  assert.equal(exclusionReason(x), 'otro_reclutador');
});

prueba('⚠ un importance desconocido cae del lado seguro', () => {
  // Compara por igualdad, no por "distinto de Low": un valor nuevo NO es prioritario.
  assert.equal(groupOf(sf({ importance: 'Critical' })), null);
});

console.log('\nGRUPO 2 — tablero de RRHH\n');

prueba('toda fila de hr_pipeline entra, sin mirar importance ni stage', () => {
  assert.equal(groupOf(rrhh()), 'hiring_process');
  assert.equal(groupOf(rrhh({ importance: 'Low' })), 'hiring_process');
});

prueba('el rótulo del grupo 2 es Hiring process', () => {
  assert.equal(GROUP_LABEL.hiring_process, 'Hiring process');
});

prueba('⚠ no se re-filtra "todavía no en el roster": ya lo hizo la vista', () => {
  // Una fila de hr_pipeline entra aunque no traiga nada más que el origen.
  assert.equal(groupOf(rrhh({ startDate: null, producira: false })), 'hiring_process');
});

console.log('\nLA FECHA Y SU SIGNIFICADO\n');

prueba('cada grupo usa su fecha, y el rótulo dice cuál', () => {
  const g1 = priorityDate(sf({ importance: 'High' }), 'salesforce_high', HOY);
  assert.equal(g1.date, '2026-09-30');
  assert.equal(g1.label, DATE_LABEL.salesforce_high);

  const g2 = priorityDate(rrhh(), 'hiring_process', HOY);
  assert.equal(g2.date, '2026-10-16');
  assert.equal(g2.label, DATE_LABEL.hiring_process);
});

prueba('⚠ Luis: cierre vencido se marca, no se excluye', () => {
  const luis = sf({ nombre: 'Luis Landaverde', importance: 'High', recruiter: 'Juanjo Cabrera', closeDate: '2024-06-14' });
  assert.equal(groupOf(luis), 'salesforce_high');
  assert.equal(priorityDate(luis, 'salesforce_high', HOY).overdue, true);
});

prueba('⚠ Jorge: ingreso pasado también se marca', () => {
  const jorge = rrhh({ nombre: 'Jorge Betancur', startDate: '2026-08-17', producira: false });
  assert.equal(groupOf(jorge), 'hiring_process');
  assert.equal(priorityDate(jorge, 'hiring_process', HOY).overdue, true);
});

prueba('una fecha futura no está vencida, y sin fecha es null y no false', () => {
  assert.equal(priorityDate(rrhh({ startDate: '2026-10-16' }), 'hiring_process', HOY).overdue, false);
  assert.equal(priorityDate(rrhh({ startDate: null }), 'hiring_process', HOY).overdue, null);
});

console.log('\nQUIÉN NO VA A PRODUCIR\n');

prueba('⚠ se rotula, no se saca', () => {
  const jorge = rrhh({ nombre: 'Jorge Betancur', producira: false });
  assert.equal(groupOf(jorge), 'hiring_process');
  assert.equal(willNotProduce(jorge), true);
  assert.equal(willNotProduce(rrhh()), false);
});

console.log('\nLOS DOS GRUPOS ARMADOS\n');

prueba('ordena por fecha ascendente y deja las sin fecha al final', () => {
  const g = buildPriorityGroups(
    [
      rrhh({ nombre: 'Tercero', startDate: '2026-10-16' }),
      rrhh({ nombre: 'Sin fecha', startDate: null }),
      rrhh({ nombre: 'Primero', startDate: '2026-08-17' }),
      rrhh({ nombre: 'Segundo', startDate: '2026-10-05' }),
    ],
    HOY,
  );
  assert.deepEqual(
    g.hiring_process.map((r) => r.nombre),
    ['Primero', 'Segundo', 'Tercero', 'Sin fecha'],
  );
});

prueba('el grupo 1 puede quedar VACÍO y eso no es un error', () => {
  const g = buildPriorityGroups([sf({ importance: 'Low' }), sf({ importance: 'Medium' })], HOY);
  assert.equal(g.salesforce_high.length, 0);
  assert.equal(g.excluded.length, 2);
});

prueba('las excluidas traen su motivo y las de hr_pipeline nunca se excluyen', () => {
  const g = buildPriorityGroups(
    [
      sf({ nombre: 'Victoria Zambrano', importance: 'High', stage: 'Closed Won' }),
      sf({ nombre: 'Eniel', importance: null }),
      rrhh({ nombre: 'Del tablero' }),
    ],
    HOY,
  );
  assert.equal(g.hiring_process.length, 1);
  assert.deepEqual(
    g.excluded.map((e) => [e.row.nombre, e.reason]),
    [
      ['Victoria Zambrano', 'fuera_de_negociacion'],
      ['Eniel', 'sin_triage'],
    ],
  );
});

console.log(
  fallas === 0 ? `\nSIN FALLAS\n` : `\n${fallas} FALLA(S)\n`,
);
process.exit(fallas === 0 ? 0 : 1);
