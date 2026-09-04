-- ============================================================================
-- BP41 — DEPENDENCIAS A NIVEL DE NODO, EN LA PLANTILLA Y EN LA COPIA
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor. Ver el punto 9 del brief BP41.
--
-- Un nodo puede declarar que espera a otro. Por defecto no espera a nada, y
-- `null` significa exactamente eso: nadie declaró una dependencia. No hay valor
-- de respaldo, porque "no espera a nada" y "no se decidió" no son lo mismo y
-- darles el mismo valor los haría indistinguibles después.
--
-- El nivel de STEP no entra en esta etapa. Los nueve funnels son hoy
-- estrictamente secuenciales --no hay forma de expresar otra cosa-- así que el
-- primer uso real es "no arranques el nodo 3 sin terminar el 1". El nivel de
-- step se agrega cuando haya un caso que lo pida.
--
--
-- ---------------------------------------------------------------------------
-- DECISIÓN 1 — LA DEPENDENCIA VIVE EN `funnel_node`, NO EN `node`
-- ---------------------------------------------------------------------------
--
-- Medido contra la base: de los 31 nodos, 16 están en más de un funnel. La
-- distribución es 15 en uno, 8 en dos, 5 en tres, 2 en cuatro y 1 en cinco
-- (`CRM, MMI & for Network effects`). Y CERO nodos están en cero funnels.
--
-- Puesta en `node`, la dependencia viajaría a los cinco funnels del nodo 52, y
-- en cuatro de ellos el antecesor puede no existir. La dependencia es una
-- propiedad del nodo DENTRO de un funnel, así que va en la relación.
--
-- `funnel_node` sirve tal como está: su PK es `(funnel_key, node_key)`, o sea
-- que un nodo aparece a lo sumo una vez por funnel. Eso hace que
-- `(funnel_key, node_key)` sea una clave estable a la que apuntar.
--
--
-- ---------------------------------------------------------------------------
-- DECISIÓN 2 — EL OWNER SE QUEDA EN EL NODO
-- ---------------------------------------------------------------------------
--
-- `node_owner` es `(node_key, employee_key)`, muchos a muchos, 79 filas para 31
-- nodos. Medido: 7 nodos tienen 1 owner, 2 tienen 2, 20 tienen 3, 2 tienen 4.
-- Ninguno tiene cero.
--
-- El owner NO se mueve a `funnel_node`, y la razón es que no hay caso que pida
-- la diferencia: los tres owners del nodo 52 son las mismas tres personas en
-- los cinco funnels donde se usa. Moverlo multiplicaría 79 filas por hasta
-- cinco para representar algo que nadie pidió distinguir.
--
-- Y quien ejecuta el trabajo no sale de acá: sale de
-- `node_milestone.accountable_employee_key`, que ya es por step. `node_owner`
-- es quién sabe cómo se corre ese nodo, y eso no cambia porque el nodo se reuse.
--
-- ⚠ Si algún día hace falta un owner distinto por funnel, la forma sería una
-- columna nullable en `funnel_node` que sobrescriba a `node_owner`. NO se
-- agrega ahora: un respaldo que nunca se ejerce es una compensación esperando
-- ocultar la próxima ausencia, y hoy no hay un solo caso que lo ejerza.
--
-- La posición SÍ es del nodo-en-el-funnel, y ya lo era: `funnel_node.position`
-- existe desde el principio. No se toca.
--
--
-- ---------------------------------------------------------------------------
-- DECISIÓN 3 — LA COPIA APUNTA A LA COPIA
-- ---------------------------------------------------------------------------
--
-- El plan se copia al activar. Si la dependencia copiada apuntara a la
-- plantilla, desbloquear a Ana desbloquearía a Kiana: las dos tienen hoy el
-- mismo funnel (`Javier Growth Engine`, planes 36 y 47), así que el caso no es
-- hipotético, es el estado actual de la base.
--
-- Por eso `enrollment_node` gana su propia columna, que apunta a otro
-- `enrollment_node` DEL MISMO enrolamiento, y `activate_funnel` la resuelve
-- dentro de la misma transacción.


-- ---------------------------------------------------------------------------
-- 1. LA PLANTILLA
-- ---------------------------------------------------------------------------

alter table business_plan.funnel_node
  add column if not exists depends_on_node_key bigint;

comment on column business_plan.funnel_node.depends_on_node_key is
  'Nodo de ESTE funnel que hay que terminar antes de arrancar este. NULL = no espera a nada, que es el default y no un valor de respaldo. Vive aca y no en node porque 16 de 31 nodos estan en mas de un funnel. Ver BP41.';

