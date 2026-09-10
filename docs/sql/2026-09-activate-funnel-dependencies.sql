-- ============================================================================
-- BP46 — `activate_funnel` copia las dependencias, en dos pasadas
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor.
--
-- Es un `create or replace` COMPLETO y no un fragmento para intercalar, y la
-- razón es la de BP41: la FK de `enrollment_node` quedó distinta de lo que decía
-- el archivo. Así que el cuerpo de acá se leyó de `pg_proc` --lo que está
-- aplicado de verdad, ya con el renombre de BP42 adentro-- y sólo se le agregó
-- el bloque 2b. Todo lo demás es idéntico, línea por línea.
--
--
-- ---------------------------------------------------------------------------
-- ⚠ EL CAMBIO ES COMPATIBLE HACIA ATRÁS, Y ESO ES DELIBERADO
-- ---------------------------------------------------------------------------
--
-- Si el plan que llega no trae `depends_on_source_node_key` en ningún nodo, el
-- `update` del bloque 2b no matchea ninguna fila y la función se comporta
-- EXACTAMENTE como antes. El código desplegado hoy no manda ese campo.
--
-- O sea que a diferencia del renombre de estados de BP42, acá no hay orden de
-- despliegue obligatorio: esto se puede aplicar antes que el código, y nada
-- cambia hasta que el código empiece a mandar el campo.
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EN DOS PASADAS
-- ---------------------------------------------------------------------------
--
-- Un nodo puede depender de otro que todavía no se insertó. Hoy las
-- dependencias apuntan siempre hacia atrás --el trigger `funnel_node_dep_order`
-- exige que el antecesor tenga posición menor-- así que una sola pasada
-- funcionaría por casualidad.
--
-- Se hace en dos igual: la primera inserta todos los nodos, la segunda resuelve
-- las dependencias contra las claves ya existentes. Depender del orden de
-- inserción sería correcto hoy y silenciosamente incorrecto el día que el
-- modelo permita otra cosa.
--
--
-- ---------------------------------------------------------------------------
-- Y POR QUÉ LA GUARDA
-- ---------------------------------------------------------------------------
--
-- Si el plan declara un antecesor que NO está entre los nodos copiados, el
-- `update` no encuentra a quién apuntar y la columna queda en `null`. Eso se
-- lee después como "este nodo no espera a nada" -- o sea, el plan arrancaría
-- sin el bloqueo que se pidió, y sin que nada lo dijera.
--
-- Es la forma exacta del patrón de `AGENTS.md`: lo que compensa una ausencia
-- hace que la ausencia no se note. Por eso falla en vez de dejarlo pasar.

