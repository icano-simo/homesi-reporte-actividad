-- ============================================================================
-- Recalcular las fechas límite del plan 66 — SOLO los steps no completados
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor.
--
-- Corrige las fechas que salieron de la fórmula vieja, la que leía `sla_days`
-- como día absoluto dentro del nodo en vez de como delta contra el step
-- anterior. El código ya está arreglado; esto es para los datos que quedaron.
--
--
-- ---------------------------------------------------------------------------
-- ⚠ EL ALCANCE CAMBIÓ RESPECTO DE LO QUE SE APROBÓ, Y POR QUÉ
-- ---------------------------------------------------------------------------
--
-- Se aprobó "recalculá el plan 66 entero" sobre la premisa de que se activó hoy
-- y nadie había ajustado nada. Esa premisa dejó de ser cierta MIENTRAS se
-- preparaba este archivo:
--
--   Ricardo Cera completó 11 de los 30 steps del plan 66
--   el 2026-09-04 entre las 17:30:49 y las 17:31:43.
--
-- Son los primeros steps completados en la historia del módulo -- el arreglo de
-- BP42 empezó a usarse media hora después de mergearse. Y Ricardo era
-- responsable de UNO de los 75 steps, así que lo que lo habilitó fue el cambio
-- de `canToggleMilestone`.
--
-- Por eso este archivo NO toca esos 11. Recalcular la fecha límite de un step
-- ya completado es mover el plazo de trabajo que ya se hizo: el `completed_at`
-- diría que se cerró antes de una fecha límite que nunca existió.
--
-- Se recalculan los 19 en `planned`.
--
-- Y la discontinuidad cae en un BORDE LIMPIO, medido: los 11 completados son
-- todos los steps de los nodos 1 a 5 --1+1+3+4+2-- y del nodo 6 en adelante no
-- hay ninguno completado. Así que no es un corte a mitad de un nodo: los cinco
-- primeros nodos conservan enteras sus fechas originales y los seis siguientes
-- quedan enteros con las corregidas.
--
-- Es el mejor caso posible para esta corrección, y es casualidad -- si Ricardo
-- hubiera completado los steps salteados, el corte habría partido un nodo por
-- el medio y la lectura del plan sería peor.
--
-- ⚠ Y OJO CON QUIÉN LO EJECUTA. La policy de UPDATE de
-- `enrollment_milestone` es `has_access() AND status <> 'completed'`, así que
-- desde la app las 11 filas completadas son invisibles para un UPDATE y se
-- saltarían EN SILENCIO -- cero filas, sin error. Desde el editor de SQL, con
-- rol `postgres`, RLS no aplica y sí se tocarían. El `where status = 'planned'`
-- de abajo es lo que lo impide, y no la policy.
--
--
-- ---------------------------------------------------------------------------
-- EL ANTES Y EL DESPUÉS DE LAS 30 FILAS
-- ---------------------------------------------------------------------------
--
-- Corré esto primero. Las 11 primeras filas dicen `completed` y NO se tocan.
--
--  np.sp  nodo                      sla  estado     antes        después
--  1.1   Recruitment Coaching        3   completed  2026-09-01   2026-09-07
--  2.1   Recruitment - DYS Playbook  1   completed  2026-09-01   2026-09-08
--  3.1   CRM, MMI & for Network      1   completed  2026-09-01   2026-09-09
--  3.2   CRM, MMI & for Network      1   completed  2026-09-01   2026-09-10
--  3.3   CRM, MMI & for Network      1   completed  2026-09-01   2026-09-11
--  4.1   Prospecting                 2   completed  2026-08-24   2026-09-13
--  4.2   Prospecting                 2   completed  2026-08-24   2026-09-15
--  4.3   Prospecting                 1   completed  2026-08-24   2026-09-16
--  4.4   Prospecting                 1   completed  2026-08-24   2026-09-17
--  5.1   Database Segmentation       2   completed  2026-09-01   2026-09-19
--  5.2   Database Segmentation       2   completed  2026-09-01   2026-09-21
--  6.1   Marketing Campaigns         5   planned    2026-09-08   2026-09-26
--  6.2   Marketing Campaigns         1   planned    2026-09-14   2026-09-27
--  6.3   Marketing Campaigns         3   planned    2026-09-16   2026-09-30
--  6.4   Marketing Campaigns         5   planned    2026-09-18   2026-10-05
--  6.5   Marketing Campaigns        30   planned    2026-10-13   2026-11-04
--  6.6   Marketing Campaigns         0   planned    2026-09-13   2026-11-04  <-- el caso claro
--  7.1   Effective Conversations     1   planned    2026-10-14   2026-11-05
--  7.2   Effective Conversations     2   planned    2026-10-15   2026-11-07
--  7.3   Effective Conversations     1   planned    2026-10-14   2026-11-08
--  7.4   Effective Conversations     0   planned    2026-10-13   2026-11-08
--  8.1   Prework & Dossier           1   planned    2026-10-16   2026-11-09
--  9.1   Cold Calling - Recruitment  5   planned    2026-10-21   2026-11-14
-- 10.1   Value Proposition           1   planned    2026-10-22   2026-11-15
-- 10.2   Value Proposition           4   planned    2026-10-25   2026-11-19
-- 10.3   Value Proposition           0   planned    2026-10-21   2026-11-19
-- 10.4   Value Proposition           0   planned    2026-10-21   2026-11-19
-- 11.1   Deal Closing                2   planned    2026-10-27   2026-11-21
-- 11.2   Deal Closing                3   planned    2026-10-28   2026-11-24
-- 11.3   Deal Closing                7   planned    2026-11-01   2026-12-01
--
-- El plan pasa de terminar el 2026-11-01 a terminar el 2026-12-01: un mes más.
-- No es sólo la fecha de cada step -- `nodeDayRanges` pasó de `max` a suma, así
-- que cada nodo arranca más tarde que antes.

