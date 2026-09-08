-- ============================================================================
-- BP42 — RENOMBRE DE LOS ESTADOS DE UN STEP
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor.
--
--   pending      ->  planned
--   in_progress  ->  in_progress   (sin cambio; la ETIQUETA pasa a "In progress")
--   done         ->  completed
--
-- ⚠ EL ORDEN DE DESPLIEGUE IMPORTA: PRIMERO ESTE SQL, DESPUÉS EL CÓDIGO.
--
-- El código de BP42 compara contra `'planned'` y `'completed'`. Desplegado
-- antes de aplicar esto, la app pediría estados que la base rechaza y la
-- pantalla del plan dejaría de guardar. No hay ventana tolerable: no es como
-- las tablas nuevas de BP12, donde faltar significaba "todavía no está".
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ `in_progress` CONSERVA EL GUIÓN BAJO
-- ---------------------------------------------------------------------------
--
-- El brief pedía `in progress` con espacio. Se guarda con guión bajo y se
-- MUESTRA con espacio, que ya es lo que hace `MILESTONE_STATUS_LABEL`.
--
-- La razón: nadie ve el valor guardado, y un valor con espacio hace que la
-- próxima comparación mal escrita --`'in progress'` contra `'in_progress'`--
-- sea un bug silencioso en vez de un error de tipos. Es la misma clase de
-- silencio que este mismo brief vino a arreglar.
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EL CHECK SE QUEDA CON TRES VALORES Y NO CUATRO
-- ---------------------------------------------------------------------------
--
-- `blocked` NO se guarda: se DERIVA de que la dependencia del nodo no esté
-- completa, y `depends_on_enrollment_node_key` ya está en la base desde BP41.
--
-- El argumento que decide no es el de la sincronización sino este: un step que
-- está EN PROGRESO y cuyo antecesor no terminó tiene dos estados a la vez, y una
-- sola columna no los guarda. Al desbloquearlo habría que adivinar cuál era.
--
-- Si algún día hace falta "trabado por algo que no es una dependencia" --espera
-- legal, cliente que no responde-- eso es otro concepto y va como columna propia
-- con su motivo, no como un cuarto valor de estado.


-- ---------------------------------------------------------------------------
-- 1. FOTO DE ANTES, PARA PODER COMPARAR
-- ---------------------------------------------------------------------------
--
-- Se imprime en el log de la migración. Con 75 filas hoy: 63 pending,
-- 12 in_progress, 0 done.
do $foto$
declare v text;
begin
  select string_agg(status || '=' || n, ', ' order by status)
    into v
  from (select status, count(*) n from business_plan.enrollment_milestone group by status) t;
  raise notice 'ANTES: %', coalesce(v, '(tabla vacia)');
end $foto$;


-- ---------------------------------------------------------------------------
-- 2. BAJAR EL CHECK, MIGRAR, SUBIRLO
-- ---------------------------------------------------------------------------
--
-- ⚠ EN ESTE ORDEN Y NO EN OTRO. El check vigente sólo acepta
-- ('pending','in_progress','done'), así que un UPDATE a 'planned' se estrella
-- contra él. Que se estrelle es lo bueno -- por eso el renombre no puede pasar
-- desapercibido -- pero hay que bajarlo primero a propósito.
alter table business_plan.enrollment_milestone
  drop constraint enrollment_milestone_status_check;

update business_plan.enrollment_milestone set status = 'planned'   where status = 'pending';
update business_plan.enrollment_milestone set status = 'completed' where status = 'done';

-- ⚠ Y SE VERIFICA QUE NO QUEDÓ NINGUNO VIEJO ANTES DE PONER EL CHECK. Sin esta
-- guarda, una fila con un valor inesperado haría fallar el `add constraint` con
-- un mensaje que no dice cuál es.
do $guard$
declare v text;
begin
  select string_agg(distinct status, ', ')
    into v
  from business_plan.enrollment_milestone
  where status not in ('planned', 'in_progress', 'completed');
  if v is not null then
    raise exception 'quedaron estados sin migrar: %', v;
  end if;
end $guard$;

alter table business_plan.enrollment_milestone
  add constraint enrollment_milestone_status_check
  check (status = any (array['planned'::text, 'in_progress'::text, 'completed'::text]));

alter table business_plan.enrollment_milestone
  alter column status set default 'planned';

comment on column business_plan.enrollment_milestone.status is
  'planned | in_progress | completed. `blocked` NO vive aca: se deriva de que la dependencia del nodo no este completa, porque un step en progreso con el antecesor sin terminar tiene dos estados a la vez. Ver BP42.';


-- ---------------------------------------------------------------------------
-- 3. LAS CUATRO POLÍTICAS QUE DICEN 'done'
-- ---------------------------------------------------------------------------
--
-- ⚠ SI EL VALOR CAMBIA Y LAS POLÍTICAS NO, LA PROTECCIÓN DE LOS COMPLETADOS
-- DESAPARECE EN SILENCIO: `status <> 'done'` sería verdadero para todas las
-- filas --ninguna dice ya 'done'-- y cualquiera podría editar o borrar un step
-- completado. No falla nada; simplemente deja de proteger.
--
-- Son cuatro y dos están en OTRAS tablas, que es lo que hace fácil olvidarlas:
-- `enrollment_node_delete` y `enrollment_delete` miran el estado de los steps
-- por subconsulta para no dejar borrar un plan con trabajo hecho.

