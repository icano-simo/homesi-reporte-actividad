'use client';

import { useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import {
  canDeleteFunnel,
  checkNodeDelete,
  funnelStats,
  type Funnel,
  type FunnelCategory,
  type FunnelNode,
  type NodeMilestone,
} from '@/lib/business-plan/funnels';
import { AlertTriangleIcon, CloseIcon } from '@/components/ui/icons';
import { FunnelGlyph } from '../components/funnelIcons';
import Breadcrumbs from '../components/Breadcrumbs';
import Modal from '../components/Modal';
import { ErrorState, LoadingState } from '../components/shared';
import SequenceBuilder from './SequenceBuilder';
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
  const [nodeFilter, setNodeFilter] = useState<'all' | 'none' | number>('all');

  const bp = () => getSupabaseClient().schema('business_plan');

  /**
   * Envuelve cualquier escritura: marca ocupado, captura el error y recarga.
   *
   * `PromiseLike` y no `Promise`: los builders de PostgREST son thenables, no
   * promesas.
   */
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

  /*
   * Un nodo puede estar en VARIOS funnels -- "Sales Call" está en 4 -- así que
   * filtrar por uno lo MUESTRA; no lo oculta por pertenecer también a otros.
   */
  const visibleNodes = useMemo(() => {
    const all = data?.nodes ?? [];
    if (nodeFilter === 'all') return all;
    const linked = new Set((data?.links ?? []).filter((l) => l.node_key !== undefined).map((l) => l.node_key));
    if (nodeFilter === 'none') return all.filter((n) => !linked.has(n.node_key));
    return all.filter((n) => (data?.links ?? []).some((l) => l.funnel_key === nodeFilter && l.node_key === n.node_key));
  }, [data, nodeFilter]);

  const dlgNode = dialog && 'node' in dialog ? dialog.node : null;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnel & Node Library' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Funnel &amp; Node Library</h1>
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
                      <th className="bp-center">Sub-ms</th>
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
                            */}
                            <FunnelGlyph icon={f.icon} size={15} tone="strong" />
                            <input
                              className="bp-inline-input bp-inline-input--name"
                              defaultValue={f.name}
                              disabled={busy}
                              onBlur={(e) => {
                                if (e.target.value !== f.name && e.target.value.trim() !== '')
                                  run(() => bp().from('funnel').update({ name: e.target.value.trim() }).eq('funnel_key', f.funnel_key), false);
                              }}
                            />
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
                          <td className="bp-center">{inUse === 0 ? <span className="bp-muted">0</span> : inUse}</td>
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
            <>
            <div className="control-bar">
              <div className="control-group">
                <span className="label-chip">In funnel</span>
                <select
                  className="field"
                  value={String(nodeFilter)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNodeFilter(v === 'all' || v === 'none' ? v : Number(v));
                  }}
                >
                  <option value="all">All funnels ({data.nodes.length})</option>
                  {data.funnels.map((f) => (
                    <option key={f.funnel_key} value={f.funnel_key}>
                      {f.name} ({data.links.filter((l) => l.funnel_key === f.funnel_key).length})
                    </option>
                  ))}
                  <option value="none">
                    No funnel · orphans ({data.nodes.filter((n) => funnelsOf(n.node_key).length === 0).length})
                  </option>
                </select>
              </div>
            </div>
            <div className="tbl-card">
              <div className="tbl-scroll">
                <table className="piv bp-table--nodes">
                  <colgroup>
                    <col className="bp-col-fname" />
                    <col className="bp-col-fnum" />
                    <col className="bp-col-fnodes" />
                    <col className="bp-col-fcat" />
                    <col className="bp-col-facts" />
                  </colgroup>
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Node</th>
                      <th className="bp-center">Milestones</th>
                      {/* La columna que faltaba: la relación, visible. */}
                      <th className="bp-left">Used in funnels</th>
                      <th className="bp-center">Accountable</th>
                      <th className="bp-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleNodes.map((n) => {
                      const mine = data.milestones.filter((m) => m.node_key === n.node_key);
                      const inF = funnelsOf(n.node_key);
                      const owners = data.owners
                        .filter((o) => o.node_key === n.node_key)
                        .map((o) => data.support.find((s) => s.employee_key === o.employee_key)?.full_name)
                        .filter(Boolean);
                      return (
                        <tr key={n.node_key} className="metric">
                          <td className="lbl bp-wrap">
                            <FunnelGlyph icon={n.icon} size={15} tone="strong" />
                            <input
                              className="bp-inline-input bp-inline-input--name"
                              defaultValue={n.name}
                              disabled={busy}
                              onBlur={(e) => {
                                if (e.target.value !== n.name && e.target.value.trim() !== '')
                                  run(() => bp().from('node').update({ name: e.target.value.trim() }).eq('node_key', n.node_key), false);
                              }}
                            />
                          </td>
                          <td className="bp-center">{mine.length}</td>
                          <td className="bp-left bp-wrap">
                            {inF.length === 0 ? (
                              /* Huérfano: existe pero no lo usa ningún funnel. */
                              <span className="bp-orphan" title="This node is not part of any funnel">
                                orphan
                              </span>
                            ) : (
                              <span className="bp-seq">{inF.map((f) => f.name).join(' · ')}</span>
                            )}
                          </td>
                          <td className="bp-center bp-wrap">
                            {owners.length ? owners.join(', ') : <span className="bp-muted">—</span>}
                          </td>
                          <td className="bp-center">
                            <div className="bp-actions">
                              <button type="button" className="bp-icon-btn" title="Milestones" onClick={() => setDialog({ kind: 'node-detail', node: n })}>
                                ☰
                              </button>
                              <button type="button" className="bp-icon-btn" title="Edit node" onClick={() => setDialog({ kind: 'node-form', node: n })}>
                                ✎
                              </button>
                              <button
                                type="button"
                                className="bp-icon-btn bp-icon-btn--danger"
                                title="Delete node"
                                onClick={() => setDialog({ kind: 'node-delete', node: n })}
                              >
                                <CloseIcon size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleNodes.length === 0 && (
                      <tr>
                        <td className="lbl bp-empty-cell" colSpan={5}>
                          No node in that funnel.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </>
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
                } milestones go with it.`;
              })()}
              blockedReason={checkNodeDelete(dlgNode.node_key, data.links, data.funnels, data.enrollmentsByFunnel).reason}
              onClose={() => setDialog(null)}
              onConfirm={() => run(() => bp().from('node').delete().eq('node_key', dlgNode.node_key))}
            />
          )}

          {dialog?.kind === 'node-detail' && dlgNode && (
            <Modal title={dlgNode.name + ' — milestones'} onClose={() => setDialog(null)}>
              <p className="bp-modal__lead">
                Used in: {funnelsOf(dlgNode.node_key).map((f) => f.name).join(', ') || 'no funnel yet'} ·{' '}
                <button type="button" className="bp-linkish" onClick={() => setDialog({ kind: 'node-form', node: dlgNode })}>
                  change funnels and accountable people
                </button>
              </p>
              <table className="piv">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Milestone</th>
                    <th className="bp-left">Accountable</th>
                    <th className="bp-center">SLA</th>
                    <th className="bp-center">Pos</th>
                    <th className="bp-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.milestones
                    .filter((m) => m.node_key === dlgNode.node_key)
                    .sort((a, b) => a.position - b.position)
                    .map((m) => (
                      <tr key={m.milestone_key} className="metric">
                        <td className="lbl bp-wrap">{m.title}</td>
                        <td className="bp-left">
                          {data.support.find((s) => s.employee_key === m.accountable_employee_key)?.full_name ?? (
                            <span className="bp-muted">unassigned</span>
                          )}
                        </td>
                        <td className="bp-center">{m.sla_days ?? '—'}</td>
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
                </tbody>
              </table>
              <div className="bp-form__actions">
                <button
                  type="button"
                  className="bp-btn bp-btn--small"
                  onClick={() => setDialog({ kind: 'ms-form', nodeKey: dlgNode.node_key, milestone: null })}
                >
                  + New milestone
                </button>
              </div>
            </Modal>
          )}

          {dialog?.kind === 'ms-form' && (
            <MilestoneForm
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
              what={'milestone "' + dialog.milestone.title + '"'}
              busy={busy}
              /* En la plantilla se borra libre: los planes ya activados tienen
                 su copia y no se ven afectados. */
              warning="Plans already activated keep their own copy of this milestone."
              onClose={() => setDialog(null)}
              onConfirm={() => run(() => bp().from('node_milestone').delete().eq('milestone_key', dialog.milestone.milestone_key))}
            />
          )}
        </>
      )}
    </>
  );
}
