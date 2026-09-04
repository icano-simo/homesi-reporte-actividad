-- ============================================================================
-- BP44 — LAS ÁREAS PASAN A SER DATOS, NO UN CHECK
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor. Y va en DOS FASES: ver el final.
--
-- Hoy `node.area` es texto con `node_area_check` fijando cuatro valores, así
-- que renombrar o agregar un área es una migración. Medido contra la base:
-- 32 nodos, `Sales Coaching`=14, `Marketing`=7, `Performance`=3, `IT`=1 y
-- 7 sin asignar.
--
--
-- ---------------------------------------------------------------------------
-- LO QUE HACE FÁCIL ESTE CAMBIO: EL CÓDIGO NO COMPARA NOMBRES
-- ---------------------------------------------------------------------------
--
-- Inventario, el mismo que se hizo para los estados en BP42:
--
--   · UN solo lugar tiene los nombres literales -- `NODE_AREAS` en
--     `lib/business-plan/funnels.ts:41`.
--   · CERO comparaciones tipo `=== 'Marketing'` en toda la app.
--   · Las 8 apariciones restantes derivan de esa constante: iteran
--     `NODE_AREAS` o usan el tipo `NodeArea`, que sale de ella.
--
-- Contra los 32 lugares del renombre de estados, esto es un cambio contenido.
--
-- ⚠ PERO SE PIERDE UNA COSA, Y CONVIENE DECIRLA: `NodeArea` es hoy un tipo
-- unión derivado de la constante, así que un área mal escrita es un error de
-- compilación. Con áreas editables el tipo pasa a ser una clave numérica y esa
-- red desaparece: el compilador ya no puede saber qué áreas existen. Lo
-- reemplaza la FK, que atrapa lo mismo pero en tiempo de ejecución.


-- ---------------------------------------------------------------------------
-- 1. LA TABLA
-- ---------------------------------------------------------------------------

create table if not exists business_plan.area (
  area_key    bigint generated always as identity primary key,
  name        text not null,
  /*
   * El orden de los grupos en la biblioteca. Explícito, porque sin él el grupo
   * salta de lugar cada vez que alguien agrega un área.
   *
   * ⚠ NO ES ÚNICO, Y ES DELIBERADO. La otra opción era una constraint única
   * diferible como en `funnel_node` --con su RPC de reordenamiento-- y para una
   * tabla de cuatro a diez filas es maquinaria de más. El orden se hace
   * determinista por el criterio de desempate: se lee siempre
   * `order by position, name`, así que dos áreas en la misma posición salen
   * alfabéticas y nunca "saltan".
   *
   * La diferencia práctica: con la constraint hay que pelear el intercambio; con
   * el desempate, poner las dos en 3 es válido y el resultado sigue siendo
   * estable. Para reordenar de verdad basta con reescribir las posiciones.
   */
  position    integer not null default 0,
  /*
   * Desactivar en vez de borrar: un área desactivada deja de ofrecerse para
   * asignar, pero los nodos que ya la tienen la siguen mostrando. Es el mismo
   * criterio que `funnel.is_active`, donde un funnel desactivado no se puede
   * elegir de nuevo pero los planes en curso siguen funcionando.
   */
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text
);

-- ⚠ ÚNICO SOBRE `lower(name)` Y NO SOBRE `name`. Dos áreas llamadas `Marketing`
-- y `marketing` serían indistinguibles en la pantalla y el usuario no tendría
-- forma de saber a cuál asignó un nodo. El índice funcional lo impide.
create unique index if not exists area_name_uk
  on business_plan.area (lower(name));

comment on table business_plan.area is
  'Areas de los nodos, editables. Reemplaza al CHECK de cuatro valores de node.area. Se lee siempre `order by position, name`: la posicion no es unica y el nombre desempata, asi que el orden es determinista sin necesidar una constraint diferible. Ver BP44.';

alter table business_plan.area enable row level security;

