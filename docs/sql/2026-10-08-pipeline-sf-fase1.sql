-- DBA-20261008-portal-pipeline-sf-fase1 · aplicado en BigQuery el 2026-10-08 con OK de Isabella. NO volver a ejecutar.
-- Fase 1 de la migración de Forecast & Pipeline a Salesforce incremental. ADITIVO: crea 5 vistas en lending_marts
-- y no modifica ninguna existente. Nadie las lee hasta el corte (fase 4): simo-sync sigue leyendo pipeline_snapshot_staff.
--   1 pipeline_snapshot_sf        el Pipeline Report reconstruido desde salesforce_incremental.Opportunity_current
--   2 pipeline_snapshot_v2        archivo + Salesforce; por día gana el dato más reciente (decisión 2)
--   3 dim_pipeline_staff_v2       nombres del pipeline aprendidos de las dos fuentes
--   4 pipeline_snapshot_staff_v2  lo que leerá el sync desde la fase 4 (contrato de pipeline_snapshot_staff + 2 columnas)
--   5 check_pipeline_sf_paridad   control diario de la corrida en paralelo (fase 3)
-- Verificado: contrato 52/52 columnas en orden y tipo; días anteriores idénticos a pipeline_snapshot_staff (EXCEPT 0/0);
-- nombres resueltos sin cambios; paridad con el archivo del día 0/0 filas, 38/39 columnas sin diferencia (la otra = decisión 7);
-- definiciones de las vistas existentes sin cambios (MD5).
-- Vuelta atrás: DROP VIEW de las 5, en orden inverso (5 -> 1).

-- ============================================================================
-- 1. lending_marts.pipeline_snapshot_sf
-- ============================================================================
CREATE VIEW `mcp-connector-procedure.lending_marts.pipeline_snapshot_sf`
OPTIONS(description="""Salesforce Pipeline Report rebuilt from salesforce_incremental.Opportunity_current (hourly). Same contract as lending_marts.pipeline_snapshot (the manually uploaded report) plus data_as_of_source and opportunity_id.
Grain: one row per Opportunity in the report as of data_as_of (= uploaded_at). Only the current state: no history.
Filter = the official report (Isabella, 2026-10-08): record type Borrower (by DeveloperName, not by label), Application Date not blank, Lien Position = First Lien, Loan Folder contains neither 'archive' nor 'testing' (case-insensitive; a blank folder passes). Created Date all time, any status, any probability.
⚠ data_as_of = when the data was last refreshed (latest of the hourly MERGE and the nightly replica, from __TABLES__.last_modified_time), NOT MAX(SystemModstamp): with no edits in Salesforce for two hours SystemModstamp stops moving although the load ran.
⚠ snapshot_date = DATE(data_as_of, 'America/Bogota'), the same rule as the file batches in pipeline_snapshot.
⚠ production_support_notes come complete (decision 6, 2026-10-08); the file truncated them at 255 chars.
⚠ referred_by / buyers_agent (Contact) and nppm_realtor (NPPM__c) are looked up in the NIGHTLY copies: a record created today shows those names blank until the next nightly load (decision 7, accepted).
⚠ Column mapping verified 2026-10-08 against the uploaded file: 1,130 = 1,130 rows. Est_Closing_Date__c (not CloseDate), Amount (not Total_Loan_Amount__c), Loan_Officer_Text__c, Full_Name_Owner__c, and loa2 = LOA2_Name__c only when the lookup LOA2__c is set.
Plan DBA-20261008-portal-pipeline-sf-fase1.""",
        labels=[("dba_plan","dba-20261008-portal-pipeline-sf-fase1"),("app","portal")])
