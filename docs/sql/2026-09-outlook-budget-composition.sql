-- ============================================================================
-- OUTLOOK — el presupuesto compuesto por plan de negocio (etapa OL26, punto 5)
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- Ejecutar como `postgres` en el SQL Editor de Supabase (proyecto simoOS-prod).
-- Idempotente: se puede correr entero de nuevo sin duplicar nada.
--
-- ----------------------------------------------------------------------------
-- LA RELACIÓN SE INVIERTE, Y ES EL PUNTO DE ESTA ETAPA
-- ----------------------------------------------------------------------------
-- Hasta acá el total de una persona es la SUMA de sus estrategias: Own
-- Production + B2B + NPPM + Recruitment, cada una con su propio benchmark y su
-- propia regla (`outlook.strategy_benchmark` + `outlook.growth_rule`).
--
-- Esta etapa agrega una SEGUNDA forma de fijar el número, que no reemplaza a la
-- primera sino que vive al lado: el TOTAL del Loan Officer (o del realtor NPPM)
-- se fija PRIMERO, mes a mes -- un número, escrito a mano, igual que
-- `monthly_target` -- y el desglose por plan queda como INFORMACIÓN, no como
-- la fuente del total.
--
--   HASTA HOY     total = suma de las estrategias (se calcula)
--   ESTA ETAPA     total = lo que alguien fija (se escribe)
--                  desglose = cómo se explica ese total (se escribe aparte,
--                             y puede no sumar exacto -- ver más abajo)
--
-- Dos tablas, no una: el total y el desglose son DOS DECISIONES distintas, con
-- vida propia. Guardar el total no obliga a tener un desglose todavía, y
-- corregir el desglose no tiene por qué re-fijar el total. Es la misma lógica
-- que ya separa `strategy_benchmark` de `growth_rule` -- el benchmark y la
-- regla son dos decisiones sobre el mismo número, en dos tablas.
--
-- ----------------------------------------------------------------------------
-- QUÉ ES CADA BUCKET DEL DESGLOSE — confirmado con Isabella, 2026-09-09
-- ----------------------------------------------------------------------------
-- `own_production`   lo que la persona trae por su cuenta. Existe SIN
--                     intervención de nadie.
-- `b2b`               igual que la estrategia de siempre: dueño de oportunidad
--                     Business Developer.
-- `nppm`              igual que la estrategia de siempre: producción NPPM.
-- `business_plan`     el negocio que viene del FUNNEL ACTIVO -- lo que se
--                     espera que produzca el plan de acompañamiento, las
--                     acciones del funnel. Es la APUESTA de haberlo enrolado,
--                     no algo que exista solo. Separarlo de `own_production` es
--                     lo que después permite preguntarse si el plan sirvió.
--
-- ⚠ `business_plan` acá es un BUCKET DEL DESGLOSE, no una integración con las
-- tablas del funnel (`business_plan.*`, que administra otro módulo/rama). Esta
-- etapa no lee ni escribe ahí: el número de este bucket lo escribe a mano quien
-- carga el presupuesto, igual que los otros tres. El día que se quiera que sea
-- un cálculo en vez de un número escrito, esa es una etapa aparte -- y una que
-- SÍ tendría que coordinarse con quien mantiene ese módulo.
--
-- ----------------------------------------------------------------------------
-- QUIÉN TIENE CUÁTRO BUCKETS Y QUIÉN TIENE DOS — confirmado con Isabella
-- ----------------------------------------------------------------------------
-- Es POR PERSONA, no por branch:
--
--   Loan Officer     los cuatro: own_production, b2b, nppm, business_plan.
--   Realtor NPPM     sólo dos: own_production, business_plan. "Un realtor NPPM
--                    no tiene B2B ni NPPM propios -- su producción es lo que
--                    trae él, más lo que sume un plan si lo tiene."
--
-- Y por eso el sujeto de las dos tablas es el mismo XOR que ya usa
-- `outlook.nppm_benchmark` frente a `outlook.strategy_benchmark`: un
-- `employee_key` (Loan Officer) O un `nppm_realtor` (nombre, sin
-- `employee_key` -- un realtor NPPM no es un empleado), nunca los dos ni
-- ninguno. NO se usa `branch_code` como en `2026-08-outlook-branch-budget.sql`:
-- ahí el sujeto podía ser una persona o un branch entero; acá siempre es una
-- persona, de dos tipos distintos.
--
-- ----------------------------------------------------------------------------
-- QUÉ PASA SI EL DESGLOSE NO SUMA EL TOTAL — Y POR QUÉ NO SE FUERZA
-- ----------------------------------------------------------------------------
-- No hay ningún CHECK ni trigger que lo impida. Es la misma decisión que ya
-- sostiene la fila de reconciliación de la pantalla: un descuadre visible es
-- mejor que uno escondido, y forzarlo -- rechazando el guardado, o
-- reescalando los buckets para que sumen -- inventaría un número que nadie
-- decidió. La pantalla MUESTRA la diferencia (folio aparte, fuera de este SQL);
-- la base no la corrige ni la rechaza.
--
-- ----------------------------------------------------------------------------
-- LA REVISIÓN, IGUAL QUE EN TODOS LADOS
-- ----------------------------------------------------------------------------
-- Append-only, versionado por revisión entera -- mismo patrón que
-- `growth_rule` y `monthly_target`, y por el mismo motivo: fijar tres meses es
-- UNA decisión, no tres, y se lee completa o no se lee.
--
-- Las dos tablas versionan POR SU CUENTA: la revisión del total y la del
-- desglose no comparten contador. Es el mismo riesgo que ya existe entre
-- `growth_rule` y `projection_mode` -- si el guardado combinado fallara a
-- mitad de camino, una tabla puede quedar en una revisión más nueva que la
-- otra. La app guarda primero el total; si el desglose falla después, el total
-- ya escrito no se pierde y el desglose de ese guardado queda pendiente de
-- reintentar. Mismo orden de "qué se guarda primero" que ya usa
-- `StrategyEditor` con la regla y el modo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — el total, fijado a mano, mes a mes
-- ---------------------------------------------------------------------------
create table if not exists outlook.person_budget_total (
  person_budget_total_key bigint generated always as identity primary key,

  employee_key bigint references org.dim_employee (employee_key),
  nppm_realtor text,
  constraint person_budget_total_subject_check
    check ((employee_key is not null) <> (nppm_realtor is not null)),

  /* La revisión agrupa los meses guardados JUNTOS -- mismo mecanismo que
     `outlook.monthly_target`. */
  revision int not null check (revision >= 1),

  /* Primer día del mes al que se le fija el total. */
  target_month date not null check (date_trunc('month', target_month) = target_month),

  total numeric(10, 2) not null check (total >= 0),

  set_by text not null,
  note text,
  created_at timestamptz not null default now()
);

