-- ===========================================================================
-- pipeline_forecast — acotar RLS de las 5 tablas de superficie de escritura
-- ===========================================================================
--
-- DIAGNÓSTICO 3, cerrado con nombres reales confirmados por Isa. Propuesta,
-- NO aplicada.
--
-- ⚠ NO EJECUTADA POR QUIEN ESCRIBIÓ ESTE ARCHIVO. La aplica Isa (o quien
--   tenga acceso al SQL Editor), a propósito: es un cambio de superficie de
--   escritura sobre 5 tablas que hoy tienen datos en producción.
--
-- ---------------------------------------------------------------------------
-- ESTADO REAL CONFIRMADO (por Isa, no una inferencia por precedente)
-- ---------------------------------------------------------------------------
-- Las 5 tablas comparten HOY una sola política, mismo nombre en las 5:
--
--     nombre:  "commercial_activity access"
--     cmd:     ALL
--     using:   (((auth.jwt() -> 'app_metadata') -> 'allowed_apps') ? 'commercial_activity')
--
--   pipeline_snapshots, pipeline_loans, pipeline_resolved_loans,
--   branches, branch_managers
--
-- Con `cmd = ALL`, cualquier sesión con el claim `commercial_activity` puede
-- hoy hacer DELETE (y UPDATE de cualquier columna) contra las 5 -- incluido
-- borrar snapshots ajenos o vaciar el roster de branches. Es el hueco
-- original que motivó este diagnóstico.
--
-- Ya no hace falta el PASO 0 de la versión anterior de este archivo (pedía
-- confirmar el nombre real de la política antes de escribir los `drop
-- policy` de abajo) -- el nombre real ya está confirmado arriba.
--
-- ---------------------------------------------------------------------------
-- QUÉ SE PROPONE, TABLA POR TABLA
-- ---------------------------------------------------------------------------
-- 1. pipeline_snapshots -- SELECT + INSERT sin restricción adicional, UPDATE
--    acotado a la columna `is_active` únicamente, SIN política de DELETE.
--
--    Confirmado por código (`app/api/pipeline/parse/route.ts`, única
--    llamada `supabase.rpc('save_pipeline_snapshot', {...})`, sin ningún
--    `.update()`/`.delete()` directo en ningún archivo de `app/`) que la
--    desactivación del snapshot anterior pasa EXCLUSIVAMENTE por esa RPC
--    (`SECURITY INVOKER`, confirmado contra `pg_proc`) -- el UPDATE que
--    hace internamente corre con los permisos de `authenticated`, así que
--    ese rol SÍ necesita poder tocar `is_active`, o la carga real se rompe.
--    Se acota en dos capas independientes, mismo patrón "dos cerrojos" ya
--    usado en `2026-08-org-employee-benchmark.sql` /
--    `2026-08-business-plan-note.sql`: GRANT de columna (`is_active`
--    únicamente) + política RLS con el mismo claim de siempre.
--
-- 2. pipeline_loans, pipeline_resolved_loans -- SELECT + INSERT únicamente,
--    sin UPDATE ni DELETE. Confirmado por código que ningún lugar de la app
--    hace UPDATE ni DELETE sobre estas 2 -- sólo SELECT (`latest/route.ts`,
--    `adverse-history/route.ts`) e INSERT (la misma RPC, para las filas del
--    snapshot nuevo).
--
-- 3. branches, branch_managers -- SELECT ÚNICAMENTE, ni siquiera INSERT.
--    Confirmado con grep exhaustivo de todo el repo (código Y `docs/sql/`):
--    las únicas 2 queries reales son ambas `.select()`
--    (`app/pipeline/page.tsx:332-352`, `.from('branch_managers').select(...)`
--    y `.from('branches').select(...)`, cargadas una sola vez al montar la
--    página, resultado va a `useState` del cliente, nunca se escribe de
--    vuelta) -- cero `.insert()`/`.update()`/`.upsert()`/`.delete()` en todo
--    el repo contra estas 2 tablas, ni desde la app ni desde ningún script
--    ni migración. Son roster de referencia, puramente de lectura.
--
-- Ninguna de las 5 necesita política de DELETE para `authenticated`: el
-- borrado de snapshots viejos ya NO pasa por PostgREST -- se movió a
-- `maintenance.run_pipeline_snapshot_retention()`, corrida por `pg_cron`
-- como `postgres` (ver `2026-08-retention-pg-cron.sql`), fuera del alcance
-- de RLS por completo. Quitar DELETE de `authenticated` no afecta la
-- retención, y cierra el hueco original (DELETE arbitrario contra
-- `pipeline_snapshots` con cualquier sesión con el claim).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 -- pipeline_snapshots: SELECT + INSERT + UPDATE(is_active) acotado
-- ---------------------------------------------------------------------------
drop policy if exists "commercial_activity access" on pipeline_forecast.pipeline_snapshots;

