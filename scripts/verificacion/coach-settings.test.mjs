/*
 * ============================================================================
 * LA LISTA DE COACH SETTINGS, PROBADA SIN NAVEGADOR Y SIN BASE — etapa RV35
 * ============================================================================
 *
 * `settings-modelo.ts` es puro: recibe las filas de `useReview` y devuelve lo
 * que la pantalla dibuja. Node importa el `.ts` directo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE IMPORTA MEDIR, Y POR QUE CADA COSA
 * ---------------------------------------------------------------------------
 * · LOS TRES FILTROS COMBINADOS, y no uno por vez. Dos filtros que funcionan
 *   por separado no dicen nada de los dos puestos a la vez: lo que se rompe es
 *   la Y, y el conteo de arriba respaldaria la lista equivocada.
 *
 * · QUE LAS PRACTICAS NUNCA ENTREN EN EL CONTEO DE LAS REALES. Hoy son 11 de
 *   42 contra la base, asi que el numero de arriba sobra por once.
 *
 * · ⚠ Y QUE LA SECCION DE INACTIVOS EXISTA AUNQUE HOY ESTE VACIA. Medido contra
 *   la base el 2026-10-02: los 12 branches con coachees tienen productor
 *   activo, asi que esa rama NO SE EJERCE con datos reales. Por eso la prueba
 *   la CONSTRUYE -- una rama que solo se vio vacia no esta probada, y es la
 *   misma razon por la que la prueba de Margins construye la omision.
 *
 * ---------------------------------------------------------------------------
 * LOS DATOS SALEN DE LA BASE, NO DE LA CABEZA
 * ---------------------------------------------------------------------------
 * Los conteos de referencia --42 asignaciones, 11 practicas, 11 revisores, 23
 * coachees en 12 branches-- se leyeron el 2026-10-02. El fixture es chico y
 * armado a mano, pero las aserciones que hablan de la forma del problema usan
 * esas proporciones.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const {
  estadoDe,
  filtrar,
  separarPracticas,
  agruparPorBranch,
  contarAgrupadas,
  SIN_FILTRO,
} = await import(pathToFileURL(resolve(RAIZ, 'lib/review/settings-modelo.ts')).href);

/** Una fila de `MyReview`, con lo unico que este modelo mira. */
const fila = (assignmentKey, loKey, loName, reviewer, { practica = false, sesion = null } = {}) => ({
  assignment: {
    assignment_key: assignmentKey,
    reviewer_employee_key: reviewer,
    lo_employee_key: loKey,
    due_on: '2026-10-31',
    is_active: true,
    is_practice: practica,
    created_at: '2026-09-01T00:00:00Z',
    created_by: 'x@y.z',
    updated_at: null,
    updated_by: null,
  },
  loName,
  session: sesion,
  responses: [],
  notes: [],
});

const sesion = (status) => ({
  session_key: 1,
  assignment_key: 1,
  lo_employee_key: 1,
  status,
  current_phase: 1,
  current_step_in_phase: 1,
  started_at: '2026-09-20T00:00:00Z',
  started_by: 'x@y.z',
  completed_at: status === 'completed' ? '2026-09-24T15:00:00Z' : null,
  is_practice: false,
});

const FILAS = [
  fila(1, 10, 'Ana Manjarres', 100, { sesion: sesion('completed') }),
  fila(2, 11, 'Luis Silva', 100, { sesion: sesion('in_progress') }),
  fila(3, 12, 'Jose Arango', 101),
  fila(4, 13, 'Ana Lopez', 101, { sesion: sesion('completed') }),
  fila(5, 14, 'Silvio Arteaga', 102, { practica: true }),
  fila(6, 15, 'Mariano Claudio', 100, { practica: true, sesion: sesion('in_progress') }),
  /*
   * ⚠ ESTA FILA LA AGREGO LA ASERCIÓN QUE FALLO. Puse a Mariano --que no tiene
   * branch-- como PRACTICA, y despues afirme que aparecia en el grupo de «sin
   * branch» de las REALES, donde no podia estar. La medicion estaba bien y la
   * expectativa mal; el caso que hacia falta es una asignacion real sin branch.
   */
  fila(7, 16, 'Fred Gomez', 102),
];

/*
 * 1 ancla + 3 de estado + 5 de filtros + 2 de practicas + 6 de agrupacion = 17.
 * Escrito a mano; decia 16 y la corrida dijo 18 -- que no es un corte temprano
 * sino lo contrario, asi que el numero se vuelve a contar en vez de subirlo.
 */
