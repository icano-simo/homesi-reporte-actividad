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
 * Etapa BP15 — ARCHIVO NUEVO.
 *
 * ---------------------------------------------------------------------------
 * EXPLORAR NO ES ELEGIR
 * ---------------------------------------------------------------------------
 * Hasta BP14 el clic en una tarjeta la SELECCIONABA, y la tarjeta sólo mostraba
 * los nombres de los nodos. Nadie puede decidir entre Realtor Outreach B2B y
 * Social Media B2C sin saber qué le van a pedir, así que la única forma de
 * enterarse era activar uno.
 *
 * Ahora son dos actos distintos: el clic ABRE el detalle, y elegir tiene su
 * propio botón. Que nadie se comprometa a un plan de 8 semanas por hacer clic
 * para mirar.
 *
 * Va en un modal y no en una página nueva: se exploran varios seguidos para
 * compararlos, y una página rompería esa comparación -- habría que volver atrás
 * entre uno y otro perdiendo la lista.
 *
 * No hay nada que escribir acá. Es sólo lectura de la plantilla.
 */

export default function FunnelExplorer({
  funnel,
  nodes,
  links,
  milestones,
  owners,
  support,
  isPicked,
  onPick,
  onClose,
}: {
  funnel: Funnel;
  nodes: FunnelNode[];
  links: FunnelNodeLink[];
  milestones: NodeMilestone[];
  owners: NodeOwner[];
  support: SupportPerson[];
  isPicked: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  const [openNode, setOpenNode] = useState<number | null>(null);

  const ordered = links
    .filter((l) => l.funnel_key === funnel.funnel_key)
    .sort((a, b) => a.position - b.position)
    .map((l) => l.node_key);
  const ranges = nodeDayRanges(ordered, milestones);
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const total = milestones.filter((m) => ordered.includes(m.node_key)).length;
  const personOf = (k: number | null) => (k === null ? null : support.find((s) => s.employee_key === k) ?? null);

  return (
    <Modal title={funnel.name} onClose={onClose}>
      <p className="bp-modal__lead">
        {funnel.description}
        {funnel.description ? ' · ' : ''}
        {ordered.length} nodes · {total} steps
        {funnel.duration_weeks ? ` · ~${funnel.duration_weeks} weeks` : ''}
      </p>

      <div className="bp-explore">
        {ordered.map((nodeKey, i) => {
          const node = byKey.get(nodeKey);
          const mine = milestones.filter((m) => m.node_key === nodeKey).sort((a, b) => a.position - b.position);
          const nodeOwners = owners
            .filter((o) => o.node_key === nodeKey)
            .map((o) => personOf(o.employee_key))
            .filter(Boolean) as SupportPerson[];
          const open = openNode === nodeKey;
          const range = ranges[i];

          return (
            <div key={nodeKey} className={'bp-explore__node' + (open ? ' is-open' : '')}>
              <button type="button" className="bp-explore__head" onClick={() => setOpenNode(open ? null : nodeKey)}>
                <span className="bp-explore__pos">{i + 1}</span>
                <span className="bp-explore__body">
                  <span className="bp-explore__name">{node?.name ?? 'unknown node'}</span>
                  <span className="bp-explore__desc">{node?.description ?? ''}</span>
                </span>
                <span className="bp-explore__meta">
                  {mine.length} steps
                  {/* El rango se calcula de los SLA, igual que en el constructor. */}
                  <span className="bp-explore__days">
                    day {range.fromDay}–{range.toDay}
                  </span>
                </span>
                {nodeOwners.length > 0 && (
                  <span className="bp-explore__owners">
                    {nodeOwners.map((p) => (
                      <span key={p.employee_key} className="bp-avatar bp-avatar--sm" title={p.full_name + ' · ' + (p.job_title ?? '')}>
                        {initialsOf(p.full_name)}
                      </span>
                    ))}
                  </span>
                )}
                <span className="bp-explore__chev" aria-hidden="true">
                  {open ? '▾' : '▸'}
                </span>
              </button>

              {open && (
                <ul className="bp-explore__steps">
                  {mine.map((m) => {
                    const p = personOf(m.accountable_employee_key);
                    return (
                      <li key={m.milestone_key}>
                        <span className="bp-explore__step-title">{m.title}</span>
                        <span className="bp-explore__step-who">{p ? p.full_name : <span className="bp-muted">unassigned</span>}</span>
                        {/*
                          El día es RELATIVO al inicio del nodo, que es como está
                          guardado el SLA. Mostrar una fecha acá sería inventarla:
                          todavía no hay fecha de activación.
                        */}
                        <span className="bp-explore__step-day">{m.sla_days === null ? '—' : 'day ' + m.sla_days}</span>
                      </li>
                    );
                  })}
                  {mine.length === 0 && <li className="bp-muted">This node has no steps yet.</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Elegir es un acto APARTE, con su propio botón. */}
      <div className="bp-form__actions">
        <button type="button" className={'bp-btn' + (isPicked ? '' : ' bp-btn--primary')} onClick={onPick}>
          {isPicked ? 'Selected' : 'Select this funnel'}
        </button>
        <button type="button" className="bp-linkish" onClick={onClose}>
          close
        </button>
        <span className="bp-catalog__hint">Selecting does not activate anything yet.</span>
      </div>
    </Modal>
  );
}
