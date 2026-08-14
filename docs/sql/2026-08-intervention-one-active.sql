-- ===========================================================================
-- BP32 — UN REGISTRO ACTIVO POR PERSONA EN `intervention`
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor.
--
--
-- ---------------------------------------------------------------------------
-- 1. QUÉ ESTADO PERMITE HOY LA BASE
-- ---------------------------------------------------------------------------
--
-- `business_plan.enrollment` tiene desde BP12 un índice único parcial que
-- garantiza UN plan activo por persona:
--
--     create unique index enrollment_one_active_idx
--       on business_plan.enrollment (employee_key) where status = 'active';
--
-- `business_plan.intervention` no tiene nada equivalente: sólo su clave
-- primaria sustituta. Así que la base acepta sin quejarse:
--
--   · varias intervenciones `active` para la misma persona;
--   · una intervención `active` sin ningún enrolamiento detrás.
--
-- Y el segundo caso NO requiere que falle nada. `intervention` no tiene FK
-- contra `enrollment` -- referencia a `dim_employee` y a `funnel`, no al plan --
-- así que **borrar un enrolamiento nunca se lleva su intervención**. Cada vez
-- que se borró un plan a mano durante las pruebas quedó una intervención
-- activa flotando, y con ella una persona marcada como atendida sin plan.
--
-- El efecto visible es el que se reportó: la app vuelve a ofrecer "Choose a
-- funnel", y al intentarlo choca contra `enrollment_one_active_idx`.
--
--
-- ---------------------------------------------------------------------------
-- 2. POR QUÉ UN ÍNDICE Y NO UNA FK A `enrollment`
-- ---------------------------------------------------------------------------
--
-- La tentación es agregarle a `intervention` una FK contra `enrollment` para
-- que la cascada la limpie sola. No se hace, y el motivo está en el diseño de
-- BP5: el estado `reviewed` -- "alguien lo miró, todavía sin funnel elegido" --
-- EXISTE SIN ENROLAMIENTO, y es justamente el que alimenta el "Revisado" del
-- Status del branch. Una FK obligatoria lo volvería imposible; una nullable no
-- garantizaría nada.
--
-- El índice parcial sí resuelve el problema real: impide el estado ambiguo (dos
-- activas para la misma persona) sin tocar el caso legítimo.
--
-- Lo que el índice NO puede impedir es la intervención activa huérfana: eso es
-- una regla entre dos tablas, y la garantiza la función de activación de
-- `2026-08-activate-funnel-rpc.sql`, que las escribe a las dos o a ninguna.
--
--
-- ---------------------------------------------------------------------------
-- 3. TODO: PARA EL REVISOR
-- ---------------------------------------------------------------------------
--
-- `business_plan` ya está expuesto en PostgREST desde BP6. Esta migración NO
-- necesita tocar `pgrst.db_schemas` ni ningún `alter role`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — dejar una sola activa por persona antes de crear el índice
-- ---------------------------------------------------------------------------
--
-- Si hubiera duplicados, `create unique index` fallaría y la migración quedaría
-- a medias. Se cierran las viejas en vez de borrarlas: una intervención es un
-- registro de que alguien miró a esa persona, y eso pasó de verdad.
--
-- Sobrevive la MÁS RECIENTE por persona. Hoy la tabla está vacía, así que esto
-- no toca nada; está por si se aplica más tarde, sobre datos ya acumulados.

update business_plan.intervention i
   set status = 'closed'
 where i.status = 'active'
   and exists (
     select 1
       from business_plan.intervention j
      where j.employee_key = i.employee_key
        and j.status = 'active'
        and (j.created_at, j.id) > (i.created_at, i.id)
   );


-- ---------------------------------------------------------------------------
-- PASO 2 — el índice
-- ---------------------------------------------------------------------------
--
-- Mismo patrón, mismo nombre y misma forma que `enrollment_one_active_idx`, a
-- propósito: dos reglas iguales que se escriben igual son dos reglas que se
-- leen igual.
--
-- Parcial sobre `status = 'active'`: las cerradas se pueden acumular sin
-- límite, que es lo que las vuelve un historial.

