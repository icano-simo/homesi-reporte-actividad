/*
 * ============================================================================
 * RV2 — A QUÉ ELEMENTO APUNTA CADA PASO
 * ============================================================================
 *
 * El paso decía `Closings this year` y no señalaba nada: quien no sabe qué
 * mirar no lo encuentra. Con esto, la pantalla se desplaza sola a la sección
 * del paso y la resalta mientras el paso está activo.
 *
 * ----------------------------------------------------------------------------
 * ⚠ ES UNA FILA, NO CÓDIGO
 * ----------------------------------------------------------------------------
 * `gate_config.target` guarda un SELECTOR DE CSS, y lo lee `stepTarget` en
 * `lib/review/gates.ts`. Agregar un paso nuevo con su lugar es un `insert` y un
 * `target`; no hay una tabla de rutas en el código que haya que mantener al
 * lado.
 *
 * Y por eso los ocho selectores de acá apuntan a clases QUE YA EXISTÍAN —
 * ninguna pantalla se tocó para esta etapa:
 *
 *   .bp-forensic        las cuatro tarjetas del pipeline del mes   (BP31)
 *   .bp-chart-card      el gráfico de cierres del año              (BP9)
 *   .bp-stats           el panel del GAP, con el benchmark adentro (BP31)
 *   .bp-q2-cards        las tarjetas de future performance         (BP31)
 *   .bp-verdict-panel   el veredicto                               (BP12)
 *   .bp-decision        la barra de decisión, donde se elige funnel
 *   .ol-topbar          la barra de Outlook, con `Project through` (OL22)
 *   .ol-editor          el editor del presupuesto
 *
 * ----------------------------------------------------------------------------
 * ⚠ `null` Y «NO ENCONTRADO» SON DISTINTOS, Y LA APP LOS TRATA DISTINTO
 * ----------------------------------------------------------------------------
 *   · sin `target`  = el paso no declara lugar. Se contesta desde donde sea.
 *   · con `target` que no está en la página = el paso SÍ tiene lugar y no
 *     estamos ahí: el panel NO ofrece el campo de comentario y dice a dónde ir.
 *
 * Si un selector queda mal escrito, el paso se vuelve incontestable desde
 * cualquier pantalla y el aviso de la consola dice cuál es. Se prefirió eso a
 * que un `target` roto se comportara igual que un paso sin lugar, que es la
 * clase de respaldo que hace que la ausencia no se note.
 *
 * ----------------------------------------------------------------------------
 * ⚠ CADA `update` PRESERVA EL RESTO DE `gate_config`
 * ----------------------------------------------------------------------------
 * Con `||` sobre el jsonb, no reemplazando el objeto: los pasos 1.2, 1.4 y 3.1
 * ya tienen `mmi_link`, `required_clicks` y `allow_second`. Escribir el objeto
 * entero borraría esas claves, y el paso 4 dejaría de pedir sus dos clics sin
 * que nada fallara.
 *
 * `coalesce(gate_config, '{}'::jsonb)` porque cinco de los ocho lo tienen en
 * `null`, y `null || '{...}'` es `null` — no un error, un `null` silencioso.
 * Es el mismo cuidado que cualquier concatenación con nulos.
 *
 * ----------------------------------------------------------------------------
 * NO EJECUTADO. Se entrega para aplicar.
 * ----------------------------------------------------------------------------
 * Verificado contra la base con estas mismas ocho filas sembradas y borradas
 * después: el desplazamiento y el resaltado se midieron en dos pasos distintos.
 * Los `gate_config` de la base quedaron como estaban.
 */

begin;

/* ── Fase 1 · Business Plan profile ──────────────────────────────────────── */

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".bp-chart-card"}'::jsonb
  where phase_no = 1 and step_in_phase = 1;   -- Closings this year

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".bp-stats"}'::jsonb
  where phase_no = 1 and step_in_phase = 2;   -- Set the benchmark

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".bp-q2-cards"}'::jsonb
  where phase_no = 1 and step_in_phase = 3;   -- Future performance — applications

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".bp-forensic"}'::jsonb
  where phase_no = 1 and step_in_phase = 4;   -- Current performance this month

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".bp-verdict-panel"}'::jsonb
  where phase_no = 1 and step_in_phase = 5;   -- Risk status

/* ── Fase 2 · Outlook budget ─────────────────────────────────────────────── */

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".ol-topbar"}'::jsonb
  where phase_no = 2 and step_in_phase = 1;   -- Project through

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".ol-editor"}'::jsonb
  where phase_no = 2 and step_in_phase = 2;   -- Budget and strategies

/* ── Fase 3 · Funnel selection ───────────────────────────────────────────── */

update review.step set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"target": ".bp-decision"}'::jsonb
  where phase_no = 3 and step_in_phase = 1;   -- Funnel selection

commit;

/*
 * ============================================================================
 * COMPROBACIONES DESPUÉS DE APLICAR
 * ============================================================================
 */

/* 1. Los ocho pasos tienen lugar. Tiene que devolver 8. */
select count(*) as con_lugar
from review.step
where gate_config ? 'target';

/* 2. Y NINGUNA clave anterior se perdió. Las tres tienen que seguir. */
select phase_no, step_in_phase,
       gate_config ? 'mmi_link'       as tiene_mmi,
       gate_config ? 'required_clicks' as tiene_clics,
       gate_config ? 'allow_second'    as tiene_segundo
from review.step
where phase_no * 10 + step_in_phase in (12, 14, 31)
order by phase_no, step_in_phase;
/* Esperado:
 *   1 · 2   tiene_mmi = true
 *   1 · 4   tiene_clics = true
 *   3 · 1   tiene_segundo = true
 */

/* 3. ⚠ ESTA TIENE QUE DEVOLVER CERO FILAS. Un `target` vacío o que no empiece
 *    con `.` o `#` no es un selector que la app pueda resolver, y el paso
 *    quedaría incontestable desde cualquier pantalla. */
select phase_no, step_in_phase, gate_config -> 'target' as target
from review.step
where gate_config ? 'target'
  and (
    btrim(gate_config ->> 'target') = ''
    or left(btrim(gate_config ->> 'target'), 1) not in ('.', '#', '[')
  );
