-- ============================================================================
-- EL PRESUPUESTO ACEPTA UN TERCER SUJETO: EL BRANCH — etapa OL27
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- QUE PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- En AFFINITY no se puede editar el presupuesto, y la causa esta medida: el
-- branch tiene CERO productores en el roster y el editor abre POR PERSONA, asi
-- que no hay a quien abrirselo. No es un bug de la pantalla: es que el sujeto
-- que hace falta no existe en el modelo.
--
-- `outlook.person_budget_total` y `_breakdown` aceptan hoy `employee_key` XOR
-- `nppm_realtor_code`. Ninguno de los dos puede representar a un branch.
--
-- ---------------------------------------------------------------------------
-- ⚠ POR QUE ACA Y NO EN LAS CUATRO TABLAS DE DECISION DE OL8
-- ---------------------------------------------------------------------------
-- `strategy_benchmark`, `growth_rule`, `monthly_target` y `projection_mode` YA
-- tienen `branch_code` --`2026-08-outlook-branch-budget.sql` esta aplicado,
-- verificado pidiendole la columna a PostgREST: las cuatro responden 200--. Se
-- podria escribir ahi y no costaria ningun SQL.
--
-- Y seria un segundo modelo de presupuesto conviviendo con el de OL26: el del
-- branch sin revisiones, sin desglose por bucket, sin `confirmed_only` y sin
-- pasar por el `budgetTotal` que `projectBranch` usa como override. Dos
-- maquinarias para la misma decision es la divergencia que este repo ya se
-- cobro varias veces --`normName` contra `realtor_code`, las dos copias de
-- `fmt`, las dos definiciones del calculo por estrategia--. El sujeto nuevo va
-- donde vive el presupuesto de hoy.
--
-- Las columnas de OL8 quedan donde estan: las dos filas de B2B del 747 y el 716
-- viven ahi y se siguen leyendo (ver `branchLevelBudget`). Migrarlas es una
-- etapa aparte y una decision de negocio --cada una cubre a dos o tres Business
-- Developers--, no un `insert ... select`.
--
-- ---------------------------------------------------------------------------
-- ⚠ Y POR ESO LAS TABLAS SE RENOMBRAN
-- ---------------------------------------------------------------------------
-- `person_budget_total` guardando el presupuesto de un branch es un nombre que
-- engaña, y un nombre que engaña se cobra en la lectura de alguien que no
-- estuvo en esta conversacion. `alter table ... rename` REESCRIBE las
-- referencias dentro de los CHECK, los indices y las policies --es lo mismo que
-- hizo `2026-09-person-budget-realtor-code.sql` con la columna-- asi que el
-- renombre no es un riesgo aparte: es una linea.
--
-- Lo que SI hay que renombrar a mano son los OBJETOS cuyo nombre lleva el
-- prefijo viejo. No cambia el comportamiento --un CHECK funciona igual se llame
-- como se llame-- pero un constraint `person_budget_total_subject_check` sobre
-- una tabla `budget_total` es la misma mentira en otro lugar.
--
-- ⚠ LA COLUMNA DE LA CLAVE PRIMARIA TAMBIEN, y esa SI la lee la app:
-- `person_budget_total_key` -> `budget_total_key`.
--
-- ---------------------------------------------------------------------------
-- ⚠ QUE PASA ENTRE EL PRESUPUESTO DEL BRANCH Y LA SUMA DE SUS PERSONAS
-- ---------------------------------------------------------------------------
-- ES ADITIVO, y con fila propia. No es un override ni un techo a repartir:
--
--   · es lo que las dos filas de B2B ya hacen hoy, asi que no cambia ningun
--     numero existente;
--   · en AFFINITY la pregunta no se plantea --cero personas, el presupuesto del
--     branch ES el total--;
--   · en un branch con las dos cosas, un presupuesto de branch significa
--     produccion que no se le atribuye a nadie del roster, que es lo que una
--     estrategia de branch es;
--   · y la fila visible es la CONDICION, no un detalle de presentacion: la
--     correccion 1 de esta misma etapa existe porque un presupuesto sin fila se
--     escondio en la reconciliacion durante meses.
--
-- Un override del branch sobre la suma de las personas queda descartado: dejaria
-- dos decisiones tapandose sin que la pantalla pueda decir cual rige.

begin;

-- ---------------------------------------------------------------------------
-- 1. Los nombres
-- ---------------------------------------------------------------------------
alter table outlook.person_budget_total     rename to budget_total;
alter table outlook.person_budget_breakdown rename to budget_breakdown;

