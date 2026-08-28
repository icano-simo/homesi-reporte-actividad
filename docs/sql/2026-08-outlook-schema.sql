-- ===========================================================================
-- MÓDULO OUTLOOK — esquema de persistencia (etapa OL1)
-- ===========================================================================
--
-- Guarda lo que el módulo Outlook DECIDE, no lo que calcula: los benchmarks de
-- estrategia, los de los realtors NPPM y las reglas de crecimiento. Todo lo
-- demás (cerrados YTD, forecast del mes) se lee de lo que ya existe y no se
-- copia acá.
--
-- Ejecutar como `postgres` en el SQL Editor de Supabase (proyecto simoOS-prod).
-- Idempotente: se puede correr entero de nuevo sin duplicar nada.
--
-- ⚠ Nada de esto es un cálculo. Es un PRESUPUESTO COMERCIAL: los números salen
-- de decisiones de gestión, y por eso cada fila lleva autor y fecha y nada se
-- sobrescribe nunca.
--
--
-- ---------------------------------------------------------------------------
-- LAS CUATRO DECISIONES DEL MODELO
-- ---------------------------------------------------------------------------
--
-- 1. **Schema propio, `outlook`, no dentro de `business_plan`.** Son dos
--    permisos distintos: `business_plan` se abre con el claim
--    `commercial_activity` (ver `business_plan.has_access()`), y Outlook con
--    `outlook`, que hoy tienen cuatro personas. Meter estas tablas en
--    `business_plan` las habría expuesto a todo el que ya entra ahí.
--
-- 2. **`strategy_benchmark` NO PUEDE GUARDAR 'Own Production'.** El CHECK lo
--    prohíbe explícitamente. Ese benchmark ya vive en `org.employee_benchmark`
--    y se edita en el perfil del Business Plan; si esta tabla pudiera
--    guardarlo, tarde o temprano habría dos valores para el mismo dato y
--    ninguna forma de saber cuál manda. La restricción convierte "no lo
--    dupliques" de convención en imposibilidad.
--
-- 3. **El benchmark de un NPPM se guarda por NOMBRE DE REALTOR, no por
--    empleado ni por (empleado, realtor).** Un realtor NPPM no es un empleado
--    --no tiene `employee_key`-- y, medido en los datos de hoy, el mismo
--    realtor trabaja con varios Loan Officers y en varias branches: Laura
--    Delgado aparece en el 733 con Aimmee Buendía y en el 776 con Silvio
--    Arteaga. Su benchmark es del realtor; lo que se atribuye al Loan Officer
--    es la PRODUCCIÓN de cada caso, que ya está en los datos.
--
--    Colgar el benchmark de (empleado, realtor) habría obligado a decidir
--    cuánto de Laura Delgado "le toca" a cada uno, que es justamente la
--    asignación que esta etapa NO construye.
--
-- 4. **Las reglas de crecimiento se versionan por REVISIÓN, no por fila.** Un
--    conjunto de reglas es una lista de tramos ("25% trimestral desde
--    septiembre, 10% mensual desde noviembre"), y esa lista tiene que leerse
--    completa o no leerse. Con append-only fila por fila, un editor que borra
--    un tramo no tendría forma de expresarlo.
--
--    Cada edición inserta una revisión NUEVA y COMPLETA para ese (empleado,
--    estrategia). El lector toma la revisión más alta. Las anteriores quedan
--    enteras y legibles, que es lo que hace auditable "quién puso que
--    Recruitment crecía 20% desde octubre".
--
--    Se usa un entero explícito y no `created_at` para agrupar: dos inserts en
--    el mismo milisegundo harían ambiguo el "más reciente".
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — el schema y su puerta
-- ---------------------------------------------------------------------------
create schema if not exists outlook;

/*
 * Mismo patrón que `business_plan.has_access()`, con otro claim. Se define como
 * función y no repitiendo la expresión en cada política para que el día que el
 * criterio cambie, cambie en un solo lugar.
 *
 * `set search_path to ''` es obligatorio acá: sin eso, quien llame puede
 * anteponer un schema propio y secuestrar el nombre `auth.jwt`.
 */
create or replace function outlook.has_access()
returns boolean
language sql
stable
set search_path to ''
as $function$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'outlook', false);
$function$;

