-- ===========================================================================
-- BP22 — LÍNEA BASE CONGELADA AL ENROLAR
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor. Hasta entonces la pantalla de impacto
-- dice qué falta en vez de romperse: `useBaseline` tolera el 404 de PostgREST.
--
--
-- ---------------------------------------------------------------------------
-- 1. POR QUÉ SE GUARDA EN VEZ DE RECALCULARSE
-- ---------------------------------------------------------------------------
--
-- El impacto de un Business Plan se mide contra cómo estaba la persona el día
-- que se enroló. Ese "antes" NO se puede recalcular después, y no es una
-- preferencia de diseño:
--
--   · Commercial Activity se recalcula entero con cada carga. El lote activo
--     cambia y con él cambian los meses de cada préstamo.
--   · Las reglas cambian. El cambio de Heather -- tomar la fecha de desembolso
--     en vez del mes de Closed -- movió préstamos de un mes a otro. Una línea
--     base recalculada habría cambiado sola, sin que la persona hiciera nada, y
--     el "impacto" con ella.
--
-- Es el mismo principio que ya rige el plan copiado al enrolar y el histórico
-- de forecast: LO QUE PASÓ NO SE RECALCULA CUANDO CAMBIAN LAS REGLAS.
--
-- El "después" sí es en vivo: se lee mes a mes de los datos actuales. La
-- asimetría es deliberada -- congelar el después haría que la pantalla dejara
-- de moverse, que es justamente lo que se quiere mirar.
--
--
-- ---------------------------------------------------------------------------
-- 2. QUÉ SE CONGELA
-- ---------------------------------------------------------------------------
--
-- El promedio mensual de los 3 meses COMPLETOS anteriores al mes de
-- enrolamiento, de las cuatro métricas. Los meses usados quedan guardados en
-- `baseline_months`: sin eso, dentro de un año nadie podría decir contra qué se
-- comparó, y "promedio de 3 meses" sería una afirmación no verificable.
--
-- Tres meses, y no uno, por la misma razón por la que el Qualifier 1 usa una
-- ventana de tres: un mes suelto de un Loan Officer es ruido.
--
-- ⚠ El mes de enrolamiento NO entra en la línea base ni cuenta como "después".
-- Está partido: Ana Peña se enroló el 14 de agosto, así que agosto tiene media
-- producción de antes del plan. La pantalla lo marca como parcial.
--
--
-- ---------------------------------------------------------------------------
-- 3. `captured` VS `reconstructed`
-- ---------------------------------------------------------------------------
--
-- `captured`      escrita en el momento de activar, en la misma operación que
--                 copia el plan. Es la foto real.
--
-- `reconstructed` calculada después, desde los datos actuales, para un
--                 enrolamiento que se creó antes de que esta tabla existiera.
--                 Es lo mejor que se puede hacer y NO es lo mismo: si el lote
--                 activo cambió desde el enrolamiento, estos números ya no son
--                 los que se vieron ese día.
--
-- La columna existe para que nadie tenga que adivinar cuál está mirando. La
-- pantalla lo dice con todas las letras.
--
--
-- ---------------------------------------------------------------------------
-- 4. SOLO INSERT Y SELECT
-- ---------------------------------------------------------------------------
--
-- Una línea base que se puede editar no es una línea base. Mismo criterio que
-- `org.employee_benchmark` y que `business_plan.note`: se resuelve por AUSENCIA
-- de política de UPDATE y DELETE, y el grant tampoco las incluye.
--
-- La PK es `enrollment_key`, así que tampoco puede haber dos líneas base para
-- el mismo plan: un segundo intento choca contra la clave primaria en vez de
-- dejar dos verdades conviviendo.
--
--
-- ---------------------------------------------------------------------------
-- 5. TODO: PARA EL REVISOR
-- ---------------------------------------------------------------------------
--
-- `business_plan` ya está expuesto en PostgREST desde BP6. Esta migración NO
-- necesita tocar `pgrst.db_schemas` ni ningún `alter role`.
-- ===========================================================================

