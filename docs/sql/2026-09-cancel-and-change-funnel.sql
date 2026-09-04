-- ===========================================================================
-- BP40 — CANCELAR Y CAMBIAR UN FUNNEL, EN UNA SOLA TRANSACCIÓN
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor.
--
-- ⚠ APLICAR DESPUÉS de `2026-08-activate-funnel-rpc.sql`: `change_funnel` la
-- llama. Si `activate_funnel` no existe, esto falla al crearse, que es lo que
-- se quiere -- mejor que fallar al usarse.
--
--
-- ---------------------------------------------------------------------------
-- 1. EL PROBLEMA QUE RESUELVE
-- ---------------------------------------------------------------------------
--
-- Hasta acá no había forma de quitar un plan desde la interfaz. Las tres veces
-- que hizo falta se borró a mano por SQL, y una de esas veces dejó residuo que
-- rompió la pantalla: Ana Manjarres no podía abrir su plan porque tenía una
-- intervención `reviewed` vieja conviviendo con la nueva.
--
-- Es el mismo problema que ya resolvió `activate_funnel` en la otra dirección:
-- PostgREST no da transacciones ENTRE llamadas, así que un borrado repartido en
-- varias llamadas deja estado parcial en cuanto una falle. Un rollback manual
-- no alcanza -- si se corta la red o se cierra el navegador, no hay quien lo
-- deshaga.
--
--
-- ---------------------------------------------------------------------------
-- 2. QUÉ SE BORRA, Y QUÉ SE BORRA SOLO
-- ---------------------------------------------------------------------------
--
-- ⚠ LA MAYOR PARTE YA CASCADEA, y conviene saberlo antes de escribir cinco
-- DELETE que no hacen falta. Las FK del esquema ya dicen:
--
--   enrollment_node      -> enrollment            on delete cascade
--   enrollment_milestone -> enrollment_node       on delete cascade
--   enrollment_baseline  -> enrollment            on delete cascade
--   note                 -> enrollment_node       on delete cascade
--   note                 -> enrollment_milestone  on delete cascade
--
-- O sea que `delete from enrollment` se lleva los nodos, los steps, la línea
-- base y las notas. Son DOS borrados y no cinco:
--
--   1. el enrollment      (y su cascada)
--   2. la intervención    -- la única que sobrevive, porque su FK va a
--                            `org.dim_employee` y no a `enrollment`
--
--
-- ---------------------------------------------------------------------------
-- 3. ⚠ POR QUÉ `SECURITY DEFINER`, Y QUÉ HAY QUE CUIDAR
-- ---------------------------------------------------------------------------
--
-- Dos motivos, y el segundo es el que importa:
--
-- a) La transacción. Igual que `activate_funnel`.
--
-- b) LA CASCADA Y LA RLS NO SE LLEVAN BIEN, y hay una decisión escondida ahí.
--    `enrollment_milestone` tiene una policy que protege los completados:
--
--        for delete using (has_access() and status <> 'done')
--
--    Esa policy vale para un DELETE directo. Pero una cascada de FK la ejecuta
--    el sistema por cuenta del dueño de la tabla y NO evalúa la RLS de la tabla
--    hija, así que `delete from enrollment` se llevaría los `done` igual,
--    rodeando la protección sin que nada lo diga.
--
--    ⚠ NO SE VERIFICÓ CONTRA ESTA BASE, y no se pudo: para probarlo habría que
--    marcar un step como `done` y borrarlo, y si la cascada NO la rodea queda
--    una fila que no se puede borrar (la policy de DELETE la excluye) ni
--    devolver a `in_progress` (la de UPDATE también). Residuo imposible de
--    limpiar.
--
--    Esta función no depende de esa respuesta: borra los `done` de forma
--    EXPLÍCITA y los cuenta antes, así que hace lo mismo sea cual sea el
--    comportamiento de la cascada. Una decisión visible en el cuerpo de la
--    función en vez de una propiedad emergente de dos mecanismos.
--
-- ⚠ Y POR ESO LA FUNCIÓN COMPRUEBA EL ACCESO A MANO. `SECURITY DEFINER` se
-- saltea la RLS, así que sin este chequeo cualquiera con sesión podría cancelar
-- el plan de cualquiera. Es la misma guarda que tiene `activate_funnel`.
--
--
-- ---------------------------------------------------------------------------
-- 4. LA DECISIÓN DE NEGOCIO QUE ESTÁ ESCRITA ACÁ
-- ---------------------------------------------------------------------------
--
-- Cancelar BORRA, incluidos los steps completados. No archiva.
--
-- El motivo no es la simpleza: un enrolamiento `cancelled` con trabajo hecho
-- sigue apareciendo en cualquier consulta que no filtre por estado, y eso ya
-- pasó con las intervenciones huérfanas -- el defecto que impidió abrir un
-- plan. Es preferible perder el registro que arrastrar uno que confunde.
--
-- ⚠ LO QUE HACE QUE ESO SEA ACEPTABLE es que la pantalla lo diga ANTES, con el
-- número: "este plan tiene 5 steps completados, se van a borrar". No un
-- genérico "esto no se puede deshacer". Por eso la función DEVUELVE cuántos
-- borró: la interfaz cuenta antes para avisar, y el valor devuelto permite
-- comprobar después que contó bien.
--
-- Y quien quiera conservar el avance tiene `change_funnel`... no: `change_funnel`
-- también borra. Conservar el avance de un funnel al cambiar a otro no es
-- posible, porque los steps son COPIAS de otra plantilla y no hay
-- correspondencia entre unos y otros. La opción de conservar es no cambiar.
--
-- La intervención se borra entera, incluidas las `reviewed`. La historia de que
-- alguien fue revisado no vale lo que cuesta: una `reviewed` colgada hace que
-- el próximo enrolamiento de esa persona herede el mismo defecto. Si algún día
-- hace falta auditar quién revisó a quién, eso merece su propia tabla y no ser
-- residuo de otra.
--
--
-- ---------------------------------------------------------------------------
-- 5. QUÉ POLICIES HACEN FALTA
-- ---------------------------------------------------------------------------
--
-- ⚠ NINGUNA, para estas funciones: `SECURITY DEFINER` corre como dueño y no
-- evalúa RLS. Se listan igual porque el estado real no es el que uno supone:
--
--   enrollment, enrollment_node   `for all` -> DELETE ya permitido
--   enrollment_milestone          DELETE permitido salvo `status = 'done'`
--   intervention                  DELETE permitido salvo `status <> 'active'`
--                                 (o sea: las `reviewed` y `closed` NO se
--                                 pueden borrar desde la app)
--   enrollment_baseline           select + insert. SIN policy de DELETE
--   note                          select + insert. SIN policy de DELETE
--
-- Las dos últimas son las que faltarían si esto se hiciera desde el cliente. Y
-- la de `intervention` es la que haría fracasar en silencio el borrado de una
-- `reviewed`: RLS FILTRA, no rechaza -- devolvería `error: null` y cero filas
-- afectadas, indistinguible de "no había ninguna".
--
-- Ese silencio es exactamente lo que la función evita, porque adentro no hay
-- RLS que filtre.