create policy area_select on business_plan.area
  for select using (business_plan.has_access());
create policy area_insert on business_plan.area
  for insert with check (business_plan.has_access());
create policy area_update on business_plan.area
  for update using (business_plan.has_access()) with check (business_plan.has_access());
/*
 * ⚠ NO HAY POLICY DE DELETE, a propósito. Un área se DESACTIVA, no se borra: si
 * se borrara, habría que decidir qué pasa con sus nodos, y las dos respuestas
 * son malas -- perderlos de vista o dejarlos apuntando a nada. Sin policy, el
 * intento no falla: RLS filtra y devuelve cero filas, así que la app tiene que
 * mirar las filas afectadas. Es exactamente el silencio que BP42 documentó, y
 * por eso el `.select()` de `patchMilestone` es el patrón a repetir acá.
 */


-- ---------------------------------------------------------------------------
-- 2. LA CLAVE EN `node`
-- ---------------------------------------------------------------------------

alter table business_plan.node
  add column if not exists area_key bigint;

-- `no action` y no `restrict`, por lo mismo que en BP41: `restrict` se evalúa
-- fila por fila y rompería cualquier borrado múltiple. Igual, el caso que
-- importa --borrar un área que tiene nodos-- se sigue impidiendo.
alter table business_plan.node
  add constraint node_area_fk
  foreign key (area_key) references business_plan.area (area_key)
  on delete no action;

comment on column business_plan.node.area_key is
  'Area del nodo. NULL = nadie la asigno todavia, que no es lo mismo que "sin area". Renombrar el area es una sola fila en business_plan.area: los nodos no guardan el nombre. Ver BP44.';


-- ---------------------------------------------------------------------------
-- 3. DESACTIVAR UN ÁREA CON NODOS: SE PROHÍBE
-- ---------------------------------------------------------------------------
--
-- De acuerdo con la propuesta, y se hace en la BASE y no en la app: la app no
-- es el único escritor -- este mismo archivo, el editor de SQL y cualquier
-- script pueden tocar la tabla.
--
-- El mensaje dice CUÁNTOS nodos la usan, porque "no se puede desactivar" sin el
-- número no dice qué hacer. Con el número, la acción es obvia: reasignar esos N.
create or replace function business_plan.area_deactivate_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if new.is_active or old.is_active = new.is_active then
    return new;
  end if;
  select count(*) into v_n from business_plan.node where area_key = new.area_key;
  if v_n > 0 then
    raise exception
      'cannot deactivate "%": % node(s) still use it. Reassign them first.', new.name, v_n
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger area_deactivate_guard
  before update of is_active on business_plan.area
  for each row
  execute function business_plan.area_deactivate_guard();


-- ---------------------------------------------------------------------------
-- 4. LOS CUATRO QUE YA EXISTEN
-- ---------------------------------------------------------------------------
--
-- El orden es el que ya usa la biblioteca --el de `NODE_AREAS`-- y no el
-- alfabético: es el orden en que la división piensa sus áreas.
insert into business_plan.area (name, position)
values ('Marketing', 1), ('Sales Coaching', 2), ('Performance', 3), ('IT', 4)
on conflict do nothing;

update business_plan.node n
   set area_key = a.area_key
  from business_plan.area a
 where a.name = n.area
   and n.area_key is null;

-- ⚠ SE VERIFICA EL BACKFILL ANTES DE SEGUIR. Un nodo con `area` puesta y
-- `area_key` en null significa que su texto no matcheó ninguna área, y eso hay
-- que verlo ahora y no cuando la columna de texto ya no exista.
do $chk$
declare v text;
begin
  select string_agg(name || ' (area=' || area || ')', ', ')
    into v
  from business_plan.node
  where area is not null and area_key is null;
  if v is not null then
    raise exception 'nodos con area sin migrar: %', v;
  end if;
  raise notice 'backfill: % nodos con area_key, % sin asignar',
    (select count(*) from business_plan.node where area_key is not null),
    (select count(*) from business_plan.node where area_key is null);
