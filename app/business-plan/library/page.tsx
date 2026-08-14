'use client';

import { useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import { canDeleteFunnel, funnelStats } from '@/lib/business-plan/funnels';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../components/Breadcrumbs';
import Modal from '../components/Modal';
import { ErrorState, LoadingState } from '../components/shared';
import SequenceBuilder from './SequenceBuilder';

/**
 * ============================================================================
 * BIBLIOTECA DE FUNNELS Y NODOS
 * ============================================================================
 *
 * Etapa BP12 — reemplaza al placeholder de BP2.
 *
 * Tres secciones: los funnels, los nodos con sus milestones, y el constructor
 * de secuencia. Todo lo que se ve acá son PLANTILLAS: editarlas no toca ningún
 * plan ya activado, porque al enrolarse el plan se copia. Ver `funnels.ts`.
 */

type Tab = 'funnels' | 'nodes' | 'builder';

export default function FunnelLibraryPage() {
  const { data, isLoading, available, error, reload } = useFunnelLibrary();
  const [tab, setTab] = useState<Tab>('funnels');
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [selectedFunnel, setSelectedFunnel] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);

  const bp = () => getSupabaseClient().schema('business_plan');

  /**
   * Envuelve cualquier escritura: marca ocupado, captura el error y recarga.
   *
   * `PromiseLike` y no `Promise`: los builders de PostgREST son thenables, no
   * promesas, así que pedir `Promise` los rechazaría y obligaría a envolver
   * cada llamada en un `await` extra sin ganar nada.
   */
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setOpError(null);
    try {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
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

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnel & Node Library' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Funnel &amp; Node Library</h1>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {/*
        Las tablas las aplica el revisor. Entre el deploy y la migración esta
        pantalla existe pero no tiene de dónde leer -- decirlo es mejor que
        mostrarla vacía y que parezca que no hay funnels cargados.
      */}
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
          </div>

          {opError && (
            <div className="bp-pending" role="alert">
              <AlertTriangleIcon size={14} />
              <span>{opError}</span>
            </div>
          )}

          {/* ── 2a. Funnels ───────────────────────────────────────────────── */}
          {tab === 'funnels' && (
            <div className="tbl-card">
              <div className="tbl-scroll">
                <table className="piv bp-table--library">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Funnel</th>
                      <th className="bp-center">Category</th>
                      <th className="bp-center">Nodes</th>
                      <th className="bp-center">Sub-milestones</th>
                      <th className="bp-center">Weeks</th>
                      <th className="bp-center">In use</th>
                      <th className="bp-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnels.map((f) => {
                      const s = stats.get(f.funnel_key);
                      const inUse = data.enrollmentsByFunnel[f.funnel_key] ?? 0;
                      const deletable = canDeleteFunnel(inUse);
                      return (
                        <tr key={f.funnel_key} className="metric">
                          <td className="lbl">
                            {f.name}
                            {!f.is_active && <span className="bp-chip">inactive</span>}
                            {f.is_example && <span className="bp-chip">example</span>}
                          </td>
                          <td className="bp-center">
                            <span className={'badge badge--pill ' + (f.category === 'core' ? 'badge--sky' : 'badge--neutral')}>
                              {f.category}
                            </span>
                          </td>
                          {/* Contados de las filas, nunca de un campo guardado. */}
                          <td className="bp-center">{s?.nodeCount ?? 0}</td>
                          <td className="bp-center">{s?.subMilestoneCount ?? 0}</td>
                          <td className="bp-center">{f.duration_weeks ?? '—'}</td>
                          <td className="bp-center">{inUse === 0 ? <span className="bp-muted">0</span> : inUse}</td>
                          <td className="bp-center">
                            <div className="bp-row-actions">
                              <button
                                type="button"
                                className="bp-btn bp-btn--small"
                                onClick={() => {
                                  setSelectedFunnel(f.funnel_key);
                                  setTab('builder');
                                }}
                              >
                                Sequence
                              </button>
                              <button
                                type="button"
                                className="bp-btn bp-btn--small"
                                disabled={busy}
                                onClick={() =>
                                  run(() =>
                                    bp().from('funnel').update({ is_active: !f.is_active }).eq('funnel_key', f.funnel_key)
                                  )
                                }
                              >
                                {f.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              {/*
                                Un funnel con enrolamientos NO se borra. La base ya lo
                                impide con una FK RESTRICT, pero la interfaz tiene que
                                saberlo antes: que el usuario descubra la regla por un
                                error de Postgres es una forma pobre de explicarla.
                              */}
                              <button
                                type="button"
                                className="bp-btn bp-btn--small"
                                disabled={busy || !deletable}
                                title={deletable ? 'Delete this funnel' : `${inUse} active plan(s) use it — deactivate instead`}
                                onClick={() => run(() => bp().from('funnel').delete().eq('funnel_key', f.funnel_key))}
                              >
                                Delete
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

          {/* ── 2b. Nodos y sus milestones ────────────────────────────────── */}
          {tab === 'nodes' && (
            <div className="bp-node-grid">
              {data.nodes.map((n) => {
                const mine = data.milestones.filter((m) => m.node_key === n.node_key);
                const nodeOwners = data.owners
                  .filter((o) => o.node_key === n.node_key)
                  .map((o) => data.support.find((s) => s.employee_key === o.employee_key)?.full_name)
                  .filter(Boolean);
                return (
                  <button key={n.node_key} type="button" className="bp-node-card" onClick={() => setSelectedNode(n.node_key)}>
                    <div className="bp-node-card__name">{n.name}</div>
                    <div className="bp-node-card__desc">{n.description ?? '—'}</div>
                    <div className="bp-node-card__meta">
                      {mine.length} milestones
                      {nodeOwners.length > 0 && <> · {nodeOwners.join(', ')}</>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── 2c. Constructor de secuencia ──────────────────────────────── */}
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
                      /*
                       * Se reescribe la secuencia entera: borrar y volver a
                       * insertar es más simple y más seguro que calcular qué
                       * posiciones cambiaron, y son cinco filas.
                       */
                      const del = await bp().from('funnel_node').delete().eq('funnel_key', selectedFunnel);
                      if (del.error) return del;
                      return bp()
                        .from('funnel_node')
                        .insert(ordered.map((node_key, i) => ({ funnel_key: selectedFunnel, node_key, position: i + 1 })));
                    })
                  }
                />
              )}
            </>
          )}

          {/* Detalle de un nodo: sus milestones en orden, con responsable y SLA. */}
          {selectedNode !== null && (
            <Modal
              title={data.nodes.find((n) => n.node_key === selectedNode)?.name ?? 'Node'}
              onClose={() => setSelectedNode(null)}
            >
              <table className="piv">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Milestone</th>
                    <th className="bp-left">Accountable</th>
                    <th className="bp-center">SLA (days)</th>
                    <th className="bp-center">Resource</th>
                  </tr>
                </thead>
                <tbody>
                  {data.milestones
                    .filter((m) => m.node_key === selectedNode)
                    .sort((a, b) => a.position - b.position)
                    .map((m) => (
                      <tr key={m.milestone_key} className="metric">
                        <td className="lbl">{m.title}</td>
                        <td className="bp-left">
                          {/* Persona, no rol: con un rol no se puede resolver
                              quién tiene permiso de marcarlo como hecho. */}
                          <select
                            className="field"
                            value={m.accountable_employee_key ?? ''}
                            disabled={busy}
                            onChange={(e) =>
                              run(() =>
                                bp()
                                  .from('node_milestone')
                                  .update({
                                    accountable_employee_key: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                  .eq('milestone_key', m.milestone_key)
                              )
                            }
                          >
                            <option value="">— unassigned —</option>
                            {data.support.map((s) => (
                              <option key={s.employee_key} value={s.employee_key}>
                                {s.full_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="bp-center">{m.sla_days ?? '—'}</td>
                        <td className="bp-center">
                          {m.resource_url ? (
                            <a href={m.resource_url} target="_blank" rel="noreferrer">
                              link
                            </a>
                          ) : (
                            <span className="bp-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
