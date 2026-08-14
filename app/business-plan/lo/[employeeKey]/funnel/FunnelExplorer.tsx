'use client';

import { useState } from 'react';
import { nodeDayRanges, type Funnel, type FunnelNode, type FunnelNodeLink, type NodeMilestone, type NodeOwner } from '@/lib/business-plan/funnels';
import type { SupportPerson } from '@/lib/business-plan/useFunnelLibrary';
import Modal from '../../../components/Modal';
import { initialsOf } from '../../../components/shared';

/**
 * ============================================================================
 * EXPLORAR UN FUNNEL ANTES DE ELEGIRLO
 * ============================================================================
 *
 * Etapa BP15 — ARCHIVO NUEVO. Etapa BP16 — de acordeón vertical a stepper.
 *
 * ---------------------------------------------------------------------------
 * EXPLORAR NO ES ELEGIR
 * ---------------------------------------------------------------------------
 * El clic en una tarjeta del catálogo ABRE esto; elegir se hace con el botón de
 * la tarjeta, afuera. Acá no hay ninguna acción que comprometa: es sólo lectura
 * de la plantilla, para poder comparar antes de firmar ocho semanas.
 *
 * Por eso este modal ya no tiene "Select this funnel" (etapa BP16): tener el
 * mismo acto en dos lugares obliga a mirar cuál de los dos ganó.
 *
 * ---------------------------------------------------------------------------
 * STEPPER HORIZONTAL, NO ACORDEÓN
 * ---------------------------------------------------------------------------
 * Los nodos van arriba en fila, conectados por flechas, y abajo se abre el
 * detalle del seleccionado. Un acordeón vertical obligaba a abrir y cerrar para
 * comparar dos nodos, y escondía la forma del funnel -- que es justamente lo
 * primero que alguien quiere ver: cuántos pasos son y en qué orden.
 */

export default function FunnelExplorer({
  funnel,
  nodes,
  links,
  milestones,
  owners,
  support,
  onClose,
}: {
  funnel: Funnel;
  nodes: FunnelNode[];
  links: FunnelNodeLink[];
  milestones: NodeMilestone[];
  owners: NodeOwner[];
  support: SupportPerson[];
  onClose: () => void;
}) {
  const ordered = links
    .filter((l) => l.funnel_key === funnel.funnel_key)
    .sort((a, b) => a.position - b.position)
    .map((l) => l.node_key);

  const [active, setActive] = useState<number | null>(ordered[0] ?? null);

  const ranges = nodeDayRanges(ordered, milestones);
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const total = milestones.filter((m) => ordered.includes(m.node_key)).length;
  const personOf = (k: number | null) => (k === null ? null : support.find((s) => s.employee_key === k) ?? null);
  const ownersOf = (nodeKey: number) =>
    owners
      .filter((o) => o.node_key === nodeKey)
      .map((o) => personOf(o.employee_key))
      .filter(Boolean) as SupportPerson[];

  const activeNode = active === null ? null : byKey.get(active);
  const activeIndex = active === null ? -1 : ordered.indexOf(active);
  const activeSteps =
    active === null ? [] : milestones.filter((m) => m.node_key === active).sort((a, b) => a.position - b.position);

  return (
    <Modal title={funnel.name} onClose={onClose}>
      <p className="bp-modal__lead">
        {funnel.description}
        {funnel.description ? ' · ' : ''}
        {ordered.length} nodes · {total} steps
        {funnel.duration_weeks ? ` · ~${funnel.duration_weeks} weeks` : ''}
      </p>

      {/* ── Los nodos en fila, conectados ─────────────────────────────────── */}
      <div className="bp-fstep">
        {ordered.map((nodeKey, i) => {
          const node = byKey.get(nodeKey);
          const count = milestones.filter((m) => m.node_key === nodeKey).length;
          const nodeOwners = ownersOf(nodeKey);
          const isActive = nodeKey === active;
          return (
            <div key={nodeKey} className="bp-fstep__slot">
              <button
                type="button"
                className={'bp-fstep__card' + (isActive ? ' is-active' : '')}
                onClick={() => setActive(nodeKey)}
              >
                <span className="bp-fstep__n">{i + 1}</span>
                <span className="bp-fstep__name">{node?.name ?? 'unknown node'}</span>
                <span className="bp-fstep__meta">
                  {count} steps · day {ranges[i].fromDay}–{ranges[i].toDay}
                </span>
                {nodeOwners.length > 0 && (
                  <span className="bp-fstep__owners">
                    {nodeOwners.map((p) => (
                      <span key={p.employee_key} className="bp-avatar bp-avatar--sm" title={p.full_name + ' · ' + (p.job_title ?? '')}>
                        {initialsOf(p.full_name)}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              {i < ordered.length - 1 && (
                <span className="bp-fstep__arrow" aria-hidden="true">
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Detalle del nodo seleccionado ─────────────────────────────────── */}
      {activeNode && (
        <div className="bp-fdetail">
          <div className="bp-fdetail__head">
            <h3 className="bp-fdetail__title">
              {activeIndex + 1}. {activeNode.name}
            </h3>
            {ownersOf(activeNode.node_key).length > 0 && (
              <span className="bp-fdetail__owners">
                {ownersOf(activeNode.node_key).map((p) => p.full_name).join(' · ')}
              </span>
            )}
          </div>
          {activeNode.description && <p className="bp-fdetail__desc">{activeNode.description}</p>}

          <ul className="bp-fdetail__steps">
            {activeSteps.map((m) => {
              const p = personOf(m.accountable_employee_key);
              return (
                <li key={m.milestone_key}>
                  <span className="bp-fdetail__step-title">{m.title}</span>
                  <span className="bp-fdetail__step-who">
                    {p ? (
                      <>
                        <span className="bp-avatar bp-avatar--sm">{initialsOf(p.full_name)}</span>
                        {p.full_name}
                      </>
                    ) : (
                      <span className="bp-muted">unassigned</span>
                    )}
                  </span>
                  {/*
                    El día es RELATIVO al inicio del nodo, que es como está
                    guardado el SLA. Mostrar una fecha acá sería inventarla:
                    todavía no hay fecha de activación.
                  */}
                  <span className="bp-fdetail__step-day">{m.sla_days === null ? '—' : 'by day ' + m.sla_days}</span>
                </li>
              );
            })}
            {activeSteps.length === 0 && <li className="bp-muted">This node has no steps yet.</li>}
          </ul>
        </div>
      )}

      <div className="bp-form__actions">
        <button type="button" className="bp-btn" onClick={onClose}>
          Close
        </button>
        <span className="bp-catalog__hint">Exploring changes nothing — pick a funnel from its card to select it.</span>
      </div>
    </Modal>
  );
}