-- ⚠ FK COMPUESTA, Y ES LO QUE GARANTIZA "DEL MISMO FUNNEL".
--
-- Apuntando solo a `node(node_key)` se podria declarar como antecesor un nodo
-- que no esta en este funnel, y no habria como saberlo sin mirar otra tabla.
-- Apuntando a `(funnel_key, node_key)` --que es la PK de esta misma tabla-- la
-- base garantiza que el antecesor existe Y que esta en el mismo funnel. Sin
-- trigger, sin chequeo en la app.
--
-- Con MATCH SIMPLE (el default), si `depends_on_node_key` es NULL la
-- restriccion no se evalua. Eso es justo lo que se quiere: sin dependencia, no
-- hay nada que verificar.
--
-- ⚠ `no action` Y NO `restrict`, y la diferencia importa:
-- borrar un funnel entero borra sus `funnel_node` en cascada, en UN statement.
-- `restrict` se evalua fila por fila, asi que abortaria el borrado del funnel
-- por filas que tambien se estan borrando. `no action` se evalua al final del
-- statement, cuando ya no queda nadie apuntando a nadie. Y para el caso que si
-- hay que impedir --sacar UN nodo del que otro depende-- falla igual.
alter table business_plan.funnel_node
  add constraint funnel_node_depends_fk
  foreign key (funnel_key, depends_on_node_key)
  references business_plan.funnel_node (funnel_key, node_key)
  on delete no action;

alter table business_plan.funnel_node
  add constraint funnel_node_depends_not_self
  check (depends_on_node_key is null or depends_on_node_key <> node_key);


-- ---------------------------------------------------------------------------
-- 2. LA POSICIÓN COMO CONSECUENCIA — Y POR QUÉ LA UNICIDAD VA DIFERIDA
-- ---------------------------------------------------------------------------
--
-- Hoy `funnel_node` tiene `funnel_node_order_idx (funnel_key, position)` pero
-- NO es unico: dos nodos del mismo funnel pueden compartir posicion. Medido,
-- hoy no pasa en ninguno de los nueve, asi que es un caso latente -- el mismo
-- que BP40 cerro para los steps.
--
-- ⚠ SE AGREGA COMO CONSTRAINT DIFERIBLE, NO COMO INDICE UNICO.
--
-- Un reordenamiento intercambia posiciones, y a mitad del renumerado dos filas
-- comparten valor inevitablemente. Un indice unico se evalua a medida que el
-- statement escribe cada fila, asi que el intercambio falla. Una constraint
-- `deferrable initially deferred` se evalua al COMMIT, cuando el renumerado ya
-- termino. Sin esto, arrastrar no puede funcionar.
alter table business_plan.funnel_node
  add constraint funnel_node_position_uk unique (funnel_key, position)
  deferrable initially deferred;

-- ⚠⚠ Y EL MISMO PROBLEMA EXISTE YA EN LOS STEPS, DE BP40.
--
-- `node_milestone_node_position_uk` se creo como CREATE UNIQUE INDEX, que no se
-- puede diferir. Con ese indice, renumerar los steps de un nodo falla en
-- cuanto dos filas coincidan a mitad de camino -- o sea, en cualquier
-- intercambio. Arrastrar steps no puede funcionar mientras siga siendo indice.
--
-- Se reemplaza por la constraint equivalente diferible. El indice de orden
-- (`node_milestone_order_idx`) se queda: sirve para leer, no para restringir.
drop index if exists business_plan.node_milestone_node_position_uk;

alter table business_plan.node_milestone
  add constraint node_milestone_position_uk unique (node_key, position)
  deferrable initially deferred;


-- ---------------------------------------------------------------------------
-- 3. ARRASTRAR NO PUEDE ROMPER UNA DEPENDENCIA
-- ---------------------------------------------------------------------------
--
-- La regla: el antecesor tiene que estar ANTES. Se verifica en la base y no en
-- la app, y eso da dos cosas de un solo trigger:
--
--   · arrastrar un nodo arriba de su antecesor se rechaza, con lo cual lo peor
--     que puede pasar es que la pantalla lo devuelva -- nunca que quede un
--     funnel con una dependencia imposible;
--   · los ciclos quedan descartados POR CONSTRUCCION. Si todo antecesor tiene
--     posicion menor, A->B->A no se puede escribir. No hace falta un chequeo
--     recursivo de ciclos, que era la otra opcion y es mucho mas caro.
--
-- ⚠ `deferrable initially deferred` es esencial, por lo mismo que la unicidad:
-- un reordenamiento pasa por estados intermedios invalidos. Verificando fila
-- por fila, mover el ultimo nodo al principio fallaria aunque el resultado
-- final sea consistente.
--
-- ⚠ Y verifica EL FUNNEL ENTERO, no la fila que cambio. Un reordenamiento
-- reescribe varias filas; comprobando solo la que dispara el trigger se puede
-- dejar pasar una violacion que quedo en otra.
create or replace function business_plan.funnel_node_dep_order_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_funnel bigint := coalesce(new.funnel_key, old.funnel_key);
  v_bad text;
