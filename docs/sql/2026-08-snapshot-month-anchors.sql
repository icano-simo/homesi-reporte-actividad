-- ===========================================================================
-- ANCLAJES DE MES, CALENDARIO HÁBIL Y RETENCIÓN DEL DÍA 15 — etapa S2
-- ===========================================================================
--
-- Reemplaza a `maintenance.run_pipeline_snapshot_retention()`
-- (docs/sql/2026-08-retention-pg-cron.sql). No conviven: ver "POR QUÉ
-- REEMPLAZA Y NO CONVIVE" más abajo -- dejarlas a las dos programadas
-- destruiría los anclajes nuevos.
--
-- Ejecutar como `postgres` en el SQL Editor de Supabase (proyecto simoOS-prod).
-- Idempotente: se puede correr entero de nuevo sin duplicar nada.
--
-- No toca ninguna pantalla. Verificado: la app no lee `is_month_start` ni
-- `is_month_end` en ningún archivo (la única mención es un comentario de
-- `app/api/pipeline/adverse-history/route.ts`, que no consulta las columnas).
--
--
-- ---------------------------------------------------------------------------
-- QUÉ ESTABA MAL
-- ---------------------------------------------------------------------------
-- `is_month_start` / `is_month_end` significaban `min(id)` / `max(id)` del mes:
-- "el primer y el último snapshot que tenemos", no el del primer y el último
-- día hábil. Medido en la base hoy: el snapshot marcado como inicio de julio es
-- el id 6, del **30 de julio** -- el penúltimo día del mes.
--
-- Y había un error más silencioso: el marcado sólo ponía flags en `true`, nunca
-- los quitaba. Los ids 9 y 11 tienen `data_as_of` del 30 de julio pero se
-- subieron el 3 de agosto; cualquier carga atrasada así cambia quién es el
-- primer snapshot de un mes, y con un marcado que sólo agrega el flag se queda
-- pegado en el anterior para siempre. Esta versión **recalcula desde cero** en
-- cada corrida (ver "IDEMPOTENCIA Y PUNTO FIJO").
--
--
-- ---------------------------------------------------------------------------
-- LA FECHA QUE MANDA ES `data_as_of`, EN `America/Chicago`
-- ---------------------------------------------------------------------------
-- `data_as_of` = cuándo Salesforce generó el export. `uploaded_at` = cuándo
-- alguien lo subió. Difieren, y a veces por días: los ids 9 y 11 tienen datos
-- del 30 de julio y se cargaron el 3 de agosto (4 días de atraso). Usar
-- `uploaded_at` los pondría en agosto.
--
-- Y siempre convertido a Chicago, nunca UTC. No es una precaución teórica: el
-- snapshot **activo hoy** (id 71) tiene `data_as_of` = 2026-08-23 20:05 CST,
-- que en UTC es 2026-08-24 01:05. En UTC ese snapshot cae en otro día. Con 52
-- filas ya hay una que se mueve; en un cierre de mes esa fila sería el
-- `month_close`.
--
--
-- ---------------------------------------------------------------------------
-- EL DESEMPATE, QUE NO ES OPCIONAL
-- ---------------------------------------------------------------------------
-- "Primero y último del día se deciden por `data_as_of`" no alcanza: dentro de
-- un mismo día hay `data_as_of` REPETIDOS, porque el mismo export se sube más
-- de una vez. Medido:
--
--     2026-07-30 10:51 -> ids 6, 9, 11
--     2026-08-03 10:55 -> ids 8, 10, 12
--     2026-08-18 11:19 -> ids 38, 39, 40
--     2026-08-18 17:19 -> ids 43, 44, 45, 46, 52
--     2026-08-19 11:01 -> ids 53, 54
--
-- Sin desempate, "el primero del día" es no determinista y el anclaje puede
-- moverse entre corridas sin que cambie ningún dato. El orden es
-- **`(data_as_of, id)`**: `id` interviene sólo cuando `data_as_of` empata, y
-- entonces gana la carga más reciente de ese mismo export (la que corrigió a
-- la anterior). Está declarado una sola vez, en los `row_number()` de
-- `maintenance.pipeline_snapshot_anchor_targets()`.
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ TRES BOOLEANOS Y NO UNA COLUMNA `anchor_type`
-- ---------------------------------------------------------------------------
-- Porque **un snapshot puede ser dos anclajes a la vez**, y un enum no puede
-- representarlo: si el primer día hábil del mes tuvo una sola carga, ese
-- snapshot es `month_open` Y `first_day_close` simultáneamente. No es un caso
-- de laboratorio -- de los 18 días con datos hoy, 3 tienen exactamente un
-- snapshot (2026-07-31, 2026-08-05, 2026-08-23); cualquiera de ellos cayendo
-- en un primer día hábil produce la coincidencia. En el límite, un mes con una
-- sola carga tiene los tres anclajes en la misma fila.
--
-- Con `anchor_type` habría que inventar valores compuestos
-- ('month_open+first_day_close', y el triple) o admitir varias filas por
-- anclaje -- las dos salidas son peores que tener booleanos independientes.
--
-- Además: los booleanos preservan la forma que ya tenía la tabla
-- (`is_month_start`/`is_month_end` eran booleanos), así que las lecturas de S3
-- se escriben igual que las de hoy, y agregar un cuarto anclaje mañana es una
-- columna más y no una migración de valores.
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ REEMPLAZA Y NO CONVIVE
-- ---------------------------------------------------------------------------
-- La función vieja borra todo lo que tenga más de 90 días y no esté marcado con
-- `is_month_start`/`is_month_end`. Los anclajes nuevos usan columnas nuevas,
-- que la vieja no conoce. Si las dos quedaran programadas, el **29 de octubre**
-- --cuando los snapshots del 30 de julio cumplan 90 días-- el job viejo
-- borraría los tres anclajes de julio, porque para él son filas viejas sin
-- marcar.
--
-- No es un riesgo hipotético con fecha lejana: es la consecuencia mecánica de
-- dos jobs con criterios distintos escribiendo sobre la misma tabla. Por eso el
-- PASO 7 desprograma `pipeline-forecast-retention` y borra su función. El
-- archivo viejo queda versionado en el repo, así que revertir es volver a
-- correrlo.
--
-- Las columnas `is_month_start` / `is_month_end` **no se borran** en esta
-- migración, a propósito: son el único registro de lo que el job viejo marcó, y
-- dejarlas cuesta cero. Quedan congeladas -- nadie las escribe más. El `drop`
-- está escrito al final, para correr recién cuando los anclajes nuevos lleven
-- un mes andando.
--
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCIA Y PUNTO FIJO
-- ---------------------------------------------------------------------------
-- El marcado no agrega flags: **asigna el estado completo** de las 6 columnas
-- en cada corrida, así que un anclaje que dejó de corresponder se apaga. Eso lo
-- vuelve auto-sanable frente a cargas atrasadas y a snapshots borrados a mano.
--
-- La pregunta que eso abre: después de una purga sólo sobreviven 3 filas por
-- mes -- ¿el recálculo sobre esas 3 devuelve las mismas 3? Sí, y por
-- construcción:
--
--   * `month_open` = mínimo de su día. Sobrevivió, y los que se borraron eran
--     todos posteriores dentro del mismo día -> sigue siendo el mínimo.
--   * `first_day_close` = máximo de ese mismo día. Ídem por el otro lado.
--   * `month_close` = máximo del último día con snapshots. Ningún día posterior
--     conserva filas, porque los anclajes están sólo en esos dos días.
--
-- El conjunto de anclajes es un **punto fijo** del recálculo. Sin esa
-- propiedad, cada purga desplazaría los anclajes del mes anterior y la serie
-- histórica se volvería inconsistente sola. La verificación 5 del final lo
-- comprueba.
--
--
-- ---------------------------------------------------------------------------
-- MARCAR ANTES DE BORRAR — ahora estructural, no por orden de sentencias
-- ---------------------------------------------------------------------------
-- La función vieja lo garantizaba poniendo el `update` antes del `delete`. Acá
-- el conjunto a borrar se calcula **desde la misma función que define los
-- anclajes** (`pipeline_snapshot_anchor_targets`), no desde las columnas
-- guardadas. Un snapshot que recién se convirtió en anclaje está protegido
-- aunque el marcado no se haya escrito todavía -- que es exactamente lo que
-- pasa en un `p_dry_run`, donde no se escribe nada.
--
-- Efecto secundario buscado: el dry run es **exacto**, no una aproximación.
-- Mira el mismo conjunto que miraría la corrida real.
--
--
-- ---------------------------------------------------------------------------
-- LAS TRES SALVAGUARDAS DEL BORRADO
-- ---------------------------------------------------------------------------
--   1. **El snapshot activo nunca se borra**, tenga la edad que tenga. Misma
--      salvaguarda que `run_activity_batch_retention` y por el mismo motivo, y
--      con un antecedente concreto en este proyecto: en la etapa S1 se borró el
--      snapshot activo de producción y hubo que recuperarlo reactivando otro.
--      La condición es `coalesce(is_active, true) = false`: un NULL se trata
--      como activo. Un snapshot cuyo estado no se puede afirmar no se borra.
--
--   2. **Un snapshot sin `data_as_of` nunca se borra.** No se lo puede ubicar
--      en ningún día, así que no puede ser anclaje de nada, y con la regla
--      "borrá lo que no sea anclaje" se perdería en silencio. Queda afuera por
--      construcción: la función de anclajes no lo devuelve, y el borrado es un
--      `join` contra ella. Hoy no hay ninguno (52 de 52 tienen `data_as_of`
--      desde S1), pero la columna sigue siendo `nullable`.
--
--   3. **`= false` estricto** en los tres anclajes, no `is not true`: si
--      alguna vez se levanta el `not null` de esas columnas, un NULL protege la
--      fila en vez de exponerla. Es el mismo criterio de la función vieja.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 — verificar los supuestos ANTES de aplicar
-- ---------------------------------------------------------------------------
-- Los tres deben dar lo que dice el comentario. Si no, parar.
--
-- a) las 6 columnas nuevas no existen todavía; las 2 viejas sí (da 2):
--
--      select count(*) from information_schema.columns
--       where table_schema='pipeline_forecast' and table_name='pipeline_snapshots'
--         and column_name in ('is_month_start','is_month_end','is_month_open',
--                             'is_first_day_close','is_month_close','is_day_close',
--                             'anchor_fallback','anchor_note');
--
-- b) los permisos son a nivel TABLA, no por columna -- si fueran por columna,
--    las columnas nuevas nacerían ilegibles para `authenticated` y S3 no las
--    vería. Debe dar 0:
--
--      select count(*) from pg_attribute a
--       where a.attrelid = 'pipeline_forecast.pipeline_snapshots'::regclass
--         and a.attacl is not null;
--
-- c) los hijos de un snapshot son exactamente 2 (da 2 filas):
--
--      select tc.table_name, rc.delete_rule
--        from information_schema.table_constraints tc
--        join information_schema.referential_constraints rc using (constraint_name)
--        join information_schema.constraint_column_usage ccu using (constraint_name)
--       where tc.constraint_type='FOREIGN KEY' and tc.table_schema='pipeline_forecast'
--         and ccu.table_name='pipeline_snapshots';


