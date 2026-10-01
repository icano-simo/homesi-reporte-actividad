-- ============================================================================
-- RV32 · punto 1 — El benchmark se fija en UN solo lugar
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
--
-- Isabella fijó el benchmark desde el editor de la pantalla y la compuerta del
-- paso 1.2 le pidió tipear el mismo número otra vez en el cuadro del paso. Dos
-- lugares para el mismo dato.
--
-- Queda uno: el editor del perfil, que es donde vive `org.employee_benchmark`.
-- El paso 1.2 pasa a cerrar con el comentario, como los otros cinco de su
-- clase.
--
-- ── ⚠ Y ESTO NO ES UNA SIMPLIFICACIÓN: ES SACAR UNA COPIA ───────────────────
--
-- `gate_kind = 'number'` guardaba el número en `response.gate.benchmark_set`,
-- o sea una segunda fuente para un dato que la tabla del benchmark ya tiene
-- --con su autor y su fecha--. El propio `gates.ts` dice por qué eso no se
-- hace, y lo dice en el comentario del caso CONTRARIO:
--
--   > Acá SÍ se copia el nombre, al revés que con el benchmark. Ahí no se copia
--   > porque `org.employee_benchmark` es la fuente viva del número y dos copias
--   > pueden discrepar.
--
-- La regla estaba escrita y el paso 1.2 era la excepción que nadie había
-- sacado.
--
-- ── LO QUE NO CAMBIA, Y POR QUÉ SE DICE ─────────────────────────────────────
--
-- 1. `gate_config` NO SE TOCA. Sigue con `target` y con `mmi_link`, y el enlace
--    se sigue ofreciendo: desde RV22 lo decide la PRESENCIA de la clave y no el
--    `gate_kind` --`showsMmiLink()` es `Object.hasOwn(cfg, 'mmi_link')`--. Si
--    se borrara la clave, el enlace desaparecería de la única pantalla que lo
--    necesita. Es la lección de RV21→RV22 en su propio archivo.
--
-- 2. LAS RESPUESTAS VIEJAS NO SE MIGRAN. `review.response` es append-only: las
--    filas que ya tienen `gate = {"benchmark_set": true}` son el registro de lo
--    que pasó ese día, con la pregunta que se vio. Reescribirlas sería cambiar
--    el pasado para que se parezca al presente.
--
-- 3. `org.employee_benchmark` no se toca. Sigue siendo la fuente, y sigue
--    siendo append-only.
--
-- ── ⚠ LO QUE ESTE ARCHIVO NO HACE, Y HAY QUE HACER EN EL CÓDIGO ─────────────
--
-- Aplicado solo, este SQL YA produce el comportamiento pedido: el panel dibuja
-- el campo de número sólo cuando `gate_kind === 'number'`, así que desaparece,
-- y `gateStatus` cae en el caso `comment`. No queda un paso trabado ni a medias.
--
-- Lo que queda para el código, y va aparte:
--
--   · el rótulo del enlace pasa a «Review MMI and set the benchmark»;
--   · `PASOS_QUE_ESCRIBEN['1.2']` deja de tener un escritor en el panel: el
--     benchmark lo escribe SÓLO `BenchmarkEditor`, que desde RV28 consulta la
--     puerta por su cuenta. Para que una PRÁCTICA siga mostrando lo que fijó,
--     ese editor tiene que anotar su evidencia igual que hace el de Outlook --
--     es el mismo caso de RV29/RV30, con el dato cambiando de lugar y los
--     lectores quedándose donde estaban.
--
-- ============================================================================

begin;

/*
 * El `check` de `review.step` ya admite `comment`: es el valor de cinco de los
 * ocho pasos, así que esto no necesita tocar la restricción.
 */
update review.step
   set gate_kind = 'comment'
 where phase_no = 1
   and step_in_phase = 2
   and gate_kind = 'number';

commit;


-- ============================================================================
-- CÓMO COMPROBARLO — EN OTRA SENTENCIA, DESPUÉS DEL COMMIT
-- ============================================================================
--
-- ⚠ Y NO CON LA CLAVE ESCRITA A MANO: el `update` de arriba lleva su `where`
-- completo a propósito --incluido `gate_kind = 'number'`-- para que reaplicarlo
-- toque CERO filas en vez de decir que sí. Un update que no matchea nada se
-- parece a uno que funcionó, y eso ya costó una vez.
--
-- 1. El paso quedó como los otros, y el enlace sigue estando:
--
--      select phase_no, step_in_phase, label, gate_kind,
--             gate_config ? 'mmi_link' as ofrece_mmi,
--             gate_config ->> 'target'  as objetivo
--        from review.step
--       where phase_no = 1 and step_in_phase = 2;
--
--    Esperado: `gate_kind = 'comment'`, `ofrece_mmi = true`,
--    `objetivo = '.bp-stats'`.
--
-- 2. Ya no queda ningún paso pidiendo un número:
--
--      select count(*) from review.step where gate_kind = 'number';   -- 0
--
-- 3. Y las respuestas viejas siguen intactas, que es el punto 2 de arriba:
--
--      select count(*) as con_benchmark_set
--        from review.response
--       where gate ? 'benchmark_set';
--
--    Ese número tiene que ser el MISMO antes y después. Medido al escribir
--    este archivo: 8, sobre 46 respuestas en total.
