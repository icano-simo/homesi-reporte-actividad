#!/usr/bin/env node
/**
 * ============================================================================
 * OTORGAR / REVOCAR ACCESO A ESTA APP
 * ============================================================================
 *
 * Edita `app_metadata.allowed_apps` de los usuarios de Supabase.
 *
 *   node scripts/grant-app-access.mjs --list
 *   node scripts/grant-app-access.mjs alguien@supremelending.com otra@supremelending.com
 *   node scripts/grant-app-access.mjs --file correos.txt
 *   node scripts/grant-app-access.mjs --revoke alguien@supremelending.com
 *   node scripts/grant-app-access.mjs --dry-run --file correos.txt
 *   node scripts/grant-app-access.mjs --app homesi alguien@supremelending.com
 *
 * ADAPTADO DE `scripts/grant-app-access.mjs` del repo hermano **homesi-pl**
 * (rama feature/user-authentication). La lógica de leer/escribir allowed_apps
 * es idéntica -- es el mismo proyecto de Supabase (simoOS-prod) y los mismos
 * usuarios. Diferencias respecto del original:
 *
 *   1. El valor por defecto de `--app` es "commercial_activity" en vez de
 *      "homesi". Debe coincidir con APP_NAME de lib/auth/appAccess.ts y con lo
 *      que revisan las políticas de RLS.
 *   2. Se agregó `--file`, para no tener que escribir los correos reales en la
 *      línea de comandos (quedan en el historial del shell).
 *   3. El parser de .env.local tolera comillas y dígitos en el nombre de la
 *      variable -- pegar `CLAVE="valor"` es lo más común y el original lo
 *      ignoraba en silencio.
 *
 * ---------------------------------------------------------------------------
 * REQUIERE SUPABASE_SERVICE_ROLE_KEY EN .env.local
 * ---------------------------------------------------------------------------
 * No alcanza con la anon key que ya está ahí: `app_metadata` es escribible
 * ÚNICAMENTE por el service_role. Esa es justamente la razón de que el permiso
 * viva ahí y no en `user_metadata` -- en user_metadata cualquiera podría
 * otorgarse acceso solo desde el navegador.
 *
 * La clave sale de Supabase → Settings → API → `service_role`. Va en el
 * `.env.local` LOCAL (que está en .gitignore) y NUNCA:
 *   - con prefijo NEXT_PUBLIC_ (quedaría en el bundle del navegador),
 *   - en las variables de entorno de Vercel (la app desplegada no la necesita:
 *     todo lo que hace pasa por RLS con la sesión del usuario).
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

/** Debe coincidir con APP_NAME de lib/auth/appAccess.ts. */
const DEFAULT_APP = 'commercial_activity';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const REVOKE = argv.includes('--revoke');
const LIST = argv.includes('--list');

const appIdx = argv.indexOf('--app');
const APP = appIdx >= 0 ? argv[appIdx + 1] : DEFAULT_APP;

const fileIdx = argv.indexOf('--file');
const FILE = fileIdx >= 0 ? argv[fileIdx + 1] : null;

// Los correos sueltos son todo lo que no sea una bandera ni el VALOR de una
// bandera que lleva argumento.
const flagValueIndexes = new Set([appIdx, fileIdx].filter((i) => i >= 0).map((i) => i + 1));
const emails = argv.filter((a, i) => !a.startsWith('--') && !flagValueIndexes.has(i));

// `--file`: un correo por línea. Se ignoran líneas vacías y comentarios, para
// poder anotar a quién corresponde cada uno.
if (FILE) {
  try {
    const fromFile = readFileSync(FILE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    emails.push(...fromFile);
  } catch {
    console.error(`No se pudo leer el archivo de correos: ${FILE}`);
    process.exit(1);
  }
}

if (appIdx >= 0 && !APP) {
  console.error('--app requiere un nombre de app.');
  process.exit(1);
}

if (!LIST && emails.length === 0) {
  console.error('Uso: node scripts/grant-app-access.mjs [--app <nombre>] [--revoke] [--dry-run] <correo> [correo...]');
  console.error('     node scripts/grant-app-access.mjs --file <archivo con un correo por linea>');
  console.error('     node scripts/grant-app-access.mjs --list');
  process.exit(1);
}

// ── .env.local ──────────────────────────────────────────────────────────────
const env = {};
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    // Se quitan comillas envolventes: pegar CLAVE="valor" es lo habitual.
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {
  console.error('No se pudo leer .env.local desde la raiz del proyecto.');
  process.exit(1);
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.');
  console.error('');
  console.error('La anon key NO sirve para esto: app_metadata solo lo puede escribir el');
  console.error('service_role. La clave esta en Supabase -> Settings -> API -> service_role.');
  console.error('Agregala a .env.local (sin prefijo NEXT_PUBLIC_) y volve a correr.');
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Traer todos los usuarios (paginado) ─────────────────────────────────────
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error('listUsers: ' + error.message);
    process.exit(1);
  }
  if (!data.users.length) break;
  users.push(...data.users);
  if (data.users.length < 200) break;
}

