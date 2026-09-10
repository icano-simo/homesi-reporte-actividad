-- ============================================================================
-- `mmi_link` PASA A SER UNA MARCA, NO UNA URL -- etapa RV22
-- ============================================================================
--
-- ⚠ ESTE ARCHIVO CAMBIO DE PROPOSITO, Y NO SE APLICO NUNCA EN SU VERSION
-- ANTERIOR. En RV21 sacaba `mmi_link` de `gate_config` porque el link generico
-- (`https://mmi.io`) habia quedado sin lector: el `Open MMI` del 1.2 pasó a
-- apuntar al perfil de LA PERSONA revisada, con el NMLS efectivo
-- --`coalesce(org.lo_profile.nmls_override, org.dim_employee.nmls)`, la regla
-- de BP50--.
--
-- Lo que ese razonamiento no vio es que la clave hacia DOS cosas, no una:
--
--   el VALOR    decia a donde ir  -> eso si quedo sin lector, lo arma el codigo
--   la PRESENCIA decia DONDE ofrecerlo -> eso seguia haciendo falta
--
-- La clave existe en un solo paso --el 1.2, el del benchmark-- asi que su
-- ausencia en los otros siete ERA la condicion. Al dejar de leerla, el link
-- quedo incondicional y el «Open MMI» aparecio en los ocho pasos; Isabella lo
-- vio en las tres fases.
--
--     Al quitar la fuente del dato se perdio la condicion que el dato llevaba
--     adentro.
--
-- Asi que en vez de borrarla, `showsMmiLink` en `lib/review/gates.ts` lee su
-- PRESENCIA e ignora su valor. Con eso agregar el enlace a otro paso sigue
-- siendo una fila y no un cambio de codigo, el mismo criterio que `arrows`.
--
-- ⚠ Y ESTE SQL NO ES UN REQUISITO DEL CODIGO: el dato de hoy ya lleva la
-- condicion correcta, asi que el arreglo funciona sin aplicar nada. Lo unico
-- que corrige es el VALOR, que hoy miente: `"mmi_link": "https://mmi.io"` se
-- lee como una URL que se usa, y no se usa. Queda `true`, que es lo que la
-- clave significa ahora. El codigo se comporta IGUAL antes y despues.
--
-- ⚠ `|| jsonb` y no un `gate_config` nuevo: esa fila tiene ademas `target`, y
-- `arrows` puede volver (ver `2026-09-review-arrows-off.sql`). El operador `||`
-- reemplaza la clave y deja el resto.

begin;

-- 1. Que hay hoy (leer antes, no de memoria).
select phase_no, step_in_phase, gate_kind, gate_config::text
from review.step
where gate_config ? 'mmi_link';
-- medido el 2026-09-10: una fila, la 1.2, con
-- {"target": ".bp-stats", "mmi_link": "https://mmi.io"}

-- 2. Reemplazar el valor, con `returning`: un update que no matchea nada se
--    parece a uno que funciono.
update review.step
   set gate_config = gate_config || '{"mmi_link": true}'::jsonb
 where gate_config ? 'mmi_link'
returning phase_no, step_in_phase, gate_config::text as ahora;
-- esperado: 1 fila -- 1.2 con {"target": ".bp-stats", "mmi_link": true}

commit;

-- 3. Verificacion: la clave sigue en un solo paso, y ya no queda ninguna URL.
select
  (select count(*) from review.step where gate_config ? 'mmi_link')          as con_mmi_link,
  (select count(*) from review.step
    where jsonb_typeof(gate_config -> 'mmi_link') = 'string')                as todavia_url,
  (select count(*) from review.step where gate_config ? 'target')            as con_target,
  (select count(*) from review.step)                                        as pasos;
-- esperado: 1 · 0 · 8 · 8

-- ============================================================================
-- 4. REVERSION -- volver a ofrecer el enlace en otro paso, sin tocar codigo
-- ============================================================================
-- Es la prueba de que la condicion vive en el dato. Para ofrecerlo tambien en
-- el 1.4, por ejemplo:
--
--   update review.step
--      set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"mmi_link": true}'::jsonb
--    where phase_no = 1 and step_in_phase = 4
--   returning phase_no, step_in_phase, gate_config::text;
--
-- Y para quitarlo de un paso, `- 'mmi_link'`. El valor da igual: `true`,
-- `false`, un numero o una cadena vacia encienden el enlace lo mismo, porque lo
-- que se lee es que la clave este. Si alguna vez hace falta que el valor
-- decida, eso es una funcion distinta y esta nota deja de valer.
