/*
 * ============================================================================
 * EL MODELO DE MARGINS, PROBADO SIN NAVEGADOR Y SIN BASE — etapa ADM3
 * ============================================================================
 *
 * `margins-modelo.ts` es puro: recibe filas de `margins.branch_margin` y
 * devuelve la grilla vigente y el historial. Node importa el `.ts` directo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE IMPORTA MEDIR, Y POR QUE CADA COSA
 * ---------------------------------------------------------------------------
 * · QUE «EL ANTERIOR» SEA EL VIGENTE DE ESA COMBINACION, no el de la version
 *   anterior del branch. Es la particion de `branch_margin_vigente`, y si las
 *   dos no coinciden, una version que omita una linea se lee como un cambio
 *   mientras la vista sigue sirviendo el valor viejo.
 *
 * · LOS CUATRO ESTADOS. El 711 no tiene v1: sus 28 lineas son ALTAS, y sin ese
 *   estado la pantalla muestra 28 filas de «— -> x» como si alguien hubiera
 *   cambiado todo.
 *
 * · ⚠ Y LA OMISION, QUE HOY NO OCURRE NI UNA VEZ. Medido contra la base el
 *   2026-10-01: cero combinaciones de v1 que falten en v2, en los cinco
 *   branches que tienen v2. Asi que su rama NUNCA se ejercio con datos reales,
 *   y por eso la prueba la CONSTRUYE -- una guarda que solo se vio dar verde no
 *   esta probada.
 *
 * · Y QUE LA VERSION NUEVA SEA COMPLETA. Si omitiera las lineas que no
 *   cambiaron, la vista serviria la version vieja para esas combinaciones y la
 *   omision quedaria escondida detras de un numero que se ve bien.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LOS NUMEROS DE 733 SALEN DE LA BASE, NO DE LA CABEZA
 * ---------------------------------------------------------------------------
 * La tabla `V733` de abajo es el v1 y el v2 reales de ese branch, leidos el
 * 2026-10-01. Su clasificacion medida contra la base con un `lag()` fue
 * 2 altas, 25 cambios y 1 sin cambio -- y eso es lo que estas aserciones
 * esperan. Un fixture inventado probaria que la funcion hace lo que la funcion
 * hace; este prueba que coincide con lo que la base contesta.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const {
  NIVELES,
  grillaVigente,
  historial,
  ordenarBranches,
  cambiosHuerfanos,
  filasDeLaVersion,
  seccionesDeBranch,
  esMarcadorDeReclutamiento,
} = await import(pathToFileURL(resolve(RAIZ, 'lib/admin/margins-modelo.ts')).href);

/** Una fila, con la clave armada igual que la arma el sync. */
const fila = (branch, tipo, nivel, versionNum, valor, extra = {}) => ({
  margin_key: branch + '|' + tipo + '|' + nivel + '|v' + versionNum,
  branch_code: branch,
  loan_type: tipo,
  tipo_de_margen: nivel,
  version: 'v' + versionNum,
  version_num: versionNum,
  /* ⚠ Como texto, que es como llega de PostgREST para una columna `numeric`. */
  valor_bps: valor === null ? null : String(valor),
  origen: 'archivo',
  changed_by: null,
  changed_at: versionNum === 1 ? '2025-08-01T05:00:00+00' : '2026-07-01T05:00:00+00',
  reason: 'carga',
  ...extra,
});

/*
 * El 733 tal cual esta en la base: [tipo, Branch v1, Branch v2, Division v1,
 * Division v2]. `null` en v1 = la linea no existia (es el caso de `Broker out`,
 * que nace en v2).
 */
const V733 = [
  ['Broker out', null, 225, null, 25],
  ['Conventional', 434, 469, 60, 25],
  ['EEP/Trio', 300, 325, 75, 50],
  ['F30DREAM', 225, 250, 50, 25],
  ['F30DREAMR', 404, 449, 70, 25],
  ['F30S', 250, 275, 50, 25],
  ['FHA', 404, 449, 70, 25],
  ['Jumbo', 330, 365, 60, 25],
  ['PortFolio', 404, 439, 60, 25],
  ['State Bonds', 150, 150, 50, 25],
  ['Supreme 100', 225, 250, 50, 25],
  ['USDA', 404, 449, 70, 25],
  ['VA', 404, 449, 70, 25],
  ['VAIRRRL', 404, 449, 70, 25],
];