comment on table outlook.person_budget_total is
  'Append-only, versionado por revision. El TOTAL fijado a mano por persona y mes -- ya no se calcula como suma de estrategias. Ver el desglose informativo en outlook.person_budget_breakdown.';

create unique index if not exists person_budget_total_employee_uk
  on outlook.person_budget_total (employee_key, revision, target_month)
  where employee_key is not null;

create unique index if not exists person_budget_total_realtor_uk
  on outlook.person_budget_total (nppm_realtor, revision, target_month)
  where nppm_realtor is not null;

create index if not exists person_budget_total_employee_lookup_idx
  on outlook.person_budget_total (employee_key, revision desc, target_month)
  where employee_key is not null;

create index if not exists person_budget_total_realtor_lookup_idx
  on outlook.person_budget_total (nppm_realtor, revision desc, target_month)
  where nppm_realtor is not null;


-- ---------------------------------------------------------------------------
-- PASO 2 — el desglose informativo, por plan
-- ---------------------------------------------------------------------------
create table if not exists outlook.person_budget_breakdown (
  person_budget_breakdown_key bigint generated always as identity primary key,

  employee_key bigint references org.dim_employee (employee_key),
  nppm_realtor text,
  constraint person_budget_breakdown_subject_check
    check ((employee_key is not null) <> (nppm_realtor is not null)),

  revision int not null check (revision >= 1),
  target_month date not null check (date_trunc('month', target_month) = target_month),

  bucket text not null check (bucket in ('own_production', 'b2b', 'nppm', 'business_plan')),

  /*
   * ⚠ UN REALTOR NPPM SÓLO TIENE DOS BUCKETS -- confirmado con Isabella. No es
   * un CHECK de una sola columna, pero SÍ puede mirar la otra columna de LA
   * MISMA fila: un realtor (`nppm_realtor is not null`) nunca puede traer
   * 'b2b' ni 'nppm'.
   */
  constraint person_budget_breakdown_realtor_buckets_check
    check (nppm_realtor is null or bucket in ('own_production', 'business_plan')),

  value numeric(10, 2) not null check (value >= 0),

  set_by text not null,
  note text,
  created_at timestamptz not null default now()
);

comment on table outlook.person_budget_breakdown is
  'Append-only, versionado por revision. El desglose INFORMATIVO de outlook.person_budget_total por bucket (own_production/b2b/nppm/business_plan). No tiene por qué sumar el total -- eso se muestra en pantalla, no se fuerza acá.';

create unique index if not exists person_budget_breakdown_employee_uk
  on outlook.person_budget_breakdown (employee_key, revision, target_month, bucket)
  where employee_key is not null;

