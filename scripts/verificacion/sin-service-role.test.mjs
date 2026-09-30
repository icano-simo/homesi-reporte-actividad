/*
 * ============================================================================
 * PRUEBA DE LA GUARDA DEL `service_role`
 * ============================================================================
 *
 *   node scripts/verificacion/sin-service-role.test.mjs
 *   npm run verificar:service-role
 *
 * ⚠ LA DIRECCIÓN QUE IMPORTA ES QUE ATRAPE, y la otra mitad es la que decide si
 * la guarda sobrevive: lo que tiene que DEJAR PASAR está probado con el mismo
 * cuidado, porque una guarda que frena lo legítimo es la que alguien
 * desengancha -- y ahí se pierde también lo que sí cubría.
 *
 * ⚠ Y EL PRIMER CASO NO ES INVENTADO. Es la línea exacta que yo escribí en la
 * sonda de RV28, antes de que la nota me frenara: `contar()` leía
 * `outlook.budget_total` con la clave de servicio. El commit del defecto y la
 * inyección miden cosas distintas --está escrito en AGENTS.md-- y acá hay de
 * las dos: ésta salió del historial, y las de abajo se construyeron.
 */
import { crearArnes } from './guardas.mjs';
import { decidir, SIN_USAGE } from './sin-service-role.mjs';

const a = crearArnes({ minimo: 22 });
const ck = (ruta, contenido, esperado, nota) => {
  const r = decidir(ruta, contenido);
  a.ck(esperado === (r !== null), nota + (r === null ? ' [paso]' : ' [freno: ' + r.nombre + ']'));
  return r;
};

/* ── 1. El caso REAL, sacado de la sonda de RV28 ─────────────────────────── */
{
  const real = [
    "const svc = { apikey: SVC, Authorization: 'Bearer ' + SVC };",
    'async function contar(esquema, tabla) {',
    "  const r = await fetch(URL_ + '/rest/v1/' + tabla + '?employee_key=eq.13&select=*',",
    "    { headers: { ...svc, 'Accept-Profile': 'outlook' } });",
    '}',
    'const SVC = env.SUPABASE_SERVICE_ROLE_KEY;',
  ].join('\n');
  const r = ck('sonda.mjs', real, true, '⚠ atrapa la sonda de RV28 tal como la escribi: svc contra `outlook`');
  a.ck(/42501/.test(r?.porque ?? ''), 'y el motivo nombra el error que la base devuelve: 42501');
  a.ck(/Accept-Profile/.test(r?.hacer ?? '') && /access_token/.test(r?.hacer ?? ''),
    'y dice que hacer: el token de una persona, con el mismo header');
}

/* ── 2. Los tres esquemas, uno por uno ───────────────────────────────────── */
for (const esq of SIN_USAGE) {
  const t = [
    'const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    "const h = { apikey: SVC, 'Accept-Profile': '" + esq + "' };",
  ].join('\n');
  ck('x.mjs', t, true, 'atrapa `' + esq + '`');
}

/* ── 3. Y `Content-Profile`, que es el de las ESCRITURAS ─────────────────── */
{
  const t = [
    'const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    "const h = { apikey: SVC, 'Content-Profile': 'review' };",
  ].join('\n');
  ck('x.mjs', t, true, 'atrapa `Content-Profile`, no solo `Accept-Profile`');
}

