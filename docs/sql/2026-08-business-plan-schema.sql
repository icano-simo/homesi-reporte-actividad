-- ===========================================================================
-- Esquema `business_plan` — estado de intervención y tasas de pull-through
-- ===========================================================================
--
-- Etapa BP5 (módulo Business Plan OS).
--
-- ⚠ NO EJECUTADA POR QUIEN ESCRIBIÓ ESTE ARCHIVO. La aplica el revisor.
--   Crea un esquema nuevo, dos tablas, sus políticas de RLS y la exposición a
--   PostgREST.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UN ESQUEMA PROPIO Y NO `org`
-- ---------------------------------------------------------------------------
-- `org` es el roster canónico: dimensiones que comparten los tres módulos
-- (quién es quién, en qué branch, con qué alias). Commercial Activity y
-- Forecast también lo leen.
--
-- Lo de acá es del módulo Business Plan y de nadie más: a quién se revisó, qué
-- funnel se le eligió, qué tasas usa el cálculo. Meterlo en `org` haría que
-- otro módulo tuviera que ignorar tablas que no le incumben, y que un permiso
-- de escritura sobre `business_plan` implicara tocar el esquema compartido.
-- ===========================================================================

create schema if not exists business_plan;
comment on schema business_plan is
  'Estado propio del módulo Business Plan OS. `org` queda para dimensiones compartidas por los tres módulos.';


-- ===========================================================================
-- 1. business_plan.settings — tasas de pull-through
-- ===========================================================================
--
-- Clave-valor y no una fila con ocho columnas: las tasas se agregan y se
-- retiran a medida que el negocio ajusta el modelo, y una tabla ancha obligaría
-- a una migración por cada cambio.
--
-- ⚠ ALCANCE, LEER ANTES DE USAR
-- Hoy SÓLO Business Plan lee esta tabla. Forecast & Pipeline sigue con sus
-- constantes en `app/pipeline/page.tsx`. O sea: editar una tasa "compartida"
-- desde Settings cambia lo que ve Business Plan y NO cambia Forecast.
--
-- Es deuda deliberada, no un descuido: `app/pipeline/**` está fuera del alcance
-- de esta etapa y hay otras ramas trabajando ahí. Que Forecast consuma esta
-- tabla es una etapa aparte. Está anotado en docs/ARQUITECTURA.md y la
-- interfaz de Settings lo dice en pantalla.
create table if not exists business_plan.settings (
  key         text primary key,

  -- Proporción entre 0 y 1. `numeric(6,4)` da cuatro decimales: las tasas de
  -- la cascada de Forecast son 0.8923 y 0.8459, y truncarlas movería el
  -- forecast.
  value       numeric(6, 4) not null check (value >= 0 and value <= 1),

  -- 'shared'  -> conceptualmente compartida con Forecast (ver la nota de
  --              alcance de arriba: hoy la comparte sólo en el papel).
  -- 'bp_only' -> existe únicamente para el Qualifier 2 de Business Plan.
  scope       text not null default 'shared' check (scope in ('shared', 'bp_only')),

  label       text not null,
  updated_by  text not null,
  updated_at  timestamptz not null default now()
);

comment on table business_plan.settings is
  'Tasas de pull-through del módulo. OJO: hoy sólo las lee Business Plan; Forecast sigue con sus constantes en código (deuda anotada en docs/ARQUITECTURA.md).';