AS
WITH
refresh AS (
  SELECT MAX(TIMESTAMP_MILLIS(last_modified_time)) AS data_as_of
  FROM (
    SELECT last_modified_time FROM `mcp-connector-procedure.salesforce_incremental.__TABLES__` WHERE table_id = 'Opportunity'
    UNION ALL
    SELECT last_modified_time FROM `mcp-connector-procedure.salesforce.__TABLES__` WHERE table_id = 'Opportunity')
),
report AS (
  SELECT o.*
  FROM `mcp-connector-procedure.salesforce_incremental.Opportunity_current` o
  JOIN `mcp-connector-procedure.salesforce.RecordType` rt
    ON rt.Id = o.RecordTypeId AND rt.SobjectType = 'Opportunity' AND rt.DeveloperName = 'Borrower'
  WHERE o.Application_Date__c IS NOT NULL
    AND o.Lien_Position__c = 'First Lien'
    AND NOT REGEXP_CONTAINS(LOWER(COALESCE(o.Loan_Folder__c, '')), r'archive|testing')
),
raw AS (
  SELECT
    o.Id AS opportunity_id,
    NULLIF(TRIM(o.Name), '')                         AS opportunity_name,
    NULLIF(TRIM(o.Branch__c), '')                    AS branch_raw,
    COALESCE(o.Affinity_Program__c, FALSE)           AS affinity_program,
    COALESCE(o.Branch_Transfer__c, FALSE)            AS branch_transferred,
    NULLIF(TRIM(o.Loan_Channel__c), '')              AS channel,
    NULLIF(TRIM(o.StageName), '')                    AS stage,
    NULLIF(TRIM(o.Loan_Folder__c), '')               AS loan_folder,
    NULLIF(TRIM(o.Current_Milestone__c), '')         AS milestone_raw,
    NULLIF(TRIM(o.Healthiness__c), '')               AS healthiness_raw,
    CAST(o.Amount AS NUMERIC)                        AS amount,
    o.Est_Closing_Date__c                            AS est_closing_date,
    o.Org_Est_Closing_Date__c                        AS org_est_closing_date,
    o.Current_Milestone_Date__c                      AS milestone_date,
    o.Application_Date__c                            AS application_date,
    o.Disbursement_Date__c                           AS disbursement_date,
    o.Lock_Exp_Date__c                               AS lock_exp_date,
    o.ICD_Date__c                                    AS icd_date,
    o.Date_Denied__c                                 AS date_denied,
    NULLIF(TRIM(o.Loan_Officer_Text__c), '')         AS loan_officer,
    NULLIF(TRIM(o.Loan_Processor__c), '')            AS loan_processor,
    IF(o.LOA2__c IS NULL, NULL, NULLIF(TRIM(o.LOA2_Name__c), '')) AS loa2,
    NULLIF(TRIM(o.LOA_2__c), '')                     AS loa_2,
    NULLIF(TRIM(o.Loan_Status__c), '')               AS loan_status,
    NULLIF(TRIM(o.Loan_Type__c), '')                 AS loan_type,
    NULLIF(TRIM(o.Loan_Program__c), '')              AS loan_program,
    NULLIF(TRIM(o.Loan_Purpose__c), '')              AS loan_purpose,
    NULLIF(TRIM(o.Property_State__c), '')            AS property_state,
    NULLIF(TRIM(o.Property_Address__c), '')          AS property_address,
    NULLIF(TRIM(o.Strategy__c), '')                  AS strategy_raw,
    NULLIF(TRIM(o.Full_Name_Owner__c), '')           AS opportunity_owner,
    NULLIF(TRIM(o.Owner_Title__c), '')               AS opportunity_owner_title,
    NULLIF(TRIM(np.Name), '')                        AS nppm_realtor,
    NULLIF(TRIM(cr.Name), '')                        AS referred_by,
    NULLIF(TRIM(cb.Name), '')                        AS buyers_agent,
    LOWER(TRIM(COALESCE(o.Referred_By_NPPM__c, ''))) IN ('true', '1', 'yes') AS referred_by_nppm,
    NULLIF(TRIM(o.Affinity_Broker_Name__c), '')      AS affinity_broker_name,
    NULLIF(TRIM(o.Stat_Closing_Risk__c), '')         AS stat_closing_risk,
    NULLIF(TRIM(o.Prod_Support_Note_History__c), '') AS production_support_notes
  FROM report o
  LEFT JOIN `mcp-connector-procedure.salesforce.NPPM__c` np ON np.Id = o.NPPM_Realtor__c
  LEFT JOIN `mcp-connector-procedure.salesforce.Contact` cr ON cr.Id = o.Referred_By__c
  LEFT JOIN `mcp-connector-procedure.salesforce.Contact` cb ON cb.Id = o.Buyers_Agent__c
)
SELECT
  DATE(f.data_as_of, 'America/Bogota')                                  AS snapshot_date,
  CONCAT('sf:', FORMAT_TIMESTAMP('%Y%m%dT%H%M%SZ', f.data_as_of, 'UTC')) AS upload_batch_id,
  f.data_as_of                                                          AS uploaded_at,
  r.opportunity_name,
  CASE WHEN r.affinity_program THEN 'Affinity' ELSE r.branch_raw END    AS branch,
  r.branch_raw, r.affinity_program, r.branch_transferred,
  r.channel, r.stage, r.loan_folder,
  CASE r.milestone_raw
    WHEN 'Started' THEN 'Started' WHEN 'Processing' THEN 'Processing'
    WHEN 'Submittal' THEN 'Underwriting' WHEN 'Initial Decision' THEN 'Underwriting'
    WHEN 'Resubmittal' THEN 'Underwriting' WHEN 'Clear To Close' THEN 'Closing'
    WHEN 'Closing' THEN 'Closing' END                                   AS milestone,
  r.milestone_raw, r.healthiness_raw,
  r.healthiness_raw = 'On Track'                                        AS healthy,
  r.amount, r.est_closing_date, r.org_est_closing_date,
  DATE_TRUNC(r.est_closing_date, MONTH)                                 AS close_month,
  r.milestone_date, r.application_date, r.disbursement_date,
  r.lock_exp_date, r.icd_date, r.date_denied,
  r.loan_officer, r.loan_processor, r.loa2, r.loa_2,
  r.loan_status, r.loan_type, r.loan_program, r.loan_purpose,
  r.property_state, r.property_address,
  r.strategy_raw, r.opportunity_owner, r.opportunity_owner_title,
  r.nppm_realtor, r.referred_by, r.buyers_agent, r.referred_by_nppm,
  r.affinity_broker_name, r.stat_closing_risk, r.production_support_notes,
  r.stage = 'Negotiation' AND r.milestone_raw IN
    ('Started', 'Processing', 'Submittal', 'Initial Decision', 'Resubmittal', 'Clear To Close', 'Closing')
                                                                        AS is_pipeline,
  'salesforce_incremental'                                              AS data_as_of_source,
  r.opportunity_id
