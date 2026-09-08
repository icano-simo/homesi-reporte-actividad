'use client';

import { useState } from 'react';
import { nodeDayRanges, type Funnel, type FunnelNode, type FunnelNodeLink, type NodeMilestone, type NodeOwner } from '@/lib/business-plan/funnels';
import type { SupportPerson } from '@/lib/business-plan/useFunnelLibrary';
import Modal from '../../../components/Modal';
import NotesPanel from '../../../components/NotesPanel';
import { FunnelGlyph } from '../../../components/funnelIcons';
import { Avatar } from '../../../components/shared';

/**
 * ============================================================================
 * EXPLORAR UN FUNNEL ANTES DE ELEGIRLO
 * ============================================================================
 *
 * Etapa BP15 — ARCHIVO NUEVO. Etapa BP16 — de acordeón vertical a stepper.
 * Etapa BP20 — notas sobre el funnel. Etapa BP21 — icono, color y volvió a
 * poder activar.
 *
 * ---------------------------------------------------------------------------
 * "SELECT THIS FUNNEL" VOLVIÓ, PERO AHORA HACE ALGO
 * ---------------------------------------------------------------------------
 * En BP16 se lo quitó porque al apretarlo no pasaba nada -- un botón decorativo
 * es peor que ninguno. El problema nunca fue tenerlo acá: era que mentía.
 *
 * Ahora activa de verdad y lleva al plan en modo edición, exactamente igual que
 * el botón de la tarjeta. Y con eso el pie deja de tener una sola acción
 * secundaria: se puede decidir sin volver atrás a buscar la tarjeta que uno
 * acaba de abrir.
 *
 * ---------------------------------------------------------------------------
 * STEPPER HORIZONTAL, NO ACORDEÓN
 * ---------------------------------------------------------------------------
 * Los nodos van arriba en fila, conectados por flechas, y abajo se abre el
 * detalle del seleccionado. Un acordeón vertical obligaba a abrir y cerrar para
 * comparar dos nodos, y escondía la forma del funnel -- que es justamente lo
 * primero que alguien quiere ver: cuántos nodos son y en qué orden.
 *
 * Etapa BP25: una sola fila con scroll. Ver el comentario del `.bp-fstep` en
 * bp-visual.css.
 */