alter table pipeline_forecast.pipeline_snapshots enable row level security;

create policy pipeline_snapshots_select
  on pipeline_forecast.pipeline_snapshots
  for select
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

create policy pipeline_snapshots_insert
  on pipeline_forecast.pipeline_snapshots
  for insert
  to authenticated
  with check (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

-- Sin este UPDATE, save_pipeline_snapshot() (SECURITY INVOKER) no puede
-- desactivar el snapshot anterior y la carga de un archivo nuevo falla.
create policy pipeline_snapshots_update
  on pipeline_forecast.pipeline_snapshots
  for update
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  )
  with check (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

-- Sin política de DELETE -> denegado por defecto para `authenticated`.

revoke all on pipeline_forecast.pipeline_snapshots from authenticated;
grant select, insert on pipeline_forecast.pipeline_snapshots to authenticated;
-- GRANT de columna: la RPC sólo necesita poder tocar is_active. Si en algún
-- momento se confirma que la función toca otra columna más, agregarla acá
-- antes de aplicar, o el UPDATE de la RPC empieza a fallar.
grant update (is_active) on pipeline_forecast.pipeline_snapshots to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 2 -- pipeline_loans: SELECT + INSERT únicamente
-- ---------------------------------------------------------------------------
drop policy if exists "commercial_activity access" on pipeline_forecast.pipeline_loans;

alter table pipeline_forecast.pipeline_loans enable row level security;

create policy pipeline_loans_select
  on pipeline_forecast.pipeline_loans
  for select
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

create policy pipeline_loans_insert
  on pipeline_forecast.pipeline_loans
  for insert
  to authenticated
  with check (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

revoke all on pipeline_forecast.pipeline_loans from authenticated;
grant select, insert on pipeline_forecast.pipeline_loans to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 3 -- pipeline_resolved_loans: SELECT + INSERT únicamente
-- ---------------------------------------------------------------------------
drop policy if exists "commercial_activity access" on pipeline_forecast.pipeline_resolved_loans;

alter table pipeline_forecast.pipeline_resolved_loans enable row level security;

create policy pipeline_resolved_loans_select
  on pipeline_forecast.pipeline_resolved_loans
  for select
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

create policy pipeline_resolved_loans_insert
  on pipeline_forecast.pipeline_resolved_loans
  for insert
  to authenticated
  with check (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

revoke all on pipeline_forecast.pipeline_resolved_loans from authenticated;
grant select, insert on pipeline_forecast.pipeline_resolved_loans to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 4 -- branches: SELECT ÚNICAMENTE (ni siquiera INSERT)
-- ---------------------------------------------------------------------------
drop policy if exists "commercial_activity access" on pipeline_forecast.branches;

alter table pipeline_forecast.branches enable row level security;

create policy branches_select
  on pipeline_forecast.branches
  for select
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

-- Sin política de INSERT/UPDATE/DELETE -> las 3 denegadas por defecto.

revoke all on pipeline_forecast.branches from authenticated;
grant select on pipeline_forecast.branches to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 5 -- branch_managers: SELECT ÚNICAMENTE (ni siquiera INSERT)
-- ---------------------------------------------------------------------------
drop policy if exists "commercial_activity access" on pipeline_forecast.branch_managers;

alter table pipeline_forecast.branch_managers enable row level security;

create policy branch_managers_select
  on pipeline_forecast.branch_managers
  for select
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

-- Sin política de INSERT/UPDATE/DELETE -> las 3 denegadas por defecto.

revoke all on pipeline_forecast.branch_managers from authenticated;
grant select on pipeline_forecast.branch_managers to authenticated;


-- ===========================================================================
-- PASO 6 -- VERIFICACIÓN, pedida por Isa. Correr DESPUÉS de aplicar los 5
-- pasos de arriba, en este orden. Los 3 puntos tienen que dar el resultado
-- descrito -- si alguno no coincide, no se considera cerrado el diagnóstico.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 6a. Una carga de archivo real sigue funcionando -- la RPC sigue pudiendo
--     desactivar el snapshot anterior vía el UPDATE acotado a is_active.
-- ---------------------------------------------------------------------------
-- No es un chequeo de SQL Editor -- es una carga real desde /pipeline con una
-- sesión autenticada normal (no service_role). Antes y después, confirmar
-- con esta query (lectura, cualquier rol) que:
--   a) el snapshot NUEVO quedó con is_active = true
--   b) el snapshot que estaba activo ANTES de la carga quedó con
--      is_active = false (no se quedó en true, ni quedó también en true)
--
-- select id, file_name, uploaded_at, is_active
-- from pipeline_forecast.pipeline_snapshots
-- order by id desc
-- limit 5;
--
-- Si la carga real devuelve un error de la RPC (403/42501 o el mensaje de
-- persistencia de parse/route.ts, "No se pudo guardar en Supabase..."), el
-- GRANT de columna del PASO 1 quedó corto -- la función toca alguna columna
-- más además de is_active, hay que identificarla y agregarla al GRANT antes
-- de re-intentar.

-- ---------------------------------------------------------------------------
-- 6b. Un DELETE directo contra pipeline_snapshots, con una sesión
--     authenticated normal, ahora falla -- el problema original reportado.
-- ---------------------------------------------------------------------------
-- Simula el rol y el claim de una sesión autenticada real dentro del SQL
-- Editor (patrón estándar de Supabase para probar políticas RLS sin
-- necesitar un JWT real) -- el claim `commercial_activity` en
-- `allowed_apps` es el único dato que las políticas de arriba miran, así
-- que alcanza con simular eso, sin necesitar un usuario real.
--
-- begin;
--   set local role authenticated;
--   set local "request.jwt.claims" = '{"app_metadata": {"allowed_apps": ["commercial_activity"]}}';
--
--   -- Debe fallar con "new row violates row-level security policy" o,
--   -- directamente, "permission denied for table pipeline_snapshots"
--   -- (RLS deniega por no haber política de DELETE; el GRANT tampoco la
--   -- incluye -- dos cerrojos independientes, cualquiera de los dos alcanza).
--   delete from pipeline_forecast.pipeline_snapshots where id = (
--     select id from pipeline_forecast.pipeline_snapshots order by id desc limit 1
--   );
-- rollback;
--
-- El `rollback` es intencional incluso si el DELETE fallara (no debería
-- llegar a haber nada que revertir) -- así esta prueba nunca puede dejar un
-- cambio real, pase lo que pase.

-- ---------------------------------------------------------------------------
-- 6c. Un SELECT normal sobre las 5 tablas sigue funcionando sin cambios.
-- ---------------------------------------------------------------------------
-- Mismo patrón de simulación que 6b, pero sólo lectura -- confirmar que las
-- 5 siguen devolviendo filas con una sesión autenticada normal, exactamente
-- igual que antes de aplicar este archivo.
--
-- set local role authenticated;
-- set local "request.jwt.claims" = '{"app_metadata": {"allowed_apps": ["commercial_activity"]}}';
--
-- select count(*) from pipeline_forecast.pipeline_snapshots;
-- select count(*) from pipeline_forecast.pipeline_loans;
-- select count(*) from pipeline_forecast.pipeline_resolved_loans;
-- select count(*) from pipeline_forecast.branches;
-- select count(*) from pipeline_forecast.branch_managers;
--
-- Los 5 `count(*)` tienen que devolver el mismo número que devolvían antes
-- de aplicar este archivo (probar/repetir el diagnóstico si alguno da 0
-- inesperadamente, o un error de permisos).
