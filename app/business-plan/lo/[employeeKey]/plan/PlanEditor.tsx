'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  buildEnrollmentPlan,
  canRemovePlanNode,
  recalcDueDates,
  type FunnelNode,
  type NodeMilestone,
} from '@/lib/business-plan/funnels';
import type { ActivePlan, PlanMilestone, PlanNode } from '@/lib/business-plan/useEnrollment';
import type { SupportPerson } from '@/lib/business-plan/useFunnelLibrary';
import { CloseIcon } from '@/components/ui/icons';
import Modal from '../../../components/Modal';
import { ConfirmDelete, MilestoneForm } from '../../../library/LibraryForms';

/**
 * ============================================================================
 * EDICIÓN DEL PLAN DE UNA PERSONA
 * ============================================================================
 *
 * Etapa BP14 — ARCHIVO NUEVO.
 *
 * Todo lo que se hace acá toca SÓLO el plan de esta persona. El plan es una
 * copia, así que agregar un nodo, quitarlo o reordenarlo no cambia la plantilla
 * de la biblioteca ni el plan de nadie más. Eso es lo que reemplaza la idea de
 * crear una plantilla nueva por cada variación.
 *
 * ---------------------------------------------------------------------------
 * DOS REGLAS QUE LA BASE IMPONE Y LA INTERFAZ TIENE QUE EXPLICAR
 * ---------------------------------------------------------------------------
 *  1. Un nodo con algún milestone en `done` NO se puede quitar. La política de
 *     borrado de `enrollment_node` lo comprueba, porque el borrado en cascada
 *     no evalúa la RLS del hijo y si no se llevaría milestones históricos.
 *  2. Un milestone en `done` no se edita ni se borra.
 *
 * En los dos casos la base devuelve 0 filas EN SILENCIO. Sin avisar antes, el
 * botón parecería no funcionar. Mismo patrón que `checkActivation`: se valida
 * antes de mostrar y se revalida al ejecutar.
 */

