-- ============================================================================
-- La clave del presupuesto de un realtor pasa a ser el CÓDIGO
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ
-- ---------------------------------------------------------------------------
--
-- El presupuesto compuesto de OL26 identifica al sujeto realtor con
-- `'r' + normName(nppm_realtor)` -- el NOMBRE normalizado. La etapa del
-- `realtor_code` demostró que eso no identifica a nadie:
--
--     'FRED A GOMEZ'   contra 'FRED GOMEZ'      la inicial del medio sobrevive
--     'Jose A Boggio'  contra 'Jose Boggio'     en el MISMO préstamo
--     'Ana Manjarrez'  contra 'Ana Manjarres'   Z contra S
--
-- Por eso esa etapa BORRÓ `normName` en vez de dejarlo conviviendo, y la
-- identidad pasó a `nppm_realtor_code`, que viene resuelto de
-- `dim_nppm_realtor_v2` y no cambia nunca -- ni cuando alguien corrige la
-- grafía arriba.
--
-- Las dos ramas se cruzaron: al mergear, `loadData.ts` quedó llamando a una
-- función que ya no existe. Git no se quejó -- resolvió el texto y dejó el
-- código roto. Lo encontró el typechecker.
--
-- ---------------------------------------------------------------------------
-- ⚠ ESTO NO MIGRA NINGUNA FILA, PORQUE NO HAY NINGUNA
-- ---------------------------------------------------------------------------
--
-- Medido antes de escribirlo:
--
--     person_budget_total       3 filas, las 3 con employee_key, 0 por realtor
--     person_budget_breakdown   4 filas, las 4 con employee_key, 0 por realtor
--
-- Nunca se guardó un presupuesto de realtor. Si alguna vez se hubiera
-- guardado, este archivo NO alcanzaría: habría que resolver cada nombre a su
-- código contra `dim_nppm_realtor_v2` y decidir qué hacer con los que no
-- resuelven --como Walter Mena, que tiene préstamos NPPM y no está en la
-- dimensión--. Volver a comprobar los conteos antes de aplicar.
--
-- ---------------------------------------------------------------------------
-- ⚠ QUÉ ARRASTRA EL RENOMBRE, Y POR QUÉ NO HAY QUE TOCARLO A MANO
-- ---------------------------------------------------------------------------
--
-- Ocho objetos nombran la columna. `alter table ... rename column` reescribe
-- la REFERENCIA dentro de cada uno -- no hay que borrarlos ni recrearlos, y
-- hacerlo a mano es donde se pierde una condición:
--
--     person_budget_total_subject_check              CHECK
--     person_budget_total_realtor_uk                 índice único parcial
--     person_budget_total_realtor_lookup_idx         índice parcial
--     person_budget_breakdown_subject_check          CHECK
--     person_budget_breakdown_realtor_buckets_check  CHECK  ← el que importa
--     person_budget_breakdown_realtor_uk             índice único parcial
--     person_budget_breakdown_realtor_lookup_idx     índice parcial
--     (y el `comment on column`, que sí se reescribe acá abajo)
--
-- El que importa es `person_budget_breakdown_realtor_buckets_check`, que hoy
-- dice:
--
--     CHECK ((nppm_realtor IS NULL) OR (bucket = ANY (ARRAY['own_production',
--            'business_plan'])))
--
-- o sea: un realtor sólo puede tener esos dos buckets. Después del renombre
-- tiene que decir exactamente lo mismo con la columna nueva. El paso 2 de la
-- comprobación lo imprime para leerlo, en vez de suponerlo.
--
-- Los NOMBRES de constraints e índices no cambian, y está bien: nombran al
-- sujeto --el realtor-- y no a la columna. Renombrarlos sería ruido.
--
-- Y no hay funciones, vistas ni policies que la nombren: las cuatro policies
-- de estas dos tablas son `outlook.has_access()` a secas, y ninguna función
-- del proyecto menciona `person_budget`. Verificado antes de escribir esto --
-- una función guarda su cuerpo como TEXTO y el renombre NO la seguiría.

begin;

alter table outlook.person_budget_total
  rename column nppm_realtor to nppm_realtor_code;

alter table outlook.person_budget_breakdown
  rename column nppm_realtor to nppm_realtor_code;

comment on column outlook.person_budget_total.nppm_realtor_code is
  'El CODIGO del realtor NPPM (nppm_realtor_code), no su nombre. El nombre no identifica: FRED A GOMEZ contra FRED GOMEZ. Ver la etapa del realtor_code.';
comment on column outlook.person_budget_breakdown.nppm_realtor_code is
  'El CODIGO del realtor NPPM, no su nombre. Ver la etapa del realtor_code.';

commit;


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBARLO
-- ---------------------------------------------------------------------------
--
-- 1. La columna se llama distinto y no se perdió ninguna fila:
--
--      select count(*) as filas,
--             count(nppm_realtor_code) as por_realtor,
--             count(employee_key) as por_persona
--        from outlook.person_budget_total;
--      -- espera: 3, 0, 3
--
--      select count(*), count(nppm_realtor_code), count(employee_key)
--        from outlook.person_budget_breakdown;
--      -- espera: 4, 0, 4
--
-- 2. ⚠ EL CHECK DE LOS BUCKETS SIGUE LIMITANDO A LOS DOS DE SIEMPRE.
--    No alcanza con que exista: hay que LEER su definición.
--
--      select conname, pg_get_constraintdef(oid)
--        from pg_constraint
--       where conrelid = 'outlook.person_budget_breakdown'::regclass
--         and conname = 'person_budget_breakdown_realtor_buckets_check';
--
--      -- espera EXACTAMENTE, con la columna nueva y los dos buckets:
--      --   CHECK (((nppm_realtor_code IS NULL) OR (bucket = ANY
--      --          (ARRAY['own_production'::text, 'business_plan'::text])))
--
-- 3. Los siete objetos siguieron a la columna, y ninguno quedó nombrando la
--    vieja:
--
--      select conname, pg_get_constraintdef(oid) from pg_constraint
--       where conrelid in ('outlook.person_budget_total'::regclass,
--                          'outlook.person_budget_breakdown'::regclass)
--         and contype = 'c'
--       order by conname;
--
--      select indexname, indexdef from pg_indexes
--       where schemaname = 'outlook' and tablename like 'person_budget%'
--       order by tablename, indexname;
--
--      -- en las dos salidas: cero apariciones de `nppm_realtor` que no sean
--      -- `nppm_realtor_code`
--
-- 4. Y que no quede la columna vieja en ningún lado:
--
--      select table_name, column_name from information_schema.columns
--       where table_schema = 'outlook' and column_name = 'nppm_realtor';
--      -- espera: cero filas
