-- ============================================================================
-- DOS BRANCHES QUE SON UNO: `org.branch_group` — etapa OL29
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- QUE PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- Jonathan Valenzuela abrio oficina propia --el 777-- y sigue siendo un Loan
-- Officer del 710. Su produccion quedo en el 710 porque ahi se origino, asi que
-- hoy:
--
--   · el 777 aparece vacio: 1 cerrado en septiembre y nada antes;
--   · sus 4 cierres caen en la reconciliacion del 710, con el rotulo «closed by
--     loan officers from other branches» -- que es cierto de Gian Laino (del
--     747) y NO de el.
--
-- No hay que mover prestamos: mover los 4 al 777 dejaria a Gian igual y
-- escondería que son dos casos distintos con el mismo sintoma. Hay que tratar
-- los dos branches como uno.
--
-- ---------------------------------------------------------------------------
-- ⚠ COMO DATO, NO COMO CONDICION EN EL CODIGO
-- ---------------------------------------------------------------------------
-- Una regla `if (branch === '710' || branch === '777')` queda vieja el dia que
-- alguien mas abra oficina, y queda vieja SIN AVISAR: nada falla, simplemente
-- el branch nuevo vuelve a aparecer vacio con su produccion en la
-- reconciliacion de otro. Es el mismo criterio que `review.step.gate_config` y
-- que `outlook.strategy_benchmark`: si mañana cambia, que cambie con un INSERT.
--
-- Y EL MOTIVO VA EN LA FILA. Un agrupamiento sin razon escrita es
-- indistinguible de un error de carga dentro de seis meses; con la razon, la
-- pregunta «¿por que estos dos juntos?» se contesta en la misma consulta que
-- los lista.
--
-- ---------------------------------------------------------------------------
-- ⚠ Y NO ES `org.branch_alias`, QUE YA EXISTE. Se miro antes de proponer una
-- tabla nueva --el mismo reflejo que el `git grep` antes de nombrar una clase,
-- que este proyecto ya se cobro siete veces-- y contesta otra pregunta: 57
-- filas `(source_system, name_raw) -> branch_key` que dicen COMO SE ESCRIBE un
-- branch en Salesforce y en slquery. Es normalizacion de nombres de origen, no
-- agrupamiento de branches, y ademas hoy no la lee ningun codigo de la app.
-- Meter el grupo ahi mezclaria «el 710 se escribe 710» con «el 777 se lee junto
-- al 710», que son cosas distintas y cambian por motivos distintos.

begin;

create table if not exists org.branch_group (
  /*
   * ⚠ LA CLAVE ES EL BRANCH, NO EL PAR: un branch pertenece a UN grupo. Con el
   * par (branch, grupo) como clave, el mismo branch podria estar en dos y no
   * habria forma de decidir cual vale al agregar. Esto lo hace imposible en vez
   * de improbable.
   */
  branch_code text primary key,

  /*
   * El grupo al que pertenece. Es UN CODIGO DE BRANCH, no un identificador
   * nuevo: el grupo se llama como su branch principal.
   *
   * ⚠ Y ESA ES LA PRIMERA DE LAS TRES DECISIONES DEL BRIEF -- como se llama en
   * pantalla. Se eligio el codigo del principal --«710», con una marca que dice
   * «includes 777»-- y no «710 + 777» ni un nombre propio:
   *
   *   · «710 + 777» se rompe solo al tercer branch, y obliga a cambiar el
   *     rotulo de todas las pantallas cada vez que el grupo crece;
   *   · un nombre propio («Miami Norte») hay que mantenerlo, y nadie lo va a
   *     hacer: el dia que cambie la realidad va a quedar un nombre lindo
   *     describiendo otra cosa;
   *   · el codigo del principal ya es como la gente lo llama, y la marca dice
   *     lo que falta sin ocupar la columna.
   *
   * El principal es el que se apunta a si mismo: `branch_code = group_code`.
   * Eso hace que la fila del principal EXISTA, que es lo que permite escribir
   * su razon y no tener un grupo cuya cabeza es implicita.
   */
  group_code text not null,

  /*
   * ⚠ POR QUE ESTAN JUNTOS, EN LA FILA. No en un documento, no en un commit:
   * acá, donde lo lee quien consulta la tabla.
   */
  reason text not null check (length(btrim(reason)) > 0),

  created_by text not null,
  created_at timestamptz not null default now(),

  /*
   * Un grupo no puede apuntar a un grupo: si `A -> B`, entonces B tiene que
   * apuntarse a si mismo. Sin esto habria cadenas --A a B, B a C-- y resolverlas
   * exige un recorrido que la app no hace y que nadie escribio.
   */
  constraint branch_group_no_encadenado
    foreign key (group_code) references org.branch_group (branch_code)
    deferrable initially deferred
);

comment on table org.branch_group is
  'OL29. Branches que Outlook trata como UNO solo al leer produccion. El grupo se llama como su branch principal, que es la fila que se apunta a si misma. No mueve prestamos ni toca el roster: 777 sigue existiendo como branch propio en org.roster_current, que es donde vive la realidad de RRHH. Esto dice como se LEE la produccion, no donde esta la gente.';

comment on column org.branch_group.reason is
  'Por que estos branches son uno. Obligatorio y no vacio: un agrupamiento sin razon escrita es indistinguible de un error de carga seis meses despues.';

