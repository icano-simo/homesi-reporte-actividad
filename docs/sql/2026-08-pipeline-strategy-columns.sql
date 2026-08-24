-- ===========================================================================
-- F6 — LOS CINCO CRUDOS DE LA ESTRATEGIA COMERCIAL
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor.
--
-- ⚠⚠ ESTA MIGRACIÓN SOLA NO ALCANZA. Hay que ampliar también
-- `pipeline_forecast.save_pipeline_snapshot()` -- la lista exacta de campos
-- está al final de este archivo. Sin eso, la RPC devuelve 200 y descarta las
-- cinco claves en silencio, que es lo que ya pasó con `loan_type`,
-- `loan_program` y `production_support_note_history`.
--
--
-- ---------------------------------------------------------------------------
-- 1. QUÉ SE GUARDA, Y POR QUÉ CRUDO
-- ---------------------------------------------------------------------------
--
-- Se guardan los VALORES CRUDOS del export, no la estrategia calculada. Es la
-- decisión de fondo de la etapa:
--
--   · Si mañana cambia una regla -- que entre una branch nueva a recruitment,
--     que B2B pase a mirar otra columna -- con los crudos se recalcula todo al
--     vuelo, sobre el histórico completo.
--   · Con la estrategia guardada habría que recargar todos los archivos para
--     reflejar la regla nueva, y los exports viejos ya no están.
--
-- Es el mismo criterio que `data_as_of` de S1 frente a `snapshot_date`: se
-- guarda el hecho, no la conclusión.
--
-- La clasificación vive en `lib/pipeline/strategy.ts` y se aplica al mostrar.
--
--
-- ---------------------------------------------------------------------------
-- 2. LAS CINCO COLUMNAS
-- ---------------------------------------------------------------------------
--
--   strategy_raw              columna `Strategy` del export. ⚠ Se usa SÓLO para
--                             detectar NPPM. Los 171 préstamos que dicen
--                             'B2B Strategy' NO determinan B2B -- eso lo define
--                             el title del owner. Son poblaciones distintas:
--                             171 con 'B2B Strategy', 205 con title
--                             'Business Developer', y sólo 77 en las dos.
--
--   opportunity_owner_title   columna `Opportunity Owner: Title`. Es lo que
--                             define B2B ('Business Developer').
--
--   nppm_realtor              columna `NPPM Realtor`.
--   referred_by               columna `Referred By`.
--                             Los dos, para el realtor en el modal de detalle.
--
--   affinity_program          columna `Affinity Program`. Hoy no lo consume
--                             ninguna pantalla: se guarda porque es el dato que
--                             EXPLICA por qué una branch es Affinity, y
--                             recuperarlo después obligaría a recargar.
--
-- `text` y nullable, sin default: es el mismo patrón de `loan_type` y
-- `production_support_note_history`. Nada de `not null` -- un export viejo no
-- trae estas columnas, y el parser cae a '' sin fallar.
--
--
-- ---------------------------------------------------------------------------
-- 3. TODO: PARA EL REVISOR
-- ---------------------------------------------------------------------------
--
-- `pipeline_forecast` ya está expuesto en PostgREST. Esta migración NO necesita
-- tocar `pgrst.db_schemas` ni ningún `alter role`.
-- ===========================================================================

alter table pipeline_forecast.pipeline_loans
  add column if not exists strategy_raw            text,
  add column if not exists opportunity_owner_title text,
  add column if not exists nppm_realtor            text,
  add column if not exists referred_by             text,
  add column if not exists affinity_program        text;

alter table pipeline_forecast.pipeline_resolved_loans
  add column if not exists strategy_raw            text,
  add column if not exists opportunity_owner_title text,
  add column if not exists nppm_realtor            text,
  add column if not exists referred_by             text,
  add column if not exists affinity_program        text;

comment on column pipeline_forecast.pipeline_loans.strategy_raw is
  'Columna Strategy del export, cruda. Se usa SOLO para detectar NPPM -- ver F6.';
comment on column pipeline_forecast.pipeline_loans.opportunity_owner_title is
  'Columna "Opportunity Owner: Title". Define B2B cuando vale Business Developer -- ver F6.';


-- ===========================================================================
-- 4. ⚠ LO QUE FALTA, Y NO ESTÁ EN ESTE ARCHIVO: AMPLIAR LA RPC
-- ===========================================================================
--
-- `pipeline_forecast.save_pipeline_snapshot()` mapea una lista EXPLÍCITA de
-- columnas en sus `jsonb_to_recordset`. Las claves que no están en esa lista se
-- descartan sin error: la función devuelve 200 y las columnas quedan en NULL.
-- Verificado contra la base en la etapa S1 con `loan_type`, `loan_program` y
-- `production_support_note_history`.
--
-- Por eso el mapper del insert (`app/api/pipeline/parse/route.ts`) TODAVÍA NO
-- manda estas cinco claves. Agregarlas antes de ampliar la función sería
-- escribir código que finge guardar.
--
-- ---------------------------------------------------------------------------
-- LOS CAMPOS A AGREGAR, EN LAS DOS MITADES DE LA FUNCIÓN
-- ---------------------------------------------------------------------------
--
-- En el `jsonb_to_recordset` de `p_loans` -> insert a `pipeline_loans`, y en el
-- de `p_resolved` -> insert a `pipeline_resolved_loans`, con estos nombres
-- exactos y todos `text`:
--
--     strategy_raw             text
--     opportunity_owner_title  text
--     nppm_realtor             text
--     referred_by              text
--     affinity_program         text
--
-- Los nombres de las claves del jsonb son idénticos a los de las columnas, así
-- que el mapper de la app los manda tal cual, sin traducción.
--
-- ---------------------------------------------------------------------------
-- CÓMO COMPROBAR QUE QUEDÓ BIEN
-- ---------------------------------------------------------------------------
--
-- Una carga real y después esto: si alguna cuenta da > 0, la función sigue
-- descartando esa columna.
--
--   select count(*) filter (where strategy_raw is null)            as sin_strategy,
--          count(*) filter (where opportunity_owner_title is null) as sin_title,
--          count(*) filter (where nppm_realtor is null)            as sin_realtor,
--          count(*) filter (where referred_by is null)             as sin_referred,
--          count(*) filter (where affinity_program is null)        as sin_affinity
--     from pipeline_forecast.pipeline_loans
--    where snapshot_id = (select id from pipeline_forecast.pipeline_snapshots
--                          where is_active order by id desc limit 1);
--
-- ⚠ Ojo con la trampa: el parser cae a CADENA VACÍA (''), no a null, cuando el
-- export no trae la columna. Así que un '' significa "la columna no vino o vino
-- vacía" y un NULL significa "la función lo descartó". No son lo mismo, y
-- distinguirlos es justamente lo que permite detectar el fallo silencioso.
