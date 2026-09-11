/*
 * ============================================================================
 * RV6 — DOS LUGARES POR PASO, Y LA FASE 3 QUE EXIGE EL FUNNEL
 * ============================================================================
 *
 * ⚠ NO APLICADO TODAVÍA. Entregado para que se corra a mano, como el resto de
 * `docs/sql/`.
 *
 * ⚠ Y EL ORDEN IMPORTA: PRIMERO EL CÓDIGO, DESPUÉS ESTE ARCHIVO. El bloque 3
 * pone `gate_kind = 'funnel'`, y una fila con ese valor contra el código viejo
 * cae en el `default` de `gateStatus` — que pide sólo el comentario, o sea el
 * agujero que esta etapa cierra. El código de RV6 ya acepta las dos formas, así
 * que aplicar esto después es seguro y aplicarlo antes no.
 *
 * Los bloques 1 y 2 son `update` de `gate_config` y no dependen de nada: el
 * código de RV6 los entiende y el anterior los ignora sin romperse.
 *
 * ----------------------------------------------------------------------------
 * ⚠ SIGUE SIENDO UNA FILA, NO CÓDIGO
 * ----------------------------------------------------------------------------
 * `gate_config.target` acepta tres escrituras, y `stepTarget` las junta en una
 * sola lista de CSS:
 *
 *   "target": ".ol-topbar"                       un selector
 *   "target": [".ol-topbar", ".ol-year"]         varios, JUNTOS
 *   "target": ".ol-topbar, .ol-year"             lo mismo, en una cadena
 *
 * La forma de array es la que se escribe acá: se lee de un tirón y no obliga a
 * contar comas dentro de una cadena. Agregar una tercera sección al lugar de un
 * paso sigue siendo un `update`, no un despliegue.
 *
 * ⚠ Y UNA LISTA NO ES UNA CONDICIÓN. Una lista dice «estas dos cosas, juntas en
 * la misma pantalla» -- el caso de la fase 2. Cuando el lugar DEPENDE DEL ESTADO
 * hacen falta dos claves, y es el caso de la fase 3:
 *
 *   "target":         dónde se CONTESTA el paso
 *   "target_pending": dónde se HACE su acción, mientras falte hacerla
 *
 * Y los cuatro selectores de este archivo apuntan a clases QUE YA EXISTÍAN —
 * ninguna pantalla se tocó para esta etapa:
 *
 *   .ol-topbar     la barra de Outlook, con `Project through`            (OL22)
 *   .ol-year       la tabla `Budget by strategy` del branch              (OL9)
 *   .bp-decision   la barra de decisión del perfil, donde se confirma
 *   .bp-catalog    la grilla de funnels del catálogo, donde se ELIGE     (BP21)
 */

begin;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * 1. LA FASE 2 PASO 1 SEÑALA DOS COSAS — punto 1 del brief
 * ────────────────────────────────────────────────────────────────────────────
 *
 * El paso pide revisar el horizonte Y el presupuesto, y apuntaba sólo a la
 * barra. Peor: `.ol-topbar` vive en el LAYOUT del módulo, así que existe en
 * `/outlook` igual que en `/outlook/branch/707` — con ese selector solo, el
 * paso se daba por «en sitio» en la lista de los trece branches. La tabla lo
 * ancla a la pantalla donde el presupuesto de verdad está.
 *
 * ⚠ Y EL ORDEN DE LA LISTA ES EL DE LECTURA. Cuando las dos secciones no caben
 * juntas en la banda libre, el hook alinea el borde de arriba del conjunto: lo
 * primero del array es lo que queda arriba.
 */
update review.step
   set gate_config = gate_config || '{"target": [".ol-topbar", ".ol-year"]}'::jsonb
 where phase_no = 2
   and step_in_phase = 1;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * 2. LA FASE 3 TIENE UN LUGAR POR ESTADO — punto 2 del brief
 * ────────────────────────────────────────────────────────────────────────────
 *
 * El lugar del paso era sólo `.bp-decision`, que está en el PERFIL. Y la acción
 * que el paso pide --elegir un funnel-- se hace en el CATÁLOGO, donde esa clase
 * no existe: el panel pasaba a «esto se contesta en otra pantalla» justo en la
 * pantalla donde había que trabajar. Isabella vio ese aviso.
 *
 * Son dos pantallas y dos momentos, así que son dos claves:
 *
 *   sin funnel  →  `.bp-catalog`   en `/business-plan/lo/[id]/funnel`: se ELIGE
 *   con funnel  →  `.bp-decision`  en el perfil: se CONFIRMA
 *
 * ⚠ Y NO UNA LISTA CON LAS DOS, que es lo que decía la primera versión de este
 * archivo. `.bp-decision` la dibuja `DecisionBar.tsx`, que sólo usa el perfil
 * --cero apariciones en la pantalla del catálogo-- así que la lista hacía que el
 * panel se diera por «en sitio» en el catálogo y ofreciera CONFIRMAR ahí, donde
 * no hay ningún funnel que confirmar.
 *
 * El catálogo ya es un sub-camino de la ruta del paso, así que esto no cambia a
 * dónde navega la máscara: cambia qué se resalta y dónde el paso se da por
 * contestable.
 */
