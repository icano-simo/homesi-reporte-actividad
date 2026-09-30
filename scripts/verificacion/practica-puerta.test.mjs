/*
 * ============================================================================
 * PRUEBA DE LA PUERTA DE ESCRITURA (RV24) — y de que el registro esté completo
 * ============================================================================
 *
 *   node scripts/verificacion/practica-puerta.test.mjs
 *   npm run verificar:practica
 *
 * Dos cosas, y la segunda es la que justifica que esto exista:
 *
 *   1. las dos ramas de `decidirDestino`, y que `valorDePractica` devuelva
 *      `undefined` --y no un default-- cuando no hay nada guardado;
 *   2. que NINGUNA de las tres funciones que escriben hacia afuera se importe
 *      desde un archivo que no sea el suyo o la puerta.
 *
 * La (2) es la que atrapa al cuarto paso. Una puerta que nadie esta obligado a
 * usar es una convencion, y este repo tiene tres casos escritos de que una
 * herramienta que hay que recordar se usa igual que una nota.
 *
 * ⚠ Y MIRA EL CÓDIGO, NO EL ARCHIVO: los comentarios de `puertaDeEscritura.ts`
 * nombran las tres tablas a proposito, para explicar por que estan prohibidas.
 * Es exactamente lo que `exigirAusente` existe para no confundir.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const { crearArnes, sinComentarios } = await import(
  pathToFileURL(resolve(AQUI, 'guardas.mjs')).href
);

/*
 * ⚠ El módulo bajo prueba se carga por su ruta `.ts`, que Node corre nativo
 * desde la 22. Si algún día no lo hiciera, esto tiene que FALLAR y no saltearse
 * -- un `catch` que sigue de largo es el arnés que imprime verde sin correr.
 */
const puerta = await import(pathToFileURL(resolve(RAIZ, 'lib/review/puertaDeEscritura.ts')).href);
const { decidirDestino, valorDePractica, PASOS_QUE_ESCRIBEN } = puerta;

const a = crearArnes({ minimo: 23 });

/* ── 1. La rama real ─────────────────────────────────────────────────────── */
{
  const d = decidirDestino({ esPractica: false, sessionKey: 9 }, '1.2', 3);
  a.ck(d.modo === 'real', 'una sesión real escribe hacia afuera: ' + d.modo);
  a.ck(d.gate === undefined, 'y no devuelve gate: no hay nada que guardar en la sesión');
}

/* ── 2. La rama de práctica, en los tres pasos ───────────────────────────── */
{
  const d = decidirDestino({ esPractica: true, sessionKey: 9 }, '1.2', 3);
  a.ck(d.modo === 'practica', '⚠ una práctica NO escribe hacia afuera: ' + d.modo);
  a.ck(JSON.stringify(d.gate) === '{"practica":{"benchmark":3}}',
    'y el valor viaja en el gate, bajo `practica`: ' + JSON.stringify(d.gate));
}
{
  const d = decidirDestino({ esPractica: true, sessionKey: 9 }, '2.2', { own: 2 });
  a.ck(JSON.stringify(d.gate) === '{"practica":{"budget":{"own":2}}}',
    'el paso del presupuesto guarda su objeto entero: ' + JSON.stringify(d.gate));
}
{
  const d = decidirDestino({ esPractica: true, sessionKey: 9 }, '3.1', 21);
  a.ck(JSON.stringify(d.gate) === '{"practica":{"funnel":21}}',
    'y el del funnel su clave: ' + JSON.stringify(d.gate));
}

/* ── 3. La lectura, que es donde vive la propiedad del diseño ────────────── */
{
  a.ck(valorDePractica({ practica: { benchmark: 3 } }, '1.2') === 3,
    'lee el valor que la práctica guardó');
  a.ck(valorDePractica({ clicks: ['a'] }, '1.2') === undefined,
    '⚠ sin valor de práctica devuelve `undefined` y NO un default: quien llama cae al REAL');
  a.ck(valorDePractica(null, '1.2') === undefined, 'un gate nulo no rompe');
  a.ck(valorDePractica({ practica: { budget: 1 } }, '1.2') === undefined,
    'y el valor de OTRO paso no se lee como propio: son claves distintas');
}

