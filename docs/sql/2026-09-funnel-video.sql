-- ============================================================================
-- BP48 — EL VIDEO DE UN FUNNEL: SOLO LA URL, SIN ALMACENAMIENTO
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UNA URL Y NO UN BUCKET
-- ---------------------------------------------------------------------------
--
-- Los cuatro buckets que existen hoy, leídos de la API de Storage antes de
-- decidir:
--
--   avatars      público   tope  2 MB   4 tipos de imagen
--   legal-docs   privado   tope  5 MB   pdf, doc, imagen
--   reports      privado   tope  5 MB   pdf, xls, csv
--   pmo-files    privado   tope 10 MB   imagen, pdf, office
--
-- Los cuatro tienen lista blanca de MIME y NINGUNO admite video. El tope más
-- alto del portal son 10 MB y un video de estrategia son cientos: no es
-- "agregar un bucket", es otro orden de magnitud de almacenamiento, de egress
-- y de política, más subida resumible para archivos que no entran en una
-- request.
--
-- Así que el video vive donde ya vivan los videos de la empresa y acá sólo
-- queda su dirección. Si algún día se sube al portal, esta columna NO cambia:
-- se agrega el bucket y la URL pasa a apuntar ahí. Al revés --de bucket a
-- URL-- sí habría que migrar archivos.
--
-- ---------------------------------------------------------------------------
-- ⚠ EL `check` ES DELIBERADAMENTE FLOJO, Y TAMBIÉN DELIBERADAMENTE EXISTE
-- ---------------------------------------------------------------------------
--
-- Flojo: `^https?://` y nada más. Un enlace de inserción de SharePoint o de
-- OneDrive es larguísimo y trae parámetros firmados; cualquier regla más
-- específica --exigir un dominio, un final en .mp4, un largo máximo-- lo
-- rechazaría. Lo que hay que impedir es una frase suelta, no una URL rara.
--
-- Y existe por un precedente de esta misma base de datos. `node_milestone.
-- resource_url` se agregó como "campo para adjuntar material", sin validación:
-- terminó con 2 de 106 plantillas llenas, NINGUNA de las dos con una URL --
-- decían "LO & BD Accountable for this" y "Topic defined by the host (LO)".
-- Se usó como nota libre, hubo que ocultar el campo de la interfaz y la
-- columna no se pudo borrar porque habría perdido esas dos notas. Un campo de
-- URL sin `check` se convierte en un campo de texto libre.
--
-- ---------------------------------------------------------------------------
-- LA DURACIÓN NO SE INVENTA
-- ---------------------------------------------------------------------------
--
-- `video_seconds` es nullable y `null` significa "no se sabe", no "cero". La
-- tarjeta no muestra duración cuando es `null`; un "0:00" sería la mentira
-- tranquilizadora de siempre.
--
-- Se llena de dos maneras según la forma de la URL, que es la misma división
-- que decide cómo se reproduce:
--
--   archivo directo (.mp4, .webm)  ->  <video>, y el navegador la lee solo
--   enlace de inserción            ->  <iframe>, y la escribe una persona
--
-- No hay forma de leer la duración de un embed sin la API de cada proveedor,
-- así que no se finge que la haya.
--
-- ---------------------------------------------------------------------------
-- QUÉ NO TRAE ESTE ARCHIVO
-- ---------------------------------------------------------------------------
--
-- ⚠ NINGÚN CAMBIO DE PERMISOS. Hoy `business_plan.funnel` tiene una sola
-- policy, `funnel_all`, `for all to authenticated using
-- (business_plan.has_access())` -- y `has_access()` es sólo "el JWT tiene
-- commercial_activity en allowed_apps". O sea que cualquiera que entre al
-- módulo puede editar y borrar cualquier funnel, y en `business_plan` no
-- existe ningún claim de administrador.
--
-- Restringir SÓLO el video dejaría una puerta con llave al lado de una
-- abierta: quien no pudiera cambiar el video podría igual borrar el funnel
-- entero. Eso se decide aparte y con su propio SQL. Mientras tanto la interfaz
-- no finge una restricción que la base no tiene.

begin;

alter table business_plan.funnel
  add column if not exists video_url     text,
  add column if not exists video_title   text,
  add column if not exists video_seconds integer;

