'use client';

import { apportionByWeight } from '@/lib/pipeline/aggregate';
import { shortMonth } from '@/lib/business-plan/months';
import type { CurrentMonthProjection } from '@/lib/business-plan/types';

/**
 * ============================================================================
 * GRÁFICO DE CIERRES POR MES
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * SVG a mano y no una librería de charts: son doce barras, una línea horizontal
 * y una barra apilada. Traer Recharts o Chart.js para esto sumaría cientos de
 * kB al bundle del cliente y una dependencia más que mantener, para dibujar
 * rectángulos. El repo ya venía evitando dependencias de ese tipo (ver la nota
 * de `components/ui/icons.tsx`).
 *
 * LA BARRA DEL MES ACTUAL VA SEGMENTADA EN TRES, y es lo que hace útil al
 * gráfico: apiladas muestran de qué está hecha la proyección.
 *
 *   1. lo ya cerrado          -> es un hecho
 *   2. lo que está en CTC/Closing -> es casi un hecho, no lleva tasa
 *   3. lo proyectado con PT   -> es un pronóstico
 *
 * Una sola barra sólida escondería que la mayor parte de un mes bueno puede ser
 * todavía pronóstico.
 *
 * ETAPA BP7 — LOS SEGMENTOS SON ENTEROS Y SUMAN EL ENTERO QUE SE MUESTRA.
 * La proyección exacta es fraccionaria (6,66), pero la barra muestra 7, y tres
 * segmentos redondeados por separado sumarían 6 u 8 y la barra mentiría.
 * `apportionByWeight` (de `lib/pipeline/aggregate.ts`) reparte el entero entre
 * los tres pesos garantizando que la suma cierre -- es el mismo helper que usa
 * Forecast para el mismo problema, así que no se reimplementa acá.
 */

const H = 150;
const BAR_GAP = 6;

interface Props {
  months: string[];
  closingsByMonth: Record<string, number>;
  currentMonth: string;
  projection: CurrentMonthProjection;
  benchmark: number | null;
}

export default function MonthlyBarChart({ months, closingsByMonth, currentMonth, projection, benchmark }: Props) {
  const values = months.map((m) => (m === currentMonth ? projection.projectedTotal : (closingsByMonth[m] ?? 0)));
  /*
   * La escala incluye el benchmark: si nadie llegara nunca a él, la línea
   * quedaría fuera del área dibujada y no se vería que está lejos.
   */
  const max = Math.max(1, ...values, benchmark ?? 0);
  const scale = (v: number) => (v / max) * H;
  const barW = `calc((100% - ${(months.length - 1) * BAR_GAP}px) / ${months.length})`;

  /*
   * Los tres segmentos, ya como enteros que suman el entero mostrado. Los pesos
   * son los valores exactos; el reparto lo resuelve `apportionByWeight`.
   */
  const segTotal = Math.round(projection.projectedTotal);
  const seg = apportionByWeight(segTotal, [
    projection.closedToDate,
    projection.inCtc + projection.inClosing,
    projection.projectedFromHealthy,
  ]);

  return (
    <div className="bp-chart">
      <div className="bp-chart__plot" style={{ height: H + 'px' }}>
        {benchmark !== null && (
          <div
            className="bp-chart__benchmark"
            style={{ bottom: scale(benchmark) + 'px' }}
            title={`Benchmark ${benchmark.toFixed(1)}`}
          >
            <span className="bp-chart__benchmark-label">{benchmark.toFixed(1)}</span>
          </div>
        )}
        <div className="bp-chart__bars" style={{ gap: BAR_GAP + 'px' }}>
          {months.map((m) => {
            const isCurrent = m === currentMonth;
            const total = isCurrent ? projection.projectedTotal : (closingsByMonth[m] ?? 0);
            return (
              <div key={m} className="bp-chart__col" style={{ width: barW }}>
                {/* Entero también en el mes actual: un préstamo es discreto. */}
                <div className="bp-chart__value" title={isCurrent ? 'Exact: ' + total.toFixed(2) : undefined}>
                  {total > 0 ? Math.round(total) : ''}
                </div>
                {isCurrent ? (
                  <div
                    className="bp-chart__bar bp-chart__bar--current"
                    style={{ height: scale(total) + 'px' }}
                    title={
                      `Closed ${seg[0]} · CTC/Closing ${seg[1]} · projected ${seg[2]}` +
                      ` (exact projection ${projection.projectedTotal.toFixed(2)})`
                    }
                  >
                    {/* Orden de apilado: lo más cierto abajo. */}
                    <div className="bp-seg bp-seg--projected" style={{ height: pct(seg[2], segTotal) }} />
                    <div className="bp-seg bp-seg--ctc" style={{ height: pct(seg[1], segTotal) }} />
                    <div className="bp-seg bp-seg--closed" style={{ height: pct(seg[0], segTotal) }} />
                  </div>
                ) : (
                  <div className="bp-chart__bar" style={{ height: scale(total) + 'px' }} title={`${total} closings`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="bp-chart__axis" style={{ gap: BAR_GAP + 'px' }}>
        {months.map((m) => (
          <div key={m} className={'bp-chart__tick' + (m === currentMonth ? ' is-current' : '')} style={{ width: barW }}>
            {shortMonth(m)}
          </div>
        ))}
      </div>
      <div className="bp-chart__legend">
        <span>
          <i className="bp-dot bp-dot--closed" /> Closed {seg[0]}
        </span>
        <span>
          <i className="bp-dot bp-dot--ctc" /> CTC / Closing {seg[1]}
        </span>
        <span title={'Exact: ' + projection.projectedFromHealthy.toFixed(2)}>
          <i className="bp-dot bp-dot--projected" /> Projected after PT {seg[2]}
        </span>
      </div>
    </div>
  );
}

/** Alto de un segmento como porcentaje de la barra que lo contiene. */
function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return (part / total) * 100 + '%';
}
