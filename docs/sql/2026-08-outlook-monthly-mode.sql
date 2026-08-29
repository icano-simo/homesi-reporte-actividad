-- ===========================================================================
-- OUTLOOK — MODO "MES A MES" (etapa OL4)
-- ===========================================================================
--
-- Agrega la segunda forma de fijar un presupuesto. Hasta ahora había una sola:
-- un benchmark y una regla de crecimiento, y los meses se calculaban. Ahora hay
-- dos, y se elige cuál rige:
--
--   MODO `growth`    benchmark + regla  ->  los meses se CALCULAN
--                    (outlook.strategy_benchmark + outlook.growth_rule)
--
--   MODO `monthly`   un número por mes  ->  los meses se ESCRIBEN
--                    (outlook.monthly_target, tabla nueva)
--
-- Ejecutar como `postgres` en el SQL Editor de Supabase (proyecto simoOS-prod).
-- Idempotente: se puede correr entero de nuevo sin duplicar nada.
--
-- ⚠ ACÁ NO HAY PASO MANUAL. El esquema `outlook` ya está en "Exposed schemas"
-- desde la etapa OL1 --ver la cabecera de `2026-08-outlook-schema.sql`, que
-- documenta ese paso y el 406 que costó descubrirlo-- y una tabla nueva dentro
-- de un schema ya expuesto se sirve sola. No hay que volver a tocar Settings.
--
--
-- ---------------------------------------------------------------------------
-- LAS TRES DECISIONES DE ESTA ETAPA
-- ---------------------------------------------------------------------------
--
-- 1. **Los meses fijados se versionan por REVISIÓN, igual que las reglas.**
--    Fijar septiembre a diciembre es UNA decisión de cuatro números, no cuatro
--    decisiones. Se lee completa o no se lee: si alguien guarda tres meses y
--    después otro guarda uno solo, "lo vigente" tiene que ser una de las dos
--    listas enteras, nunca una mezcla.
--
--    Cada edición inserta la lista NUEVA y COMPLETA con `revision = max + 1`, y
--    el lector toma la revisión más alta. Las anteriores quedan enteras.
--    Es el mismo mecanismo de `outlook.growth_rule` y por el mismo motivo.
--
-- 2. **`monthly_target` SÍ admite 'Own Production'**, a diferencia de
--    `strategy_benchmark`.
--
--    No es una inconsistencia: lo que aquella tabla no puede guardar es el
--    BENCHMARK de Own Production, porque ese ya vive en `org.employee_benchmark`
--    y tener dos sería tener dos verdades. Un número fijado para octubre no es
--    un benchmark -- no es la base de ningún cálculo, es el resultado. No hay
--    nada que duplicar, así que no hay nada que prohibir.
--
-- 3. **EL MODO ES UNA DECISIÓN, ASÍ QUE SE GUARDA COMO TAL** -- con autor, fecha
--    y su propia tabla.
--
--    La alternativa era deducirlo: "manda lo último que se guardó". Sale gratis
--    y es peor. Deducido, el modo cambia como EFECTO de otra acción: alguien
--    ajusta la regla de crecimiento de una estrategia que estaba fijada mes a
--    mes --para dejarla lista, sin querer activarla-- y la proyección cambia
--    sin que nadie haya decidido cambiarla. Y no habría a quién preguntarle,
--    porque no quedaría registro de una decisión que nunca se tomó.
--
--    Explícito, la pregunta "¿por qué esta estrategia proyecta 8 en octubre?"
--    se contesta con un SELECT: el modo, quién lo eligió y cuándo.
--
--    ⚠ Y de ahí sale la regla de precedencia, que la app muestra en pantalla:
--
--        EL MODO ACTIVO MANDA. LO DEL OTRO MODO QUEDA GUARDADO Y NO SE APLICA.
--
--    Cambiar de modo no borra nada: la regla sigue ahí y los meses fijados
--    también. Volver al modo anterior lo reactiva tal como estaba. Es lo que
--    hace que probar "¿y si lo fijo a mano?" no cueste perder la regla.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — los meses fijados a mano
-- ---------------------------------------------------------------------------
create table if not exists outlook.monthly_target (
  monthly_target_key bigint generated always as identity primary key,
  employee_key bigint not null references org.dim_employee (employee_key),

  /* Las cinco. Ver la decisión 2 de la cabecera: acá 'Own Production' entra. */
  strategy text not null
    check (strategy in ('Own Production', 'B2B', 'NPPM', 'Recruitment', 'Affinity')),

  /* La revisión agrupa los meses guardados JUNTOS -- decisión 1. */
  revision int not null check (revision >= 1),

  /* Primer día del mes al que se le fija el número. */
  target_month date not null check (date_trunc('month', target_month) = target_month),

  /*
   * Cuántos préstamos se espera cerrar ese mes. Admite decimales por simetría
   * con el benchmark, aunque en la práctica sean enteros: quien fija 2,5 está
   * diciendo "uno cada dos semanas" y no hay motivo para impedírselo.
   */
  target numeric(10, 2) not null check (target >= 0),

  set_by text not null,
  note text,
  created_at timestamptz not null default now(),

  unique (employee_key, strategy, revision, target_month)
);

comment on table outlook.monthly_target is
  'Append-only, versionado por revision. El presupuesto ESCRITO mes a mes, alternativa a benchmark + regla. Rige sólo si outlook.projection_mode dice monthly.';