create unique index if not exists intervention_one_active_idx
  on business_plan.intervention (employee_key) where status = 'active';


-- ---------------------------------------------------------------------------
-- PASO 3 — la policy de DELETE que falta
-- ---------------------------------------------------------------------------
--
-- ⚠ COMPROBADO CONTRA LA BASE: hoy un DELETE sobre `intervention` devuelve 403
-- y la fila queda. La tabla tiene policies de select, insert y update desde
-- BP5, pero ninguna de delete, y el grant tampoco la incluye.
--
-- La consecuencia es la que importa: el rollback de la activación NO PUEDE
-- borrar la intervención que acaba de escribir. Por eso las huérfanas hubo que
-- limpiarlas a mano desde el editor de SQL.
--
-- Se agrega, y la excepción está justificada: una intervención escrita por una
-- activación que falló no es un registro histórico de nada -- no ocurrió. Es
-- distinto de `enrollment_milestone`, donde el `done` sí es un hecho y por eso
-- la policy lo protege.
--
-- Sólo `active`: las `reviewed` y las `closed` no se borran nunca. Una revisión
-- que pasó, pasó, y cerrar un ciclo también es un hecho. Lo único que se puede
-- deshacer es una activación que no llegó a existir.

drop policy if exists intervention_delete on business_plan.intervention;
create policy intervention_delete on business_plan.intervention
  for delete to authenticated
  using (business_plan.has_access() and status = 'active');

grant delete on business_plan.intervention to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 4 — reponer las dos intervenciones que faltan
-- ---------------------------------------------------------------------------
--
-- Los enrolamientos 24 (Adriana Espinoza) y 26 (Adriana Gonzalez) están
-- completos -- 6 nodos, 16 stages y línea base `captured` -- pero se quedaron
-- sin intervención, así que el Status de sus branches no los cuenta como
-- atendidos y aparecen como pendientes de revisar.
--
-- Se reponen DESDE el enrolamiento, no con valores escritos a mano: la fecha y
-- el autor salen de la fila que sí existe, que es la única fuente que sabe
-- cuándo y quién activó. Inventar un `now()` diría que se los atendió hoy.
--
-- El `where not exists` lo hace idempotente y además compatible con el índice
-- del paso 2: si alguien ya repuso la fila, esto no inserta una segunda.
--
-- ⚠ Además de esas dos, hay una fila `closed` para Armando Tejeda (id 12) que
-- dejó una prueba de este mismo arreglo: se comprobó contra la base que el
-- DELETE devuelve 403, y lo único que la sesión de la app pudo hacer fue
-- cerrarla. No molesta -- `closed` no cuenta como atendido y no bloquea nada --
-- pero es residuo de una prueba y conviene borrarla al aplicar esto:
--
--   delete from business_plan.intervention where id = 12;

insert into business_plan.intervention (employee_key, status, funnel_key, activated_at, activated_by)
select e.employee_key, 'active', e.funnel_key, e.activated_at, e.activated_by
  from business_plan.enrollment e
 where e.status = 'active'
   and not exists (
     select 1
       from business_plan.intervention i
      where i.employee_key = e.employee_key
        and i.status = 'active'
   );


-- ---------------------------------------------------------------------------
-- COMPROBACIÓN — debería devolver cero filas
-- ---------------------------------------------------------------------------
--
-- Planes activos sin intervención, e intervenciones activas sin plan. Las dos
-- direcciones, porque son dos defectos distintos: la primera deja gente
-- atendida que figura como pendiente, la segunda deja gente sin plan que figura
-- como atendida y no puede volver a elegir funnel.
--
--   select 'plan sin intervencion' as problema, e.employee_key
--     from business_plan.enrollment e
--    where e.status = 'active'
--      and not exists (select 1 from business_plan.intervention i
--                       where i.employee_key = e.employee_key and i.status = 'active')
--   union all
--   select 'intervencion sin plan', i.employee_key
--     from business_plan.intervention i
--    where i.status = 'active'
--      and not exists (select 1 from business_plan.enrollment e
--                       where e.employee_key = i.employee_key and e.status = 'active');