-- ---------------------------------------------------------------------------
-- PASO 1 — las columnas de anclaje
-- ---------------------------------------------------------------------------
-- `not null default false` y no `nullable`: "no es anclaje" y "no sabemos si es
-- anclaje" no son estados distintos acá, y un NULL sólo abriría la puerta a la
-- confusión de tres valores que ya costó caro en `is_month_start`.
alter table pipeline_forecast.pipeline_snapshots
  add column if not exists is_month_open      boolean not null default false,
  add column if not exists is_first_day_close boolean not null default false,
  add column if not exists is_month_close     boolean not null default false,
  add column if not exists is_day_close       boolean not null default false,

  -- El anclaje NO cayó en el día hábil real; se usó el día con snapshots más
  -- cercano. Un flag y no sólo un texto: hay que poder filtrar los meses cuyo
  -- cierre es aproximado sin parsear prosa.
  add column if not exists anchor_fallback    boolean not null default false,

  -- Por qué se desvió, en castellano y con las dos fechas. NULL cuando el
  -- anclaje cayó donde correspondía.
  --
  -- Un flag por fila alcanza aunque la fila tenga dos anclajes: los anclajes de
  -- una misma fila están siempre en el mismo día, así que comparten el motivo.
  -- El texto sí distingue apertura de cierre, y los concatena si aplican los dos.
  add column if not exists anchor_note        text;