-- ---------------------------------------------------------------------------
-- Semilla
-- ---------------------------------------------------------------------------
-- Los cuatro valores por milestone son las tasas ACUMULADAS: la probabilidad
-- de que un préstamo que hoy está en ese milestone termine cerrando. Salen de
-- multiplicar la cascada de `app/pipeline/page.tsx` hacia adelante:
--
--   Started       0.8923 × 0.93 × 0.8459 × 0.95 = 0.6668  -> 66.7%
--   Processing             0.93 × 0.8459 × 0.95 = 0.7473  -> 74.7%
--   Underwriting                  0.8459 × 0.95 = 0.8036  -> 80.4%
--   Closing                                0.95 = 0.9500  -> 95.0%
--
-- Por eso "Applications hereda de Started": son la misma probabilidad vista
-- desde los dos módulos.
insert into business_plan.settings (key, value, scope, label, updated_by) values
  ('pt_milestone_started',      0.6668, 'shared',  'Milestone Started',        'seed (BP5)'),
  ('pt_milestone_processing',   0.7473, 'shared',  'Milestone Processing',     'seed (BP5)'),
  ('pt_milestone_underwriting', 0.8036, 'shared',  'Milestone Underwriting',   'seed (BP5)'),
  ('pt_milestone_closing',      0.9500, 'shared',  'Milestone Closing',        'seed (BP5)'),
  ('pt_brokered_flat',          0.4000, 'shared',  'Brokered flat',            'seed (BP5)'),
  ('q2_applications',           0.6668, 'shared',  'Applications (Q2)',        'seed (BP5)'),
  ('q2_credit_reports',         0.3000, 'bp_only', 'Credit Reports (Q2)',      'seed (BP5)'),
  ('q2_file_creations',         0.2000, 'bp_only', 'File Creations (Q2)',      'seed (BP5)')
on conflict (key) do nothing;

-- `q2_applications` arranca igual que `pt_milestone_started` PERO es una fila
-- propia: en cuanto alguien la edite desde Settings, deja de seguirlo. Ese es
-- exactamente el override que pidió el negocio -- por defecto hereda, y si se
-- cambia en Business Plan sólo cambia ahí.


-- ===========================================================================
-- 2. business_plan.intervention — qué se hizo con cada Loan Officer en riesgo
-- ===========================================================================
--
-- Alimenta la columna Status de las vistas 1 y 2, que ya no mide rendimiento
-- sino INTERVENCIÓN: ¿los que están en riesgo ya están atendidos?
create table if not exists business_plan.intervention (
  id            bigint generated always as identity primary key,

  -- bigint y no integer: iguala el tipo de org.dim_employee.employee_key.
  employee_key  bigint not null
    references org.dim_employee (employee_key) on delete cascade,

  -- Estado del acompañamiento.
  --   reviewed  -> alguien lo miró, todavía sin funnel elegido
  --   active    -> tiene un Business Plan corriendo
  --   closed    -> se cerró el ciclo
  status        text not null check (status in ('reviewed', 'active', 'closed')),

  -- NULLABLE a propósito: se puede estar revisado sin funnel elegido, que es
  -- justamente el estado "Revisado" de la vista 1.
  --
  -- Sin FK todavía: el catálogo de funnels no existe (es una etapa posterior).
  -- La referencia queda preparada; cuando exista `business_plan.funnel`, se
  -- agrega el constraint. Poner la FK ahora obligaría a crear una tabla vacía
  -- sólo para satisfacerla.
  funnel_key    integer,

  reviewed_at   timestamptz,
  reviewed_by   text,
  activated_at  timestamptz,
  activated_by  text,

  notes         text,
  created_at    timestamptz not null default now()
);

comment on table business_plan.intervention is
  'Qué se hizo con cada Loan Officer en riesgo. funnel_key es nullable porque "revisado sin funnel" es un estado válido.';
comment on column business_plan.intervention.funnel_key is
  'Referencia preparada al catálogo de funnels, que todavía no existe. Sin FK hasta que exista business_plan.funnel.';

-- Una persona puede tener varias intervenciones a lo largo del tiempo; la
-- vigente es la última no cerrada. El índice sirve a esa consulta.
create index if not exists intervention_employee_idx
  on business_plan.intervention (employee_key, created_at desc);


-- ===========================================================================
-- 3. RLS
-- ===========================================================================
alter table business_plan.settings     enable row level security;
alter table business_plan.intervention enable row level security;

