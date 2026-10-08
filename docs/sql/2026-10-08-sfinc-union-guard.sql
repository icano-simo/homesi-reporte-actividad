-- DBA-20261008-sfinc-union-guard · aplicado en BigQuery el 2026-10-08 con OK de Isabella. NO volver a ejecutar.
-- En salesforce_incremental.{Opportunity,Lead}_current, UNION ALL BY NAME -> FULL UNION ALL BY NAME: un campo nuevo de
-- Salesforce llega a la copia horaria y a la nocturna en momentos distintos; el lado que no lo tiene da NULL en vez de
-- romper la vista. Un cambio de TIPO la sigue rompiendo a propósito: lo dice lending_marts.check_sfinc_schema_drift.
-- Respaldo de la definición anterior: governance.bkp_20261008b_sfinc_{Opportunity,Lead}_current.
-- Verificado: huella de datos (COUNT + BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(fila)))) idéntica antes y después,
-- sin carga horaria de por medio; check_sfinc_schema_drift = 0 filas; control positivo con una columna extra: OK.
-- Vuelta atrás: CREATE OR REPLACE VIEW con la definición del respaldo; DROP VIEW de la vista de control.

CREATE OR REPLACE VIEW `mcp-connector-procedure.salesforce_incremental.Opportunity_current`
OPTIONS(description="""Latest version of every Salesforce Opportunity: nightly full copy (salesforce.Opportunity) merged with the hourly incremental copy (salesforce_incremental.Opportunity). Changes win by SystemModstamp; records deleted in Salesforce drop out at the next nightly load. Created 2026-10-05.
⚠ Tie-break: on equal SystemModstamp the nightly copy (_src = 1) wins. Formula fields that depend on TODAY() (AgeInDays, Days_In_Current_Stage__c, ...) change without touching SystemModstamp; the hourly copy keeps the value from the day it was loaded, so preferring it made those fields drift one day per day (36,564 rows on 2026-10-08). Changed by plan DBA-20261008-sfinc-desempate; previous definition in governance.bkp_20261008_sfinc_Opportunity_current.
⚠ FULL UNION ALL BY NAME: a field added in Salesforce reaches the hourly and the nightly copy at different times; the side that lacks it yields NULL instead of breaking the view. A changed TYPE still breaks it on purpose — see lending_marts.check_sfinc_schema_drift. Plan DBA-20261008-sfinc-union-guard; previous definition in governance.bkp_20261008b_sfinc_Opportunity_current.""",
        labels=[("dba_plan","dba-20261008-sfinc-union-guard")])
AS
WITH snap AS (SELECT MAX(SystemModstamp) AS ts FROM `mcp-connector-procedure.salesforce.Opportunity`),
u AS (
  SELECT *, 1 AS _src FROM `mcp-connector-procedure.salesforce.Opportunity`
  FULL UNION ALL BY NAME
  SELECT *, 2 AS _src FROM `mcp-connector-procedure.salesforce_incremental.Opportunity`
  WHERE Id IN (SELECT Id FROM `mcp-connector-procedure.salesforce.Opportunity`)
     OR CreatedDate > (SELECT ts FROM snap))
SELECT * EXCEPT (_src, _rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY Id ORDER BY SystemModstamp DESC, _src ASC) AS _rn FROM u)
WHERE _rn = 1;

CREATE OR REPLACE VIEW `mcp-connector-procedure.salesforce_incremental.Lead_current`
OPTIONS(description="""Latest version of every Salesforce Lead: nightly full copy (salesforce.Lead) merged with the hourly incremental copy (salesforce_incremental.Lead). Changes win by SystemModstamp; records deleted in Salesforce drop out at the next nightly load. Created 2026-10-05.
⚠ Tie-break: on equal SystemModstamp the nightly copy (_src = 1) wins. Formula fields that depend on TODAY() change without touching SystemModstamp; the hourly copy keeps the value from the day it was loaded, so preferring it made those fields drift one day per day. Changed by plan DBA-20261008-sfinc-desempate; previous definition in governance.bkp_20261008_sfinc_Lead_current.
⚠ FULL UNION ALL BY NAME: a field added in Salesforce reaches the hourly and the nightly copy at different times; the side that lacks it yields NULL instead of breaking the view. A changed TYPE still breaks it on purpose — see lending_marts.check_sfinc_schema_drift. Plan DBA-20261008-sfinc-union-guard; previous definition in governance.bkp_20261008b_sfinc_Lead_current.""",
        labels=[("dba_plan","dba-20261008-sfinc-union-guard")])
AS
WITH snap AS (SELECT MAX(SystemModstamp) AS ts FROM `mcp-connector-procedure.salesforce.Lead`),
u AS (
  SELECT *, 1 AS _src FROM `mcp-connector-procedure.salesforce.Lead`
  FULL UNION ALL BY NAME
  SELECT *, 2 AS _src FROM `mcp-connector-procedure.salesforce_incremental.Lead`
  WHERE Id IN (SELECT Id FROM `mcp-connector-procedure.salesforce.Lead`)
     OR CreatedDate > (SELECT ts FROM snap))
SELECT * EXCEPT (_src, _rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY Id ORDER BY SystemModstamp DESC, _src ASC) AS _rn FROM u)
WHERE _rn = 1;

CREATE VIEW `mcp-connector-procedure.lending_marts.check_sfinc_schema_drift`
OPTIONS(description="""Control: columns that differ between the nightly Salesforce copy (salesforce.<obj>) and the hourly copy (salesforce_incremental.<obj>) for the objects merged by salesforce_incremental.*_current.
Grain: one row per (object, column) that is missing on one side or has a different type. Expected: ZERO rows.
⚠ kind = 'missing_in_nightly' / 'missing_in_hourly' is tolerated by *_current (FULL UNION ALL BY NAME fills NULL) and usually closes by itself at the next nightly load.
⚠ kind = 'type_mismatch' BREAKS *_current on purpose: a person must decide. Plan DBA-20261008-sfinc-union-guard.""",
        labels=[("dba_plan","dba-20261008-sfinc-union-guard"),("kind","check")])
AS
WITH r AS (
  SELECT table_name, column_name, data_type
  FROM `mcp-connector-procedure.salesforce.INFORMATION_SCHEMA.COLUMNS`
  WHERE table_name IN ('Lead', 'Opportunity')),
i AS (
  SELECT table_name, column_name, data_type
  FROM `mcp-connector-procedure.salesforce_incremental.INFORMATION_SCHEMA.COLUMNS`
  WHERE table_name IN ('Lead', 'Opportunity'))
SELECT
  COALESCE(r.table_name, i.table_name)   AS sf_object,
  COALESCE(r.column_name, i.column_name) AS column_name,
  r.data_type                            AS nightly_type,
  i.data_type                            AS hourly_type,
  CASE WHEN r.column_name IS NULL THEN 'missing_in_nightly'
       WHEN i.column_name IS NULL THEN 'missing_in_hourly'
       ELSE 'type_mismatch' END          AS kind
FROM r
FULL JOIN i ON i.table_name = r.table_name AND i.column_name = r.column_name
WHERE r.column_name IS NULL OR i.column_name IS NULL OR r.data_type != i.data_type;
