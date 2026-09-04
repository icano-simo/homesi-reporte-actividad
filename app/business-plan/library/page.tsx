'use client';

import { useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import {
  canDeleteFunnel,
  checkNodeDelete,
  findNodeNameClash,
  cumulativeDays,
  funnelStats,
  type Funnel,
  type FunnelCategory,
  type FunnelNode,
  type NodeMilestone,
} from '@/lib/business-plan/funnels';
import { AlertTriangleIcon, CloseIcon } from '@/components/ui/icons';
import { FunnelGlyph } from '../components/funnelIcons';
import Breadcrumbs from '../components/Breadcrumbs';
import { Fragment } from 'react';
import Modal from '../components/Modal';
import { Avatar, ErrorState, LoadingState } from '../components/shared';
import SequenceBuilder from './SequenceBuilder';
import NodeLibrary from './NodeLibrary';
import LibrarySearchBar from '../components/LibrarySearchBar';
import { ConfirmDelete, FunnelForm, MilestoneForm, NodeForm } from './LibraryForms';

/**
 * ============================================================================
 * BIBLIOTECA DE FUNNELS Y NODOS
 * ============================================================================
 *
 * Etapa BP12, ampliada a CRUD completo en BP13.
 *
 * Todo lo que se ve acá son PLANTILLAS: editarlas no toca ningún plan ya
 * activado, porque al enrolarse el plan se copia. Ver `funnels.ts`.
 *
 * ---------------------------------------------------------------------------
 * LA RELACIÓN NODO ↔ FUNNEL ES DE MUCHOS A MUCHOS, Y SE VE
 * ---------------------------------------------------------------------------
 * Un nodo NO pertenece a un funnel: puede estar en varios. Hoy "Sales Call"
 * está en 4 y "Social Media Setup" en 2, con UNA sola fila cada uno.
 *
 * Si cada nodo perteneciera a un solo funnel harían falta 4 copias de Sales
 * Call con sus milestones duplicados, y cambiar un paso obligaría a editarlo en
 * cuatro lados. Por eso el modelo no cambia -- lo que faltaba era hacerlo
 * visible, y ahora se ve desde los dos lados:
 *
 *   pestaña Funnels  lista los NOMBRES de sus nodos, en orden
 *   pestaña Nodes    lista en qué funnels se usa cada nodo, y marca huérfanos
 *   detalle del nodo casillas para agregarlo o quitarlo de cada funnel
 */

type Tab = 'funnels' | 'nodes' | 'builder';
type Dialog =
  | { kind: 'funnel-form'; funnel: Funnel | null }
  | { kind: 'funnel-delete'; funnel: Funnel }
  | { kind: 'node-form'; node: FunnelNode | null }
  | { kind: 'node-delete'; node: FunnelNode }
  | { kind: 'node-detail'; node: FunnelNode }
  | { kind: 'ms-form'; nodeKey: number; milestone: NodeMilestone | null }
  | { kind: 'ms-delete'; milestone: NodeMilestone }
  /* Quien esta enrolado en un funnel, con su avance — etapa BP40. */
  | { kind: 'funnel-enrolled'; funnel: Funnel }
  | null;

export default function FunnelLibraryPage() {
  const { data, isLoading, available, error, reload } = useFunnelLibrary();
  const [tab, setTab] = useState<Tab>('funnels');
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedFunnel, setSelectedFunnel] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  /*
   * Filtro de la pestaña Nodes. 'all' = todos; 'none' = huérfanos, que hasta
   * ahora sólo se distinguían por la marca ámbar y había que ir a buscarlos a
   * ojo entre 18 filas.
   */
  /* El filtro por funnel de BP40 se fue: la biblioteca agrupa por AREA y filtra
     por area, que es lo que pide BP41. `visibleNodes` queda para el constructor. */

  const bp = () => getSupabaseClient().schema('business_plan');

  /**
   * Envuelve cualquier escritura: marca ocupado, captura el error y recarga.
   *
   * `PromiseLike` y no `Promise`: los builders de PostgREST son thenables, no
   * promesas.
   */
  /*
   * ═══════════════════════════════════════════════════════════════════════
   * UN NODO EN VARIOS FUNNELS, DE UNA VEZ — etapa BP41
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Se calcula el DELTA y se escribe solo eso: los funnels que se agregaron y
   * los que se quitaron. Borrar todos los vinculos del nodo y reponerlos habria
   * sido una linea menos y habria perdido `position` y `depends_on_node_key` de
   * los que ya estaban -- o sea, el orden dentro del funnel y las dependencias
   * declaradas.
   *
   * ⚠ LA POSICION DEL NUEVO VA AL FINAL, calculada por funnel. Con un `0` fijo,
   * dos nodos agregados al mismo funnel chocarian contra
   * `funnel_node_position_uk`, que desde BP41 es unica.
   *
   * ⚠ Y QUITAR NO BORRA EL NODO: se borra la fila de `funnel_node`, nunca la de
   * `node`. Un nodo sin ningun funnel es un estado valido y queda disponible.
   */
  async function guardarFunnels(nodeKey: number, funnelKeys: number[]) {
    if (!data) return;
    const actuales = data.links.filter((l) => l.node_key === nodeKey).map((l) => l.funnel_key);
    const agregar = funnelKeys.filter((k) => !actuales.includes(k));
    const quitar = actuales.filter((k) => !funnelKeys.includes(k));
    if (agregar.length === 0 && quitar.length === 0) return;

    setBusy(true);
    setOpError(null);
    try {
      for (const fk of quitar) {
        const { error: e } = await bp().from('funnel_node').delete().eq('funnel_key', fk).eq('node_key', nodeKey);
        if (e) throw new Error(e.message);
      }
      for (const fk of agregar) {
        const usadas = data.links.filter((l) => l.funnel_key === fk).map((l) => l.position);
        const siguiente = usadas.length === 0 ? 1 : Math.max(...usadas) + 1;
        const { error: e } = await bp()
          .from('funnel_node')
          .insert({ funnel_key: fk, node_key: nodeKey, position: siguiente });
        if (e) throw new Error(e.message);
      }
      reload();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, close = true) {
    setBusy(true);
    setOpError(null);
    try {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
      if (close) setDialog(null);
      reload();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /* Lista o flujo dentro del detalle de un nodo. Etapa BP25. */
  const [stageView, setStageView] = useState<'list' | 'flow'>('list');

  const stats = useMemo(() => {
    if (!data) return new Map<number, ReturnType<typeof funnelStats>>();
    return new Map(
      data.funnels.map((f) => [f.funnel_key, funnelStats(f.funnel_key, data.links, data.milestones, data.owners)])
    );
  }, [data]);

  /** Nombres de los nodos de un funnel, en orden de secuencia. */
  const nodeNamesOf = (funnelKey: number) =>
    (data?.links ?? [])
      .filter((l) => l.funnel_key === funnelKey)
      .sort((a, b) => a.position - b.position)
      .map((l) => data?.nodes.find((n) => n.node_key === l.node_key)?.name ?? '?');

  /** Funnels en los que se usa un nodo. Vacío = huérfano. */
  const funnelsOf = (nodeKey: number) =>
    (data?.links ?? [])
      .filter((l) => l.node_key === nodeKey)
      .map((l) => data?.funnels.find((f) => f.funnel_key === l.funnel_key))
      .filter(Boolean) as Funnel[];



  const dlgNode = dialog && 'node' in dialog ? dialog.node : null;
  /*
   * LA CLAVE DEL NODO EN JUEGO, POR LOS DOS CAMINOS -- etapa BP40.
   *
   * El detalle trae el nodo entero (`node`); el formulario de step trae solo su
   * clave (`nodeKey`), porque `dialog` es un solo estado y abrir el editor
   * REEMPLAZA al detalle en vez de apilarse. Mirando solo `'node' in dialog`,
   * `nodeStages` quedaba vacio justo cuando el editor necesita los hermanos
   * para dibujar su vista previa: la lista aparecia sin ningun step.
   */
  const dlgNodeKey =
    dlgNode?.node_key ?? (dialog && 'nodeKey' in dialog ? dialog.nodeKey : null);
  /* Los stages del nodo abierto, en orden. Una sola vez: las dos vistas del
     detalle los recorren, y filtrar dos veces las dejaba libres de discrepar. */
  const nodeStages = (data?.milestones ?? [])
    .filter((m) => dlgNodeKey !== null && m.node_key === dlgNodeKey)
    .sort((a, b) => a.position - b.position);
  /*
   * El dia en que cae cada step: la suma corrida de los deltas -- BP40. Sale de
   * `cumulativeDays`, la MISMA funcion que usa el editor para mostrar el efecto
   * de un cambio. Dos sumas del mismo numero pueden diferir.
   */
  const diasAcumulados = cumulativeDays(nodeStages.map((m) => m.sla_days));

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnel & Node Library' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Funnel &amp; Node Library</h1>
        {/*
          LA BUSQUEDA VA EN LA CABECERA, fuera de las pestanas -- etapa BP41.
          Busca funnels, nodos, steps y owners a la vez, asi que atarla a la
          pestana abierta la haria mentir: estando en Nodes encontraria funnels
          igual, y estando en Funnels no encontraria un step.
        */}
        {data && <LibrarySearchBar data={data} />}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {!isLoading && !error && !available && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            The funnel tables are not in the database yet — apply{' '}
            <code>docs/sql/2026-08-business-plan-funnels.sql</code> to populate this library.
          </span>
        </div>
      )}

      {data && available && (
        <>
          <div className="control-bar">
            <div className="seg">
              <button className={tab === 'funnels' ? 'on' : ''} onClick={() => setTab('funnels')}>
                Funnels ({data.funnels.length})
              </button>
              <button className={tab === 'nodes' ? 'on' : ''} onClick={() => setTab('nodes')}>
                Nodes ({data.nodes.length})
              </button>
              <button className={tab === 'builder' ? 'on' : ''} onClick={() => setTab('builder')}>
                Sequence builder
              </button>
            </div>
            <div className="control-group">
              {tab === 'funnels' && (
                <button type="button" className="bp-btn bp-btn--primary" onClick={() => setDialog({ kind: 'funnel-form', funnel: null })}>
                  + New funnel
                </button>
              )}
              {tab === 'nodes' && (
                <button type="button" className="bp-btn bp-btn--primary" onClick={() => setDialog({ kind: 'node-form', node: null })}>
                  + New node
                </button>
              )}
            </div>
          </div>

          {opError && (
            <div className="bp-pending" role="alert">
              <AlertTriangleIcon size={14} />
              <span>{opError}</span>
            </div>
          )}

          {/* ── Funnels ───────────────────────────────────────────────────── */}
          {tab === 'funnels' && (
            <div className="tbl-card">
              <div className="tbl-scroll">
                <table className="piv bp-table--funnels">
                  <colgroup>
                    <col className="bp-col-fname" />
                    <col className="bp-col-fcat" />
                    <col className="bp-col-fnodes" />
                    <col className="bp-col-fnum" />
                    <col className="bp-col-fnum" />
                    <col className="bp-col-fnum" />
                    <col className="bp-col-facts" />
                  </colgroup>
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Funnel</th>
                      <th className="bp-center">Category</th>
                      <th className="bp-left">Nodes, in order</th>
                      <th className="bp-center">Steps</th>
                      <th className="bp-center">Weeks</th>
                      <th className="bp-center">In use</th>
                      <th className="bp-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnels.map((f) => {
                      const s = stats.get(f.funnel_key);
                      const inUse = data.enrollmentsByFunnel[f.funnel_key] ?? 0;
                      const names = nodeNamesOf(f.funnel_key);
                      return (
                        <tr key={f.funnel_key} className="metric">
                          {/*
                            Nombre completo, sin ellipsis: son nombres cortos y
                            la columna tiene espacio de sobra. Editable en línea.
                          */}
                          <td className="lbl bp-wrap">
                            {/*
                              Etapa BP21: el icono que se elige en el formulario,
                              visible en la tabla. Sin esto no habia forma de
                              saber cual tenia cada funnel sin abrir el editor.
                              Etapa BP25: en claro. `--strong` es navy pleno y
                              repetido por fila armaba una columna de cuadrados
                              oscuros que pesaba mas que los nombres.

                              ⚠ El `flex` va en un SPAN de adentro, nunca en el
                              `td`. Un `display: flex` sobre una celda la saca del
                              algoritmo de tabla: deja de ser celda y con
                              `table-layout: fixed` se lleva puestos los anchos de
                              todas las columnas.
                            */}
                            <span className="bp-name-cell">
                              <FunnelGlyph icon={f.icon} size={15} />
                              <input
                                className="bp-inline-input bp-inline-input--name"
                                defaultValue={f.name}
                                disabled={busy}
                                onBlur={(e) => {
                                  if (e.target.value !== f.name && e.target.value.trim() !== '')
                                    run(() => bp().from('funnel').update({ name: e.target.value.trim() }).eq('funnel_key', f.funnel_key), false);
                                }}
                              />
                            </span>
                            {!f.is_active && <span className="bp-chip">inactive</span>}
                            {f.is_example && <span className="bp-chip">example</span>}
                          </td>
                          <td className="bp-center">
                            <select
                              className="bp-inline-input"
                              value={f.category}
                              disabled={busy}
                              onChange={(e) =>
                                run(() => bp().from('funnel').update({ category: e.target.value as FunnelCategory }).eq('funnel_key', f.funnel_key), false)
                              }
                            >
                              {/* Capitalizado SÓLO al mostrar: el `value` sigue en
                                  minúscula, que es lo que valida el check de la
                                  columna. Capitalizarlo al guardar rompería el insert. */}
                              <option value="core">Core</option>
                              <option value="growth">Growth</option>
                            </select>
                          </td>
                          {/*
                            Los NOMBRES, no sólo el número: "5 nodos" no dice si
                            el funnel está bien armado. No es editable acá --
                            los nodos se agregan y quitan desde el constructor
                            o desde el detalle del nodo.
                          */}
                          <td className="bp-left bp-wrap">
                            {names.length === 0 ? (
                              <span className="bp-muted">no nodes yet</span>
                            ) : (
                              <span className="bp-seq">{names.join(' → ')}</span>
                            )}
                          </td>
                          <td className="bp-center">{s?.subMilestoneCount ?? 0}</td>
                          <td className="bp-center">
                            <input
                              type="number"
                              min="1"
                              className="bp-inline-input bp-inline-input--num"
                              defaultValue={f.duration_weeks ?? ''}
                              disabled={busy}
                              onBlur={(e) => {
                                const v = e.target.value === '' ? null : Number(e.target.value);
                                if (v !== f.duration_weeks)
                                  run(() => bp().from('funnel').update({ duration_weeks: v }).eq('funnel_key', f.funnel_key), false);
                              }}
                            />
                          </td>
                          {/*
                            ⚠ EL NÚMERO SE VUELVE UN BOTÓN — etapa BP40.

                            La columna decía cuántos, y para saber QUIÉNES había
                            que entrar al perfil de cada persona de a una. Con
                            tres enrolados eso es incómodo; con treinta, inviable.

                            ⚠ Y EL CERO NO ES UN BOTÓN. Un control que abre una
                            lista vacía se ve, se usa, y no pasa nada -- es el
                            mismo criterio con el que no se ofrece editar lo que
                            no se puede editar.
                          */}
                          <td className="bp-center">
                            {inUse === 0 ? (
                              <span className="bp-muted">0</span>
                            ) : (
                              <button
                                type="button"
                                className="bp-linkish"
                                onClick={() => setDialog({ kind: 'funnel-enrolled', funnel: f })}
                                title={`See who has this funnel active, and how far along they are`}
                              >
                                {inUse}
                              </button>
                            )}
                          </td>
                          {/* Acciones EN LÍNEA: apiladas, cada fila medía el triple. */}
                          <td className="bp-center">
                            <div className="bp-actions">
                              <button
                                type="button"
                                className="bp-icon-btn"
                                title="Edit all fields"
                                onClick={() => setDialog({ kind: 'funnel-form', funnel: f })}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="bp-icon-btn"
                                title="Open in the sequence builder"
                                onClick={() => {
                                  setSelectedFunnel(f.funnel_key);
                                  setTab('builder');
                                }}
                              >
                                ⇄
                              </button>
                              <button
                                type="button"
                                className="bp-icon-btn"
                                title={f.is_active ? 'Deactivate' : 'Activate'}
                                disabled={busy}
                                onClick={() => run(() => bp().from('funnel').update({ is_active: !f.is_active }).eq('funnel_key', f.funnel_key), false)}
                              >
                                {f.is_active ? '◉' : '○'}
                              </button>
                              <button
                                type="button"
                                className="bp-icon-btn bp-icon-btn--danger"
                                title="Delete"
                                onClick={() => setDialog({ kind: 'funnel-delete', funnel: f })}
                              >
                                <CloseIcon size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {data.funnels.length === 0 && (
                      <tr>
                        <td className="lbl bp-empty-cell" colSpan={7}>
                          No funnels yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Nodos ─────────────────────────────────────────────────────── */}
          {tab === 'nodes' && (
            <NodeLibrary
              data={data}
              busy={busy}
              onSetArea={(nodeKey, area) =>
                run(() => bp().from('node').update({ area }).eq('node_key', nodeKey), false)
              }
              onSetFunnels={guardarFunnels}
              onEditNode={(node) => setDialog({ kind: 'node-form', node })}
              onDeleteNode={(node) => setDialog({ kind: 'node-delete', node })}
              onEditStep={(nodeKey, milestone) => setDialog({ kind: 'ms-form', nodeKey, milestone })}
              onDeleteStep={(milestone) => setDialog({ kind: 'ms-delete', milestone })}
              onReorderSteps={(nodeKey, milestoneKeys) =>
                run(
                  () =>
                    bp().rpc('reorder_node_steps', {
                      p_node_key: nodeKey,
                      p_milestone_keys: milestoneKeys,
                    }),
                  false
                )
              }
            />
          )}

          {/* ── Constructor ───────────────────────────────────────────────── */}
          {tab === 'builder' && (
            <>
              <div className="control-bar">
                <div className="control-group">
                  <span className="label-chip">Funnel</span>
                  <select
                    className="field"
                    value={selectedFunnel ?? ''}
                    onChange={(e) => setSelectedFunnel(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Pick a funnel…</option>
                    {data.funnels.map((f) => (
                      <option key={f.funnel_key} value={f.funnel_key}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedFunnel === null ? (
                <p className="bp-muted-line">Pick a funnel to edit its sequence.</p>
              ) : (
                <SequenceBuilder
                  funnelKey={selectedFunnel}
                  nodes={data.nodes}
                  links={data.links}
                  milestones={data.milestones}
                  selectedNodeKey={selectedNode}
                  onSelectNode={setSelectedNode}
                  busy={busy}
                  onChangeSequence={(ordered) =>
                    run(async () => {
                      const del = await bp().from('funnel_node').delete().eq('funnel_key', selectedFunnel);
                      if (del.error) return del;
                      return bp()
                        .from('funnel_node')
                        .insert(ordered.map((node_key, i) => ({ funnel_key: selectedFunnel, node_key, position: i + 1 })));
                    }, false)
                  }
                />
              )}
            </>
          )}

          {/* ══ Diálogos ═══════════════════════════════════════════════════ */}

          {dialog?.kind === 'funnel-form' && (
            <FunnelForm
              initial={dialog.funnel}
              busy={busy}
              onClose={() => setDialog(null)}
              onSave={(d) => {
                const row = {
                  name: d.name.trim(),
                  category: d.category,
                  description: d.description.trim() || null,
                  duration_weeks: d.duration_weeks === '' ? null : Number(d.duration_weeks),
                  icon: d.icon.trim() || null,
                };
                run(() =>
                  dialog.funnel
                    ? bp().from('funnel').update(row).eq('funnel_key', dialog.funnel.funnel_key)
                    : bp().from('funnel').insert({ ...row, position: data.funnels.length + 1 })
                );
              }}
            />
          )}

          {/*
            ══════════════════════════════════════════════════════════════════
            QUIÉN ESTÁ ENROLADO — etapa BP40
            ══════════════════════════════════════════════════════════════════

            ⚠ EL AVANCE SE MIDE EN STEPS Y NO EN NODOS. Lo que alguien completa
            son steps, y un nodo de ocho pesa distinto que uno de dos: contar
            nodos daría un porcentaje que no se corresponde con el trabajo.

            ⚠ Y `0%` CON SUS DOS NÚMEROS AL LADO. Un `0%` solo no distingue
            "no empezó" de "no tiene steps"; con `0 / 8` se lee lo primero y con
            `0 / 0` lo segundo -- que es un plan mal armado y otra conversación.
          */}
          {dialog?.kind === 'funnel-enrolled' && (
            <Modal title={dialog.funnel.name + ' — who has it active'} onClose={() => setDialog(null)}>
              <table className="piv bp-table--los">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Loan Officer</th>
                    <th className="bp-center">Steps done</th>
                    <th className="bp-center">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.enrolledByFunnel[dialog.funnel.funnel_key] ?? []).map((e) => (
                    <tr key={e.employee_key} className="metric">
                      <td className="lbl">{e.full_name}</td>
                      <td className="bp-center">
                        {e.done} / {e.total}
                      </td>
                      <td className="bp-center">{e.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Modal>
          )}

          {dialog?.kind === 'funnel-delete' && (
            <ConfirmDelete
              what={'funnel "' + dialog.funnel.name + '"'}
              busy={busy}
              blockedReason={
                canDeleteFunnel(data.enrollmentsByFunnel[dialog.funnel.funnel_key] ?? 0)
                  ? null
                  : `${data.enrollmentsByFunnel[dialog.funnel.funnel_key]} active plan(s) use this funnel. Deactivate it instead — the plans in progress keep working and it stops appearing in the catalogue.`
              }
              onClose={() => setDialog(null)}
              onConfirm={() => run(() => bp().from('funnel').delete().eq('funnel_key', dialog.funnel.funnel_key))}
            />
          )}

          {dialog?.kind === 'node-form' && (
            <NodeForm
              initial={dialog.node}
              initialOwners={dialog.node ? data.owners.filter((o) => o.node_key === dialog.node!.node_key).map((o) => o.employee_key) : []}
              initialFunnels={dialog.node ? funnelsOf(dialog.node.node_key).map((f) => f.funnel_key) : []}
              funnels={data.funnels}
              support={data.support}
              busy={busy}
              onClose={() => setDialog(null)}
              onSave={(d) =>
                run(async () => {
                  /*
                   * ⚠ Etapa BP25. Convivieron "Cold Calling" y "Cold calling",
                   * y el segundo se coló en tres funnels antes de que alguien lo
                   * notara. La columna ES unica, pero `text` distingue
                   * mayusculas: para la base eran dos nombres distintos.
                   *
                   * Se devuelve un `error` con la misma forma que los de
                   * PostgREST para que `run` lo muestre igual que cualquier otro
                   * -- sin una segunda via de mensajes de error que mantener.
                   */
                  const clash = findNodeNameClash(d.name, data.nodes, dialog.node?.node_key ?? null);
                  if (clash) {
                    return {
                      error: {
                        message:
                          'A node called "' + clash + '" already exists. Names must be different beyond upper/lower ' +
                          'case and spacing — use that one, or pick another name.',
                      },
                    };
                  }
                  const row = { name: d.name.trim(), description: d.description.trim() || null, icon: d.icon.trim() || null };
                  let nodeKey = dialog.node?.node_key;
                  if (nodeKey) {
                    const up = await bp().from('node').update(row).eq('node_key', nodeKey);
                    if (up.error) return up;
                  } else {
                    const ins = await bp().from('node').insert(row).select('node_key').single();
                    if (ins.error) return ins;
                    nodeKey = (ins.data as { node_key: number }).node_key;
                  }
                  // Responsables: se reescriben enteros, son pocos.
                  const delO = await bp().from('node_owner').delete().eq('node_key', nodeKey);
                  if (delO.error) return delO;
                  if (d.owners.length) {
                    const insO = await bp().from('node_owner').insert(d.owners.map((employee_key) => ({ node_key: nodeKey, employee_key })));
                    if (insO.error) return insO;
                  }
                  /*
                   * Pertenencia a funnels desde ACÁ: es el otro lado del
                   * constructor. Se quita de los que se destildaron y se agrega
                   * al final de los nuevos -- agregarlo en medio cambiaría una
                   * secuencia que alguien ya ordenó.
                   */
                  const current = funnelsOf(nodeKey).map((f) => f.funnel_key);
                  const toRemove = current.filter((k) => !d.funnels.includes(k));
                  const toAdd = d.funnels.filter((k) => !current.includes(k));
                  for (const k of toRemove) {
                    const r = await bp().from('funnel_node').delete().eq('funnel_key', k).eq('node_key', nodeKey);
                    if (r.error) return r;
                  }
                  for (const k of toAdd) {
                    const last = Math.max(0, ...data.links.filter((l) => l.funnel_key === k).map((l) => l.position));
                    const r = await bp().from('funnel_node').insert({ funnel_key: k, node_key: nodeKey, position: last + 1 });
                    if (r.error) return r;
                  }
                  return { error: null };
                })
              }
            />
          )}

          {dialog?.kind === 'node-delete' && dlgNode && (
            <ConfirmDelete
              what={'node "' + dlgNode.name + '"'}
              busy={busy}
              warning={(() => {
                const chk = checkNodeDelete(dlgNode.node_key, data.links, data.funnels, data.enrollmentsByFunnel);
                if (chk.usedIn.length === 0) return 'This node is not used by any funnel.';
                return `It will be removed from ${chk.usedIn.length} funnel(s): ${chk.usedIn.map((u) => u.name).join(', ')}. Its ${
                  data.milestones.filter((m) => m.node_key === dlgNode.node_key).length
                } stages go with it.`;
              })()}
              blockedReason={checkNodeDelete(dlgNode.node_key, data.links, data.funnels, data.enrollmentsByFunnel).reason}
              onClose={() => setDialog(null)}
              onConfirm={() => run(() => bp().from('node').delete().eq('node_key', dlgNode.node_key))}
            />
          )}

          {dialog?.kind === 'node-detail' && dlgNode && (
            <Modal title={dlgNode.name + ' — steps'} onClose={() => setDialog(null)}>
              <p className="bp-modal__lead">
                Used in: {funnelsOf(dlgNode.node_key).map((f) => f.name).join(', ') || 'no funnel yet'} ·{' '}
                <button type="button" className="bp-linkish" onClick={() => setDialog({ kind: 'node-form', node: dlgNode })}>
                  change funnels and accountable people
                </button>
              </p>

              {/*
                ⚠ DOS VISTAS DE LO MISMO — etapa BP25.
                La lista es la vista de TRABAJO: tiene el SLA, la posición y los
                botones de editar y borrar. El flujo es la vista de LECTURA: los
                pasos en secuencia con su responsable al frente, que es lo que se
                quiere ver al explicarle el nodo a alguien.
                La lista es la de por defecto porque es donde se hacen cosas;
                arrancar en la de leer costaría un clic extra en el caso habitual.
              */}
              <div className="bp-view-toggle">
                <div className="seg">
                  <button type="button" className={stageView === 'list' ? 'on' : ''} onClick={() => setStageView('list')}>
                    List
                  </button>
                  <button type="button" className={stageView === 'flow' ? 'on' : ''} onClick={() => setStageView('flow')}>
                    Flow
                  </button>
                </div>
              </div>

              {stageView === 'list' ? (
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Step</th>
                      <th className="bp-left">Accountable</th>
                      {/*
                        DOS COLUMNAS Y NO UNA -- etapa BP40. `+ days` es lo que se
                        edita: los dias desde el step anterior. `Day` es lo que
                        resulta, y es el que se lee para saber cuando cae. Sin la
                        segunda, nadie sabe en que dia del nodo esta un step; sin
                        la primera, no se puede editar sin hacer la resta a mano.
                      */}
                      <th className="bp-center">+ days</th>
                      <th className="bp-center">Day</th>
                      <th className="bp-center">Pos</th>
                      <th className="bp-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodeStages.map((m, i) => (
                      <tr key={m.milestone_key} className="metric">
                        <td className="lbl bp-wrap">{m.title}</td>
                        <td className="bp-left">
                          {data.support.find((s) => s.employee_key === m.accountable_employee_key)?.full_name ?? (
                            <span className="bp-muted">unassigned</span>
                          )}
                        </td>
                        <td className="bp-center">{m.sla_days ?? '—'}</td>
                        <td className="bp-center bp-strong">{diasAcumulados[i]}</td>
                        <td className="bp-center">{m.position}</td>
                        <td className="bp-center">
                          <div className="bp-actions">
                            <button
                              type="button"
                              className="bp-icon-btn"
                              title="Edit"
                              onClick={() => setDialog({ kind: 'ms-form', nodeKey: dlgNode.node_key, milestone: m })}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="bp-icon-btn bp-icon-btn--danger"
                              title="Delete"
                              onClick={() => setDialog({ kind: 'ms-delete', milestone: m })}
                            >
                              <CloseIcon size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {nodeStages.length === 0 && (
                      <tr>
                        <td className="lbl bp-empty-cell" colSpan={5}>
                          This node has no steps yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                /*
                  Una sola fila con scroll, mismo criterio que el stepper del
                  preview: una secuencia envuelta en varias filas deja de leerse
                  como una secuencia. Se edita con un clic en la tarjeta, para no
                  obligar a volver a la lista para corregir algo que se acaba de
                  ver mal.
                */
                <div className="bp-flow">
                  {nodeStages.map((m, i) => {
                    const who = data.support.find((s) => s.employee_key === m.accountable_employee_key) ?? null;
                    return (
                      <div key={m.milestone_key} className="bp-flow__slot">
                        <button
                          type="button"
                          className="bp-flow__card"
                          title="Edit this step"
                          onClick={() => setDialog({ kind: 'ms-form', nodeKey: dlgNode.node_key, milestone: m })}
                        >
                          <span className="bp-flow__n">
                            STAGE {i + 1}
                            {m.sla_days !== null && <> · day {m.sla_days}</>}
                          </span>
                          <span className="bp-flow__title">{m.title}</span>
                          {/* El responsable AL FRENTE: es la pregunta que trae a
                              alguien a esta vista. */}
                          <span className="bp-flow__who">
                            {who ? (
                              <>
                                <Avatar name={who.full_name} title={who.job_title ?? who.full_name} />
                                {who.full_name}
                              </>
                            ) : (
                              <span className="bp-muted">unassigned</span>
                            )}
                          </span>
                        </button>
                        <span className="bp-flow__arrow" aria-hidden="true">
                          →
                        </span>
                      </div>
                    );
                  })}
                  {nodeStages.length === 0 && <p className="bp-flow__empty">This node has no steps yet.</p>}
                </div>
              )}

              <div className="bp-form__actions">
                <button
                  type="button"
                  className="bp-btn bp-btn--small"
                  onClick={() => setDialog({ kind: 'ms-form', nodeKey: dlgNode.node_key, milestone: null })}
                >
                  + New step
                </button>
              </div>
            </Modal>
          )}

          {dialog?.kind === 'ms-form' && (
            <MilestoneForm
              siblings={nodeStages.map((m) => ({
                milestone_key: m.milestone_key,
                title: m.title,
                sla_days: m.sla_days,
                position: m.position,
              }))}
              initial={dialog.milestone}
              support={data.support}
              busy={busy}
              onClose={() => setDialog(null)}
              onSave={(d) => {
                const row = {
                  node_key: dialog.nodeKey,
                  title: d.title.trim(),
                  accountable_employee_key: d.accountable_employee_key === '' ? null : Number(d.accountable_employee_key),
                  sla_days: d.sla_days === '' ? null : Number(d.sla_days),
                  resource_url: d.resource_url.trim() || null,
                  position: Number(d.position) || 1,
                };
                run(() =>
                  dialog.milestone
                    ? bp().from('node_milestone').update(row).eq('milestone_key', dialog.milestone.milestone_key)
                    : bp().from('node_milestone').insert(row)
                );
              }}
            />
          )}

          {dialog?.kind === 'ms-delete' && (
            <ConfirmDelete
              what={'step "' + dialog.milestone.title + '"'}
              busy={busy}
              /* En la plantilla se borra libre: los planes ya activados tienen
                 su copia y no se ven afectados. */
              warning="Plans already activated keep their own copy of this step."
              onClose={() => setDialog(null)}
              onConfirm={() => run(() => bp().from('node_milestone').delete().eq('milestone_key', dialog.milestone.milestone_key))}
            />
          )}
        </>
      )}
    </>
  );
}