create index if not exists monthly_target_lookup_idx
  on outlook.monthly_target (employee_key, strategy, revision desc, target_month);


-- ---------------------------------------------------------------------------
-- PASO 2 — cuál de los dos modos rige
-- ---------------------------------------------------------------------------
create table if not exists outlook.projection_mode (
  projection_mode_key bigint generated always as identity primary key,
  employee_key bigint not null references org.dim_employee (employee_key),
  strategy text not null
    check (strategy in ('Own Production', 'B2B', 'NPPM', 'Recruitment', 'Affinity')),

  mode text not null check (mode in ('growth', 'monthly')),

  set_by text not null,
  note text,
  created_at timestamptz not null default now()
);

comment on table outlook.projection_mode is
  'Append-only. Qué modo rige para (persona, estrategia). Sin fila = growth, que es lo que existía antes. Vale la fila de projection_mode_key más alto.';

/*
 * ⚠ El lector toma la fila de `projection_mode_key` MÁS ALTO, no la de
 * `created_at` más reciente.
 *
 * Es la misma precaución que ya está escrita en la cabecera de
 * `2026-08-outlook-schema.sql` para las revisiones: dos inserts en el mismo
 * milisegundo hacen ambiguo el "más reciente" por fecha. La identidad es
 * monótona y no empata nunca.
 *
 * Acá no se usa `revision` porque no hay nada que agrupar: el modo es UN valor,
 * no una lista que deba leerse entera.
 */
create index if not exists projection_mode_lookup_idx
  on outlook.projection_mode (employee_key, strategy, projection_mode_key desc);


-- ---------------------------------------------------------------------------
-- PASO 3 — RLS: lectura y escritura sólo con el claim `outlook`
-- ---------------------------------------------------------------------------
-- ⚠ SIN políticas de UPDATE ni DELETE, igual que las tres tablas de OL1. Eso es
-- lo que hace append-only al modelo: no es una convención que la app pueda
-- saltarse, es que la base no tiene por dónde. Verificado en OL2 sobre las
-- tablas existentes: 3 políticas de SELECT, 3 de INSERT, cero de UPDATE/DELETE.
alter table outlook.monthly_target enable row level security;
alter table outlook.projection_mode enable row level security;

grant select, insert on outlook.monthly_target to authenticated;
grant select, insert on outlook.projection_mode to authenticated;
grant usage on all sequences in schema outlook to authenticated;

create policy monthly_target_select on outlook.monthly_target
  for select to authenticated using (outlook.has_access());
create policy monthly_target_insert on outlook.monthly_target
  for insert to authenticated with check (outlook.has_access());

create policy projection_mode_select on outlook.projection_mode
  for select to authenticated using (outlook.has_access());
create policy projection_mode_insert on outlook.projection_mode
  for insert to authenticated with check (outlook.has_access());


-- ---------------------------------------------------------------------------
-- PASO 4 — no hay siembra, y es a propósito
-- ---------------------------------------------------------------------------
-- La ausencia de fila en `projection_mode` significa `growth`, que es
-- exactamente cómo se comportaba el módulo antes de esta etapa. Sembrar 185
-- filas diciendo "growth" no agregaría información: diría que alguien eligió
-- algo que nadie eligió.
--
-- Consecuencia buscada: el día que aparezca una fila en esta tabla, es porque
-- una persona decidió cambiar el modo. Todas las filas son decisiones reales.


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Las dos tablas, con RLS y SIN update/delete. La última columna debe dar 0:
--
--      select c.relname, c.relrowsecurity,
--             count(*) filter (where p.cmd in ('UPDATE','DELETE')) as pol_update_delete
--        from pg_class c
--        join pg_namespace n on n.oid = c.relnamespace
--        left join pg_policies p on p.schemaname = 'outlook' and p.tablename = c.relname
--       where n.nspname = 'outlook' and c.relkind = 'r'
--       group by 1, 2;
--
--    Esperado: cinco tablas, todas con relrowsecurity = true y 0 en la última.
--
-- 2. El día 1 se exige. Esto DEBE fallar con 23514:
--
--      insert into outlook.monthly_target
--        (employee_key, strategy, revision, target_month, target, set_by)
--      values (30, 'B2B', 1, '2026-10-15', 3, 'prueba');
--
-- 3. Un modo inválido también. Esto DEBE fallar con 23514:
--
--      insert into outlook.projection_mode (employee_key, strategy, mode, set_by)
--      values (30, 'B2B', 'manual', 'prueba');
--
-- 4. El modo vigente de cada par, como lo lee la app:
--
--      select distinct on (employee_key, strategy)
--             employee_key, strategy, mode, set_by, created_at
--        from outlook.projection_mode
--       order by employee_key, strategy, projection_mode_key desc;
--
-- 5. Los meses vigentes de un par (la revisión más alta, entera):
--
--      select target_month, target, revision, set_by
--        from outlook.monthly_target
--       where employee_key = 30 and strategy = 'B2B'
--         and revision = (select max(revision) from outlook.monthly_target
--                          where employee_key = 30 and strategy = 'B2B')
--       order by target_month;
--
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   drop table outlook.monthly_target;
--   drop table outlook.projection_mode;
--
-- Sin fila de modo, todo vuelve a `growth` y el módulo se comporta como en OL3.
-- No toca ninguna de las tres tablas de OL1.
-- ===========================================================================