-- ---------------------------------------------------------------------------
-- PASO 1 — cancelar
-- ---------------------------------------------------------------------------

create or replace function business_plan.cancel_funnel(p_enrollment_key bigint)
returns jsonb
language plpgsql
security definer
set search_path = business_plan, org, public
as $$
declare
  v_employee_key bigint;
  v_done         int;
  v_steps        int;
  v_nodes        int;
  v_notes        int;
  v_interv       int;
begin
  -- ⚠ La guarda de acceso, a mano: `SECURITY DEFINER` se saltea la RLS.
  if not business_plan.has_access() then
    raise exception 'no access to business_plan';
  end if;

  select employee_key into v_employee_key
  from business_plan.enrollment
  where enrollment_key = p_enrollment_key;

  if v_employee_key is null then
    raise exception 'enrollment % does not exist', p_enrollment_key;
  end if;

  -- Lo que se va a perder, contado ANTES de borrarlo. El `done` es el que la
  -- pantalla tiene que haber avisado.
  select count(*) filter (where em.status = 'done'), count(*)
    into v_done, v_steps
  from business_plan.enrollment_milestone em
  join business_plan.enrollment_node en using (enrollment_node_key)
  where en.enrollment_key = p_enrollment_key;

  select count(*) into v_nodes
  from business_plan.enrollment_node where enrollment_key = p_enrollment_key;

  select count(*) into v_notes
  from business_plan.note n
  where n.enrollment_node_key in (
          select enrollment_node_key from business_plan.enrollment_node
          where enrollment_key = p_enrollment_key)
     or n.enrollment_milestone_key in (
          select em.enrollment_milestone_key
          from business_plan.enrollment_milestone em
          join business_plan.enrollment_node en using (enrollment_node_key)
          where en.enrollment_key = p_enrollment_key);

  /*
   * ⚠ LOS `done` SE BORRAN EXPLÍCITAMENTE, ANTES de tocar el enrollment.
   *
   * No porque la cascada no fuera a llevárselos --probablemente sí, ver el
   * punto 3-- sino para que la decisión esté ESCRITA en vez de depender de si
   * una cascada de FK evalúa RLS. El día que alguien cambie ese detalle de
   * Postgres, o ponga `force row level security` en la tabla, esto sigue
   * haciendo lo mismo.
   */
  delete from business_plan.enrollment_milestone em
  using business_plan.enrollment_node en
  where em.enrollment_node_key = en.enrollment_node_key
    and en.enrollment_key = p_enrollment_key;

  -- Y el enrollment, que arrastra nodos, línea base y notas por FK.
  delete from business_plan.enrollment where enrollment_key = p_enrollment_key;

  -- La única que no cascadea: su FK va a `dim_employee`, no a `enrollment`.
  -- Se borran TODAS las de la persona, incluidas las `reviewed` viejas: una
  -- colgada es lo que impide abrir el plan siguiente.
  delete from business_plan.intervention where employee_key = v_employee_key;
  get diagnostics v_interv = row_count;

  return jsonb_build_object(
    'enrollment_key', p_enrollment_key,
    'employee_key',   v_employee_key,
    'steps_deleted',  v_steps,
    'done_deleted',   v_done,
    'nodes_deleted',  v_nodes,
    'notes_deleted',  v_notes,
    'interventions_deleted', v_interv
  );
