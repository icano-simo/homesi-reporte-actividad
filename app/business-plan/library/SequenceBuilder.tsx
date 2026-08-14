'use client';

import { useState } from 'react';
import { nodeDayRanges, type FunnelNode, type FunnelNodeLink, type NodeMilestone } from '@/lib/business-plan/funnels';

/**
 * ============================================================================
 * CONSTRUCTOR DE SECUENCIA — el "Timeline Builder"
 * ============================================================================
 *
 * Etapa BP12 — ARCHIVO NUEVO. Etapa BP16 — el arrastre, arreglado.
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
 * lo que el usuario puede expresar.
 *
 * En lugar de los botones de Zoom del mockup va la duración total calculada,
 * que es la pregunta que alguien se hace mirando esta pantalla.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ EL ARRASTRE NO FUNCIONABA (etapa BP16)
 * ---------------------------------------------------------------------------
 * El código de drag está desde BP12 y nunca se quitó. Tenía tres defectos que
 * juntos lo volvían inservible:
 *
 *  1. `onDragStart` no llamaba a `e.dataTransfer.setData()`. Chrome tolera esa
 *     omisión; FIREFOX NO INICIA EL ARRASTRE SIN ELLA. En Firefox la función
 *     simplemente no existía.
 *  2. Las zonas de soltado entre tarjetas medían 10px de ancho. Aun donde el
 *     arrastre arrancaba, acertarles era cuestión de suerte.
 *  3. No había ninguna señal visual de que las tarjetas se pudieran arrastrar.
 *     Sin un asa ni una pista, nadie lo intenta.
 *
 * Ahora: se llama a `setData`, las zonas se ensanchan mientras hay algo en
 * vuelo, y cada tarjeta lleva un asa visible.
 *
 * Los botones de flecha se QUEDAN. La API nativa de arrastre no es accesible
 * por teclado, así que son la única vía sin mouse -- no son un reemplazo del
 * arrastre sino su complemento.
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
  const available = nodes.filter((n) => !sequence.includes(n.node_key));

  /**
   * Arranca un arrastre.
   *
   * `dataTransfer.setData` es OBLIGATORIO: sin al menos un dato asociado,
   * Firefox no considera que haya empezado un arrastre y no dispara ningún
   * `dragover` ni `drop`. El payload real viaja en el estado de React -- esto
   * es sólo para que el navegador acepte iniciar la operación.
   */
  function startDrag(e: React.DragEvent, from: 'library' | 'sequence', nodeKey: number) {
    e.dataTransfer.setData('text/plain', String(nodeKey));
    e.dataTransfer.effectAllowed = 'move';
    setDragging({ from, nodeKey });
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

  /** Props comunes de una zona de soltado. */
  const dropZone = (index: number) => ({
    className:
      'bp-builder__gap' + (dragging ? ' is-armed' : '') + (overIndex === index ? ' is-over' : ''),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault(); // sin esto el navegador rechaza el drop
      e.dataTransfer.dropEffect = 'move';
      setOverIndex(index);
    },
    onDragLeave: () => setOverIndex((cur) => (cur === index ? null : cur)),
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
            onDragEnd={() => {
              setDragging(null);
              setOverIndex(null);
            }}
            title={n.description ?? undefined}
          >
            {/* Asa visible: sin ella nadie descubre que se puede arrastrar. */}
            <span className="bp-grip" aria-hidden="true">
              ⠿
            </span>
            <span className="bp-builder__chip-name">{n.name}</span>
            <button
              type="button"
              className="bp-linkish"
              onClick={() => onChangeSequence([...sequence, n.node_key])}
              disabled={busy}
              /* La vía por teclado: la API nativa de arrastre no la tiene. */
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

        <div className={'bp-builder__flow' + (dragging ? ' is-dragging' : '')}>
          {sequence.length === 0 && (
            /* El `className` viene del propio `dropZone`; sobrescribirlo acá
               dejaba fuera el estado `is-armed`. */
            <div {...dropZone(0)} className={'bp-builder__drop' + (overIndex === 0 ? ' is-over' : '')}>
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
                <div {...dropZone(i)} />
                <div
                  className={
                    'bp-builder__card' +
                    (selectedNodeKey === nodeKey ? ' is-selected' : '') +
                    (dragging?.nodeKey === nodeKey ? ' is-dragging' : '')
                  }
                  draggable={!busy}
                  onDragStart={(e) => startDrag(e, 'sequence', nodeKey)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOverIndex(null);
                  }}
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
                  <div className="bp-builder__card-sub">{count} milestones</div>
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
                  </div>
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
