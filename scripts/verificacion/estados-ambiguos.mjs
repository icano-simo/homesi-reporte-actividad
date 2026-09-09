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
];

const a = crearArnes({ minimo: ESTADOS.length });
try {
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
