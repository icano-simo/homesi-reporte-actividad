-- ============================================================================
-- ADM3 · Margins — que la app pueda escribir una versión nueva
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
--
-- Hoy `authenticated` tiene SELECT y nada más sobre `margins.branch_margin`, así
-- que las tres formas de editar que pide ADM3 --una celda, una fila, un branch
-- entero-- no pueden escribir. Esto abre el INSERT, y SOLO el insert.
--
-- Medido antes de escribir este archivo, sobre las 726 filas que hay:
--
--     filas                                726
--     clave compuesta bien formada         726
--     `version` = 'v' || version_num       726
--     `changed_at` nulo                      0
--     `changed_by` nulo                    726   <- ninguna la editó una persona
--     `origen` distinto de 'archivo'         0
--
-- O sea que todo lo que este archivo exige ya lo cumple lo que está cargado. No
-- hay que migrar nada.
--
-- ── ⚠ NUNCA UN UPDATE, Y ESO LO GARANTIZA LA BASE ───────────────────────────
--
-- El modelo de esta tabla es append-only: una edición escribe una VERSIÓN NUEVA
-- del branch, y `branch_margin_vigente` se queda con el `version_num` más alto
-- de cada (branch, tipo, nivel).
--
-- Por eso acá se otorga INSERT y nada más, y por eso no hay policy de UPDATE ni
-- de DELETE. Las dos cosas son redundantes a propósito --sin GRANT no hace falta
-- policy, y sin policy no alcanza el GRANT-- porque lo que está en juego es que
-- un margen viejo deje de existir sin que nadie pueda ver que existió.
--
-- ── ⚠ Y `origen = 'app'` LO EXIGE EL `with check`, NO EL CLIENTE ────────────
--
-- Una fila con `origen = 'archivo'` escrita desde la app se la lleva puesta el
-- sync en la próxima corrida, porque para el sync esa fila es suya. Que el valor
-- correcto dependa de que el cliente se acuerde de mandarlo es exactamente la
-- clase de ausencia que no avisa: la edición desaparece semanas después y no hay
-- nada que mirar.
--
-- Con el `with check`, mandarlo mal devuelve 42501 y se ve en el momento.
--
-- ── ⚠ POR QUÉ LAS REGLAS VAN EN LA POLICY Y NO EN UN `check` DE TABLA ───────
--
-- Un `check` de tabla valdría también para el sync, que vive en OTRO repo
-- (`simo-sync`) y que no leí. Las 726 filas de hoy cumplirían todas las reglas
-- de abajo --está medido arriba-- pero eso dice qué escribió el sync hasta hoy,
-- no qué puede escribir mañana. Una restricción que rompe el sync se nota
-- cuando el sync falla, lejos de acá y sin que el síntoma la nombre.
--
-- La policy sólo alcanza a `authenticated`, o sea a la app. Es la mitad del
-- problema que este archivo puede garantizar sin tocar lo que no conoce.
--
-- ── ⚠ EL `reason` PASA A SER OBLIGATORIO ────────────────────────────────────
--
-- Es una decisión de producto escrita en la base, y conviene decirla fuerte: sin
-- el `btrim(...) <> ''` de abajo, la ventana de edición podría guardar sin
-- motivo y el historial mostraría un cambio de 434 a 469 que nadie puede
-- explicar seis meses después. Las 726 filas del archivo tienen motivo.
--
-- Si mañana molesta, es borrar esa línea del `with check`.
--
-- ── ⚠ LA POLICY DE LECTURA NO NOMBRABA `admin` ──────────────────────────────
--
-- `margin_select` pide `homesi`, `outlook` o `analytics`. El módulo que esta
-- etapa construye vive detrás del claim `admin`, que hoy tiene una sola persona
-- --Isabella-- y que además tiene los tres de la lista. O sea que la pantalla lee
-- POR CASUALIDAD.
--
-- El día que alguien tenga `admin` solo, la tabla devuelve CERO FILAS con
-- `error: null`, que es lo que se ve cuando una policy no aplica, y la pantalla
-- diría «no hay márgenes» sin que nada falle. Por eso `admin` entra a la lista.
--
-- ============================================================================

begin;

-- ── 1. Leer: que `admin` también pueda ──────────────────────────────────────
--
-- Se recrea entera en vez de modificarla: una policy no se puede extender, y
-- dejar dos policies de SELECT sobre la misma tabla haría que la condición real
-- fuera el OR de las dos, que es más difícil de leer que esta línea.

drop policy if exists margin_select on margins.branch_margin;

create policy margin_select on margins.branch_margin
  for select to authenticated
  using (
    auth.jwt() -> 'app_metadata' -> 'allowed_apps'
      ?| array['homesi', 'outlook', 'analytics', 'admin']
  );

-- ── 2. Escribir: sólo INSERT, sólo `admin`, sólo `origen = 'app'` ───────────
--
-- ⚠ ESCRIBIR ES MÁS ANGOSTO QUE LEER, a propósito. Leer un margen lo necesitan
-- el P&L, Outlook y Analytics; decidir cuál es el margen es un acto de
-- administración, y la pantalla que lo ofrece vive detrás de `admin`. Si mañana
-- hiciera falta que otro rol edite, es agregar el claim a este array -- y en ese
-- momento alguien lo va a estar decidiendo, que es la diferencia.

