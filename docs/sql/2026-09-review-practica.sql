-- ============================================================================
-- RV24 — La sesión de práctica: se guarda, no cuenta, y se puede reiniciar
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
--
-- El equipo tiene que poder recorrer el modo coach entero --tres fases, ocho
-- pasos, el intake-- con datos reales y sin ensuciar el registro. Y poder
-- reiniciar, que hoy es imposible: `session`, `response` y `assignment` no
-- tienen policy de DELETE, decidido en RV1 porque el intake se conserva.
--
-- ── ⚠ LO QUE ESTE ARCHIVO NO HACE, Y ES LA MITAD DIFÍCIL ────────────────────
--
-- No impide que un paso escriba hacia afuera. Son TRES los que escriben --no
-- dos-- y ninguno de los tres se resuelve con una columna:
--
--   1.2  Benchmark   -> org.employee_benchmark      cambia el veredicto del perfil
--   2.2  Budget      -> outlook.budget_total        cambia el pronóstico del branch
--   3.1  Funnel      -> business_plan.enrollment    REEMPLAZA el plan activo
--
-- Eso lo resuelve el código, en una sola puerta --`lib/review/puertaDeEscritura.ts`--
-- que decide destino según `session.is_practice`. Acá sólo se crea el estado
-- del que esa puerta lee.
--
-- ⚠ Y NO se agrega `is_practice` a esas tres tablas, a propósito. Serían tres
-- lectores que tienen que acordarse del filtro, y el que se olvide mostraría un
-- número de práctica como real. Con la puerta, el que se olvide muestra el
-- REAL. Las dos opciones tienen el mismo olvido y fallan para lados opuestos.
--
-- ── ESTADO MEDIDO ANTES DE ESCRIBIR (2026-09-30) ────────────────────────────
--
--   sesiones in_progress      4, sobre 4 Loan Officers DISTINTOS
--                             (Luis Silva, Jose Zamora, Jose Arango, Lucio Romero)
--   revisores                 3  (Fernando Orduz x3, Ricardo Cera x1)
--   Mariano Claudio           employee_key 13, activo, 0 sesiones, 0 asignaciones
--
-- Importa para el índice del punto 3: las 4 filas de hoy quedan con
-- `is_practice = false`, y el índice nuevo es ESTRICTAMENTE MÁS DÉBIL que el
-- que reemplaza. Ninguna sesión en curso puede romperse con esta migración --
-- y eso no es una esperanza, es una propiedad del predicado.
--
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. LA MARCA, EN LA ASIGNACIÓN
-- ---------------------------------------------------------------------------
--
-- Va en la asignación y no sólo en la sesión porque es una propiedad de la
-- práctica, no de cada intento: reiniciar borra la sesión y CONSERVA la
-- asignación, así que la marca tiene que sobrevivir al reinicio.

alter table review.assignment
  add column if not exists is_practice boolean not null default false;

comment on column review.assignment.is_practice is
  'Asignacion de practica: su sesion se guarda y no cuenta, y se puede reiniciar. Ver RV24.';

/*
 * ⚠ ÍNDICE QUE PARECE REDUNDANTE Y NO LO ES -- igual que `assignment_lo_pin_uk`.
 *
 * `assignment_key` ya es la PK, así que esto no prohíbe nada nuevo: existe para
 * que la sesión pueda apuntarle con una FK COMPUESTA y su copia de la marca no
 * pueda divergir. Sin esto, `session.is_practice` sería una copia por
 * convención, y una copia por convención se separa el día que alguien edita una
 * de las dos.
 */
create unique index if not exists assignment_practice_pin_uk
  on review.assignment (assignment_key, is_practice);


-- ---------------------------------------------------------------------------
-- 2. LA MARCA, EN LA SESIÓN — HEREDADA, NO COPIADA
-- ---------------------------------------------------------------------------
--
-- ⚠ La sesión necesita su propia columna aunque la asignación ya la tenga, y no
-- es duplicación: el índice único parcial del punto 3 sólo puede usar columnas
-- de SU PROPIA tabla. Sin la columna acá, «una sola revisión REAL en curso»
-- no se puede expresar como índice, y habría que bajarlo a un trigger -- que es
-- exactamente lo que RV1 descartó, porque dos inserciones simultáneas leen cero
-- las dos y las dos insertan.

alter table review.session
  add column if not exists is_practice boolean not null default false;

comment on column review.session.is_practice is
  'Copia de assignment.is_practice, atada por FK compuesta: no puede divergir. Ver RV24.';

/*
 * La FK compuesta, que es lo que convierte la copia en herencia. Es el mismo
 * mecanismo que `session_lo_matches_assignment` usa para el Loan Officer:
 * escribir otra marca acá es una violación de integridad, no un dato
 * inconsistente que alguien tenga que notar después.
 */
