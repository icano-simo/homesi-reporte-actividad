'use client';

import { useState, type MouseEvent } from 'react';
import { shortMonth } from '@/lib/business-plan/months';
import type { CommercialActivityMonthlyRow } from '@/lib/aggregation/commercialActivityTrends';

/**
 * ============================================================================
 * GRÁFICO DE 3 SERIES — File Creations / Credit Reports / Applications
 * ============================================================================
 *
 * Componente NUEVO e independiente -- no toca `AvgTicketChart`
 * (app/pipeline/TabAnalytics.tsx, usado por Closing) ni ningún archivo de
 * Closing. Se evaluó reusar ese componente tal cual y no aplica: es de UNA
 * serie, con una escala de dominio recortada al rango real (pensada para
 * montos de ticket promedio, donde 0 es un centinela de "sin dato") -- acá
 * las 3 series son CONTEOS, donde 0 es un valor real y legítimo (un mes sin
 * ninguna File Creation existe de verdad), así que la escala correcta es
 * 0-based, al revés de esa otra.
 *
 * `shortMonth` se importa de `lib/business-plan/months.ts` -- ya exportado
 * y compartido (no vive en ningún archivo de Closing) -- en vez de duplicar
 * la función local no-exportada de TabAnalytics.tsx. `CHART_LABEL_RESERVE`
 * de ese archivo tampoco está exportado, así que acá se declara su propia
 * constante local con el mismo valor (18), sin importar nada de Closing.
 *
 * Colores: 3 tokens YA existentes en tokens.css (`--navy`, `--emerald-700`,
 * `--amber-700`) -- mismo criterio de "cero hex nuevo" que ya sigue el resto
 * de la app -- elegidos localmente acá porque el mapeo serie-color de
 * Closing (`STRATEGY_COLORS`, TabAnalytics.tsx) tampoco está exportado.
 *
 * Etapa PULIDO-1: eje Y con ticks reales + crosshair/tooltip único al pasar
 * el mouse. Revisado ANTES de escribir: no hay ningún chart en el repo
 * (Closing incluido -- `AvgTicketChart`, `SimpleMonthlyChart`,
 * `TypeBreakdownChart`) que ya tenga un eje Y con valores ni un patrón de
 * crosshair/tooltip -- todos usan `<title>` nativo de SVG, un tooltip por
 * punto, nunca uno solo con varias series a la vez. Se escribe nuevo acá,
 * archivo propio, sin tocar ninguno de esos.
 */

const LABEL_RESERVE = 18;

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

interface Series {
  key: keyof Pick<CommercialActivityMonthlyRow, 'fileCreations' | 'creditReports' | 'applications'>;
  label: string;
  color: string;
}

const SERIES: Series[] = [
  { key: 'fileCreations', label: 'File Creations', color: 'var(--navy)' },
  { key: 'creditReports', label: 'Credit Reports', color: 'var(--emerald-700)' },
  { key: 'applications', label: 'Applications', color: 'var(--amber-700)' },
];

/**
 * Etiqueta de tick del eje X: el año sólo en el primer tick y cada vez que
 * cambia respecto del anterior -- nunca repetido en cada mes, pero nunca
 * ausente por más de 11 ticks seguidos (el rango real hoy cruza 2024/2025/
 * 2026). No hay ninguna función ya escrita en el repo para este caso --
 * revisado antes de escribirla: todo lo demás que usa `shortMonth` (Business
 * Plan, Outlook) dibuja los 12 meses de UN año fijo (`monthsOfYear`), nunca
 * un eje continuo que cruce años, así que ninguno necesitó nunca distinguir
 * "primer tick o cambio de año" de "mismo año que el tick anterior".
 */
function tickLabel(rows: CommercialActivityMonthlyRow[], i: number): string {
  const month = shortMonth(rows[i].month);
  const year = rows[i].month.slice(0, 4);
  const isFirstOrYearChange = i === 0 || rows[i - 1].month.slice(0, 4) !== year;
  return isFirstOrYearChange ? month + ' ' + year : month;
}