create or replace function business_plan.activate_funnel(
  p_employee_key bigint,
  p_funnel_key   bigint,
  p_plan         jsonb,
  p_baseline     jsonb default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_funnel_name text; v_enrollment bigint; v_node jsonb; v_node_key bigint;
  v_ms jsonb; v_ms_count integer := 0;
  v_sin_resolver text;
begin
  if not business_plan.has_access() then
    raise exception 'No access to the Business Plan module' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'No authenticated session' using errcode = '42501';
  end if;

  select f.name into v_funnel_name from business_plan.funnel f
   where f.funnel_key = p_funnel_key and f.is_active;
  if v_funnel_name is null then
    raise exception 'Funnel % does not exist or is not active', p_funnel_key using errcode = '23503';
  end if;

  -- Rechaza un funnel sin nodos o sin steps ANTES de escribir nada: activarlo
  -- dejaba un plan vacio que el portal no sabe mostrar.
  if p_plan is null or jsonb_array_length(p_plan) = 0 then
    raise exception 'This funnel has no nodes' using errcode = '23514';
  end if;
  select coalesce(sum(jsonb_array_length(n -> 'milestones')), 0) into v_ms_count
    from jsonb_array_elements(p_plan) n;
  if v_ms_count = 0 then
    raise exception 'This funnel has nodes but no stages' using errcode = '23514';
  end if;

  insert into business_plan.enrollment (employee_key, funnel_key, funnel_name, status, activated_by)
  values (p_employee_key, p_funnel_key, v_funnel_name, 'active', v_email)
  returning enrollment_key into v_enrollment;

  -- ── PASADA 1: los nodos y sus steps ──────────────────────────────────────
  for v_node in select * from jsonb_array_elements(p_plan) loop
    insert into business_plan.enrollment_node
      (enrollment_key, source_node_key, name, description, icon, position)
    values (v_enrollment, (v_node ->> 'source_node_key')::bigint, v_node ->> 'name',
            v_node ->> 'description', v_node ->> 'icon', (v_node ->> 'position')::integer)
    returning enrollment_node_key into v_node_key;

    for v_ms in select * from jsonb_array_elements(v_node -> 'milestones') loop
      insert into business_plan.enrollment_milestone
        (enrollment_node_key, source_milestone_key, title, accountable_employee_key,
         resource_url, due_date, status, position, sla_days)
      values (v_node_key, (v_ms ->> 'source_milestone_key')::bigint, v_ms ->> 'title',
              (v_ms ->> 'accountable_employee_key')::bigint, v_ms ->> 'resource_url',
              (v_ms ->> 'due_date')::date, 'planned',
              (v_ms ->> 'position')::integer, (v_ms ->> 'sla_days')::integer);
    end loop;
  end loop;

  -- ── PASADA 2: las dependencias, contra las copias recien creadas ─────────
  --
  -- LA COPIA APUNTA A LA COPIA. Apuntando a la plantilla, desbloquear a una
  -- persona desbloquearia a todas las que tienen el mismo funnel -- y dos de
  -- los cuatro planes activos comparten funnel, asi que no es hipotetico.
  update business_plan.enrollment_node en
     set depends_on_enrollment_node_key = dep.enrollment_node_key
    from jsonb_array_elements(p_plan) j
    join business_plan.enrollment_node dep
      on dep.enrollment_key = v_enrollment
     and dep.source_node_key = (j.value ->> 'depends_on_source_node_key')::bigint
   where en.enrollment_key = v_enrollment
     and en.source_node_key = (j.value ->> 'source_node_key')::bigint
     and j.value ->> 'depends_on_source_node_key' is not null;

  -- ⚠ Y NINGUNA PUEDE QUEDAR SIN RESOLVER. Una dependencia declarada que no
  -- encontro a quien apuntar deja la columna en null, y eso se lee despues como
  -- "no espera a nada": el plan arrancaria sin el bloqueo que se pidio.
  select string_agg(j.value ->> 'name', ', ')
    into v_sin_resolver
  from jsonb_array_elements(p_plan) j
  where j.value ->> 'depends_on_source_node_key' is not null
    and not exists (
      select 1 from business_plan.enrollment_node dep
      where dep.enrollment_key = v_enrollment
        and dep.source_node_key = (j.value ->> 'depends_on_source_node_key')::bigint
    );
  if v_sin_resolver is not null then
    raise exception
      'the plan declares a dependency on a node that is not in it: %', v_sin_resolver
      using errcode = '23503';
  end if;

  if p_baseline is not null then
    insert into business_plan.enrollment_baseline (
      enrollment_key, avg_closings, avg_credit_applications, avg_pre_approvals,
      avg_file_creations, baseline_months, enrollment_month, source, captured_by)
    values (v_enrollment, (p_baseline ->> 'avg_closings')::numeric,
            (p_baseline ->> 'avg_credit_applications')::numeric,
            (p_baseline ->> 'avg_pre_approvals')::numeric,
            (p_baseline ->> 'avg_file_creations')::numeric,
            array(select jsonb_array_elements_text(p_baseline -> 'baseline_months')),
            p_baseline ->> 'enrollment_month', 'captured', v_email);
  end if;

  -- La intervencion va ULTIMA: es la mas barata de rehacer y un fallo antes
  -- de ella no deja nada colgando.
  insert into business_plan.intervention (employee_key, status, funnel_key, activated_at, activated_by)
  values (p_employee_key, 'active', p_funnel_key, now(), v_email);

  return v_enrollment;
end;
$$;

comment on function business_plan.activate_funnel(bigint, bigint, jsonb, jsonb) is
  'Activa un funnel para un empleado en una sola transaccion. Desde BP46 copia tambien las dependencias entre nodos, resolviendo plantilla->copia en una SEGUNDA pasada: la copia apunta a la copia, nunca a la plantilla. Falla si una dependencia declarada no encuentra a quien apuntar.';


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBAR QUE QUEDÓ
-- ---------------------------------------------------------------------------
--
--   -- 1. que la funcion tenga las dos pasadas
--   select position('PASADA 2' in prosrc) > 0 as tiene_pasada_2
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'business_plan' and p.proname = 'activate_funnel';
--
--   -- 2. que un plan SIN dependencias siga saliendo igual: activar uno de
--   --    prueba y comparar nodos/steps contra el mismo funnel de antes.
--
--   -- 3. que un plan CON dependencias las resuelva contra SU copia:
--   select en.name, en.depends_on_enrollment_node_key, dep.name as espera_a,
--          dep.enrollment_key = en.enrollment_key as misma_persona
--     from business_plan.enrollment_node en
--     left join business_plan.enrollment_node dep
--            on dep.enrollment_node_key = en.depends_on_enrollment_node_key
--    where en.enrollment_key = <el de prueba>
--    order by en.position;
--   -- `misma_persona` tiene que ser true en todas las que tengan dependencia
--
--   -- 4. y que la guarda dispare: activar un plan que declare un antecesor
--   --    ausente tiene que fallar con 'declares a dependency on a node that is
--   --    not in it', y NO dejar el enrolamiento a medias.
