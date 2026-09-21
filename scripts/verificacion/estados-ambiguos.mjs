/*
 * ============================================================================
 * LOS ESTADOS DE TRES VALORES, Y EL VALOR QUE NO SE PUEDE ESCRIBIR
 * ============================================================================
 *
 * Sale del séptimo caso de «Lo que compensa una ausencia» en `AGENTS.md`, y de
 * la vez que ese caso costó tres personas trabadas en el mismo paso.
 *
 * Cuando un estado pasa de dos valores a tres --`undefined` = «no lo sé»,
 * `null` = «se leyó y no hay», un valor = «hay»-- el arreglo NO es cambiar su
 * declaración. Es que ningún camino vuelva a escribir el valor ambiguo:
 *
 *   > Un estado que significa «no lo sé» no se arregla en su valor inicial.
 *   > Se arregla eliminando TODOS los lugares que pueden escribirlo.
 *
 * `funnelActual` se arregló dos veces por eso. La primera se le puso
 * `undefined` como valor inicial y quedó viva esta línea:
 *
 *     if (loEnCurso === null) setFunnelActual(null);   // «no sé a quién reviso»
 *
 * que reintroducía el `null` ambiguo en cada carga. El efecto que vigila la
 * activación del funnel leía ese `null → valor` como «se acaba de activar»: en
 * el catálogo sacaba a la persona de donde tenía que elegir, y en el perfil
 * navegaba a la pantalla donde ya estaba, en bucle.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ ES UN ARCHIVO Y NO UNA NOTA
 * ---------------------------------------------------------------------------
 * Porque la nota ya estaba, en la forma «no vino no es vino vacío», y no
 * alcanzó: el caso 6 y el caso 7 son el MISMO estado. Una guarda que hay que
 * recordar se usa igual que una nota — por eso corre con `npm run
 * verificar:estados` y no vive en el scratchpad de una sesión.
 *
 * Y mira el CÓDIGO y no el archivo: los comentarios de arriba nombran
 * `setFunnelActual(null)` a propósito, para explicar por qué está prohibido.
 * Eso es lo que `exigirAusente` existe para no confundir.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearArnes, exigirAusente } from './guardas.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Un estado de tres valores, y lo que NO se le puede asignar.
 *
 * `porque` no es decoración: es lo que le dice al próximo lector si la regla
 * sigue teniendo sentido, o si el estado dejó de tener tres valores y esta fila
 * se puede borrar.
 */
const ESTADOS = [
  {
    archivo: 'components/review/ReviewMaskHost.tsx',
    estado: 'funnelActual',
    prohibidos: ['setFunnelActual(null)'],
    porque:
      '`undefined` = todavía no se leyó, `null` = se leyó y no tiene funnel. ' +
      'Escribir `null` para decir «no sé a quién se revisa» hace que el retorno ' +
      'al lugar del paso se dispare en cada carga.',
  },
  {
    archivo: 'app/business-plan/lo/[employeeKey]/funnel/page.tsx',
    estado: 'lo (la persona, de la población del módulo)',
    /*
     * ⚠ LO PROHIBIDO ES LA CADENA OPCIONAL, no el `?? null`.
     *
     * `bpData.loanOfficers.find(...) ?? null` --sin `?`-- es correcto y está en
     * el código: ahí `null` significa «se leyó y no está», que es justo la
     * distinción que se quiere. Lo que colapsa los dos estados es el `bpData?.`:
     * con la población todavía viajando devuelve `undefined`, y el `??` lo pasa
     * a `null` como si se hubiera leído.
     *
     * Primera versión de esta fila prohibía el fragmento sin el prefijo y
     * marcaba el código ya arreglado. Una guarda que no distingue el arreglo
     * del defecto no sirve.
     */
    prohibidos: ['bpData?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null'],
    porque:
      '`undefined` = la población no llegó, `null` = llegó y la persona no está. ' +
      'Con el `?? null` los dos eran `null`, y la pantalla contestaba «This person ' +
      'is not in the Business Plan population... They need a branch assignment ' +
      'first»: una afirmación sobre el roster, con una instrucción accionable, ' +
      'dicha sin haber leído el roster.',
  },
];

/**
 * DOS ESTADOS QUE SALEN DE UNA MISMA LECTURA SE ESCRIBEN JUNTOS.
 *
 * Es el mismo mecanismo que el de arriba, corrido un lugar: allá el problema
 * es un valor que miente; acá son dos valores que dicen la verdad en momentos
 * distintos, y la ventana entre uno y otro es una mentira igual.
 *
 * El caso: `funnelActual` y `pasosDelPlan` salen de la misma consulta a
 * `enrollment`, pero `setFunnelActual` estaba DOS consultas antes que
 * `setPasosDelPlan`. Al ejercer «Change it» por primera vez, la evidencia
 * quedó con el `funnel_name` del plan nuevo y el `enrollment_key` del viejo
 * --el que `cancel_funnel` acababa de borrar-- o sea una referencia colgada
 * dentro del registro que existe justamente para poder volver.
 *
 * La forma checkeable es contar los sitios: si los dos se publican siempre en
 * el mismo lugar, hay tantas llamadas de uno como del otro. Antes del arreglo
 * eran dos y tres, y eso alcanzaba para verlo.
 *
 * ⚠ No prueba que estén ADYACENTES, y no puede: eso pide leer el flujo. Prueba
 * que no haya un camino que publique uno solo, que es como se abre la ventana.
 */
const PAREJAS = [
  {
    archivo: 'components/review/ReviewMaskHost.tsx',
    setters: ['setFunnelActual(', 'setPasosDelPlan('],
    porque:
      'los dos describen al MISMO plan activo y salen de la misma lectura de ' +
      'enrollment: publicar uno sin el otro deja al panel afirmando el nombre ' +
      'nuevo con la clave vieja.',
  },
];

const a = crearArnes({ minimo: ESTADOS.length + PAREJAS.length });
try {
  for (const p of PAREJAS) {
    const texto = readFileSync(resolve(RAIZ, p.archivo), 'utf8');
    const cuenta = p.setters.map((s) => texto.split(s).length - 1);
    a.ck(
      cuenta[0] > 0 && cuenta[0] === cuenta[1],
      '`' + p.setters[0] + '` y `' + p.setters[1] + '` se escriben en los mismos ' +
        'lugares de ' + p.archivo + ': ' + cuenta[0] + ' y ' + cuenta[1]
    );
    if (cuenta[0] === cuenta[1]) console.log('       por qué: ' + p.porque);
  }
  for (const e of ESTADOS) {
    const texto = readFileSync(resolve(RAIZ, e.archivo), 'utf8');
    let error = null;
    try {
      exigirAusente(texto, e.prohibidos, { lenguaje: 'ts', donde: e.archivo });
    } catch (err) {
      error = err.message;
    }
    a.ck(
      error === null,
      '`' + e.estado + '` no recibe su valor ambiguo en ningún camino de ' +
        e.archivo + (error === null ? '' : ' — ' + error)
    );
    if (error === null) console.log('       por qué: ' + e.porque);
  }
} finally {
  process.exitCode = a.resumen();
}
