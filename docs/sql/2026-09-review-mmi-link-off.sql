-- ============================================================================
-- SACAR `mmi_link` DEL PASO 1.2 -- etapa RV21
-- ============================================================================
--
-- El paso 1.2 ofrecia «Open MMI» apuntando a `gate_config.mmi_link`, un link
-- IGUAL PARA TODOS (`https://mmi.io`): abria MMI, no el perfil de la persona
-- que se esta revisando.
--
-- Ahora el panel usa el perfil de MMI de esa persona, con el NMLS efectivo
-- --`coalesce(org.lo_profile.nmls_override, org.dim_employee.nmls)`, la regla
-- de BP50-- y sin respaldo al generico: si no hay NMLS, no hay link. Medido:
-- lo tienen 34 de 35 Loan Officers activos, y el que falta (Lucio Romero, 100)
-- con el respaldo puesto era justo el unico que recibia el link generico, o sea
-- lo contrario de lo que hace falta.
--
-- Asi que `mmi_link` quedo SIN NINGUN LECTOR. Esto lo saca del dato, y con eso
-- `gateLink` en `lib/review/gates.ts` se puede borrar --hoy queda marcada como
-- sin lectores, no borrada, para no dejar el codigo pidiendo una clave que
-- todavia existe--.
--
-- ⚠ `- 'mmi_link'` y no un `gate_config` nuevo: esa fila tiene ademas `target`
-- y `arrows` puede volver. El operador `-` saca una clave y deja el resto.

begin;

-- 1. Que hay hoy (leer antes, no de memoria).
select phase_no, step_in_phase, gate_kind, gate_config::text
from review.step
where gate_config ? 'mmi_link';
-- medido el 2026-09-10: una fila, la 1.2, con
-- {"target": ".bp-stats", "mmi_link": "https://mmi.io"}

-- 2. Sacarlo, con `returning`: un update que no matchea nada se parece a uno
--    que funciono.
update review.step
   set gate_config = gate_config - 'mmi_link'
 where gate_config ? 'mmi_link'
returning phase_no, step_in_phase, gate_config::text as ahora;
-- esperado: 1 fila -- 1.2 con {"target": ".bp-stats"}

commit;

-- 3. Verificacion.
select
  (select count(*) from review.step where gate_config ? 'mmi_link') as con_mmi_link,
  (select count(*) from review.step where gate_config ? 'target')   as con_target,
  (select count(*) from review.step)                                as pasos;
-- esperado: 0 · 8 · 8