with e as (
  select activated_at::date as d0 from business_plan.enrollment where enrollment_key = 66
),
pasos as (
  select en.enrollment_node_key, en.position as np, en.name as nodo,
         m.enrollment_milestone_key as k, m.position as sp, m.title, m.status,
         m.sla_days, m.due_date
  from business_plan.enrollment_node en
  join business_plan.enrollment_milestone m on m.enrollment_node_key = en.enrollment_node_key
  where en.enrollment_key = 66
),
acum as (
  select p.*,
         (sum(coalesce(p.sla_days,0)) over (partition by p.enrollment_node_key order by p.sp
              rows between unbounded preceding and current row))::int as dia_en_nodo,
         (sum(coalesce(p.sla_days,0)) over (partition by p.enrollment_node_key))::int as total_nodo
  from pasos p
),
spans as (
  select distinct enrollment_node_key, np, greatest(1, total_nodo)::int as span from acum
),
inicio as (
  select s.enrollment_node_key, s.np,
         (1 + coalesce((select sum(s2.span) from spans s2 where s2.np < s.np), 0))::int as from_day
  from spans s
)
select a.np, a.sp, a.nodo, a.title, a.sla_days, a.status,
       a.due_date as antes,
       (e.d0 + (i.from_day - 1 + a.dia_en_nodo)) as despues,
       case when a.status = 'completed' then 'NO SE TOCA' else 'se actualiza' end as accion
from acum a
join inicio i on i.enrollment_node_key = a.enrollment_node_key
cross join e
order by a.np, a.sp;


-- ---------------------------------------------------------------------------
-- EL UPDATE
-- ---------------------------------------------------------------------------
--
-- ⚠ Se comprueba el conteo. Tiene que decir 19: si dice otra cosa, alguien
-- completó o agregó steps entre la vista de arriba y esto, y hay que volver a
-- mirar antes de seguir.

do $mig$
declare v_n integer;
begin
  with e as (
    select activated_at::date as d0 from business_plan.enrollment where enrollment_key = 66
  ),
  pasos as (
    select en.enrollment_node_key, en.position as np,
           m.enrollment_milestone_key as k, m.position as sp, m.status, m.sla_days
    from business_plan.enrollment_node en
    join business_plan.enrollment_milestone m on m.enrollment_node_key = en.enrollment_node_key
    where en.enrollment_key = 66
  ),
  acum as (
    select p.*,
           (sum(coalesce(p.sla_days,0)) over (partition by p.enrollment_node_key order by p.sp
                rows between unbounded preceding and current row))::int as dia_en_nodo,
           (sum(coalesce(p.sla_days,0)) over (partition by p.enrollment_node_key))::int as total_nodo
    from pasos p
  ),
  spans as (
    select distinct enrollment_node_key, np, greatest(1, total_nodo)::int as span from acum
  ),
  inicio as (
    select s.enrollment_node_key, s.np,
           (1 + coalesce((select sum(s2.span) from spans s2 where s2.np < s.np), 0))::int as from_day
    from spans s
  ),
  nuevas as (
    select a.k, (e.d0 + (i.from_day - 1 + a.dia_en_nodo)) as nueva
    from acum a
    join inicio i on i.enrollment_node_key = a.enrollment_node_key
    cross join e
    where a.status = 'planned'
  )
  update business_plan.enrollment_milestone m
     set due_date = n.nueva
    from nuevas n
   where m.enrollment_milestone_key = n.k;

  get diagnostics v_n = row_count;
  if v_n <> 19 then
    raise exception 'se actualizaron % filas y se esperaban 19: revisar antes de seguir', v_n;
  end if;
  raise notice 'plan 66: % fechas recalculadas, los 11 completados sin tocar', v_n;
