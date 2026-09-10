/*
 * ============================================================================
 * RV10 — LA FASE 3 SE REDISEÑA: EL LUGAR DEL PASO ES EL CATÁLOGO
 * ============================================================================
 *
 * ⚠ NO APLICADO. Entregado para correr a mano, como el resto de `docs/sql/`.
 *
 * ⚠ Y EL ORDEN ES CÓDIGO PRIMERO, igual que en RV6. Este archivo mueve el lugar
 * del paso al catálogo; con el código viejo, el panel dibujaría el campo de
 * comentario ahí sin las pantallas de decisión y confirmación que lo enmarcan.
 * El código de RV10 entiende las dos formas; el anterior no.
 *
 * ----------------------------------------------------------------------------
 * EL FLUJO QUE ESTO HABILITA
 * ----------------------------------------------------------------------------
 * Isabella recorrió la fase 3 y no funcionó. El flujo nuevo:
 *
 *   1. una pantalla de decisión   ¿van a elegir un funnel ahora?
 *   2. «No por ahora»             el comentario dice por qué, y la revisión cierra
 *   3. «Ver los funnels»          va DIRECTO al catálogo
 *   4. en el catálogo             el comentario se escribe MIENTRAS miran
 *   5. al seleccionar             una confirmación
 *   6. al finalizar               queda abierto el plan del funnel elegido
 *
 * Las pantallas 1 y 5 son vistas de la máscara, no rutas: no hay nada que
 * agregar acá para ellas.
 *
 * ----------------------------------------------------------------------------
 * MEDIDO ANTES DE ENTREGARLO
 * ----------------------------------------------------------------------------
 * El flujo se recorrió completo con estas dos claves puestas, sobre dos sesiones
 * desechables --y después se restauró este `gate_config` al valor que tenía--.
 * 23 aserciones, los DOS desenlaces:
 *
 *   No por ahora   el botón de cerrar arranca APAGADO; con el motivo escrito la
 *                  revisión cierra, el resumen aparece con los ocho pasos sin
 *                  exigir un funnel que no hay, y la respuesta queda con
 *                  `{"funnel_chosen": false}`. El intake dice «No funnel chosen
 *                  — decided, not skipped» y muestra el motivo.
 *
 *   Con funnel     «See the funnels» va DIRECTO al catálogo --no al perfil-- con
 *                  el campo y la pregunta de esa rama. Al aparecer el funnel, la
 *                  confirmación lo nombra y NO vuelve a pedir el comentario. Al
 *                  finalizar, la respuesta guarda `funnel_chosen: true` con el
 *                  nombre, y el comentario escrito en el catálogo sobrevivió el
 *                  recorrido entero.
 *
 * ⚠ Y LA ÚLTIMA PANTALLA ES EL PLAN, SIN MÁSCARA ENCIMA: medido, cero `.rv-bar`
 * en `/business-plan/lo/N/plan` después de cerrar.
 *
 * ⚠ Lo que NO se ejerció: `activate_funnel`. El enrolamiento se sembró por REST,
 * porque el RPC crea un plan con sus milestones y revertirlo pide
 * `cancel_funnel`, que BORRA planes. Con él queda sin medir su `router.push` al
 * plan -- que es la pantalla 6, y por eso el flujo no navega por su cuenta.
 */

begin;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * 1. EL LUGAR DEL PASO PASA A SER EL CATÁLOGO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * RV7 dejó dos claves: `target` = `.bp-decision` (el perfil, donde se
 * confirmaba) y `target_pending` = `.bp-catalog` (el catálogo, donde se elige).
 * El flujo nuevo NO PASA MÁS POR EL PERFIL, así que hay una sola:
 *
 *   target = .bp-catalog
 *
 * ⚠⚠ Y `target_pending` SE QUITA A PROPÓSITO — esto no es un olvido.
 *
 * Dejarla «por si acaso» sería peor que no tenerla: con funnel activo el código
 * lee `target` y sin funnel lee `target_pending`, así que una `target_pending`
 * sobreviviente seguiría mandando al perfil en el momento exacto en que el
 * flujo quiere el catálogo. Es el bucle que Isabella vio -- el panel diciendo
 * «andá al perfil» desde el perfil.
 *
 * Así que si alguien lee este paso más adelante y ve un `target` sin
 * `target_pending`: no falta nada. El paso dejó de tener dos lugares porque
 * dejó de tener dos pantallas.
 *
 * `-` sobre jsonb quita la clave; `||` sólo reemplaza las que se le pasan y
 * habría dejado la vieja intacta.
 */