comment on column pipeline_forecast.pipeline_snapshots.is_month_open is
  'S2: primer snapshot del primer día hábil del mes (data_as_of en America/Chicago).';
comment on column pipeline_forecast.pipeline_snapshots.is_first_day_close is
  'S2: último snapshot de ese mismo primer día hábil. Puede ser la misma fila que is_month_open.';
comment on column pipeline_forecast.pipeline_snapshots.is_month_close is
  'S2: último snapshot del último día hábil del mes. Nunca se marca en el mes en curso.';
comment on column pipeline_forecast.pipeline_snapshots.is_day_close is
  'S2: último snapshot de su día. Informativo -- NO protege del borrado.';
comment on column pipeline_forecast.pipeline_snapshots.anchor_fallback is
  'S2: el anclaje no cayó en el día hábil real. Ver anchor_note.';
comment on column pipeline_forecast.pipeline_snapshots.is_month_start is
  'OBSOLETA (S2). Era min(id) del mes, no el primer día hábil. Congelada: nadie la escribe. Reemplazada por is_month_open / is_first_day_close.';
comment on column pipeline_forecast.pipeline_snapshots.is_month_end is
  'OBSOLETA (S2). Era max(id) del mes. Congelada: nadie la escribe. Reemplazada por is_month_close.';

-- ¿Índices? No, todavía no. La tabla tiene 52 filas: cualquier consulta de
-- anclajes la recorre entera en microsegundos, y un índice parcial sólo agrega
-- costo de escritura en cada carga. Cuando S3 exista y haya un plan real que
-- mirar, se agrega el que ese plan pida.
--
-- Lo que NO se puede hacer, y conviene que quede escrito: un índice único
-- parcial que garantice "un solo month_open por mes". La clave sería el mes
-- derivado de `data_as_of at time zone 'America/Chicago'`, y esa conversión es
-- STABLE, no IMMUTABLE -- Postgres no la indexa. La invariante se comprueba con
-- la verificación 3 del final en vez de imponerse con un índice.


-- ---------------------------------------------------------------------------
-- PASO 2 — el calendario
-- ---------------------------------------------------------------------------
create schema if not exists maintenance;
revoke all on schema maintenance from public, anon, authenticated;

-- Tabla y no reglas en código: los prestamistas cierran días que no son
-- feriado federal (Viernes Santo es el caso típico) y hay cierres propios de la
-- empresa. Con tabla, agregar uno es un INSERT que corre el revisor; con reglas
-- compiladas es un deploy.
create table if not exists maintenance.us_holidays (
  holiday_date date primary key,
  name         text not null,
  source       text not null
);

revoke all on table maintenance.us_holidays from public, anon, authenticated;

