-- ============================================================================
-- Un presupuesto POR BRANCH para B2B, Recruitment y Affinity — etapa OL8
-- ============================================================================
--
-- QUÉ PROBLEMA RESUELVE
-- --------------------
-- En OL8 tres estrategias dejaron de colgar del Loan Officer: B2B, Recruitment y
-- Affinity son del BRANCH. La pregunta de negocio es "cuántos préstamos trajo
-- B2B y cuánto proyecta", no "cuánto B2B hizo cada persona".
--
-- Pero las cuatro tablas de decisión de `outlook` cuelgan de `employee_key`:
--
--   strategy_benchmark   employee_key + strategy -> benchmark mensual
--   growth_rule          employee_key + strategy -> segmentos de crecimiento
--   monthly_target       employee_key + strategy -> mes fijado a mano
--   projection_mode      employee_key + strategy -> growth | monthly
--
-- Así que hoy una estrategia de branch NO TIENE DÓNDE GUARDAR SU PRESUPUESTO. La
-- pantalla lo dice --sus columnas de presupuesto quedan en blanco, no en cero, y
-- la fila avisa "branch level · nowhere to save a budget yet"-- pero no se puede
-- decidir nada hasta que esto exista.
--
-- ⚠ NO HAY PÉRDIDA AL MIGRAR, medido: hay 185 reglas de crecimiento y CERO
-- benchmarks de estrategia, así que las reglas por persona en B2B, Recruitment y
-- Affinity multiplican un benchmark inexistente y no proyectan nada. Dejan de
-- leerse sin que ningún número de la pantalla cambie. Si algún día hubiera un
-- benchmark por persona en una de esas tres, ESTE cambio lo dejaría de contar en
-- silencio -- por eso se verifica abajo que sigan siendo cero antes de aplicar.
--
-- QUÉ HACE
-- --------
-- Agrega `branch_code` a las cuatro tablas y hace `employee_key` opcional, con un
-- CHECK que obliga a que haya EXACTAMENTE UNO de los dos. No es un `subject_type`
-- genérico a propósito: dos columnas con un XOR se leen en una consulta y no
-- necesitan que nadie recuerde un código.
--
-- Se reusa el modelo append-only que ya está: nada de UPDATE ni DELETE, la
-- revisión vigente es la de número más alto, y el historial queda legible. Por
-- eso son columnas nuevas en las tablas existentes y no cuatro tablas nuevas:
-- cuatro tablas gemelas serían cuatro copias de esa maquinaria, y la del branch
-- se desincronizaría de la de la persona en el primer cambio.
--
-- Sólo estructura. No toca datos, no toca políticas de RLS --las que hay aplican
-- igual a las filas nuevas-- y no toca org.dim_employee.

begin;

-- ── 1. strategy_benchmark ───────────────────────────────────────────────────
alter table outlook.strategy_benchmark
  add column branch_code text,
  alter column employee_key drop not null,
  add constraint strategy_benchmark_subject_check
    check ((employee_key is not null) <> (branch_code is not null));

-- ── 2. growth_rule ──────────────────────────────────────────────────────────
alter table outlook.growth_rule
  add column branch_code text,
  alter column employee_key drop not null,
  add constraint growth_rule_subject_check
    check ((employee_key is not null) <> (branch_code is not null));

-- ── 3. monthly_target ───────────────────────────────────────────────────────
alter table outlook.monthly_target
  add column branch_code text,
  alter column employee_key drop not null,
  add constraint monthly_target_subject_check
    check ((employee_key is not null) <> (branch_code is not null));

-- ── 4. projection_mode ──────────────────────────────────────────────────────
alter table outlook.projection_mode
  add column branch_code text,
  alter column employee_key drop not null,
  add constraint projection_mode_subject_check
    check ((employee_key is not null) <> (branch_code is not null));

-- ── 5. La unicidad, del lado del branch ─────────────────────────────────────
--
-- ⚠ Las UNIQUE que ya existen son sobre (employee_key, strategy, revision, ...).
-- Con `employee_key` en NULL NO SIRVEN: en SQL dos NULL no son iguales, así que
-- dejarían entrar dos revisiones 2 del mismo branch sin protestar. Hacen falta
-- índices parciales para el caso del branch, con la misma forma.
create unique index strategy_benchmark_branch_uk
  on outlook.strategy_benchmark (branch_code, strategy, effective_from)
  where branch_code is not null;

create unique index growth_rule_branch_uk
  on outlook.growth_rule (branch_code, strategy, revision, segment_order)
  where branch_code is not null;

create unique index monthly_target_branch_uk
  on outlook.monthly_target (branch_code, strategy, revision, target_month)
  where branch_code is not null;

commit;

-- ============================================================================
-- ANTES DE APLICAR: que no haya nada que se deje de leer
-- ============================================================================
--
-- Si esto devuelve algo distinto de 0, hay un benchmark por persona en una
-- estrategia que pasa a ser del branch, y aplicar esto lo dejaría de contar sin
-- que ningún número lo delate. Medido hoy: 0.
--
--   select count(*) from outlook.strategy_benchmark
--   where strategy in ('B2B', 'Recruitment', 'Affinity') and employee_key is not null;
--
-- DESPUÉS DE APLICAR: la estructura
--
--   select table_name, column_name from information_schema.columns
--   where table_schema = 'outlook' and column_name = 'branch_code'
--   order by table_name;
--
-- Se esperan CUATRO filas: growth_rule, monthly_target, projection_mode,
-- strategy_benchmark.
--
-- ============================================================================
-- LO QUE ESTE SQL NO HACE, y hay que decidir antes de escribirlo
-- ============================================================================
--
-- 1. La app todavía no ESCRIBE filas de branch: `lib/outlook/save.ts` y el
--    editor arman la clave con `employee_key`. Es la etapa siguiente y es
--    pequeña, pero necesita esta estructura primero.
--
-- 2. `branch_code` queda sin FOREIGN KEY a `org.dim_branch(branch_code)`, y es
--    deliberado: 'AFFINITY' es un branch que sólo existe a nivel de préstamo --
--    nadie lo tiene asignado en el roster-- y una FK lo dejaría afuera justo
--    donde el presupuesto está sin dueño. Si el negocio decide que AFFINITY es
--    un branch de verdad, la FK se agrega después.
--
-- 3. NPPM sigue con su propia tabla, `outlook.nppm_benchmark`, por realtor y sin
--    branch. No entra acá porque su unidad de decisión no es el branch: es el
--    realtor. Lo que sí queda abierto es que su benchmark no proyecta.
