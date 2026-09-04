'use client';

import { useMemo, useState } from 'react';
import { NODE_AREAS, type FunnelNode, type NodeArea, type NodeMilestone } from '@/lib/business-plan/funnels';
import { initialsOf, nodeStats, type SearchInput } from '@/lib/business-plan/librarySearch';
import type { FunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import Modal from '../components/Modal';
import StepsPanel from './StepsPanel';

/**
 * ============================================================================
 * BIBLIOTECA DE NODOS — etapa BP41, reescrita en BP43
 * ============================================================================
 *
 * Los 31 nodos, agrupados por área, cada uno en una tarjeta horizontal.
 *
 * ⚠ LOS STEPS YA NO ESTÁN ACÁ. En BP41 la tarjeta se abría hacia abajo y
 * mostraba su tabla; ahora abre un panel lateral (`StepsPanel`). El motivo no
 * es estético: desplegándose hacia abajo, la tabla empujaba las tarjetas
 * siguientes y se perdía el lugar en una lista de 31.
 *
 * ⚠ Y LA TARJETA NO MUESTRA AVANCE. Muestra la PLANTILLA: steps, días, owner.
 * El progreso vive por persona en `N enrolled` de la pantalla del funnel,
 * porque agregado esconde lo que importa -- alguien que terminó el primer nodo
 * y alguien que va en 1 de 3 dan el mismo promedio y no son la misma situación.
 * El panel respeta lo mismo: no lleva checkbox.
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
  /* Qué nodo tiene el panel abierto. Uno solo: dos paneles a la vez no existen. */
  const [panel, setPanel] = useState<number | null>(null);
  const [dialogo, setDialogo] = useState<
    { kind: 'funnels-of'; node: FunnelNode } | { kind: 'pick-funnels'; node: FunnelNode } | null
  >(null);

  const busqueda: SearchInput = data;

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * LOS GRUPOS: LOS SIN ÁREA PRIMERO
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Van arriba y no al final, y es lo contrario de lo que hacía la tabla de
   * BP40. Acá son una TAREA: hay seis, están en `null` porque nadie los asignó,
   * y medido contra la base ninguno de los seis tiene un prefijo del que
   * derivar el área -- dos guardan una sesión entera en la descripción, uno
   * tiene una frase sin punto y tres no tienen descripción.
   *
   * Al final de la lista se leen como "sobrantes"; arriba se leen como "esto
   * falta".
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

  /* Los conteos salen de `data.nodes`, no del grupo filtrado: si salieran de lo
     visible, elegir un área pondría todos los demás en cero. */
  const conteos = useMemo(() => {
    const c = new Map<AreaFilter, number>([['all', data.nodes.length]]);
    c.set(null, data.nodes.filter((n) => !n.area).length);
    for (const a of NODE_AREAS) c.set(a, data.nodes.filter((n) => n.area === a).length);
    return c;
  }, [data.nodes]);

  const stepsDe = (nodeKey: number) =>
    data.milestones.filter((m) => m.node_key === nodeKey).sort((a, b) => a.position - b.position);

  const nodoDelPanel = panel === null ? null : data.nodes.find((n) => n.node_key === panel) ?? null;

  return (
    <>
      {/*
        ══════════════════════════════════════════════════════════════════════
        EL FILTRO, COMO PESTAÑAS SEGMENTADAS — etapa BP43
        ══════════════════════════════════════════════════════════════════════

        Un grupo segmentado y no botones sueltos: son opciones EXCLUYENTES sobre
        el mismo eje, y sueltas se leían como cinco acciones independientes.

        Los conteos van adentro y a la vista: `No area 6` es lo que hace que
        alguien las asigne, y dentro de un `<select>` cerrado no se ve.
      */}
      <div className="bp-tabs" role="tablist" aria-label="Filter nodes by area">
        {([['all', 'All'], [null, 'No area'], ...NODE_AREAS.map((a) => [a, a] as const)] as [AreaFilter, string][]).map(
          ([valor, rotulo]) => {
            const n = conteos.get(valor) ?? 0;
            /* Un área sin nodos no se ofrece: un "IT 0" ocupa una pestaña para
               no decir nada. `All` siempre está, aunque la biblioteca esté vacía. */
            if (n === 0 && valor !== 'all') return null;
            const activa = area === valor;
            return (
              <button
                key={String(valor)}
                type="button"
                role="tab"
                aria-selected={activa}
                className={
                  'bp-tabs__tab' + (activa ? ' is-on' : '') + (valor === null ? ' bp-tabs__tab--none' : '')
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
            {g.area === null && <span className="bp-area-group__todo">assign an area to group them</span>}
          </h2>

          <div className="bp-node-list">
            {g.nodos.map((n) => {
              const st = nodeStats(n.node_key, busqueda);
              return (
                <article
                  key={n.node_key}
                  id={'node-' + n.node_key}
                  className="bp-nodecard"
                  /*
                    El clic en la tarjeta abre el panel. Los controles de la tira
                    llaman `stopPropagation` para que elegir un funnel o borrar
                    el nodo no abra además el panel.
                  */
                  onClick={() => setPanel(n.node_key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPanel(n.node_key);
                    }
                  }}
                >
                  {/*
                    ⚠ EL NOMBRE NUNCA SE CORTA; LA DESCRIPCIÓN SÍ.
                    Es la distinción que costó el bug de `table.piv`: recortar
                    un nombre lo vuelve inidentificable --`Budget Allocation -
                    Ca...`-- mientras que recortar una descripción sólo esconde
                    detalle que igual no cabía.
                    Y es imprescindible acá: dos de los seis nodos sin área
                    guardan una sesión entera en la descripción, de 891 y 658
                    caracteres. Sin recorte, esas dos tarjetas serían muros.
                  */}
                  <div className="bp-nodecard__left">
                    <h3 className="bp-nodecard__name">{n.name}</h3>
                    {n.description && <p className="bp-nodecard__desc">{n.description}</p>}
                  </div>

                  <div className="bp-nodecard__meta" onClick={(e) => e.stopPropagation()} role="presentation">
                    <span className="bp-pill">
                      {st.steps} step{st.steps === 1 ? '' : 's'}
                    </span>

                    {/* `—` y no `0 days` sin steps: no hay duración que leer, y un
                        cero afirmaría que dura nada. */}
                    <span className="bp-pill bp-pill--days">{st.steps === 0 ? '— days' : st.days + ' days'}</span>

                    {/* Cero NO es un botón: no hay nada que abrir. */}
                    {st.funnelKeys.length === 0 ? (
                      <span className="bp-pill bp-pill--warn">in no funnel</span>
                    ) : (
                      <button
                        type="button"
                        className="bp-pill bp-pill--link"
                        onClick={() => setDialogo({ kind: 'funnels-of', node: n })}
                      >
                        in {st.funnelKeys.length} funnel{st.funnelKeys.length === 1 ? '' : 's'}
                      </button>
                    )}

                    {/*
                      LOS OWNERS COMO INICIALES, todos. Medido: 20 de los 31
                      nodos tienen tres. Mostrar "el primero" habría sido un dato
                      inventado con forma de dato -- `node_owner` no tiene orden
                      declarado. El nombre completo va en el `title`.
                    */}
                    <span className="bp-nodecard__owners">
                      {st.owners.length === 0 ? (
                        <span className="bp-pill bp-pill--warn">no owner</span>
                      ) : (
                        st.owners.map((o) => (
                          <span key={o} className="bp-initials" title={o}>
                            {initialsOf(o)}
                          </span>
                        ))
                      )}
                    </span>

                    {/*
                      EL ÁREA ES UNA PÍLDORA CLICABLE, no un `<select>` nativo.
                      Abre el panel, que es donde están las cinco opciones a la
                      vista. Un select acá metía un control de sistema operativo
                      en una tira de píldoras, y con 31 tarjetas eran 31.
                      En ámbar cuando falta: es lo que hay que decidir.
                    */}
                    <button
                      type="button"
                      className={'bp-pill bp-pill--link' + (n.area === null ? ' bp-pill--warn' : '')}
                      onClick={() => setPanel(n.node_key)}
                      title={n.area === null ? 'No area assigned — click to set it' : 'Area: ' + n.area}
                    >
                      {n.area ?? 'No area'}
                    </button>

                    <button type="button" className="bp-pill bp-pill--action" onClick={() => setPanel(n.node_key)}>
                      Manage steps
                    </button>

                    <button
                      type="button"
                      className="bp-pill bp-pill--link"
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
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {nodoDelPanel !== null && (
        <StepsPanel
          node={nodoDelPanel}
          steps={stepsDe(nodoDelPanel.node_key)}
          support={data.support}
          busy={busy}
          onClose={() => setPanel(null)}
          onSetArea={onSetArea}
          onEditStep={onEditStep}
          onDeleteStep={onDeleteStep}
          onReorderSteps={onReorderSteps}
        />
      )}

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