comment on table maintenance.us_holidays is
  'Días no hábiles. Un día hábil es lunes-viernes que no esté acá. Se guarda la fecha OBSERVADA, no la nominal.';

-- ⚠ Se guarda la fecha **observada**, no la nominal. Si el feriado cae sábado o
-- domingo, ese día ya es no hábil por ser fin de semana: la fila que sirve es
-- la del día que la oficina realmente cierra. Guardar 2026-07-04 (sábado) no
-- cambiaría ningún cálculo; guardar 2026-07-03 (viernes) sí.
--
-- Los 3 corrimientos de este período están anotados en el nombre.
--
-- Viernes Santo NO se observa -- confirmado con el negocio. Cuando eso cambie:
--   insert into maintenance.us_holidays values ('2027-03-26','Good Friday','empresa');
insert into maintenance.us_holidays (holiday_date, name, source) values
  ('2026-01-01', 'New Year''s Day',                                 'opm-federal-2026'),
  ('2026-01-19', 'Birthday of Martin Luther King, Jr.',             'opm-federal-2026'),
  ('2026-02-16', 'Washington''s Birthday',                          'opm-federal-2026'),
  ('2026-05-25', 'Memorial Day',                                    'opm-federal-2026'),
  ('2026-06-19', 'Juneteenth National Independence Day',            'opm-federal-2026'),
  ('2026-07-03', 'Independence Day (observado: el 4 cae sábado)',    'opm-federal-2026'),
  ('2026-09-07', 'Labor Day',                                       'opm-federal-2026'),
  ('2026-10-12', 'Columbus Day',                                    'opm-federal-2026'),
  ('2026-11-11', 'Veterans Day',                                    'opm-federal-2026'),
  ('2026-11-26', 'Thanksgiving Day',                                'opm-federal-2026'),
  ('2026-12-25', 'Christmas Day',                                   'opm-federal-2026'),
  ('2027-01-01', 'New Year''s Day',                                 'opm-federal-2027'),
  ('2027-01-18', 'Birthday of Martin Luther King, Jr.',             'opm-federal-2027'),
  ('2027-02-15', 'Washington''s Birthday',                          'opm-federal-2027'),
  ('2027-05-31', 'Memorial Day',                                    'opm-federal-2027'),
  ('2027-06-18', 'Juneteenth (observado: el 19 cae sábado)',         'opm-federal-2027'),
  ('2027-07-05', 'Independence Day (observado: el 4 cae domingo)',   'opm-federal-2027'),
  ('2027-09-06', 'Labor Day',                                       'opm-federal-2027'),
  ('2027-10-11', 'Columbus Day',                                    'opm-federal-2027'),
  ('2027-11-11', 'Veterans Day',                                    'opm-federal-2027'),
  ('2027-11-25', 'Thanksgiving Day',                                'opm-federal-2027'),
  ('2027-12-24', 'Christmas Day (observado: el 25 cae sábado)',      'opm-federal-2027')
on conflict (holiday_date) do nothing;