alter table outlook.budget_total     rename column person_budget_total_key     to budget_total_key;
alter table outlook.budget_breakdown rename column person_budget_breakdown_key to budget_breakdown_key;

alter table outlook.budget_total
  rename constraint person_budget_total_subject_check to budget_total_subject_check;
alter table outlook.budget_breakdown
  rename constraint person_budget_breakdown_subject_check to budget_breakdown_subject_check;
alter table outlook.budget_breakdown
  rename constraint person_budget_breakdown_realtor_buckets_check to budget_breakdown_realtor_buckets_check;

alter index outlook.person_budget_total_employee_uk            rename to budget_total_employee_uk;
alter index outlook.person_budget_total_realtor_uk             rename to budget_total_realtor_uk;
alter index outlook.person_budget_total_employee_lookup_idx    rename to budget_total_employee_lookup_idx;
alter index outlook.person_budget_total_realtor_lookup_idx     rename to budget_total_realtor_lookup_idx;
alter index outlook.person_budget_breakdown_employee_uk         rename to budget_breakdown_employee_uk;
alter index outlook.person_budget_breakdown_realtor_uk          rename to budget_breakdown_realtor_uk;
alter index outlook.person_budget_breakdown_employee_lookup_idx rename to budget_breakdown_employee_lookup_idx;
alter index outlook.person_budget_breakdown_realtor_lookup_idx  rename to budget_breakdown_realtor_lookup_idx;

alter policy person_budget_total_select     on outlook.budget_total     rename to budget_total_select;
alter policy person_budget_total_insert     on outlook.budget_total     rename to budget_total_insert;
alter policy person_budget_breakdown_select on outlook.budget_breakdown rename to budget_breakdown_select;
alter policy person_budget_breakdown_insert on outlook.budget_breakdown rename to budget_breakdown_insert;

-- ---------------------------------------------------------------------------
-- 2. El tercer sujeto
-- ---------------------------------------------------------------------------
--
-- ⚠ `num_nonnulls(...) = 1` y no dos `<>` anidados: con tres columnas, el XOR
-- booleano encadenado da VERDADERO con las TRES puestas --`a <> b <> c` es
-- asociativo y `true <> true <> true` = true-- asi que dejaria entrar una fila
-- con los tres sujetos. Es el mismo error que un `||` en una asercion: la forma
-- parece decir «exactamente uno» y dice otra cosa.
--
-- ⚠ Y SIN FOREIGN KEY a `org.dim_branch`, por la misma razon que OL8 dejo
-- escrita: 'AFFINITY' es un branch que solo existe a nivel de prestamo --nadie
-- lo tiene asignado en el roster-- y una FK lo dejaria afuera justo donde el
-- presupuesto no tiene dueño. Que es, literalmente, el caso que esta etapa
-- viene a resolver.
alter table outlook.budget_total     add column branch_code text;
alter table outlook.budget_breakdown add column branch_code text;

alter table outlook.budget_total     drop constraint budget_total_subject_check;
alter table outlook.budget_breakdown drop constraint budget_breakdown_subject_check;

alter table outlook.budget_total
  add constraint budget_total_subject_check
  check (num_nonnulls(employee_key, nppm_realtor_code, branch_code) = 1);
alter table outlook.budget_breakdown
  add constraint budget_breakdown_subject_check
  check (num_nonnulls(employee_key, nppm_realtor_code, branch_code) = 1);

-- ---------------------------------------------------------------------------
-- 3. La unicidad del lado del branch
-- ---------------------------------------------------------------------------
-- ⚠ Los indices que ya existen NO sirven para el sujeto nuevo: son parciales
-- sobre `employee_key is not null` y `nppm_realtor_code is not null`. Hacen
-- falta los del branch, con la misma forma. Es lo mismo que OL8 tuvo que hacer
-- en las cuatro tablas de decision, y por lo mismo: dos NULL no son iguales en
-- SQL, asi que un indice sobre la columna vacia no protege nada.
create unique index if not exists budget_total_branch_uk
  on outlook.budget_total (branch_code, revision, target_month)
  where branch_code is not null;

create index if not exists budget_total_branch_lookup_idx
  on outlook.budget_total (branch_code, revision desc, target_month)
  where branch_code is not null;

create unique index if not exists budget_breakdown_branch_uk
  on outlook.budget_breakdown (branch_code, revision, target_month, bucket)
  where branch_code is not null;