/* ── 4. El registro contra los pasos que la base declara ─────────────────── */
{
  const claves = Object.keys(PASOS_QUE_ESCRIBEN).sort();
  a.ck(JSON.stringify(claves) === '["1.2","2.2","3.1"]',
    'el registro tiene los tres pasos que escriben: ' + claves.join(', '));
  /*
   * El `gate_kind` de los pasos vive en el SQL versionado. `number` y `budget`
   * son los dos que abren un editor que escribe; `comment` y `clicks` no.
   * El 3.1 es `comment` y escribe igual --se escribe en otra pantalla-- y por
   * eso esta lista no se DERIVA del `gate_kind`: se declara, y se compara.
   */
  const sql = readFileSync(resolve(RAIZ, 'docs/sql/2026-09-review-mode.sql'), 'utf8');
  const kinds = [...sql.matchAll(/\((\d), (\d), '[^']*',\s*'(\w+)'/g)]
    .map((m) => ({ paso: m[1] + '.' + m[2], kind: m[3] }));
  a.ck(kinds.length === 8, 'el guion tiene ocho pasos: ' + kinds.length);
  const escritores = kinds.filter((k) => k.kind === 'number' || k.kind === 'budget').map((k) => k.paso);
  a.ck(escritores.every((p) => p in PASOS_QUE_ESCRIBEN),
    '⚠ todo paso con `gate_kind` de escritura está en el registro: ' + escritores.join(', '));
}

/* Los archivos del árbol, una sola vez: los usan los bloques 5 y 6. */
const archivos = [];

/* ── 5. Que nadie escriba por afuera de la puerta ────────────────────────── */
{
  /*
   * Los tres escritores, y los únicos archivos que pueden nombrarlos. Se lee el
   * CÓDIGO sin comentarios: la puerta los nombra en su cabecera a propósito.
   */
  const ESCRITORES = [
    { nombre: 'fijarBenchmark', permitidos: ['lib/business-plan/benchmark.ts', 'app/business-plan/components/BenchmarkEditor.tsx', 'components/review/ReviewStepPanel.tsx'] },
    { nombre: 'escribirPresupuesto', permitidos: ['lib/outlook/save.ts'] },
    /*
     * ⚠ La tercera entrada la agregó LA GUARDA, no yo: escribí la lista de
     * memoria con dos archivos y el chequeo encontró un tercero,
     * `lo/[employeeKey]/funnel/page.tsx`. Se eximió después de mirarlo --es la
     * pantalla que POSEE la activación, la misma a la que el paso 3.1 navega
     * con `?change=`-- y no por molestia. Ésa es la diferencia entre eximir y
     * silenciar.
     */
    { nombre: 'activate_funnel', permitidos: ['app/business-plan/lo/[employeeKey]/funnel/page.tsx'] },
  ];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next' || e === '.git') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.(ts|tsx)$/.test(p)) archivos.push(p);
    }
  };
  for (const d of ['lib', 'app', 'components']) recorrer(resolve(RAIZ, d));

  for (const esc of ESCRITORES) {
    const usan = archivos
      .filter((p) => sinComentarios(readFileSync(p, 'utf8'), 'ts').includes(esc.nombre))
      .map((p) => relative(RAIZ, p).replace(/\\/g, '/'));
    const deMas = usan.filter((p) => !esc.permitidos.includes(p));
    a.ck(deMas.length === 0,
      '`' + esc.nombre + '` sólo se nombra donde corresponde' +
      (deMas.length ? ' — de más: ' + deMas.join(', ') : ' (' + usan.length + ' archivos)'));
    /*
     * ⚠ Y LA MITAD CONTRARIA: un permitido que ya no nombra la función es un
     * permiso muerto, y un permiso muerto es una exención que nadie volvió a
     * justificar -- exactamente el respaldo que nunca se ejerce. Si el archivo
     * se renombró, esta lista miente y hay que arreglarla, no ampliarla.
     */
    const muertos = esc.permitidos.filter((p) => !usan.includes(p));
    a.ck(muertos.length === 0,
      'y ningún permitido de `' + esc.nombre + '` quedó sin usarla' +
      (muertos.length ? ' — muertos: ' + muertos.join(', ') : ''));
  }
}

