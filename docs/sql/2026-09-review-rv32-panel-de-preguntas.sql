-- ============================================================================
-- RV32 · punto 2 — Escribir cualquier pregunta desde cualquier paso
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
--
-- En el paso 1 la persona habla de algo que corresponde al 6, y no hay dónde
-- anotarlo. El panel pasa a ofrecer las NUEVE: los ocho pasos del guion y
-- `Other`, para lo importante que no pertenece a ninguno.
--
-- ── ⚠ LO QUE NO SE CREA, Y ES LA DECISIÓN DE FONDO ──────────────────────────
--
-- NO hay tabla de borradores. El texto escrito por adelantado ES una fila de
-- `review.response`, igual que cualquier otra: la tabla ya es append-only, no
-- tiene índice único, y la vigente de un paso es la última por `answered_at`.
-- Escribir la del 2.1 estando parado en el 1.1 ya era representable.
--
-- Una tabla intermedia que después «se convierte en respuesta» serían dos
-- representaciones del mismo hecho, y este proyecto ya pagó esa.
--
-- El problema no era dónde guardarlo: era que **«tiene fila» significaba «el
-- paso está hecho»**. Eso es lo que se parte en tres:
--
--   tiene comentario   ->  hay texto para ese paso
--   `seen_on_site`     ->  además miró la pantalla que el paso señala
--   paso completado    ->  las dos
--
-- En palabras de Isabella, que es de donde sale la distinción:
--
--   > «Una cosa es el comentario y otra que sí revisé lo que queremos que vea
--   > en esa vista.»
--
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. LA CONFIRMACIÓN DE HABER MIRADO
-- ---------------------------------------------------------------------------
--
-- ⚠ POR QUÉ UNA COLUMNA Y NO UNA CLAVE EN `gate`, que era lo más barato.
--
-- `gate` es jsonb y la ausencia de una clave no distingue «no lo confirmó» de
-- «fila anterior a este cambio». Las respuestas que ya existen se escribieron
-- TODAS paradas en el paso --el panel de adelanto no existía-- así que leerlas
-- como no confirmadas haría que toda sesión pasada apareciera incompleta: una
-- afirmación falsa sobre el trabajo de Fernando, Ricardo e Isabella.
--
-- Es el valor que significa «no lo sé» indistinguible del que significa «no
-- hay», que este repo tiene contado nueve veces. Una columna con un backfill
-- explícito sí los distingue.
--
-- ⚠ Y TAMPOCO ES UN `gate_kind` NUEVO. `gate_kind` dice qué necesita ESE paso
-- además del comentario; esto lo necesitan los ocho. Volverlo un kind
-- obligaría a declararlo en cada paso y chocaría con `budget`, `funnel` y
-- `clicks`, que ya ocupan ese campo.

/*
 * ⚠ EL DEFAULT ES `true` AL CREARLA Y `false` DESPUÉS, y eso ES el backfill.
 *
 * La primera versión de este archivo creaba la columna en `false` y hacía un
 * `update ... set seen_on_site = true` aparte. Funciona una vez y es una
 * trampa: REAPLICADO --y estos archivos se reaplican-- ese update confirmaría
 * todas las respuestas que la app haya dejado sin confirmar. Un archivo cuya
 * segunda corrida hace algo distinto de la primera es peor que uno que falla.
 *
 * Con el default puesto al crear, el backfill es la creación misma: no hay
 * sentencia que repetir. `if not exists` salta la primera línea y la segunda es
 * idempotente.
 */
alter table review.response
  add column if not exists seen_on_site boolean not null default true;

alter table review.response
  alter column seen_on_site set default false;

comment on column review.response.seen_on_site is
  'La persona miro la pantalla que el paso señala, ademas de escribir el comentario. Un texto escrito por adelantado desde el panel de las nueve preguntas entra en false y pasa a true al llegar al paso. Ver RV32.';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ EL BACKFILL ES `true` -- QUE ES LO QUE HAY QUE LEER DENTRO DE UN MES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ NO ES UN DEFAULT CÓMODO: ES LO QUE PASÓ.
 *
 * Todas las respuestas anteriores a esta migración se escribieron con la
 * persona parada en el paso, porque no existía ninguna otra forma de
 * escribirlas -- el panel que permite adelantarse llega con esta etapa. Así que
 * `true` es el dato, no una suposición prudente.
 *
 * Dejarlas en `false` sonaría más conservador y sería FALSO: haría que siete
 * sesiones --cerradas o en curso-- aparezcan incompletas, y que el intake diga
 * que nadie miró nada. Sería afirmar algo falso sobre el trabajo de Fernando,
 * Ricardo e Isabella.
 *
 * Medido al escribir este archivo: 46 respuestas en 7 sesiones.
 */