/* ── 4. LO QUE TIENE QUE PASAR ───────────────────────────────────────────── */
{
  /* La clave de servicio contra un esquema que SÍ le dio `usage`. */
  const org = [
    'const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    "const h = { apikey: SVC, 'Accept-Profile': 'org' };",
  ].join('\n');
  ck('x.mjs', org, false, '⚠ deja pasar `org`, que si tiene usage: bloquearlo seria frenar lo correcto');

  const act = [
    'const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    "const h = { apikey: SVC, 'Accept-Profile': 'activity_report' };",
  ].join('\n');
  ck('x.mjs', act, false, 'y `activity_report`, idem');

  /* El magiclink: clave de servicio, sin ningun esquema. Es como empieza toda
     sonda de esta serie. */
  const magiclink = [
    'const SVC = env.SUPABASE_SERVICE_ROLE_KEY;',
    "const svc = { apikey: SVC, Authorization: 'Bearer ' + SVC };",
    "await fetch(URL_ + '/auth/v1/admin/generate_link', { method: 'POST', headers: svc });",
  ].join('\n');
  ck('sonda.mjs', magiclink, false,
    '⚠ deja pasar el magiclink: clave de servicio sin esquema, que es como arranca cada sonda');

  /* La forma CORRECTA, que es la que quedo en las sondas de la practica. */
  const conToken = [
    "const auth = { apikey: ANON, Authorization: 'Bearer ' + v.access_token };",
    "const r = await fetch(URL_ + '/rest/v1/session', { headers: { ...auth, 'Accept-Profile': 'review' } });",
  ].join('\n');
  ck('sonda.mjs', conToken, false,
    '⚠ deja pasar el token de una persona contra `review`, que es la via correcta');

  /* Las dos mitades en el mismo archivo pero la clave solo en un comentario. */
  const enComentario = [
    '/* No usar SUPABASE_SERVICE_ROLE_KEY contra review: no tiene usage. */',
    "const h = { apikey: ANON, 'Accept-Profile': 'review' };",
  ].join('\n');
  ck('x.mjs', enComentario, false,
    '⚠ no se traga el nombre prohibido escrito en un COMENTARIO: es donde aparece a proposito');

  /* Y en una cadena de fixture, que es como lo escribe una prueba. */
  const enFixture = [
    'const casos = [',
    '  "const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;",',
    '  "const h = { apikey: SVC, \'Accept-Profile\': \'outlook\' };",',
    '];',
  ].join('\n');
  ck('otra.test.mjs', enFixture, false,
    '⚠ ni en una CADENA de fixture: describe codigo, no lo ejecuta');

  /*
   * ⚠ EL CASO QUE SE ESCAPO EN LA PRIMERA PRUEBA EN VIVO, y es el que decide si
   * la guarda sobrevive: LA FORMA DE TODA SONDA DE ESTA SERIE. La clave de
   * servicio arriba para el magiclink --sin esquema-- y el token de la persona
   * abajo contra `review`. Las dos mitades en el MISMO archivo y sin relacion.
   *
   * La primera version bloqueaba esto. Mi prueba no lo vio porque tenia las dos
   * mitades en archivos SEPARADOS: probe las mitades y no el conjunto.
   */
  const sondaDeVerdad = [
    'const SVC = env.SUPABASE_SERVICE_ROLE_KEY;',
    "const svc = { apikey: SVC, Authorization: 'Bearer ' + SVC };",
    "const gen = await fetch(URL_ + '/auth/v1/admin/generate_link', { method: 'POST', headers: svc });",
    "const auth = { apikey: ANON, Authorization: 'Bearer ' + v.access_token };",
    "const rv = { ...auth, 'Accept-Profile': 'review' };",
    "const r = await fetch(URL_ + '/rest/v1/session?select=*', { headers: rv });",
  ].join('\n');
  ck('sonda.mjs', sondaDeVerdad, false,
    '⚠ DEJA PASAR la sonda de verdad: magiclink con la clave y lectura con el token, en el mismo archivo');

  /* Y la inversa del mismo archivo: si el header cuelga del objeto de servicio,
     frena -- que es lo que hay que distinguir. */
  const mezclada = [
    'const SVC = env.SUPABASE_SERVICE_ROLE_KEY;',
    "const svc = { apikey: SVC, Authorization: 'Bearer ' + SVC };",
    "const gen = await fetch(URL_ + '/auth/v1/admin/generate_link', { method: 'POST', headers: svc });",
    "const r = await fetch(URL_ + '/rest/v1/session', { headers: { ...svc, 'Accept-Profile': 'review' } });",
  ].join('\n');
  ck('sonda.mjs', mezclada, true,
    '⚠ y FRENA el mismo archivo cuando el header cuelga del objeto de servicio');

  /* El header con el esquema en una VARIABLE, que es como estaba en RV28. */
  const porVariable = [
    'const SVC = env.SUPABASE_SERVICE_ROLE_KEY;',
    "const svc = { apikey: SVC, Authorization: 'Bearer ' + SVC };",
    'async function contar(esquema, tabla) {',
    "  return fetch(URL_ + '/rest/v1/' + tabla, { headers: { ...svc, 'Accept-Profile': esquema } });",
    '}',
    "await contar('outlook', 'budget_total');",
  ].join('\n');
  ck('sonda.mjs', porVariable, true,
    '⚠ atrapa el esquema pasado por VARIABLE, que es como estaba escrito en RV28');

  /* Y con la variable apuntando a un esquema permitido, no frena. */
  const porVariablePermitida = [
    'const SVC = env.SUPABASE_SERVICE_ROLE_KEY;',
    "const svc = { apikey: SVC, Authorization: 'Bearer ' + SVC };",
    "const r = await fetch(URL_ + '/rest/v1/dim_employee', { headers: { ...svc, 'Accept-Profile': esq } });",
    "await leer('org');",
  ].join('\n');
  ck('sonda.mjs', porVariablePermitida, false,
    'y no frena cuando el unico esquema del archivo es uno permitido');

  /* Un esquema que no esta en la lista. */
  const otro = [
    'const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    "const h = { apikey: SVC, 'Accept-Profile': 'pipeline_forecast' };",
  ].join('\n');
  ck('x.mjs', otro, false, 'y un esquema fuera de la lista no se inventa');

  /* Vacio y basura: no bloquea. */
  ck('x.mjs', '', false, 'un contenido vacio no bloquea');
  a.ck(decidir('x.mjs', null) === null, 'y uno que no es texto tampoco');
}

/* ── 5. Su propia implementacion queda exenta ────────────────────────────── */
{
  const t = [
    'const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    "const h = { apikey: SVC, 'Accept-Profile': 'review' };",
  ].join('\n');
  ck('scripts/verificacion/sin-service-role.mjs', t, false,
    'la implementacion nombra los tres esquemas a proposito y no se bloquea a si misma');
  ck('scripts/verificacion/sin-service-role.test.mjs', t, false, 'y su prueba tampoco');
}

process.exitCode = a.resumen();
