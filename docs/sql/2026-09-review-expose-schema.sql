-- ============================================================================
-- RV1 — EXPONER EL ESQUEMA `review` EN POSTGREST
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor. Y hace falta AHORA: sin esto el modelo
-- está aplicado y la app no puede verlo.
--
--
-- ---------------------------------------------------------------------------
-- LA MITAD QUE FALTABA DEL ARCHIVO ANTERIOR
-- ---------------------------------------------------------------------------
--
-- `2026-09-review-mode.sql` creó las seis tablas, sus grants y sus policies, y
-- todo eso quedó bien. Pero un esquema NUEVO no se expone solo: PostgREST sólo
-- atiende los que están en `pgrst.db_schemas`, y `review` no estaba.
--
-- Medido con una sesión `authenticated` real, después de aplicar el modelo:
--
--   GET /rest/v1/review.phase   →  406  PGRST106
--   "Only the following schemas are exposed: public, b2b_metrics,
--    activity_report, pipeline_forecast, finance_pl, hr_us_payroll,
--    finance_division, org, business_plan, uploads, outlook"
--
--   GET /rest/v1/business_plan.funnel  →  200   (el control)
--
-- ⚠ ES EXACTAMENTE EL MISMO ERROR QUE EL GRANT DE `business_plan.area`, y por
-- la misma razón: escribí las policies --que es lo que estaba pensando-- y no
-- el paso de plomería que las hace alcanzables. Los archivos anteriores del
-- repo dicen "`business_plan` ya está expuesto desde BP6, esta migración no
-- necesita tocar `pgrst.db_schemas`", y esa frase repetida en cinco archivos
-- fue la que hizo que no me lo preguntara para el sexto -- el primero que crea
-- un esquema.
--
-- Y se distingue de un problema de permisos, que conviene: un 406 con PGRST106
-- es un esquema no expuesto, un 403 es un GRANT que falta, y cero filas con
-- `error: null` es una policy que no aplica. Los tres mandan a mirar lugares
-- distintos.
--
--
-- ---------------------------------------------------------------------------
-- ⚠ EL VALOR VA COMPLETO, NO "AGREGAR review"
-- ---------------------------------------------------------------------------
--
-- `pgrst.db_schemas` se REEMPLAZA entero: no hay forma de agregarle un
-- elemento. Así que la lista de abajo son los ONCE que ya estaban, leídos de la
-- respuesta real de PostgREST, MÁS `review` al final.
--
-- Perder uno al reescribirla apagaría un módulo completo sin que nada falle en
-- el despliegue: la pantalla simplemente diría que las tablas no están
-- aplicadas, porque así es como estas pantallas toleran un 404. Por eso el
-- valor está escrito una sola vez y no se retipea.
--
-- Si esta lista no coincide con la de tu proyecto, NO apliques esto: volvé a
-- leerla con una consulta a cualquier tabla de un esquema inexistente y usá el
-- `hint` de la respuesta.

alter role authenticator
  set pgrst.db_schemas =
    'public, b2b_metrics, activity_report, pipeline_forecast, finance_pl, hr_us_payroll, finance_division, org, business_plan, uploads, outlook, review';

-- PostgREST lee su configuración al arrancar y ante esta señal. Sin el notify,
-- el cambio queda escrito y no aplicado hasta el próximo reinicio -- que es la
-- forma de que "lo apliqué y sigue sin funcionar" sea cierto.
notify pgrst, 'reload config';


-- ---------------------------------------------------------------------------
-- ALTERNATIVA POR EL PANEL, SI SE PREFIERE
-- ---------------------------------------------------------------------------
--
-- Supabase Dashboard → Project Settings → API → "Exposed schemas": agregar
-- `review` a la lista. Hace lo mismo y evita retipear los once.
--
-- Es la opción más segura de las dos justamente porque no hay que reescribir la
-- lista: el panel la muestra y sólo se suma uno.


-- ---------------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------------
--
-- Desde el editor de SQL, que el rol quedó con el valor:
--
--   select rolname, rolconfig from pg_roles where rolname = 'authenticator';
--   -- esperado: un elemento `pgrst.db_schemas=...` terminando en `review`.
--
-- Y lo que de verdad importa, que es por el otro camino -- desde la app o con
-- una sesión `authenticated`:
--
--   GET /rest/v1/phase?select=*   con  Accept-Profile: review
--   -- esperado: 200 y las tres fases. Un 406 significa que el notify no llegó.
--
-- ⚠ La comprobación del `pg_roles` NO alcanza: dice que el valor está escrito,
-- no que PostgREST lo esté usando. Son dos preguntas distintas y la que
-- responde la pantalla es la segunda.
