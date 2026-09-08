-- ===========================================================================
-- BP40 — EL ÁREA DE UN NODO, Y EL ORDEN DE SUS STEPS
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor.
--
-- Dos cosas que hoy no tienen dónde vivir y por eso viven mal:
--
--   1. el ÁREA de un nodo, hoy como prefijo de la descripción
--   2. el ORDEN de sus steps, hoy sin garantía de ser único
--
--
-- ---------------------------------------------------------------------------
-- 1. EL ÁREA — por qué una columna y no un prefijo
-- ---------------------------------------------------------------------------
--
-- `Marketing.`, `Sales Coaching.` y `Performance.` viven como primeras palabras
-- de `description`, hasta el primer punto. Funciona mientras todos lo respeten,
-- y ya se rompió. Medido sobre los 31 nodos:
--
--   25  tienen un prefijo que es un área conocida  -> se migran solos
--    4  no tienen prefijo ninguno                  -> quedan vacíos
--    2  guardaron un PÁRRAFO entero donde iba      -> quedan vacíos
--
-- Los seis quedan en NULL y VISIBLES, para que Isabella los asigne. No se
-- adivinan: dos de ellos ni siquiera tienen un prefijo del que partir --
-- empiezan con "Sesión 1 – Growth & B2B Outreach\nDespués de completar su
-- onboarding..." -- así que cualquier heurística estaría inventando.
--
-- ⚠ NULL Y NO UN 'Sin área'. Un valor de relleno se vuelve indistinguible de
-- una decisión el día que alguien elija ese valor a propósito. NULL dice que
-- nadie decidió, que es la verdad. Es la misma distinción que sostiene el
-- benchmark vacío en Outlook.
--
-- ⚠ Y LA DESCRIPCIÓN NO SE TOCA. Sacarle el prefijo sería reescribir texto que
-- alguien redactó, y para 25 filas la ganancia es cosmética. La columna manda
-- desde que existe; el prefijo queda como residuo legible.


-- ---------------------------------------------------------------------------
-- PASO 1 — la columna
-- ---------------------------------------------------------------------------

alter table business_plan.node
  add column if not exists area text;

-- ⚠ El CHECK acepta NULL a propósito: `check` no rechaza NULL, así que los seis
-- sin asignar pasan. Lo que impide es un área inventada -- un 'marketing' en
-- minúscula, o un 'Sales' que no es ninguna de las cuatro.
alter table business_plan.node
  drop constraint if exists node_area_check;
alter table business_plan.node
  add constraint node_area_check
  check (area is null or area in ('Marketing', 'Sales Coaching', 'Performance', 'IT'));

comment on column business_plan.node.area is
  'Area a la que pertenece el nodo. NULL = nadie la asigno todavia, no "sin area". Antes vivia como prefijo de description hasta el primer punto; ver BP40.';


-- ---------------------------------------------------------------------------
-- PASO 2 — migrar los 25 que se pueden derivar
-- ---------------------------------------------------------------------------
--
-- ⚠ SOLO LOS QUE COINCIDEN EXACTO con una de las cuatro áreas. El `split_part`
-- corta en el primer punto; si lo que queda no es un área conocida, la fila no
-- se toca y queda en NULL -- que es lo que tiene que pasar con los dos que
-- guardaron un párrafo, porque su "prefijo" mide sesenta caracteres.

update business_plan.node
   set area = trim(split_part(description, '.', 1))
 where area is null
   and trim(split_part(description, '.', 1)) in
       ('Marketing', 'Sales Coaching', 'Performance', 'IT');

-- Comprobación: tiene que dar 25 con área y 6 sin ella.
--
--   select count(*) filter (where area is not null) as con_area,
--          count(*) filter (where area is null)     as sin_area
--   from business_plan.node;
--
-- Y los seis, por nombre, que son los que hay que asignar a mano:
--
--   select node_key, name from business_plan.node where area is null order by node_key;


-- ---------------------------------------------------------------------------
-- PASO 3 — desempatar el orden de los steps
-- ---------------------------------------------------------------------------
--
-- ⚠ EL PROBLEMA, Y POR QUÉ RECIÉN AHORA IMPORTA. `node_milestone.position` no
-- tiene índice único, y había UN nodo con dos steps en la posición 1:
--
--   [27] Social Media Organic Pre-Funnel
--        pos 1  key 144  sla 5   "Define organic content topics"
--        pos 1  key 162  sla 1   "Social Media Set Up"
--
-- Hasta acá no molestaba porque el SLA se leía como día absoluto: cada step
-- decía su día por su cuenta y el orden entre dos empatados no cambiaba nada.
-- Con el SLA acumulativo (paso 4) el orden DECIDE el día de todos los que
-- siguen, así que un empate vuelve ambiguo el resto del nodo.
--
-- ⚠ Y EL DESEMPATE AUTOMÁTICO DABA EL ORDEN EQUIVOCADO. Por `milestone_key` --y
-- por `created_at`, que dan lo mismo-- iría primero "Define organic content
-- topics" por tener la clave más baja. Pero "Social Media Set Up" tiene la clave
-- MÁS ALTA y va antes: configurar la cuenta precede a definir los temas, y su
-- SLA de 1 contra 5 lo confirma. Es un step agregado después a un nodo que ya
-- existía, y ninguna regla automática lo hubiera acertado.
--
-- Las copias de los tres planes activos no tienen ninguna posición repetida, así
-- que esto sólo toca la plantilla.