create table if not exists business_plan.enrollment_baseline (
  enrollment_key bigint primary key
    references business_plan.enrollment (enrollment_key) on delete cascade,

  -- Promedios mensuales de los 3 meses completos previos al enrolamiento.
  -- `numeric` y no `integer`: 7 cierres en 3 meses son 2,3333 por mes, y
  -- redondear el "antes" a 2 inventaría una mejora que no ocurrió.
  avg_closings             numeric(10, 4) not null check (avg_closings >= 0),
  avg_credit_applications  numeric(10, 4) not null check (avg_credit_applications >= 0),
  avg_pre_approvals        numeric(10, 4) not null check (avg_pre_approvals >= 0),
  avg_file_creations       numeric(10, 4) not null check (avg_file_creations >= 0),

  -- Contra qué se comparó. Sin esto el promedio no es verificable.
  baseline_months text[] not null check (array_length(baseline_months, 1) = 3),
  -- El mes partido, el que no cuenta ni de un lado ni del otro.
  enrollment_month text not null check (enrollment_month ~ '^\d{4}-\d{2}$'),

  source      text not null check (source in ('captured', 'reconstructed')),
  captured_at timestamptz not null default now(),
  captured_by text
);

comment on table business_plan.enrollment_baseline is
  'Foto congelada del rendimiento previo al enrolamiento. Append-only: ver BP22.';


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table business_plan.enrollment_baseline enable row level security;

drop policy if exists enrollment_baseline_select on business_plan.enrollment_baseline;
create policy enrollment_baseline_select on business_plan.enrollment_baseline
  for select to authenticated using (business_plan.has_access());

drop policy if exists enrollment_baseline_insert on business_plan.enrollment_baseline;
create policy enrollment_baseline_insert on business_plan.enrollment_baseline
  for insert to authenticated with check (business_plan.has_access());

-- Sin policy de update ni de delete: las dos quedan vedadas. Es intencional.

grant usage on schema business_plan to authenticated;
grant select, insert on business_plan.enrollment_baseline to authenticated;


-- ===========================================================================
-- 6. RELLENO DE LOS DOS ENROLAMIENTOS QUE YA EXISTEN
-- ===========================================================================
--
-- Los dos se activaron el 14 de agosto de 2026, antes de que existiera esta
-- tabla, así que no tienen foto. Sin relleno la pantalla de impacto saldría
-- vacía para las únicas dos personas que hoy tienen plan.
--
-- Los valores se calcularon desde el lote activo de Commercial Activity
-- (`upload_batches.is_current`), sumando mayo, junio y julio de 2026 y
-- dividiendo por 3, con la MISMA resolución de nombres que usa el módulo
-- (`org.employee_alias`, coincidencia exacta y luego normalizada). Crudos:
--
--   Ana Peña     (employee_key 1,  enrollment 13)  cierres 7  apps 14  pre-appr 79  files 89
--   Kiana Smith  (employee_key 25, enrollment  8)  cierres 3  apps  5  pre-appr 20  files 23
--
-- ⚠ UNA DIFERENCIA CONTRA LA TABLA DEL BRIEF, DECLARADA:
-- el brief da 26,7 pre-approvals para Ana Peña; el dato da 26,3333 (79 ÷ 3, con
-- 22 en mayo, 27 en junio y 30 en julio). Los otros siete números coinciden.
-- Se deja el valor que sale de los datos, porque es el único reproducible: si
-- se cargara 26,7 nadie podría volver a obtenerlo desde la fuente. Si el 26,7
-- viene de otra regla de conteo, hay que decir cuál y se recalculan los dos.
--
-- Van marcados `reconstructed`, no `captured`. Es la diferencia entre "así
-- estaba el día que se enroló" y "así se ve hoy mirando para atrás".
-- ===========================================================================

insert into business_plan.enrollment_baseline (
  enrollment_key, avg_closings, avg_credit_applications, avg_pre_approvals,
  avg_file_creations, baseline_months, enrollment_month, source, captured_by
)
select e.enrollment_key, v.cl, v.app, v.pre, v.files,
       array['2026-05', '2026-06', '2026-07'], '2026-08', 'reconstructed', 'bp22-backfill'
from (values
  (1::bigint,  7.0 / 3, 14.0 / 3, 79.0 / 3, 89.0 / 3),   -- Ana Peña
  (25::bigint, 3.0 / 3,  5.0 / 3, 20.0 / 3, 23.0 / 3)    -- Kiana Smith
) as v (employee_key, cl, app, pre, files)
join business_plan.enrollment e
  on e.employee_key = v.employee_key and e.status = 'active'
-- Idempotente: si la migración se corre dos veces, la segunda no inserta nada
-- en vez de reventar contra la clave primaria.
on conflict (enrollment_key) do nothing;
