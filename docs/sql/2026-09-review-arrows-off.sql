-- ============================================================================
-- APAGAR LAS FLECHAS -- etapa RV16
-- ============================================================================
--
-- Los textos de las flechas quedaron ENCIMA del texto que hay que leer, asi que
-- tapan justo lo que la flecha señala. Se apagan hasta que se resuelva donde se
-- posicionan.
--
-- ⚠ SE APAGAN POR DATO, NO POR CODIGO. Las flechas salen de
-- `review.step.gate_config -> 'arrows'` (etapa RV14): si el arreglo no esta, la
-- mascara no dibuja nada -- ni la flecha, ni el texto, ni el OK intermedio del
-- paso 2.1, que no es un mecanismo aparte sino el segundo elemento del arreglo.
-- Volverlas es el UPDATE de la seccion 4 de este archivo, sin tocar una linea
-- de codigo ni desplegar nada.
--
-- El CSS (`.rv-arrow*` en `app/review/styles/review.css`) NO se borra: la
-- geometria ya esta resuelta y lo que falta es decidir la posicion.
--
-- ⚠ `- 'arrows'` y no un `gate_config` nuevo: las tres filas tienen otras
-- claves --`target` en las tres, `mmi_link` en la 1.2-- y reescribir el objeto
-- entero las perderia. El operador `-` saca una clave y deja el resto igual.
--
-- ============================================================================
-- 1. QUE HAY HOY, antes de tocar (leer primero, no de memoria)
-- ============================================================================

select phase_no, step_in_phase, gate_kind,
       jsonb_array_length(gate_config -> 'arrows') as flechas,
       gate_config::text as gate_config
from review.step
where gate_config ? 'arrows'
order by phase_no, step_in_phase;
-- medido el 2026-09-10: tres filas -- 1.2 (1 flecha), 1.5 (1) y 2.1 (2).

-- ============================================================================
-- 2. APAGARLAS
-- ============================================================================
-- Con `returning`, que dice CUANTAS filas se tocaron: un UPDATE que no matchea
-- nada se parece a uno que funciono.

update review.step
   set gate_config = gate_config - 'arrows'
 where gate_config ? 'arrows'
returning phase_no, step_in_phase, gate_config::text as gate_config_ahora;
-- esperado: 3 filas, y en cada una `gate_config` SIN la clave `arrows` y con
-- todo lo demas intacto:
--   1.2  {"target": ".bp-stats", "mmi_link": "https://mmi.io"}
--   1.5  {"target": ".bp-verdict-panel"}
--   2.1  {"target": [".ol-topbar", ".ol-year"]}

-- ============================================================================
-- 3. VERIFICACION
-- ============================================================================

-- 3a. Ninguna fila con flechas, y las tres claves que tenian que quedar.
select
  (select count(*) from review.step where gate_config ? 'arrows') as con_flechas,
  (select count(*) from review.step where gate_config ? 'target') as con_target,
  (select count(*) from review.step where gate_config ? 'mmi_link') as con_mmi_link;
-- esperado: 0 · 8 · 1

-- 3b. Y que no se haya perdido ningun paso ni ningun gate_kind por el camino.
select count(*) as pasos, count(gate_kind) as con_gate_kind from review.step;
-- esperado: 8 y 8

-- ============================================================================
-- 4. VOLVERLAS -- NO CORRER AHORA
-- ============================================================================
-- Este es el UPDATE inverso, con el contenido exacto de las tres filas tal como
-- estaba antes de apagarlas. Sirve tal cual cuando se retome la etapa: si hasta
-- entonces cambia el texto o el ancla, se cambia ACA y se corre esto.
--
-- ⚠ `||` mergea sobre lo que haya en `gate_config`, asi que no pisa `target`
-- ni `mmi_link`.

-- 1.2 -- el benchmark del mes, dentro de la tarjeta de cuatro numeros.
-- update review.step set gate_config = gate_config || jsonb_build_object(
--   'arrows', jsonb_build_array(jsonb_build_object(
--     'target', '[data-rv-anchor="benchmark"]',
--     'text',   'Fija el benchmark del mes aca. Si dice Provisional, todavia no lo confirmo nadie.'
--   )))
--  where phase_no = 1 and step_in_phase = 2
-- returning phase_no, step_in_phase, gate_config::text;

-- 1.5 -- que significa On Risk, sobre el rotulo del veredicto.
-- update review.step set gate_config = gate_config || jsonb_build_object(
--   'arrows', jsonb_build_array(jsonb_build_object(
--     'target', '.bp-verdict-panel__label',
--     'text',   'On Risk = el GAP contra el benchmark quedo negativo. Se espera un plan, no una explicacion.'
--   )))
--  where phase_no = 1 and step_in_phase = 5
-- returning phase_no, step_in_phase, gate_config::text;

-- 2.1 -- DOS flechas, y por eso la primera lleva el OK que mueve a la segunda.
-- `{lo}` lo sustituye la mascara por la clave de la persona revisada; los dos
-- selectores de la segunda se prueban EN ORDEN (la fila si esta visible, la
-- cabecera del grupo si el grupo esta colapsado).
-- update review.step set gate_config = gate_config || jsonb_build_object(
--   'arrows', jsonb_build_array(
--     jsonb_build_object(
--       'target', '.ol-topbar',
--       'text',   'Elegi el periodo de proyeccion. Vale para toda la division, no por branch.'
--     ),
--     jsonb_build_object(
--       'target', '[data-rv-lo="{lo}"], [data-rv-grupo="g:lo-existing"]',
--       'text',   'Aca solo se revisa: actual, forecast y budget. Se definen expectativas de crecimiento, no se cierra nada.'
--     )))
--  where phase_no = 2 and step_in_phase = 1
-- returning phase_no, step_in_phase, gate_config::text;

-- ============================================================================
-- 5. LO QUE NO CAMBIA, Y CONVIENE QUE QUEDE DICHO
-- ============================================================================
-- Ningun paso se cierra por una flecha. El OK del 2.1 mueve la atencion de una
-- flecha a la otra y nada mas: el `gate_kind` del 2.1 es `comment`, asi que lo
-- que lo cierra es el comentario, con flechas o sin ellas.
--
-- Verificado en pantalla sobre una sesion desechable --Ricardo Cera (65) sobre
-- Luis Silva (16), borrada despues-- y no leyendo el codigo. La misma sonda,
-- dos veces, y lo unico que cambio fue el dato:
--
--   con `arrows`   1 flecha, su texto y el OK. El paso se cerro con el
--                  comentario SIN tocar el OK, y avanzo a 2.2.
--   sin `arrows`   cero flechas, cero textos, cero OK, y cero elementos con
--                  cualquier clase de la familia `rv-arrow`. El paso se cerro
--                  igual y avanzo a 2.2.
--
-- Y el UPDATE de la seccion 4 no es hipotetico: se corrio para devolver el 2.1
-- y el `gate_config` quedo identico al de la seccion 1, con `target` intacto.
--
-- ⚠ PARA QUIEN RETOME LA ETAPA, dos cosas que salieron de las capturas:
--
--   1. El hint del 2.1 se dibuja SOBRE el titulo del branch y sobre el rotulo
--      «Project through» -- que es el que la flecha señala. No es que tape
--      «algo»: tapa su propio objetivo.
--   2. Y el OK de la flecha queda junto al OK del panel, que es el que avanza
--      el paso. Dos botones que dicen lo mismo y hacen cosas distintas, a
--      centimetros. Al volverlas, ese OK necesita otro rotulo.