update review.step
   set gate_config = (gate_config - 'target_pending')
                     || '{"target": ".bp-catalog"}'::jsonb
 where phase_no = 3
   and step_in_phase = 1;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * 2. LAS DOS PREGUNTAS DEL FLUJO NUEVO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * El paso pasa a tener DOS desenlaces, y cada uno pregunta otra cosa:
 *
 *   eligiendo   se escribe en el catálogo, mirando las plantillas
 *   declinando  se escribe en la pantalla de decisión, explicando por qué no
 *
 * ⚠ VAN EN `gate_config` Y NO EN `review.step_prompt`, y el costo está dicho:
 * `step_prompt` versiona UN prompt por paso --con `revision`, que cada respuesta
 * guarda-- y no tiene columna de variante. Estas dos frases quedan SIN versionar
 * mientras vivan acá. Se eligió eso antes que agregarle una columna al modelo
 * para dos cadenas; si el día de mañana hay que auditar cómo estaba redactada
 * una pregunta, ésta es la deuda a pagar.
 *
 * El `prompt` de `step_prompt` sigue siendo el de la pantalla de decisión: es la
 * pregunta del paso, y las otras dos son de sus dos ramas.
 */
update review.step
   set gate_config = gate_config || jsonb_build_object(
         'prompt_catalog',
         'What catches your eye, and which one are you leaning towards?',
         'prompt_declined',
         'Why not now, and what would have to change to pick one?'
       )
 where phase_no = 3
   and step_in_phase = 1;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO CAMBIA, Y POR QUÉ
 * ────────────────────────────────────────────────────────────────────────────
 *
 * · `gate_kind` SIGUE SIENDO `funnel`. Lo que cambia es lo que exige: de «hay
 *   funnel» a «hay una DECISIÓN sobre el funnel». Cierra con funnel elegido, o
 *   sin funnel y con el motivo escrito -- y sin comentario no cierra en ninguno
 *   de los dos casos, que es lo único que no se relaja.
 *
 *   Un valor nuevo por cada matiz convierte la columna en una lista de casos
 *   particulares; `funnel` sigue describiendo lo que el paso decide.
 *
 * · `allow_second: false` sigue igual: hoy la app muestra un plan por persona.
 *
 * · Y la evidencia del desenlace va en `response.gate`, que es jsonb libre:
 *
 *     {"funnel_chosen": true, "enrollment_key": 88, "funnel_name": "..."}
 *     {"funnel_chosen": false}
 *
 *   No hace falta migración: la columna ya existe y ya acepta cualquier forma.
 */

/*
 * ────────────────────────────────────────────────────────────────────────────
 * COMPROBACIÓN, ANTES DE `commit`
 * ────────────────────────────────────────────────────────────────────────────
 * Tiene que devolver UNA fila así:
 *
 *   3 | 1 | funnel | ".bp-catalog" | NULL | false | (las dos preguntas)
 *
 * ⚠ Y `lugar_pendiente` EN NULL ES EL RESULTADO ESPERADO, no una falla: es la
 * clave que este archivo quita. Si viniera con `.bp-decision`, el `-` no corrió.
 */
select phase_no,
       step_in_phase,
       gate_kind,
       gate_config -> 'target'          as lugar,
       gate_config -> 'target_pending'  as lugar_pendiente,
       gate_config -> 'allow_second'    as segundo,
       gate_config ->> 'prompt_catalog' as pregunta_catalogo,
       gate_config ->> 'prompt_declined' as pregunta_declinado
  from review.step
 where phase_no = 3
   and step_in_phase = 1;

commit;
