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

const a = crearArnes({ minimo: 36 });

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

/* ── 8. Que una práctica se pueda CREAR y REINICIAR — etapa RV27 ─────────── */
{
  /*
   * ⚠ ESTAS CINCO MIRAN LO QUE RV24..RV26 DEJARON A MEDIAS, y las cinco muerden
   * contra `rv/practica-marcas` (f542ede). Ejercitadas contra ese commit --el
   * que tuvo el defecto de verdad, no una violación inventada-- dan rojo.
   *
   * El defecto tenía dos mitades y ninguna se veía desde la pantalla:
   *
   *   · `is_practice` no se podía poner desde ningún lado: el formulario de
   *     `Coach settings` no lo ofrecía;
   *   · y aunque se pusiera a mano, `arrancarOSeguir` insertaba la sesión SIN
   *     la marca. La FK compuesta contra `(assignment_key, is_practice)` la
   *     rechazaba con `23503` -- medido contra producción, sobre una asignación
   *     de práctica construida para eso. O sea que `Start practice` no podía
   *     funcionar, y el grupo de la lista prometía algo imposible.
   */
  const acciones = sinComentarios(readFileSync(resolve(RAIZ, 'lib/review/actions.ts'), 'utf8'), 'ts');
  const arranque = sinComentarios(
    readFileSync(resolve(RAIZ, 'app/review/[assignmentKey]/page.tsx'), 'utf8'), 'ts');
  const ajustes = sinComentarios(
    readFileSync(resolve(RAIZ, 'app/review/settings/page.tsx'), 'utf8'), 'ts');

  a.ck(/is_practice:\s*esPractica/.test(acciones),
    '⚠ la sesión nueva lleva la marca: sin ella la FK compuesta la rechaza con 23503');
  a.ck(/fila\.assignment\.is_practice/.test(arranque),
    '⚠ y la marca sale de la ASIGNACIÓN, que es la única fuente que la FK acepta');
  a.ck(/is_practice:\s*esPractica/.test(ajustes),
    '⚠ el formulario de Coach settings puede crear una práctica');

  /*
   * La otra mitad del contrato, que es la que este repo ya pagó tres veces: una
   * función aplicada en la base y sin un solo llamador. `reiniciar_practica`
   * estaba así desde RV24, y la lista decía «you can restart one as many times
   * as you need».
   */
  a.ck(/reiniciar_practica/.test(acciones),
    'la acción del reinicio llama a la función de la base');
  const llaman = archivos
    .filter((p) => /[\\/]app[\\/]/.test(p))
    .filter((p) => sinComentarios(readFileSync(p, 'utf8'), 'ts').includes('reiniciarPractica'))
    .map((p) => relative(RAIZ, p).replace(/\\/g, '/'));
  a.ck(llaman.length > 0,
    '⚠ y alguna pantalla la llama: una función sin llamador es una capacidad que ' +
    'la app promete y no tiene' + (llaman.length ? ' — ' + llaman.join(', ') : ''));

  /*
   * Y que el reinicio cuente lo que borró. Un `rpc` que corrió sobre una sesión
   * que ya no estaba devuelve `error: null`, así que sin mirar el número la
   * pantalla diría «listo» sobre cero filas -- el `update` sin `returning`,
   * otra vez, y van varias.
   */
  a.ck(/sesiones_borradas/.test(acciones),
    '⚠ y mira cuántas filas borró, no sólo `error`: cero con `error: null` es el silencio de siempre');
}