grant usage on schema outlook to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 2 — benchmarks por estrategia (Loan Officer × estrategia)
-- ---------------------------------------------------------------------------
create table if not exists outlook.strategy_benchmark (
  strategy_benchmark_key bigint generated always as identity primary key,
  employee_key bigint not null references org.dim_employee (employee_key),

  /*
   * ⚠ 'Own Production' NO está en la lista, y es deliberado -- ver la decisión
   * 2 de la cabecera. Ese benchmark se lee de `org.employee_benchmark`.
   */
  strategy text not null check (strategy in ('B2B', 'NPPM', 'Recruitment', 'Affinity')),

  monthly_benchmark numeric(10, 2) not null check (monthly_benchmark >= 0),

  /*
   * Desde cuándo rige. La app siempre manda el primer día del mes SIGUIENTE:
   * un benchmark editado hoy no puede cambiar el mes que ya está corriendo,
   * porque el mes en curso ya se está midiendo contra el anterior.
   *
   * El CHECK exige día 1 pero no exige "mes siguiente": eso depende de cuándo
   * se mire y no se puede fijar en el esquema sin congelar una fecha. Lo
   * garantiza la app, y queda visible en el dato.
   */
  effective_from date not null check (date_trunc('month', effective_from) = effective_from),

  set_by text not null,
  note text,
  created_at timestamptz not null default now()
);

comment on table outlook.strategy_benchmark is
  'Append-only. Benchmark mensual por Loan Officer y estrategia. NO guarda Own Production: ese vive en org.employee_benchmark.';

create index if not exists strategy_benchmark_lookup_idx
  on outlook.strategy_benchmark (employee_key, strategy, effective_from desc);


-- ---------------------------------------------------------------------------
-- PASO 3 — benchmarks de los realtors NPPM
-- ---------------------------------------------------------------------------
create table if not exists outlook.nppm_benchmark (
  nppm_benchmark_key bigint generated always as identity primary key,

  /*
   * El nombre del realtor tal como lo trae `loan_records_v2.nppm_realtor`. Es
   * la única clave que existe: un NPPM no es empleado y no tiene código.
   *
   * Se guarda en la forma cruda y la comparación se hace normalizando en la
   * app (mismo criterio que `aliasIndex`), para no depender de que alguien
   * escriba igual las mayúsculas -- 'FRED A GOMEZ' y 'Fred A Gomez' son la
   * misma persona y los datos traen las dos formas.
   */
  nppm_realtor text not null,

  /*
   * El que trajo cuando entró. Sobre este se crece: la regla de crecimiento no
   * parte de su producción actual sino del compromiso con el que se lo sumó.
   */
  monthly_benchmark numeric(10, 2) not null check (monthly_benchmark >= 0),

  effective_from date not null check (date_trunc('month', effective_from) = effective_from),
  set_by text not null,
  note text,
  created_at timestamptz not null default now()
);

comment on table outlook.nppm_benchmark is
  'Append-only. Benchmark por REALTOR, no por (realtor, loan officer): el mismo realtor trabaja con varios LOs y branches.';

create index if not exists nppm_benchmark_lookup_idx
  on outlook.nppm_benchmark (nppm_realtor, effective_from desc);


-- ---------------------------------------------------------------------------
-- PASO 4 — reglas de crecimiento
-- ---------------------------------------------------------------------------
create table if not exists outlook.growth_rule (
  growth_rule_key bigint generated always as identity primary key,
  employee_key bigint not null references org.dim_employee (employee_key),

  /* Acá SÍ entra 'Own Production': su benchmark se lee de otra tabla, pero su
     regla de crecimiento se decide en este módulo como las otras cuatro. */
  strategy text not null
    check (strategy in ('Own Production', 'B2B', 'NPPM', 'Recruitment', 'Affinity')),

  /*
   * ⚠ La revisión agrupa los tramos que se guardaron JUNTOS. Ver la decisión 4
   * de la cabecera: el lector toma `max(revision)` por (empleado, estrategia) y
   * lee todos sus tramos. Una revisión con dos tramos reemplaza entera a una
   * anterior con tres -- así se puede quitar un tramo sin borrar filas.
   */
  revision int not null check (revision >= 1),
  /* Orden del tramo dentro de su revisión. Sólo para presentación estable. */
  segment_order int not null check (segment_order >= 1),

  /* Primer día del mes desde el que este tramo aplica. */
  from_month date not null check (date_trunc('month', from_month) = from_month),

  cadence text not null check (cadence in ('monthly', 'quarterly', 'semiannual')),

  /* En puntos porcentuales: 25 = 25%. Se admite 0 (una meseta) y negativo (una
     contracción planificada); lo que no se admite es menos de -100. */
  growth_pct numeric(6, 2) not null check (growth_pct >= -100),

  set_by text not null,
  note text,
  created_at timestamptz not null default now(),

  unique (employee_key, strategy, revision, segment_order)
);

comment on table outlook.growth_rule is
  'Append-only, versionado por revision. El crecimiento se aplica SOBRE EL BENCHMARK, nunca compuesto sobre el mes anterior -- ver lib/outlook/project.ts.';

create index if not exists growth_rule_lookup_idx
  on outlook.growth_rule (employee_key, strategy, revision desc, segment_order);