grant insert on margins.branch_margin to authenticated;

create policy margin_insert_app on margins.branch_margin
  for insert to authenticated
  with check (
    auth.jwt() -> 'app_metadata' -> 'allowed_apps' ?| array['admin']

    -- Lo que distingue una fila de la app de una del archivo. Sin esto, el sync
    -- la pisa en su próxima corrida.
    and origen = 'app'

    -- Quién la escribió sale de la SESIÓN, nunca de un campo que mandó el
    -- cliente. Es la misma forma que `business_plan.*.updated_by` y que
    -- `org.employee_benchmark.set_by`.
    and changed_by = coalesce(auth.jwt() ->> 'email', '')
    and btrim(coalesce(changed_by, '')) <> ''

    -- Cuándo. La columna admite nulo y ninguna fila lo tiene; que la app no
    -- empiece.
    and changed_at is not null

    -- Por qué. Ver la nota de arriba: es una decisión, no una formalidad.
    and btrim(coalesce(reason, '')) <> ''

    -- ⚠ LA CLAVE NO PUEDE CONTRADECIR A SUS PARTES. `margin_key` es un texto
    -- compuesto, así que nada impide escribir `733|FHA|Branch|v3` en una fila
    -- cuyo `loan_type` diga `VA`: la PK sería única igual y la fila entraría.
    -- La vista agrupa por las COLUMNAS, así que esa fila se mostraría como VA y
    -- se llamaría FHA, y el choque con el próximo FHA real aparecería meses
    -- después como una violación de PK sin causa visible.
    and margin_key = branch_code || '|' || loan_type || '|' || tipo_de_margen || '|' || version

    -- Y lo mismo entre el texto de la versión y su número, que es lo que ordena.
    -- ⚠ Ordenar por `version` como texto pone v10 antes que v2; el único orden
    -- válido es `version_num`, y esto impide que los dos digan cosas distintas.
    and version = 'v' || version_num::text

    -- v1 es la carga inicial del archivo. Una versión escrita desde la app
    -- siempre viene después de algo.
    and version_num >= 2

    -- Enteros, y no negativos. Los 726 valores van de 0 a 725 sin un solo
    -- decimal; aceptar 449.5 sería dejar que el primero aparezca sin que nadie
    -- lo decida.
    and valor_bps is not null
    and valor_bps >= 0
    and valor_bps = round(valor_bps)

    -- Los tres niveles que existen. Un cuarto valor no haría fallar nada: se
    -- escribiría una fila que la tabla de la pantalla no tiene dónde poner, y
    -- quedaría invisible hasta que alguien la cuente.
    and tipo_de_margen in ('Branch', 'Division', 'Region')
  );

commit;


-- ============================================================================
-- CÓMO COMPROBARLO — EN OTRA SENTENCIA, DESPUÉS DEL COMMIT
-- ============================================================================
--
-- ⚠ Y NO CON UNA CLAVE ESCRITA A MANO. Un `insert` de prueba que no entra se
-- parece a uno que entró si nadie cuenta lo que tocó, y una clave inventada no
-- se distingue de una correcta hasta que se la cuenta. Las de abajo salen de la
-- tabla.
--
-- 1. Las dos policies están, y dicen lo que tienen que decir:
--
--      select polname, polcmd,
--             pg_get_expr(polqual, polrelid)      as using_expr,
--             pg_get_expr(polwithcheck, polrelid) as check_expr
--        from pg_policy
--       where polrelid = 'margins.branch_margin'::regclass
--       order by polname;
--
--    Esperado: `margin_insert_app` (cmd `a`, sólo `check_expr`) y
--    `margin_select` (cmd `r`, sólo `using_expr`, con `admin` adentro).
--
-- 2. Los permisos son los que se quieren, y los que NO se quieren no están:
--
--      select privilege_type
--        from information_schema.role_table_grants
--       where table_schema = 'margins' and table_name = 'branch_margin'
--         and grantee = 'authenticated'
--       order by 1;
--
--    Esperado exactamente dos filas: INSERT y SELECT. Si aparece UPDATE o
--    DELETE, el modelo append-only dejó de ser una propiedad de la base.
--
-- 3. Nada se movió con esto: sigue sin haber una sola fila de la app.
--
--      select origen, count(*) from margins.branch_margin group by 1;
--
--    Esperado: una sola fila, `archivo` con 726. Cuando ADM3 esté en pantalla y
--    alguien edite, acá va a aparecer `app` -- y ése es el número que enciende el
--    aviso de que BigQuery no tiene ese valor.
--
-- 4. Y el que no se puede correr desde el editor SQL, dicho para que no se
--    confunda con un paso que falta: el `with check` sólo se evalúa para
--    `authenticated`. Desde el editor se entra como `postgres`, que lo saltea.
--    Que la policy RECHACE lo que tiene que rechazar se comprueba desde la app,
--    con la sesión de una persona, y es parte de la verificación de la pantalla
--    --no de este archivo--.