/* ── 6. Que nadie colapse el tercer estado del contexto ──────────────────── */
{
  /*
   * ⚠ `contextoDeEscritura` tiene TRES estados --`undefined` no se sabe, `null`
   * app normal, objeto recorriendo-- y la forma de destruirlo es una cadena
   * opcional:
   *
   *     if (ctx?.esPractica) { ... }        // `undefined` -> falsy -> REAL
   *
   * Eso convierte «todavía no sé» en «es real» y escribe en la tabla de negocio
   * durante el primer cuadro de cada carga. Es el caso de `funnelActual`, que
   * en este repo costó tres personas trabadas en el mismo paso.
   *
   * Lo prohibido es la CADENA OPCIONAL sobre ese nombre, no el nombre: quien lo
   * necesita tiene que estrechar antes --`if (ctx === undefined) return`-- y
   * eso se lee distinto. Es la misma distinción que la fila de `bpData?.` en
   * `estados-ambiguos.mjs`: ahí también lo prohibido era el `?.` y no el `??`.
   */
  const malos = archivos
    .filter((p) => /contextoDeEscritura\s*\?\./.test(sinComentarios(readFileSync(p, 'utf8'), 'ts')))
    .map((p) => relative(RAIZ, p).replace(/\\/g, '/'));
  a.ck(malos.length === 0,
    '⚠ nadie lee `contextoDeEscritura` con cadena opcional: `undefined` no puede ' +
    'leerse como «es real»' + (malos.length ? ' — ' + malos.join(', ') : ''));

  /* Y que el proveedor siga declarando los tres, no dos. */
  const prov = sinComentarios(
    readFileSync(resolve(RAIZ, 'components/review/ReviewProvider.tsx'), 'utf8'), 'ts');
  a.ck(/contextoDeEscritura:\s*ContextoDeSesion\s*\|\s*null\s*\|\s*undefined/.test(prov),
    'el contexto declara los TRES estados en su tipo, no dos');
}

/* ── 7. Que la sesión recorrida siga siendo una ELECCIÓN ─────────────────── */
{
  /*
   * ⚠ El defecto que RV25 arregló no era un `if` suelto: era un respaldo que se
   * leía como razonable -- «la primera en curso de la que no salí». Con una
   * sola revisión abierta da la respuesta correcta, así que nada falla hasta
   * que alguien tiene tres. Y desde RV24 esa elección decide si una escritura
   * es real o de práctica.
   *
   * Las tres aserciones miran el CÓDIGO sin comentarios: el módulo nuevo nombra
   * `rv-exited` y `maskExit` en su cabecera a propósito, para contar qué
   * reemplazó.
   */
  const conMaskExit = archivos
    .filter((p) => /maskExit|rv-exited/.test(sinComentarios(readFileSync(p, 'utf8'), 'ts')))
    .map((p) => relative(RAIZ, p).replace(/\\/g, '/'));
  a.ck(conMaskExit.length === 0,
    '⚠ la llave vieja `rv-exited` no volvió: dos llaves contestando cuál se ' +
    'recorre divergen' + (conMaskExit.length ? ' — ' + conMaskExit.join(', ') : ''));

  const prov = sinComentarios(
    readFileSync(resolve(RAIZ, 'components/review/ReviewProvider.tsx'), 'utf8'), 'ts');
  a.ck(/session_key === elegida/.test(prov),
    '⚠ `recorriendo` se compara contra la sesión ELEGIDA, no se busca la primera');
  /*
   * ⚠ ACÁ HABÍA UNA TERCERA ASERCIÓN Y SE SACÓ, no por molestia: no mordía.
   *
   * Decía «no quedó un `find` que tome la primera en curso» con el patrón
   * `find\([^)]*status === 'in_progress'\s*\)`. Ejercitada contra el proveedor
   * ANTERIOR --que tenía exactamente ese defecto-- pasó en verde: el `find`
   * viejo seguía con `&& !salio(...)` antes del paréntesis, así que el patrón
   * no llegaba. Era una aserción que no podía fallar, y ésas son peores que
   * ninguna porque ocupan el lugar de una que sí mide.
   *
   * Las dos de arriba SÍ mordieron contra ese mismo código: `2 FALLAS de 24`.
   * Entre las dos cubren el caso --la llave vieja ausente y la comparación
   * contra la elegida presente-- sin depender de adivinar cómo se escribió el
   * `find`, que es una regla sobre la forma del texto.
   */
}

process.exitCode = a.resumen();
