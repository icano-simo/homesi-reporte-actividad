-- ============================================================================
-- El editor que se abre solo pasa a ser "budget", no una estrategia
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- ----------------------------------------------------------------------------
--
-- `docs/sql/2026-09-review-phase2.sql` fijó `gate_config.open_editor` en
-- `'Own Production'` para el paso 2.2 ("Budget and strategies"). Esa fecha,
-- Outlook abría un editor DISTINTO por estrategia (`StrategyEditor`, uno para
-- Own Production, otro para B2B, etc.) -- `open_editor` decía CUÁL de esos
-- cinco abrir, y `?rvOpen=Own%20Production&rvLo=24` en la URL lo pedía por
-- nombre.
--
-- Al rebasar `feat/ol26-vista-outlook` sobre `main` (que ya trae esta fase de
-- la revisión, RV4), esa pantalla por estrategia ya no existe: OL26 la
-- reemplazó por un único `PersonBudgetEditor` por persona, que compone Own
-- Production, B2B, NPPM, Recruitment y Business Plan en una sola pantalla.
-- Ya no hay CINCO editores entre los que elegir -- hay uno solo -- así que
-- `open_editor` deja de nombrar una estrategia y pasa a ser un valor fijo:
--
--     'budget'   -- abrí el editor de presupuesto de esta persona.
--
-- Ver `app/outlook/branch/[code]/page.tsx`, la nota de `rvPedido`: ahora
-- valida `rvOpen === 'budget'` en vez de `OUTLOOK_STRATEGIES.includes(rvOpen)`.
--
-- ----------------------------------------------------------------------------
-- QUÉ HACE
-- ----------------------------------------------------------------------------
--
-- Actualiza la MISMA fila que fijó la migración anterior (paso 2.2, fase 2)
-- de `'Own Production'` a `'budget'`. Ninguna otra fila de `review.step` tiene
-- `open_editor` hoy -- ver la verificación más abajo antes de correr esto,
-- por si otra revisión ya agregó una fila nueva mientras tanto.

begin;

update review.step
   set gate_config = gate_config || '{"open_editor": "budget"}'::jsonb
 where phase_no = 2 and step_in_phase = 2   -- Budget and strategies
   and gate_config ->> 'open_editor' = 'Own Production';

commit;


-- ============================================================================
-- CÓMO COMPROBARLO
-- ============================================================================
--
-- 1. ANTES de correrlo, confirmar que sigue siendo la única fila afectada:
--
--      select phase_no, step_in_phase, gate_config ->> 'open_editor' as abre
--        from review.step
--       where gate_config ->> 'open_editor' is not null;
--      -- espera: una fila, phase_no=2, step_in_phase=2, abre='Own Production'
--
-- 2. DESPUÉS, que diga 'budget' y que no haya quedado ningún 'Own Production'
--    ni ningún otro nombre de estrategia dando vueltas:
--
--      select phase_no, step_in_phase, gate_config ->> 'open_editor' as abre
--        from review.step
--       where gate_config ->> 'open_editor' is not null;
--      -- espera: una fila, phase_no=2, step_in_phase=2, abre='budget'
--
-- ⚠ Mientras esta fila siga diciendo 'Own Production', el paso 2.2 no abre
-- ningún editor -- `rvPedido` en la pantalla de Outlook ignora cualquier valor
-- de `rvOpen` que no sea exactamente `'budget'`, así que la revisión llega al
-- lugar correcto pero no encuentra el editor abierto, en silencio.
--
-- ----------------------------------------------------------------------------
-- PARA REVERTIR
-- ----------------------------------------------------------------------------
--
--   begin;
--   update review.step
--      set gate_config = gate_config || '{"open_editor": "Own Production"}'::jsonb
--    where phase_no = 2 and step_in_phase = 2
--      and gate_config ->> 'open_editor' = 'budget';
--   commit;
--
-- ⚠ Revertir esto sin revertir también el código de `page.tsx` deja el editor
-- sin abrirse otra vez -- las dos cosas cambian juntas, o ninguna.