begin
  select string_agg(n.name || ' waits for ' || d.name, '; ')
    into v_bad
  from business_plan.funnel_node fn
  join business_plan.funnel_node dep
    on dep.funnel_key = fn.funnel_key
   and dep.node_key = fn.depends_on_node_key
  join business_plan.node n on n.node_key = fn.node_key
  join business_plan.node d on d.node_key = dep.node_key
  where fn.funnel_key = v_funnel
    and dep.position >= fn.position;

  if v_bad is not null then
    -- El mensaje dice los NOMBRES, no las posiciones: es el que va a llegar a
    -- la pantalla, y nadie deberia tener que ir a contar nodos.
    raise exception 'a node cannot come before the node it waits for: %', v_bad
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger funnel_node_dep_order
  after insert or update on business_plan.funnel_node
  deferrable initially deferred
  for each row
  execute function business_plan.funnel_node_dep_order_check();


-- ---------------------------------------------------------------------------
-- 4. REORDENAR: UNA LLAMADA, UNA TRANSACCIÓN
-- ---------------------------------------------------------------------------
--
-- La posicion es una CONSECUENCIA del orden en que quedaron las tarjetas, asi
-- que no se escribe: se manda el orden y la base renumera 1..N.
--
-- Va como funcion y no como PATCH desde el cliente por las restricciones
-- diferidas de arriba: se evaluan al commit, y con PostgREST cada request es su
-- propia transaccion. Repartido en varias requests, el estado intermedio se
-- confirma y falla. Una sola llamada = una sola transaccion = un solo commit.
create or replace function business_plan.reorder_funnel_nodes(
  p_funnel_key bigint,
  p_node_keys bigint[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
  v_total integer;
begin
  select count(*) into v_total
  from business_plan.funnel_node where funnel_key = p_funnel_key;

  -- ⚠ Se exige la lista COMPLETA. Con una parcial habria que decidir donde van
  -- los que faltan, y cualquier respuesta seria inventada.
  if array_length(p_node_keys, 1) is distinct from v_total then
    raise exception 'reorder needs every node of the funnel: got %, funnel has %',
      coalesce(array_length(p_node_keys, 1), 0), v_total;
  end if;

  update business_plan.funnel_node fn
     set position = t.ord
    from (select unnest(p_node_keys) as node_key,
                 generate_subscripts(p_node_keys, 1) as ord) t
   where fn.funnel_key = p_funnel_key
     and fn.node_key = t.node_key;

  get diagnostics v_n = row_count;
  if v_n <> v_total then
    raise exception 'reorder touched % of % nodes: the list has keys that are not in this funnel', v_n, v_total;
  end if;
  return v_n;
end;
$$;

grant execute on function business_plan.reorder_funnel_nodes(bigint, bigint[]) to authenticated;

comment on function business_plan.reorder_funnel_nodes(bigint, bigint[]) is
  'Renumera 1..N los nodos de un funnel en el orden recibido. Una transaccion, para que las restricciones diferidas se evaluen una sola vez al final. Ver BP41.';


create or replace function business_plan.reorder_node_steps(
  p_node_key bigint,
  p_milestone_keys bigint[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
  v_total integer;
begin
  select count(*) into v_total
  from business_plan.node_milestone where node_key = p_node_key;

  if array_length(p_milestone_keys, 1) is distinct from v_total then
    raise exception 'reorder needs every step of the node: got %, node has %',
      coalesce(array_length(p_milestone_keys, 1), 0), v_total;
  end if;

  update business_plan.node_milestone m
     set position = t.ord
    from (select unnest(p_milestone_keys) as milestone_key,
                 generate_subscripts(p_milestone_keys, 1) as ord) t
   where m.node_key = p_node_key
     and m.milestone_key = t.milestone_key;

  get diagnostics v_n = row_count;
  if v_n <> v_total then
    raise exception 'reorder touched % of % steps: the list has keys that are not in this node', v_n, v_total;
  end if;
  return v_n;
end;
$$;

grant execute on function business_plan.reorder_node_steps(bigint, bigint[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. LA COPIA
-- ---------------------------------------------------------------------------
--
-- La FK compuesta necesita una unicidad que la respalde. La PK
-- (`enrollment_node_key`) ya es unica, asi que `(enrollment_key,
-- enrollment_node_key)` tambien lo es -- pero Postgres exige la constraint
-- declarada para poder referenciarla.
alter table business_plan.enrollment_node
  add constraint enrollment_node_enr_uk unique (enrollment_key, enrollment_node_key);

alter table business_plan.enrollment_node
  add column if not exists depends_on_enrollment_node_key bigint;

comment on column business_plan.enrollment_node.depends_on_enrollment_node_key is
  'El nodo COPIADO de esta persona que hay que terminar antes. Apunta a otro enrollment_node del MISMO enrolamiento, nunca a la plantilla: apuntando a la plantilla, desbloquear a Ana desbloquearia a Kiana -- las dos tienen hoy el mismo funnel. Ver BP41.';

-- Misma FK compuesta y mismo `no action` que en la plantilla, y por la misma
-- razon: cancelar un plan borra sus `enrollment_node` en cascada, en un
-- statement. Con `restrict` el `cancel_funnel` de BP40 se rompe.
alter table business_plan.enrollment_node
  add constraint enrollment_node_depends_fk
  foreign key (enrollment_key, depends_on_enrollment_node_key)
  references business_plan.enrollment_node (enrollment_key, enrollment_node_key)
  on delete no action;

alter table business_plan.enrollment_node
  add constraint enrollment_node_depends_not_self
  check (depends_on_enrollment_node_key is null
         or depends_on_enrollment_node_key <> enrollment_node_key);


-- ---------------------------------------------------------------------------
-- 6. `activate_funnel` RESUELVE PLANTILLA -> COPIA
-- ---------------------------------------------------------------------------
--
-- ⚠ EN DOS PASADAS, Y NO ES OPCIONAL.
--
-- Un nodo puede depender de otro que todavia no se inserto. Hoy las
-- dependencias van a apuntar siempre hacia atras --los funnels son
-- secuenciales-- asi que una sola pasada funcionaria por casualidad. Se hace en
-- dos igual: la primera inserta todos los nodos, la segunda resuelve las
-- dependencias contra las claves ya existentes. Depender del orden de
-- insercion seria correcto hoy y silenciosamente incorrecto con el primer
-- funnel que tenga paralelismo.
--
-- El JSON del plan gana un campo por nodo:
--   "depends_on_source_node_key": 42   -- o null
--
-- El bloque que sigue va DENTRO de `activate_funnel`, despues del bucle que
-- inserta los `enrollment_node` y antes de insertar los milestones. Se entrega
-- como fragmento y no como funcion completa a proposito: reescribir entera una
-- funcion que ya corre en produccion es mas riesgo que el que agrega la etapa.
--
--   -- 2b. Las dependencias, resueltas contra las copias recien insertadas.
--   update business_plan.enrollment_node en
--      set depends_on_enrollment_node_key = dep.enrollment_node_key
--     from jsonb_array_elements(p_plan) as j
--     join business_plan.enrollment_node dep
--       on dep.enrollment_key = v_enrollment
--      and dep.source_node_key = (j.value ->> 'depends_on_source_node_key')::bigint
--    where en.enrollment_key = v_enrollment
--      and en.source_node_key = (j.value ->> 'source_node_key')::bigint
--      and j.value ->> 'depends_on_source_node_key' is not null;
--
--   -- ⚠ Y SE VERIFICA QUE NO QUEDO NINGUNA SIN RESOLVER. Si el plan declara un
--   -- antecesor que no esta entre los nodos copiados, la dependencia se
--   -- perderia en silencio y el plan arrancaria sin el bloqueo que pedia.
--   if exists (
--     select 1 from jsonb_array_elements(p_plan) as j
--     where j.value ->> 'depends_on_source_node_key' is not null
--       and not exists (
--         select 1 from business_plan.enrollment_node dep
--         where dep.enrollment_key = v_enrollment
--           and dep.source_node_key = (j.value ->> 'depends_on_source_node_key')::bigint
--       )
--   ) then
--     raise exception 'the plan declares a dependency on a node that is not in it';
--   end if;


-- ---------------------------------------------------------------------------
-- 7. QUÉ VERIFICAR DESPUÉS DE APLICAR
-- ---------------------------------------------------------------------------
--
-- Tres cosas que NO se pueden comprobar sin la migracion puesta, y que hay que
-- comprobar sobre un plan descartable --no sobre 36, 47 ni 48--:
--
--   a. Que `cancel_funnel` siga funcionando. Es el `no action` de los puntos 1
--      y 5: si me equivoque y se comporta como `restrict`, cancelar un plan con
--      dependencias falla. Es la razon por la que esto se prueba antes de
--      ofrecer el boton.
--
--   b. Que un intercambio de posiciones pase. Es la unicidad diferida: si la
--      constraint quedo como indice, arrastrar falla en el primer swap.
--
--   c. Que arrastrar un nodo arriba de su antecesor se RECHACE, con el mensaje
--      que trae los nombres.
--
-- Las tres son reproducibles con un funnel de prueba y un enrolamiento de un
-- empleado sin plan.