-- ---------------------------------------------------------------------------
-- RLS: se lee con el claim de la app, y no se escribe desde la app
-- ---------------------------------------------------------------------------
-- ⚠ SIN policy de INSERT/UPDATE/DELETE a proposito: agrupar dos branches es una
-- decision de negocio que se toma una vez cada mucho, no una accion de
-- pantalla. Cuando haya una pantalla que lo pida, la policy se agrega ahi --y
-- va a necesitar decidir quien puede, que es justo la conversacion que un
-- `grant` silencioso se saltea.
alter table org.branch_group enable row level security;
grant select on org.branch_group to authenticated;

create policy branch_group_select on org.branch_group
  for select to authenticated using (true);

commit;

-- ============================================================================
-- ⚠ SEGUNDA TRANSACCION, Y NO ES UN CAPRICHO DE ESTILO
-- ============================================================================
--
-- La version anterior de este archivo era UNA sola transaccion --create table,
-- insert, RLS, commit-- y falla:
--
--     55006: cannot ALTER TABLE "branch_group" because it has pending trigger
--            events
--
-- La causa es la FK auto-referencial `deferrable initially deferred`: el insert
-- del 777 apunta al 710 y esa comprobacion queda PENDIENTE hasta el commit, asi
-- que cualquier `alter table` posterior en la misma transaccion se topa con
-- eventos de trigger sin resolver. Lo encontro Isabella corriendolo.
--
-- El orden que funciona es este: la tabla con su RLS y su policy en una
-- transaccion, y las filas en otra. Y conviene asi ademas por otra razon: la
-- estructura y los datos son dos decisiones distintas, y cargar otro grupo
-- mañana es volver a correr SOLO la segunda parte.
--
-- ⚠ Y NO SE ARREGLA SACANDO `deferrable`: sin el, el insert de las dos filas
-- tendria que ordenarse a mano --primero el principal, despues el miembro-- y
-- un `insert ... values` con las dos juntas no garantiza ese orden. La FK
-- diferida es lo que hace que el par entre como una sola decision.

begin;

-- ---------------------------------------------------------------------------
-- Las dos filas de hoy
-- ---------------------------------------------------------------------------
-- ⚠ EL PRINCIPAL TAMBIEN VA. Sin la fila del 710 no hay a que apuntar --la FK
-- lo exige-- y, sobre todo, no hay donde escribir por que ese grupo existe.
insert into org.branch_group (branch_code, group_code, reason, created_by) values
  ('710', '710',
   'Branch principal del grupo. Jonathan Valenzuela abrio oficina propia (777) y su produccion se origino aca, asi que los dos se leen juntos.',
   'isabella.cano@supremelending.com'),
  ('777', '710',
   'Jonathan abrio oficina propia; su produccion se origino en el 710 y el sigue siendo Loan Officer de ese branch. Agrupar en vez de mover prestamos: mover los 4 cierres dejaria igual a Gian Laino --un outsider de verdad, del 747-- y escondería que son dos casos distintos.',
   'isabella.cano@supremelending.com')
on conflict (branch_code) do nothing;

commit;

-- ============================================================================
-- VERIFICACION
-- ============================================================================
-- 1. Las dos filas, y que el principal se apunte a si mismo:
--
--   select branch_code, group_code, reason from org.branch_group order by group_code, branch_code;
--   -- esperado: 710 -> 710 y 777 -> 710
--
-- 2. Que ningun grupo apunte a un branch que no esta en la tabla (lo garantiza
--    la FK, pero se mira una vez):
--
--   select g.branch_code, g.group_code from org.branch_group g
--   left join org.branch_group p on p.branch_code = g.group_code
--   where p.branch_code is null;
--   -- esperado: cero filas
--
-- 3. Y en pantalla, despues de aplicar:
--    · el 777 deja de tener fila propia en la lista de Outlook;
--    · el 710 pasa a 27 cerrados hasta el mes en curso y 47 de presupuesto;
--    · Jonathan Valenzuela tiene fila de persona en el 710 y DESAPARECE del pie;
--    · Gian Laino sigue en el pie: el si es de otro branch.
--
-- ============================================================================
-- LAS OTRAS DOS DECISIONES DEL BRIEF
-- ============================================================================
--
-- 2. QUE PASA CON EL PRESUPUESTO. El grupo es UN branch para Outlook, asi que
--    tiene UNA decision de presupuesto, tomada bajo el codigo del grupo. No se
--    suman dos reglas: sumarlas daria un presupuesto que nadie fijo --la suma
--    de dos decisiones tomadas por separado, cada una pensando que cubria el
--    branch entero-- y ademas dejaria la pregunta «¿cual de las dos edito?» sin
--    respuesta en la pantalla.
--
--    ⚠ Y NO SE PIERDE NADA HOY, medido antes de proponerlo: no hay ninguna fila
--    de `outlook.budget_total`, `strategy_benchmark`, `growth_rule`,
--    `monthly_target` ni `projection_mode` con `branch_code = '777'`. Si
--    aparecieran, la regla que hace falta es explicita --leerlas bajo el grupo o
--    descartarlas-- y hoy no hay ninguna que forzarla a elegir.
--
-- 3. SI EL 777 SIGUE EXISTIENDO APARTE. Si, y es deliberado: `org.roster_current`
--    lo distingue porque es una oficina real con su codigo, y Encompass sigue
--    marcando cada prestamo con el branch donde se origino. Esta tabla NO toca
--    ninguno de los dos: dice como se LEE la produccion en Outlook, no donde
--    esta la gente ni de donde vino el prestamo. El dia que el 777 sea
--    independiente de verdad, se borra su fila y las dos pantallas se separan
--    solas.
