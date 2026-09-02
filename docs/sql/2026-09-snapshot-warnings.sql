-- ============================================================================
-- pipeline_snapshots.warnings — los avisos de la carga, consultables
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
--
-- El parser de Salesforce (`lib/pipeline/sources/salesforce-file.ts`) DESCARTA
-- filas en silencio, en tres lugares:
--
--   1. `Stage = Negotiation` con un `Current Milestone` que no está en
--      `MILESTONE_BUCKET` -> la fila no entra a ninguna tabla.
--   2. Un `Stage` desconocido -> "row discarded".
--   3. Al encontrar una fila `Subtotal` salta DOS filas: la del subtotal y la
--      que le sigue, que asume que es la línea `Count`. Si el layout no la
--      trae, se come un préstamo real sin haberlo mirado nunca.
--
-- Los tres generan un `warning`, y los warnings viajan SÓLO en la respuesta
-- HTTP del upload. Nadie los guarda. Hoy no hay forma de saber si el snapshot
-- 19 perdió filas, ni cuántas, ni cuáles: es irrecuperable.
--
-- ⚠ Y `row_count` NO SIRVE PARA DETECTARLO. Lo escribe
-- `save_pipeline_snapshot` a partir de lo que RECIBE, o sea de lo ya parseado.
-- En el snapshot 19 dice 820 y hay 820 filas guardadas: eso sólo dice "se
-- guardó todo lo que llegó", nunca "llegó todo lo que había".
--
-- Esto es lo que habría hecho visible el hueco de los 13 préstamos Brokered
-- cuando ocurrió, en vez de aparecer un mes después comparando dos Excel a
-- mano.
--
-- ── POR QUÉ UNA COLUMNA Y NO UNA TABLA ──────────────────────────────────────
--
-- Un snapshot tiene un puñado de avisos y se leen siempre junto al snapshot,
-- nunca por su cuenta. Una tabla hija pediría un join para algo que no se
-- consulta de forma independiente. `jsonb` porque el shape lo decide quien
-- carga: el parser produce strings, y el job del sync podría querer guardar
-- objetos con más campos sin migrar nada.
--
-- ⚠ ES PARA CUALQUIER ORIGEN, NO SÓLO PARA EL PARSER. Desde el 28 de agosto de
-- 2026 los snapshots los arma el job de BigQuery (`file_name` con prefijo
-- `bigquery:`) y ya NINGUNA pantalla llama a `/api/pipeline/parse` -- verificado
-- grepeando el repo. O sea: el camino del parser está retirado en la práctica y
-- esta columna le sirve poco. El que la necesita es el SYNC, que es donde se
-- cargan los snapshots hoy y donde vive el hueco de Brokered. La columna queda
-- lista para que el job la escriba; ese job no está en este repo.
--
-- ── LA COLUMNA ──────────────────────────────────────────────────────────────

alter table pipeline_forecast.pipeline_snapshots
  add column if not exists warnings jsonb;

comment on column pipeline_forecast.pipeline_snapshots.warnings is
  'Avisos de la carga que produjo este snapshot: filas descartadas, valores '
  'inesperados, columnas ausentes. NULL = la carga no reportó nada (o es '
  'anterior a esta columna, que no es lo mismo y no se puede distinguir: los 24 '
  'snapshots previos al 2026-09 quedan en NULL para siempre). Array vacío = la '
  'carga corrió y no tuvo nada que avisar.';

-- ⚠ NULL Y `[]` NO SIGNIFICAN LO MISMO, y por eso la columna admite NULL en vez
-- de tener default `'[]'::jsonb`. Un default convertiría los 24 snapshots
-- históricos en "no tuvieron avisos", que es una afirmación falsa: lo que pasa
-- es que no se sabe. Es la misma distinción que el resto del proyecto mantiene
-- entre "cero" y "vacío".

-- ── LA POLICY DE UPDATE YA EXISTE, no hace falta agregar nada ───────────────
--
-- Verificado: `pipeline_snapshots` tiene tres policies para `authenticated`
-- --insert, select y update-- las tres exigiendo 'commercial_activity' en
-- `app_metadata.allowed_apps`. La de update se llama "commercial_activity
-- deactivate" (existe para que el cliente pueda apagar `is_active`) y alcanza
-- para escribir `warnings` con la sesión del usuario, sin `service_role`.
--
-- ⚠ Se deja escrito porque si esa policy no existiera, el UPDATE no fallaría:
-- RLS FILTRA, no rechaza. Afectaría cero filas y devolvería `error: null`, y
-- los warnings se perderían con la misma silenciosidad que el problema que esta
-- columna viene a resolver.

-- ── CÓMO SE CONSULTA ────────────────────────────────────────────────────────
--
--   -- cargas que reportaron algo, más reciente primero
--   select id, snapshot_date, jsonb_array_length(warnings) as avisos, warnings
--   from pipeline_forecast.pipeline_snapshots
--   where warnings is not null and jsonb_array_length(warnings) > 0
--   order by snapshot_date desc;
--
--   -- sólo los descartes, que son los que cambian los números
--   select s.snapshot_date, w.aviso
--   from pipeline_forecast.pipeline_snapshots s,
--        jsonb_array_elements_text(s.warnings) as w(aviso)
--   where w.aviso ilike '%discarded%' or w.aviso ilike '%not counted%'
--   order by s.snapshot_date desc;
