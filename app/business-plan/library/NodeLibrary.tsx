'use client';

import { useEffect, useMemo, useState } from 'react';
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
    | { kind: 'funnels-of'; node: FunnelNode }
    | { kind: 'pick-funnels'; node: FunnelNode }
    | { kind: 'remove'; node: FunnelNode }
    | null
  >(null);
  /* Que tarjeta tiene el menu de acciones desplegado. Uno solo a la vez. */
  const [menu, setMenu] = useState<number | null>(null);

  const busqueda: SearchInput = data;

  /*
   * EL MENU CIERRA AL HACER CLIC AFUERA Y CON ESCAPE.
   *
   * Sin esto solo cerraba con su propio boton: cualquier otro clic --incluso en
   * otra tarjeta-- lo dejaba abierto y flotando sobre la lista. Y el clic en el
   * cuerpo de una tarjeta abre el panel, asi que el menu quedaba abierto DEBAJO
   * del panel, invisible y activo.
   *
   * Se registra solo cuando hay un menu abierto: un listener permanente en
   * `document` para un estado que casi siempre es null.
   */
  useEffect(() => {
    if (menu === null) return;
    const cerrar = () => setMenu(null);
    const porTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    /*
     * `capture: true` y no la fase de burbujeo: los botones del menu llaman
     * `stopPropagation` de su contenedor, asi que en burbujeo este listener no
     * se enteraria del clic. En captura corre primero -- y por eso el handler
     * del propio item ya cerro el menu antes, lo que hace que el orden no
     * importe.
     */
    document.addEventListener('click', cerrar, { capture: true });
    document.addEventListener('keydown', porTecla);
    return () => {
      document.removeEventListener('click', cerrar, { capture: true });
      document.removeEventListener('keydown', porTecla);
    };
  }, [menu]);

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
                    {/*
                      LAS DOS METRICAS EN TONO NEUTRO -- etapa BP44.
                      Estaban en la familia --sky y salieron: son DATOS, no
                      estados. El azul se lee como "esto significa algo" y no
                      significa nada: 5 days no es mejor ni peor que 44. El
                      tinte queda libre para lo que si es un estado -- el ambar
                      de lo que falta decidir.
                    */}
                    <span className="bp-metapill">
                      {st.steps} step{st.steps === 1 ? '' : 's'}
                    </span>

                    {/* `—` y no `0 days` sin steps: no hay duración que leer, y un
                        cero afirmaría que dura nada. */}
                    <span className="bp-metapill">{st.steps === 0 ? '— days' : st.days + ' days'}</span>

                    {/* Cero NO es un botón: no hay nada que abrir. */}
                    {st.funnelKeys.length === 0 ? (
                      <span className="bp-metapill bp-metapill--warn">in no funnel</span>
                    ) : (
                      <button
                        type="button"
                        className="bp-metapill bp-metapill--link"
                        /* Abre la asignacion MULTIPLE, que es la accion util.
                           Antes solo listaba donde estaba, y habia un
                           `Funnels...` aparte para cambiarlo. El dialogo ya
                           muestra los nueve con los actuales marcados, asi que
                           dice lo mismo que la lista y ademas deja hacer algo. */
                        onClick={() => setDialogo({ kind: 'pick-funnels', node: n })}
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
                        <span className="bp-metapill bp-metapill--warn">no owner</span>
                      ) : (
                        st.owners.map((o) => (
                          <span key={o} className="bp-initials" title={o}>
                            {initialsOf(o)}
                          </span>
                        ))
                      )}
                    </span>

                    {/*
                      EL AREA, EN DOS TONOS Y NO EN CINCO -- etapa BP44.

                      Sin asignar: ambar, porque es lo que hay que resolver.
                      Asignada: gris neutro, sin importar cual sea.

                      ⚠ NO LLEVA UN COLOR POR AREA. Con areas editables el
                      numero crece --es el punto 1 de esta etapa-- y una paleta
                      por area se vuelve inmanejable en cuanto haya seis o diez.
                      El nombre ya distingue; el color solo tiene que decir si
                      falta o no.

                      Es una pildora clicable y no un `<select>` nativo: abre el
                      panel, que es donde estan las opciones a la vista.
                    */}
                    <button
                      type="button"
                      className={'bp-metapill' + (n.area === null ? ' bp-metapill--warn' : ' bp-metapill--link')}
                      onClick={() => setPanel(n.node_key)}
                      title={n.area === null ? 'No area assigned — click to set it' : 'Area: ' + n.area}
                    >
                      {n.area ?? 'No area'}
                    </button>

                    {/*
                      DE CUATRO CONTROLES A DOS -- etapa BP44.

                      `Manage steps` se fue: el CUERPO de la tarjeta abre el
                      editor, que era lo que ese boton hacia. Con 32 tarjetas
                      eran 32 botones repitiendo el gesto que ya tiene la fila
                      entera, y en coral, anulando la jerarquia que el color
                      deberia dar.

                      Quedan dos cosas, y hacen cosas distintas:
                        - `in N funnels`, que abre la asignacion multiple;
                        - un menu con editar y quitar, que son las acciones
                          menos frecuentes y las unicas destructivas.
                    */}
                    <div className="bp-menu">
                      <button
                        type="button"
                        className="bp-metapill bp-metapill--link bp-menu__trigger"
                        aria-haspopup="true"
                        aria-expanded={menu === n.node_key}
                        aria-label={'More actions for ' + n.name}
                        onClick={(e) => {
                          /* Sin esto, el listener de captura de arriba veria
                             este mismo clic y cerraria el menu que se acaba de
                             abrir: se abriria y cerraria en un gesto. */
                          e.stopPropagation();
                          setMenu(menu === n.node_key ? null : n.node_key);
                        }}
                      >
                        ⋯
                      </button>
                      {menu === n.node_key && (
                        <div className="bp-menu__list" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="bp-menu__item"
                            onClick={() => {
                              setMenu(null);
                              onEditNode(n);
                            }}
                          >
                            Edit node
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="bp-menu__item bp-menu__item--danger"
                            onClick={() => {
                              setMenu(null);
                              setDialogo({ kind: 'remove', node: n });
                            }}
                          >
                            Remove node
                          </button>
                        </div>
                      )}
                    </div>
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

      {/*
        QUITAR DICE EN CUANTOS FUNNELS ESTA -- etapa BP44.

        Sacar un nodo que esta en cinco no es lo mismo que sacar uno suelto: en
        el primer caso se rompen cinco funnels de una. "Se va a borrar el nodo"
        es generico y no se lee; el numero hace parar, igual que los steps
        completados en la cancelacion de un plan.
      */}
      {dialogo?.kind === 'remove' && (
        <RemoveNode
          node={dialogo.node}
          funnelNames={nodeStats(dialogo.node.node_key, busqueda).funnelNames}
          busy={busy}
          onClose={() => setDialogo(null)}
          onConfirm={() => {
            onDeleteNode(dialogo.node);
            setDialogo(null);
          }}
        />
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
 * CONFIRMACION DE QUITAR UN NODO -- etapa BP44.
 *
 * Dice en cuantos funnels esta y los NOMBRA. Un nodo esta hoy en hasta cinco
 * funnels --medido: `CRM, MMI & for Network effects`-- y quitarlo los toca a
 * todos. El numero es lo que distingue sacar uno suelto de romper cinco.
 */
function RemoveNode({
  node,
  funnelNames,
  busy,
  onClose,
  onConfirm,
}: {
  node: FunnelNode;
  funnelNames: string[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={'Remove ' + node.name + '?'} onClose={onClose}>
      <div className="bp-form">
        {funnelNames.length === 0 ? (
          <p className="bp-modal__lead">
            This node is not in any funnel, so nothing else changes.
          </p>
        ) : (
          <p className="bp-modal__lead bp-modal__lead--warn">
            It is used by{' '}
            <strong>
              {funnelNames.length} funnel{funnelNames.length === 1 ? '' : 's'}
            </strong>{' '}
            &mdash; {funnelNames.join(', ')}. Removing it takes it out of all of them.
          </p>
        )}
        <p className="bp-modal__lead">
          Plans already running keep their copy: they were copied when the funnel was activated. This cannot be
          undone.
        </p>
        <div className="bp-form__actions">
          <button type="button" className="bp-btn bp-btn--primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Removing…' : 'Remove the node'}
          </button>
          <button type="button" className="bp-linkish" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
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