const filas733 = [];
for (const [tipo, b1, b2, d1, d2] of V733) {
  if (b1 !== null) filas733.push(fila('733', tipo, 'Branch', 1, b1));
  if (d1 !== null) filas733.push(fila('733', tipo, 'Division', 1, d1));
  filas733.push(fila('733', tipo, 'Branch', 2, b2));
  filas733.push(fila('733', tipo, 'Division', 2, d2));
}

/* El numero sale de contar las llamadas con el patron anclado al margen. */
const a = crearArnes({ minimo: 43 });
try {
  /* ═══ 0. El ancla: el fixture es el que se midio ═══ */
  console.log('\n=== 0. el fixture ===');
  a.ck(filas733.length === 54,
    'ancla: el 733 son 26 filas de v1 y 28 de v2 (' + filas733.length + ')');

  /* ═══ 1. La grilla vigente ═══ */
  console.log('\n=== 1. la grilla vigente ===');
  const g733 = grillaVigente(filas733);
  a.ck(g733.versionMaxima === 2, 'la version mas alta del 733 es v2');
  a.ck(g733.tipos.length === 14 && g733.tipos[0] === 'Broker out',
    'catorce tipos, con `Broker out` primero por el orden alfabetico declarado');
  a.ck(JSON.stringify(g733.niveles) === JSON.stringify(['Branch', 'Division']),
    '⚠ DOS NIVELES Y NO TRES: el 733 no tiene Region, y la grilla no se la inventa');
  a.ck(g733.celda('Conventional', 'Branch')?.valor === 469,
    'la celda vigente es la de v2 (' + g733.celda('Conventional', 'Branch')?.valor + ')');
  a.ck(g733.celda('Conventional', 'Region') === null,
    '⚠ y una combinacion que el branch no tiene da `null`, no 0');
  a.ck(g733.lineas.length === 28,
    'la grilla vigente son 28 lineas, que es lo que un guardado reescribe (' +
    g733.lineas.length + ')');

  /*
   * ⚠ EL CERO Y LA AUSENCIA, QUE CONVIVEN EN LA MISMA COLUMNA. Los 14 ceros de
   * la tabla estan TODOS en `Region`, que es la columna vacia para 16 de 21
   * branches. Si la grilla los colapsara, «se decidio que no suma» y «este
   * branch no tiene ese nivel» serian el mismo valor.
   */
  const conRegion = [
    fila('702', 'F30DREAM', 'Branch', 1, 410),
    fila('702', 'F30DREAM', 'Region', 1, 0),
    fila('702', 'FHA', 'Branch', 1, 420),
  ];
  const g702 = grillaVigente(conRegion);
  a.ck(g702.celda('F30DREAM', 'Region')?.valor === 0,
    '⚠ un cero es un valor: la celda existe y vale 0');
  a.ck(g702.celda('FHA', 'Region') === null,
    '⚠ y una ausencia es `null`: la fila no existe. No son el mismo estado');

  /* Un branch con un solo nivel, que es el caso de `Recruitment - BM`. */
  const gSolo = grillaVigente([fila('Recruitment - BM', 'FHA', 'Branch', 1, 100)]);
  a.ck(JSON.stringify(gSolo.niveles) === JSON.stringify(['Branch']),
    '⚠ un branch con un solo nivel declara un solo nivel, no los tres');

  /* ═══ 2. El historial del 733, contra lo que midio la base ═══ */
  console.log('\n=== 2. el historial del 733 ===');
  const h733 = historial(filas733);
  a.ck(h733.length === 2 && h733[0].versionNum === 2,
    'dos versiones, la mas nueva primero');
  const v2 = h733[0];
  a.ck(v2.altas.length === 2 && v2.cambios.length === 25 && v2.igualNum === 1,
    '⚠ 2 altas, 25 cambios y 1 sin cambio -- los mismos que da el `lag()` sobre la base ' +
    '(' + v2.altas.length + '/' + v2.cambios.length + '/' + v2.igualNum + ')');
  const conv = v2.cambios.find((l) => l.loanType === 'Conventional' && l.nivel === 'Branch');
  a.ck(conv?.antes === 434 && conv?.despues === 469,
    '⚠ y el «de cuanto a cuanto» sale de los valores: 434 -> 469, no de una columna de ' +
    'diferencias');
  a.ck(v2.altas.every((l) => l.loanType === 'Broker out' && l.antes === null),
    'las dos altas son las de `Broker out`, que nace en v2');
  const sinCambio = v2.lineas.filter((l) => l.estado === 'igual');
  a.ck(sinCambio.length === 1 && sinCambio[0].loanType === 'State Bonds',
    'y la unica que se copio igual es `State Bonds / Branch`');
  a.ck(v2.omitidas.length === 0,
    'ninguna omitida, que es lo que la base dice de los cinco branches con v2');
  a.ck(h733[1].esPrimera === true && h733[1].altas.length === 26,
    '⚠ v1 es la carga inicial: sus 26 lineas son ALTAS, no cambios desde la nada');

  /* ═══ 3. El 711, que no tiene v1 ═══ */
  console.log('\n=== 3. el 711, que nace en v2 ===');
  const filas711 = [];
  for (const [tipo] of V733) {
    filas711.push(fila('711', tipo, 'Branch', 2, 300));
    filas711.push(fila('711', tipo, 'Division', 2, 30));
  }
  const h711 = historial(filas711);
  a.ck(h711.length === 1 && h711[0].versionNum === 2,
    'ancla: el 711 tiene una sola version y es la v2');
  a.ck(h711[0].esPrimera === true && h711[0].altas.length === 28 && h711[0].cambios.length === 0,
    '⚠ SUS 28 LINEAS SON ALTAS Y CERO CAMBIOS. Sin este estado, ese branch mostraria ' +
    '28 filas de «— -> x» como si alguien hubiera cambiado todo ' +
    '(' + h711[0].altas.length + '/' + h711[0].cambios.length + ')');

  /* ═══ 4. La omision: la rama que los datos de hoy no ejercen ═══ */
  console.log('\n=== 4. la omision, construida a proposito ===');
  /*
   * Una v3 que escribe sólo `Conventional` y deja afuera a `FHA`. Es el caso
   * que el punto 4 del brief viene a evitar, y el que ningun dato real produce
   * todavia.
   */
  const conOmision = [
    fila('733', 'Conventional', 'Branch', 1, 434),
    fila('733', 'FHA', 'Branch', 1, 404),
    fila('733', 'Conventional', 'Branch', 2, 469),
    fila('733', 'FHA', 'Branch', 2, 449),
    fila('733', 'Conventional', 'Branch', 3, 480),
  ];
  const hOmision = historial(conOmision);
  const v3 = hOmision[0];
  a.ck(v3.versionNum === 3 && v3.lineas.length === 1,
    'ancla: la v3 escribio una sola linea (' + v3.lineas.length + ')');
  a.ck(v3.omitidas.length === 1 && v3.omitidas[0].loanType === 'FHA',
    '⚠ LA OMISION SE DETECTA Y SE NOMBRA: `FHA` estaba vigente y la v3 no la escribio');
  a.ck(v3.omitidas[0].antes === 449,
    'y se dice con que valor quedo: 449, el de la v2 (' + v3.omitidas[0].antes + ')');
  const gOmision = grillaVigente(conOmision);
  a.ck(gOmision.celda('FHA', 'Branch')?.valor === 449 &&
       gOmision.celda('FHA', 'Branch')?.versionNum === 2,
    '⚠ y LA VISTA SIGUE SIRVIENDO LA v2 para esa combinacion -- que es por que la ' +
    'omision es peligrosa: el numero se ve bien');
  a.ck(gOmision.celda('Conventional', 'Branch')?.versionNum === 3,
    'mientras la linea que si se escribio ya esta en v3');

  /* ═══ 5. La version nueva: completa, con la clave bien armada ═══ */
  console.log('\n=== 5. la version nueva ===');
  const nuevas = filasDeLaVersion(
    '733', g733,
    [{ loanType: 'FHA', nivel: 'Branch', valor: 455 }],
    'Ajuste de FHA', 'isabella.cano@supremelending.com', '2026-10-01T12:00:00.000Z'
  );
  a.ck(nuevas.length === 28,
    '⚠ UN CAMBIO ESCRIBE LAS 28 LINEAS, no una. Si omitiera las demas, la vista ' +
    'serviria la v2 para ellas y la omision quedaria escondida (' + nuevas.length + ')');
  a.ck(nuevas.every((f) => f.version_num === 3 && f.version === 'v3'),
    'todas en la version siguiente a la mas alta del branch');
  a.ck(nuevas.every((f) =>
    f.margin_key === f.branch_code + '|' + f.loan_type + '|' + f.tipo_de_margen + '|' + f.version),
    '⚠ y la clave no puede contradecir a sus partes -- es lo mismo que exige el ' +
    '`with check` de la policy');
  a.ck(nuevas.every((f) => f.origen === 'app'),
    '⚠ y todas con `origen = app`: sin eso el sync las revierte al valor del Excel');
  const fha = nuevas.find((f) => f.loan_type === 'FHA' && f.tipo_de_margen === 'Branch');
  const conv3 = nuevas.find((f) => f.loan_type === 'Conventional' && f.tipo_de_margen === 'Branch');
  a.ck(fha?.valor_bps === 455, 'la linea editada lleva el valor nuevo');
  a.ck(conv3?.valor_bps === 469,
    'y las demas se copian del valor VIGENTE, no del de v1 (' + conv3?.valor_bps + ')');

  /* ⚠ El caso donde tiene que decir NO. */
  const huerfanos = cambiosHuerfanos(g733, [{ loanType: 'FHA', nivel: 'Region', valor: 10 }]);
  a.ck(huerfanos.length === 1,
    '⚠ y un cambio sobre una combinacion que el branch NO tiene se rechaza: escribirla ' +
    'le inventaria una columna Region al 733');

  /* ═══ 6. El orden de los branches ═══ */
  console.log('\n=== 6. el orden de los branches ===');
  const orden = ordenarBranches(['776', 'Recruitment - LO Only', '700', 'Recruitment - BM', '710']);
  a.ck(JSON.stringify(orden) ===
    JSON.stringify(['700', '710', '776', 'Recruitment - BM', 'Recruitment - LO Only']),
    '⚠ los numericos por numero y los de texto al final: ordenando como texto, los dos ' +
    'de reclutamiento caen en el medio (' + JSON.stringify(orden) + ')');
  a.ck(NIVELES.length === 3 && NIVELES[2] === 'Region',
    'ancla: los tres niveles, con Region al final, que es el orden de las columnas');

  /* ═══ 7. Activo, inactivo y lo que no es un branch — etapa ADM5 ═══ */
  console.log('\n=== 7. las secciones de branches ===');
  /*
   * ⚠ LA REGLA ES LA DE OUTLOOK: hay productor activo o no lo hay. Los casos de
   * abajo son los que el dato de hoy tiene, armados a mano para que la prueba
   * no dependa de como este el roster manana.
   */
  const roster = [
    /* 710: dos productores activos -> activo */
    { branch_code: '710', is_producer: true, is_active: true },
    { branch_code: '710', is_producer: false, is_active: true },
    /* 700: gente activa y NINGUN productor -> inactivo, pero esta en el roster */
    { branch_code: '700', is_producer: false, is_active: true },
    { branch_code: '700', is_producer: false, is_active: true },
    /* 716: su unico productor esta de baja -> inactivo */
    { branch_code: '716', is_producer: true, is_active: false },
    /* ruido que no tiene que contar */
    { branch_code: null, is_producer: true, is_active: true },
    { branch_code: '   ', is_producer: true, is_active: true },
  ];
  const sec = seccionesDeBranch(
    ['700', '710', '716', '741', 'Recruitment - BM', 'Recruitment - LO Only'],
    roster
  );
  console.log('secciones: ' + JSON.stringify(sec));
  a.ck(JSON.stringify(sec.activos) === JSON.stringify(['710']),
    '⚠ activo es el que tiene un productor ACTIVO, no el que tiene gente: ' +
    JSON.stringify(sec.activos));
  a.ck(sec.inactivos.includes('700'),
    '⚠ el 700 es INACTIVO con gente activa adentro: la regla pregunta por ' +
    'productores, y preguntar por `is_active` a secas lo pondria con los que operan');
  a.ck(sec.inactivos.includes('716'),
    'y un productor dado de baja no alcanza para estar activo');
  a.ck(JSON.stringify(sec.marcadores) === JSON.stringify(['Recruitment - BM', 'Recruitment - LO Only']),
    '⚠ LOS DOS MARCADORES NO SON NINGUNO DE LOS DOS: cumplen la regla de inactivo ' +
    'y llamarlos asi seria falso -- nunca estuvieron activos');
  a.ck(!sec.inactivos.includes('Recruitment - BM') && !sec.activos.includes('Recruitment - BM'),
    'asi que no estan en ninguna de las otras tres secciones');
  /*
   * ⚠ CUATRO SECCIONES Y NO TRES. «Esta en el roster y no produce» y «no esta en
   * el roster» caian juntas porque la regla del portal las junta, y la
   * diferencia decide que se puede hacer con cada una: a una oficina con gente
   * se le puede fijar un margen esperando produccion, y a un branch donde no
   * hay nadie, no.
   */
  a.ck(JSON.stringify(sec.inactivos) === JSON.stringify(['700', '716']),
    '⚠ `inactivos` son los que ESTAN en el roster y no producen: ' +
    JSON.stringify(sec.inactivos));
  a.ck(JSON.stringify(sec.sinRoster) === JSON.stringify(['741']),
    '⚠ y `sinRoster` es otra cosa: el 741 no tiene NI UNA fila (' +
    JSON.stringify(sec.sinRoster) + ')');
  /*
   * ⚠ Y SE AFIRMA LA PARTICION ENTERA, no sólo los totales: cuatro listas que
   * suman seis pueden tener un branch repetido y otro perdido, y cada seccion
   * se veria bien por su cuenta.
   */
  const todas = [...sec.activos, ...sec.inactivos, ...sec.sinRoster, ...sec.marcadores];
  a.ck(todas.length === 6 && new Set(todas).size === 6,
    'ancla: los seis caen en exactamente una seccion -- ni repetidos ni perdidos (' +
    todas.length + ' puestos, ' + new Set(todas).size + ' distintos)');

  /* ⚠ El caso donde tiene que decir NO: sin roster, nadie es activo. */
  const vacio = seccionesDeBranch(['700', '710'], []);
  a.ck(vacio.activos.length === 0 && vacio.sinRoster.length === 2 && vacio.inactivos.length === 0,
    '⚠ SIN ROSTER NINGUNO ES ACTIVO y los dos caen en `sinRoster` -- por eso la ' +
    'pantalla distingue «el roster vino vacio» de «aca no hay nadie»: sin ese aviso ' +
    'diria que la division entera se quedo sin gente');

  a.ck(esMarcadorDeReclutamiento('Recruitment - BM') &&
       esMarcadorDeReclutamiento('recruitment') &&
       !esMarcadorDeReclutamiento('Recruiting') &&
       !esMarcadorDeReclutamiento('700'),
    '⚠ el marcador se reconoce por la PALABRA y no por un prefijo: `Recruiting` no es ' +
    'uno, y un prefijo pelado lo habria tomado');
} finally {
  process.exitCode = a.resumen();
}
