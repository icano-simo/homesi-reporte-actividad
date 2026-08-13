-- ===========================================================================
-- org.employee_benchmark — benchmark mensual por Loan Officer
-- ===========================================================================
--
-- Etapa BP1 (módulo Business Plan OS).
--
-- ⚠ NO EJECUTADA POR QUIEN ESCRIBIÓ ESTE ARCHIVO. La aplica el revisor, a
--   propósito: crea una tabla en un esquema que hoy es de sólo lectura para la
--   app, y el brief pidió entregarla como archivo.
--
-- ---------------------------------------------------------------------------
-- QUÉ PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- El benchmark por LO no existe en ninguna fuente: ni en el roster, ni en
-- Salesforce, ni en el SLQuery. Es un dato de gestión que alguien define.
--
-- Sin él no hay GAP y no hay triage. La app YA maneja ese estado: muestra
-- "no benchmark" y deja al LO como "no evaluable". **No hay default a 2.0 ni a
-- ningún otro número** -- un default silencioso haría que todo el módulo
-- mostrara veredictos inventados, que es peor que no mostrar nada.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTÁ VERSIONADA POR FECHA
-- ---------------------------------------------------------------------------
-- La clave primaria es (employee_key, effective_from), no employee_key solo.
-- Si el benchmark de alguien cambia en septiembre, la fila de agosto se
-- conserva: se puede responder "¿con qué número se lo evaluó en agosto?" sin
-- reconstruir nada. Un UPDATE en su lugar borraría esa historia.
--
-- La app toma, para cada persona, la fila vigente más reciente
-- (effective_from <= hoy). Ver `loadData.ts`.
-- ===========================================================================


create table if not exists org.employee_benchmark (
  employee_key      integer not null
    references org.dim_employee (employee_key) on delete cascade,

  -- Cierres mensuales esperados. `numeric` y no `integer`: el negocio podría
  -- fijar 2.5 para alguien de medio tiempo, y redondearlo cambiaría su GAP.
  monthly_benchmark numeric(6, 2) not null
    check (monthly_benchmark >= 0),

  -- Desde cuándo rige. Fecha, no timestamp: es una decisión de gestión que se
  -- toma por período, no un evento con hora.
  effective_from    date not null default current_date,

  -- Quién lo fijó. Texto libre a propósito: hoy no hay una tabla de usuarios de
  -- la app con la que hacer FK, y forzar una acoplaría este catálogo al módulo
  -- de auth sin necesidad.
  set_by            text,

  created_at        timestamptz not null default now(),

  primary key (employee_key, effective_from)
);

comment on table org.employee_benchmark is
  'Benchmark mensual de cierres por Loan Officer, versionado por fecha de vigencia. Sin fila = sin benchmark = triage no evaluable (nunca un default).';
comment on column org.employee_benchmark.effective_from is
  'Desde cuándo rige. La app usa la fila vigente más reciente (effective_from <= hoy).';

-- Índice para "traeme el vigente de esta persona": la PK ya cubre
-- (employee_key, effective_from), pero en orden ascendente. La consulta real
-- busca el MAYOR effective_from por persona.
create index if not exists employee_benchmark_current_idx
  on org.employee_benchmark (employee_key, effective_from desc);


-- ---------------------------------------------------------------------------
-- RLS — mismo criterio que el resto del esquema org
-- ---------------------------------------------------------------------------
-- Sólo lectura para `authenticated`, y sólo si el usuario tiene
-- "commercial_activity" en app_metadata.allowed_apps. La escritura queda para
-- el service_role (script de administración o carga manual), igual que
-- allowed_apps: si el propio usuario pudiera escribir su benchmark, podría
-- bajárselo hasta aprobar siempre.
alter table org.employee_benchmark enable row level security;

drop policy if exists employee_benchmark_read on org.employee_benchmark;
create policy employee_benchmark_read
  on org.employee_benchmark
  for select
  to authenticated
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
  );

grant usage on schema org to authenticated;
grant select on org.employee_benchmark to authenticated;


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. La tabla existe y está vacía (correcto: no se puebla con datos inventados):
--      select count(*) from org.employee_benchmark;
--
-- 2. RLS activa y con una sola política de lectura:
--      select relrowsecurity from pg_class
--       where oid = 'org.employee_benchmark'::regclass;
--      select policyname, cmd, roles from pg_policies
--       where schemaname = 'org' and tablename = 'employee_benchmark';
--
-- 3. Al abrir el módulo en la app, el pie de página deja de decir
--    "org.employee_benchmark is not available yet".
--
-- ===========================================================================
-- CÓMO CARGAR BENCHMARKS (ejemplo, NO ejecutar tal cual)
-- ===========================================================================
--
--   insert into org.employee_benchmark (employee_key, monthly_benchmark, effective_from, set_by)
--   select e.employee_key, 2.00, date '2026-09-01', 'isabella.cano'
--     from org.dim_employee e
--    where e.full_name = 'Ana Zegarra (Peña)'
--   on conflict (employee_key, effective_from) do update
--      set monthly_benchmark = excluded.monthly_benchmark,
--          set_by            = excluded.set_by;
--
-- Se busca por `full_name` y no por employee_key a mano porque el nombre
-- canónico es lo que la gente reconoce; la clave es interna.
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   drop table if exists org.employee_benchmark;
--
-- ===========================================================================
