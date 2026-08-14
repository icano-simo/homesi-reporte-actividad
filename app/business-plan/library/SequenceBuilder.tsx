'use client';

import { useState } from 'react';
import { nodeDayRanges, type FunnelNode, type FunnelNodeLink, type NodeMilestone } from '@/lib/business-plan/funnels';

/**
 * ============================================================================
 * CONSTRUCTOR DE SECUENCIA — el "Timeline Builder"
 * ============================================================================
 *
 * Etapa BP12 — ARCHIVO NUEVO.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ UNA LISTA ORDENADA Y NO UN LIENZO
 * ---------------------------------------------------------------------------
 * La interacción es sobre una LISTA: arrastrar desde la biblioteca agrega,
 * arrastrar dentro de la secuencia reordena. No hay coordenadas, ni posiciones
 * libres, ni zoom.
 *
 * Un lienzo con posiciones persistidas tiene sentido cuando el flujo se
 * ramifica. Estos funnels son lineales -- cinco nodos en fila. Un lienzo
 * agregaría estado (x, y por nodo), migración y complejidad sin cambiar NADA de
 * lo que el usuario puede expresar. Si más adelante hacen falta bifurcaciones,
 * se extiende sobre esto.
 *
 * SOBRE LOS BOTONES DE ZOOM del mockup: no están, y es deliberado. Sin un
 * lienzo real no hay nada que acercar -- un botón de zoom que sólo escala el
 * texto promete una manipulación espacial que no existe. En su lugar va lo que
 * sí aporta en una secuencia lineal: el rango de días calculado de cada nodo y
 * la duración total, que es la pregunta que alguien se hace mirando esta
 * pantalla ("¿cuánto dura este funnel?").
 *
 * ---------------------------------------------------------------------------
 * DRAG AND DROP CON LA API NATIVA
 * ---------------------------------------------------------------------------
 * Sin librería. `draggable` + `dragstart` / `dragover` / `drop` de HTML5 alcanza
 * para reordenar una lista, y una dependencia nueva en el bundle del cliente
 * para esto no se justifica -- el repo ya evita ese tipo de dependencias (ver
 * la nota de `components/ui/icons.tsx`).
 *
 * Como la API nativa no es accesible por teclado, cada tarjeta lleva además
 * botones de mover arriba/abajo. No es un adorno: sin eso, reordenar sería
 * imposible sin mouse.
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

  const sequence = links
    .filter((l) => l.funnel_key === funnelKey)
    .sort((a, b) => a.position - b.position)
    .map((l) => l.node_key);

  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const ranges = nodeDayRanges(sequence, milestones);
  const totalDays = ranges.length ? ranges[ranges.length - 1].toDay : 0;

  /** Nodos de la biblioteca que todavía no están en esta secuencia. */
  const available = nodes.filter((n) => !sequence.includes(n.node_key));

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
    setDragging(null);
    setOverIndex(null);
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

  return (
    <div className="bp-builder">
      {/* ── Biblioteca de nodos, a la izquierda ─────────────────────────── */}
      <aside className="bp-builder__library">
        <div className="bp-builder__title">Node library</div>
        {available.length === 0 && <p className="bp-muted-line">Every node is already in this sequence.</p>}
        {available.map((n) => (
          <div
            key={n.node_key}
            className="bp-builder__chip"
            draggable={!busy}
            onDragStart={() => setDragging({ from: 'library', nodeKey: n.node_key })}
            onDragEnd={() => setDragging(null)}
            title={n.description ?? undefined}
          >
            <span className="bp-builder__chip-name">{n.name}</span>
            <button
              type="button"
              className="bp-linkish"
              onClick={() => onChangeSequence([...sequence, n.node_key])}
              disabled={busy}
              /* El botón es la alternativa por teclado al arrastre. */
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
          {/* Lo que reemplaza al zoom: la duración, que es la pregunta real. */}
          <div className="bp-builder__total">
            {sequence.length} nodes · {totalDays} days ≈ {Math.max(1, Math.round(totalDays / 7))} weeks
          </div>
        </div>

        <div className="bp-builder__flow">
          {sequence.length === 0 && (
            <div
              className={'bp-builder__drop' + (overIndex === 0 ? ' is-over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(0);
              }}
              onDrop={() => drop(0)}
            >
              Drag a node here to start the sequence
            </div>
          )}

          {sequence.map((nodeKey, i) => {
            const node = byKey.get(nodeKey);
            const range = ranges[i];
            const count = milestones.filter((m) => m.node_key === nodeKey).length;
            return (
              <div key={nodeKey} className="bp-builder__slot">
                {/* Zona de soltado ANTES de esta tarjeta. */}
                <div
                  className={'bp-builder__gap' + (overIndex === i ? ' is-over' : '')}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverIndex(i);
                  }}
                  onDragLeave={() => setOverIndex(null)}
                  onDrop={() => drop(i)}
                />
                <div
                  className={'bp-builder__card' + (selectedNodeKey === nodeKey ? ' is-selected' : '')}
                  draggable={!busy}
                  onDragStart={() => setDragging({ from: 'sequence', nodeKey })}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => onSelectNode(nodeKey)}
                >
                  {/* El rango se CALCULA de los SLA y la posición: al reordenar
                      se recalcula solo, no hay nada guardado que corregir. */}
                  <div className="bp-builder__day">
                    DAY {range.fromDay}-{range.toDay}
                  </div>
                  <div className="bp-builder__card-name">{node?.name ?? 'unknown node'}</div>
                  <div className="bp-builder__card-sub">{count} milestones</div>
                  <div className="bp-builder__reorder">
                    <button type="button" onClick={(e) => { e.stopPropagation(); move(nodeKey, -1); }} disabled={busy || i === 0} aria-label="Move earlier">
                      ↑
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); move(nodeKey, 1); }} disabled={busy || i === sequence.length - 1} aria-label="Move later">
                      ↓
                    </button>
                  </div>
                </div>
                {i < sequence.length - 1 && <span className="bp-builder__arrow" aria-hidden="true">→</span>}
              </div>
            );
          })}

          {sequence.length > 0 && (
            <div
              className={'bp-builder__gap bp-builder__gap--end' + (overIndex === sequence.length ? ' is-over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(sequence.length);
              }}
              onDragLeave={() => setOverIndex(null)}
              onDrop={() => drop(sequence.length)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