create unique index if not exists person_budget_breakdown_realtor_uk
  on outlook.person_budget_breakdown (nppm_realtor, revision, target_month, bucket)
  where nppm_realtor is not null;

create index if not exists person_budget_breakdown_employee_lookup_idx
  on outlook.person_budget_breakdown (employee_key, revision desc, target_month)
  where employee_key is not null;

create index if not exists person_budget_breakdown_realtor_lookup_idx
  on outlook.person_budget_breakdown (nppm_realtor, revision desc, target_month)
  where nppm_realtor is not null;


-- ---------------------------------------------------------------------------
-- PASO 3 — RLS: lectura y escritura sólo con el claim `outlook`
-- ---------------------------------------------------------------------------
-- ⚠ SIN políticas de UPDATE ni DELETE, igual que el resto del esquema. Eso es
-- lo que hace append-only al modelo: no es una convención que la app pueda
-- saltarse, es que la base no tiene por dónde.
alter table outlook.person_budget_total enable row level security;
alter table outlook.person_budget_breakdown enable row level security;

grant select, insert on outlook.person_budget_total to authenticated;
grant select, insert on outlook.person_budget_breakdown to authenticated;
grant usage on all sequences in schema outlook to authenticated;

create policy person_budget_total_select on outlook.person_budget_total
  for select to authenticated using (outlook.has_access());
create policy person_budget_total_insert on outlook.person_budget_total
  for insert to authenticated with check (outlook.has_access());

create policy person_budget_breakdown_select on outlook.person_budget_breakdown
  for select to authenticated using (outlook.has_access());
create policy person_budget_breakdown_insert on outlook.person_budget_breakdown
  for insert to authenticated with check (outlook.has_access());


-- ---------------------------------------------------------------------------
-- PASO 4 — no hay siembra, y es a propósito
-- ---------------------------------------------------------------------------
-- Ninguna persona tiene un total fijado a mano todavía: hasta que se aplique
-- esta etapa en la pantalla, el total sigue siendo la suma de estrategias de
-- siempre. Sembrar filas acá diría que alguien fijó un total que nadie fijó.


-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
--
-- 1. Las dos tablas, con RLS y SIN update/delete. La última columna debe dar 0:
--
--      select c.relname, c.relrowsecurity,
--             count(*) filter (where p.cmd in ('UPDATE','DELETE')) as pol_update_delete
--        from pg_class c
--        join pg_namespace n on n.oid = c.relnamespace
--        left join pg_policies p on p.schemaname = 'outlook' and p.tablename = c.relname
--       where n.nspname = 'outlook' and c.relkind = 'r'
--       group by 1, 2;
--
-- 2. El sujeto es XOR. Esto DEBE fallar (los dos en null):
--
--      insert into outlook.person_budget_total (revision, target_month, total, set_by)
--      values (1, '2026-10-01', 5, 'prueba');
--
--    Y esto también (los dos con valor):
--
--      insert into outlook.person_budget_total
--        (employee_key, nppm_realtor, revision, target_month, total, set_by)
--      values (1, 'Fred A Gomez', 1, '2026-10-01', 5, 'prueba');
--
-- 3. Un realtor no puede tener 'b2b' ni 'nppm'. Esto DEBE fallar:
--
--      insert into outlook.person_budget_breakdown
--        (nppm_realtor, revision, target_month, bucket, value, set_by)
--      values ('Fred A Gomez', 1, '2026-10-01', 'b2b', 3, 'prueba');
--
--    Y esto sí debe entrar:
--
--      insert into outlook.person_budget_breakdown
--        (nppm_realtor, revision, target_month, bucket, value, set_by)
--      values ('Fred A Gomez', 1, '2026-10-01', 'business_plan', 3, 'prueba');
--
-- 4. El total vigente de una persona (la revisión más alta, entera):
--
--      select target_month, total, revision, set_by
--        from outlook.person_budget_total
--       where employee_key = 30
--         and revision = (select max(revision) from outlook.person_budget_total
--                          where employee_key = 30)
--       order by target_month;
--
-- 5. Su desglose vigente, al lado, para comparar en pantalla:
--
--      select target_month, bucket, value, revision
--        from outlook.person_budget_breakdown
--       where employee_key = 30
--         and revision = (select max(revision) from outlook.person_budget_breakdown
--                          where employee_key = 30)
--       order by target_month, bucket;
--
--
-- ============================================================================
-- PARA REVERTIR
-- ============================================================================
--
--   drop table outlook.person_budget_breakdown;
--   drop table outlook.person_budget_total;
--
-- Sin estas dos tablas, el total vuelve a ser sólo la suma de estrategias de
-- siempre -- no tocan ninguna otra tabla del esquema `outlook`, ni
-- `org.dim_employee`, ni nada del módulo `business_plan`.
-- ============================================================================