export default function PlanEditor({
  plan,
  libraryNodes,
  libraryMilestones,
  support,
  onDone,
}: {
  plan: ActivePlan;
  libraryNodes: FunnelNode[];
  libraryMilestones: NodeMilestone[];
  support: SupportPerson[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'add-node' }
    | { kind: 'remove-node'; node: PlanNode }
    | { kind: 'ms-form'; nodeKey: number; milestone: PlanMilestone | null }
    | { kind: 'ms-delete'; milestone: PlanMilestone }
    | null
  >(null);

  const bp = () => getSupabaseClient().schema('business_plan');
  const activationDate = plan.activated_at.slice(0, 10);

  /* `PromiseLike` y no `Promise`: los builders de PostgREST son thenables. */
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
      setDialog(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Reordena y RECALCULA las fechas.
   *
   * Los milestones ya hechos conservan la suya: su fecha es historia, y decir
   * que un paso completado el 3 de septiembre "vence" el 20 de agosto porque
   * alguien reordenó después sería reescribir el pasado.
   */
  async function reorder(nodeKey: number, delta: number) {
    const order = [...plan.nodes].sort((a, b) => a.position - b.position);
    const i = order.findIndex((n) => n.enrollment_node_key === nodeKey);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];

    await run(async () => {
      for (let k = 0; k < order.length; k++) {
        const r = await bp()
          .from('enrollment_node')
          .update({ position: k + 1 })
          .eq('enrollment_node_key', order[k].enrollment_node_key);
        if (r.error) return r;
      }
      const updates = recalcDueDates(
        order.map((n, k) => ({ ...n, position: k + 1 })),
        activationDate
      );
      for (const u of updates) {
        const r = await bp()
          .from('enrollment_milestone')
          .update({ due_date: u.due_date })
          .eq('enrollment_milestone_key', u.enrollment_milestone_key);
        if (r.error) return r;
      }
      return { error: null };
    });
  }

  /** Agrega un nodo de la biblioteca al plan, COPIANDO sus milestones. */
  async function addNode(nodeKey: number) {
    const ordered = [...plan.nodes].sort((a, b) => a.position - b.position).map(() => 0);
    const nextPosition = ordered.length + 1;
    /*
     * Se reusa `buildEnrollmentPlan` con un solo nodo: la fecha se recalcula
     * igual después, así que lo único que importa acá es traer los milestones
     * con su SLA. Duplicar la lógica de copia sería el camino seguro a que las
     * dos versiones se desincronicen.
     */
    const draft = buildEnrollmentPlan([nodeKey], libraryNodes, libraryMilestones, activationDate)[0];
    if (!draft) return;

    await run(async () => {
      const ins = await bp()
        .from('enrollment_node')
        .insert({
          enrollment_key: plan.enrollment_key,
          source_node_key: draft.source_node_key,
          name: draft.name,
          description: draft.description,
          icon: draft.icon,
          position: nextPosition,
        })
        .select('enrollment_node_key')
        .single();
      if (ins.error) return ins;
      const key = (ins.data as { enrollment_node_key: number }).enrollment_node_key;
      if (draft.milestones.length === 0) return { error: null };
      return bp()
        .from('enrollment_milestone')
        .insert(
          draft.milestones.map((m) => ({
            enrollment_node_key: key,
            source_milestone_key: m.source_milestone_key,
            title: m.title,
            accountable_employee_key: m.accountable_employee_key,
            resource_url: m.resource_url,
            due_date: m.due_date,
            sla_days: m.sla_days,
            status: 'pending',
            position: m.position,
          }))
        );
    });
  }

  const ordered = [...plan.nodes].sort((a, b) => a.position - b.position);

  return (
    <div className="bp-editor">
      <div className="bp-editor__head">
        <span className="bp-editor__title">Edit this plan</span>
        <span className="bp-editor__hint">Only this person&apos;s plan changes — the library template is untouched.</span>
        <button type="button" className="bp-btn bp-btn--small" onClick={() => setDialog({ kind: 'add-node' })} disabled={busy}>
          + Add node
        </button>
      </div>

      {error && <p className="bp-modal__lead bp-modal__lead--warn">{error}</p>}


      <ul className="bp-editor__nodes">
        {ordered.map((n, i) => {
          const check = canRemovePlanNode(n);
          return (
            <li key={n.enrollment_node_key} className="bp-editor__node">
              <span className="bp-editor__pos">{i + 1}</span>
              <span className="bp-editor__name">{n.name}</span>
              <span className="bp-editor__count">{n.milestones.length} steps</span>
              <div className="bp-actions">
                <button type="button" className="bp-icon-btn" disabled={busy || i === 0} title="Move earlier" onClick={() => reorder(n.enrollment_node_key, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className="bp-icon-btn"
                  disabled={busy || i === ordered.length - 1}
                  title="Move later"
                  onClick={() => reorder(n.enrollment_node_key, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="bp-icon-btn"
                  title="Add a step to this node"
                  disabled={busy}
                  onClick={() => setDialog({ kind: 'ms-form', nodeKey: n.enrollment_node_key, milestone: null })}
                >
                  +
                </button>
                {/*
                  Deshabilitado con el motivo cuando hay pasos hechos, no en
                  silencio: la base devolvería 0 filas y el botón parecería roto.
                */}
                <button
                  type="button"
                  className="bp-icon-btn bp-icon-btn--danger"
                  title={check.ok ? 'Remove this node from the plan' : check.reason ?? ''}
                  disabled={busy || !check.ok}
                  onClick={() => setDialog({ kind: 'remove-node', node: n })}
                >
                  <CloseIcon size={13} />
                </button>
              </div>
              {!check.ok && <span className="bp-editor__blocked">{check.reason}</span>}

              <ul className="bp-editor__ms">
                {n.milestones.map((m) => {
                  const locked = m.status === 'done';
                  return (
                    <li key={m.enrollment_milestone_key} className={locked ? 'is-locked' : ''}>
                      <span className="bp-editor__ms-title">{m.title}</span>
                      {/* Cambiar el responsable, en la línea. */}
                      <select
                        className="bp-inline-input"
                        value={m.accountable_employee_key ?? ''}
                        disabled={busy || locked}
                        title={locked ? 'Completed steps cannot be edited' : 'Change the accountable person'}
                        onChange={(e) =>
                          run(() =>
                            bp()
                              .from('enrollment_milestone')
                              .update({ accountable_employee_key: e.target.value === '' ? null : Number(e.target.value) })
                              .eq('enrollment_milestone_key', m.enrollment_milestone_key)
                          )
                        }
                      >
                        <option value="">— unassigned —</option>
                        {support.map((s) => (
                          <option key={s.employee_key} value={s.employee_key}>
                            {s.full_name}
                          </option>
                        ))}
                      </select>
                      <span className="bp-editor__due">{m.due_date ?? '—'}</span>
                      <div className="bp-actions">
                        <button
                          type="button"
                          className="bp-icon-btn"
                          disabled={busy || locked}
                          title={locked ? 'Completed steps cannot be edited' : 'Edit'}
                          onClick={() => setDialog({ kind: 'ms-form', nodeKey: n.enrollment_node_key, milestone: m })}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="bp-icon-btn bp-icon-btn--danger"
                          disabled={busy || locked}
                          title={locked ? 'Completed steps cannot be deleted' : 'Delete'}
                          onClick={() => setDialog({ kind: 'ms-delete', milestone: m })}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {/* ══ Diálogos ═══════════════════════════════════════════════════════ */}

      {dialog?.kind === 'add-node' && (
        <Modal title="Add a node from the library" onClose={() => setDialog(null)}>
          <p className="bp-modal__lead">
            It is copied with its milestones. The library template is not modified, and neither is anyone else&apos;s plan.
          </p>
          <div className="bp-node-grid">
            {libraryNodes.map((n) => (
              <button key={n.node_key} type="button" className="bp-node-card" disabled={busy} onClick={() => addNode(n.node_key)}>
                <div className="bp-node-card__name">{n.name}</div>
                <div className="bp-node-card__meta">
                  {libraryMilestones.filter((m) => m.node_key === n.node_key).length} milestones
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {dialog?.kind === 'remove-node' && (
        <ConfirmDelete
          what={'node "' + dialog.node.name + '" from this plan'}
          busy={busy}
          warning={`Its ${dialog.node.milestones.length} milestones go with it. The library template keeps this node.`}
          /* Se revalida al ejecutar: entre abrir el diálogo y confirmar, alguien
             pudo haber marcado un paso como hecho. */
          blockedReason={canRemovePlanNode(dialog.node).reason}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(async () => {
              const recheck = canRemovePlanNode(dialog.node);
              if (!recheck.ok) return { error: { message: recheck.reason ?? 'Cannot remove this node.' } };
              const del = await bp().from('enrollment_node').delete().eq('enrollment_node_key', dialog.node.enrollment_node_key).select();
              if (del.error) return del;
              /*
               * La base puede rechazar en silencio devolviendo 0 filas. Si no se
               * comprueba, la pantalla recargaría mostrando el nodo todavía ahí
               * y parecería que el botón no hizo nada.
               */
              if ((del.data ?? []).length === 0) {
                return { error: { message: 'The database refused: this node has completed milestones.' } };
              }
              return { error: null };
            })
          }
        />
      )}

      {dialog?.kind === 'ms-form' && (
        <MilestoneForm
          /*
            Los steps del MISMO nodo del plan, para que la vista previa diga en
            que dia cae cada uno -- etapa BP40. Salen de la copia de la persona
            y no de la plantilla: los dias que importan son los de su plan.
          */
          siblings={(plan.nodes.find((n) => n.enrollment_node_key === dialog.nodeKey)?.milestones ?? []).map(
            (m) => ({
              milestone_key: m.enrollment_milestone_key,
              title: m.title,
              sla_days: m.sla_days,
              position: m.position,
            })
          )}
          initial={
            dialog.milestone
              ? {
                  milestone_key: dialog.milestone.enrollment_milestone_key,
                  node_key: dialog.nodeKey,
                  title: dialog.milestone.title,
                  accountable_employee_key: dialog.milestone.accountable_employee_key,
                  sla_days: dialog.milestone.sla_days,
                  resource_url: dialog.milestone.resource_url,
                  position: dialog.milestone.position,
                }
              : null
          }
          support={support}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(d) => {
            const sla = d.sla_days === '' ? null : Number(d.sla_days);
            const row = {
              enrollment_node_key: dialog.nodeKey,
              title: d.title.trim(),
              accountable_employee_key: d.accountable_employee_key === '' ? null : Number(d.accountable_employee_key),
              sla_days: sla,
              resource_url: d.resource_url.trim() || null,
              position: Number(d.position) || 1,
            };
            run(async () => {
              if (dialog.milestone) {
                return bp()
                  .from('enrollment_milestone')
                  .update(row)
                  .eq('enrollment_milestone_key', dialog.milestone.enrollment_milestone_key);
              }
              /* Un milestone nuevo arranca sin fecha si no tiene SLA; con SLA,
                 se calcula igual que los demás en el próximo reordenamiento. */
              return bp().from('enrollment_milestone').insert({ ...row, status: 'pending', due_date: null });
            });
          }}
        />
      )}

      {dialog?.kind === 'ms-delete' && (
        <ConfirmDelete
          what={'milestone "' + dialog.milestone.title + '"'}
          busy={busy}
          warning="Only this person's plan changes."
          blockedReason={dialog.milestone.status === 'done' ? 'Completed milestones are history and cannot be deleted.' : null}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(() =>
              bp().from('enrollment_milestone').delete().eq('enrollment_milestone_key', dialog.milestone.enrollment_milestone_key)
            )
          }
        />
      )}
    </div>
  );
}
