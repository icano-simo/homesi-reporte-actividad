-- ===========================================================================
-- business_plan.enrollment_milestone — guardar el SLA en la instancia
-- ===========================================================================
--
-- Etapa BP14.
--
-- ⚠ NO EJECUTADA POR QUIEN ESCRIBIÓ ESTE ARCHIVO. La aplica el revisor.
--   Es una sola columna, aditiva y nullable: no rompe nada existente.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ HACE FALTA
-- ---------------------------------------------------------------------------
-- Al reordenar los nodos de un plan hay que RECALCULAR las fechas límite: un
-- nodo que pasa del cuarto al primer lugar arranca el día 1 y sus milestones
-- vencen antes.
--
-- La fórmula es la misma que en la activación:
--
--     due_date = fecha_de_activación + (día_de_inicio_del_nodo − 1) + sla_days
--
-- El problema es que `sla_days` vivía SÓLO en la plantilla
-- (`node_milestone.sla_days`), y el plan es una copia deliberadamente
-- desconectada de ella. Al reordenar no había de dónde sacarlo.
--
-- Se evaluó derivarlo de las `due_date` existentes restando la fecha de
-- activación. Funciona la primera vez, pero después del primer reordenamiento
-- las fechas ya no reflejan el orden original y el cálculo se desalinea sin
-- avisar. Guardarlo es una columna; derivarlo es un bug que aparece al segundo
-- reordenamiento.
--
-- Copiarlo es además coherente con todo el resto del diseño: el plan ya copia
-- el título, el responsable y la URL del recurso. El SLA es un dato más de esa
-- foto.
-- ===========================================================================

alter table business_plan.enrollment_milestone
  add column if not exists sla_days integer check (sla_days >= 0);

comment on column business_plan.enrollment_milestone.sla_days is
  'Copia del SLA de la plantilla, en días desde el inicio de SU nodo. Se usa para recalcular due_date cuando se reordenan los nodos del plan.';


-- ---------------------------------------------------------------------------
-- Sin backfill, a propósito
-- ---------------------------------------------------------------------------
-- Hoy no hay enrolamientos, así que no hay nada que rellenar. Si los hubiera,
-- un backfill "sla = due_date − activated_at" sólo sería correcto para los
-- milestones del PRIMER nodo: para el resto ignoraría el desplazamiento
-- acumulado de los nodos anteriores y daría fechas equivocadas.
--
-- La app maneja el nulo: un milestone sin `sla_days` conserva su fecha al
-- reordenar en vez de recibir una inventada, y la pantalla lo dice.


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. La columna existe y es nullable:
--      select column_name, data_type, is_nullable
--        from information_schema.columns
--       where table_schema = 'business_plan'
--         and table_name = 'enrollment_milestone'
--         and column_name = 'sla_days';
--
-- 2. Al activar un funnel, los milestones nuevos la traen poblada:
--      select title, sla_days, due_date
--        from business_plan.enrollment_milestone
--       order by enrollment_node_key, position;
--
-- 3. Al reordenar un nodo del plan, las due_date de sus milestones PENDIENTES
--    se mueven y las de los que están en `done` no.
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   alter table business_plan.enrollment_milestone drop column if exists sla_days;
--
-- ===========================================================================
