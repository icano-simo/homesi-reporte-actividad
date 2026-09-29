'use client';

import { useState } from 'react';
import type { YearMonth } from '@/lib/parsing/types';
import { MONTH_NAMES } from '@/config/metrics';

export interface StackedMonthDatum {
  month: YearMonth;
  a: number;
  b: number;
}

export interface MonthlyStackedChartProps {
  data: StackedMonthDatum[];
  highlightMonths: Set<YearMonth>;
  colorA: string;
  colorB: string;
  textColorA: string;
  textColorB: string;
  labelA: string;
  labelB: string;
  /** Formatea un valor de segmento para el tooltip Y la etiqueta dentro de la barra -- mismo valor, mismo formato en los 2 lugares. */
  formatValue: (n: number) => string;
  height?: number;
  onSegmentClick?: (month: YearMonth, segment: 'a' | 'b') => void;
}

/** 'YYYY-MM' -> 'Jan' -- mismo criterio que `shortMonth` de TabAnalytics.tsx, sin duplicar el import de `MONTH_NAMES`. */
function shortMonth(ym: YearMonth): string {
  const m = Number(ym.slice(5, 7));
  return MONTH_NAMES[Number(m) - 1].slice(0, 3);
}

/** 'YYYY-MM' -> 'Jan 2026' -- para el encabezado del tooltip. */
function monthYearLabel(ym: YearMonth): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`;
}

/** Mismo piso visual que `MIN_SEGMENT_HEIGHT_PX`/`allocateSegmentHeights` de TabAnalytics.tsx (Etapa BI-REDESIGN-1) -- un segmento no nulo por debajo de este alto queda consumido por el `box-shadow` inset de 1px que separa segmentos contiguos (`.trend-seg`, forecast-visual.css). Versión de 2 segmentos: a lo sumo UNO de los 2 puede quedar por debajo del piso a la vez sin que el otro también lo esté (con 2 segmentos, "ambos angostos" sólo pasa si el total ya es minúsculo). */
const MIN_SEGMENT_HEIGHT_PX = 5;
/** Mismo criterio que `MIN_SEGMENT_LABEL_HEIGHT` de TabAnalytics.tsx -- por debajo de esto se omite la etiqueta numérica DENTRO del segmento. Ya no es "se pierde": ver `TOP_LABEL_RESERVE`, más abajo, que es lo que reemplaza al `<title>` nativo como respaldo. */
const MIN_SEGMENT_LABEL_HEIGHT = 16;
/**
 * Etapa ACTIVITY-CHART-FIX-1 -- BUG encontrado en pantalla real: en los 9
 * meses con datos, CTC→Disb (1.6-3.3 días) nunca llegó a los 16px de
 * `MIN_SEGMENT_LABEL_HEIGHT` al lado de App→CTC (19.7-24.7 días) en un
 * chart de 130px -- su `<span className="trend-seg__label">` JAMÁS se
 * llegó a crear, en NINGÚN mes, no en un caso raro. No era un problema de
 * color/opacidad/recorte -- confirmado leyendo el DOM real: el segmento se
 * pintaba bien, el `<span>` simplemente no existía.
 *
 * El piso de 16px es correcto y no se toca (existe para que un número no
 * quede ilegible apretado en 3px) -- lo que faltaba era un lugar para el
 * valor cuando el segmento es angosto A PROPÓSITO (App→CTC y CTC→Disb no
 * son del mismo orden de magnitud casi nunca, a diferencia de Loan Type en
 * TypeBreakdownChart, donde los tipos SÍ pueden ser comparables). Se
 * reserva una franja fija arriba de cada barra (mismo mecanismo que
 * `CHART_LABEL_RESERVE` de `SimpleMonthlyChart`, TabAnalytics.tsx) y el
 * segmento que no entra adentro muestra su valor ahí -- con un punto del
 * color del segmento (mismo lenguaje visual que `.trend-legend`) en vez de
 * texto coloreado: medido, `colorA` (#699ADE) como texto sobre un fondo
 * blanco da 2.88:1 de contraste -- no pasa AA (necesita 4.5:1) -- por eso
 * el texto va en `--slate-500` (ya usado por
 * `.trend-chart__value` para el mismo propósito) y el color vive sólo en
 * el punto.
 */
const TOP_LABEL_RESERVE = 14;

function allocateTwoSegmentHeights(a: number, b: number, stackPx: number): [number, number] {
  const total = a + b;
  if (total <= 0) return [0, 0];
  const naturalA = (a / total) * stackPx;
  const naturalB = (b / total) * stackPx;
  const belowA = a > 0 && naturalA < MIN_SEGMENT_HEIGHT_PX;
  const belowB = b > 0 && naturalB < MIN_SEGMENT_HEIGHT_PX;
  if (!belowA && !belowB) return [naturalA, naturalB];
  if (belowA && belowB) {
    const each = Math.min(MIN_SEGMENT_HEIGHT_PX, stackPx / 2);
    return [each, each];
  }
  const remaining = Math.max(0, stackPx - MIN_SEGMENT_HEIGHT_PX);
  return belowA ? [MIN_SEGMENT_HEIGHT_PX, remaining] : [remaining, MIN_SEGMENT_HEIGHT_PX];
}

/**
 * ============================================================================
 * BARRA APILADA POR MES, 2 SEGMENTOS — Etapa ACTIVITY-KPI-1
 * ============================================================================
 *
 * Mismo patrón que `TypeBreakdownChart`/`SimpleMonthlyChart`
 * (TabAnalytics.tsx) -- `<div>` apilados con `column-reverse`, no SVG (a
 * diferencia de la dona/el mapa de esa misma pantalla, que sí son SVG a
 * mano): un stack de sólo 2 segmentos siempre fijos (nunca variable como
 * Loan Type) no necesita la generalidad de un `<path>`.
 *
 * `data` trae exactamente los meses a dibujar, en el orden a dibujar --
 * el caller decide si son los 12 del año (modo 'current', con 0 explícito
 * en los meses sin dato) o sólo los de `monthsToShow` (modos 'last3'/
 * 'pick'). Este componente no sabe nada del filtro, sólo dibuja lo que
 * recibe -- mismo desacople que ya usan `SimpleMonthlyChart`/
 * `TypeBreakdownChart` respecto de `period`.
 *
 * `highlightMonths` resalta SIN filtrar la serie -- mismo mecanismo
 * (`.trend-chart__col--highlight`) que el resto de Monthly Trends. Es un
 * concepto DISTINTO del hover de abajo: el highlight marca "este mes
 * coincide con el filtro Year/Month activo" (persistente mientras ese
 * filtro esté puesto), el hover marca "el mouse está acá" (transitorio) --
 * un mes puede tener las 2 marcas a la vez, o sólo una.
 *
 * Etapa ACTIVITY-CHART-HOVER-1 -- tooltip + foco al pasar el mouse.
 * Revisado antes de escribir: no existe ningún tooltip/crosshair
 * reusable en el repo -- `CommercialActivityLineChart.tsx` (Etapa
 * PULIDO-1) tiene el único precedente (crosshair + un tooltip único con
 * varias series), pero es un componente default-export no reutilizable,
 * con matemática de mouse-a-coordenada-SVG que no aplica acá (estos
 * segmentos son `<div>`, no puntos en un `<svg>`) -- se replica el
 * PATRÓN visual (fondo `--navy`, texto `--white`, sin flecha, una sola
 * tarjeta con las 2 series), no el componente.
 */
export default function MonthlyStackedChart({
  data,
  highlightMonths,
  colorA,
  colorB,
  textColorA,
  textColorB,
  labelA,
  labelB,
  formatValue,
  height = 130,
  onSegmentClick,
}: MonthlyStackedChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<YearMonth | null>(null);
  const totals = data.map((d) => d.a + d.b);
  const max = Math.max(1, ...totals);

  return (
    <div className="trend-chart">
      <div className="trend-chart__plot" style={{ height: height + TOP_LABEL_RESERVE + 'px' }}>
        {data.map((d, i) => {
          const total = totals[i];
          const isHighlighted = highlightMonths.has(d.month);
          const isHovered = hoveredMonth === d.month;
          const isDimmed = hoveredMonth !== null && !isHovered;
          const stackPx = Math.max(1, (total / max) * height);
          const [heightA, heightB] = allocateTwoSegmentHeights(d.a, d.b, stackPx);
          const fitsA = heightA >= MIN_SEGMENT_LABEL_HEIGHT;
          const fitsB = heightB >= MIN_SEGMENT_LABEL_HEIGHT;
          return (
            <div
              key={d.month}
              className={'trend-chart__col' + (isHighlighted ? ' trend-chart__col--highlight' : '')}
              style={{ ['--bar-i' as string]: i, position: 'relative', opacity: isDimmed ? 0.35 : 1, transition: 'opacity 0.12s ease' }}
              onMouseEnter={() => setHoveredMonth(d.month)}
              onMouseLeave={() => setHoveredMonth(null)}
            >
              {/*
                Franja de respaldo para el valor que no entra DENTRO del
                segmento (ver el comentario largo de `TOP_LABEL_RESERVE`) --
                altura fija en los 12 meses (incluidos los vacíos), para que
                la base de las barras quede alineada igual que antes.
              */}
              <div style={{ height: TOP_LABEL_RESERVE + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                {d.a > 0 && !fitsA && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: 'var(--slate-500)' }}>
                    <i style={{ width: '6px', height: '6px', borderRadius: '50%', background: colorA, display: 'inline-block' }} />
                    {formatValue(d.a)}
                  </span>
                )}
                {d.b > 0 && !fitsB && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: 'var(--slate-500)' }}>
                    <i style={{ width: '6px', height: '6px', borderRadius: '50%', background: colorB, display: 'inline-block' }} />
                    {formatValue(d.b)}
                  </span>
                )}
              </div>
              <div
                className="trend-chart__stack"
                style={{ display: 'flex', flexDirection: 'column-reverse', width: '100%', height: stackPx + 'px' }}
              >
                {d.a > 0 && (
                  <div
                    className="trend-seg"
                    style={{ height: heightA + 'px', background: colorA, cursor: onSegmentClick ? 'pointer' : undefined }}
                    onClick={onSegmentClick ? () => onSegmentClick(d.month, 'a') : undefined}
                  >
                    {fitsA && (
                      <span className="trend-seg__label" style={{ color: textColorA }}>
                        {formatValue(d.a)}
                      </span>
                    )}
                  </div>
                )}
                {d.b > 0 && (
                  <div
                    className="trend-seg"
                    style={{ height: heightB + 'px', background: colorB, cursor: onSegmentClick ? 'pointer' : undefined }}
                    onClick={onSegmentClick ? () => onSegmentClick(d.month, 'b') : undefined}
                  >
                    {fitsB && (
                      <span className="trend-seg__label" style={{ color: textColorB }}>
                        {formatValue(d.b)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {/*
                Tooltip único con las 2 series del mes hover -- mismo
                lenguaje visual que `CommercialActivityLineChart.tsx`
                (fondo `--navy`, texto `--white`, `pointerEvents: none`),
                posicionado con CSS puro relativo a ESTA columna (sin
                matemática de mouse-a-px: acá cada mes ya es su propio
                elemento, a diferencia del SVG de esa otra pantalla).
                Reemplaza el `<title>` nativo que tenían los segmentos --
                mismo dato, una sola tarjeta con las 2 series en vez de un
                tooltip nativo por segmento.
              */}
              {isHovered && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translate(-50%, -6px)',
                    background: 'var(--navy)',
                    color: 'var(--white)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    fontSize: '11px',
                    lineHeight: 1.5,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    boxShadow: 'var(--shadow-sm)',
                    zIndex: 2,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '2px' }}>{monthYearLabel(d.month)}</div>
                  {total === 0 ? (
                    <div>No data yet</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: colorA,
                            display: 'inline-block',
                            boxShadow: '0 0 0 1.5px rgba(255, 255, 255, 0.55)',
                          }}
                        />
                        {labelA}: {formatValue(d.a)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: colorB,
                            display: 'inline-block',
                            boxShadow: '0 0 0 1.5px rgba(255, 255, 255, 0.55)',
                          }}
                        />
                        {labelB}: {formatValue(d.b)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="trend-chart__axis">
        {data.map((d) => (
          <div key={d.month} className="trend-chart__tick">
            {shortMonth(d.month)}
          </div>
        ))}
      </div>
      <div className="trend-legend">
        <span>
          <i className="trend-legend__dot" style={{ background: colorA }} />
          {labelA}
        </span>
        <span>
          <i className="trend-legend__dot" style={{ background: colorB }} />
          {labelB}
        </span>
      </div>
    </div>
  );
}
