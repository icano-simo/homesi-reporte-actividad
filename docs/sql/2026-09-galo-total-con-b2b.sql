-- ============================================================================
-- EL B2B DE GALO ENTRA AL PRESUPUESTO — etapa OL39
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- QUE PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- El reparto del 15/09 movio el presupuesto de B2B que estaba a nivel branch
-- --`outlook.strategy_benchmark` con `branch_code`, que SUMABA al total del
-- branch-- al desglose por persona, que NO suma: el presupuesto de alguien es
-- su total fijado, y el desglose solo lo explica.
--
-- Nathan Martinez y Juseth Castro ya quedaron corregidos (revision 3, 3/3/3).
-- Falta Galo Rizzo, y su caso se veia distinto:
--
--     rev 1   oct/nov/dic = 4     confirmed_only false   11/09  jorge
--     rev 2   null                confirmed_only TRUE    11/09
--     rev 3   null                confirmed_only TRUE    14/09
--     rev 4   null                confirmed_only TRUE    14/09
--     rev 5   null                confirmed_only TRUE    14/09
--
-- ⚠ SU REVISION VIGENTE NO ES LA 5 SINO LA 1. El lector descarta las
-- confirmaciones ANTES de elegir cual gobierna --`confirmed_only !== true &&
-- total !== null`, en `loadData.ts`-- asi que Galo NO proyecta por regla:
-- tiene un total fijado en 4/4/4, y su `b2b 1` queda por encima. Medido en
-- pantalla: el 747 muestra fila 7/7/8 y composicion 8/8/9.
--
-- Y es deliberado, esta escrito en `confirmPersonBudgetReviewed`: una
-- confirmacion nunca le quita el gobierno a un total ya fijado. Si contara como
-- vigente, confirmar le borraria el presupuesto a alguien sin que nadie lo
-- decidiera.
--
-- ---------------------------------------------------------------------------
-- QUE HACE
-- ---------------------------------------------------------------------------
-- Una revision gobernante nueva --la 6-- con 5/5/5: sus 4 de Own Production
-- mas el 1 de B2B que el reparto le dio. Misma forma que la que corrigio a
-- Nathan y a Juseth.
--
-- Despues de aplicarlo, el 747 pasa a 8/8/9 y el invariante de OL39 --la
-- composicion da lo mismo que la fila del branch, mes a mes-- vale en los 12
-- branches con filas de persona.
--
-- ⚠ NO TOCA EL DESGLOSE. Su `own_production 4` y su `b2b 1` ya estan y ya
-- suman 5: lo que faltaba era el total. Escribir tambien el desglose seria una
-- revision nueva que no cambia ningun numero.
-- ---------------------------------------------------------------------------

begin;

insert into outlook.budget_total
  (employee_key, revision, target_month, total, confirmed_only, set_by, note)
select
  7,
  (select coalesce(max(revision), 0) + 1 from outlook.budget_total where employee_key = 7),
  m::date,
  5,
  false,
  'isabella.cano@supremelending.com',
  'El B2B del reparto entra al presupuesto: 4 de Own Production + 1 de B2B.'
from (values ('2026-10-01'), ('2026-11-01'), ('2026-12-01')) as t(m);

commit;

-- ---------------------------------------------------------------------------
-- PARA VERIFICAR, despues de aplicar
-- ---------------------------------------------------------------------------
-- La revision que gobierna y lo que fija, con el mismo criterio que el codigo:
--
--   select revision, target_month, total
--     from outlook.budget_total
--    where employee_key = 7
--      and confirmed_only is distinct from true
--      and total is not null
--      and revision = (select max(revision) from outlook.budget_total
--                       where employee_key = 7
--                         and confirmed_only is distinct from true
--                         and total is not null)
--    order by target_month;
--
-- Tiene que devolver oct, nov y dic en 5. Y en pantalla, el branch 747 pasa a
-- 8/8/9 en BUDGET (OCT-DEC), con la composicion dando lo mismo.
