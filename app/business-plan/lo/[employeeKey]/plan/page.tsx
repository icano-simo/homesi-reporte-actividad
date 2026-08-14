'use client';

import { useMemo, useState, use } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { useEnrollment, type PlanMilestone } from '@/lib/business-plan/useEnrollment';
import { useFunnelLibrary, useSessionEmail } from '@/lib/business-plan/useFunnelLibrary';
import { canEditMilestone, canToggleMilestone, progressOf } from '@/lib/business-plan/funnels';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../../components/Breadcrumbs';
import Modal from '../../../components/Modal';
import { ErrorState, LoadingState, initialsOf } from '../../../components/shared';
import PlanEditor from './PlanEditor';

/**
 * ============================================================================
 * PORTAL DEL PLAN ACTIVO
 * ============================================================================
 *
 * Etapa BP12, fase 4 — ARCHIVO NUEVO.
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

  /* La biblioteca sólo se usa para el editor: de ahí salen los nodos que se
     pueden agregar al plan. */
  const { data: lib } = useFunnelLibrary();
  const [editing, setEditing] = useState(false);
  const [activeNode, setActiveNode] = useState<number | null>(null);
  const [showTeam, setShowTeam] = useState(false);
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

  async function toggle(m: PlanMilestone) {
    setBusy(m.enrollment_milestone_key);
    setOpError(null);
    try {
      const supabase = getSupabaseClient();
      const { error: e } = await supabase
        .schema('business_plan')
        .from('enrollment_milestone')
        .update({
          status: 'done',
          completed_at: new Date().toISOString(),
          completed_by: sessionEmail,
        })
        .eq('enrollment_milestone_key', m.enrollment_milestone_key);
      if (e) throw new Error(e.message);
      reload();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /*
   * "Ahora" se fija UNA vez, al montar, y no se lee en cada render: `Date.now()`
   * dentro del render es impuro -- dos renders del mismo estado podrían dar
   * semanas distintas si el componente se re-renderiza al cruzar la medianoche.
   */
  const [mountedAt] = useState(() => Date.now());

  /** Semana en curso del plan, contada desde la activación. */
  const weekNumber = useMemo(() => {
    if (!plan) return 1;
    const start = new Date(plan.activated_at).getTime();
    const days = Math.floor((mountedAt - start) / 86400000);
    return Math.max(1, Math.floor(days / 7) + 1);
  }, [plan, mountedAt]);

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
          {/* ── Cabecera con el anillo de progreso ─────────────────────────── */}
          <div className="bp-plan-head">
            <div>
              <h1 className="page-head__title">{plan.funnel_name}</h1>
              <p className="page-head__subtitle">
                {lo?.fullName ?? '—'}
                {branch && <> · Branch {branch}</>} · started {plan.activated_at.slice(0, 10)} · week {weekNumber}
              </p>
            </div>
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
                {totals.done} of {totals.total} sub-milestones
              </div>
            </div>
          </div>

          {/* ── Stepper de nodos ───────────────────────────────────────────── */}
          <div className="bp-stepper">
            {plan.nodes.map((n, i) => {
              const done = n.milestones.filter((m) => m.status === 'done').length;
              const complete = n.milestones.length > 0 && done === n.milestones.length;
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
                    {done}/{n.milestones.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Tarjeta del nodo seleccionado ──────────────────────────────── */}
          {node && (
            <div className="mcard bp-plan-node">
              <div className="bp-plan-node__head">
                <div>
                  <h2 className="bp-plan-node__title">{node.name}</h2>
                  {node.description && <p className="bp-plan-node__desc">{node.description}</p>}
                </div>
                <div className="bp-plan-node__owners">
                  {/*
                    El responsable del nodo activo SÍ queda visible: es el que
                    importa mientras se trabaja acá. El equipo completo va
                    detrás de un botón, más abajo.
                  */}
                  {[...new Set(node.milestones.map((m) => m.accountable_employee_key).filter(Boolean))]
                    .slice(0, 3)
                    .map((k) => {
                      const p = personOf(k as number);
                      return p ? (
                        <span key={p.employee_key} className="bp-avatar bp-avatar--sm" title={p.full_name + ' · ' + (p.job_title ?? '')}>
                          {initialsOf(p.full_name)}
                        </span>
                      ) : null;
                    })}
                </div>
              </div>

              <ul className="bp-ms-list">
                {node.milestones.map((m) => {
                  const person = personOf(m.accountable_employee_key);
                  const mine = canToggleMilestone(sessionEmail, person?.email ?? null);
                  const editable = canEditMilestone(m.status);
                  const locked = !mine || !editable;
                  return (
                    <li key={m.enrollment_milestone_key} className={'bp-ms' + (m.status === 'done' ? ' is-done' : '')}>
                      {/*
                        ⚠ SOLO EL RESPONSABLE puede marcar. Para todos los demás
                        el control queda deshabilitado con un candado y el título
                        dice quién puede -- deshabilitarlo en silencio dejaría a
                        la persona buscando por qué no le responde el clic.

                        La comparación es por EMAIL contra el del responsable,
                        no por nombre: el roster tiene "Ana Zegarra (Peña)" y
                        "Ana Peña" para la misma persona.
                      */}
                      <button
                        type="button"
                        className={'bp-ms__check' + (locked ? ' is-locked' : '')}
                        disabled={locked || busy === m.enrollment_milestone_key}
                        onClick={() => toggle(m)}
                        title={
                          m.status === 'done'
                            ? 'Completed on ' + String(m.completed_at).slice(0, 10) + ' — done milestones cannot be reopened'
                            : mine
                              ? 'Mark as done'
                              : person
                                ? `Only ${person.full_name} can mark this one`
                                : 'No accountable person assigned'
                        }
                        aria-label={mine && editable ? 'Mark as done' : 'Locked'}
                      >
                        {m.status === 'done' ? '✓' : locked ? '🔒' : ''}
                      </button>

                      <span className="bp-ms__title">{m.title}</span>

                      {person && (
                        <span className="bp-ms__person">
                          <span className="bp-avatar bp-avatar--sm">{initialsOf(person.full_name)}</span>
                          {person.full_name}
                        </span>
                      )}

                      <span
                        className={
                          'badge badge--pill ' +
                          (m.status === 'done' ? 'badge--emerald' : m.status === 'in_progress' ? 'badge--amber' : 'badge--neutral')
                        }
                      >
                        {m.status === 'done' ? 'Done' : m.status === 'in_progress' ? 'In progress' : 'Pending'}
                      </span>

                      <span className="bp-ms__due">{m.due_date ?? '—'}</span>
                    </li>
                  );
                })}
                {node.milestones.length === 0 && <li className="bp-muted-line">No milestones in this node.</li>}
              </ul>
            </div>
          )}

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
              reestructurar el plan.
            */}
            <button type="button" className="bp-btn bp-btn--small" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Close editor' : 'Edit plan'}
            </button>
            <div className="bp-team-bar__stack">
              {plan.support.slice(0, 4).map((p) => (
                <span key={p.employee_key} className="bp-avatar bp-avatar--sm" title={p.full_name}>
                  {initialsOf(p.full_name)}
                </span>
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
