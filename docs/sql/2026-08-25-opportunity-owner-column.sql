-- ===========================================================================
-- F7.20 — COLUMNA "OPPORTUNITY OWNER" (NOMBRE), SEPARADA DE TITLE Y DE
-- REFERRED BY
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica quien administra Supabase, con autorización
-- explícita -- ver CLAUDE.local.md, sección "Supabase — autorización de
-- escritura".
--
-- ⚠⚠ ESTA MIGRACIÓN SOLA NO ALCANZA -- mismo patrón ya documentado en
-- docs/sql/2026-08-pipeline-strategy-columns.sql para las 5 columnas de
-- estrategia (F6): hay que ampliar también
-- `pipeline_forecast.save_pipeline_snapshot()`, la lista exacta de campos
-- está al final de este archivo. Sin eso, la RPC devuelve 200 y descarta la
-- columna nueva en silencio.
--
--
-- ---------------------------------------------------------------------------
-- 1. QUÉ PASÓ Y POR QUÉ HACE FALTA
-- ---------------------------------------------------------------------------
--
-- Confirmado por Heather con captura real del export de Salesforce: existe
-- una columna "Opportunity Owner" (nombre de persona) DISTINTA de:
--
--   · "Opportunity Owner: Title"  -- ya capturado, `opportunity_owner_title`
--     (define B2B cuando vale 'Business Developer', ver lib/pipeline/strategy.ts)
--   · "Referred By"                -- ya capturado, `referred_by`
--     (hoy solo se muestra como sub-label del realtor NPPM en el modal)
--
-- Ejemplo real de la captura: misma fila, Opportunity Owner = "Josue Toro",
-- Referred By = "Silvano Cruz" -- DOS personas distintas. Verificado además
-- contra datos reales del snapshot activo (id 74): de 181 filas B2B-titled,
-- 151 (83%) ya tienen `referred_by` distinto de `loan_officer` -- consistente
-- con que sean 3 roles/personas potencialmente distintas en la misma fila
-- (Loan Officer, Referred By, y ahora Opportunity Owner).
--
-- `lib/pipeline/scorecards.ts` (`buildBusinessDeveloperScorecard`) hoy
-- agrupa la producción de Business Developer por `loan_officer` -- si
-- "Opportunity Owner" es la identidad real del Business Developer, el
-- scorecard actual atribuye esa producción a la persona equivocada.
--
--
-- ---------------------------------------------------------------------------
-- 2. LA COLUMNA NUEVA
-- ---------------------------------------------------------------------------
--
--   opportunity_owner   columna "Opportunity Owner" del export (nombre de
--                       persona, sin el sufijo ": Title"). `text`, nullable,
--                       sin default -- mismo patrón que `opportunity_owner_title`/
--                       `referred_by`: un export viejo (o uno donde Salesforce
--                       no traiga esta columna todavía) no rompe el parseo,
--                       el campo queda en '' (no NULL -- ver nota de la
--                       trampa NULL-vs-'' en la sección 4).
--
-- ---------------------------------------------------------------------------
-- 3. EL ALTER (NO EJECUTAR)
-- ---------------------------------------------------------------------------

alter table pipeline_forecast.pipeline_loans
  add column if not exists opportunity_owner text;

alter table pipeline_forecast.pipeline_resolved_loans
  add column if not exists opportunity_owner text;

comment on column pipeline_forecast.pipeline_loans.opportunity_owner is
  'Columna "Opportunity Owner" del export -- nombre de persona, distinto de opportunity_owner_title (el rol/título) y de referred_by. Ver F7.20.';
comment on column pipeline_forecast.pipeline_resolved_loans.opportunity_owner is
  'Columna "Opportunity Owner" del export -- nombre de persona, distinto de opportunity_owner_title (el rol/título) y de referred_by. Ver F7.20.';


-- ===========================================================================
-- 4. ⚠ LO QUE FALTA, Y NO ESTÁ EN ESTE ARCHIVO: AMPLIAR LA RPC
-- ===========================================================================
--
-- `pipeline_forecast.save_pipeline_snapshot()` mapea una lista EXPLÍCITA de
-- columnas en sus `jsonb_to_recordset`. Las claves que no están en esa lista
-- se descartan sin error -- mismo fallo silencioso ya confirmado en la
-- migración de F6 (loan_type, loan_program, production_support_note_history
-- primero; strategy_raw/opportunity_owner_title/nppm_realtor/referred_by/
-- affinity_program después).
--
-- Agregar, en las dos mitades de la función (`p_loans` -> pipeline_loans,
-- `p_resolved` -> pipeline_resolved_loans):
--
--     opportunity_owner   text
--
-- El nombre de la clave del jsonb debe ser idéntico al de la columna --
-- el mapper de la app (app/api/pipeline/parse/route.ts, ver plan de código
-- más abajo) la manda tal cual, sin traducción.
--
-- ---------------------------------------------------------------------------
-- CÓMO COMPROBAR QUE QUEDÓ BIEN (mismo patrón que F6)
-- ---------------------------------------------------------------------------
--
-- Una carga real y después esto: si la cuenta da > 0, la función sigue
-- descartando la columna.
--
--   select count(*) filter (where opportunity_owner is null) as sin_opportunity_owner
--     from pipeline_forecast.pipeline_loans
--    where snapshot_id = (select id from pipeline_forecast.pipeline_snapshots
--                          where is_active order by id desc limit 1);
--
-- ⚠ Misma trampa NULL-vs-'' ya documentada en F6: el parser cae a cadena
-- vacía ('') cuando el export no trae la columna o la celda está vacía; un
-- NULL en la base significa específicamente "la función lo descartó". No son
-- lo mismo, y distinguirlos es lo que permite detectar el fallo silencioso
-- sin adivinar.
