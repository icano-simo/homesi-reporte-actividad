'use client';

import { useMemo, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { useEnrollment, type PlanMilestone, type PlanNode } from '@/lib/business-plan/useEnrollment';
import { useFunnelLibrary, useSessionEmail } from '@/lib/business-plan/useFunnelLibrary';
import {
  MILESTONE_STATUS_CLASS,
  MILESTONE_STATUS_LABEL,
  allowedStatuses,
  canToggleMilestone,
  isOverdue,
  progressOf,
  type MilestoneStatus,
} from '@/lib/business-plan/funnels';
import { AlertTriangleIcon, MessageIcon, TrendingUpIcon } from '@/components/ui/icons';
import { useBaseline } from '@/lib/business-plan/useBaseline';
import {
  averageOver,
  completeMonthsAfter,
  fmtPct,
  monthOf,
  pctChange,
} from '@/lib/business-plan/impact';
import { monthsOfYear, currentYearMonth } from '@/lib/business-plan/months';
import Breadcrumbs from '../../../components/Breadcrumbs';
import Modal from '../../../components/Modal';
import NotesPanel from '../../../components/NotesPanel';
import { FunnelGlyph } from '../../../components/funnelIcons';
import { Avatar, ErrorState, LoadingState } from '../../../components/shared';
import PlanEditor from './PlanEditor';

/**
 * ============================================================================
 * PORTAL DEL PLAN ACTIVO
 * ============================================================================
 *
 * Etapa BP12, fase 4 — ARCHIVO NUEVO.
 * Etapa BP20 — la tarjeta del nodo, las fechas editables y las notas.
 * Etapa BP21 — el icono del funnel y el color de los avatares.
 *
 * Muestra la INSTANCIA de esta persona, no la plantilla. Todo lo que se edita
 * acá es su copia: agregar, quitar o reordenar no afecta a ningún otro plan ni
 * a la biblioteca.
 *
 * Eso es lo que reemplaza a la idea de crear una plantilla por cada variación.
 * Si cada personalización fuera una plantilla nueva, en un año habría cuarenta
 * funnels casi idénticos y nadie sabría cuál usar.
 */

export default function ActivePlanPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey: rawKey } = use(params);
  const employeeKey = Number(rawKey);

  const { data: bpData } = useBusinessPlanData();
  const { plan, isLoading, available, error, reload } = useEnrollment(employeeKey);
  const sessionEmail = useSessionEmail();

  /*
   * `?activated=1` — etapa BP20. El catálogo redirige acá con ese parámetro
   * después de activar.
   *
   * ⚠ Etapa BP25: el parámetro sólo muestra el AVISO. Ya no abre el editor.
   *
   * Abrirlo era pasarse de listo: lo primero que ve alguien recién enrolado es
   * su plan, no un formulario para reestructurarlo, y el editor empujaba la
   * lista de pasos fuera de la pantalla justo cuando quiere ver qué le tocó. El
   * aviso sigue diciendo que puede ajustarlo, y el botón está al lado.
   *
   * Lo que no cambia es cuándo se puede editar: recién después de activar,
   * porque hasta ese momento lo único que existe es la plantilla y tocarla
   * cambiaría el plan de todos.
   */
  const searchParams = useSearchParams();
  const justActivated = searchParams.get('activated') === '1';
  const router = useRouter();

  /* La biblioteca sólo se usa para el editor: de ahí salen los nodos que se
     pueden agregar al plan. */
  const { data: lib } = useFunnelLibrary();
  const [editing, setEditing] = useState(false);
  const [activeNode, setActiveNode] = useState<number | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  /* Etapa BP40: quitar el plan. `false` = ni preguntado. */
  const [cancelling, setCancelling] = useState(false);
  const [openNotes, setOpenNotes] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const lo = useMemo(
    () => bpData?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null,
    [bpData, employeeKey]
  );
  const branch = lo?.branchCodes[0] ?? null;

  const totals = useMemo(() => {
    if (!plan) return { done: 0, total: 0 };
    const all = plan.nodes.flatMap((n) => n.milestones);
    return { done: all.filter((m) => m.status === 'completed').length, total: all.length };
  }, [plan]);

  /** El nodo abierto: el elegido, o el primero que no esté completo. */
  const currentNodeKey = useMemo(() => {
    if (!plan) return null;
    if (activeNode !== null) return activeNode;
    const pending = plan.nodes.find((n) => n.milestones.some((m) => m.status !== 'completed'));
    return (pending ?? plan.nodes[0])?.enrollment_node_key ?? null;
  }, [plan, activeNode]);

  const node = plan?.nodes.find((n) => n.enrollment_node_key === currentNodeKey) ?? null;

  const personOf = (key: number | null) => (key === null ? null : plan?.support.find((s) => s.employee_key === key) ?? null);

  /**
   * Una sola función para los dos campos editables del paso.
   *
   * Etapa BP20: antes había un único botón que sólo sabía escribir `done`. La
   * fecha y el estado son ahora dos controles distintos sobre la misma fila, y
   * duplicar el manejo de error y de `busy` en los dos garantizaba que se
   * desincronizaran.
   */
  async function patchMilestone(m: PlanMilestone, patch: Record<string, unknown>) {
    setBusy(m.enrollment_milestone_key);
    setOpError(null);
    try {
      /*
       * ═════════════════════════════════════════════════════════════════
       * ⚠ CERO FILAS NO ES ÉXITO — etapa BP42
       * ═════════════════════════════════════════════════════════════════
       *
       * El `.select()` no está por el dato: está para saber CUÁNTAS filas
       * cambiaron. Sin él, un UPDATE que RLS filtra devuelve HTTP 200 con
       * `error: null` y la app da el cambio por hecho.
       *
       * Medido contra la base: intentar volver un step completado a en curso
       * devuelve `200`, `filas afectadas: 0`, `error: null`. La protección --el
       * `using (status <> 'completed')` de la policy-- es correcta; el silencio
       * no. La pantalla aceptaba el clic, no mostraba nada, y el valor no
       * cambiaba.
       *
       * Es el mismo silencio de RLS que ya se documentó en AGENTS.md: filtra, no
       * rechaza. Cero filas con `error: null` es una policy que no aplica.
       */
      const { data: filas, error: e } = await getSupabaseClient()
        .schema('business_plan')
        .from('enrollment_milestone')
        .update(patch)
        .eq('enrollment_milestone_key', m.enrollment_milestone_key)
        .select('enrollment_milestone_key');
      if (e) throw new Error(e.message);
      if ((filas ?? []).length === 0) {
        /*
         * El mensaje nombra la causa concreta y no "no se pudo guardar": con
         * las policies de hoy, la única forma de que una fila visible no se
         * actualice es que ya esté completada.
         */
        throw new Error(
          'A completed step cannot be changed — not its status, not its date. Nothing was saved.'
        );
      }
      reload();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * QUITAR EL PLAN — etapa BP40
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Hasta acá no había forma de quitar un plan desde la interfaz: las veces que
   * hizo falta se borró a mano desde el editor de SQL. Una sola llamada, porque
   * son cinco tablas y un borrado repartido en varias llamadas deja estado
   * parcial en cuanto una falle -- el mismo problema que `activate_funnel`.
   *
   * ⚠ `cancel_funnel` BORRA, no archiva. Es lo que se decidió: el registro de
   * los steps hechos se va con el plan. La alternativa era guardarlos en una
   * tabla histórica, y no se hizo porque nadie los iba a leer -- pero por eso
   * la confirmación dice cuántos son antes de borrarlos.
   */
  async function cancelPlan() {
    if (!plan) return;
    /*
     * `busy` guarda la clave del step en curso, y -1 es el centinela para "una
     * operacion sobre el plan entero". Ninguna clave real es negativa. Un
     * segundo estado booleano habria sido otro que puede desincronizarse.
     */
    setBusy(-1);
    setOpError(null);
    try {
      const { error: e } = await getSupabaseClient()
        .schema('business_plan')
        .rpc('cancel_funnel', { p_enrollment_key: plan.enrollment_key });
      if (e) throw new Error(e.message);
      setCancelling(false);
      /*
       * Se va a la ficha de la persona y no se recarga esta pantalla: sin plan,
       * esta ruta no tiene nada que mostrar. `push` y no `replace` para que el
       * botón de atrás no vuelva a un plan que ya no existe... que igual
       * mostraría el estado vacío, pero llegar ahí por accidente confunde.
       */
      router.push('/business-plan/lo/' + employeeKey);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function changeStatus(m: PlanMilestone, next: MilestoneStatus) {
    if (next === m.status) return;
    /* Al pasar a hecho se sella quién y cuándo. Es lo que vuelve la fila
       inmutable: desde ese momento la policy de UPDATE ya no la ve. */
    patchMilestone(
      m,
      next === 'completed'
        ? { status: 'completed', completed_at: new Date().toISOString(), completed_by: sessionEmail }
        : { status: next }
    );
  }

  /*
   * "Ahora" se fija UNA vez, al montar, y no se lee en cada render: `Date.now()`
   * dentro del render es impuro -- dos renders del mismo estado podrían dar
   * semanas distintas si el componente se re-renderiza al cruzar la medianoche.
   */
  const [mountedAt] = useState(() => Date.now());
  const today = useMemo(() => new Date(mountedAt).toISOString().slice(0, 10), [mountedAt]);

  /** Semana en curso del plan, contada desde la activación. */
  const weekNumber = useMemo(() => {
    if (!plan) return 1;
    const start = new Date(plan.activated_at).getTime();
    const days = Math.floor((mountedAt - start) / 86400000);
    return Math.max(1, Math.floor(days / 7) + 1);
  }, [plan, mountedAt]);

  /*
   * ⚠ EL DATO DE LA CABECERA ES EL RESULTADO, NO EL AVANCE — etapa BP27.
   *
   * El anillo ya dice cuánto del plan se hizo. Poner al lado otro número que
   * también hable del avance sería decir dos veces lo mismo y no responder la
   * pregunta que justifica el módulo entero: ¿sirvió?
   *
   * Por eso se adelanta la variación de CIERRES contra la línea base congelada.
   * Es una sola de las cuatro métricas -- la que decide el veredicto -- y la
   * pantalla de impacto tiene las otras tres.
   *
   * Si todavía no hay un mes completo posterior al enrolamiento, no hay
   * variación y el botón va sin número. NO se rellena con un cero ni con un
   * −100%: es el mismo cuidado que tiene la pantalla de impacto, y romperlo acá
   * lo rompería igual.
   */
  const { baseline } = useBaseline(plan?.enrollment_key ?? null);
  const impactDelta = useMemo(() => {
    if (!plan || !lo || !baseline) return null;
    const now = new Date(mountedAt);
    const afterMonths = completeMonthsAfter(monthsOfYear(now), monthOf(plan.activated_at), currentYearMonth(now));
    if (afterMonths.length === 0) return null;
    return pctChange(baseline.closings, averageOver(lo.activity, afterMonths).closings);
  }, [plan, lo, baseline, mountedAt]);

  const nodeProgress = (n: PlanNode) => ({
    done: n.milestones.filter((m) => m.status === 'completed').length,
    total: n.milestones.length,
  });

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          ...(branch ? [{ label: branch, href: '/business-plan/branch/' + encodeURIComponent(branch) }] : []),
          ...(lo ? [{ label: lo.fullName, href: '/business-plan/lo/' + employeeKey }] : []),
          { label: 'Business Plan' },
        ]}
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {opError && (
        <div className="bp-pending" role="alert">
          <AlertTriangleIcon size={14} />
          <span>{opError}</span>
        </div>
      )}

      {!isLoading && !error && !available && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            The plan tables are not in the database yet — apply{' '}
            <code>docs/sql/2026-08-business-plan-funnels.sql</code> first.
          </span>
        </div>
      )}

      {!isLoading && available && !plan && (
        <div className="empty">
          <h2>No active plan</h2>
          <p>
            <Link href={'/business-plan/lo/' + employeeKey + '/funnel'} className="bp-crumbs__current">
              Choose a funnel
            </Link>
          </p>
        </div>
      )}

      {plan && (
        <>
          {/*
            Aviso de recién activado. Dura sólo mientras el parámetro esté en la
            URL: no es un estado que haya que guardar en ningún lado.
          */}
          {justActivated && (
            <div className="bp-just-activated" role="status">
              <strong>Plan activated.</strong> This is {lo?.fullName ?? 'this person'}&apos;s own copy — use{' '}
              <strong>Edit plan</strong> below to adjust it before starting. Adding, removing or reordering there
              changes nothing in the library or in anyone else&apos;s plan.
            </div>
          )}

          {/* ── Cabecera con el anillo de progreso ─────────────────────────── */}
          <div className="bp-plan-head">
            <div>
              <h1 className="bp-funnel-title">
                {/* Etapa BP21: el icono elegido en la biblioteca, al fin dibujado. */}
                <FunnelGlyph icon={plan.funnel_icon} size={22} />
                {plan.funnel_name}
              </h1>
              <p className="page-head__subtitle">
                {lo?.fullName ?? '—'}
                {branch && <> · Branch {branch}</>} · started {plan.activated_at.slice(0, 10)} · week {weekNumber}
              </p>
            </div>
            {/*
              Anillo y impacto van juntos en un contenedor: la cabecera es un
              flex con `space-between`, y sueltos como dos hijos el del medio
              habria quedado centrado entre el titulo y el borde.
            */}
            <div className="bp-plan-head__summary">
            <div className="bp-ring">
              {/*
                Anillo con `conic-gradient`: un SVG con stroke-dasharray daría
                lo mismo y ocuparía cuatro veces más. El porcentaje va adentro,
                que es lo que se lee de un vistazo.
              */}
              <div
                className="bp-ring__dial"
                style={{ ['--pct' as string]: progressOf(totals.done, totals.total) + '%' }}
                role="img"
                aria-label={`${progressOf(totals.done, totals.total)} percent complete`}
              >
                <span className="bp-ring__pct">{progressOf(totals.done, totals.total)}%</span>
              </div>
              <div className="bp-ring__label">
                {totals.done} of {totals.total} stages
              </div>
            </div>

            {/*
              El impacto, arriba y como bloque propio. Era un enlace subrayado al
              pie, menos visible que "Edit plan" -- y es la pregunta que
              justifica el módulo: si el plan sirvió. Un enlace al pie la
              convertía en un detalle.
            */}
            <Link href={'/business-plan/lo/' + employeeKey + '/impact'} className="bp-impact-cta">
              <span className="bp-impact-cta__label">
                <TrendingUpIcon size={14} />
                BP Impact
              </span>
              <span className={
                'bp-impact-cta__value' +
                (impactDelta === null ? ' is-none' : impactDelta > 0 ? ' is-up' : impactDelta < 0 ? ' is-down' : '')
              }>
                {impactDelta === null ? 'no data yet' : fmtPct(impactDelta)}
              </span>
              <span className="bp-impact-cta__hint">
                {impactDelta === null ? 'needs a full month after enrolment' : 'closings vs baseline'}
              </span>
            </Link>
            </div>
          </div>

          {/* ── Stepper de nodos ───────────────────────────────────────────── */}
          <div className="bp-stepper">
            {plan.nodes.map((n, i) => {
              const p = nodeProgress(n);
              const complete = p.total > 0 && p.done === p.total;
              const isCurrent = n.enrollment_node_key === currentNodeKey;
              return (
                <button
                  key={n.enrollment_node_key}
                  type="button"
                  className={
                    'bp-step' + (complete ? ' is-done' : '') + (isCurrent ? ' is-current' : '')
                  }
                  onClick={() => setActiveNode(n.enrollment_node_key)}
                >
                  <span className="bp-step__n">{i + 1}</span>
                  <span className="bp-step__name">{n.name}</span>
                  <span className="bp-step__count">
                    {p.done}/{p.total}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Tarjeta del nodo seleccionado ──────────────────────────────── */}
          {node && (() => {
            const p = nodeProgress(node);
            return (
              <div className="mcard bp-plan-node">
                {/*
                  ⚠ DOS NIVELES DE RESPONSABILIDAD — etapa BP20.
                  Los avatares del nodo estaban arriba a la derecha sin rótulo, y
                  cada paso mostraba otro responsable en su fila: parecían lo
                  mismo mal sincronizado. Son cosas distintas y ahora se dicen:
                  el del NODO responde por que la etapa avance, el del PASO lo
                  ejecuta y es el único que puede darlo por hecho.
                  Además los del nodo salían de los responsables de sus pasos, lo
                  cual era directamente falso -- en Cold Calling el nodo lo llevan
                  Juanjo e Isabella, y los seis pasos se reparten entre ellos dos.
                */}
                <div className="bp-plan-node__head">
                  <div className="bp-plan-node__ident">
                    <h2 className="bp-plan-node__title">
                      <FunnelGlyph icon={node.icon} size={18} />
                      {node.name}
                    </h2>
                    {node.description && <p className="bp-plan-node__desc">{node.description}</p>}
                  </div>

                  <div className="bp-owners">
                    <span className="bp-owners__label">Node owners</span>
                    <span className="bp-owners__list">
                      {node.owners.length === 0 ? (
                        <span className="bp-muted">none assigned</span>
                      ) : (
                        node.owners.map((o) => (
                          <span key={o.employee_key} className="bp-owners__one">
                            <Avatar name={o.full_name} title={o.full_name + ' · ' + (o.job_title ?? '')} />
                            {o.full_name}
                          </span>
                        ))
                      )}
                    </span>
                    <span className="bp-owners__hint">accountable for the step moving forward</span>
                  </div>
                </div>

                {/* Progreso DEL NODO, no del plan: el anillo de arriba es el total. */}
                <div className="bp-node-progress">
                  <div className="bp-node-progress__bar">
                    <span style={{ width: progressOf(p.done, p.total) + '%' }} />
                  </div>
                  <span className="bp-node-progress__label">
                    {p.done} of {p.total} stages done
                  </span>
                </div>

                {/* ── Los pasos, con encabezados ─────────────────────────────── */}
                <ul className="bp-ms-list">
                  {/*
                    Encabezados: la lista no los tenía, y una columna con
                    "2026-08-17" suelto no dice si es cuándo se creó, cuándo
                    vence o cuándo se hizo. Ahora dice Target date.
                  */}
                  <li className="bp-ms bp-ms--head" aria-hidden="true">
                    <span />
                    <span>Step</span>
                    <span>Owner</span>
                    <span>Status</span>
                    <span>Target date</span>
                    <span />
                  </li>

                  {node.milestones.map((m) => {
                    const person = personOf(m.accountable_employee_key);
                    const mine = canToggleMilestone(sessionEmail, person?.email ?? null);
                    const options = allowedStatuses(m.status, sessionEmail, person?.email ?? null);
                    const locked = m.status === 'completed';
                    const late = isOverdue(m.status, m.due_date, today);
                    const rowBusy = busy === m.enrollment_milestone_key;
                    return (
                      <li
                        key={m.enrollment_milestone_key}
                        className={'bp-ms' + (locked ? ' is-done' : '') + (late ? ' is-late' : '')}
                      >
                        {/*
                          ══════════════════════════════════════════════════════
                          EL CÍRCULO ES EL BOTÓN QUE PARECE — etapa BP42
                          ═══════════════════════════════════════════════════════

                          Era un `<span aria-hidden>` de 18×15 con
                          `border-radius: 50%` y un ✓ adentro: medido, sin
                          `onClick`, sin `role`, sin `tabindex` y con
                          `cursor: auto`. O sea, exactamente la forma del control
                          de completar, sin ser el control. El clic no disparaba
                          una sola llamada.

                          Ahora completa. Y el control real seguía siendo el
                          desplegable, que para 69 de los 75 steps no ofrecía la
                          opción -- las dos cosas juntas se leían como "no
                          funciona nada", que es lo que reportaron.

                          Un completado NO se reabre, así que ahí el círculo deja
                          de ser botón: un botón que no puede hacer nada es el
                          problema que este cambio vino a arreglar.
                        */}
                        {locked ? (
                          <span
                            className={'bp-ms__dot bp-ms__dot--' + m.status}
                            title={'Completed' + (m.completed_by ? ' by ' + m.completed_by : '')}
                          >
                            ✓
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={'bp-ms__dot bp-ms__dot--' + m.status + ' bp-ms__dot--btn'}
                            disabled={rowBusy}
                            aria-label={'Mark "' + m.title + '" as completed'}
                            title={'Mark as completed' + (person ? ' · accountable: ' + person.full_name : '')}
                            onClick={() => changeStatus(m, 'completed')}
                          />
                        )}

                        <span className="bp-ms__title">{m.title}</span>

                        <span className="bp-ms__person">
                          {person ? (
                            <>
                              <Avatar name={person.full_name} title={person.full_name + ' · ' + (person.job_title ?? '')} />
                              {person.full_name}
                            </>
                          ) : (
                            <span className="bp-muted">unassigned</span>
                          )}
                        </span>

                        {/*
                          ⚠ COMPLETAR YA NO ES EXCLUSIVO DEL RESPONSABLE — BP42.
                          Un plan es una herramienta de acompañamiento: el coach y
                          el Loan Officer lo revisan juntos y marcan lo que se
                          hizo. Con el permiso viejo, 69 de 75 steps no ofrecían
                          la opción a quien estuviera mirando, y el módulo llevaba
                          cero steps completados en toda su historia.
                          Quien lo marcó queda en `completed_by`, que ahora es un
                          dato distinto del responsable y sirve para algo.
                          Una fila ya hecha se muestra como píldora, sin control:
                          no se reabre, y la base tampoco lo permitiría.
                        */}
                        {locked ? (
                          <span
                            className={MILESTONE_STATUS_CLASS.completed}
                            title={
                              'Completed on ' +
                              String(m.completed_at).slice(0, 10) +
                              (m.completed_by ? ' by ' + m.completed_by : '') +
                              ' — completed steps cannot be reopened'
                            }
                          >
                            {MILESTONE_STATUS_LABEL.completed}
                          </span>
                        ) : (
                          <select
                            className={'bp-ms__status bp-ms__status--' + m.status}
                            value={m.status}
                            disabled={rowBusy}
                            onChange={(e) => changeStatus(m, e.target.value as MilestoneStatus)}
                            title={
                              person
                                ? 'Accountable: ' + person.full_name + (mine ? ' (you)' : '')
                                : 'No accountable person assigned'
                            }
                          >
                            {options.map((s) => (
                              <option key={s} value={s}>
                                {MILESTONE_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        )}

                        {/*
                          Fecha editable: reprogramar es lo que más se hace y
                          hasta ahora había que pedirlo. La cambia cualquiera del
                          equipo, no sólo el responsable -- correr una fecha es
                          coordinación, no dar algo por hecho.
                        */}
                        {locked ? (
                          <span className="bp-ms__due">{m.due_date ?? '—'}</span>
                        ) : (
                          <input
                            type="date"
                            className={'bp-ms__date' + (late ? ' is-late' : '')}
                            value={m.due_date ?? ''}
                            disabled={rowBusy}
                            title={late ? 'Overdue — reschedule it' : 'Target date. Anyone on the team can move it.'}
                            onChange={(e) => patchMilestone(m, { due_date: e.target.value === '' ? null : e.target.value })}
                          />
                        )}

                        <button
                          type="button"
                          className={'bp-icon-btn' + (openNotes === m.enrollment_milestone_key ? ' is-on' : '')}
                          title="Step notes"
                          onClick={() =>
                            setOpenNotes((k) => (k === m.enrollment_milestone_key ? null : m.enrollment_milestone_key))
                          }
                        >
                          <MessageIcon size={13} />
                        </button>

                        {openNotes === m.enrollment_milestone_key && (
                          <div className="bp-ms__notes">
                            <NotesPanel
                              target={{ kind: 'milestone', key: m.enrollment_milestone_key }}
                              compact
                              placeholder={'Notes on “' + m.title + '”…'}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {node.milestones.length === 0 && <li className="bp-muted-line">No steps in this node.</li>}
                </ul>

                <NotesPanel
                  target={{ kind: 'node', key: node.enrollment_node_key }}
                  title={'Notes on ' + node.name}
                  placeholder="What was discussed about this step…"
                />
              </div>
            );
          })()}

          {/*
            Equipo de soporte detrás de un botón. Como lista fija en la columna
            derecha, ocho personas ocupaban todo el alto y competían con los
            milestones, que es lo que la pantalla existe para mostrar.
          */}
          <div className="bp-team-bar">
            <button type="button" className="bp-btn bp-btn--small" onClick={() => setShowTeam(true)}>
              See support team
            </button>
            {/*
              Editar el plan de ESTA persona. Va detrás de un botón porque no es
              lo que se hace todos los días: lo habitual es marcar pasos, no
              reestructurar el plan. Arranca cerrado siempre, incluso recién
              activado (etapa BP25).
            */}
            <button type="button" className="bp-btn bp-btn--small" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Close editor' : 'Edit plan'}
            </button>
            {/*
              ════════════════════════════════════════════════════════════
              CAMBIAR Y QUITAR EL PLAN — etapa BP40
              ════════════════════════════════════════════════════════════

              Las dos acciones que faltaban. Sin ellas, un funnel elegido por
              error se arreglaba borrando filas desde el editor de SQL.

              "Change funnel" es un enlace al CATÁLOGO, no un selector de acá:
              elegir el funnel nuevo necesita las categorías, el explorador y
              `checkActivation`, y todo eso ya existe allá. Lleva la clave del
              enrolamiento para que la función sepa cuál cancela.

              Van al final de la barra y sin `--primary`: lo que se hace todos
              los días es marcar pasos.
            */}
            <Link className="bp-btn bp-btn--small" href={'/business-plan/lo/' + employeeKey + '/funnel?change=' + plan.enrollment_key}>
              Change funnel
            </Link>
            <button type="button" className="bp-btn bp-btn--small" onClick={() => setCancelling(true)}>
              Cancel plan
            </button>
            {/* Etapa BP27: "See impact" se fue de acá a la cabecera. Abajo
                quedan las dos acciones de gestión del plan. */}
            <div className="bp-team-bar__stack">
              {plan.support.slice(0, 4).map((p) => (
                <Avatar key={p.employee_key} name={p.full_name} />
              ))}
              {plan.support.length > 4 && <span className="bp-catalog__more">+{plan.support.length - 4}</span>}
            </div>
          </div>

          {editing && lib && (
            <PlanEditor
              plan={plan}
              libraryNodes={lib.nodes}
              libraryMilestones={lib.milestones}
              support={plan.support}
              onDone={reload}
            />
          )}

          {/*
            LA CONFIRMACIÓN DICE EL NÚMERO — etapa BP40.

            No "se va a borrar el plan", que es genérico y no se lee, sino
            cuántos steps hechos se pierden. `totals.done` es el MISMO número que
            el anillo de la cabecera, del mismo cálculo: si la confirmación
            contara por su cuenta, podría decir otro que el que la persona
            acababa de mirar.

            Y se nombra el funnel. Con dos pestañas abiertas, "cancel this plan"
            no dice cuál.
          */}
          {cancelling && (
            <Modal title="Cancel this plan?" onClose={() => setCancelling(false)}>
              <div className="bp-form">
                <p className="bp-modal__lead">
                  <strong>{lo?.fullName ?? 'This person'}</strong> is on{' '}
                  <strong>{plan.funnel_name}</strong>, started {plan.activated_at.slice(0, 10)}.
                  Cancelling removes the plan and puts them back to choosing a funnel.
                </p>
                <p className="bp-modal__lead bp-modal__lead--warn">
                  {totals.done > 0 ? (
                    <>
                      This plan has{' '}
                      <strong>
                        {totals.done} completed step{totals.done === 1 ? '' : 's'}
                      </strong>{' '}
                      — they are deleted, not archived, along with the notes and the baseline.
                    </>
                  ) : (
                    <>Nothing has been completed yet, so nothing is lost — but the notes go too.</>
                  )}{' '}
                  This cannot be undone.
                </p>
                <div className="bp-form__actions">
                  <button type="button" className="bp-btn bp-btn--primary" disabled={busy !== null} onClick={cancelPlan}>
                    {busy === -1 ? 'Cancelling…' : 'Cancel the plan'}
                  </button>
                  <button type="button" className="bp-linkish" onClick={() => setCancelling(false)}>
                    keep it
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {showTeam && (
            <Modal title="Support team" onClose={() => setShowTeam(false)}>
              <table className="piv">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Person</th>
                    <th className="bp-left">Role</th>
                    <th className="bp-left">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.support.map((p) => (
                    <tr key={p.employee_key} className="metric">
                      <td className="lbl">{p.full_name}</td>
                      <td className="bp-left">{p.job_title ?? '—'}</td>
                      <td className="bp-left">{p.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
