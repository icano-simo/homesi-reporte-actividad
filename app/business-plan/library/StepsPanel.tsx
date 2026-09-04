'use client';

import { useEffect, useState } from 'react';
import { cumulativeDays, NODE_AREAS, type FunnelNode, type NodeArea, type NodeMilestone } from '@/lib/business-plan/funnels';
import type { SupportPerson } from '@/lib/business-plan/useFunnelLibrary';

/**
 * ============================================================================
 * PANEL LATERAL DE STEPS — etapa BP43
 * ============================================================================
 *
 * ARCHIVO NUEVO. Los steps salen de la tarjeta y viven acá.
 *
 * ⚠ SE DESLIZA DESDE LA DERECHA Y NO SE DESPLIEGA HACIA ABAJO, y el motivo es
 * concreto: al abrirse hacia abajo, la tabla empujaba las 30 tarjetas de más
 * abajo y perdías el lugar en la lista. Con seis steps eran 200px de empuje;
 * con los 38 de `Realtor Outreach B2B`, media pantalla.
 *
 * ⚠ NO HAY CHECKBOX EN ESTOS STEPS. Este es el editor de la PLANTILLA, no del
 * plan de una persona. Un checkbox acá sugeriría que un step de la biblioteca
 * se puede completar, y eso no existe: los estados viven en
 * `enrollment_milestone`, en la copia de cada persona. Es la misma distinción
 * que hace que las tarjetas no muestren progreso.
 */

export interface StepsPanelProps {
  node: FunnelNode;
  steps: NodeMilestone[];
  support: SupportPerson[];
  busy: boolean;
  onClose: () => void;
  onSetArea: (nodeKey: number, area: NodeArea | null) => void;
  onEditStep: (nodeKey: number, step: NodeMilestone | null) => void;
  onDeleteStep: (step: NodeMilestone) => void;
  onReorderSteps: (nodeKey: number, milestoneKeys: number[]) => void;
}

export default function StepsPanel({
  node,
  steps,
  support,
  busy,
  onClose,
  onSetArea,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
}: StepsPanelProps) {
  const [arrastrado, setArrastrado] = useState<number | null>(null);
  const dias = cumulativeDays(steps.map((m) => m.sla_days));

  /*
   * Escape cierra. Es lo que se espera de un panel, y sin esto la única salida
   * es apuntarle a la × -- que en un panel de 38 filas queda fuera de la vista
   * en cuanto se hace scroll.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nombreDe = (employeeKey: number | null) =>
    employeeKey === null ? null : support.find((p) => p.employee_key === employeeKey)?.full_name ?? `employee ${employeeKey}`;

  return (
    <div className="bp-panel-backdrop" onClick={onClose} role="presentation">
      <aside
        className="bp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={'Steps of ' + node.name}
        /* El clic adentro no cierra: sin esto, arrastrar un step cerraba el panel. */
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bp-panel__head">
          <div>
            {/* El nombre del nodo entero, sin recorte, como en la tarjeta. */}
            <h2 className="bp-panel__title">{node.name}</h2>
            <p className="bp-panel__sub">
              {steps.length} step{steps.length === 1 ? '' : 's'}
              {steps.length > 0 && <> · {dias[dias.length - 1]} days</>}
            </p>
          </div>
          <button type="button" className="bp-panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="bp-panel__body">
          {/*
            EL ÁREA, COMO PÍLDORAS Y NO COMO `<select>` NATIVO.
            Con seis nodos sin asignar, lo que importa es que las cinco opciones
            se vean de una y que la elegida se distinga; un select cerrado
            esconde las otras cuatro y no dice cuántas hay.
          */}
          <div className="bp-panel__field">
            <span className="bp-panel__label">Area</span>
            <div className="bp-pill-group" role="group" aria-label="Area">
              <button
                type="button"
                className={'bp-pill bp-pill--area' + (node.area === null ? ' is-on bp-pill--none' : '')}
                disabled={busy}
                onClick={() => onSetArea(node.node_key, null)}
              >
                No area
              </button>
              {NODE_AREAS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={'bp-pill bp-pill--area' + (node.area === a ? ' is-on' : '')}
                  disabled={busy}
                  onClick={() => onSetArea(node.node_key, a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {node.description && <p className="bp-panel__desc">{node.description}</p>}

          {steps.length === 0 ? (
            <p className="bp-muted-line">No steps yet.</p>
          ) : (
            <table className="piv bp-steps-table">
              <thead>
                <tr>
                  <th />
                  <th>Step</th>
                  <th>Accountable</th>
                  <th className="bp-center">SLA</th>
                  <th className="bp-center">Day</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {steps.map((m, i) => (
                  <tr
                    key={m.milestone_key}
                    draggable={!busy}
                    onDragStart={() => setArrastrado(m.milestone_key)}
                    onDragEnd={() => setArrastrado(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (arrastrado === null || arrastrado === m.milestone_key) return;
                      /*
                       * SE MANDA EL ORDEN, NO LA POSICIÓN. `reorder_node_steps`
                       * renumera 1..N en una transacción, así que la posición es
                       * una consecuencia y ya no se puede escribir `1` y `1`.
                       * Y la unicidad de `(node_key, position)` es diferida, que
                       * es lo que permite el intercambio -- con el índice de
                       * BP40 esto fallaba en el primer swap.
                       */
                      const orden = steps.map((s) => s.milestone_key).filter((k) => k !== arrastrado);
                      orden.splice(i, 0, arrastrado);
                      setArrastrado(null);
                      onReorderSteps(node.node_key, orden);
                    }}
                    className={arrastrado === m.milestone_key ? 'is-dragging' : undefined}
                  >
                    <td className="bp-grip" aria-hidden="true">
                      ⠿
                    </td>
                    <td className="bp-strong">{m.title}</td>
                    <td>{nombreDe(m.accountable_employee_key) ?? '— unassigned —'}</td>
                    <td className="bp-center">{m.sla_days ?? '—'}</td>
                    <td className="bp-center bp-strong">{dias[i]}</td>
                    <td className="bp-right">
                      <button type="button" className="bp-icon-btn" title="Edit" onClick={() => onEditStep(node.node_key, m)}>
                        ✎
                      </button>
                      <button
                        type="button"
                        className="bp-icon-btn bp-icon-btn--danger"
                        title="Delete"
                        onClick={() => onDeleteStep(m)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* La leyenda va ACÁ y no en la tarjeta: explica dos columnas que sólo
              existen dentro del panel. */}
          {steps.length > 0 && (
            <p className="bp-legend">SLA is days after the previous step. Day is where it lands in the plan.</p>
          )}

          <div className="bp-panel__actions">
            <button type="button" className="bp-btn bp-btn--small" onClick={() => onEditStep(node.node_key, null)}>
              + New step
            </button>
          </div>

          {/*
            ⚠ LA REGLA QUE IMPORTA. Se mudó de la tarjeta a acá porque acá es
            donde se edita. Sin esto a la vista, la duda "¿le rompo el plan a
            Ana?" hace que nadie toque nada.
          */}
          <p className="bp-panel__rule">
            Editing here changes the <strong>template</strong>, not the plans already running. Plans are copied when a
            funnel is activated, so adding a step now does not change anyone&apos;s current plan.
          </p>
        </div>
      </aside>
    </div>
  );
}