-- ---------------------------------------------------------------------------
-- PASO 3 — qué es un día hábil
-- ---------------------------------------------------------------------------
-- `isodow`: lunes=1 ... viernes=5, sábado=6, domingo=7. `< 6` = lunes a viernes.
-- `extract(dow)` NO sirve acá: ahí domingo=0, y `< 6` lo dejaría entrar.
create or replace function maintenance.is_business_day(p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select extract(isodow from p_day) < 6
     and not exists (
       select 1 from maintenance.us_holidays h where h.holiday_date = p_day
     );
$function$;

-- Recorrer el mes día por día y quedarse con el mínimo/máximo hábil. Son 31
-- iteraciones sobre una tabla de 22 filas por año: no vale la pena nada más
-- astuto, y así se lee de un tirón.
--
-- Nunca devuelven NULL: no existe un mes calendario sin ningún día hábil.
create or replace function maintenance.first_business_day(p_month_start date)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select min(d)::date
    from generate_series(
           date_trunc('month', p_month_start)::date,
           (date_trunc('month', p_month_start) + interval '1 month - 1 day')::date,
           interval '1 day') d
   where maintenance.is_business_day(d::date);
$function$;

create or replace function maintenance.last_business_day(p_month_start date)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select max(d)::date
    from generate_series(
           date_trunc('month', p_month_start)::date,
           (date_trunc('month', p_month_start) + interval '1 month - 1 day')::date,
           interval '1 day') d
   where maintenance.is_business_day(d::date);
$function$;


-- ---------------------------------------------------------------------------
-- PASO 4 — LA REGLA, en un solo lugar
-- ---------------------------------------------------------------------------
-- Devuelve, para cada snapshot ubicable, qué anclajes le corresponden. No
-- escribe nada.
--
-- Está separada del job a propósito, por tres razones:
--
--   1. El job la usa DOS veces --para marcar y para decidir el borrado-- y la
--      regla tiene que ser literalmente la misma en los dos usos. Duplicarla
--      en dos CTE que se van separando con el tiempo es el error que este
--      proyecto ya arrastró con el filtro del mes del Business Plan.
--   2. Hace que el dry run sea exacto: mira el mismo conjunto que la corrida
--      real, sin haber escrito una fila.
--   3. Es inspeccionable sola. El revisor puede correr
--      `select * from maintenance.pipeline_snapshot_anchor_targets();`
--      y ver los anclajes ANTES de aplicar nada.
create or replace function maintenance.pipeline_snapshot_anchor_targets()
returns table (
  id                 bigint,
  month_key          text,
  cst_day            date,
  is_month_open      boolean,
  is_first_day_close boolean,
  is_month_close     boolean,
  is_day_close       boolean,
  anchor_fallback    boolean,
  anchor_note        text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with placed as (
    -- ⚠ `data_as_of`, no `uploaded_at`, y en Chicago, no UTC. Los dos motivos
    -- están en la cabecera, con los datos que los respaldan.
    --
    -- Los snapshots sin `data_as_of` quedan afuera de todo el cálculo. Esa
    -- exclusión ES la salvaguarda 2: el borrado hace `join` contra esta
    -- función, así que lo que no sale acá no se borra nunca.
    select s.id,
           s.data_as_of,
           (s.data_as_of at time zone 'America/Chicago')::date as cst_day
      from pipeline_forecast.pipeline_snapshots s
     where s.data_as_of is not null
  ),
  ranked as (
    -- El desempate `(data_as_of, id)`, declarado UNA vez. Con `data_as_of`
    -- repetido dentro del día --que pasa seguido, ver cabecera-- `id` decide,
    -- y gana la carga más reciente del mismo export.
    select p.id,
           p.cst_day,
           date_trunc('month', p.cst_day)::date as month_start,
           row_number() over (partition by p.cst_day order by p.data_as_of asc,  p.id asc)  as rn_first,
           row_number() over (partition by p.cst_day order by p.data_as_of desc, p.id desc) as rn_last
      from placed p
  ),
  cal as (
    select distinct
           r.month_start,
           maintenance.first_business_day(r.month_start) as fbd,
           maintenance.last_business_day(r.month_start)  as lbd
      from ranked r
  ),
  day_used as (
    select c.month_start, c.fbd, c.lbd,

           -- Apertura: el primer día hábil si tiene snapshots; si no, el primer
           -- día CON snapshots hacia adelante.
           --
           -- El `coalesce` de afuera cubre un mes cuyos únicos snapshots están
           -- ANTES del primer día hábil (un sábado 1, con el hábil el lunes 3).
           -- Sin él ese mes no tendría anclaje de apertura y sus snapshots se
           -- purgarían enteros. Ahí se usa el más temprano que haya, y queda
           -- marcado como fallback igual.
           coalesce(
             min(r.cst_day) filter (where r.cst_day >= c.fbd),
             min(r.cst_day)
           ) as open_day,

           -- Cierre: el último día hábil, o el último día CON snapshots hacia
           -- atrás. `null` en el mes en curso -- todavía puede recibir cargas,
           -- así que no tiene cierre.
           case when c.month_start < date_trunc('month', (now() at time zone 'America/Chicago')::date)::date
                then coalesce(
                       max(r.cst_day) filter (where r.cst_day <= c.lbd),
                       max(r.cst_day)
                     )
           end as close_day
      from cal c
      join ranked r on r.month_start = c.month_start
     group by c.month_start, c.fbd, c.lbd
  ),
  computed as (
    select r.id,
           to_char(r.month_start, 'YYYY-MM') as month_key,
           r.cst_day,
           coalesce(r.cst_day = d.open_day  and r.rn_first = 1, false) as is_month_open,
           coalesce(r.cst_day = d.open_day  and r.rn_last  = 1, false) as is_first_day_close,
           coalesce(r.cst_day = d.close_day and r.rn_last  = 1, false) as is_month_close,

           -- El cierre diario se marca TODOS los días, incluido el de hoy y los
           -- del mes en curso. El de hoy puede quedar obsoleto si entra otra
           -- carga más tarde; la corrida siguiente lo corrige, porque el
           -- marcado reasigna el estado completo en vez de agregar flags.
           (r.rn_last = 1) as is_day_close,

           d.open_day, d.close_day, d.fbd, d.lbd
      from ranked r
      join day_used d on d.month_start = r.month_start
  )
  -- Se devuelven TODAS las filas ubicables, no sólo los anclajes: el marcado
  -- necesita apagar los flags de las que dejaron de serlo.
  select c.id,
         c.month_key,
         c.cst_day,
         c.is_month_open,
         c.is_first_day_close,
         c.is_month_close,
         c.is_day_close,

         -- ⚠ El anclaje no cayó en el día hábil real. Explícito, nunca silencioso.
         ((c.is_month_open or c.is_first_day_close) and c.open_day  <> c.fbd)
      or ( c.is_month_close                        and c.close_day <> c.lbd) as anchor_fallback,

         nullif(concat_ws(' | ',
           case when (c.is_month_open or c.is_first_day_close) and c.open_day <> c.fbd
                then format(
                  'apertura: el primer día hábil (%s) no tiene snapshots; se usó %s (%s días después)',
                  c.fbd, c.open_day, c.open_day - c.fbd)
           end,
           case when c.is_month_close and c.close_day <> c.lbd
                then format(
                  'cierre: el último día hábil (%s) no tiene snapshots; se usó %s (%s días antes)',
                  c.lbd, c.close_day, c.lbd - c.close_day)
           end
         ), '') as anchor_note
    from computed c;
$function$;


-- ---------------------------------------------------------------------------
-- PASO 5 — el job
-- ---------------------------------------------------------------------------
-- Todos los días: marca anclajes y cierres diarios.
-- El día `p_purge_day` (15 por defecto): además purga.
--
-- `p_dry_run` no escribe NADA -- ni marcas ni borrados -- y aun así reporta
-- exactamente lo que haría, porque el conjunto sale de
-- `pipeline_snapshot_anchor_targets()` y no de las columnas guardadas.
--
-- Para simular la purga fuera del día 15, pasarle el día de hoy:
--   select maintenance.run_pipeline_snapshot_anchors(
--            p_dry_run   => true,
--            p_purge_day => extract(day from (now() at time zone 'America/Chicago')::date)::int);
create or replace function maintenance.run_pipeline_snapshot_anchors(
  p_dry_run   boolean default false,
  p_purge_day integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_nota_sin_fecha constant text :=
    'sin data_as_of: no se puede ubicar en ningún día. No se ancla y no se purga.';
  v_today        date;
  v_month_start  date;
  v_marked       int  := 0;
  v_unplaceable  int  := 0;
  v_should_purge boolean;
  v_ids          bigint[];
  v_del_loans    int  := 0;
  v_del_resolved int  := 0;
  v_del_snaps    int  := 0;
  v_day_closes   int  := 0;
  v_anchors      jsonb;
begin
  v_today        := (now() at time zone 'America/Chicago')::date;
  v_month_start  := date_trunc('month', v_today)::date;
  v_should_purge := extract(day from v_today)::int = p_purge_day;

  -- ── 1. Marcar ─────────────────────────────────────────────────────────────
  -- Asigna el estado COMPLETO de las 6 columnas. El `is distinct from` sobre la
  -- tupla entera hace que sólo se escriban las filas que realmente cambian, así
  -- el contador dice algo: en régimen debería ser 1 o 2 por día (el cierre
  -- diario que se corre), no 52.
  if not p_dry_run then
    update pipeline_forecast.pipeline_snapshots s
       set is_month_open      = t.is_month_open,
           is_first_day_close = t.is_first_day_close,
           is_month_close     = t.is_month_close,
           is_day_close       = t.is_day_close,
           anchor_fallback    = t.anchor_fallback,
           anchor_note        = t.anchor_note
      from maintenance.pipeline_snapshot_anchor_targets() t
     where s.id = t.id
       and (s.is_month_open, s.is_first_day_close, s.is_month_close,
            s.is_day_close, s.anchor_fallback, s.anchor_note)
           is distinct from
           (t.is_month_open, t.is_first_day_close, t.is_month_close,
            t.is_day_close, t.anchor_fallback, t.anchor_note);
    get diagnostics v_marked = row_count;

    -- Los snapshots sin `data_as_of` no salen de la función de anclajes, así
    -- que el update de arriba no los toca. Se los limpia acá y se los deja
    -- dichos: nunca son anclaje y nunca se purgan.
    update pipeline_forecast.pipeline_snapshots s
       set is_month_open      = false,
           is_first_day_close = false,
           is_month_close     = false,
           is_day_close       = false,
           anchor_fallback    = false,
           anchor_note        = v_nota_sin_fecha
     where s.data_as_of is null
       and (s.is_month_open or s.is_first_day_close or s.is_month_close
            or s.is_day_close or s.anchor_fallback
            or s.anchor_note is distinct from v_nota_sin_fecha);
  else
    -- En dry run se cuenta lo que cambiaría, sin escribirlo.
    select count(*) into v_marked
      from pipeline_forecast.pipeline_snapshots s
      join maintenance.pipeline_snapshot_anchor_targets() t on t.id = s.id
     where (s.is_month_open, s.is_first_day_close, s.is_month_close,
            s.is_day_close, s.anchor_fallback, s.anchor_note)
           is distinct from
           (t.is_month_open, t.is_first_day_close, t.is_month_close,
            t.is_day_close, t.anchor_fallback, t.anchor_note);
  end if;

  select count(*) into v_unplaceable
    from pipeline_forecast.pipeline_snapshots s
   where s.data_as_of is null;

  select count(*) into v_day_closes
    from maintenance.pipeline_snapshot_anchor_targets() t
   where t.is_day_close;

  -- Resumen por mes, para que el log del cron se pueda leer sin consultar nada.
  -- `max(id) filter` funciona como "el único": hay a lo sumo una fila por
  -- anclaje y por mes (verificación 3), así que el agregado evita una
  -- subconsulta por columna sin cambiar el resultado.
  --
  -- Las notas van con `string_agg distinct` y no `max`: la apertura y el cierre
  -- de un mes pueden caer en filas distintas y tener cada una su motivo. Con
  -- `max` se vería sólo uno de los dos y el otro quedaría escondido justo en el
  -- resumen que alguien lee para enterarse de que hubo un fallback.
  select jsonb_agg(g.x order by g.x->>'monthKey')
    into v_anchors
    from (
      select jsonb_build_object(
               'monthKey',      t.month_key,
               'monthOpen',     max(t.id) filter (where t.is_month_open),
               'firstDayClose', max(t.id) filter (where t.is_first_day_close),
               'monthClose',    max(t.id) filter (where t.is_month_close),
               'fallback',      bool_or(t.anchor_fallback),
               'notes',         string_agg(distinct t.anchor_note, ' / ')
             ) as x
        from maintenance.pipeline_snapshot_anchor_targets() t
       where t.is_month_open or t.is_first_day_close or t.is_month_close
       group by t.month_key
    ) g;

  -- ── 2. Purgar ─────────────────────────────────────────────────────────────
  if v_should_purge then
    -- "Todo mes ANTERIOR AL ACTUAL", no "el mes pasado": si el job no corre un
    -- día 15, el siguiente limpia el atraso solo. Es lo que hace la regla
    -- auto-sanable en vez de dependiente de que ninguna corrida se saltee.
    --
    -- El `join` contra la función de anclajes es lo que hace estructural el
    -- "marcar antes de borrar", y de paso excluye los snapshots sin
    -- `data_as_of` (salvaguarda 2).
    select array_agg(s.id)
      into v_ids
      from pipeline_forecast.pipeline_snapshots s
      join maintenance.pipeline_snapshot_anchor_targets() t on t.id = s.id
     where t.cst_day < v_month_start
       and t.is_month_open      = false
       and t.is_first_day_close = false
       and t.is_month_close     = false
       -- El activo nunca, tenga la edad que tenga. NULL se trata como activo.
       and coalesce(s.is_active, true) = false;

    if v_ids is not null then
      v_del_snaps := array_length(v_ids, 1);

      select count(*) into v_del_loans
        from pipeline_forecast.pipeline_loans where snapshot_id = any(v_ids);
      select count(*) into v_del_resolved
        from pipeline_forecast.pipeline_resolved_loans where snapshot_id = any(v_ids);

      if not p_dry_run then
        -- Las dos FK son ON DELETE CASCADE (confirmado en el esquema, a
        -- diferencia de lo que suponía la función vieja). Se borran igual a
        -- mano y en orden: así los contadores del reporte son exactos y no
        -- dependen de que nadie afloje la FK más adelante.
        delete from pipeline_forecast.pipeline_loans          where snapshot_id = any(v_ids);
        delete from pipeline_forecast.pipeline_resolved_loans where snapshot_id = any(v_ids);
        delete from pipeline_forecast.pipeline_snapshots      where id          = any(v_ids);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'today',               v_today,
    'zone',                'America/Chicago',
    'dryRun',              p_dry_run,
    'purgeDay',            p_purge_day,
    'purged',              v_should_purge,
    'rowsMarked',          v_marked,
    'dayCloses',           v_day_closes,
    'unplaceable',         v_unplaceable,
    'anchors',             coalesce(v_anchors, '[]'::jsonb),
    'deletedSnapshots',    v_del_snaps,
    'deletedLoanRows',     v_del_loans,
    'deletedResolvedRows', v_del_resolved,
    'deletedIds',          coalesce(to_jsonb(v_ids), '[]'::jsonb)
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- PASO 6 — permisos
-- ---------------------------------------------------------------------------
-- Postgres otorga EXECUTE a PUBLIC por defecto en toda función nueva. Sin estos
-- revokes, la única barrera sería que `maintenance` no esté en "Exposed
-- schemas" -- y eso es un checkbox que alguien puede tocar. Defensa en
-- profundidad, igual que en la función vieja.
revoke all on function maintenance.is_business_day(date)              from public, anon, authenticated;
revoke all on function maintenance.first_business_day(date)           from public, anon, authenticated;
revoke all on function maintenance.last_business_day(date)            from public, anon, authenticated;
revoke all on function maintenance.pipeline_snapshot_anchor_targets()  from public, anon, authenticated;
revoke all on function maintenance.run_pipeline_snapshot_anchors(boolean, integer)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- PASO 7 — el cron: sacar el viejo, poner el nuevo
-- ---------------------------------------------------------------------------
-- ⚠ EL ORDEN IMPORTA. Primero desprogramar, después borrar la función: al
-- revés, el cron queda apuntando a una función que no existe y falla todas las
-- noches hasta que alguien mire `cron.job_run_details`.
create extension if not exists pg_cron with schema cron;

select cron.unschedule('pipeline-forecast-retention')
where exists (select 1 from cron.job where jobname = 'pipeline-forecast-retention');

-- Recién ahora. El motivo está en "POR QUÉ REEMPLAZA Y NO CONVIVE": esta
-- función borra por 90 días mirando las columnas viejas, así que el 29 de
-- octubre se llevaría los anclajes de julio.
drop function if exists maintenance.run_pipeline_snapshot_retention();

select cron.unschedule('pipeline-snapshot-anchors')
where exists (select 1 from cron.job where jobname = 'pipeline-snapshot-anchors');

-- '0 9 * * *' = 09:00 UTC, el mismo horario que tenía el job viejo. pg_cron en
-- Supabase corre en UTC.
--
-- 09:00 UTC son 04:00 en Chicago (CDT) -- antes de la primera carga del día,
-- así que el cierre diario que marca es el del día anterior, ya completo. Es la
-- ventana correcta para esta tarea y por eso se mantiene.
--
-- No hay un cron aparte para la purga: el propio job decide si es día 15. Un
-- segundo job mensual serían dos cosas que pueden desincronizarse, y la purga
-- necesita que el marcado de HOY ya esté hecho.
select cron.schedule(
  'pipeline-snapshot-anchors',
  '0 9 * * *',
  $cron$ select maintenance.run_pipeline_snapshot_anchors(); $cron$
);


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Ver los anclajes SIN escribir nada. Es seguro incluso antes del primer
--    marcado: la función no escribe.
--
--      select month_key, cst_day, id, is_month_open, is_first_day_close,
--             is_month_close, anchor_fallback, anchor_note
--        from maintenance.pipeline_snapshot_anchor_targets()
--       where is_month_open or is_first_day_close or is_month_close
--       order by month_key, cst_day, id;
--
-- 2. Simular la corrida completa, incluida la purga, sin tocar nada:
--
--      select jsonb_pretty(maintenance.run_pipeline_snapshot_anchors(
--        p_dry_run   => true,
--        p_purge_day => extract(day from (now() at time zone 'America/Chicago')::date)::int));
--
-- 3. La invariante que no se puede imponer con un índice único (ver PASO 1):
--    a lo sumo un anclaje de cada tipo por mes. Debe devolver 0 filas.
--
--      select month_key
--        from maintenance.pipeline_snapshot_anchor_targets()
--       group by month_key
--      having count(*) filter (where is_month_open)      > 1
--          or count(*) filter (where is_first_day_close) > 1
--          or count(*) filter (where is_month_close)     > 1;
--
-- 4. El mes en curso no tiene cierre de mes. Debe devolver 0 filas.
--
--      select id, cst_day from maintenance.pipeline_snapshot_anchor_targets()
--       where is_month_close
--         and cst_day >= date_trunc('month', (now() at time zone 'America/Chicago')::date);
--
-- 5. PUNTO FIJO: correr el marcado dos veces seguidas. La segunda tiene que
--    devolver `rowsMarked: 0`. Si no, la regla no es idempotente y los anclajes
--    se van a mover solos en cada corrida.
--
--      select maintenance.run_pipeline_snapshot_anchors() -> 'rowsMarked';
--      select maintenance.run_pipeline_snapshot_anchors() -> 'rowsMarked';  -- 0
--
-- 6. El calendario quedó bien sembrado: 22 filas y ninguna en fin de semana
--    (se guardan las fechas observadas, no las nominales).
--
--      select count(*) as feriados,
--             count(*) filter (where extract(isodow from holiday_date) >= 6) as en_fin_de_semana
--        from maintenance.us_holidays;
--
-- 7. Ninguna función quedó expuesta como RPC. Debe devolver 0 filas.
--
--      select p.proname
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'maintenance'
--         and n.nspname = any (string_to_array(current_setting('pgrst.db_schemas', true), ','));
--
-- 8. El job viejo se fue y el nuevo está (1 fila, 'pipeline-snapshot-anchors'):
--
--      select jobname, schedule, active from cron.job
--       where jobname in ('pipeline-forecast-retention', 'pipeline-snapshot-anchors');
--
--
-- ===========================================================================
-- MÁS ADELANTE — no ahora
-- ===========================================================================
-- Cuando los anclajes nuevos lleven un mes andando y S3 esté leyendo de ellos,
-- las columnas viejas se pueden ir. Están congeladas desde esta migración, así
-- que borrarlas no cambia ningún comportamiento -- sólo saca dos columnas que
-- ya nadie escribe ni lee:
--
--   alter table pipeline_forecast.pipeline_snapshots
--     drop column is_month_start,
--     drop column is_month_end;
--
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   select cron.unschedule('pipeline-snapshot-anchors');
--   drop function if exists maintenance.run_pipeline_snapshot_anchors(boolean, integer);
--   drop function if exists maintenance.pipeline_snapshot_anchor_targets();
--   drop function if exists maintenance.last_business_day(date);
--   drop function if exists maintenance.first_business_day(date);
--   drop function if exists maintenance.is_business_day(date);
--   drop table    if exists maintenance.us_holidays;
--   alter table pipeline_forecast.pipeline_snapshots
--     drop column if exists is_month_open,
--     drop column if exists is_first_day_close,
--     drop column if exists is_month_close,
--     drop column if exists is_day_close,
--     drop column if exists anchor_fallback,
--     drop column if exists anchor_note;
--
--   -- Y volver a correr docs/sql/2026-08-retention-pg-cron.sql, que recrea la
--   -- función vieja y su cron. Las columnas is_month_start / is_month_end
--   -- nunca se borraron, así que sus marcas siguen ahí y el job viejo retoma
--   -- donde estaba.
--
-- ⚠ Lo que NO se puede revertir: los snapshots que la purga haya borrado. Por
--    eso la primera corrida va con `p_dry_run => true`.
-- ===========================================================================