alter table review.session
  drop constraint if exists session_practice_matches_assignment;
alter table review.session
  add constraint session_practice_matches_assignment
  foreign key (assignment_key, is_practice)
  references review.assignment (assignment_key, is_practice)
  on delete no action;


-- ---------------------------------------------------------------------------
-- 3. LOS DOS ÍNDICES DE «UNA SOLA EN CURSO»
-- ---------------------------------------------------------------------------
--
-- ⚠ UNA PRÁCTICA TIENE QUE PODER CONVIVIR CON UNA REVISIÓN REAL, y la decisión
-- se toma en las dos direcciones:
--
--   · si no pudiera, practicar sobre alguien BLOQUEARÍA su revisión real --
--     la práctica dañando el registro, que es justo lo que no puede pasar;
--   · y al revés, con una revisión real abierta nadie podría practicar sobre
--     esa persona.
--
-- Así que el índice de RV1 se reduce a las reales, y las prácticas reciben el
-- suyo. La regla de RV1 queda INTACTA para lo real: sigue siendo por Loan
-- Officer y no por asignación.

drop index if exists review.session_one_in_progress_idx;

create unique index if not exists session_one_in_progress_idx
  on review.session (lo_employee_key)
  where status = 'in_progress' and not is_practice;

/*
 * Y una práctica en curso por ASIGNACIÓN, no por Loan Officer: dos personas
 * pueden practicar sobre Mariano a la vez --cada una con su asignación-- y
 * ninguna puede tener dos abiertas sobre el mismo sujeto.
 *
 * Es por `assignment_key` y no por revisor porque el índice sólo puede usar
 * columnas de la sesión, y el revisor vive en la asignación. El efecto es el
 * mismo: una asignación de práctica es de un revisor sobre un Loan Officer.
 *
 * ⚠ Y es lo que hace que «reiniciar» sea determinista: sin este índice, dos
 * reinicios simultáneos dejarían dos sesiones de práctica abiertas y la
 * pantalla tendría que elegir una.
 */
create unique index if not exists session_one_practice_in_progress_idx
  on review.session (assignment_key)
  where status = 'in_progress' and is_practice;


-- ---------------------------------------------------------------------------
-- 4. EL REINICIO — `security definer`, y sólo el revisor de esa asignación
-- ---------------------------------------------------------------------------
--
-- El append-only de RV1 se mantiene intacto: no se agrega ninguna policy de
-- DELETE. Esta función es la ÚNICA vía, corre como su dueño, y no puede tocar
-- una sesión oficial ni por error.

create or replace function review.reiniciar_practica(p_session_key bigint)
returns table (respuestas_borradas bigint, sesiones_borradas bigint)
language plpgsql
security definer
/*
 * ⚠ `search_path` VACÍO Y NOMBRES CALIFICADOS. Un `security definer` sin esto
 * corre con el `search_path` de quien llama, así que `review.session` podría
 * resolver a otra tabla que el llamador controle. Es la diferencia entre una
 * función privilegiada y un agujero.
 */
set search_path = ''
as $$
declare
  v_email  text := auth.jwt() ->> 'email';
  v_es_practica boolean;
  v_revisor_ok  boolean;
  v_resp   bigint;
  v_ses    bigint;
begin
  if v_email is null then
    raise exception 'No hay sesion autenticada.' using errcode = 'P0001';
  end if;

  /*
   * ⚠ SE COMPRUEBA `is_practice` EN LA SESIÓN, NO POR JOIN CONTRA LA
   * ASIGNACIÓN. Con la FK compuesta del punto 2 esa columna no puede mentir; un
   * join sí se puede romper --una asignación reactivada, un `left join` que
   * devuelve null-- y entonces el guardia diría «no es práctica» sobre una que
   * sí lo es, o peor, al revés.
   */
  select s.is_practice,
         exists (
           select 1
             from review.assignment a
             join org.dim_employee d on d.employee_key = a.reviewer_employee_key
            where a.assignment_key = s.assignment_key
              and lower(d.email) = lower(v_email)
         )
    into v_es_practica, v_revisor_ok
    from review.session s
   where s.session_key = p_session_key;

  if v_es_practica is null then
    raise exception 'No existe la sesion %.', p_session_key using errcode = 'P0001';
  end if;

  if not v_es_practica then
    raise exception
      'La sesion % NO es de practica. Esta funcion no puede tocar el registro real.',
      p_session_key using errcode = 'P0001';
  end if;

  /*
   * Sólo el revisor de esa asignación. Sin esto, el reinicio de una persona
   * borra la práctica de otra -- y las dos son prácticas, así que ningún
   * guardia de `is_practice` lo detendría.
   */
  if not v_revisor_ok then
    raise exception
      'Solo el revisor de esta asignacion de practica puede reiniciarla.'
      using errcode = 'P0001';
  end if;

  delete from review.response r where r.session_key = p_session_key;
  get diagnostics v_resp = row_count;

  delete from review.session s where s.session_key = p_session_key;
  get diagnostics v_ses = row_count;

  /*
   * ⚠ LA ASIGNACIÓN NO SE BORRA. Reiniciar es una sesión nueva sobre la misma
   * asignación de práctica: conserva quién practica sobre quién, y es lo que
   * hace que la marca sobreviva al reinicio.
   */
  respuestas_borradas := v_resp;
  sesiones_borradas := v_ses;
  return next;