create index if not exists budget_breakdown_branch_lookup_idx
  on outlook.budget_breakdown (branch_code, revision desc, target_month)
  where branch_code is not null;

-- ---------------------------------------------------------------------------
-- 4. LOS BUCKETS DEL REALTOR NO SE TOCAN, Y HAY QUE DECIR POR QUE
-- ---------------------------------------------------------------------------
-- ⚠ `budget_breakdown_realtor_buckets_check` dice
-- `nppm_realtor_code is null or bucket in ('own_production','business_plan')`,
-- y con un sujeto nuevo ese `is null` pasa a ser verdadero TAMBIEN para las
-- filas de branch. O sea que la condicion no cambia de texto pero si de
-- alcance: un branch queda admitiendo los cuatro buckets.
--
-- Eso es lo que corresponde --la produccion de un branch puede venir de
-- cualquier estrategia; AFFINITY es justamente el caso donde el presupuesto no
-- es produccion propia de nadie-- asi que el check se deja como esta.
--
-- Lo que NO corresponde es que quede implicito. Una condicion escrita para dos
-- casos, leida con tres, dice algo que nadie decidio: es la misma forma que
-- `mmi_link` en RV22 --una clave cuya AUSENCIA significaba algo hasta que
-- cambio el conjunto de casos-- y la unica diferencia es que esta vez se miro
-- antes y no despues. Si algun dia un branch no debiera admitir 'nppm', el
-- check se reescribe nombrando los tres sujetos y no agregando una excepcion.

-- ---------------------------------------------------------------------------
-- 5. Los comentarios, que tambien hablan de personas
-- ---------------------------------------------------------------------------
comment on table outlook.budget_total is
  'Append-only, versionado por revision. El TOTAL fijado a mano por SUJETO y mes. El sujeto es exactamente uno de tres: una persona (employee_key), un realtor NPPM (nppm_realtor_code) o un BRANCH entero (branch_code, OL27) -- este ultimo para el presupuesto que no es de nadie del roster, como AFFINITY, que no tiene productores. El del branch se SUMA al de sus personas, no las reemplaza. Ver el desglose informativo en outlook.budget_breakdown.';

comment on table outlook.budget_breakdown is
  'Append-only, versionado por revision. El desglose INFORMATIVO de outlook.budget_total por bucket (own_production/b2b/nppm/business_plan). No tiene por que sumar el total -- eso se muestra en pantalla, no se fuerza aca. Un realtor NPPM solo admite own_production y business_plan; una persona y un branch admiten los cuatro.';

comment on column outlook.budget_total.branch_code is
  'El branch como sujeto del presupuesto (OL27). Sin FK a org.dim_branch a proposito: AFFINITY existe a nivel de prestamo y no en el roster, y una FK lo dejaria afuera justo donde el presupuesto no tiene dueño.';

commit;

-- ============================================================================
-- ANTES DE APLICAR
-- ============================================================================
-- Que ninguna fila viole el CHECK nuevo -- tiene que dar 0. Con `branch_code`
-- recien agregada no puede fallar, pero la comprobacion es la que distingue
-- «no puede pasar» de «no paso»:
--
--   select count(*) from outlook.person_budget_total
--   where num_nonnulls(employee_key, nppm_realtor_code) <> 1;
--
-- Y el conteo de hoy, para comparar despues: 72 filas en person_budget_total y
-- 61 en person_budget_breakdown, medido el 2026-09-14.
--
-- ============================================================================
-- DESPUES DE APLICAR
-- ============================================================================
-- 1. La estructura:
--
--   select table_name, column_name from information_schema.columns
--   where table_schema = 'outlook' and table_name in ('budget_total', 'budget_breakdown')
--   order by table_name, ordinal_position;
--
-- 2. Que no quedo ningun objeto con el nombre viejo:
--
--   select conname from pg_constraint where conname like 'person_budget%';
--   select indexname from pg_indexes where schemaname = 'outlook' and indexname like 'person_budget%';
--   select policyname from pg_policies where schemaname = 'outlook' and policyname like 'person_budget%';
--   -- las tres esperan CERO filas
--
-- 3. Y las filas intactas: 72 y 61.
--
-- ⚠ LA APP NO FUNCIONA CONTRA EL ESQUEMA VIEJO DESPUES DE ESTA RAMA. El codigo
-- de esta etapa lee `outlook.budget_total` / `budget_breakdown`, asi que el
-- merge va DESPUES de aplicar esto, no antes. Es el mismo orden que la etapa
-- del `realtor_code`.