/**
 * Ticks "redondos" del eje Y (algoritmo clásico 1/2/5×10^n, escrito acá --
 * no existe ninguna versión compartida en el repo). Siempre incluye 0 y
 * termina en un múltiplo exacto del paso, que pasa a ser el DOMINIO real del
 * gráfico (`domainMax`, más abajo) -- así el tick de arriba coincide con el
 * borde del plot en vez de quedar flotando por encima del punto más alto.
 */
function niceTicks(maxValue: number, targetCount: number): number[] {
  if (maxValue <= 0) return [0];
  const rawStep = maxValue / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  /*
   * El último tick tiene que ser >= maxValue -- si no, un punto real queda
   * por encima del plot (verificado en pantalla: con max real 467 y este
   * bug, el tick de arriba quedaba en 400 y el punto de Sep 2026 se
   * renderizaba 18px arriba del área del gráfico, fuera de la vista).
   * `Math.ceil` en vez de iterar con un epsilon garantiza cubrir el máximo
   * sin importar dónde caiga dentro del último escalón.
   */
  const niceMax = Math.ceil(maxValue / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + niceStep * 0.001; v += niceStep) ticks.push(Math.round(v));
  return ticks;
}

export interface CommercialActivityLineChartProps {
  rows: CommercialActivityMonthlyRow[];
}