end;
$$;

comment on function review.reiniciar_practica(bigint) is
  'Borra UNA sesion de practica y sus respuestas. Falla si no es practica o si quien llama no es el revisor de esa asignacion. Unica via de borrado en review: no hay policy de DELETE. Ver RV24.';

revoke all on function review.reiniciar_practica(bigint) from public;
grant execute on function review.reiniciar_practica(bigint) to authenticated;

commit;


-- ============================================================================
-- CÓMO COMPROBARLO — EN OTRA SENTENCIA, DESPUÉS DEL COMMIT
-- ============================================================================
--
-- ⚠ Las comprobaciones NO van junto a los cambios en una sentencia con CTE: los
-- `select` de la misma sentencia ven el snapshot ANTERIOR. Ya costó una vez.
--
-- 1. Las 4 sesiones en curso de hoy siguen en curso y ninguna quedó marcada:
--
--      select count(*) filter (where status = 'in_progress')      as en_curso,
--             count(*) filter (where status = 'in_progress'
--                               and not is_practice)              as reales
--        from review.session;
--      -- las dos tienen que dar 4
--
-- 2. Los dos índices existen y son los que se espera:
--
--      select indexname, indexdef from pg_indexes
--       where schemaname = 'review' and indexname like 'session_one%';
--
--    ⚠ `pg_indexes` y no `pg_constraint`: un `create unique index` que no nace
--    de un constraint no aparece en el segundo. Ya se concluyó una vez que no
--    había unicidad mirando la tabla equivocada.
--
-- 3. Y la convivencia, que es la decisión de esta etapa. Mariano (13) no tiene
--    ninguna sesión, así que el caso hay que CONSTRUIRLO -- una real y una de
--    práctica sobre la misma persona, las dos en curso:
--
--      -- una asignación real y una de práctica, mismo Loan Officer
--      insert into review.assignment
--        (reviewer_employee_key, lo_employee_key, due_on, created_by, is_practice)
--      values (60, 13, current_date + 7, 'rv24-verificacion', false),
--             (60, 13, current_date + 7, 'rv24-verificacion', true)
--      returning assignment_key, is_practice;
--
--      -- y una sesión de cada una. Las dos tienen que entrar.
--      insert into review.session (assignment_key, lo_employee_key, is_practice,
--                                  current_phase, current_step_in_phase, started_by)
--      select assignment_key, 13, is_practice, 1, 1, 'rv24-verificacion'
--        from review.assignment where created_by = 'rv24-verificacion'
--      returning session_key, is_practice;
--
--    Si las dos entran, la convivencia funciona. Si la segunda REAL fallara con
--    `session_one_in_progress_idx`, la regla de RV1 sigue viva -- que es la
--    otra mitad y hay que comprobarla igual:
--
--      insert into review.session (assignment_key, lo_employee_key, is_practice,
--                                  current_phase, current_step_in_phase, started_by)
--      values (<la asignación real>, 13, false, 1, 1, 'rv24-verificacion');
--      -- tiene que fallar con 23505
--
-- 4. Y el guardia de la función, en sus TRES ramas. La tercera es la que
--    importa: sobre una sesión REAL tiene que negarse.
--
--      select * from review.reiniciar_practica(<la de práctica>);   -- borra
--      select * from review.reiniciar_practica(<la de práctica>);   -- ya no existe
--      select * from review.reiniciar_practica(65);                 -- REAL: se niega
--
--    ⚠ La tercera con una sesión real de verdad --la 65 es de Luis Silva-- y no
--    con una inventada. Una función que se negó sobre una clave inexistente no
--    demuestra que se niegue sobre una real: son dos ramas distintas del if.
--
-- 5. Limpieza de lo que dejó el punto 3, que no es trivial porque no hay policy
--    de DELETE: las sesiones de práctica salen por `reiniciar_practica`, y las
--    dos asignaciones y la sesión REAL sólo desde el editor de SQL.
--
--      delete from review.session    where started_by = 'rv24-verificacion' returning session_key;
--      delete from review.assignment where created_by = 'rv24-verificacion' returning assignment_key;
--
--    ⚠ Con `returning`, y el número en el reporte: el editor de SQL es la única
--    via que puede borrar de `review` y la unica que no deja rastro.
