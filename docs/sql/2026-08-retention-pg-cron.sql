-- ===========================================================================
-- RETENCIÓN DE SNAPSHOTS DE PIPELINE — migración de Vercel Cron a pg_cron
-- ===========================================================================
--
-- Reemplaza al endpoint `GET /api/pipeline/retention` (borrado del repo junto
-- con su entrada en vercel.json). Ese endpoint corría con la anon key y sin
-- sesión; desde que se activó RLS en `pipeline_forecast` ya no podía escribir
-- nada, y al ser un cron no hay ninguna sesión de usuario de la que colgarse.
--
-- Corriendo dentro de la base el problema desaparece: no pasa por PostgREST,
-- así que RLS no interviene, y no hace falta ninguna service_role key en las
-- variables de entorno del proyecto.
--
-- Ejecutar como `postgres` en el SQL Editor de Supabase (proyecto simoOS-prod).
-- Es idempotente: se puede volver a correr entero sin duplicar nada.
--
-- ---------------------------------------------------------------------------
-- EQUIVALENCIA CON EL ENDPOINT ORIGINAL (app/api/pipeline/retention/route.ts)
-- ---------------------------------------------------------------------------
-- Cada decisión del código está replicada a propósito, incluidas las sutiles:
--
--   * El "primer"/"último" snapshot de un mes se decide por ORDEN DE INSERCIÓN
--     (id), no por snapshot_date -- puede haber más de una carga el mismo día.
--     El endpoint recorría los snapshots con `order by id asc` y se quedaba con
--     el primero y el último de cada mes, que es exactamente min(id)/max(id).
--
--   * `is_month_end` NO se marca para el mes en curso: ese mes todavía no
--     cerró, su última carga aún puede no ser la definitiva.
--
--   * Las fechas se calculan en UTC. El endpoint usaba
--     `new Date().toISOString()`, que es UTC; en un servidor con otra zona el
--     corte se movería un día.
--
--   * Primero se MARCAN los flags y recién después se BORRA. Así un snapshot
--     que acaba de convertirse en inicio/cierre de mes queda protegido en la
--     misma corrida.
--
--   * El borrado exige `is_month_start = false` y `is_month_end = false`
--     estrictos: una fila con NULL en esas columnas nunca se borra. Es lo mismo
--     que hacía el `.eq(campo, false)` de PostgREST.
--
--   * Se borran los hijos (pipeline_loans, pipeline_resolved_loans) antes que
--     el snapshot, sin depender de ON DELETE CASCADE -- el endpoint tampoco lo
--     asumía porque nunca se confirmó que exista en el esquema.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 (opcional pero recomendado) — verificar los supuestos del esquema
-- ---------------------------------------------------------------------------
-- Correr esto ANTES y confirmar que:
--   a) snapshot_date es `date` (si fuera timestamptz, ver la nota del paso 2);
--   b) existen las 3 tablas y la columna snapshot_id en las dos de detalle.
--
-- select table_name, column_name, data_type
-- from information_schema.columns
-- where table_schema = 'pipeline_forecast'
--   and table_name in ('pipeline_snapshots', 'pipeline_loans', 'pipeline_resolved_loans')
--   and column_name in ('id', 'snapshot_id', 'snapshot_date', 'is_month_start', 'is_month_end')
-- order by table_name, column_name;


-- ---------------------------------------------------------------------------
-- PASO 1 — schema propio para la tarea de mantenimiento
-- ---------------------------------------------------------------------------
-- NO se pone la función dentro de `pipeline_forecast` a propósito: ese schema
-- está expuesto a PostgREST, y toda función que viva ahí queda publicada como
-- endpoint RPC (`POST /rest/v1/rpc/...`). Siendo SECURITY DEFINER, eso sería
-- exactamente el agujero que se acaba de cerrar: cualquiera con sesión podría
-- disparar un borrado.
--
-- `maintenance` no se agrega a "Exposed schemas" (Settings → API), así que la
-- función no es alcanzable desde la API bajo ninguna circunstancia.
create schema if not exists maintenance;

revoke all on schema maintenance from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 2 — la función
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: corre con los privilegios del dueño (postgres), así que
-- atraviesa RLS. Es lo que permite que el mantenimiento funcione sin que exista
-- ninguna política que le abra la puerta a `anon` o `authenticated`.
--
-- `set search_path = ''` es obligatorio en una función SECURITY DEFINER: sin
-- eso, quien la llame puede anteponer un schema propio y hacer que un nombre
-- sin calificar resuelva a una tabla suya. Por eso abajo TODOS los nombres van
-- calificados con su schema.
create or replace function maintenance.run_pipeline_snapshot_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_retention_days  constant int := 90;
  v_today           date;
  v_current_month   text;
  v_cutoff          date;
  v_month_starts    int  := 0;
  v_month_ends      int  := 0;
  v_ids             bigint[];
  v_deleted_loans   int  := 0;
  v_deleted_resolved int := 0;
  v_deleted_snaps   int  := 0;