-- ---------------------------------------------------------------------------
-- 2. `Other`: LA NOTA DE LA SESIÓN
-- ---------------------------------------------------------------------------
--
-- ⚠ POR QUÉ NO ES UN NOVENO PASO.
--
-- `review.response` tiene una FK contra `review.step`, y esa FK es lo que
-- permite contar «5 of 5» sin que la pantalla sepa cuántos pasos hay: se
-- cuentan las respuestas distintas de la fase contra los pasos de la fase. Un
-- `Other` necesitaría una fila falsa en `review.step` --que entraría en el
-- conteo y correría el porcentaje-- o una FK nullable, que es el mismo valor
-- ambiguo de arriba con otra cara.
--
-- Y conceptualmente es otra cosa: una nota de la SESIÓN, no de un paso. No
-- tiene pregunta contra la cual se contestó, así que tampoco tiene
-- `prompt_revision`.

create table if not exists review.note (
  note_key    bigint generated always as identity primary key,
  session_key bigint not null references review.session (session_key) on delete no action,

  /* Mismo criterio que `response.comment`: sin `default ''`, y con el check que
     impide la fila vacía. Una nota en blanco no es un estado valido. */
  body        text not null check (length(btrim(body)) > 0),

  created_at  timestamptz not null default now(),
  created_by  text not null
);

comment on table review.note is
  'Lo importante que no pertenece a ningun paso -- el `Other` del panel de las nueve preguntas. Append-only, de la SESION y no de un paso: por eso no tiene FK contra review.step ni prompt_revision. Ver RV32.';

create index if not exists note_session_idx on review.note (session_key, created_at);

alter table review.note enable row level security;

/*
 * Las mismas dos policies que `response`, y por las mismas razones:
 *
 *   · leer, todo el equipo con acceso -- es lo que hace que el intake pueda
 *     mostrar lo que se dijo de una persona (`2026-09-review-intake-lectura-de-equipo`);
 *   · escribir, sólo el revisor de la asignación y sólo con la sesión EN CURSO.
 *
 * Y sin UPDATE ni DELETE: append-only, igual que todo lo demás de `review`. No
 * es una convención de la app -- la base no tiene por dónde.
 */
create policy note_select on review.note
  for select to authenticated using (review.has_access());

create policy note_insert on review.note
  for insert to authenticated with check (
    created_by = coalesce(auth.jwt() ->> 'email', '')
    and exists (
      select 1 from review.session s
      where s.session_key = review.note.session_key
        and s.status = 'in_progress'
        and review.owns_session(s.assignment_key)
    )
  );

grant select, insert on review.note to authenticated;
grant usage, select on sequence review.note_note_key_seq to authenticated;

commit;


-- ============================================================================
-- CÓMO COMPROBARLO — EN OTRA SENTENCIA, DESPUÉS DEL COMMIT
-- ============================================================================
--
-- 1. El backfill dice lo que tiene que decir, y no queda ninguna en `false`:
--
--      select seen_on_site, count(*)
--        from review.response group by 1 order by 1;
--
--    Esperado: una sola fila, `true` con 46. Si aparece `false` con algo, el
--    backfill no corrió y las sesiones viejas van a verse incompletas.
--
-- 2. La nota existe, con su policy de lectura y la de escritura:
--
--      select policyname, cmd from pg_policies
--       where schemaname = 'review' and tablename = 'note' order by 1;
--
--    Esperado: `note_insert` (INSERT) y `note_select` (SELECT). Y NINGUNA de
--    UPDATE ni DELETE -- si aparecen, el append-only se rompió.
--
-- 3. Y el grant, que un `create table` NO hereda del esquema:
--
--      select privilege_type from information_schema.role_table_grants
--       where table_schema = 'review' and table_name = 'note'
--         and grantee = 'authenticated' order by 1;
--
--    Esperado: INSERT y SELECT. Sin esto la app recibe un `403 permission
--    denied for table note`, que NO es RLS -- `business_plan.area` quedó así y
--    rompió una pantalla que ni la menciona.
--
-- ⚠ Y `service_role` NO recibe nada acá: sigue sin `usage` sobre `review`,
-- decisión del 2026-09-09. Si algún día hace falta, se otorga con la razón
-- escrita en la migración que lo necesite.
