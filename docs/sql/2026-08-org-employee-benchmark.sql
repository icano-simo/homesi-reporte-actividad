-- ===========================================================================
-- org.employee_benchmark — benchmark mensual por Loan Officer
-- ===========================================================================
--
-- Etapa BP1, ampliada en BP5 (módulo Business Plan OS).
--
-- ⚠ NO EJECUTADA POR QUIEN ESCRIBIÓ ESTE ARCHIVO. La aplica el revisor, a
--   propósito: crea una tabla y una política de ESCRITURA en un esquema que
--   hoy es de sólo lectura para la app.
--
-- ---------------------------------------------------------------------------
-- QUÉ PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- El benchmark por Loan Officer no existe en ninguna fuente: ni en el roster,
-- ni en Salesforce, ni en el SLQuery. Es un dato de gestión que alguien define.
--
-- Sin él no hay GAP y no hay veredicto. La app maneja ese estado explícitamente
-- y **no aplica ningún default** -- un default silencioso haría que el módulo
-- mostrara veredictos inventados, que es peor que no mostrar nada.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTÁ VERSIONADA POR FECHA
-- ---------------------------------------------------------------------------
-- La clave primaria es (employee_key, effective_from), no employee_key solo.
-- Cada cambio INSERTA una fila; nunca se sobrescribe. Si el benchmark de
-- alguien cambia en septiembre, la fila de agosto se conserva y se puede
-- responder "¿con qué número se lo evaluó en agosto?" sin reconstruir nada.
--
-- La app toma, para cada persona, la fila vigente más reciente
-- (effective_from <= hoy). Ver `lib/business-plan/loadData.ts`.
-- ===========================================================================


create table if not exists org.employee_benchmark (
  -- bigint y no integer: iguala el tipo de org.dim_employee.employee_key.
  employee_key      bigint not null
    references org.dim_employee (employee_key) on delete cascade,

  -- Cierres mensuales esperados. `numeric` y no `integer`: el negocio podría
  -- fijar 2.5 para alguien de medio tiempo, y redondearlo cambiaría su GAP.
  monthly_benchmark numeric(6, 2) not null
    check (monthly_benchmark >= 0),

  -- Desde cuándo rige. Fecha, no timestamp: es una decisión de gestión que se
  -- toma por período, no un evento con hora.
  effective_from    date not null default current_date,

  -- ── Auditoría (etapa BP5) ──────────────────────────────────────────────
  -- `set_by` es NOT NULL a propósito: el benchmark es editable desde la
  -- interfaz, así que toda fila nueva tiene un autor conocido. Sale del
  -- usuario autenticado (auth.jwt() ->> 'email'), NUNCA de un campo del
  -- formulario -- si viniera del formulario, cualquiera podría firmar con el
  -- nombre de otro.
  --
  -- Texto libre y no una FK: no hay una tabla de usuarios de la app con la que
  -- referenciar, y forzar una acoplaría este catálogo al módulo de auth.
  set_by            text not null,

  -- Cuándo se registró el cambio. Distinto de `effective_from`: se puede fijar
  -- hoy un benchmark que rige desde el mes que viene, y hace falta saber ambas
  -- cosas para auditar.
  set_at            timestamptz not null default now(),

  created_at        timestamptz not null default now(),

  primary key (employee_key, effective_from)
);

comment on table org.employee_benchmark is
  'Benchmark mensual de cierres por Loan Officer, versionado por fecha de vigencia. Cada cambio inserta una fila; nunca se sobrescribe. Sin fila = sin benchmark = sin veredicto (nunca un default).';
comment on column org.employee_benchmark.effective_from is
  'Desde cuándo rige. La app usa la fila vigente más reciente (effective_from <= hoy).';
comment on column org.employee_benchmark.set_by is
  'Usuario autenticado que registró el cambio. Lo pone el default desde el JWT, no el cliente.';
comment on column org.employee_benchmark.set_at is
  'Cuándo se registró. Distinto de effective_from, que es desde cuándo rige.';

-- Si la tabla ya existía de la etapa BP1, estas dos columnas la ponen al día.
-- `set_by` se agrega primero como nullable, se rellena y recién después se
-- vuelve NOT NULL: hacerlo directo fallaría si hubiera filas cargadas.
alter table org.employee_benchmark add column if not exists set_at timestamptz not null default now();
alter table org.employee_benchmark add column if not exists set_by text;
update org.employee_benchmark set set_by = 'unknown (pre-BP5)' where set_by is null;
alter table org.employee_benchmark alter column set_by set not null;

-- Índice para "traeme el vigente de esta persona": la PK ya cubre
-- (employee_key, effective_from), pero en orden ascendente. La consulta real
-- busca el MAYOR effective_from por persona.
create index if not exists employee_benchmark_current_idx
  on org.employee_benchmark (employee_key, effective_from desc);


-- ---------------------------------------------------------------------------
-- RLS — lectura como el resto de `org`, y escritura acotada (etapa BP5)
-- ---------------------------------------------------------------------------
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

-- ⚠ ESTA ES LA PARTE NUEVA Y LA QUE HAY QUE MIRAR CON CUIDADO.
--
-- Hasta BP5 el esquema `org` era de sólo lectura para la app. El benchmark
-- ahora se edita desde el perfil del Loan Officer, así que hace falta INSERT.
--
-- Se permite INSERT y NO update ni delete: así el versionado no es una
-- convención que el código respeta, es algo que la base IMPONE. Aunque alguien
-- llame a la API directamente, no puede reescribir la historia.
--
-- El `with check` obliga además a que `set_by` sea el email del propio usuario
-- autenticado. Sin eso, el cliente podría mandar cualquier cadena y la
-- auditoría no valdría nada.
drop policy if exists employee_benchmark_insert on org.employee_benchmark;
create policy employee_benchmark_insert
  on org.employee_benchmark
  for insert
  to authenticated
  with check (
    coalesce(
      (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
      false
    )
    and set_by = coalesce(auth.jwt() ->> 'email', '')
  );

grant usage on schema org to authenticated;
grant select, insert on org.employee_benchmark to authenticated;


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Las columnas de auditoría existen y son NOT NULL:
--      select column_name, is_nullable, column_default
--        from information_schema.columns
--       where table_schema = 'org' and table_name = 'employee_benchmark';
--
-- 2. Hay exactamente dos políticas, una de select y una de insert -- ninguna
--    de update ni de delete:
--      select policyname, cmd from pg_policies
--       where schemaname = 'org' and tablename = 'employee_benchmark';
--
-- 3. La historia no se puede reescribir. Con una sesión `authenticated`:
--      update org.employee_benchmark set monthly_benchmark = 99;   -- 0 filas
--      delete from org.employee_benchmark;                          -- 0 filas
--
-- 4. No se puede firmar con el nombre de otro:
--      insert into org.employee_benchmark (employee_key, monthly_benchmark, set_by)
--      values (1, 2, 'otra.persona@homesi.com');   -- debe fallar por la policy
--
-- 5. Editar el benchmark desde el perfil de un Loan Officer y volver a
--    editarlo deja DOS filas, no una modificada:
--      select employee_key, monthly_benchmark, effective_from, set_by, set_at
--        from org.employee_benchmark order by set_at desc;
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   drop policy if exists employee_benchmark_insert on org.employee_benchmark;
--   revoke insert on org.employee_benchmark from authenticated;
--   -- y, si se quiere borrar todo:
--   -- drop table if exists org.employee_benchmark;
--
-- ===========================================================================
