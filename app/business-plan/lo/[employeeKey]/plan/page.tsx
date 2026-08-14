'use client';

import { useMemo, useState, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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

  /* La biblioteca sólo se usa para el editor: de ahí salen los nodos que se
     pueden agregar al plan. */
  const { data: lib } = useFunnelLibrary();
  const [editing, setEditing] = useState(false);
  const [activeNode, setActiveNode] = useState<number | null>(null);
  const [showTeam, setShowTeam] = useState(false);
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
    return { done: all.filter((m) => m.status === 'done').length, total: all.length };
  }, [plan]);

  /** El nodo abierto: el elegido, o el primero que no esté completo. */
  const currentNodeKey = useMemo(() => {
    if (!plan) return null;
    if (activeNode !== null) return activeNode;
    const pending = plan.nodes.find((n) => n.milestones.some((m) => m.status !== 'done'));
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
      const { error: e } = await getSupabaseClient()
        .schema('business_plan')
        .from('enrollment_milestone')
        .update(patch)
        .eq('enrollment_milestone_key', m.enrollment_milestone_key);
      if (e) throw new Error(e.message);
      reload();
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
      next === 'done'
        ? { status: 'done', completed_at: new Date().toISOString(), completed_by: sessionEmail }
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
    done: n.milestones.filter((m) => m.status === 'done').length,
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
                    <span className="bp-owners__hint">accountable for the stage moving forward</span>
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
                    <span>Stage</span>
                    <span>Owner</span>
                    <span>Status</span>
                    <span>Target date</span>
                    <span />
                  </li>

                  {node.milestones.map((m) => {
                    const person = personOf(m.accountable_employee_key);
                    const mine = canToggleMilestone(sessionEmail, person?.email ?? null);
                    const options = allowedStatuses(m.status, sessionEmail, person?.email ?? null);
                    const locked = m.status === 'done';
                    const late = isOverdue(m.status, m.due_date, today);
                    const rowBusy = busy === m.enrollment_milestone_key;
                    return (
                      <li
                        key={m.enrollment_milestone_key}
                        className={'bp-ms' + (locked ? ' is-done' : '') + (late ? ' is-late' : '')}
                      >
                        <span className={'bp-ms__dot bp-ms__dot--' + m.status} aria-hidden="true">
                          {m.status === 'done' ? '✓' : ''}
                        </span>

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
                          ⚠ QUIÉN PUEDE MARCAR DONE no cambió con el desplegable.
                          `allowedStatuses` sólo incluye 'done' cuando el email de
                          la sesión coincide con el del responsable; para el resto
                          el desplegable ofrece dos opciones y el `title` dice
                          quién puede cerrarlo -- ocultarlo sin explicación dejaba
                          a la persona buscando por qué no le responde el control.
                          Y una fila ya hecha se muestra como píldora, sin control:
                          no se reabre, y la base tampoco lo permitiría.
                        */}
                        {locked ? (
                          <span
                            className={MILESTONE_STATUS_CLASS.done}
                            title={
                              'Completed on ' +
                              String(m.completed_at).slice(0, 10) +
                              (m.completed_by ? ' by ' + m.completed_by : '') +
                              ' — done stages cannot be reopened'
                            }
                          >
                            {MILESTONE_STATUS_LABEL.done}
                          </span>
                        ) : (
                          <select
                            className={'bp-ms__status bp-ms__status--' + m.status}
                            value={m.status}
                            disabled={rowBusy}
                            onChange={(e) => changeStatus(m, e.target.value as MilestoneStatus)}
                            title={
                              mine
                                ? 'You are accountable for this stage'
                                : person
                                  ? `Only ${person.full_name} can mark this one as done`
                                  : 'No accountable person assigned — nobody can close it'
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
                          title="Stage notes"
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
                  {node.milestones.length === 0 && <li className="bp-muted-line">No stages in this node.</li>}
                </ul>

                <NotesPanel
                  target={{ kind: 'node', key: node.enrollment_node_key }}
                  title={'Notes on ' + node.name}
                  placeholder="What was discussed about this stage…"
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