end $mig$;


-- ---------------------------------------------------------------------------
-- LA NOTA: QUE QUEDE DICHO QUE EL PLAN SE CORRIGIÓ
-- ---------------------------------------------------------------------------
--
-- El plan pasa de terminar el 2026-11-01 al 2026-12-01. Un mes más largo no es
-- un detalle: es el tipo de cambio que Jonathan va a notar, y sin registro
-- parecería que alguien le movió las fechas sin avisar.
--
-- `business_plan.note` es append-only --sólo INSERT y SELECT, sin UPDATE ni
-- DELETE-- justamente porque una nota es el registro de lo que se dijo. Y no
-- tiene columna `enrollment_key`, así que una nota de PLAN se ancla en
-- `employee_key`: el 41, que es Jonathan.
--
-- ⚠ HAY QUE PONER EL EMAIL DEL AUTOR. Se deja un marcador a propósito y el
-- bloque FALLA si queda sin reemplazar: una nota firmada por
-- `REEMPLAZAR@...` es peor que no tener nota, porque el registro diría que la
-- escribió alguien que no existe.

do $nota$
declare
  v_autor text := 'REEMPLAZAR@supremelending.com';   -- <-- poner el propio
begin
  if v_autor like 'REEMPLAZAR@%' then
    raise exception 'poner el email del autor en v_autor antes de correr esto';
  end if;

  insert into business_plan.note (body, author_email, employee_key)
  values (
    'Fechas límite recalculadas el ' || to_char(now(), 'YYYY-MM-DD') || '. '
    || 'Las fechas originales salieron de una fórmula que leía el SLA de cada step '
    || 'como día absoluto del nodo en vez de como días desde el step anterior, así que '
    || 'algunos vencían antes que el step que los precede. Se corrigieron los 19 steps '
    || 'pendientes; los 11 ya completados conservan sus fechas originales, porque mover '
    || 'el plazo de trabajo ya hecho sería reescribir el registro. '
    || 'El plan termina el 2026-12-01 en vez del 2026-11-01.',
    v_autor,
    41
  );
  raise notice 'nota registrada en el perfil del empleado 41';
end $nota$;


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBAR QUE QUEDÓ
-- ---------------------------------------------------------------------------
--
--   -- ningun step planned con fecha anterior a la del step previo de su nodo
--   with p as (
--     select en.enrollment_key, en.enrollment_node_key, m.position, m.due_date, m.status,
--            lag(m.due_date) over (partition by en.enrollment_node_key order by m.position) as prev
--     from business_plan.enrollment_node en
--     join business_plan.enrollment_milestone m on m.enrollment_node_key = en.enrollment_node_key
--     where en.enrollment_key = 66
--   )
--   select count(*) from p where prev is not null and due_date < prev and status = 'planned';
--   -- debe dar 0
--
--   -- la nota quedo
--   select note_key, author_email, left(body, 70) from business_plan.note
--    where employee_key = 41 order by created_at desc limit 1;
--
--   -- y los 11 completados conservan su fecha original
--   select count(*) from business_plan.enrollment_milestone m
--     join business_plan.enrollment_node en on en.enrollment_node_key = m.enrollment_node_key
--    where en.enrollment_key = 66 and m.status = 'completed'
--      and m.due_date in (date '2026-08-24', date '2026-09-01');
--   -- debe dar 11
--
--
-- ---------------------------------------------------------------------------
-- LO QUE QUEDA PENDIENTE, Y NO ES DE ACÁ
-- ---------------------------------------------------------------------------
--
-- El plan 36 (Ana) NO se toca: lleva días activo y no hay forma de distinguir
-- una fecha ajustada a mano de una calculada.
--
-- Sus dos steps desordenados --`Configuración SF, MMI e integración` y
-- `Prospectar 10 realtors con 3 items`-- tienen `sla_days` en NULL, así que su
-- desorden es de un día y NO sale de esta fórmula.
--
-- ⚠ Con la fórmula nueva sí se arreglarían solos: `cumulativeDays` trata NULL
-- como 0, así que un step sin SLA HEREDA el día del anterior en vez de caer en
-- el día de arranque del nodo. No hace falta inventar ningún SLA.
--
-- Pero el arreglo de fondo es otro: que alguien les ponga un SLA en la
-- plantilla. Mientras estén en NULL, cualquier plan nuevo que copie esos dos
-- steps va a poner los dos el mismo día que su predecesor, que probablemente
-- tampoco sea lo que se quiere.