begin
  -- UTC, igual que el `new Date().toISOString()` del endpoint.
  v_today         := (now() at time zone 'utc')::date;
  v_current_month := to_char(v_today, 'YYYY-MM');
  v_cutoff        := v_today - v_retention_days;

  -- ── 1. Marcar el PRIMER snapshot de cada mes ──────────────────────────────
  -- min(id) = el primero que vio el loop del endpoint al recorrer por id asc.
  with bounds as (
    select
      to_char(s.snapshot_date, 'YYYY-MM') as month_key,
      min(s.id)                           as first_id
    from pipeline_forecast.pipeline_snapshots s
    group by 1
  )
  update pipeline_forecast.pipeline_snapshots s
     set is_month_start = true
    from bounds b
   where s.id = b.first_id
     -- `is distinct from true` y no `= false`: cubre también el caso NULL,
     -- igual que el `!s.is_month_start` del endpoint.
     and s.is_month_start is distinct from true;
  get diagnostics v_month_starts = row_count;

  -- ── 2. Marcar el ÚLTIMO snapshot de cada mes YA CERRADO ───────────────────
  -- El mes en curso queda afuera: todavía puede recibir más cargas.
  with bounds as (
    select
      to_char(s.snapshot_date, 'YYYY-MM') as month_key,
      max(s.id)                           as last_id
    from pipeline_forecast.pipeline_snapshots s
    group by 1
  )
  update pipeline_forecast.pipeline_snapshots s
     set is_month_end = true
    from bounds b
   where s.id = b.last_id
     and b.month_key <> v_current_month
     and s.is_month_end is distinct from true;
  get diagnostics v_month_ends = row_count;

  -- ── 3. Elegir qué borrar ──────────────────────────────────────────────────
  -- Se resuelve DESPUÉS de marcar, para que lo recién marcado quede protegido.
  select array_agg(s.id)
    into v_ids
    from pipeline_forecast.pipeline_snapshots s
   where s.snapshot_date < v_cutoff
     and s.is_month_start = false
     and s.is_month_end   = false;

  -- ── 4. Borrar hijos y después el padre ────────────────────────────────────
  -- En sentencias separadas y en este orden, sin depender de ON DELETE CASCADE.
  if v_ids is not null then
    delete from pipeline_forecast.pipeline_loans where snapshot_id = any(v_ids);
    get diagnostics v_deleted_loans = row_count;

    delete from pipeline_forecast.pipeline_resolved_loans where snapshot_id = any(v_ids);
    get diagnostics v_deleted_resolved = row_count;

    delete from pipeline_forecast.pipeline_snapshots where id = any(v_ids);
    get diagnostics v_deleted_snaps = row_count;
  end if;

  -- Mismas claves que devolvía el endpoint, para que los logs se lean igual.
  return jsonb_build_object(
    'cutoffDate',           v_cutoff,
    'monthStartsMarked',    v_month_starts,
    'monthEndsMarked',      v_month_ends,
    'deletedSnapshots',     v_deleted_snaps,
    'deletedLoanRows',      v_deleted_loans,
    'deletedResolvedRows',  v_deleted_resolved
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- PASO 3 — que nadie más pueda ejecutarla
-- ---------------------------------------------------------------------------
-- Postgres otorga EXECUTE a PUBLIC por defecto en toda función nueva. Sin este
-- revoke, la protección del paso 1 (schema no expuesto) sería la única barrera.
-- Defensa en profundidad: aunque alguien exponga `maintenance` por error, la
-- función sigue sin ser ejecutable por `anon` ni `authenticated`.
revoke all on function maintenance.run_pipeline_snapshot_retention() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 4 — programar el cron
-- ---------------------------------------------------------------------------
-- En Supabase, pg_cron se puede habilitar desde Database → Extensions, o acá.
create extension if not exists pg_cron with schema cron;

-- `cron.unschedule` falla si el job no existe, así que se consulta primero.
-- Esto es lo que hace re-ejecutable el archivo entero.
select cron.unschedule('pipeline-forecast-retention')
where exists (select 1 from cron.job where jobname = 'pipeline-forecast-retention');

-- '0 9 * * *' = 09:00 UTC, el MISMO horario que tenía el cron de Vercel
-- (vercel.json, ya borrado). pg_cron en Supabase también corre en UTC, así que
-- la tarea se ejecuta exactamente en el mismo momento que antes.
select cron.schedule(
  'pipeline-forecast-retention',
  '0 9 * * *',
  $cron$ select maintenance.run_pipeline_snapshot_retention(); $cron$
);


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Correrla a mano una vez y mirar el resultado (es segura: si no hay nada
--    para borrar, devuelve todos los contadores en 0):
--
--      select maintenance.run_pipeline_snapshot_retention();
--
-- 2. Confirmar que el job quedó programado:
--
--      select jobid, jobname, schedule, active, command
--      from cron.job
--      where jobname = 'pipeline-forecast-retention';
--
-- 3. Revisar las corridas (acá aparecen los errores si algo falla):
--
--      select status, return_message, start_time, end_time
--      from cron.job_run_details
--      where jobid = (select jobid from cron.job where jobname = 'pipeline-forecast-retention')
--      order by start_time desc
--      limit 20;
--
-- 4. Confirmar que NO quedó expuesta como RPC -- debe devolver 0 filas:
--
--      select p.proname
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where p.proname = 'run_pipeline_snapshot_retention'
--        and n.nspname = any (
--          string_to_array(current_setting('pgrst.db_schemas', true), ',')
--        );
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   select cron.unschedule('pipeline-forecast-retention');
--   drop function if exists maintenance.run_pipeline_snapshot_retention();
--   drop schema if exists maintenance;
--
-- ===========================================================================