export default function FunnelExplorer({
  funnel,
  nodes,
  links,
  milestones,
  owners,
  support,
  onClose,
  onSelect,
  busy,
}: {
  funnel: Funnel;
  nodes: FunnelNode[];
  links: FunnelNodeLink[];
  milestones: NodeMilestone[];
  owners: NodeOwner[];
  support: SupportPerson[];
  onClose: () => void;
  onSelect: () => void;
  busy: boolean;
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
    /*
      La cabecera del modal va oculta a la vista: el nombre del funnel se dibuja
      adentro, en grande y con su icono. Repetirlo arriba en el tamaño de un
      encabezado de diálogo lo haría competir consigo mismo. Sigue siendo el
      `aria-label` del diálogo.
    */
    <Modal title={funnel.name} hideTitle onClose={onClose}>
      <div className="bp-fhead">
        <FunnelGlyph icon={funnel.icon} size={26} />
        <div>
          <h2 className="bp-fhead__name">{funnel.name}</h2>
          <div className="bp-fhead__meta">
            <span className="bp-pill bp-pill--sky">{ordered.length} nodes</span>
            <span className="bp-pill bp-pill--sky">{total} steps</span>
            {funnel.duration_weeks && <span className="bp-pill bp-pill--sky">~{funnel.duration_weeks} weeks</span>}
          </div>
        </div>
      </div>
      {funnel.description && <p className="bp-modal__lead">{funnel.description}</p>}

      {/* ── Los nodos en fila, conectados ─────────────────────────────────── */}
      <div className="bp-fstep">
        {ordered.map((nodeKey, i) => {
          const node = byKey.get(nodeKey);
          const count = milestones.filter((m) => m.node_key === nodeKey).length;
          const nodeOwners = ownersOf(nodeKey);
          const isActive = nodeKey === active;
          return (
            /*
              Etapa BP25: los nodos van en UNA sola fila con scroll horizontal.
              Un funnel es una secuencia, y envuelta en tres filas deja de
              leerse como una. Eso disuelve tambien el problema de BP21 -- la
              flecha que apuntaba al borde era la del ultimo de cada fila, y sin
              filas la unica que sobra es la del ultimo nodo, que el CSS oculta
              con `:last-child`.
            */
            <div key={nodeKey} className="bp-fstep__slot">
              <button
                type="button"
                className={'bp-fstep__card' + (isActive ? ' is-active' : '')}
                onClick={() => setActive(nodeKey)}
              >
                <span className="bp-fstep__n">{i + 1}</span>
                {/*
                  BP36: el nombre va en su propio <span>, no como texto suelto
                  al lado del icono. Suelto era un flex item anónimo, y a esos
                  no se les puede aplicar ni recorte ni `min-width: 0` -- por eso
                  "B2B Coach - Why it's worth it. And why you can" se salía de la
                  tarjeta de 172px en vez de partirse. El `title` da el nombre
                  completo cuando el recorte a dos líneas lo corta.
                */}
                <span className="bp-fstep__name">
                  <FunnelGlyph icon={node?.icon} size={14} />
                  <span className="bp-fstep__name-text" title={node?.name ?? 'unknown node'}>
                    {node?.name ?? 'unknown node'}
                  </span>
                </span>
                <span className="bp-pill bp-pill--sky">
                  {count} stages · day {ranges[i].fromDay}–{ranges[i].toDay}
                </span>
                {nodeOwners.length > 0 && (
                  <span className="bp-fstep__owners">
                    {nodeOwners.map((p) => (
                      <Avatar key={p.employee_key} name={p.full_name} title={p.full_name + ' · ' + (p.job_title ?? '')} />
                    ))}
                  </span>
                )}
              </button>
              <span className="bp-fstep__arrow" aria-hidden="true">
                →
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Detalle del nodo seleccionado ─────────────────────────────────── */}
      {activeNode && (
        <div className="bp-fdetail">
          <div className="bp-fdetail__head">
            <h3 className="bp-fdetail__title">
              <FunnelGlyph icon={activeNode.icon} size={16} />
              {activeIndex + 1}. {activeNode.name}
            </h3>
            {ownersOf(activeNode.node_key).length > 0 && (
              <span className="bp-owners bp-owners--inline">
                <span className="bp-owners__label">Node owners</span>
                <span className="bp-owners__list">
                  {ownersOf(activeNode.node_key).map((p) => (
                    <span key={p.employee_key} className="bp-owners__one">
                      <Avatar name={p.full_name} title={p.job_title ?? p.full_name} />
                      {p.full_name}
                    </span>
                  ))}
                </span>
              </span>
            )}
          </div>
          {activeNode.description && <p className="bp-fdetail__desc">{activeNode.description}</p>}

          {/*
            ⚠ ENCABEZADOS Y LA ACLARACIÓN DEL DÍA — etapa BP26.
            "Day 3" solo no dice de qué. No es una fecha, no es el día 3 del
            plan: es el SLA acumulado desde que ARRANCA ESTE NODO, que es como
            está guardado. Y son días relativos justamente porque acá todavía no
            hay nada activado -- sin fecha de activación, una fecha sería
            inventada. En el plan activo esa misma columna ya son fechas reales.
          */}
          <ul className="bp-fdetail__steps">
            <li className="bp-fdetail__steps-head" aria-hidden="true">
              <span>Step</span>
              <span>Accountable</span>
              <span>Due (day of node)</span>
            </li>
            {activeSteps.map((m) => {
              const p = personOf(m.accountable_employee_key);
              return (
                <li key={m.milestone_key}>
                  <span className="bp-fdetail__step-title">{m.title}</span>
                  <span className="bp-fdetail__step-who">
                    {p ? (
                      <>
                        <Avatar name={p.full_name} />
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
                  {m.sla_days === null ? (
                    <span className="bp-muted">—</span>
                  ) : (
                    <span className="bp-pill bp-pill--day">Day {m.sla_days}</span>
                  )}
                </li>
              );
            })}
            {activeSteps.length === 0 && <li className="bp-muted">This node has no steps yet.</li>}
          </ul>
          <p className="bp-fdetail__note">
            Days are counted from the start of this node, not from the start of the plan — nothing is activated yet, so
            there are no real dates. Activating turns each of them into a target date.
          </p>
        </div>
      )}

      {/*
        Notas sobre la PLANTILLA, no sobre el plan de nadie: qué funciona de
        esta estrategia y qué habría que cambiarle. Las de una persona concreta
        van en su plan, colgadas de su nodo o de su paso.
      */}
      <NotesPanel
        target={{ kind: 'funnel', key: funnel.funnel_key }}
        title="Notes on this funnel"
        placeholder="What works, what to change in the template…"
      />

      <div className="bp-form__actions">
        <button type="button" className="bp-btn bp-btn--primary" disabled={busy} onClick={onSelect}>
          {busy ? 'Activating…' : 'Select this funnel'}
        </button>
        <button type="button" className="bp-btn" onClick={onClose}>
          Close
        </button>
        {/*
          BP36: acá estaba "Activating copies the template into this person's own
          plan." Se quitó: al lado de los botones, en el momento de decidir, no
          agrega nada -- lo que la persona necesita saber para decidir está en el
          cuerpo del modal.
        */}
      </div>
    </Modal>
  );
}