-- Mismo criterio que `org`: hay que tener el claim del módulo.
create or replace function business_plan.has_access() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
    false
  );
$$;

drop policy if exists settings_read on business_plan.settings;
create policy settings_read on business_plan.settings
  for select to authenticated using (business_plan.has_access());

-- Las tasas SÍ se actualizan en el lugar: no son un registro histórico, son la
-- configuración vigente. `updated_by` guarda quién fue la última vez.
drop policy if exists settings_write on business_plan.settings;
create policy settings_write on business_plan.settings
  for update to authenticated
  using (business_plan.has_access())
  with check (business_plan.has_access() and updated_by = coalesce(auth.jwt() ->> 'email', ''));

drop policy if exists intervention_read on business_plan.intervention;
create policy intervention_read on business_plan.intervention
  for select to authenticated using (business_plan.has_access());

drop policy if exists intervention_insert on business_plan.intervention;
create policy intervention_insert on business_plan.intervention
  for insert to authenticated with check (business_plan.has_access());

drop policy if exists intervention_update on business_plan.intervention;
create policy intervention_update on business_plan.intervention
  for update to authenticated
  using (business_plan.has_access()) with check (business_plan.has_access());

grant usage on schema business_plan to authenticated;
grant select, update on business_plan.settings to authenticated;
grant select, insert, update on business_plan.intervention to authenticated;
grant usage on all sequences in schema business_plan to authenticated;


-- ===========================================================================
-- 4. Exposición a PostgREST  ⚠ TODO PARA EL REVISOR — NO HAY COMANDO ACÁ
-- ===========================================================================
--
-- Sin esto el esquema existe pero la app no lo ve: PostgREST sólo sirve los
-- esquemas de su lista.
--
-- ⚠ ACÁ NO VA UN COMANDO LISTO PARA COPIAR, Y ES DELIBERADO.
--
-- `alter role authenticator set pgrst.db_schemas = '...'` REEMPLAZA la lista
-- entera, no agrega. Quien escribe este archivo no puede ver qué esquemas hay
-- configurados hoy: esa lista incluye los de OTRAS aplicaciones que comparten
-- la instancia. Un comando escrito de memoria las deja sin acceso a sus datos.
--
-- Ya pasó de hecho: una versión anterior de este archivo listaba cuatro
-- esquemas y la lista real tenía ocho (b2b_metrics, finance_pl, hr_us_payroll
-- y finance_division son del app de Homesí P&L). Correrlo tal cual habría
-- roto esa aplicación.
--
-- Es la línea con más radio de impacto del proyecto. El procedimiento:
--
--   1. Ver qué hay configurado AHORA:
--        select rolname, rolconfig from pg_roles where rolname = 'authenticator';
--
--   2. Agregar `business_plan` a esa lista, conservando todo lo demás. Lo más
--      seguro es hacerlo desde el panel de Supabase (Settings → API →
--      "Exposed schemas"), que edita la lista existente en vez de pisarla.
--
--   3. Recién si se hace por SQL, escribir el `alter role` con la lista
--      COMPLETA leída en el paso 1 más `business_plan`, y después:
--        notify pgrst, 'reload config';
--
-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Las 8 tasas están cargadas:
--      select key, value, scope from business_plan.settings order by key;
--
-- 2. PostgREST ve el esquema. Desde la app, el pie de Business Plan deja de
--    decir que las tasas salen de los valores por defecto del código.
--
-- 3. Con una sesión `authenticated`, la historia del benchmark sigue sin
--    poder reescribirse y las tasas sí se pueden actualizar:
--      update business_plan.settings set value = 0.75 where key = 'pt_milestone_processing';
--
-- 4. `funnel_key` acepta null:
--      insert into business_plan.intervention (employee_key, status, reviewed_at, reviewed_by)
--      values (5, 'reviewed', now(), 'isabella.cano');
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   drop schema if exists business_plan cascade;
--   -- y sacar 'business_plan' de la lista de esquemas expuestos.
--
-- ===========================================================================