FROM raw r
CROSS JOIN refresh f;

-- ============================================================================
-- 2. lending_marts.pipeline_snapshot_v2
-- ============================================================================
CREATE VIEW `mcp-connector-procedure.lending_marts.pipeline_snapshot_v2`
OPTIONS(description="""Pipeline snapshot with two sources: the manually uploaded Salesforce Pipeline Report (lending_marts.pipeline_snapshot) and the hourly rebuild from Salesforce (lending_marts.pipeline_snapshot_sf). Same contract as pipeline_snapshot plus data_as_of_source ('manual_file' | 'salesforce_incremental') and opportunity_id (NULL for the file).
Grain: one row per (snapshot_date, opportunity_name) of the winning source of that day.
⚠ Precedence (decision 2, 2026-10-08): per snapshot_date the source with the MOST RECENT data wins, compared by uploaded_at (= data_as_of). A file uploaded at 10:20 beats the 09:34 Salesforce load and is shown until the 10:34 load replaces it. Decided by the age of the data, never by which process ran last. Exact tie: Salesforce.
⚠ Past days come only from file batches: pipeline_snapshot_sf has no history. simo-sync only reads MAX(snapshot_date), so that is all it needs; history lives in Supabase pipeline_forecast.pipeline_snapshots.
Plan DBA-20261008-portal-pipeline-sf-fase1.""",
        labels=[("dba_plan","dba-20261008-portal-pipeline-sf-fase1"),("app","portal")])
AS
WITH
sources AS (
  SELECT f.*, 'manual_file' AS data_as_of_source, CAST(NULL AS STRING) AS opportunity_id
  FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot` f
  UNION ALL BY NAME
  SELECT s.* FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot_sf` s
),
winner AS (
  SELECT snapshot_date, data_as_of_source
  FROM (SELECT DISTINCT snapshot_date, data_as_of_source, uploaded_at FROM sources)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY snapshot_date
    ORDER BY uploaded_at DESC, IF(data_as_of_source = 'salesforce_incremental', 0, 1)) = 1
)
SELECT s.*
FROM sources s
JOIN winner w USING (snapshot_date, data_as_of_source);