drop policy if exists enrollment_milestone_update on business_plan.enrollment_milestone;
create policy enrollment_milestone_update on business_plan.enrollment_milestone
  for update
  using (business_plan.has_access() and status <> 'completed')
  with check (business_plan.has_access());

drop policy if exists enrollment_milestone_delete on business_plan.enrollment_milestone;
create policy enrollment_milestone_delete on business_plan.enrollment_milestone
  for delete
  using (business_plan.has_access() and status <> 'completed');

drop policy if exists enrollment_node_delete on business_plan.enrollment_node;
create policy enrollment_node_delete on business_plan.enrollment_node
  for delete
  using (
    business_plan.has_access()
    and not exists (
      select 1 from business_plan.enrollment_milestone m
      where m.enrollment_node_key = enrollment_node.enrollment_node_key
        and m.status = 'completed'
    )
  );

drop policy if exists enrollment_delete on business_plan.enrollment;
create policy enrollment_delete on business_plan.enrollment
  for delete
  using (
    business_plan.has_access()
    and not exists (
      select 1
      from business_plan.enrollment_node n
      join business_plan.enrollment_milestone m on m.enrollment_node_key = n.enrollment_node_key
      where n.enrollment_key = enrollment.enrollment_key
        and m.status = 'completed'
    )
  );


-- ---------------------------------------------------------------------------
-- 4. LAS DOS FUNCIONES — PARCHEANDO LA DEFINICIÓN APLICADA, NO LA DEL ARCHIVO
-- ---------------------------------------------------------------------------
--
-- `activate_funnel` inserta los steps con `'pending'`; `cancel_funnel` cuenta
-- los `'done'` para reportar cuántos se borraron. Una ocurrencia en cada una,
-- contada contra la base.
--
-- ⚠ SE PARCHEA `pg_get_functiondef`, O SEA LO QUE ESTÁ APLICADO, y no se pega
-- acá un `create or replace` completo. La razón es concreta: en BP41 la FK de
-- `enrollment_node` quedó distinta de lo que decía el archivo, así que reponer
-- estas funciones desde el repositorio podría revertir en silencio cualquier
-- ajuste que se les haya hecho después. Esto cambia el literal y nada más.
--
-- Y falla ruidosamente si el literal no está donde se espera, en vez de dejar la
-- función a medio migrar.
do $fn$
declare
  v_def text;
  v_n   int;
begin
  -- activate_funnel: 'pending' -> 'planned'
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'business_plan' and p.proname = 'activate_funnel';
  if v_def is null then
    raise exception 'business_plan.activate_funnel no existe';
  end if;
  v_n := (length(v_def) - length(replace(v_def, '''pending''', ''))) / length('''pending''');
  if v_n <> 1 then
    raise exception 'activate_funnel tiene % ocurrencias de ''pending'', se esperaba 1', v_n;
  end if;
  execute replace(v_def, '''pending''', '''planned''');
  raise notice 'activate_funnel migrada';

  -- cancel_funnel: 'done' -> 'completed'
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'business_plan' and p.proname = 'cancel_funnel';
  if v_def is null then
    raise exception 'business_plan.cancel_funnel no existe';
  end if;
  v_n := (length(v_def) - length(replace(v_def, '''done''', ''))) / length('''done''');
  if v_n <> 1 then
    raise exception 'cancel_funnel tiene % ocurrencias de ''done'', se esperaba 1', v_n;
  end if;
  execute replace(v_def, '''done''', '''completed''');
  raise notice 'cancel_funnel migrada';
end $fn$;


-- ---------------------------------------------------------------------------
-- 5. FOTO DE DESPUÉS
-- ---------------------------------------------------------------------------

do $foto2$
declare v text;
begin
  select string_agg(status || '=' || n, ', ' order by status)
    into v
  from (select status, count(*) n from business_plan.enrollment_milestone group by status) t;
  raise notice 'DESPUES: %', coalesce(v, '(tabla vacia)');
end $foto2$;


-- ---------------------------------------------------------------------------
-- 6. CÓMO COMPROBAR QUE QUEDÓ
-- ---------------------------------------------------------------------------
--
-- No alcanza con que la migración no dé error. Se lee de vuelta, y las cuatro
-- consultas tienen que dar cero:
--
--   -- ninguna fila con un valor viejo
--   select count(*) from business_plan.enrollment_milestone
--    where status in ('pending','done');
--
--   -- ninguna politica comparando contra el literal viejo
--   select count(*) from pg_policy
--    where coalesce(pg_get_expr(polqual,polrelid),'') like '%''done''%'
--       or coalesce(pg_get_expr(polwithcheck,polrelid),'') like '%''done''%';
--
--   -- ninguna funcion con el literal viejo
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='business_plan'
--      and (p.prosrc like '%''pending''%' or p.prosrc like '%''done''%');
--
--   -- y el check con los TRES valores nuevos
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname='enrollment_milestone_status_check';
--   -- debe decir ARRAY['planned','in_progress','completed']
