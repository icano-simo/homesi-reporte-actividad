'use client';

import { useMemo, useState } from 'react';
import { cumulativeDays, NODE_AREAS, type FunnelNode, type NodeArea, type NodeMilestone } from '@/lib/business-plan/funnels';
import { initialsOf, nodeStats, type SearchInput } from '@/lib/business-plan/librarySearch';
import type { FunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import Modal from '../components/Modal';

/**
 * ============================================================================
 * BIBLIOTECA DE NODOS — etapa BP41
 * ============================================================================
 *
 * ARCHIVO NUEVO. Reemplaza a la tabla de nodos: los 31 nodos con sus steps,
 * agrupados por área, cada uno en una tarjeta que se abre en el lugar.
 *
 * ⚠ LO QUE ESTA PANTALLA MUESTRA ES LA PLANTILLA, y eso hay que decirlo donde
 * se edita. Los planes se copian al activar, así que agregarle un step a un
 * nodo NO cambia el plan de nadie que ya esté corriendo. La nota al pie de cada
 * tarjeta abierta existe porque es la pregunta que va a hacer cualquiera antes
 * de tocar algo, y no tenerla a la vista invita a no tocar nada.
 *
 * ⚠ Y NO MUESTRA AVANCE. Las tarjetas son la plantilla: steps, días, owner. El
 * progreso vive por persona en `N enrolled` de la pantalla del funnel, porque
 * agregado esconde lo que importa -- alguien que terminó el primer nodo y
 * alguien que va en 1 de 3 dan el mismo promedio y no son la misma situación.
 */

/** `null` = el grupo de los que no tienen área asignada. */
type AreaFilter = NodeArea | null | 'all';

export interface NodeLibraryProps {
  data: FunnelLibrary;
  busy: boolean;
  /** Guarda un cambio y recarga. La pantalla no habla con Supabase. */
  onSetArea: (nodeKey: number, area: NodeArea | null) => void;
  onSetFunnels: (nodeKey: number, funnelKeys: number[]) => void;
  onEditNode: (node: FunnelNode) => void;
  onDeleteNode: (node: FunnelNode) => void;
  onEditStep: (nodeKey: number, step: NodeMilestone | null) => void;
  onDeleteStep: (step: NodeMilestone) => void;
  onReorderSteps: (nodeKey: number, milestoneKeys: number[]) => void;
}

export default function NodeLibrary({
  data,
  busy,
  onSetArea,
  onSetFunnels,
  onEditNode,
  onDeleteNode,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
}: NodeLibraryProps) {
  const [area, setArea] = useState<AreaFilter>('all');
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  /* Qué diálogo está abierto, si alguno. Un solo estado: dos booleanos
     independientes permiten abrir los dos y hay que decidir cuál gana. */
  const [dialogo, setDialogo] = useState<
    { kind: 'funnels-of'; node: FunnelNode } | { kind: 'pick-funnels'; node: FunnelNode } | null
  >(null);
  const [arrastrado, setArrastrado] = useState<number | null>(null);

  const busqueda: SearchInput = data;

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * LOS GRUPOS: LOS SIN ÁREA PRIMERO
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Van arriba y no al final, y es lo contrario de lo que hacía la tabla de
   * BP40. La razón es que acá son una TAREA: hay seis, están en `null` porque
   * nadie los asignó, y medido contra la base ninguno de los seis tiene un
   * prefijo del que derivar el área -- dos guardan una sesión entera en la
   * descripción, uno tiene una frase sin punto y tres no tienen descripción.
   *
   * Al final de la lista se leen como "sobrantes"; arriba se leen como "esto
   * falta". Y con el selector al lado, se resuelven donde se ven.
   */
  const grupos = useMemo(() => {
    const visibles = area === 'all' ? data.nodes : data.nodes.filter((n) => (n.area ?? null) === area);
    const out: { area: NodeArea | null; nodos: FunnelNode[] }[] = [];
    const sin = visibles.filter((n) => !n.area);
    if (sin.length) out.push({ area: null, nodos: sin });
    for (const a of NODE_AREAS) {
      const enArea = visibles.filter((n) => n.area === a);
      if (enArea.length) out.push({ area: a, nodos: enArea });
    }
    return out;
  }, [data.nodes, area]);

  /* Los conteos del filtro salen de `data.nodes`, no del grupo filtrado: si
     salieran de lo visible, elegir un área pondría todos los demás en cero. */
  const conteos = useMemo(() => {
    const c = new Map<AreaFilter, number>([['all', data.nodes.length]]);
    c.set(null, data.nodes.filter((n) => !n.area).length);
    for (const a of NODE_AREAS) c.set(a, data.nodes.filter((n) => n.area === a).length);
    return c;
  }, [data.nodes]);

  const toggle = (k: number) =>
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  const stepsDe = (nodeKey: number) =>
    data.milestones.filter((m) => m.node_key === nodeKey).sort((a, b) => a.position - b.position);

  const nombreDe = (employeeKey: number | null) =>
    employeeKey === null ? null : data.support.find((p) => p.employee_key === employeeKey)?.full_name ?? `employee ${employeeKey}`;

  return (
    <>
      {/*
        EL FILTRO CON SUS CONTEOS. Es un filtro y no un desplegable porque los
        números tienen que estar a la vista: `No area 6` es lo que hace que
        alguien los asigne, y dentro de un `<select>` cerrado no se ve.
      */}
      <div className="bp-area-filter" role="group" aria-label="Filter nodes by area">
        {([['all', 'All'], [null, 'No area'], ...NODE_AREAS.map((a) => [a, a] as const)] as [AreaFilter, string][]).map(
          ([valor, rotulo]) => {
            const n = conteos.get(valor) ?? 0;
            if (n === 0 && valor !== 'all') return null;
            return (
              <button
                key={String(valor)}
                type="button"
                className={
                  'bp-area-filter__btn' +
                  (area === valor ? ' is-on' : '') +
                  (valor === null ? ' bp-area-filter__btn--none' : '')
                }
                onClick={() => setArea(valor)}
              >
                {rotulo} <b>{n}</b>
              </button>
            );
          }
        )}
      </div>

      {grupos.length === 0 && <p className="bp-muted-line">No nodes in this area.</p>}

      {grupos.map((g) => (
        <section key={String(g.area)} className="bp-area-group">
          <h2 className={'bp-area-group__head' + (g.area === null ? ' bp-area-group__head--none' : '')}>
            {g.area ?? 'No area'}
            <span className="bp-area-group__n">
              {g.nodos.length} node{g.nodos.length === 1 ? '' : 's'}
            </span>
            {/* Los sin área dicen qué hacer, no sólo que están. */}
            {g.area === null && <span className="bp-area-group__todo">assign an area to group them</span>}
          </h2>

          <div className="bp-node-list">
            {g.nodos.map((n) => {
              const st = nodeStats(n.node_key, busqueda);
              const abierto = abiertos.has(n.node_key);
              const steps = stepsDe(n.node_key);
              const dias = cumulativeDays(steps.map((m) => m.sla_days));

              return (
                <article key={n.node_key} className="bp-nodecard" id={'node-' + n.node_key}>
                  <div className="bp-nodecard__head">
                    {/*
                      El nombre abre y cierra. Es un `<button>` y no un `<div>`
                      con onClick para que llegue por teclado -- la tarjeta es
                      la única forma de ver los steps.
                    */}
                    <button
                      type="button"
                      className="bp-nodecard__toggle"
                      onClick={() => toggle(n.node_key)}
                      aria-expanded={abierto}
                    >
                      <span className="bp-nodecard__caret" aria-hidden="true">
                        {abierto ? '▾' : '▸'}
                      </span>
                      {/* NADA CORTADO: el nombre entra entero y la tarjeta crece. */}
                      <span className="bp-nodecard__name">{n.name}</span>
                    </button>

                    <div className="bp-nodecard__meta">
                      <span className="bp-nodecard__stat">
                        {st.steps} step{st.steps === 1 ? '' : 's'}
                      </span>
                      {/* `—` y no `0 days` cuando el nodo no tiene steps: no hay
                          duración que leer, y un cero afirmaría que dura nada. */}
                      <span className="bp-nodecard__stat">{st.steps === 0 ? '—' : st.days + ' days'}</span>

                      {/*
                        `in N funnels`, clicable. Cero NO es un botón: no hay
                        nada que abrir, y un botón que abre una lista vacía es
                        el lápiz que no hacía nada de OL23.
                      */}
                      {st.funnelKeys.length === 0 ? (
                        <span className="bp-nodecard__stat bp-nodecard__stat--warn">in no funnel</span>
                      ) : (
                        <button
                          type="button"
                          className="bp-linkish bp-nodecard__stat"
                          onClick={() => setDialogo({ kind: 'funnels-of', node: n })}
                        >
                          in {st.funnelKeys.length} funnel{st.funnelKeys.length === 1 ? '' : 's'}
                        </button>
                      )}

                      {/*
                        LOS OWNERS COMO INICIALES, todos. Medido: 20 de los 31
                        nodos tienen tres. Mostrar "el primero" habría sido un
                        dato inventado con forma de dato -- `node_owner` no
                        tiene orden declarado. El nombre completo va en el
                        `title`, así que no se pierde nada.
                      */}
                      <span className="bp-nodecard__owners">
                        {st.owners.length === 0 ? (
                          <span className="bp-nodecard__stat bp-nodecard__stat--warn">no owner</span>
                        ) : (
                          st.owners.map((o) => (
                            <span key={o} className="bp-initials" title={o}>
                              {initialsOf(o)}
                            </span>
                          ))
                        )}
                      </span>

                      <select
                        className="bp-inline-input--area"
                        value={n.area ?? ''}
                        disabled={busy}
                        aria-label={'Area of ' + n.name}
                        onChange={(e) => onSetArea(n.node_key, (e.target.value || null) as NodeArea | null)}
                      >
                        <option value="">No area</option>
                        {NODE_AREAS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        className="bp-btn bp-btn--small"
                        onClick={() => setDialogo({ kind: 'pick-funnels', node: n })}
                      >
                        Funnels…
                      </button>
                      <button type="button" className="bp-icon-btn" title="Edit" onClick={() => onEditNode(n)}>
                        ✎
                      </button>
                      <button
                        type="button"
                        className="bp-icon-btn bp-icon-btn--danger"
                        title="Delete"
                        onClick={() => onDeleteNode(n)}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {abierto && (
                    <div className="bp-nodecard__body">
                      {n.description && <p className="bp-nodecard__desc">{n.description}</p>}

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
                                   * SE MANDA EL ORDEN, NO LA POSICIÓN. La base
                                   * renumera 1..N en `reorder_node_steps`, así
                                   * que la posición es una consecuencia y no
                                   * algo que se pueda escribir mal -- ya no se
                                   * puede poner `1` y `1`.
                                   */
                                  const orden = steps.map((s) => s.milestone_key).filter((k) => k !== arrastrado);
                                  orden.splice(i, 0, arrastrado);
                                  setArrastrado(null);
                                  onReorderSteps(n.node_key, orden);
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
                                  <button
                                    type="button"
                                    className="bp-icon-btn"
                                    title="Edit"
                                    onClick={() => onEditStep(n.node_key, m)}
                                  >
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

                      {/* La línea que explica las dos columnas, una vez por tabla. */}
                      {steps.length > 0 && (
                        <p className="bp-legend">
                          SLA is days after the previous step. Day is where it lands in the plan.
                        </p>
                      )}

                      <div className="bp-nodecard__actions">
                        <button
                          type="button"
                          className="bp-btn bp-btn--small"
                          onClick={() => onEditStep(n.node_key, null)}
                        >
                          + New step
                        </button>
                      </div>

                      {/*
                        ⚠ LA REGLA QUE IMPORTA, al pie del nodo abierto.
                        Va acá y no en la cabecera de la pantalla porque es donde
                        alguien está por editar. Sin esto, la duda "¿le rompo el
                        plan a Ana?" hace que nadie toque nada.
                      */}
                      <p className="bp-nodecard__rule">
                        Editing here changes the <strong>template</strong>, not the plans already running. Plans are
                        copied when a funnel is activated, so adding a step now does not change anyone&apos;s current
                        plan.
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {dialogo?.kind === 'funnels-of' && (
        <Modal title={'Funnels using ' + dialogo.node.name} onClose={() => setDialogo(null)}>
          <div className="bp-form">
            <ul className="bp-plain-list">
              {nodeStats(dialogo.node.node_key, busqueda).funnelNames.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </Modal>
      )}

      {dialogo?.kind === 'pick-funnels' && (
        <FunnelPicker
          node={dialogo.node}
          data={data}
          busy={busy}
          onClose={() => setDialogo(null)}
          onSave={(keys) => {
            onSetFunnels(dialogo.node.node_key, keys);
            setDialogo(null);
          }}
        />
      )}
    </>
  );
}

/**
 * ALTA EN VARIOS FUNNELS DE UNA VEZ — etapa BP41.
 *
 * Checkboxes y no un `<select multiple>`: con el select hay que saber que se
 * mantiene Ctrl para no perder lo ya elegido, y perderlo es silencioso.
 *
 * ⚠ QUITAR UN NODO DE UN FUNNEL NO LO BORRA DE LA BIBLIOTECA, y quitarlo de
 * TODOS tampoco: un nodo sin funnel es un estado válido y queda disponible. Se
 * dice en el diálogo, porque desmarcar la última casilla parece un borrado.
 */
function FunnelPicker({
  node,
  data,
  busy,
  onClose,
  onSave,
}: {
  node: FunnelNode;
  data: FunnelLibrary;
  busy: boolean;
  onClose: () => void;
  onSave: (funnelKeys: number[]) => void;
}) {
  const actuales = useMemo(
    () => data.links.filter((l) => l.node_key === node.node_key).map((l) => l.funnel_key),
    [data.links, node.node_key]
  );
  const [elegidos, setElegidos] = useState<Set<number>>(new Set(actuales));

  const toggle = (k: number) =>
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  /* Qué cambia de verdad, dicho antes de guardar. */
  const agregados = [...elegidos].filter((k) => !actuales.includes(k));
  const quitados = actuales.filter((k) => !elegidos.has(k));
  const nombreF = (k: number) => data.funnels.find((f) => f.funnel_key === k)?.name ?? String(k);

  return (
    <Modal title={'Funnels for ' + node.name} onClose={onClose}>
      <div className="bp-form">
        <div className="bp-check-list">
          {data.funnels.map((f) => (
            <label key={f.funnel_key} className="bp-check">
              <input
                type="checkbox"
                checked={elegidos.has(f.funnel_key)}
                onChange={() => toggle(f.funnel_key)}
                disabled={busy}
              />
              <span>{f.name}</span>
              {!f.is_active && <span className="bp-chip">inactive</span>}
            </label>
          ))}
        </div>

        {(agregados.length > 0 || quitados.length > 0) && (
          <p className="bp-modal__lead">
            {agregados.length > 0 && <>Adding to {agregados.map(nombreF).join(', ')}. </>}
            {quitados.length > 0 && <>Removing from {quitados.map(nombreF).join(', ')}. </>}
          </p>
        )}

        {elegidos.size === 0 && (
          <p className="bp-modal__lead bp-modal__lead--warn">
            This node will not be in any funnel. It stays in the library and can be added again later — removing it
            from a funnel never deletes it.
          </p>
        )}

        <div className="bp-form__actions">
          <button
            type="button"
            className="bp-btn bp-btn--primary"
            disabled={busy || (agregados.length === 0 && quitados.length === 0)}
            onClick={() => onSave([...elegidos])}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="bp-linkish" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