const byEmail = new Map(users.map((u) => [(u.email ?? '').toLowerCase(), u]));

// ── --list: quién tiene acceso hoy, sin tocar nada ──────────────────────────
if (LIST) {
  console.log(`usuarios: ${users.length}    app consultada: ${APP}`);
  console.log('');
  console.log('acceso  correo                                    allowed_apps');
  for (const u of users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))) {
    const apps = u.app_metadata?.allowed_apps;
    const has = Array.isArray(apps) && apps.includes(APP);
    console.log(
      `  ${has ? 'SI ' : 'no '}   ${(u.email ?? '?').padEnd(40)}  ` +
        (Array.isArray(apps) ? JSON.stringify(apps) : '(sin campo)')
    );
  }
  process.exit(0);
}

console.log(`app: ${APP}    accion: ${REVOKE ? 'REVOCAR' : 'otorgar'}${DRY ? '    (DRY RUN)' : ''}`);
console.log('');

let done = 0;      // escrituras CONFIRMADAS contra la base
let simulated = 0; // solo --dry-run: lo que se habria hecho
let unchanged = 0;
let missing = 0;
let failed = 0;

for (const raw of emails) {
  const email = raw.toLowerCase();
  const u = byEmail.get(email);

  if (!u) {
    console.log(`  NO EXISTE  ${raw}`);
    missing++;
    continue;
  }

  const current = Array.isArray(u.app_metadata?.allowed_apps) ? u.app_metadata.allowed_apps : [];
  const has = current.includes(APP);

  if (REVOKE ? !has : has) {
    console.log(`  sin cambio ${raw}  -> ${JSON.stringify(current)}`);
    unchanged++;
    continue;
  }

  // Union / diferencia, nunca un reemplazo completo: el acceso de alguien a
  // Homesí o a las otras apps del portal tiene que sobrevivir a un cambio acá.
  const next = REVOKE ? current.filter((a) => a !== APP) : [...current, APP];

  if (DRY) {
    // Contador SEPARADO. Antes esto incrementaba `done`, y el resumen lo
    // imprimia bajo la etiqueta "aplicados": un --dry-run informaba
    // "aplicados: 15" sin haber escrito una sola fila. El bug venia heredado
    // del script original de homesi-pl.
    console.log(`  ${REVOKE ? 'revocaria' : 'otorgaria'} ${raw}  ${JSON.stringify(current)} -> ${JSON.stringify(next)}`);
    simulated++;
    continue;
  }

  // Spread del app_metadata existente para no borrar otros claims (por ejemplo
  // must_change_password, que usa homesi-pl) -- pero SIN `provider` ni
  // `providers`: son claims reservados que administra GoTrue, y devolverselos
  // en una escritura es una causa conocida de que la actualizacion se descarte
  // en silencio.
  const safeMetadata = { ...(u.app_metadata ?? {}) };
  delete safeMetadata.provider;
  delete safeMetadata.providers;

  const { error } = await admin.auth.admin.updateUserById(u.id, {
    app_metadata: { ...safeMetadata, allowed_apps: next },
  });

  if (error) {
    console.log(`  FALLO      ${raw}: ${error.message}`);
    failed++;
    continue;
  }

  // VERIFICACION: se relee el usuario de la base en vez de confiar en que la
  // API no devolvio error. Antes se contaba como aplicado apenas `error` era
  // null; si la escritura no persistia, el script informaba exito igual. Ahora
  // "aplicados" significa "confirmado en la base", que es lo unico util.
  const { data: check, error: checkError } = await admin.auth.admin.getUserById(u.id);
  const persisted = Array.isArray(check?.user?.app_metadata?.allowed_apps)
    ? check.user.app_metadata.allowed_apps
    : [];
  const ok = REVOKE ? !persisted.includes(APP) : persisted.includes(APP);

  if (checkError) {
    console.log(`  ??         ${raw}: escrito, pero no se pudo verificar (${checkError.message})`);
    failed++;
  } else if (!ok) {
    console.log(`  NO PERSISTIO ${raw}: la API no dio error pero la base quedo en ${JSON.stringify(persisted)}`);
    failed++;
  } else {
    console.log(`  ${REVOKE ? 'revocado ' : 'otorgado '} ${raw}  -> ${JSON.stringify(persisted)}`);
    done++;
  }
}

console.log('');
if (DRY) {
  console.log(`SIMULADOS  : ${simulated}   <-- DRY RUN: no se escribio nada en la base`);
} else {
  console.log(`aplicados  : ${done}   (releidos de la base, no solo "la API no fallo")`);
}
console.log(`sin cambio : ${unchanged}`);
console.log(`no existen : ${missing}`);
console.log(`fallidos   : ${failed}`);
console.log('');
console.log('Nota: app_metadata viaja dentro del token. Quien tenga sesion abierta no vera');
console.log('el cambio hasta que su token se refresque (hasta 1 hora) o vuelva a entrar.');