end $chk$;


-- ---------------------------------------------------------------------------
-- 5. EL PUENTE, QUE ES LO QUE HACE QUE NO HAYA CORTE
-- ---------------------------------------------------------------------------
--
-- ⚠ ESTA ES LA DIFERENCIA CON BP42, Y ES A PROPÓSITO.
--
-- En el renombre de estados no había ventana tolerable: primero el SQL, después
-- el código, y en el medio la pantalla no guardaba. Acá se puede hacer mejor,
-- porque las dos representaciones pueden coexistir.
--
-- Mientras las dos columnas existan, un trigger mantiene `node.area` (texto) en
-- sincronía desde `area_key`. Resultado:
--
--   · el código desplegado, que lee `node.area`, sigue funcionando;
--   · el código nuevo, que escribe `area_key`, también;
--   · y la fase B --abajo-- se aplica cuando el código nuevo ya está arriba.
--
-- El `node_area_check` se cae ahora: si alguien renombra un área, el texto
-- sincronizado dejaría de estar entre los cuatro valores y el check lo
-- rechazaría. El check deja de ser la autoridad; la FK lo es.
alter table business_plan.node
  drop constraint if exists node_area_check;

create or replace function business_plan.node_area_text_sync()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select a.name into new.area
  from business_plan.area a
  where a.area_key = new.area_key;
  return new;
end;
$$;

create trigger node_area_text_sync
  before insert or update of area_key on business_plan.node
  for each row
  execute function business_plan.node_area_text_sync();

-- Y si se renombra un área, el texto de sus nodos también se actualiza.
create or replace function business_plan.area_rename_sync()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    update business_plan.node set area = new.name where area_key = new.area_key;
  end if;
  return new;
end;
$$;

create trigger area_rename_sync
  after update of name on business_plan.area
  for each row
  execute function business_plan.area_rename_sync();


-- ---------------------------------------------------------------------------
-- FASE B — DESPUÉS de que el código nuevo esté desplegado
-- ---------------------------------------------------------------------------
--
-- No se ejecuta con lo de arriba. Se ejecuta cuando la app ya lee `area_key` y
-- nadie lee `node.area`.
--
--   drop trigger if exists node_area_text_sync on business_plan.node;
--   drop trigger if exists area_rename_sync on business_plan.area;
--   drop function if exists business_plan.node_area_text_sync();
--   drop function if exists business_plan.area_rename_sync();
--   alter table business_plan.node drop column area;
--
-- ⚠ Y ANTES DE LA FASE B, COMPROBAR QUE NADIE LEE EL TEXTO:
--
--   grep -rn "\.area\b" app lib --include=*.ts --include=*.tsx
--
-- Tiene que devolver sólo usos de `area_key` o del nombre resuelto desde la
-- tabla. Si queda uno leyendo `node.area`, la fase B lo rompe en silencio: la
-- columna deja de existir y PostgREST devuelve el resto de la fila sin ella,
-- así que la pantalla mostraría "sin área" para todos.


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBAR QUE QUEDÓ
-- ---------------------------------------------------------------------------
--
--   -- las cuatro areas, con su orden
--   select area_key, name, position, is_active from business_plan.area
--    order by position, name;
--
--   -- el reparto, que tiene que dar igual que antes:
--   -- Sales Coaching 14, Marketing 7, Performance 3, IT 1, sin asignar 7
--   select coalesce(a.name,'(sin asignar)') , count(*)
--     from business_plan.node n
--     left join business_plan.area a on a.area_key = n.area_key
--    group by 1 order by 2 desc;
--
--   -- y que el puente funciona: texto y clave dicen lo mismo
--   select count(*) from business_plan.node n
--     join business_plan.area a on a.area_key = n.area_key
--    where n.area is distinct from a.name;
--   -- debe dar 0