end;
$$;

comment on function business_plan.cancel_funnel(bigint) is
  'Quita un plan entero en una sola transaccion: enrollment, nodos, steps (incluidos los done), linea base, notas e intervenciones. Devuelve cuanto borro. Ver BP40.';

grant execute on function business_plan.cancel_funnel(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- PASO 2 — cambiar
-- ---------------------------------------------------------------------------
--
-- ⚠ ES CANCELAR Y ACTIVAR, EN UNA SOLA TRANSACCIÓN, y por eso existe en vez de
-- que el cliente llame a las dos. Entre una llamada y la otra, PostgREST no
-- garantiza nada: si la activación falla, la persona se queda sin plan y sin
-- aviso -- que es peor que no haber cambiado nada.
--
-- ⚠ Y EL ORDEN IMPORTA: primero cancelar. `intervention` tiene un índice único
-- de una activa por persona, así que activar antes de cancelar chocaría contra
-- la que todavía existe.
--
-- ⚠ UNA INTERACCIÓN QUE NO ES OBVIA, y conviene tenerla escrita: esta función
-- es `SECURITY DEFINER` y llama a `activate_funnel`, que es `SECURITY INVOKER`.
-- La invocada corre con el usuario efectivo del momento, que adentro de una
-- definer es el DUEÑO de la función -- así que `activate_funnel` termina
-- corriendo con más permisos de los que tendría llamada desde el cliente.
--
-- Eso no abre un agujero, y el motivo es que `has_access()` lee el JWT
-- (`auth.jwt() -> app_metadata -> allowed_apps`) y NO el usuario de base. El
-- JWT no cambia al entrar en una definer, así que la guarda de arriba sigue
-- evaluando a la persona real. Si algún día `has_access()` pasara a mirar
-- `current_user`, esta llamada quedaría autorizándose sola: ese es el supuesto
-- del que depende, y por eso queda dicho acá.

create or replace function business_plan.change_funnel(
  p_enrollment_key bigint,
  p_employee_key   bigint,
  p_funnel_key     bigint,
  p_plan           jsonb,
  p_baseline       jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = business_plan, org, public
as $$
declare
  v_cancel jsonb;
  v_new    bigint;
begin
  if not business_plan.has_access() then
    raise exception 'no access to business_plan';
  end if;

  v_cancel := business_plan.cancel_funnel(p_enrollment_key);
  v_new := business_plan.activate_funnel(p_employee_key, p_funnel_key, p_plan, p_baseline);

  return jsonb_build_object('cancelled', v_cancel, 'enrollment_key', v_new);
end;
$$;

comment on function business_plan.change_funnel(bigint, bigint, bigint, jsonb, jsonb) is
  'Cambia de funnel en una sola transaccion: cancela el plan actual y activa el nuevo. Ver BP40.';

grant execute on function business_plan.change_funnel(bigint, bigint, bigint, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. CÓMO COMPROBARLO
-- ---------------------------------------------------------------------------
--
-- ⚠ La prueba que importa no es que borre, es que NO DEJE RESIDUO. Con los
-- conteos antes y después, sobre un enrolamiento de prueba:
--
--   -- 1. antes
--   select (select count(*) from business_plan.enrollment)            as enr,
--          (select count(*) from business_plan.enrollment_node)       as nodes,
--          (select count(*) from business_plan.enrollment_milestone)  as steps,
--          (select count(*) from business_plan.enrollment_baseline)   as base,
--          (select count(*) from business_plan.note)                  as notes,
--          (select count(*) from business_plan.intervention)          as iv;
--
--   -- 2. cancelar
--   select business_plan.cancel_funnel(<enrollment_key>);
--
--   -- 3. los mismos conteos. Cada uno tiene que bajar EXACTAMENTE lo que dijo
--   --    el jsonb devuelto en el paso 2, y `iv` tiene que bajar al menos 1.
--
-- ⚠ Y la comprobación que de verdad cierra el caso de Ana Manjarres:
--
--   select employee_key, status, count(*)
--   from business_plan.intervention group by 1, 2 having count(*) > 1;
--
-- Cero filas. Una persona con dos intervenciones es el defecto que esto viene a
-- evitar, y es lo que hay que mirar después de cada cancelación.
