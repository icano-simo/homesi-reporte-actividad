/*
 * ============================================================================
 * UN PRODUCTOR DEL ROSTER SIN FILA EN `org.dim_employee`
 * ============================================================================
 *
 *   node scripts/verificacion/productores-sin-dim.mjs
 *   npm run verificar:productores
 *
 * ── QUE CUENTA, Y SOLO ESO ──────────────────────────────────────────────────
 *
 * Personas ACTIVAS del roster con `is_producer = true` que no tienen fila en
 * `org.dim_employee` por `person_code`. Nada mas.
 *
 * ⚠ NO comprueba que «todo el roster resuelva». Eso seria una regla mas ancha
 * de lo que se puede sostener: hoy hay cinco personas activas sin fila --dos LO
 * Assistant, un Business Development, una Administrative Assistant y una de
 * Janitorial Services-- que no producen, y ninguna rompe nada. Convertir eso en
 * rojo seria un aviso que aparece cuando no falta nada, y esos se aprenden a
 * ignorar.
 *
 * ── POR QUE ESTE ESTADO Y NO OTRO ───────────────────────────────────────────
 *
 * Porque no se ve hasta que es tarde. Un productor sin fila en `dim_employee`
 * funciona perfecto mientras no cierre un prestamo: aparece en el roster, en el
 * tablero y en su branch. El dia que cierra uno, la atribucion no encuentra a
 * quien colgarselo -- y ese dia el numero ya salio mal en una pantalla que
 * alguien mira.
 *
 * El caso que la motivo: Arnaldo Ortega Betancourt, LOAN OFFICER del 710, con
 * `is_producer` y CERO prestamos. Medido el 2026-09-18.
 *
 * ── ⚠ ESTA ES LA UNICA VERIFICACION DEL REPO QUE TOCA LA BASE ───────────────
 *
 * Las otras no la tocan a proposito --reciben el `page` por argumento-- para
 * que la sonda que se autentica contra produccion siga viviendo afuera. Esta no
 * puede: la pregunta ES sobre el dato.
 *
 * Lee con `SUPABASE_SERVICE_ROLE_KEY` de `.env.local`, y SOLO lee. No es un
 * grant nuevo: `service_role` ya tiene `usage` sobre `org` --es uno de los tres
 * esquemas anteriores a esta serie-- y no sobre `outlook`, `business_plan` ni
 * `review`, que siguen sin otorgarse por decision del 2026-09-09.
 *
 * ── Y SI NO PUEDE MEDIR, NO DICE VERDE ──────────────────────────────────────
 *
 * Sale con 2 y lo dice. Es la leccion del arnes que imprimia `SIN FALLAS` sin
 * haber corrido una asercion: cero problemas sobre cero filas se ve igual que
 * cero problemas sobre 111. Por eso hay un control positivo --las dos lecturas
 * tienen que traer filas-- antes de afirmar nada.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Los productores que no tienen fila. Pura a proposito: es la unica parte que
 * se puede probar sin la base, y las dos ramas --encuentra / no encuentra--
 * tienen que estar ejercitadas. Ver `productores-sin-dim.test.mjs`.
 *
 * ⚠ `person_code` nulo en `dim_employee` NO cuenta como conocido: hay filas
 * con el nulo --Belkys era una-- y tratarlas como si resolvieran haria que una
 * persona sin enlazar pase por enlazada, que es el caso que esto busca.
 *
 * @param {{person_code: string}[]} productores
 * @param {{person_code: string|null}[]} dim
 */
export function productoresSinDim(productores, dim) {
  const conocidos = new Set(dim.map((d) => d.person_code).filter((c) => c !== null && c !== undefined));
  return productores.filter((p) => !conocidos.has(p.person_code));
}

/* Lo de abajo sólo corre cuando se ejecuta el archivo, no al importarlo. */
const ESTE = fileURLToPath(import.meta.url);
const EJECUTADO =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === resolve(ESTE).toLowerCase();
if (!EJECUTADO) {
  /* Importado por su prueba: no se lee `.env.local` ni se toca la red. */
} else {
  await principal();
}

async function principal() {

const RAIZ = resolve(dirname(ESTE), '..', '..');
const ENV = resolve(RAIZ, '.env.local');

/** No pudo medir. Nunca es 0: un «no sé» que sale con 0 es un verde falso. */
function noPuedoMedir(porque) {
  console.error('** NO PUDE MEDIR ** ' + porque);
  console.error('Esto NO es «no hay productores sin fila»: es que no se pudo preguntar.');
  process.exit(2);
}

if (!existsSync(ENV)) {
  noPuedoMedir('no existe `.env.local`. Este chequeo lee la base y necesita credenciales.');
}
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const CLAVE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !CLAVE) {
  noPuedoMedir('falta `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`.');
}

const leer = async (tabla, query) => {
  let r;
  try {
    r = await fetch(URL_ + '/rest/v1/' + tabla + '?' + query, {
      headers: { apikey: CLAVE, Authorization: 'Bearer ' + CLAVE, 'Accept-Profile': 'org' },
    });
  } catch (e) {
    noPuedoMedir('no se pudo llegar a la base leyendo `' + tabla + '`: ' + String(e).slice(0, 120));
  }
  const cuerpo = await r.json().catch(() => null);
  if (!Array.isArray(cuerpo)) {
    noPuedoMedir(
      '`org.' + tabla + '` no devolvió filas (' + r.status + '): ' + JSON.stringify(cuerpo).slice(0, 160)
    );
  }
  return cuerpo;
};

const productores = await leer(
  'roster_current',
  'select=person_code,display_name,branch_code,position&is_active=eq.true&is_producer=eq.true&limit=2000'
);
const dim = await leer('dim_employee', 'select=person_code&limit=5000');

/*
 * ⚠ CONTROL POSITIVO. Una de las dos lecturas vacía --por RLS, por un GRANT, o
 * porque alguien renombró la tabla-- daría CERO productores sin fila, que es
 * exactamente el resultado que este chequeo busca. Cero filas con `error: null`
 * no es una tabla vacía.
 */
if (productores.length === 0) {
  noPuedoMedir('la lectura del roster trajo CERO productores activos, que no puede ser.');
}
if (dim.length === 0) {
  noPuedoMedir('la lectura de `dim_employee` trajo CERO filas, que no puede ser.');
}

const huerfanos = productoresSinDim(productores, dim);

console.log(
  'productores activos: ' + productores.length + ' · filas en dim_employee: ' + dim.length
);

if (huerfanos.length === 0) {
  console.log('SIN FALLAS: los ' + productores.length + ' productores del roster tienen fila en `org.dim_employee`.');
  process.exit(0);
}

console.log('');
console.log(
  '** ' + huerfanos.length + ' PRODUCTOR' + (huerfanos.length === 1 ? '' : 'ES') +
    ' DEL ROSTER SIN FILA EN `org.dim_employee` **'
);
for (const p of huerfanos) {
  console.log(
    '  ' + p.display_name + '  ·  branch ' + (p.branch_code ?? '—') +
      '  ·  ' + (p.position ?? '—') + '  ·  person_code ' + p.person_code
  );
}
console.log('');
console.log('Hoy no rompe nada si no cerró ningún préstamo. El día que cierre uno, la');
console.log('atribución no va a encontrar a quién colgárselo -- y para entonces el número');
console.log('ya salió mal en una pantalla. Se agrega la fila como en');
console.log('`docs/sql/2026-09-roster-sin-dim-employee.sql`.');
process.exit(1);

}