update review.step
   set gate_config = gate_config
       || '{"target": ".bp-decision", "target_pending": ".bp-catalog"}'::jsonb
 where phase_no = 3
   and step_in_phase = 1;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * 3. Y EL REQUISITO DEL FUNNEL, DICHO EN LA FILA — punto 2 del brief
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ ESTO ES LO QUE HACE QUE EL REQUISITO SEA DATO Y NO FASE.
 *
 * Isabella cerró la revisión de Armando Tejeda sin elegirle ningún funnel: la
 * compuerta pedía sólo el comentario. El código de RV6 ya lo exige, pero hasta
 * que esta migración corra lo deduce de `phase_no = 3` — o sea que el requisito
 * vive en el código y no en el guion, que es al revés de como se decidió todo lo
 * demás de este módulo.
 *
 * Con `gate_kind = 'funnel'`, la fila lo dice. Y `requiresFunnel` lo lee primero,
 * así que un paso de funnel en otra fase --si algún día hay uno-- lo hereda sin
 * tocar código.
 *
 * ⚠ La salida deliberada existe y se escribe: `{"requires_funnel": false}` en
 * `gate_config` exime al paso. La AUSENCIA de la clave EXIGE, que es el lado
 * seguro: una clave que falta no puede volver a abrir el agujero.
 */
alter table review.step drop constraint step_gate_kind_check;

alter table review.step
  add constraint step_gate_kind_check
  check (gate_kind = any (array['comment', 'number', 'clicks', 'budget', 'funnel']));

update review.step
   set gate_kind = 'funnel'
 where phase_no = 3
   and step_in_phase = 1;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * COMPROBACIÓN, ANTES DE `commit`
 * ────────────────────────────────────────────────────────────────────────────
 * Tiene que devolver exactamente tres filas:
 *
 *   2 | 1 | comment | [".ol-topbar", ".ol-year"]  con target_pending en null
 *   3 | 1 | funnel   | ".bp-decision"               con target_pending ".bp-catalog"
 *
 * y `allow_second: false` intacto en la 3.1
 *
 * ⚠ Y QUE `allow_second` SIGA ESTANDO en la 3.1: el `||` de jsonb reemplaza sólo
 * las claves que se le pasan, pero comprobarlo es lo que distingue «escribí un
 * update» de «el update hizo lo que quería». Si desapareciera, el panel dejaría
 * de decir que un segundo funnel no se puede.
 */
select phase_no,
       step_in_phase,
       gate_kind,
       gate_config -> 'target'         as lugar,
       gate_config -> 'target_pending' as lugar_pendiente,
       gate_config -> 'allow_second'   as segundo
  from review.step
 where (phase_no, step_in_phase) in ((2, 1), (3, 1))
 order by phase_no, step_in_phase;

commit;

/*
 * ============================================================================
 * LO QUE ESTE ARCHIVO NO TOCA, A PROPÓSITO
 * ============================================================================
 *
 * · `org.employee_branch`. El aviso «is in 2 branches (707, 707)» era un error
 *   de CONTEO, no de datos: la tabla tiene una fila por rol y un Producing
 *   Branch Manager tiene dos en el mismo branch. Diez personas están así y está
 *   bien que lo estén. El arreglo es `buscarBranches`, que ahora cuenta branches
 *   distintos y prefiere la fila `LO`.
 *
 * · El `prompt` de la 3.1. Sigue siendo el de `rv1-seed`, y el brief de RV1 pedía
 *   otro orden del que se construyó --ver la nota en `ReviewStepPanel.tsx`--. Ese
 *   texto se cambia junto con la mitad `helper` de `2026-09-review-phase2.sql`,
 *   que también está pendiente; mezclarlo acá haría que este archivo dependa de
 *   ése.
 *
 * · `service_role`. Sigue sin `usage` sobre `review`, y sigue anotado y no
 *   otorgado: nada lo usa contra este esquema. Ver `AGENTS.md`.
 */