-- ============================================================================
-- 3. lending_marts.dim_pipeline_staff_v2
-- ============================================================================
-- Igual a dim_pipeline_staff, pero aprende los nombres de las DOS fuentes (archivo y Salesforce).
-- Cuando el archivo se apague, los nombres nuevos siguen llegando.
CREATE VIEW `mcp-connector-procedure.lending_marts.dim_pipeline_staff_v2`
OPTIONS(description="""Same as lending_marts.dim_pipeline_staff (people named as loan_processor / loa2 / loa_2 in the pipeline, resolved to hr_centralizado person_code), but it learns names from BOTH sources: the uploaded file (pipeline_snapshot, all days) and the hourly Salesforce rebuild (pipeline_snapshot_sf). Once the manual upload is switched off, new names keep arriving.
Grain: one row per distinct name as spelled in the pipeline.
⚠ Joined BY NAME (as v1): Loan_Processor__c and LOA_2__c are free text in Salesforce. Moving to the User lookups (Loan_Processor_User__c, LOA2__c) is backlog, not this plan.
Plan DBA-20261008-portal-pipeline-sf-fase1.""",
        labels=[("dba_plan","dba-20261008-portal-pipeline-sf-fase1"),("app","portal")])
AS
WITH
pipe AS (
  SELECT loan_processor, loa2, loa_2 FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot`
  UNION ALL
  SELECT loan_processor, loa2, loa_2 FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot_sf`
),
nombres AS (
  SELECT 'loan_processor' AS campo, loan_processor AS nombre FROM pipe WHERE loan_processor IS NOT NULL
  UNION ALL
  SELECT 'loa2', loa2 FROM pipe WHERE loa2 IS NOT NULL
  UNION ALL
  SELECT 'loa_2', loa_2 FROM pipe WHERE loa_2 IS NOT NULL
),
agg AS (
  SELECT nombre, COUNT(*) AS apariciones,
         STRING_AGG(DISTINCT campo, ', ' ORDER BY campo) AS en_que_campos
  FROM nombres GROUP BY nombre
),
clave AS (
  SELECT nombre, apariciones, en_que_campos,
    REPLACE(REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM(REGEXP_REPLACE(LOWER(REGEXP_REPLACE(
        NORMALIZE_AND_CASEFOLD(nombre, NFD), r'\p{Mn}','')), r'[^a-z ]',' ')), r'\s+',' '),
      r' [a-z] ', ' '), 'll','l') AS mk
  FROM agg
),
nk AS (
  SELECT REPLACE(REGEXP_REPLACE(name_key, r' [a-z] ', ' '), 'll','l') AS k,
         ANY_VALUE(person_code) AS person_code
  FROM `mcp-connector-procedure.hr_centralizado.person_name_key` GROUP BY 1
),
al AS (
  SELECT REPLACE(REGEXP_REPLACE(
           REGEXP_REPLACE(TRIM(REGEXP_REPLACE(LOWER(REGEXP_REPLACE(
             NORMALIZE_AND_CASEFOLD(alias, NFD), r'\p{Mn}','')), r'[^a-z ]',' ')), r'\s+',' '),
           r' [a-z] ', ' '), 'll','l') AS k,
         ANY_VALUE(person_code) AS person_code
  FROM `mcp-connector-procedure.hr_centralizado.person_alias_manual` GROUP BY 1
)
SELECT
  c.nombre, c.mk AS match_key, c.apariciones, c.en_que_campos,
  COALESCE(nk.person_code, al.person_code) AS person_code,
  r.display_name, r.position AS cargo, r.branch_code, r.is_active,
  COALESCE(nk.person_code, al.person_code) IS NOT NULL AS es_de_la_division,
  NOT REGEXP_CONTAINS(c.nombre,
    r'[*#()/]|(?i)\b(request|setup|fee|tbd|n/?a|pending|test|unassigned)\b') AS parece_persona
FROM clave c
LEFT JOIN nk ON nk.k = c.mk
LEFT JOIN al ON al.k = c.mk
LEFT JOIN `mcp-connector-procedure.hr_centralizado.roster_for_admin` r
  ON r.person_code = COALESCE(nk.person_code, al.person_code);

-- ============================================================================
-- 4. lending_marts.pipeline_snapshot_staff_v2
-- ============================================================================
CREATE VIEW `mcp-connector-procedure.lending_marts.pipeline_snapshot_staff_v2`
OPTIONS(description="""Same as lending_marts.pipeline_snapshot_staff (what simo-sync copies to pipeline_forecast.*), built on pipeline_snapshot_v2 and dim_pipeline_staff_v2. Columns: the pipeline_snapshot_staff contract, then data_as_of_source and opportunity_id at the end.
Grain: one row per (snapshot_date, opportunity_name) of the winning source of that day.
⚠ Nobody reads it until the cutover (phase 4): simo-sync keeps reading pipeline_snapshot_staff. Plan DBA-20261008-portal-pipeline-sf-fase1.""",
        labels=[("dba_plan","dba-20261008-portal-pipeline-sf-fase1"),("app","portal")])
