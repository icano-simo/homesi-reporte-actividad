'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import {
  checkNodeDelete,
  type Funnel,
  type FunnelNode,
  type NodeMilestone,
} from '@/lib/business-plan/funnels';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../components/Breadcrumbs';
import { Fragment } from 'react';
import { ErrorState, LoadingState } from '../components/shared';
import NodeLibrary from './NodeLibrary';
import { saveNode } from '@/lib/business-plan/saveNode';
import FunnelNodeTabs from '../components/FunnelNodeTabs';
import LibrarySearchBar from '../components/LibrarySearchBar';
import { ConfirmDelete, MilestoneForm, NodeForm } from './LibraryForms';

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

/*
 * Los cuatro dialogos que quedan. Se fueron en BP45, con las pestanas:
 *
 *   · `funnel-form`, `funnel-delete` y `funnel-enrolled` viven ahora en
 *     /business-plan/funnels y en la pagina de cada funnel;
 *   · `node-detail` lo disparaba la tabla vieja de nodos, y `NodeLibrary` no
 *     lo usa: el detalle de un nodo es su panel lateral.
 *
 * Y no hay mas pestanas: esta pantalla es la biblioteca de nodos y nada mas.
 */
type Dialog =
  | { kind: 'node-form'; node: FunnelNode | null }
  | { kind: 'node-delete'; node: FunnelNode }
  | { kind: 'ms-form'; nodeKey: number; milestone: NodeMilestone | null }
  | { kind: 'ms-delete'; milestone: NodeMilestone }
  | null;

export default function FunnelLibraryPage() {
  const { data, isLoading, available, error, reload } = useFunnelLibrary();

  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

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

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnels & Nodes' }]}
      />

      <div className="page-head">
        <h1 className="page-head__title">Funnels &amp; Nodes</h1>
        {/*
          LA BUSQUEDA VA EN LA CABECERA, fuera de las pestanas -- etapa BP41.
          Busca funnels, nodos, steps y owners a la vez, asi que atarla a la
          pestana abierta la haria mentir: estando en Nodes encontraria funnels
          igual, y estando en Funnels no encontraria un step.
        */}
        {data && <LibrarySearchBar data={data} />}
      </div>

      {/* Las mismas dos pestanas que en /funnels, con los mismos conteos: es
          una vista del mismo item de menu. */}
      <FunnelNodeTabs funnels={data?.funnels.length} nodes={data?.nodes.length} />

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
          {/*
            LAS TRES PESTAÑAS SE FUERON — etapa BP45.

            `Funnels` y `Sequence builder` viven ahora en /business-plan/funnels
            y en la pagina de cada funnel. Con el constructor se fue tambien su
            reordenamiento, que hacia `delete` de todos los `funnel_node` del
            funnel y los reinsertaba: desde BP41 eso aniquilaria
            `depends_on_node_key` sin aviso. La pagina nueva usa
            `reorder_funnel_nodes`, que hace UPDATE.

            Queda una sola pantalla y una sola accion, asi que no hay nada que
            segmentar.
          */}
          <div className="control-bar">
            <div className="control-group">
              <button type="button" className="bp-btn bp-btn--primary" onClick={() => setDialog({ kind: 'node-form', node: null })}>
                + New node
              </button>
            </div>
          </div>

          {opError && (
            <div className="bp-pending" role="alert">
              <AlertTriangleIcon size={14} />
              <span>{opError}</span>
            </div>
          )}

          {/* ── Funnels ───────────────────────────────────────────────────── */}
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


          {/* ══ Diálogos ═════════════════════════════════════════════ */}

          {dialog?.kind === 'node-form' && (
            <NodeForm
              initial={dialog.node}
              initialOwners={dialog.node ? data.owners.filter((o) => o.node_key === dialog.node!.node_key).map((o) => o.employee_key) : []}
              initialFunnels={dialog.node ? funnelsOf(dialog.node.node_key).map((f) => f.funnel_key) : []}
              funnels={data.funnels}
              support={data.support}
              busy={busy}
              onClose={() => setDialog(null)}
              /*
               * ⚠ ESTE HANDLER SE MUDÓ A `lib/business-plan/saveNode.ts` en
               * BP45, cuando la página del funnel empezó a crear nodos también.
               * Eran cincuenta líneas con el chequeo de nombre de BP25 adentro,
               * y dos copias de eso divergen en el detalle que importa.
               */
              onSave={(d) =>
                run(() =>
                  saveNode({
                    draft: d,
                    nodes: data.nodes,
                    links: data.links,
                    nodeKey: dialog.node?.node_key ?? null,
                  })
                )
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
                  /*
                   * ⚠ LA POSICIÓN DE UN STEP NUEVO VA AL FINAL, CALCULADA — BP44.
                   *
                   * El campo `Position` se fue del editor porque el orden se
                   * arrastra. Pero el borrador lo iniciaba en `1` para un step
                   * nuevo, y `1` YA ESTÁ OCUPADO en cualquier nodo que tenga
                   * steps: desde BP41 `(node_key, position)` es único, así que
                   * el insert habría fallado al commit.
                   *
                   * Quitar el campo sin esto convertía "crear un step" en un
                   * error en 30 de los 32 nodos. Al editar se conserva la
                   * posición que ya tenía: el orden se cambia arrastrando.
                   */
                  position: dialog.milestone
                    ? dialog.milestone.position
                    : Math.max(0, ...nodeStages.map((m) => m.position)) + 1,
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