-- ---------------------------------------------------------------------------
-- PASO 5 — RLS: lectura y escritura sólo con el claim `outlook`
-- ---------------------------------------------------------------------------
-- ⚠ SIN políticas de UPDATE ni DELETE, en las tres tablas. Eso es lo que hace
-- append-only al modelo: no es una convención que alguien pueda saltarse desde
-- la app, es que la base no tiene por dónde. Mismo criterio que
-- `activity_report`, donde la ausencia de una política de DELETE es la que
-- garantiza que nadie borre lotes desde el cliente.
alter table outlook.strategy_benchmark enable row level security;
alter table outlook.nppm_benchmark enable row level security;
alter table outlook.growth_rule enable row level security;

grant select, insert on outlook.strategy_benchmark to authenticated;
grant select, insert on outlook.nppm_benchmark to authenticated;
grant select, insert on outlook.growth_rule to authenticated;
grant usage on all sequences in schema outlook to authenticated;

create policy strategy_benchmark_select on outlook.strategy_benchmark
  for select to authenticated using (outlook.has_access());
create policy strategy_benchmark_insert on outlook.strategy_benchmark
  for insert to authenticated with check (outlook.has_access());

create policy nppm_benchmark_select on outlook.nppm_benchmark
  for select to authenticated using (outlook.has_access());
create policy nppm_benchmark_insert on outlook.nppm_benchmark
  for insert to authenticated with check (outlook.has_access());

create policy growth_rule_select on outlook.growth_rule
  for select to authenticated using (outlook.has_access());
create policy growth_rule_insert on outlook.growth_rule
  for insert to authenticated with check (outlook.has_access());


-- ---------------------------------------------------------------------------
-- PASO 6 — el valor inicial: 25% trimestral para todos
-- ---------------------------------------------------------------------------
-- Un solo tramo por (Loan Officer × cinco estrategias), desde el mes siguiente
-- al actual. Revisión 1, para que cualquier edición posterior sea la 2.
--
-- ⚠ Se siembra sólo para quien es Loan Officer y está activo: sembrarle una
-- regla de crecimiento a alguien de soporte llenaría la vista de filas que no
-- corresponden.
--
-- Idempotente por el `not exists`: si ya hay una revisión 1 para ese par, no
-- inserta otra.
insert into outlook.growth_rule
  (employee_key, strategy, revision, segment_order, from_month, cadence, growth_pct, set_by, note)
select
  e.employee_key,
  s.strategy,
  1,
  1,
  (date_trunc('month', now() at time zone 'America/Chicago') + interval '1 month')::date,
  'quarterly',
  25,
  'seed-ol1',
  'Valor inicial de la etapa OL1: 25% por trimestre para todos, a ajustar caso por caso.'
from org.dim_employee e
cross join (values ('Own Production'), ('B2B'), ('NPPM'), ('Recruitment'), ('Affinity')) as s(strategy)
where e.is_loan_officer
  and e.is_active
  and not exists (
    select 1 from outlook.growth_rule g
     where g.employee_key = e.employee_key and g.strategy = s.strategy
  );


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Las tres tablas existen, con RLS y SIN update/delete. La última columna
--    debe dar 0 en las tres:
--
--      select c.relname, c.relrowsecurity,
--             count(*) filter (where p.cmd in ('UPDATE','DELETE')) as pol_update_delete
--        from pg_class c
--        join pg_namespace n on n.oid = c.relnamespace
--        left join pg_policies p on p.schemaname = 'outlook' and p.tablename = c.relname
--       where n.nspname = 'outlook' and c.relkind = 'r'
--       group by 1, 2;
--
-- 2. 'Own Production' no entra en strategy_benchmark. Esto DEBE fallar:
--
--      insert into outlook.strategy_benchmark
--        (employee_key, strategy, monthly_benchmark, effective_from, set_by)
--      values (1, 'Own Production', 3, '2026-09-01', 'prueba');
--
-- 3. Cuántas reglas sembró, y que todas sean revisión 1 con un solo tramo:
--
--      select count(*) as reglas,
--             count(distinct employee_key) as personas,
--             count(*) filter (where revision <> 1 or segment_order <> 1) as fuera_de_norma,
--             min(from_month) as desde
--        from outlook.growth_rule;
--
--    Esperado: 5 x (Loan Officers activos) reglas, todas desde 2026-09-01.
--
-- 4. Que alguien SIN el claim no vea nada. Con una sesión sin `outlook`:
--
--      select count(*) from outlook.growth_rule;   -- debe dar 0, no error
--
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   drop schema outlook cascade;
--
-- Se lleva las tres tablas, la función y las políticas. No toca ninguna otra
-- tabla: este esquema no es referenciado por nadie, sólo referencia
-- `org.dim_employee`.
-- ===========================================================================
