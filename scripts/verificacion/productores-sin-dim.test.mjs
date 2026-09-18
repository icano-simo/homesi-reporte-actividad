/*
 * ============================================================================
 * PRUEBA DE `productoresSinDim` — las dos ramas, sin tocar la base
 * ============================================================================
 *
 *   node scripts/verificacion/productores-sin-dim.test.mjs
 *   npm run verificar:productores:test
 *
 * ⚠ POR QUE EXISTE: el chequeo de verdad necesita credenciales y red, asi que
 * su rama verde y su rama roja no se pueden ejercitar en cualquier maquina --
 * y un chequeo que solo se vio salir con 2 no esta probado. Lo unico que se
 * puede probar en seco es la comparacion, que es justamente donde vive la
 * decision.
 *
 * Lo que esta prueba NO cubre, y queda dicho: la lectura de la base, el control
 * positivo sobre las dos lecturas, y las salidas 0/1/2. Esas se ejercitaron a
 * mano contra produccion el 2026-09-18 -- y la de «no pude medir» salio sola,
 * con un `42501 permission denied for table dim_employee`.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { productoresSinDim } = await import(
  pathToFileURL(resolve(AQUI, 'productores-sin-dim.mjs')).href
);
const { crearArnes } = await import(pathToFileURL(resolve(AQUI, 'guardas.mjs')).href);

const a = crearArnes({ minimo: 7 });

/* ── 1. Encuentra al que falta ──────────────────────────────────────────── */
{
  const productores = [
    { person_code: 'ana.manjarres', display_name: 'Ana Manjarres' },
    { person_code: 'arnaldo.ortega', display_name: 'Arnaldo Ortega Betancourt' },
  ];
  const dim = [{ person_code: 'ana.manjarres' }];
  const r = productoresSinDim(productores, dim);
  a.ck(r.length === 1, '⚠ encuentra al productor que no tiene fila: ' + r.length);
  a.ck(r[0].person_code === 'arnaldo.ortega', 'y dice cuál: ' + r[0]?.person_code);
}

/* ── 2. Y se queda callado cuando están todos ───────────────────────────── */
{
  const productores = [{ person_code: 'ana.manjarres' }, { person_code: 'galo.rizzo' }];
  const dim = [{ person_code: 'galo.rizzo' }, { person_code: 'ana.manjarres' }, { person_code: 'otra.persona' }];
  a.ck(productoresSinDim(productores, dim).length === 0,
    'con todos los productores en dim_employee no reporta nada');
}

/*
 * ── 3. Un `person_code` NULO no cuenta como conocido ────────────────────────
 * Es el caso Belkys: tenía fila en `dim_employee` con el `person_code` en NULL,
 * así que la fila existía y la persona no resolvía. Si los nulos entraran al
 * conjunto, un solo nulo del otro lado haría resolver a cualquiera.
 */
{
  const productores = [{ person_code: 'belkys.fernandez' }];
  const dim = [{ person_code: null }, { person_code: undefined }];
  const r = productoresSinDim(productores, dim);
  a.ck(r.length === 1,
    '⚠ una fila con `person_code` nulo NO hace resolver a nadie: ' + r.length);
}

/* ── 4. Los bordes, que es donde un `Set` vacío miente ──────────────────── */
{
  a.ck(productoresSinDim([], [{ person_code: 'x' }]).length === 0,
    'sin productores no hay nada que reportar');
  a.ck(productoresSinDim([{ person_code: 'x' }], []).length === 1,
    'y con `dim_employee` vacía TODOS faltan -- por eso el chequeo de verdad ' +
    'corta antes con un control positivo: esa lista larga sería un falso hallazgo');
}

/*
 * ── 5. No mira nada más que el `person_code` ────────────────────────────────
 * El nombre NO resuelve acá: para eso está `employee_alias`, que es otra
 * pregunta. Un chequeo que aceptara el nombre estaría prometiendo la
 * resolución de identidad completa, que es más de lo que puede sostener.
 */
{
  const productores = [{ person_code: 'arnaldo.ortega', display_name: 'Arnaldo Ortega Betancourt' }];
  const dim = [{ person_code: 'otro.codigo', full_name: 'Arnaldo Ortega Betancourt' }];
  a.ck(productoresSinDim(productores, dim).length === 1,
    'el nombre igual NO lo da por resuelto: esto cuenta `person_code` y nada más');
}

process.exitCode = a.resumen();