export default function CommercialActivityLineChart({ rows }: CommercialActivityLineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plotHeight = 110;
  const bottomReserve = 18;
  const rightPad = 8;
  /* Espacio para las etiquetas del eje Y ("1,000", etc.) a la izquierda del plot. */
  const leftPad = 40;
  /*
   * Ancho por mes fijo (40px) en vez de un `width` total fijo -- medido:
   * con 21 meses en 640px (el paso viejo, ~31px) los ticks con año
   * ("Nov 2024", "Mar 2025", "Jan 2026", ~50px de ancho) se solapaban 2-4px
   * contra el tick vecino. 40px por mes deja margen (mitad-larga 25px +
   * mitad-corta 10px = 35px < 40px) sin importar cuántos meses tenga el
   * rango -- que sólo va a crecer, un mes por vez. El contenedor ya tenía
   * `overflow-x: auto` (más abajo), así que un ancho mayor que el viewport
   * ya se resolvía con scroll, no con un rediseño.
   */
  const width = Math.max(640, leftPad + rightPad + Math.max(0, rows.length - 1) * 40);
  const innerWidth = width - leftPad - rightPad;
  const step = rows.length > 1 ? innerWidth / (rows.length - 1) : 0;

  const rawMax = Math.max(1, ...rows.flatMap((r) => SERIES.map((s) => r[s.key])));
  const yTicks = niceTicks(rawMax, 4);
  const domainMax = yTicks[yTicks.length - 1];

  function x(i: number): number {
    return leftPad + i * step;
  }
  function y(value: number): number {
    return plotHeight - (value / domainMax) * plotHeight;
  }

  /* Índice del mes más cercano al mouse, por posición X -- mismo `step` que ya ubica los puntos, sin recalcular nada aparte. */
  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    if (rows.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = width / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    const idx = step > 0 ? Math.round((localX - leftPad) / step) : 0;
    setHoverIndex(Math.max(0, Math.min(rows.length - 1, idx)));
  }

  const hovered = hoverIndex !== null ? rows[hoverIndex] : null;
  /*
   * El tooltip va a un COSTADO del crosshair, nunca centrado sobre él --
   * si no, tapa el tramo de línea discontinua justo donde pasa por los 3
   * puntos de esa fecha, que es lo que el crosshair existe para mostrar.
   * El lado se elige por el espacio real disponible a cada lado dentro del
   * plot (no un umbral fijo): así se invierte solo cerca de CUALQUIERA de
   * los dos bordes, sin necesidad de conocer el ancho exacto del tooltip
   * (que depende del contenido -- `white-space: nowrap` con 3 líneas de
   * ancho variable).
   */
  const crosshairX = hoverIndex !== null ? x(hoverIndex) : 0;
  const spaceRight = width - rightPad - crosshairX;
  const spaceLeft = crosshairX - leftPad;
  const placeLeft = spaceRight < spaceLeft;
  const tooltipGap = 10;

  return (
    <div className="trend-chart">
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg
          width={width}
          height={LABEL_RESERVE + plotHeight + bottomReserve}
          viewBox={`0 0 ${width} ${LABEL_RESERVE + plotHeight + bottomReserve}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <g transform={`translate(0 ${LABEL_RESERVE})`}>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={leftPad} x2={width - rightPad} y1={y(t)} y2={y(t)} stroke="var(--slate-100)" strokeWidth={1} />
                <text x={leftPad - 6} y={y(t) + 3} textAnchor="end" fontSize="9.5" fill="var(--slate-500)">
                  {fmtInt(t)}
                </text>
              </g>
            ))}
            {SERIES.map((series) => {
              const points = rows.map((r, i) => `${x(i)},${y(r[series.key])}`).join(' ');
              return <polyline key={series.key} points={points} fill="none" stroke={series.color} strokeWidth={2} />;
            })}
            {SERIES.map((series) =>
              rows.map((r, i) => (
                <circle
                  key={series.key + r.month}
                  cx={x(i)}
                  cy={y(r[series.key])}
                  r={hoverIndex === i ? 4.5 : 3}
                  fill={series.color}
                />
              ))
            )}
            {rows.map((r, i) => (
              <text key={r.month} x={x(i)} y={plotHeight + 14} textAnchor="middle" fontSize="10.5" fill="var(--slate-500)">
                {tickLabel(rows, i)}
              </text>
            ))}
            {/* Crosshair -- solo mientras hay un mes hover, encima de todo lo demás. */}
            {hoverIndex !== null && (
              <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={0} y2={plotHeight} stroke="var(--slate-400)" strokeWidth={1} strokeDasharray="3 3" />
            )}
          </g>
        </svg>

        {/*
          Tooltip único con las 3 series del mes hover -- no uno por serie
          (mismo criterio que pidió la tarea). Vive en el mismo contenedor
          con scroll que el SVG, `position: absolute` alineado al mismo
          sistema de coordenadas (`x(hoverIndex)` es px reales, 1 unidad de
          SVG = 1px acá, sin transform de escala) -- complementa la tabla de
          abajo, no la reemplaza: mismos 3 números, mismo mes, otra forma de
          leerlos mientras se mira el gráfico.
        */}
        {hovered && (
          <div
            style={{
              position: 'absolute',
              left: crosshairX + (placeLeft ? -tooltipGap : tooltipGap) + 'px',
              top: LABEL_RESERVE + plotHeight / 2 + 'px',
              transform: placeLeft ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
              background: 'var(--navy)',
              color: '#fff',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontSize: '11px',
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: 'var(--shadow-sm)',
              zIndex: 1,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '2px' }}>
              {shortMonth(hovered.month)} {hovered.month.slice(0, 4)}
            </div>
            {SERIES.map((series) => (
              <div key={series.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                {/*
                  Anillo claro PROPIO de este punto, distinto del de los
                  puntos sobre el fondo claro del gráfico (los `<circle>` del
                  SVG y los de la leyenda de abajo no llevan ninguno -- ahí
                  el fondo claro ya alcanza para el contraste). Acá el fondo
                  es `--navy`, así que `--navy` (File Creations) sin anillo
                  se perdería contra el fondo del tooltip.
                */}
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: series.color,
                    display: 'inline-block',
                    boxShadow: '0 0 0 1.5px rgba(255, 255, 255, 0.55)',
                  }}
                />
                {series.label}: {fmtInt(hovered[series.key])}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
        {SERIES.map((series) => (
          <div key={series.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--slate-500)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: series.color, display: 'inline-block' }} />
            {series.label}
          </div>
        ))}
      </div>
    </div>
  );
}
