'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import {
  cumulativeDays,
  nodeDayRanges,
  NODE_AREAS,
  type FunnelNode,
  type NodeArea,
  type NodeMilestone,
} from '@/lib/business-plan/funnels';
import { funnelTotals, initialsOf, nodeStats, type SearchInput } from '@/lib/business-plan/librarySearch';
import { saveNode } from '@/lib/business-plan/saveNode';
import type { EnrolledPerson, FunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import Breadcrumbs from '../../components/Breadcrumbs';
import LibrarySearchBar from '../../components/LibrarySearchBar';
import Modal from '../../components/Modal';
import { FunnelGlyph } from '../../components/funnelIcons';
import { Avatar, ErrorState, LoadingState } from '../../components/shared';
import { ConfirmDelete, MilestoneForm, NodeForm } from '../../library/LibraryForms';

/**
 * ============================================================================
 * UN FUNNEL, EN UNA SOLA PÁGINA — etapa BP45
 * ============================================================================
 *
 * ARCHIVO NUEVO. Reemplaza a la pestaña `Sequence builder`, y con ella al
 * camino de escritura que la hacía peligrosa: el reordenamiento viejo hacía
 * `delete` de TODOS los `funnel_node` del funnel y los reinsertaba, lo que
 * desde BP41 aniquilaría `depends_on_node_key`. Acá se usa
 * `reorder_funnel_nodes`, que hace UPDATE y la preserva.
 *
 * ⚠ LOS NODOS SE EXPANDEN EN EL LUGAR, y no en un panel lateral como en la
 * biblioteca. Es una diferencia deliberada: la biblioteca tiene 32 tarjetas y
 * desplegar hacia abajo hacía perder el lugar en la lista; un funnel tiene
 * entre 3 y 12, así que el empuje es tolerable -- y a cambio la SECUENCIA sigue
 * a la vista mientras se editan los steps, que es lo que se está decidiendo.
 */

export default function FunnelPage({ params }: { params: Promise<{ funnelKey: string }> }) {
  const { funnelKey: raw } = use(params);
  /* `decodeURIComponent` no hace falta acá --la clave es numérica-- pero el
     `Number` sí: Next entrega el segmento como string. */
  const funnelKey = Number(raw);

  const { data, isLoading, available, error, reload } = useFunnelLibrary();
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [arrastrado, setArrastrado] = useState<number | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'enrolled' }
    | { kind: 'add-existing' }
    | { kind: 'new-node' }
    | { kind: 'remove'; node: FunnelNode }
    | { kind: 'depends'; node: FunnelNode; posicion: number }
    | { kind: 'ms-form'; nodeKey: number; milestone: NodeMilestone | null }
    | { kind: 'ms-delete'; milestone: NodeMilestone }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const bp = () => getSupabaseClient().schema('business_plan');

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

  const funnel = data?.funnels.find((f) => f.funnel_key === funnelKey) ?? null;

  /* Los nodos del funnel, en orden, con su rango de días. */
  const secuencia = useMemo(() => {
    if (!data) return [];
    return data.links
      .filter((l) => l.funnel_key === funnelKey)
      .sort((a, b) => a.position - b.position)
      .map((l) => l.node_key);
  }, [data, funnelKey]);

  /* El mapa de dependencias del funnel, para que los dias las reflejen. */
  const dependsOn = useMemo(
    () =>
      new Map<number, number | null>(
        (data?.links ?? [])
          .filter((l) => l.funnel_key === funnelKey)
          .map((l) => [l.node_key, l.depends_on_node_key ?? null])
      ),
    [data, funnelKey]
  );
  const rangos = useMemo(
    () => (data ? nodeDayRanges(secuencia, data.milestones, dependsOn) : []),
    [data, secuencia, dependsOn]
  );
  const totales = data ? funnelTotals(funnelKey, data) : { nodes: 0, steps: 0, endsDay: 0 };
  const enrolados: EnrolledPerson[] = data?.enrolledByFunnel[funnelKey] ?? [];

  const toggle = (k: number) =>
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data || !available) {
    return (
      <div className="bp-pending" role="status">
        <span>The Business Plan tables are not applied yet.</span>
      </div>
    );
  }
  if (!funnel) {
    /* Un funnel que no existe lo dice, con la clave que se pidió: sin ella, el
       mensaje no ayuda a entender qué enlace estaba roto. */
    return <ErrorState message={'No funnel with key ' + raw + '.'} />;
  }

  const stepsDe = (nodeKey: number) =>
    data.milestones.filter((m) => m.node_key === nodeKey).sort((a, b) => a.position - b.position);

  const nombreDe = (employeeKey: number | null) =>
    employeeKey === null ? null : data.support.find((p) => p.employee_key === employeeKey)?.full_name ?? `employee ${employeeKey}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          { label: 'Funnels', href: '/business-plan/funnels' },
          { label: funnel.name },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            <FunnelGlyph icon={funnel.icon} size={22} />
            {funnel.name}
          </h1>
          {/*
            ⚠ LOS TOTALES, SIEMPRE A LA VISTA. Medido contra la base, los nueve
            funnels van de 8 a 207 días; dos pasan de siete meses. Armar un
            funnel es decidir cuánto dura, así que el número no puede estar
            detrás de un clic.
          */}
          <p className="page-head__subtitle">
            {totales.nodes} node{totales.nodes === 1 ? '' : 's'} · {totales.steps} step
            {totales.steps === 1 ? '' : 's'} · {totales.steps === 0 ? 'no days yet' : 'ends day ' + totales.endsDay}
            {' · '}
            {/* Cero NO es un botón: no hay lista que abrir. */}
            {enrolados.length === 0 ? (
              <span>nobody enrolled</span>
            ) : (
              <button type="button" className="bp-linkish" onClick={() => setDialog({ kind: 'enrolled' })}>
                {enrolados.length} enrolled
              </button>
            )}
          </p>
        </div>
        <LibrarySearchBar data={data} />
      </div>

      {opError && (
        <div className="bp-pending" role="alert">
          <span>{opError}</span>
        </div>
      )}

      {/*
        LAS DOS ENTRADAS, JUNTAS. Agregar uno que ya existe y crear uno nuevo son
        la misma decisión tomada de dos maneras, así que separarlas obligaba a
        buscar la otra al descubrir que el nodo no existía todavía.
      */}
      <div className="bp-tabs" role="group" aria-label="Add nodes">
        <button type="button" className="bp-tabs__tab is-on" onClick={() => setDialog({ kind: 'add-existing' })}>
          + Add existing node
        </button>
        <button type="button" className="bp-tabs__tab" onClick={() => setDialog({ kind: 'new-node' })}>
          + New node
        </button>
      </div>

      {secuencia.length === 0 && (
        <p className="bp-muted-line">This funnel has no nodes yet. Add one to start.</p>
      )}

      <div className="bp-node-list">
        {secuencia.map((nodeKey, i) => {
          const n = data.nodes.find((x) => x.node_key === nodeKey);
          if (!n) return null;
          const st = nodeStats(nodeKey, data as SearchInput);
          const rango = rangos[i];
          const abierto = abiertos.has(nodeKey);
          /*
           * El antecesor, resuelto a su NODO. El vínculo guarda una clave; la
           * pantalla necesita el nombre, y resolverlo acá --y no en el badge--
           * es lo que permite que el diálogo y el badge digan lo mismo.
           */
          const depKey = data.links.find((l) => l.funnel_key === funnelKey && l.node_key === nodeKey)
            ?.depends_on_node_key ?? null;
          const antecesor = depKey === null ? null : data.nodes.find((x) => x.node_key === depKey) ?? null;
          /*
           * Los HERMANOS: los otros nodos que declaran el mismo antecesor. Se
           * comparan por dependencia declarada y NUNCA por dia -- ver la nota
           * del badge.
           *
           * Con `depKey === null` la lista queda vacia a proposito: hoy los 63
           * nodos estan asi, y compararlos por "ninguno" los volveria hermanos
           * de todos.
           */
          const hermanos =
            depKey === null
              ? []
              : data.links
                  .filter(
                    (l) =>
                      l.funnel_key === funnelKey &&
                      l.node_key !== nodeKey &&
                      (l.depends_on_node_key ?? null) === depKey
                  )
                  .map((l) => data.nodes.find((x) => x.node_key === l.node_key))
                  .filter((x): x is FunnelNode => x !== undefined);
          const steps = stepsDe(nodeKey);
          const dias = cumulativeDays(steps.map((m) => m.sla_days));

          return (
            <article
              key={nodeKey}
              className="bp-nodecard bp-nodecard--seq"
              draggable={!busy}
              onDragStart={() => setArrastrado(nodeKey)}
              onDragEnd={() => setArrastrado(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (arrastrado === null || arrastrado === nodeKey) return;
                /*
                 * ⚠ SE MANDA EL ORDEN A `reorder_funnel_nodes`, QUE HACE UPDATE.
                 *
                 * El reordenamiento de la pestaña vieja hacía `delete` de todos
                 * los `funnel_node` del funnel y los reinsertaba. Desde BP41 eso
                 * aniquilaría `depends_on_node_key` sin aviso: hoy no hay
                 * ninguna dependencia declarada, así que no se perdía nada, pero
                 * era una bomba con fecha conocida -- el día que alguien
                 * declarara la primera y después reordenara.
                 *
                 * La función además renumera 1..N en una transacción, así que la
                 * posición es una consecuencia y la unicidad diferida de
                 * `(funnel_key, position)` se evalúa una sola vez al commit.
                 */
                const orden = secuencia.filter((k) => k !== arrastrado);
                orden.splice(i, 0, arrastrado);
                setArrastrado(null);
                run(
                  () => bp().rpc('reorder_funnel_nodes', { p_funnel_key: funnelKey, p_node_keys: orden }),
                  false
                );
              }}
            >
              <div className="bp-nodecard__head-row">
                <span className="bp-grip" aria-hidden="true">
                  ⠿
                </span>
                {/* El número de orden: navy, y es la consecuencia de la posición. */}
                <span className="bp-seq-num">{i + 1}</span>

                <button
                  type="button"
                  className="bp-nodecard__left bp-nodecard__toggle-seq"
                  onClick={() => toggle(nodeKey)}
                  aria-expanded={abierto}
                >
                  {/* Nada cortado: el nombre entero. */}
                  <h3 className="bp-nodecard__name">{n.name}</h3>
                  {n.description && <p className="bp-nodecard__desc">{n.description}</p>}
                </button>

                <div className="bp-nodecard__meta">
                  <span className={'bp-metapill' + (n.area === null ? ' bp-metapill--warn' : '')}>
                    {n.area ?? 'No area'}
                  </span>
                  <span className="bp-metapill">
                    {st.steps} step{st.steps === 1 ? '' : 's'}
                  </span>
                  {/* El rango de días DENTRO del funnel, no la duración del nodo:
                      es lo que dice cuándo le toca a esta persona. */}
                  <span className="bp-metapill">
                    {rango ? 'day ' + rango.fromDay + '–' + rango.toDay : '—'}
                  </span>
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
                    ═════════════════════════════════════════════════
                    LA DEPENDENCIA DICE EL NOMBRE, NO EL NÚMERO — etapa BP46
                    ═════════════════════════════════════════════════

                    `Waits for Social media set up`, nunca
                    `needs node 1` -- nadie debería tener que ir a contar. El
                    número de orden está al lado y cambia al arrastrar; el nombre
                    no.

                    Y SE DECLARA, NO SE DIBUJA: no hay diagrama. La relación se
                    elige de una lista y se lee como una frase.
                  */}
                  {antecesor !== null && (
                    <span className="bp-metapill bp-metapill--waits" title={'Waits for ' + antecesor.name}>
                      Waits for {antecesor.name}
                    </span>
                  )}
                  {/*
                    EL PARALELISMO SE DERIVA, no se declara — etapa BP46.

                    Dos nodos que esperan al MISMO antecesor arrancan el mismo
                    dia, y eso sale del dato: no hay nada que marcar como
                    "paralelo".

                    ⚠ Y SE DICE POR LA DEPENDENCIA, NO POR LA FECHA. Dos nodos
                    que caen el mismo dia por casualidad --porque los SLA de
                    arriba suman igual-- NO son paralelos, y rotularlos asi seria
                    afirmar algo que el modelo no dice. El dia es la
                    consecuencia; la dependencia es la causa.
                  */}
                  {hermanos.length > 0 && rango && (
                    <span
                      className="bp-metapill bp-metapill--waits"
                      title={'Runs alongside ' + hermanos.map((h) => h.name).join(', ')}
                    >
                      in parallel with {hermanos.length === 1 ? hermanos[0].name : hermanos.length + ' others'} · both
                      start day {rango.fromDay}
                    </span>
                  )}
                  <button
                    type="button"
                    className="bp-metapill bp-metapill--link"
                    onClick={() => setDialog({ kind: 'depends', node: n, posicion: i })}
                  >
                    {antecesor === null ? 'Waits for…' : 'Change'}
                  </button>
                  <button
                    type="button"
                    className="bp-metapill bp-metapill--link"
                    onClick={() => setDialog({ kind: 'remove', node: n })}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {abierto && (
                <div className="bp-nodecard__body">
                  {steps.length === 0 ? (
                    <p className="bp-muted-line">No steps yet.</p>
                  ) : (
                    <table className="piv bp-steps-table">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>Accountable</th>
                          <th className="bp-center">SLA</th>
                          <th className="bp-center">Day</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {steps.map((m, j) => (
                          <tr key={m.milestone_key}>
                            <td className="bp-strong">{m.title}</td>
                            <td>{nombreDe(m.accountable_employee_key) ?? '— unassigned —'}</td>
                            <td className="bp-center">{m.sla_days ?? '—'}</td>
                            <td className="bp-center bp-strong">{dias[j]}</td>
                            <td className="bp-right">
                              <button
                                type="button"
                                className="bp-icon-btn"
                                title="Edit"
                                onClick={() => setDialog({ kind: 'ms-form', nodeKey, milestone: m })}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="bp-icon-btn bp-icon-btn--danger"
                                title="Delete"
                                onClick={() => setDialog({ kind: 'ms-delete', milestone: m })}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {steps.length > 0 && (
                    <p className="bp-legend">
                      SLA is days after the previous step. Day is where it lands in the plan.
                    </p>
                  )}
                  <div className="bp-nodecard__actions">
                    <button
                      type="button"
                      className="bp-btn bp-btn--small"
                      onClick={() => setDialog({ kind: 'ms-form', nodeKey, milestone: null })}
                    >
                      + New step
                    </button>
                  </div>
                  <p className="bp-nodecard__rule">
                    Editing here changes the <strong>template</strong>, not the plans already running — and it changes
                    it for every funnel that uses this node
                    {st.funnelKeys.length > 1 && <> ({st.funnelKeys.length} of them)</>}.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* ── Diálogos ───────────────────────────────────────────────────────── */}

      {dialog?.kind === 'enrolled' && (
        <EnrolledList funnelName={funnel.name} personas={enrolados} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'add-existing' && (
        <AddExistingNode
          data={data}
          yaEstan={secuencia}
          busy={busy}
          onClose={() => setDialog(null)}
          onAdd={(nodeKey) => {
            /* La posición del nuevo va al FINAL, calculada. Con un `0` fijo
               chocaría contra `funnel_node_position_uk`. */
            const usadas = data.links.filter((l) => l.funnel_key === funnelKey).map((l) => l.position);
            const siguiente = usadas.length === 0 ? 1 : Math.max(...usadas) + 1;
            run(() => bp().from('funnel_node').insert({ funnel_key: funnelKey, node_key: nodeKey, position: siguiente }));
          }}
        />
      )}

      {dialog?.kind === 'new-node' && (
        <NodeForm
          initial={null}
          initialOwners={[]}
          initialFunnels={[funnelKey]}
          funnels={data.funnels}
          support={data.support}
          busy={busy}
          onClose={() => setDialog(null)}
          /*
           * ⚠ EL MISMO `saveNode` QUE LA BIBLIOTECA, no una copia. Incluye el
           * chequeo de nombre duplicado de BP25: sin él, crear un nodo desde
           * acá podría meter un segundo "Cold calling" y el problema volvería
           * por la puerta de al lado.
           *
           * `ensureFunnels` fuerza este funnel: acá no es una casilla a
           * destildar, es el contexto de quien apretó el botón.
           */
          onSave={(d) =>
            run(() =>
              saveNode({
                draft: d,
                nodes: data.nodes,
                links: data.links,
                nodeKey: null,
                ensureFunnels: [funnelKey],
              })
            )
          }
        />
      )}

      {dialog?.kind === 'remove' && (
        <Modal title={'Remove ' + dialog.node.name + ' from ' + funnel.name + '?'} onClose={() => setDialog(null)}>
          <div className="bp-form">
            {/*
              ⚠ QUITAR DE UN FUNNEL NO BORRA EL NODO. Se dice, porque el botón
              dice "Remove" y la duda razonable es si se pierde el nodo entero
              con sus steps.
            */}
            <p className="bp-modal__lead">
              The node stays in the library with its steps. This only takes it out of{' '}
              <strong>{funnel.name}</strong>
              {nodeStats(dialog.node.node_key, data as SearchInput).funnelKeys.length > 1 && (
                <>
                  {' '}
                  — it stays in the other{' '}
                  {nodeStats(dialog.node.node_key, data as SearchInput).funnelKeys.length - 1} funnel(s) that use it
                </>
              )}
              .
            </p>
            <div className="bp-form__actions">
              <button
                type="button"
                className="bp-btn bp-btn--primary"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    bp()
                      .from('funnel_node')
                      .delete()
                      .eq('funnel_key', funnelKey)
                      .eq('node_key', dialog.node.node_key)
                  )
                }
              >
                {busy ? 'Removing…' : 'Remove from this funnel'}
              </button>
              <button type="button" className="bp-linkish" onClick={() => setDialog(null)}>
                cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'depends' && (
        <Modal title={'What does ' + dialog.node.name + ' wait for?'} onClose={() => setDialog(null)}>
          <div className="bp-form">
            {/*
              ⚠ SOLO SE OFRECEN LOS NODOS DE ARRIBA.
              El trigger `funnel_node_dep_order` exige que el antecesor tenga
              posición menor -- es lo que hace imposibles los ciclos. Ofrecer uno
              de abajo sería ofrecer algo que la base va a rechazar, y un control
              que falla al usarse es peor que uno que no ofrece la opción.
            */}
            {dialog.posicion === 0 ? (
              <p className="bp-modal__lead">
                This is the first node of the funnel, so there is nothing before it to wait for.
              </p>
            ) : (
              <>
                <p className="bp-modal__lead">
                  Only the {dialog.posicion} node{dialog.posicion === 1 ? '' : 's'} above it can be chosen: a node
                  cannot wait for one that comes later.
                </p>
                <div className="bp-check-list">
                  <button
                    type="button"
                    className="bp-pickrow"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        bp()
                          .from('funnel_node')
                          .update({ depends_on_node_key: null })
                          .eq('funnel_key', funnelKey)
                          .eq('node_key', dialog.node.node_key)
                      )
                    }
                  >
                    <span className="bp-pickrow__name">Nothing — it can start right away</span>
                    <span className="bp-pickrow__meta">the default</span>
                  </button>
                  {secuencia.slice(0, dialog.posicion).map((k, j) => {
                    const prev = data.nodes.find((x) => x.node_key === k);
                    if (!prev) return null;
                    return (
                      <button
                        key={k}
                        type="button"
                        className="bp-pickrow"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            bp()
                              .from('funnel_node')
                              .update({ depends_on_node_key: k })
                              .eq('funnel_key', funnelKey)
                              .eq('node_key', dialog.node.node_key)
                          )
                        }
                      >
                        <span className="bp-pickrow__name">
                          {j + 1}. {prev.name}
                        </span>
                        <span className="bp-pickrow__meta">
                          {rangos[j] ? 'ends day ' + rangos[j].toDay : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/*
                  ⚠ SE ANTICIPA QUE EL FUNNEL SE ACORTA — etapa BP46.

                  Declarar una dependencia que produce paralelismo BAJA el
                  `ends day` del funnel: dos nodos que antes corrian uno detras
                  del otro pasan a correr a la vez. Es correcto y va a
                  sorprender, asi que se dice antes -- igual que el corrimiento
                  de los SLA en el editor de steps.

                  El numero no se estima: se recalcula con la dependencia puesta
                  y se compara contra el actual. Una estimacion propia
                  presentada como medicion ya nos costo una vez.
                */}
                {(() => {
                  const actual = rangos.length ? Math.max(...rangos.map((r) => r.toDay)) : 0;
                  const conLaNueva = (destino: number | null) => {
                    const m = new Map(dependsOn);
                    m.set(dialog.node.node_key, destino);
                    const r = nodeDayRanges(secuencia, data.milestones, m);
                    return r.length ? Math.max(...r.map((x) => x.toDay)) : 0;
                  };
                  /* El mayor acortamiento entre las opciones que se ofrecen. */
                  const mejor = secuencia
                    .slice(0, dialog.posicion)
                    .map((k) => ({ k, dia: conLaNueva(k) }))
                    .filter((x) => x.dia < actual)
                    .sort((x, y) => x.dia - y.dia)[0];
                  if (!mejor) return null;
                  const nombre = data.nodes.find((x) => x.node_key === mejor.k)?.name ?? '';
                  return (
                    <p className="bp-modal__lead bp-modal__lead--warn">
                      Choosing <strong>{nombre}</strong> makes both nodes start on the same day and shortens the
                      funnel from <strong>day {actual}</strong> to <strong>day {mejor.dia}</strong>. Plans already
                      running keep their dates — they were copied when the funnel was activated.
                    </p>
                  );
                })()}
                <p className="bp-legend">
                  A node that waits for another cannot be dragged above it — the database refuses it, so the worst
                  that can happen is that the list snaps back.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}

      {dialog?.kind === 'ms-form' && (
        <MilestoneForm
          siblings={stepsDe(dialog.nodeKey).map((m) => ({
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
            const nodeKey = dialog.nodeKey;
            const hermanos = stepsDe(nodeKey);
            const row = {
              node_key: nodeKey,
              title: d.title.trim(),
              accountable_employee_key: d.accountable_employee_key === '' ? null : Number(d.accountable_employee_key),
              sla_days: d.sla_days === '' ? null : Number(d.sla_days),
              resource_url: d.resource_url.trim() || null,
              /* Al final, calculada: el campo Position se fue del editor en
                 BP44 y `1` ya está ocupado en cualquier nodo con steps. */
              position: dialog.milestone
                ? dialog.milestone.position
                : Math.max(0, ...hermanos.map((m) => m.position)) + 1,
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
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(() => bp().from('node_milestone').delete().eq('milestone_key', dialog.milestone.milestone_key))
          }
        />
      )}
    </>
  );
}

/**
 * EL AVANCE, POR PERSONA — punto 10 de BP41.
 *
 * ⚠ POR PERSONA Y NO AGREGADO, y es la razón por la que existe este diálogo en
 * vez de un porcentaje en el encabezado: el promedio esconde lo que importa.
 * Alguien que terminó el primer nodo y alguien que va en 1 de 3 dan el mismo
 * número agregado, y no son la misma situación.
 *
 * Y el desglose es por NODO, con los nombres de la COPIA de cada persona: si la
 * plantilla se renombró después de activar, su plan sigue diciendo con qué se
 * activó.
 */
function EnrolledList({
  funnelName,
  personas,
  onClose,
}: {
  funnelName: string;
  personas: EnrolledPerson[];
  onClose: () => void;
}) {
  return (
    <Modal title={personas.length + ' enrolled in ' + funnelName} onClose={onClose}>
      <div className="bp-form">
        {personas.map((p) => (
          <div key={p.employee_key} className="bp-enrolled">
            <div className="bp-enrolled__head">
              <Avatar name={p.full_name} />
              <Link className="bp-enrolled__name" href={'/business-plan/lo/' + p.employee_key + '/plan'}>
                {p.full_name}
              </Link>
              <span className="bp-enrolled__count">
                {p.done} of {p.total}
              </span>
            </div>
            {/* La barra en navy, y el porcentaje sale del mismo done/total que
                el texto: dos cuentas del mismo número pueden diferir. */}
            <div
              className="bp-enrolled__bar"
              role="img"
              aria-label={p.pct + ' percent complete'}
              style={{ ['--pct' as string]: p.pct + '%' }}
            />
            <p className="bp-enrolled__nodes">
              {p.nodes.map((n, i) => (
                <span key={n.name + i}>
                  {i > 0 && <span className="bp-enrolled__sep"> · </span>}
                  {n.name} <b>{n.done} of {n.total}</b>
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * AGREGAR UN NODO QUE YA EXISTE, filtrable por área — punto 4 de BP41.
 *
 * Los que ya están en el funnel NO se ofrecen: `funnel_node` tiene PK
 * `(funnel_key, node_key)`, así que agregarlo dos veces falla, y ofrecerlo para
 * que falle es peor que no ofrecerlo. Se dicen igual, al pie, para que no
 * parezca que el nodo desapareció de la biblioteca.
 */
function AddExistingNode({
  data,
  yaEstan,
  busy,
  onClose,
  onAdd,
}: {
  data: FunnelLibrary;
  yaEstan: number[];
  busy: boolean;
  onClose: () => void;
  onAdd: (nodeKey: number) => void;
}) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState<NodeArea | null | 'all'>('all');

  const disponibles = useMemo(() => {
    const necesita = q.trim().toLowerCase();
    return data.nodes
      .filter((n) => !yaEstan.includes(n.node_key))
      .filter((n) => (area === 'all' ? true : (n.area ?? null) === area))
      .filter((n) => necesita === '' || n.name.toLowerCase().includes(necesita));
  }, [data.nodes, yaEstan, area, q]);

  return (
    <Modal title="Add an existing node" onClose={onClose}>
      <div className="bp-form">
        <input
          type="search"
          className="field"
          value={q}
          placeholder="Filter by name…"
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter nodes by name"
        />
        <div className="bp-metapill-group" role="group" aria-label="Filter by area">
          {([['all', 'All'], [null, 'No area'], ...NODE_AREAS.map((a) => [a, a] as const)] as [
            NodeArea | null | 'all',
            string,
          ][]).map(([v, rot]) => (
            <button
              key={String(v)}
              type="button"
              className={'bp-metapill bp-metapill--area' + (area === v ? ' is-on' : '')}
              onClick={() => setArea(v)}
            >
              {rot}
            </button>
          ))}
        </div>

        <div className="bp-check-list">
          {disponibles.length === 0 ? (
            <p className="bp-muted-line">No nodes match.</p>
          ) : (
            disponibles.map((n) => {
              const st = nodeStats(n.node_key, data as SearchInput);
              return (
                <button
                  key={n.node_key}
                  type="button"
                  className="bp-pickrow"
                  disabled={busy}
                  onClick={() => onAdd(n.node_key)}
                >
                  <span className="bp-pickrow__name">{n.name}</span>
                  <span className="bp-pickrow__meta">
                    {n.area ?? 'No area'} · {st.steps} step{st.steps === 1 ? '' : 's'} ·{' '}
                    {st.steps === 0 ? '— days' : st.days + ' days'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <p className="bp-legend">
          {yaEstan.length} node{yaEstan.length === 1 ? '' : 's'} already in this funnel {yaEstan.length === 1 ? 'is' : 'are'}{' '}
          not listed. Adding a node here does not remove it from any other funnel.
        </p>
      </div>
    </Modal>
  );
}