-- `not valid` no: la tabla tiene 9 filas y ninguna con video, así que validar
-- ahora no cuesta nada y deja la restricción activa desde el primer día.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'business_plan.funnel'::regclass and conname = 'funnel_video_url_http'
  ) then
    alter table business_plan.funnel
      add constraint funnel_video_url_http
      check (video_url is null or video_url ~ '^https?://');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'business_plan.funnel'::regclass and conname = 'funnel_video_seconds_pos'
  ) then
    alter table business_plan.funnel
      add constraint funnel_video_seconds_pos
      check (video_seconds is null or video_seconds > 0);
  end if;

  -- El título y la duración describen un video: sin URL no describen nada, y
  -- una fila con título y sin dirección es basura que después alguien lee como
  -- si significara algo.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'business_plan.funnel'::regclass and conname = 'funnel_video_parts_together'
  ) then
    alter table business_plan.funnel
      add constraint funnel_video_parts_together
      check (video_url is not null or (video_title is null and video_seconds is null));
  end if;
end $$;

comment on column business_plan.funnel.video_url is
  'Direccion del video de estrategia. Archivo directo (.mp4/.webm) o enlace de INSERCION. Sin almacenamiento propio: ver BP48.';
comment on column business_plan.funnel.video_title is
  'Como se llama el video en la tarjeta. Si esta vacio la tarjeta usa el nombre del funnel.';
comment on column business_plan.funnel.video_seconds is
  'Duracion en segundos. NULL = no se sabe, no cero: de un embed no se puede leer y la escribe una persona. Ver BP48.';

commit;


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBARLO
-- ---------------------------------------------------------------------------
--
-- ⚠ NINGUNA PRUEBA DE ABAJO USA UNA CLAVE ESCRITA A MANO, y no es manía.
--
-- La primera versión de este archivo probaba con `where funnel_key = 1`. Las
-- claves reales de esta tabla son 13..21, así que ese UPDATE tocaba CERO filas
-- -- y un UPDATE que no matchea nada NO FALLA: devuelve éxito, y el `check`
-- ni siquiera se evalúa. Corriéndolo así, las tres restricciones parecían no
-- rechazar nada. Parecían: en realidad nunca se las llamó.
--
-- Es el mismo mecanismo que «cero filas con error null es una policy de RLS
-- que no aplica», corrido a la escritura. La forma de no volver a caer es no
-- inventar la clave y mirar cuántas filas se tocaron.
--
-- 1. Las tres columnas están y ninguna fila quedó tocada:
--
--      select count(*) as funnels,
--             count(video_url) as con_video,
--             min(funnel_key) as primera,
--             max(funnel_key) as ultima
--        from business_plan.funnel;
--      -- espera: 9, 0, y el rango real de claves
--
-- 2. Las tres restricciones existen y están validadas:
--
--      select conname, pg_get_constraintdef(oid), convalidated
--        from pg_constraint
--       where conrelid = 'business_plan.funnel'::regclass
--         and conname like 'funnel_video%'
--       order by conname;
--      -- espera: funnel_video_parts_together, funnel_video_seconds_pos,
--      --         funnel_video_url_http -- las tres con convalidated = true
--
-- 3. El `check` rechaza una frase y acepta un enlace de inserción largo.
--    `returning` para VER que tocó una fila:
--
--      -- debe FALLAR con 23514
--      update business_plan.funnel
--         set video_url = 'LO & BD Accountable for this'
--       where funnel_key = (select min(funnel_key) from business_plan.funnel)
--      returning funnel_key;
--
--      -- debe PASAR y devolver una fila
--      update business_plan.funnel
--         set video_url = 'https://supremelending-my.sharepoint.com/personal/x/_layouts/15/embed.aspx?UniqueId=00000000-0000-0000-0000-000000000000&embed=%7B%22ust%22%3Atrue%2C%22hv%22%3A%22CopyEmbedCode%22%7D&referrer=StreamWebApp'
--       where funnel_key = (select min(funnel_key) from business_plan.funnel)
--      returning funnel_key, length(video_url);
--
-- 4. Cero no es una duración, y título sin URL no entra:
--
--      -- las dos deben FALLAR con 23514
--      update business_plan.funnel set video_seconds = 0
--       where funnel_key = (select min(funnel_key) from business_plan.funnel);
--      update business_plan.funnel set video_url = null, video_title = 'Kickoff'
--       where funnel_key = (select min(funnel_key) from business_plan.funnel);
--
-- 5. Y dejarlo como estaba:
--
--      update business_plan.funnel
--         set video_url = null, video_title = null, video_seconds = null
--       where video_url is not null
--      returning funnel_key;
--      -- espera: cero filas si no se corrió el paso 3, una si sí