AS
SELECT
  s.* EXCEPT (data_as_of_source, opportunity_id),
  ps.person_code   AS loan_processor_person_code,
  ps.display_name  AS loan_processor_display,
  a2.person_code   AS loa2_person_code,
  a2.display_name  AS loa2_display,
  b2.person_code   AS loa_2_person_code,
  b2.display_name  AS loa_2_display,
  s.data_as_of_source,
  s.opportunity_id
FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot_v2` s
LEFT JOIN `mcp-connector-procedure.lending_marts.dim_pipeline_staff_v2` ps ON ps.nombre = s.loan_processor
LEFT JOIN `mcp-connector-procedure.lending_marts.dim_pipeline_staff_v2` a2 ON a2.nombre = s.loa2
LEFT JOIN `mcp-connector-procedure.lending_marts.dim_pipeline_staff_v2` b2 ON b2.nombre = s.loa_2;

-- ============================================================================
-- 5. lending_marts.check_pipeline_sf_paridad
-- ============================================================================
CREATE VIEW `mcp-connector-procedure.lending_marts.check_pipeline_sf_paridad`
OPTIONS(description="""Control for the parallel run (phase 3): compares the LAST uploaded file batch (pipeline_snapshot, latest snapshot_date) with the hourly Salesforce rebuild (pipeline_snapshot_sf), row by row on opportunity_name and column by column.
Grain: one row per check: 'filas_solo_archivo', 'filas_solo_salesforce', and one 'columna:<name>' per business column with the number of differing cells among matched rows.
⚠ Expected: 0 everywhere EXCEPT records edited in Salesforce after the file was exported (see cambiados_despues). A difference only counts if cambiados_despues < diferencias.
⚠ production_support_notes is compared on its first 255 chars (the file truncates; Salesforce is complete by decision 6).
⚠ referred_by / buyers_agent / nppm_realtor may differ when the Contact or NPPM__c was created today: Salesforce sends the name in the file, but the nightly copy does not have that record yet (decision 7, accepted). Measured 2026-10-08: 1 buyers_agent for that reason.
⚠ Two NULLs count as equal. Plan DBA-20261008-portal-pipeline-sf-fase1.""",
        labels=[("dba_plan","dba-20261008-portal-pipeline-sf-fase1"),("app","portal"),("kind","check")])
AS
WITH
f AS (
  SELECT * FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot`
  WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot`)
),
s AS (SELECT * FROM `mcp-connector-procedure.lending_marts.pipeline_snapshot_sf`),
m AS (
  SELECT f, s, o.SystemModstamp > f.uploaded_at AS cambiado_despues
  FROM f
  JOIN s USING (opportunity_name)
  JOIN `mcp-connector-procedure.salesforce_incremental.Opportunity_current` o ON o.Id = s.opportunity_id
),
cols AS (
  SELECT c.col, COUNTIF(c.differs) AS diferencias, COUNTIF(c.differs AND m.cambiado_despues) AS cambiados_despues
  FROM m, UNNEST([
    STRUCT('branch' AS col,                    (m.f.branch IS DISTINCT FROM m.s.branch) AS differs),
    STRUCT('branch_raw',                        m.f.branch_raw IS DISTINCT FROM m.s.branch_raw),
    STRUCT('affinity_program',                  m.f.affinity_program IS DISTINCT FROM m.s.affinity_program),
    STRUCT('branch_transferred',                m.f.branch_transferred IS DISTINCT FROM m.s.branch_transferred),
    STRUCT('channel',                           m.f.channel IS DISTINCT FROM m.s.channel),
    STRUCT('stage',                             m.f.stage IS DISTINCT FROM m.s.stage),
    STRUCT('loan_folder',                       m.f.loan_folder IS DISTINCT FROM m.s.loan_folder),
    STRUCT('milestone_raw',                     m.f.milestone_raw IS DISTINCT FROM m.s.milestone_raw),
    STRUCT('healthiness_raw',                   m.f.healthiness_raw IS DISTINCT FROM m.s.healthiness_raw),
    STRUCT('amount',                            m.f.amount IS DISTINCT FROM m.s.amount),
    STRUCT('est_closing_date',                  m.f.est_closing_date IS DISTINCT FROM m.s.est_closing_date),
    STRUCT('org_est_closing_date',              m.f.org_est_closing_date IS DISTINCT FROM m.s.org_est_closing_date),
    STRUCT('milestone_date',                    m.f.milestone_date IS DISTINCT FROM m.s.milestone_date),
    STRUCT('application_date',                  m.f.application_date IS DISTINCT FROM m.s.application_date),
    STRUCT('disbursement_date',                 m.f.disbursement_date IS DISTINCT FROM m.s.disbursement_date),
    STRUCT('lock_exp_date',                     m.f.lock_exp_date IS DISTINCT FROM m.s.lock_exp_date),
    STRUCT('icd_date',                          m.f.icd_date IS DISTINCT FROM m.s.icd_date),
    STRUCT('date_denied',                       m.f.date_denied IS DISTINCT FROM m.s.date_denied),
    STRUCT('loan_officer',                      m.f.loan_officer IS DISTINCT FROM m.s.loan_officer),
    STRUCT('loan_processor',                    m.f.loan_processor IS DISTINCT FROM m.s.loan_processor),
    STRUCT('loa2',                              m.f.loa2 IS DISTINCT FROM m.s.loa2),
    STRUCT('loa_2',                             m.f.loa_2 IS DISTINCT FROM m.s.loa_2),
    STRUCT('loan_status',                       m.f.loan_status IS DISTINCT FROM m.s.loan_status),
    STRUCT('loan_type',                         m.f.loan_type IS DISTINCT FROM m.s.loan_type),
    STRUCT('loan_program',                      m.f.loan_program IS DISTINCT FROM m.s.loan_program),
    STRUCT('loan_purpose',                      m.f.loan_purpose IS DISTINCT FROM m.s.loan_purpose),
    STRUCT('property_state',                    m.f.property_state IS DISTINCT FROM m.s.property_state),
    STRUCT('property_address',                  m.f.property_address IS DISTINCT FROM m.s.property_address),
    STRUCT('strategy_raw',                      m.f.strategy_raw IS DISTINCT FROM m.s.strategy_raw),
    STRUCT('opportunity_owner',                 m.f.opportunity_owner IS DISTINCT FROM m.s.opportunity_owner),
    STRUCT('opportunity_owner_title',           m.f.opportunity_owner_title IS DISTINCT FROM m.s.opportunity_owner_title),
    STRUCT('nppm_realtor',                      m.f.nppm_realtor IS DISTINCT FROM m.s.nppm_realtor),
    STRUCT('referred_by',                       m.f.referred_by IS DISTINCT FROM m.s.referred_by),
    STRUCT('buyers_agent',                      m.f.buyers_agent IS DISTINCT FROM m.s.buyers_agent),
    STRUCT('referred_by_nppm',                  m.f.referred_by_nppm IS DISTINCT FROM m.s.referred_by_nppm),
    STRUCT('affinity_broker_name',              m.f.affinity_broker_name IS DISTINCT FROM m.s.affinity_broker_name),
    STRUCT('stat_closing_risk',                 m.f.stat_closing_risk IS DISTINCT FROM m.s.stat_closing_risk),
    STRUCT('production_support_notes_255',      m.f.production_support_notes IS DISTINCT FROM NULLIF(RTRIM(SUBSTR(m.s.production_support_notes, 1, 255)), '')),
    STRUCT('is_pipeline',                       m.f.is_pipeline IS DISTINCT FROM m.s.is_pipeline)
  ]) AS c
  GROUP BY c.col
)
SELECT 'filas_solo_archivo' AS chequeo,
       (SELECT COUNT(*) FROM f WHERE opportunity_name NOT IN (SELECT opportunity_name FROM s)) AS diferencias,
       CAST(NULL AS INT64) AS cambiados_despues,
       (SELECT MAX(snapshot_date) FROM f) AS dia_archivo
UNION ALL
SELECT 'filas_solo_salesforce',
       (SELECT COUNT(*) FROM s WHERE opportunity_name NOT IN (SELECT opportunity_name FROM f)),
       (SELECT COUNTIF(o.CreatedDate > (SELECT MAX(uploaded_at) FROM f) OR o.SystemModstamp > (SELECT MAX(uploaded_at) FROM f))
          FROM s JOIN `mcp-connector-procedure.salesforce_incremental.Opportunity_current` o ON o.Id = s.opportunity_id
         WHERE s.opportunity_name NOT IN (SELECT opportunity_name FROM f)),
       (SELECT MAX(snapshot_date) FROM f)
UNION ALL
SELECT CONCAT('columna:', col), diferencias, cambiados_despues, (SELECT MAX(snapshot_date) FROM f)
FROM cols;