/* ── 9. Que la compuerta DOMINE a cada escritura, no que exista ──────────── */
{
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ LA GUARDA DE ARRIBA DABA VERDE SOBRE CUATRO FUGAS — etapa RV28
   * ══════════════════════════════════════════════════════════════════════════
   *
   * El bloque 5 pregunta QUIÉN NOMBRA a los escritores, y eso estaba bien: los
   * tres seguían viviendo donde debían. Lo que no preguntaba es si la pantalla
   * que los llama CONSULTA la puerta antes, y en tres de cuatro no lo hacía:
   *
   *   PersonBudgetEditor  savePersonBudget             chequeo dentro de su `if`
   *                       confirmPersonBudgetReviewed  FUERA de ese `if`
   *                       releasePersonBudgetToRule    otro handler, sin nada
   *   BenchmarkEditor     fijarBenchmark               sin nada
   *
   * Lo encontró Isabella usándolo: durante su práctica sobre Mariano,
   * `Confirm as reviewed` escribió tres filas reales en `outlook.budget_total`
   * a las 19:06:03. Una prueba escrita desde el código no podía verlo, porque
   * el código decía exactamente eso.
   *
   * ⚠ Y POR QUÉ NO ALCANZA CON «el archivo menciona esPractica»: el archivo del
   * presupuesto LO MENCIONABA. La propiedad que hace falta es de DOMINANCIA --
   * que la compuerta se ejecute sí o sí antes de la escritura.
   *
   * ⚠⚠ Y LA PRIMERA VERSIÓN DE ESTA ASERCIÓN NO ATRAPÓ EL CASO DE ISABELLA.
   *
   * Decía «la compuerta antes en el texto y no más anidada que la escritura»,
   * comparando PROFUNDIDADES. Medido sobre el archivo con el defecto: la
   * compuerta estaba en profundidad 4 y `confirmPersonBudgetReviewed` TAMBIÉN
   * en 4 -- son dos `if` HERMANOS dentro del mismo `try`, y dos hermanos tienen
   * la misma profundidad sin que ninguno domine al otro. Marcó las dos fugas
   * que no tenían compuerta y dejó pasar justo la que se ejerció.
   *
   * Es la trampa que este repo lleva documentada siete veces, cometida dentro
   * de la guarda escrita contra ella: **una regla sobre la FORMA del texto en
   * vez de sobre su significado.** La profundidad describe cómo se ve el
   * anidamiento; no dice qué se ejecuta antes que qué.
   *
   * Lo que sí lo dice: entre la compuerta y la escritura, la profundidad NUNCA
   * baja de la de la compuerta. Si baja, es que un bloque que contenía a la
   * compuerta se cerró en el medio -- y entonces la escritura está en otra
   * rama. Eso es control de flujo, no forma.
   *
   * Las llaves se cuentan sobre el código sin comentarios. Las de los template
   * literals (`${...}`) están balanceadas y no corren la cuenta; una llave
   * suelta dentro de una cadena sí lo haría, y no hay ninguna en estos archivos
   * -- dicho acá porque es el límite del método, no un detalle.
   */
  const ESCRITURAS_DE_PANTALLA = [
    'savePersonBudget',
    'savePersonBudgetTotal',
    'savePersonBudgetBreakdown',
    'releasePersonBudgetToRule',
    'confirmPersonBudgetReviewed',
    'fijarBenchmark',
    'activate_funnel',
    'change_funnel',
  ];
  /*
   * Las dos formas que tiene una compuerta: la función del editor de
   * presupuesto y el chequeo en línea de las otras pantallas.
   *
   * ⚠ `frenadoPorPractica\s*\(` Y NO `\(\)`: el patrón literal dejó de
   * reconocerla en cuanto la función paso a recibir un argumento, y la guarda
   * marco las tres escrituras de una pantalla que estaba bien. Es la misma
   * trampa de la forma, en chico -- y esta vez la pago la guarda y no el
   * codigo, que es donde hay que pagarla.
   */
  const COMPUERTA = /frenadoPorPractica\s*\(|contextoDeEscritura[^\n]*esPractica/g;

  /* La profundidad de llaves en cada posición del archivo, de una pasada. */
  const perfil = (texto) => {
    const d = new Int32Array(texto.length + 1);
    let n = 0;
    for (let i = 0; i < texto.length; i++) {
      if (texto[i] === '{') n++;
      else if (texto[i] === '}') n--;
      d[i + 1] = n;
    }
    return d;
  };
  /*
   * ¿La compuerta se ejecuta sí o sí antes de la escritura? Sí cuando está
   * antes y NINGÚN bloque que la contenía se cerró en el medio -- o sea, la
   * profundidad nunca bajó de la suya. Dos `if` hermanos fallan acá, que es lo
   * que hay que detectar.
   */
  const domina = (d, puerta, escritura) => {
    if (puerta >= escritura) return false;
    const suya = d[puerta];
    for (let i = puerta; i <= escritura; i++) if (d[i] < suya) return false;
    return true;
  };

  const pantallas = archivos.filter((p) => /[\\/](app|components)[\\/]/.test(p));
  const sinDominar = [];
  let escriturasVistas = 0;
  for (const p of pantallas) {
    const codigo = sinComentarios(readFileSync(p, 'utf8'), 'ts');
    const d = perfil(codigo);
    /* La DEFINICIÓN de la compuerta no es una compuerta: vive arriba de todo y
       haría que domine al archivo entero sin haberse ejecutado nunca. Es el
       mismo descarte que se le hace a las llamadas de abajo. */
    const puertas = [...codigo.matchAll(COMPUERTA)]
      .filter((m) => !/function\s*$/.test(codigo.slice(Math.max(0, m.index - 30), m.index)))
      .map((m) => m.index);
    for (const nombre of ESCRITURAS_DE_PANTALLA) {
      /* La LLAMADA, no la mención: `nombre(` o `.rpc('nombre'`. Un import
         nombra al escritor y no escribe nada. */
      const llamada = new RegExp('(?:\\b' + nombre + '\\s*\\(|rpc\\(\\s*[\'"]' + nombre + '[\'"])', 'g');
      for (const m of codigo.matchAll(llamada)) {
        /* La definición de la propia función no es una llamada. */
        if (/function\s*$/.test(codigo.slice(Math.max(0, m.index - 30), m.index))) continue;
        escriturasVistas++;
        if (!puertas.some((g) => domina(d, g, m.index))) {
          sinDominar.push(relative(RAIZ, p).replace(/\\/g, '/') + ' → ' + nombre);
        }
      }
    }
  }
  a.ck(escriturasVistas > 0,
    '⚠ ancla: la sonda ENCONTRÓ escrituras de pantalla que mirar (' + escriturasVistas +
    ') — cero aquí sería una aserción sobre el vacío');
  a.ck(sinDominar.length === 0,
    '⚠ toda escritura hacia afuera tiene la compuerta antes Y no más afuera que ella' +
    (sinDominar.length ? ' — ' + sinDominar.join(', ') : ''));
}

/* ── 10. Lo que la práctica anota, alguien lo lee ────────────────────────── */
{
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * LA COMPUERTA TIENE QUE MIRAR DONDE LA PRÁCTICA ESCRIBE — etapa RV29
   * ══════════════════════════════════════════════════════════════════════════
   *
   * El defecto: la compuerta del 2.2 preguntaba por filas nuevas en cinco
   * tablas de `outlook`, y desde RV24 una práctica no escribe ahí. El editor
   * avisaba «nothing was saved to Outlook» --correcto-- y el panel seguía
   * pidiendo que se guardara. Isabella se trabó ahí.
   *
   * > **Al cambiar a dónde se escribe, hay que mover también a dónde se mira.**
   *
   * ⚠ Y ESTA GUARDA NO ATRAPA ESE DEFECTO, dicho para que nadie la cuente como
   * cobertura: cuando no existía NI la anotación ni su lectura, no había nada
   * que emparejar. Lo que atrapa es la mitad siguiente --anotar algo que nadie
   * lee, o leer algo que nadie anota-- que es la forma en que esto se rompe
   * cuando alguien agregue el cuarto paso. El defecto entero lo cubre la sonda
   * que recorre los pasos, y eso no se puede reemplazar por una aserción sobre
   * el texto: sólo se ve apretando el botón.
   */
  const pasosAnotados = new Set();
  const pasosLeidos = new Set();
  for (const p of archivos) {
    const codigo = sinComentarios(readFileSync(p, 'utf8'), 'ts');
    for (const m of codigo.matchAll(/anotarEvidenciaDePractica\s*\([^)]*?['"](\d+\.\d+)['"]/gs)) {
      pasosAnotados.add(m[1]);
    }
    for (const m of codigo.matchAll(/evidenciaDePractica\s*\([^)]*?['"](\d+\.\d+)['"]/gs)) {
      /* `anotarEvidenciaDePractica` también termina en `evidenciaDePractica`:
         se cuenta como lectura sólo si NO viene precedido por `anotar`. */
      const antes = codigo.slice(Math.max(0, m.index - 7), m.index);
      if (!/anotar$/.test(antes)) pasosLeidos.add(m[1]);
    }
  }
  const anotados = [...pasosAnotados].sort();
  const leidos = [...pasosLeidos].sort();
  a.ck(anotados.length > 0,
    '⚠ ancla: hay pasos que anotan evidencia de práctica (' + anotados.join(', ') +
    ') — cero acá volvería vacuas a las dos de abajo');
  const anotadosSinLector = anotados.filter((x) => !pasosLeidos.has(x));
  a.ck(anotadosSinLector.length === 0,
    '⚠ todo paso que anota evidencia tiene quien la lea: la compuerta quedaría cerrada' +
    (anotadosSinLector.length ? ' — ' + anotadosSinLector.join(', ') : ''));
  const leidosSinAutor = leidos.filter((x) => !pasosAnotados.has(x));
  a.ck(leidosSinAutor.length === 0,
    '⚠ y toda lectura tiene quien la anote: una compuerta que espera algo que nadie escribe' +
    (leidosSinAutor.length ? ' — ' + leidosSinAutor.join(', ') : ''));
  /*
   * ⚠ Y LA QUE FALTABA, que apareció inyectando la violación y no escribiéndola.
   *
   * Las dos de arriba emparejan sobre el ÁRBOL ENTERO. Cambiando el `'2.2'` de
   * la compuerta del presupuesto por `'3.1'` --o sea, dejándola mirando la
   * evidencia del paso equivocado-- siguieron en verde: el panel también lee
   * `'2.2'`, así que el par existía en otro archivo. La compuerta estaba rota y
   * el conteo cuadraba.
   *
   * Lo que hace falta es que la compuerta del presupuesto lea la evidencia DE
   * SU PROPIO PASO, y cuál es ese paso no se escribe a mano: sale del registro
   * de la puerta, buscando el que escribe `budget`.
   */
  const pasoDelPresupuesto = Object.keys(PASOS_QUE_ESCRIBEN).find(
    (k) => PASOS_QUE_ESCRIBEN[k].que === 'budget'
  );
  const anfitrion = sinComentarios(
    readFileSync(resolve(RAIZ, 'components/review/ReviewMaskHost.tsx'), 'utf8'), 'ts');
  a.ck(
    new RegExp("evidenciaDePractica\\s*\\([^)]*['\"]" + pasoDelPresupuesto + "['\"]").test(anfitrion),
    '⚠ la compuerta del presupuesto lee la evidencia de SU paso (' + pasoDelPresupuesto +
    '), no la de otro');

  /* Y que los pasos nombrados existan en el registro de la puerta: un `2.3`
     escrito a mano no lo caza el compilador dentro de una cadena. */
  const inventados = [...anotados, ...leidos].filter((x) => !(x in PASOS_QUE_ESCRIBEN));
  a.ck(inventados.length === 0,
    '⚠ y ningún paso inventado: los que se nombran están en el registro' +
    (inventados.length ? ' — ' + inventados.join(', ') : ''));
}

process.exitCode = a.resumen();
