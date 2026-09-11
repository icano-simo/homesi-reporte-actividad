/*
 * ============================================================================
 * RV4 — LA FASE 2: QUÉ MIRAR, Y QUÉ SE ABRE SOLO
 * ============================================================================
 *
 * Dos cosas, y las dos son filas:
 *
 *   1. `gate_config.open_editor` — qué editor de presupuesto tiene que estar
 *      abierto al llegar al paso. Lo lee `stepOpenEditor` y viaja a la pantalla
 *      de Outlook por la URL (`?rvOpen=…&rvLo=…`).
 *
 *   2. `step_prompt.helper` — la INSTRUCCIÓN. Isabella llegó a la pantalla
 *      correcta y el paso no decía qué revisar: no sabía que había que mirar el
 *      actual, el forecast y el presupuesto como una línea, ni que había que
 *      abrir el editor de la regla.
 *
 * ----------------------------------------------------------------------------
 * ⚠ EL TEXTO ES DE ISABELLA. ESTO ES UN BORRADOR.
 * ----------------------------------------------------------------------------
 * `prompt` sigue en PLACEHOLDER a propósito: es su voz y no la mía. Lo que estas
 * filas agregan es el `helper`, que es la parte OPERATIVA — qué mirar antes de
 * comentar. Está escrito para que se pueda reemplazar palabra por palabra sin
 * tocar nada más.
 *
 * Y va como una revisión NUEVA de `step_prompt`, no como un `update`: cada
 * respuesta guarda contra qué `revision` se contestó, así que editar la fila
 * vieja reescribiría el significado de los intakes ya escritos. Es la misma
 * razón por la que el plan se copia al activar un funnel.
 *
 * ----------------------------------------------------------------------------
 * ⚠ Y LA CONSECUENCIA QUE HAY QUE SABER: los intakes viejos van a decir
 * «wording has changed since» en estos dos pasos. Es correcto — el texto
 * cambió — y es exactamente para eso que ese marcador existe.
 *
 * ----------------------------------------------------------------------------
 * NO EJECUTADO. Se entrega para aplicar.
 * ----------------------------------------------------------------------------
 */

begin;

/* ── 1. El editor que se abre solo ───────────────────────────────────────── */

/*
 * `Own Production` en los dos pasos de la fase 2, y es una decisión que conviene
 * mirar: es la estrategia de los cierres propios del Loan Officer, que es de lo
 * que habla la fase 1 --el benchmark, el gap, el forecast--. Las otras cuatro
 * (`B2B`, `NPPM`, `Recruitment`, `Affinity`) son de dónde viene el negocio, no
 * de cuánto cierra la persona.
 *
 * Si la revisión tiene que mirar otra, es un `update` de esta clave.
 */
update review.step
   set gate_config = coalesce(gate_config, '{}'::jsonb) || '{"open_editor": "Own Production"}'::jsonb
 where phase_no = 2 and step_in_phase = 2;   -- Budget and strategies

/*
 * ⚠ Y EN EL PASO 2.1 NO SE ABRE NADA, deliberadamente. Ese paso es de LEER --el
 * actual, el forecast y el presupuesto como una línea-- y abrirle el editor
 * encima taparía justamente lo que hay que leer. El editor se abre al llegar al
 * 2.2, que es el paso que lo usa.
 */

/* ── 2. La instrucción de cada paso ──────────────────────────────────────── */

insert into review.step_prompt (phase_no, step_in_phase, revision, prompt, helper, created_by)
select 2, 1,
       coalesce(max(revision), 0) + 1,
       /* El `prompt` se conserva tal cual: es de Isabella. */
       (select prompt from review.step_prompt
         where phase_no = 2 and step_in_phase = 1
         order by revision desc limit 1),
       'Read these three as one line before commenting: what the branch has closed so far, '
       'what the projection says it will close, and what the budget asks for. The gap between '
       'the projection and the budget is the conversation.',
       'rv4-draft'
  from review.step_prompt
 where phase_no = 2 and step_in_phase = 1;

insert into review.step_prompt (phase_no, step_in_phase, revision, prompt, helper, created_by)
select 2, 2,
       coalesce(max(revision), 0) + 1,
       (select prompt from review.step_prompt
         where phase_no = 2 and step_in_phase = 2
         order by revision desc limit 1),
       'The budget editor opens on this screen. Check the benchmark, then the growth rule or the '
       'month-by-month targets, and save with "Save budget" — one write covers all three. '
       'This step closes when that row exists, not when you tick anything.',
       'rv4-draft'
  from review.step_prompt
 where phase_no = 2 and step_in_phase = 2;

commit;

/*
 * ============================================================================
 * COMPROBACIONES DESPUÉS DE APLICAR
 * ============================================================================
 */

/* 1. El paso 2.2 abre `Own Production`, y el 2.1 no abre nada. Dos filas. */
select phase_no, step_in_phase,
       gate_config ->> 'open_editor' as abre,
       gate_config ->> 'target'      as apunta
from review.step
where phase_no = 2
order by step_in_phase;
/* Esperado:
 *   2 · 1   abre = NULL            apunta = .ol-topbar
 *   2 · 2   abre = Own Production  apunta = .ol-editor
 */

/* 2. Los dos pasos tienen una revisión nueva CON helper, y el prompt intacto. */
select phase_no, step_in_phase, revision, created_by,
       helper is not null as tiene_instruccion,
       prompt = (
         select p2.prompt from review.step_prompt p2
         where p2.phase_no = sp.phase_no and p2.step_in_phase = sp.step_in_phase
         order by p2.revision limit 1
       ) as prompt_sin_cambios
from review.step_prompt sp
where phase_no = 2
order by step_in_phase, revision;

/* 3. ⚠ ESTA TIENE QUE DEVOLVER CERO FILAS: ninguna revisión anterior se tocó.
 *    Un `update` sobre la fila vieja reescribiría el significado de los intakes
 *    ya escritos, y es justo lo que este archivo evita. */
select phase_no, step_in_phase, revision
from review.step_prompt
where created_by = 'rv4-draft'
  and revision = 1;
