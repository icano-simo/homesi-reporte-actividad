-- DBA-20261008-sfinc-desempate · aplicado en BigQuery el 2026-10-08 con OK de Isabella. NO volver a ejecutar.
-- En salesforce_incremental.{Opportunity,Lead}_current, ante empate de SystemModstamp gana la copia nocturna (_src = 1).
-- Las fórmulas que dependen de TODAY() (AgeInDays, Days_In_Current_Stage__c) cambian sin tocar SystemModstamp;
-- la copia horaria guarda el valor del día en que se cargó, y preferirla atrasaba esos campos un día por día
-- (36.564 oportunidades el 2026-10-08).
-- Respaldo de la definición anterior: governance.bkp_20261008_sfinc_{Opportunity,Lead}_current.
-- Verificado: 0 empates distintos de la réplica (37.116 Opportunity, 183.242 Lead); lo nuevo y lo editado en el día sigue ganando.
-- Vuelta atrás: CREATE OR REPLACE VIEW con la definición del respaldo.

CREATE OR REPLACE VIEW `mcp-connector-procedure.salesforce_incremental.Opportunity_current`
OPTIONS(description="""Latest version of every Salesforce Opportunity: nightly full copy (salesforce.Opportunity) merged with the hourly incremental copy (salesforce_incremental.Opportunity). Changes win by SystemModstamp; records deleted in Salesforce drop out at the next nightly load. Created 2026-10-05.
⚠ Tie-break: on equal SystemModstamp the nightly copy (_src = 1) wins. Formula fields that depend on TODAY() (AgeInDays, Days_In_Current_Stage__c, ...) change without touching SystemModstamp; the hourly copy keeps the value from the day it was loaded, so preferring it made those fields drift one day per day (36,564 rows on 2026-10-08). Changed by plan DBA-20261008-sfinc-desempate; previous definition in governance.bkp_20261008_sfinc_Opportunity_current.""",
        labels=[("dba_plan","dba-20261008-sfinc-desempate")])
AS
WITH snap AS (SELECT MAX(SystemModstamp) AS ts FROM `mcp-connector-procedure.salesforce.Opportunity`),
u AS (
  SELECT *, 1 AS _src FROM `mcp-connector-procedure.salesforce.Opportunity`
  UNION ALL BY NAME
  SELECT *, 2 AS _src FROM `mcp-connector-procedure.salesforce_incremental.Opportunity`
  WHERE Id IN (SELECT Id FROM `mcp-connector-procedure.salesforce.Opportunity`)
     OR CreatedDate > (SELECT ts FROM snap))
SELECT * EXCEPT (_src, _rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY Id ORDER BY SystemModstamp DESC, _src ASC) AS _rn FROM u)
WHERE _rn = 1;

CREATE OR REPLACE VIEW `mcp-connector-procedure.salesforce_incremental.Lead_current`
OPTIONS(description="""Latest version of every Salesforce Lead: nightly full copy (salesforce.Lead) merged with the hourly incremental copy (salesforce_incremental.Lead). Changes win by SystemModstamp; records deleted in Salesforce drop out at the next nightly load. Created 2026-10-05.
⚠ Tie-break: on equal SystemModstamp the nightly copy (_src = 1) wins. Formula fields that depend on TODAY() change without touching SystemModstamp; the hourly copy keeps the value from the day it was loaded, so preferring it made those fields drift one day per day. Changed by plan DBA-20261008-sfinc-desempate; previous definition in governance.bkp_20261008_sfinc_Lead_current.""",
        labels=[("dba_plan","dba-20261008-sfinc-desempate")])
AS
WITH snap AS (SELECT MAX(SystemModstamp) AS ts FROM `mcp-connector-procedure.salesforce.Lead`),
u AS (
  SELECT *, 1 AS _src FROM `mcp-connector-procedure.salesforce.Lead`
  UNION ALL BY NAME
  SELECT *, 2 AS _src FROM `mcp-connector-procedure.salesforce_incremental.Lead`
  WHERE Id IN (SELECT Id FROM `mcp-connector-procedure.salesforce.Lead`)
     OR CreatedDate > (SELECT ts FROM snap))
SELECT * EXCEPT (_src, _rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY Id ORDER BY SystemModstamp DESC, _src ASC) AS _rn FROM u)
WHERE _rn = 1;