update business_plan.node_milestone set position = 1 where milestone_key = 162;
update business_plan.node_milestone set position = 2 where milestone_key = 144;
update business_plan.node_milestone set position = position + 1
 where node_key = 27 and milestone_key not in (144, 162);

-- Y que no vuelva a pasar. Va DESPUÉS de los updates: con el empate puesto,
-- crear el índice falla -- y si falla, lo que hay que arreglar es el empate.
create unique index if not exists node_milestone_node_position_uk
  on business_plan.node_milestone (node_key, position);

-- Comprobación previa, por si el índice se rechaza:
--
--   select node_key, position, count(*)
--   from business_plan.node_milestone group by 1, 2 having count(*) > 1;
--
-- Cero filas = se puede crear.


-- ---------------------------------------------------------------------------
-- PASO 4 — el SLA pasa a ser RELATIVO al step anterior
-- ---------------------------------------------------------------------------
--
-- ⚠ ESTO CAMBIA EL SIGNIFICADO DE DATOS QUE YA EXISTEN, y por eso la migración
-- va junto con el cambio y no después.
--
-- Hoy `sla_days` es el día ABSOLUTO dentro del nodo. Pasa a ser los días desde
-- el step anterior, y el día del nodo es la suma corrida.
--
-- ⚠ SIN MIGRAR, 72 DE LOS 106 STEPS CAMBIARÍAN DE DÍA, algunos a lugares que no
-- se sostienen: `Recruitment - Retain & Develop` pos 4 pasaría del día 90 al
-- 240, y el funnel `Community Referrals` de 194 días a 532.
--
-- La prueba de que los datos son absolutos está en los pares repetidos: ese
-- mismo nodo tiene dos steps seguidos con SLA 60, y `Marketing Campaigns` dos
-- con 44. Como absolutos son "dos cosas el mismo día". Como incrementos serían
-- 60 y 120 -- y nadie escribe dos veces "60 días después del anterior" para
-- decir eso.
--
-- Por eso se convierte cada absoluto a su delta: `sla[i] - sla[i-1]`. Con eso el
-- día acumulado NO se mueve y la lectura nueva rige desde acá.
--
-- ⚠ TRES STEPS SÍ SE MUEVEN, y son los que Isabella corrigió a propósito. Los
-- datos tenían dos steps que vencían ANTES que el anterior -- imposibles bajo la
-- lectura nueva, e invisibles bajo la vieja porque cada uno decía su día solo:
--
--   Community Presence  "Contact capture"       día  8 -> 14   (delta 1)
--   Community Presence  "Post-event follow-up"  día 11 -> 17   (arrastre del anterior)
--   Webinars            "Attendee follow-up"    día 62 -> 66   (delta 2)
--
-- El segundo no se corrigió: se mueve porque el primero se movió. Es inherente a
-- un SLA acumulativo -- correr un step corre a todos los que siguen en su nodo--
-- y conviene saberlo antes de tocar cualquier otro.
--
-- Los otros 100 steps conservan su día exacto.

update business_plan.node_milestone set sla_days = 0 where milestone_key in (71, 96, 112, 115, 116, 132, 137, 146, 154, 155);
update business_plan.node_milestone set sla_days = 1 where milestone_key in (57, 65, 75, 82, 85, 95, 98, 105, 108, 114, 120, 121, 125, 128, 141, 160, 166, 167, 168, 169);
update business_plan.node_milestone set sla_days = 2 where milestone_key in (81, 88, 94, 97, 103, 106, 119, 124, 127, 142, 147, 159);
update business_plan.node_milestone set sla_days = 3 where milestone_key in (58, 72, 80, 86, 90, 99, 109, 123, 131, 143, 157);
update business_plan.node_milestone set sla_days = 4 where milestone_key in (76, 77, 144, 153);
update business_plan.node_milestone set sla_days = 5 where milestone_key in (101, 102, 110, 129, 133);
update business_plan.node_milestone set sla_days = 7 where milestone_key in (91);
update business_plan.node_milestone set sla_days = 8 where milestone_key in (84);
update business_plan.node_milestone set sla_days = 21 where milestone_key in (163);
update business_plan.node_milestone set sla_days = 25 where milestone_key in (145);
update business_plan.node_milestone set sla_days = 26 where milestone_key in (73, 107);
update business_plan.node_milestone set sla_days = 30 where milestone_key in (111, 136, 138, 158);

-- ⚠ CÓMO COMPROBARLO. El día acumulado de cada step, que tiene que dar lo mismo
-- que antes salvo en los tres de arriba:
--
--   select n.name, m.position, m.title, m.sla_days as delta,
--          sum(m.sla_days) over (partition by m.node_key
--                                order by m.position
--                                rows between unbounded preceding and current row) as dia
--   from business_plan.node_milestone m
--   join business_plan.node n using (node_key)
--   order by n.name, m.position;
--
-- Y que no quede ningún delta negativo, que es lo que la migración vino a
-- eliminar:
--
--   select * from business_plan.node_milestone where sla_days < 0;
--
-- Cero filas.
