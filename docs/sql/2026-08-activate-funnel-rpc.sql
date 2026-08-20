-- ===========================================================================
-- BP32 — ACTIVAR UN FUNNEL EN UNA SOLA TRANSACCIÓN
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor.
--
-- ⚠ APLICAR PRIMERO `2026-08-intervention-one-active.sql`: esta función se
-- apoya en el índice único de `intervention` para que dos clics simultáneos no
-- creen dos intervenciones activas.
--
--
-- ---------------------------------------------------------------------------
-- 1. EL PROBLEMA QUE RESUELVE
-- ---------------------------------------------------------------------------
--
-- PostgREST no da transacciones ENTRE llamadas. Activar un funnel son cinco
-- escrituras -- enrollment, nodos, stages, línea base e intervención -- y
-- cualquiera puede fallar dejando las anteriores hechas.
--
-- La app tiene un rollback manual que las deshace, y funciona para el caso que
-- ocurre de verdad: un rechazo de la base. Pero NO es una transacción:
--
--   · si se corta la red después de escribir y antes de deshacer, queda residuo;
--   · si el navegador se cierra a mitad, no hay quien deshaga nada;
--   · entre la escritura y el rollback hay un instante en que otro usuario ve
--     un estado que nunca debió existir.
--
-- Una función `plpgsql` corre entera dentro de UNA transacción: o pasan las
-- cinco o no pasa ninguna, lo decide Postgres y no hay código de deshacer que
-- pueda fallar. Es lo mismo que ya se resolvió en S1 con
-- `save_pipeline_snapshot`.
--
--
-- ---------------------------------------------------------------------------
-- ⚠ 2. LA FUNCIÓN NO CALCULA NADA. RECIBE EL PLAN YA ARMADO.
-- ---------------------------------------------------------------------------
--
-- Es la decisión de diseño que importa, y va en contra del instinto.
--
-- El plan -- qué nodos, en qué orden, con qué fechas límite -- lo arma
-- `buildEnrollmentPlan` en `lib/business-plan/funnels.ts`: una función pura,
-- con su lógica de SLA acumulados, probada sin base. La línea base la calcula
-- `averageOver` sobre el lote activo de Commercial Activity, que la función no
-- puede leer sin duplicar toda la resolución de alias.
--
-- Reescribir eso en SQL sería tener LA MISMA REGLA EN DOS LENGUAJES, y la que
-- se olvide de actualizar es la que va a decidir las fechas de alguien. Es
-- exactamente el defecto que BP31 tuvo que arreglar en la vista de grupo.
--
-- Entonces: la función recibe `p_plan` como jsonb y su único trabajo es la
-- ATOMICIDAD. Valida lo que sólo la base puede validar -- que el funnel exista,
-- que no haya ya un plan activo -- y escribe.
--
--
-- ---------------------------------------------------------------------------
-- 3. SEGURIDAD
-- ---------------------------------------------------------------------------
--
-- `security invoker`, NO `definer`. Con `definer` la función correría con los
-- permisos de su dueño y sería un agujero alrededor de RLS: cualquiera con
-- acceso al esquema podría escribir filas que las políticas le prohíben. Con
-- `invoker` las mismas políticas de siempre siguen aplicando a cada insert.
--
-- El chequeo de `has_access()` va igual y explícito: una función que se puede
-- llamar por RPC merece decir en su primera línea quién puede llamarla.
--
-- `activated_by` se toma del JWT, no del argumento: si viniera por parámetro,
-- cualquiera podría activar un plan firmándolo con el email de otro.
-- ===========================================================================

