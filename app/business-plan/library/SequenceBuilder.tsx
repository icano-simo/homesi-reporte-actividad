'use client';

import { useMemo, useState } from 'react';
import { nodeDayRanges, type FunnelNode, type FunnelNodeLink, type NodeMilestone } from '@/lib/business-plan/funnels';
import { CloseIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * CONSTRUCTOR DE SECUENCIA — el "Timeline Builder"
 * ============================================================================
 *
 * Etapa BP12 — ARCHIVO NUEVO. BP16 — arreglo del arrastre. BP18 — rendimiento
 * y el botón de quitar.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ UNA LISTA ORDENADA Y NO UN LIENZO
 * ---------------------------------------------------------------------------
 * Arrastrar desde la biblioteca AGREGA; arrastrar dentro REORDENA. No hay
 * coordenadas, ni posiciones libres, ni zoom: estos funnels son lineales y un
 * lienzo agregaría estado (x, y por nodo) sin cambiar nada de lo que el usuario
 * puede expresar. En lugar de los botones de Zoom del mockup va la duración
 * total calculada.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ EL ARRASTRE SE SENTÍA PESADO (etapa BP18)
 * ---------------------------------------------------------------------------
 * `dragover` se dispara decenas de veces por segundo, y cada disparo terminaba
 * re-renderizando TODO el componente. Dos causas, las dos reales:
 *
 *  1. NADA ESTABA MEMOIZADO. En cada render se recalculaban `sequence` (filter
 *     + sort + map sobre los vínculos), `byKey` (un Map nuevo sobre los 18
 *     nodos), `available` (otro filter) y sobre todo `nodeDayRanges`, que
 *     recorre los 48 milestones una vez por nodo. Todo eso, decenas de veces
 *     por segundo, durante el arrastre.
 *
 *  2. `onDragLeave` HACÍA OSCILAR EL ESTADO. Al mover el puntero dentro de una
 *     misma zona, `dragleave` y `dragover` se alternan al cruzar los bordes de
 *     los hijos: `overIndex` iba índice → null → índice → null. React no puede
 *     descartar esos cambios porque el valor SÍ cambia, así que cada oscilación
 *     era un render completo con las cuatro recomputaciones de arriba.
 *
 * Ahora los cuatro derivados van en `useMemo` y la zona activa se limpia sólo
 * al soltar o al terminar el arrastre. Mover el puntero dentro de una zona ya
 * no cambia nada, y React descarta el `setOverIndex` repetido por sí solo.
 *
 * ---------------------------------------------------------------------------
 * QUITAR NO SE HACE ARRASTRANDO
 * ---------------------------------------------------------------------------
 * Sacar un elemento arrastrándolo fuera del contenedor es un patrón poco
 * confiable: no hay un destino visible, el navegador no da señal de dónde
 * termina el gesto, y nadie lo descubre solo. Cada tarjeta lleva un botón de
 * quitar, con confirmación si el nodo tiene pasos.
 *
 * Las flechas se quedan: la API nativa de arrastre no es accesible por teclado.
 */

interface Props {
  funnelKey: number;
  nodes: FunnelNode[];
  links: FunnelNodeLink[];
  milestones: NodeMilestone[];
  selectedNodeKey: number | null;
  onSelectNode: (nodeKey: number) => void;
  onChangeSequence: (orderedNodeKeys: number[]) => void;
  busy: boolean;
}

export default function SequenceBuilder({
  funnelKey,
  nodes,
  links,
  milestones,
  selectedNodeKey,
  onSelectNode,
  onChangeSequence,
  busy,
}: Props) {
  const [dragging, setDragging] = useState<{ from: 'library' | 'sequence'; nodeKey: number } | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  /*
   * Los cuatro derivados, memoizados. Sin esto se recalculaban en CADA
   * `dragover` -- ver la nota de rendimiento del encabezado.
   */
  const sequence = useMemo(
    () =>
      links
        .filter((l) => l.funnel_key === funnelKey)
        .sort((a, b) => a.position - b.position)
        .map((l) => l.node_key),
    [links, funnelKey]
  );
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.node_key, n])), [nodes]);
  const ranges = useMemo(() => nodeDayRanges(sequence, milestones), [sequence, milestones]);
  const available = useMemo(() => nodes.filter((n) => !sequence.includes(n.node_key)), [nodes, sequence]);
  const stepsOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const ms of milestones) m.set(ms.node_key, (m.get(ms.node_key) ?? 0) + 1);
    return m;
  }, [milestones]);

  const totalDays = ranges.length ? ranges[ranges.length - 1].toDay : 0;

  /**
   * Arranca un arrastre.
   *
   * `dataTransfer.setData` es OBLIGATORIO: sin al menos un dato asociado,
   * Firefox no considera que haya empezado un arrastre y no dispara ningún
   * `dragover` ni `drop`. El payload real viaja en el estado de React.
   */
  function startDrag(e: React.DragEvent, from: 'library' | 'sequence', nodeKey: number) {
    e.dataTransfer.setData('text/plain', String(nodeKey));
    e.dataTransfer.effectAllowed = 'move';
    setDragging({ from, nodeKey });
  }

  function endDrag() {
    setDragging(null);
    setOverIndex(null);
  }

  function drop(atIndex: number) {
    if (!dragging || busy) return;
    const next = [...sequence];
    if (dragging.from === 'sequence') {
      const from = next.indexOf(dragging.nodeKey);
      if (from === -1) return;
      next.splice(from, 1);
      next.splice(from < atIndex ? atIndex - 1 : atIndex, 0, dragging.nodeKey);
    } else {
      if (next.includes(dragging.nodeKey)) return;
      next.splice(atIndex, 0, dragging.nodeKey);
    }
    endDrag();
    onChangeSequence(next);
  }

  function move(nodeKey: number, delta: number) {
    const next = [...sequence];
    const i = next.indexOf(nodeKey);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChangeSequence(next);
  }

  function remove(nodeKey: number) {
    setConfirmRemove(null);
    onChangeSequence(sequence.filter((k) => k !== nodeKey));
  }

  /**
   * Props de una zona de soltado.
   *
   * SIN `onDragLeave`: era lo que hacía oscilar `overIndex` al cruzar los
   * bordes de los hijos. La zona activa se limpia al soltar o al terminar el
   * arrastre, que son los dos momentos en que realmente deja de haber una.
   */
  const dropZone = (index: number) => ({
    className: 'bp-builder__gap' + (dragging ? ' is-armed' : '') + (overIndex === index ? ' is-over' : ''),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault(); // sin esto el navegador rechaza el drop
      e.dataTransfer.dropEffect = 'move';
      /* React descarta el set si el valor no cambió, así que mover el puntero
         dentro de la misma zona no produce ningún render. */
      setOverIndex(index);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      drop(index);
    },
  });

  return (
    <div className="bp-builder">
      {/* ── Biblioteca de nodos, a la izquierda ─────────────────────────── */}
      <aside className="bp-builder__library">
        <div className="bp-builder__title">Node library</div>
        <p className="bp-builder__howto">Drag a node into the sequence, or use “add”.</p>
        {available.length === 0 && <p className="bp-muted-line">Every node is already in this sequence.</p>}
        {available.map((n) => (
          <div
            key={n.node_key}
            className={'bp-builder__chip' + (dragging?.nodeKey === n.node_key ? ' is-dragging' : '')}
            draggable={!busy}
            onDragStart={(e) => startDrag(e, 'library', n.node_key)}
            onDragEnd={endDrag}
            title={n.description ?? undefined}
          >
            <span className="bp-grip" aria-hidden="true">
              ⠿
            </span>
            <span className="bp-builder__chip-name">{n.name}</span>
            <button
              type="button"
              className="bp-linkish"
              onClick={() => onChangeSequence([...sequence, n.node_key])}
              disabled={busy}
              title="Add to the end of the sequence"
            >
              add
            </button>
          </div>
        ))}
      </aside>

      {/* ── La secuencia ────────────────────────────────────────────────── */}
      <div className="bp-builder__canvas">
        <div className="bp-builder__head">
          <div className="bp-builder__title">Sequence</div>
          <div className="bp-builder__total">
            {sequence.length} nodes · {totalDays} days ≈ {Math.max(1, Math.round(totalDays / 7))} weeks
          </div>
        </div>

        <div className={'bp-builder__flow' + (dragging ? ' is-dragging' : '')}>
          {sequence.length === 0 && (
            <div {...dropZone(0)} className={'bp-builder__drop' + (overIndex === 0 ? ' is-over' : '')}>
              Drag a node here to start the sequence
            </div>
          )}

          {sequence.map((nodeKey, i) => {
            const node = byKey.get(nodeKey);
            const range = ranges[i];
            const count = stepsOf.get(nodeKey) ?? 0;
            return (
              <div key={nodeKey} className="bp-builder__slot">
                <div {...dropZone(i)} />
                <div
                  className={
                    'bp-builder__card' +
                    (selectedNodeKey === nodeKey ? ' is-selected' : '') +
                    (dragging?.nodeKey === nodeKey ? ' is-dragging' : '')
                  }
                  draggable={!busy}
                  onDragStart={(e) => startDrag(e, 'sequence', nodeKey)}
                  onDragEnd={endDrag}
                  onClick={() => onSelectNode(nodeKey)}
                >
                  <span className="bp-grip bp-grip--card" aria-hidden="true">
                    ⠿
                  </span>
                  {/* El rango se CALCULA de los SLA y la posición: al reordenar
                      se recalcula solo, no hay nada guardado que corregir. */}
                  <div className="bp-builder__day">
                    DAY {range.fromDay}-{range.toDay}
                  </div>
                  <div className="bp-builder__card-name">{node?.name ?? 'unknown node'}</div>
                  <div className="bp-builder__card-sub">{count} stages</div>

                  <div className="bp-builder__reorder">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        move(nodeKey, -1);
                      }}
                      disabled={busy || i === 0}
                      aria-label="Move earlier"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        move(nodeKey, 1);
                      }}
                      disabled={busy || i === sequence.length - 1}
                      aria-label="Move later"
                    >
                      ↓
                    </button>
                    {/*
                      Quitar con un botón, no arrastrando fuera: arrastrar fuera
                      no tiene destino visible y nadie lo descubre solo.
                    */}
                    <button
                      type="button"
                      className="bp-builder__remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        /* Confirmación sólo si hay pasos que se van con él.
                           Un nodo vacío no vale una pregunta. */
                        if (count > 0) setConfirmRemove(nodeKey);
                        else remove(nodeKey);
                      }}
                      disabled={busy}
                      aria-label="Remove from this funnel"
                      title="Remove from this funnel"
                    >
                      <CloseIcon size={11} />
                    </button>
                  </div>

                  {confirmRemove === nodeKey && (
                    <div className="bp-builder__confirm" onClick={(e) => e.stopPropagation()}>
                      <p>
                        Remove <strong>{node?.name}</strong> from this funnel? Its {count} stages go with it.
                      </p>
                      <p className="bp-builder__confirm-note">The node stays in the library.</p>
                      <div className="bp-builder__confirm-actions">
                        <button type="button" className="bp-btn bp-btn--small bp-btn--primary" onClick={() => remove(nodeKey)}>
                          Remove
                        </button>
                        <button type="button" className="bp-linkish" onClick={() => setConfirmRemove(null)}>
                          cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {i < sequence.length - 1 && (
                  <span className="bp-builder__arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </div>
            );
          })}

          {sequence.length > 0 && <div {...dropZone(sequence.length)} />}
        </div>
      </div>
    </div>
  );
}
