-- ============================================================================
-- OUTLOOK — Recruitment, el quinto bucket del desglose (etapa OL26e)
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- Ejecutar como `postgres` en el SQL Editor de Supabase (proyecto simoOS-prod).
-- Idempotente: se puede correr entero de nuevo sin duplicar nada -- el `alter
-- table drop constraint if exists` + `add constraint` deja siempre el mismo
-- estado final, corra una vez o diez.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ HACE FALTA, Y POR QUÉ NO ANTES
-- ----------------------------------------------------------------------------
-- Con `docs/sql/2026-09-outlook-budget-composition.sql` el desglose era
-- puramente informativo: el total se fijaba a mano y el desglose lo explicaba
-- sin obligación de sumar exacto. Un bucket faltante ahí era una explicación
-- incompleta, no un problema de cuentas.
--
-- Con la etapa OL26e (ver `docs/ARQUITECTURA.md` o el historial de esta rama:
-- "person_budget_total manda cuando existe, la regla cuando no") el TOTAL pasa
-- a gobernar la proyección de la persona para los meses que cubre. El
-- desglose sigue sin sumar el total por obligación, pero ahora SÍ tiene que
-- poder nombrar cada origen real de producción de un Loan Officer -- porque el
-- número que gobierna es el mismo que antes se explicaba por estrategia, y
-- Recruitment es una de esas estrategias (verificado en OL26c: los cierres de
-- B2B, NPPM y Affinity, además de Own Production y Recruitment, son todos
-- cierres de un Loan Officer real).
--
-- Sin este bucket, quien participa de Recruitment no tiene dónde explicar esa
-- parte de su total -- no es que la producción desaparezca del NÚMERO que
-- gobierna (`person_budget_total` no se toca acá), pero sí desaparece de la
-- EXPLICACIÓN: la fila `Difference` de la pantalla queda permanentemente
-- corta para cualquiera que haga Recruitment, sin que haya dónde cargar esa
-- parte.
--
-- ----------------------------------------------------------------------------
-- QUÉ HACE
-- ----------------------------------------------------------------------------
-- Agrega `'recruitment'` a los cuatro buckets existentes. El CHECK que
-- restringe los buckets de un realtor NPPM (`own_production` y
-- `business_plan` solamente) NO CAMBIA -- un realtor sigue sin poder cargar
-- `recruitment`, porque un realtor no participa del programa de reclutamiento.
-- La sección de verificación, más abajo, prueba las dos cosas: que
-- `recruitment` entra para un Loan Officer y que sigue rechazado para un
-- realtor.
--
-- Sólo estructura. No toca `outlook.person_budget_total` -- el total nunca
-- tuvo buckets -- ni ninguna fila ya guardada en `person_budget_breakdown`.

begin;

alter table outlook.person_budget_breakdown
  drop constraint if exists person_budget_breakdown_bucket_check;

alter table outlook.person_budget_breakdown
  add constraint person_budget_breakdown_bucket_check
    check (bucket in ('own_production', 'b2b', 'nppm', 'recruitment', 'business_plan'));

comment on column outlook.person_budget_breakdown.bucket is
  'own_production/b2b/nppm/recruitment son la misma clasificación de siempre -- todo cierre suma al Loan Officer que lo cerró (ver OL26c). business_plan es distinto: ver el comment de la columna value.';

commit;


-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
--
-- 1. `recruitment` entra para un Loan Officer. Esto DEBE funcionar:
--
--      insert into outlook.person_budget_breakdown
--        (employee_key, revision, target_month, bucket, value, set_by)
--      values (30, 9999, '2026-10-01', 'recruitment', 3, 'prueba')
--      on conflict do nothing;
--
--    (revision 9999 a propósito, para no chocar con una revisión real ni
--    quedar como la vigente de nadie -- borrarla después con un DELETE manual
--    si hace falta, ya que la tabla no tiene política de DELETE para la app.)
--
-- 2. `recruitment` sigue rechazado para un realtor. Esto DEBE fallar con
--    23514, el mismo código que ya rechaza 'b2b' y 'nppm' para un realtor:
--
--      insert into outlook.person_budget_breakdown
--        (nppm_realtor, revision, target_month, bucket, value, set_by)
--      values ('Fred A Gomez', 9999, '2026-10-01', 'recruitment', 3, 'prueba');
--
-- 3. El bucket viejo sigue andando igual -- esto también debe entrar:
--
--      insert into outlook.person_budget_breakdown
--        (employee_key, revision, target_month, bucket, value, set_by)
--      values (30, 9999, '2026-10-01', 'business_plan', 3, 'prueba')
--      on conflict do nothing;
--
--
-- ============================================================================
-- PARA REVERTIR
-- ============================================================================
--
--   begin;
--   alter table outlook.person_budget_breakdown drop constraint person_budget_breakdown_bucket_check;
--   alter table outlook.person_budget_breakdown add constraint person_budget_breakdown_bucket_check
--     check (bucket in ('own_production', 'b2b', 'nppm', 'business_plan'));
--   commit;
--
-- ⚠ Sólo revertir si NINGUNA fila quedó guardada con bucket = 'recruitment' --
-- si alguna vez existe una, este ALTER fallaría (la constraint no se puede
-- agregar sobre datos que ya la violan) y hay que decidir qué hacer con esas
-- filas primero, no borrarlas a ciegas.
-- ============================================================================