create or replace function business_plan.activate_funnel(
  p_employee_key bigint,
  p_funnel_key   bigint,
  -- El plan ya armado por `buildEnrollmentPlan`. Forma esperada:
  --   [{ "source_node_key": 1, "name": "...", "description": null,
  --      "icon": "grid", "position": 1,
  --      "milestones": [{ "source_milestone_key": 3, "title": "...",
  --                       "accountable_employee_key": 58, "resource_url": null,
  --                       "due_date": "2026-08-17", "position": 1,
  --                       "sla_days": 3 }] }]
  p_plan jsonb,
  -- La línea base, ya promediada. Null = no se captura (tabla sin aplicar).
  p_baseline jsonb default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email        text := coalesce(auth.jwt() ->> 'email', '');
  v_funnel_name  text;
  v_enrollment   bigint;
  v_node         jsonb;
  v_node_key     bigint;
  v_ms           jsonb;
  v_ms_count     integer := 0;
begin
  if not business_plan.has_access() then
    raise exception 'No access to the Business Plan module' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'No authenticated session' using errcode = '42501';
  end if;

  -- El funnel tiene que existir y estar activo. Se lee acá y no se confía en el
  -- nombre que mande el cliente: `funnel_name` es una copia histórica y tiene
  -- que salir de la plantilla real, no de lo que el navegador tenía en memoria.
  select f.name into v_funnel_name
    from business_plan.funnel f
   where f.funnel_key = p_funnel_key and f.is_active;
  if v_funnel_name is null then
    raise exception 'Funnel % does not exist or is not active', p_funnel_key using errcode = '23503';
  end if;

  -- Un funnel vacío no es un plan. Es la misma regla que `checkActivation` en
  -- la app; acá se repite porque es la única que la base puede garantizar de
  -- verdad -- entre que la pantalla cargó y llegó esta llamada, otro pudo haber
  -- vaciado el funnel desde la biblioteca.
  if p_plan is null or jsonb_array_length(p_plan) = 0 then
    raise exception 'This funnel has no nodes' using errcode = '23514';
  end if;
  select coalesce(sum(jsonb_array_length(n -> 'milestones')), 0) into v_ms_count
    from jsonb_array_elements(p_plan) n;
  if v_ms_count = 0 then
    raise exception 'This funnel has nodes but no stages' using errcode = '23514';
  end if;

  -- 1. La cabecera. Si ya hay un plan activo, `enrollment_one_active_idx` lo
  --    rechaza acá y no se escribe NADA -- que es todo el punto de esto.
  insert into business_plan.enrollment (employee_key, funnel_key, funnel_name, status, activated_by)
  values (p_employee_key, p_funnel_key, v_funnel_name, 'active', v_email)
  returning enrollment_key into v_enrollment;

  -- 2 y 3. Los nodos y sus stages, en orden.
  for v_node in select * from jsonb_array_elements(p_plan)
  loop
    insert into business_plan.enrollment_node
      (enrollment_key, source_node_key, name, description, icon, position)
    values (
      v_enrollment,
      (v_node ->> 'source_node_key')::bigint,
      v_node ->> 'name',
      v_node ->> 'description',
      v_node ->> 'icon',
      (v_node ->> 'position')::integer
    )
    returning enrollment_node_key into v_node_key;

    for v_ms in select * from jsonb_array_elements(v_node -> 'milestones')
    loop
      insert into business_plan.enrollment_milestone
        (enrollment_node_key, source_milestone_key, title, accountable_employee_key,
         resource_url, due_date, status, position, sla_days)
      values (
        v_node_key,
        (v_ms ->> 'source_milestone_key')::bigint,
        v_ms ->> 'title',
        (v_ms ->> 'accountable_employee_key')::bigint,
        v_ms ->> 'resource_url',
        (v_ms ->> 'due_date')::date,
        'pending',
        (v_ms ->> 'position')::integer,
        (v_ms ->> 'sla_days')::integer
      );
    end loop;
  end loop;

  -- 4. La línea base congelada. Nullable porque la app puede no mandarla, pero
  --    si viene y falla, se cae todo: una foto del antes a medias no sirve.
  if p_baseline is not null then
    insert into business_plan.enrollment_baseline (
      enrollment_key, avg_closings, avg_credit_applications, avg_pre_approvals,
      avg_file_creations, baseline_months, enrollment_month, source, captured_by
    )
    values (
      v_enrollment,
      (p_baseline ->> 'avg_closings')::numeric,
      (p_baseline ->> 'avg_credit_applications')::numeric,
      (p_baseline ->> 'avg_pre_approvals')::numeric,
      (p_baseline ->> 'avg_file_creations')::numeric,
      array(select jsonb_array_elements_text(p_baseline -> 'baseline_months')),
      p_baseline ->> 'enrollment_month',
      'captured',
      v_email
    );
  end if;

  -- 5. La intervención, última. Dentro de la transacción el orden ya no decide
  --    qué sobrevive a un fallo -- no sobrevive nada -- pero se mantiene el
  --    mismo que la app, para que las dos rutas se lean igual mientras convivan.
  insert into business_plan.intervention (employee_key, status, funnel_key, activated_at, activated_by)
  values (p_employee_key, 'active', p_funnel_key, now(), v_email);

  return v_enrollment;
end;
$$;

comment on function business_plan.activate_funnel(bigint, bigint, jsonb, jsonb) is
  'Activa un funnel en una sola transaccion: enrollment, nodos, stages, linea base e intervencion. Ver BP32.';

grant execute on function business_plan.activate_funnel(bigint, bigint, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- CÓMO SE PRUEBA ANTES DE CONFIAR EN ELLA
-- ---------------------------------------------------------------------------
--
-- Lo que hay que ver es el fallo, no el éxito: que un plan inválido no deje NADA.
--
--   -- 1. cuántas filas hay antes
--   select (select count(*) from business_plan.enrollment)   as enr,
--          (select count(*) from business_plan.intervention) as iv;
--
--   -- 2. una activación que tiene que fallar: un stage sin fecha límite
--   select business_plan.activate_funnel(
--     1, 1,
--     '[{"source_node_key":1,"name":"X","description":null,"icon":null,"position":1,
--        "milestones":[{"source_milestone_key":1,"title":"T","accountable_employee_key":null,
--                       "resource_url":null,"due_date":null,"position":1,"sla_days":1}]}]'::jsonb,
--     null);
--
--   -- 3. los mismos conteos: tienen que ser IDÉNTICOS a los del paso 1
--   select (select count(*) from business_plan.enrollment)   as enr,
--          (select count(*) from business_plan.intervention) as iv;
--
-- Con el rollback manual de la app, el paso 3 muestra una intervención de más.
-- Con esta función, no puede.