const a = crearArnes({ minimo: 17 });
try {
  a.ck(FILAS.length === 7 && FILAS.filter((f) => f.assignment.is_practice).length === 2,
    'ancla: el fixture tiene 7 filas, 2 de ellas practicas');

  /* ── El estado, derivado de la sesion ──────────────────────────────────── */
  a.ck(estadoDe(FILAS[0]) === 'completed', 'una sesion `completed` da `completed`');
  a.ck(estadoDe(FILAS[1]) === 'in_progress', 'una sesion en curso da `in_progress`');
  a.ck(estadoDe(FILAS[2]) === 'not_started',
    'y SIN sesion da `not_started`, que no es lo mismo que una sesion sin respuestas');

  /* ── Los filtros, de a uno y COMBINADOS ────────────────────────────────── */
  a.ck(filtrar(FILAS, SIN_FILTRO).length === 7, 'sin filtro no se filtra nada');
  a.ck(filtrar(FILAS, { ...SIN_FILTRO, coach: 100 }).length === 3,
    'por coach: las tres de 100');
  a.ck(filtrar(FILAS, { ...SIN_FILTRO, estado: 'completed' }).length === 2,
    'por estado: las dos completadas');
  a.ck(filtrar(FILAS, { ...SIN_FILTRO, busqueda: 'ana' }).length === 2,
    'la busqueda no distingue mayusculas y matchea por dentro: «ana» da Ana Manjarres y Ana Lopez');

  /*
   * ⚠ LOS TRES JUNTOS, que es lo que la pantalla ofrece. Coach 100 tiene tres
   * filas; completadas, una; y de esa, con «ana», sigue una. Si los filtros se
   * eligieran en vez de combinarse, esto daria 3, 2 o 2 -- nunca 1.
   */
  const combinado = filtrar(FILAS, { estado: 'completed', coach: 100, busqueda: 'ana' });
  a.ck(combinado.length === 1 && combinado[0].loName === 'Ana Manjarres',
    '⚠ LOS TRES FILTROS SE COMBINAN CON Y: ' + JSON.stringify(combinado.map((f) => f.loName)));

  /* Y una combinacion que no deja nada: el vacio tambien es una respuesta. */
  a.ck(filtrar(FILAS, { estado: 'not_started', coach: 100, busqueda: '' }).length === 0,
    'y una combinacion sin resultados da una lista vacia, no la lista entera');

  /* ── Las practicas, afuera del conteo de las reales ────────────────────── */
  const { reales, practicas } = separarPracticas(FILAS);
  a.ck(reales.length === 5 && practicas.length === 2,
    '⚠ LAS PRACTICAS NO ENTRAN EN EL CONTEO DE LAS REALES: ' +
      reales.length + ' reales y ' + practicas.length + ' practicas de ' + FILAS.length);
  a.ck(reales.every((f) => !f.assignment.is_practice) && practicas.every((f) => f.assignment.is_practice),
    'y ninguna queda de los dos lados');

  /* ── La agrupacion por branch ──────────────────────────────────────────── */
  const DE_BRANCH = { 10: '710', 11: '710', 12: '716', 13: '799', 14: '710', 15: null, 16: null };
  const branchDe = (k) => DE_BRANCH[k] ?? null;
  /* `799` esta en el roster y NO tiene productor activo: es el caso inactivo,
     que hoy no existe con datos reales. */
  const ROSTER = [
    { branch_code: '710', is_producer: true, is_active: true },
    { branch_code: '716', is_producer: true, is_active: true },
    { branch_code: '799', is_producer: false, is_active: true },
  ];

  const g = agruparPorBranch(reales, branchDe, ROSTER);
  a.ck(g.activos.map((x) => x.branch).join(',') === '710,716',
    'los branches con productor activo van primero y ordenados: ' +
      JSON.stringify(g.activos.map((x) => x.branch)));
  a.ck(g.inactivos.length === 1 && g.inactivos[0].branch === '799',
    '⚠ Y EL INACTIVO VA DESPUES -- rama construida a proposito, porque hoy los ' +
      '12 branches con coachees tienen productor: ' + JSON.stringify(g.inactivos.map((x) => x.branch)));
  a.ck(g.sinBranch !== null && g.sinBranch.filas.length === 1 &&
       g.sinBranch.filas[0].loName === 'Fred Gomez',
    'y quien no tiene branch no desaparece: queda en su propio grupo');

  /*
   * ⚠ NINGUNA FILA SE PIERDE NI SE CUENTA DOS VECES. Es la misma guarda que las
   * cuatro salidas con `continue` de `seccionesDeBranch`: cada seccion se ve
   * bien por su cuenta aunque el total no cierre.
   */
  a.ck(contarAgrupadas(g) === reales.length,
    'el conteo de lo agrupado es el de las reales: ' + contarAgrupadas(g) + ' de ' + reales.length);
  const claves = [...g.activos, ...g.inactivos, ...(g.sinBranch ? [g.sinBranch] : [])]
    .flatMap((x) => x.filas.map((f) => f.assignment.assignment_key));
  a.ck(new Set(claves).size === claves.length,
    'y ninguna asignacion aparece en dos grupos: ' + JSON.stringify(claves));

  /* Y agrupar DESPUES de filtrar da lo filtrado, no la lista entera. */
  const soloDe100 = separarPracticas(filtrar(FILAS, { ...SIN_FILTRO, coach: 100 })).reales;
  a.ck(contarAgrupadas(agruparPorBranch(soloDe100, branchDe, ROSTER)) === 2,
    'agrupar lo filtrado no reintroduce lo que el filtro saco: ' + soloDe100.length);
} finally {
  process.exitCode = a.resumen();
}
