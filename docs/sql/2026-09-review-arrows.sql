-- ============================================================================
-- RV14 — LAS FLECHAS DE UN PASO: dónde mirar, y qué hacer ahí
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- `arrows` ES UN ARREGLO, Y DE AHÍ SALE EL SUB-PASO
-- ---------------------------------------------------------------------------
--
-- Cada elemento es `{ "target": "<selector>", "text": "<qué hacer ahí>" }`.
-- La máscara dibuja UNO a la vez y, si hay otro después, el primero lleva un
-- OK que mueve la flecha al siguiente.
--
-- Eso hace que la «confirmación intermedia» no sea un mecanismo: es que el
-- arreglo tiene dos elementos. Hoy sólo el paso 2.1 los tiene, y mañana
-- cualquier paso puede tenerlos SIN TOCAR CÓDIGO -- que era el punto.
--
-- ⚠ `arrows` NO REEMPLAZA A `target`, y no son lo mismo:
--
--     target   DÓNDE ESTÁ el paso. Decide el «andate al lugar del paso» y el
--              resaltado de la sección.
--     arrows   DÓNDE MIRAR adentro. Un número, una píldora, una fila.
--
-- El 1.2 es el ejemplo: `target` es `.bp-stats` --la tarjeta entera-- y la
-- flecha apunta al Benchmark, que es uno de sus cuatro números.
--
-- ⚠ `{lo}` SE SUSTITUYE POR LA CLAVE DE LA PERSONA REVISADA. Lo necesita la
-- segunda flecha del 2.1, que señala la fila de ESA persona: un selector fijo
-- no puede decir «la fila de quien se revisa». Es la única sustitución.
--
-- ---------------------------------------------------------------------------
-- LOS ANCLAS, Y POR QUÉ DOS SON ATRIBUTOS NUEVOS
-- ---------------------------------------------------------------------------
--
--     .ol-topbar                  ya existía
--     .bp-verdict-panel__label    ya existía
--     [data-rv-anchor="benchmark"]  NUEVO, en performance.tsx
--     [data-rv-lo="<clave>"]        NUEVO, en la fila del LO de Outlook
--
-- Los dos nuevos existen porque no había selector propio: los cuatro
-- `.bp-stat` comparten clase, y todas las filas de LO comparten `.metric.mrow`.
-- Elegirlos por posición --`:nth-child`-- habría hecho que agregar una
-- estadística, o que cambie el orden del roster, moviera la flecha a otro
-- lugar sin que nada falle.
--
-- Son dos atributos, una vez. Agregar una flecha a un paso NUEVO sigue siendo
-- una fila mientras el ancla tenga selector.

begin;

-- ── 1.2 · el benchmark: al número, no a la sección ────────────────────────
update review.step
   set gate_config = coalesce(gate_config, '{}'::jsonb) || jsonb_build_object(
     'arrows', jsonb_build_array(
       jsonb_build_object(
         'target', '[data-rv-anchor="benchmark"]',
         'text',   'Fijá el benchmark del mes acá. Si dice Provisional, todavía no lo confirmó nadie.'
       )
     )
   )
 where phase_no = 1 and step_in_phase = 2;

-- ── 1.5 · el risk status: al veredicto, con qué significa ─────────────────
--
-- El texto dice qué se espera y no sólo dónde mirar: «On Risk» sin más es un
-- rótulo, y lo que hace falta saber es qué obliga.
update review.step
   set gate_config = coalesce(gate_config, '{}'::jsonb) || jsonb_build_object(
     'arrows', jsonb_build_array(
       jsonb_build_object(
         'target', '.bp-verdict-panel__label',
         'text',   'On Risk = el GAP contra el benchmark quedó negativo. Se espera un plan, no una explicación.'
       )
     )
   )
 where phase_no = 1 and step_in_phase = 5;

-- ── 2.1 · las DOS del presupuesto, y el OK entre ellas ────────────────────
--
-- La primera a la izquierda del Project through, en el espacio vacío. Al dar
-- OK, la flecha se mueve a la fila de la persona revisada.
update review.step
   set gate_config = coalesce(gate_config, '{}'::jsonb) || jsonb_build_object(
     'arrows', jsonb_build_array(
       jsonb_build_object(
         'target', '.ol-topbar',
         'text',   'Elegí el período de proyección. Vale para toda la división, no por branch.'
       ),
       -- ⚠ DOS SELECTORES, Y EL ORDEN ES LA PREFERENCIA. La fila de la persona
       -- vive en un grupo que arranca COLAPSADO, así que su `tr` no existe en
       -- el DOM hasta que alguien lo despliega. El respaldo es la cabecera del
       -- grupo, que está siempre. La máscara los prueba EN ORDEN -- no se los
       -- pasa juntos a `querySelector`, que devolvería el primero en orden del
       -- documento (la cabecera) incluso con la fila a la vista.
       jsonb_build_object(
         'target', '[data-rv-lo="{lo}"], [data-rv-grupo="g:lo-existing"]',
         'text',   'Acá sólo se revisa: actual, forecast y budget. Se definen expectativas de crecimiento, no se cierra nada.'
       )
     )
   )
 where phase_no = 2 and step_in_phase = 1;

commit;


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBARLO
-- ---------------------------------------------------------------------------
--
-- 1. Los tres pasos quedaron con sus flechas, y NINGÚN otro:
--
--      select phase_no, step_in_phase, label,
--             jsonb_array_length(gate_config -> 'arrows') as flechas
--        from review.step
--       where gate_config ? 'arrows'
--       order by phase_no, step_in_phase;
--      -- espera: (1,2) 1 · (1,5) 1 · (2,1) 2
--
--      select count(*) from review.step where gate_config ? 'arrows';
--      -- espera: 3
--
-- 2. ⚠ Y QUE `target` SIGA INTACTO en los tres, que es lo que el `||` podría
--    haberse llevado si se hubiera escrito el objeto entero en vez de mezclar:
--
--      select phase_no, step_in_phase,
--             gate_config ->> 'target' as target,
--             gate_config ->> 'open_editor' as open_editor
--        from review.step
--       where (phase_no, step_in_phase) in ((1,2), (1,5), (2,1))
--       order by phase_no, step_in_phase;
--      -- espera: .bp-stats · .bp-verdict-panel · ["\.ol-topbar", "\.ol-year"]
--      -- y el 2.1 sin open_editor (ése vive en el 2.2)
--
-- 3. Y que el `{lo}` esté escrito tal cual, sin resolver, porque lo resuelve
--    la máscara y no el SQL:
--
--      select gate_config -> 'arrows' -> 1 ->> 'target'
--        from review.step where phase_no = 2 and step_in_phase = 1;
--      -- espera: [data-rv-lo="{lo}"]
