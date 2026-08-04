'use client';

import type { ReactNode } from 'react';

/**
 * Etapa F5i: antes esta interfaz estaba atada 1 a 1 a los tipos de Banked
 * (BucketCounts/ForecastByBucket/PullThroughRates de aggregate.ts) -- se
 * generaliza a una lista de filas porque Brokered tiene su propia cascada
 * de 4 etapas (File Creation/App Date/Processing/Submitted), con nombres y
 * tasas propias, sin relación con las de Banked (ver aggregate.ts). page.tsx
 * arma `rows` para cada canal con sus propios buckets/tasas; este
 * componente ya no sabe ni le importa de qué canal vienen -- solo dibuja
 * una cascada secuencial genérica. `rate` es la tasa PROPIA de esa etapa
 * (no acumulada); la tasa acumulada que se muestra en "% applied" se
 * calcula acá como el producto de `rate` de esta fila en adelante --
 * exactamente el mismo cálculo que hacía CUMULATIVE_FACTORS antes, solo
 * que ahora es genérico en vez de estar codificado para los 4 buckets de
 * Banked. El Forecast de cada fila NO se recalcula acá -- viene ya
 * calculado desde aggregate.ts (calculateForecast/calculateBrokeredForecast),
 * este componente es puramente de presentación.
 */
export interface MilestoneCascadeRow {
  key: string;
  label: string;
  /** Tasa propia de esta etapa (no acumulada) -- ver nota de arriba. */
  rate: number;
  healthy: number;
  total: number;
  forecast: number;
}

export interface MilestoneCascadeProps {
  rows: MilestoneCascadeRow[];
  /** Proyección por pull-through (sin cerrados) -- mismo significado de siempre, sin cambios. */
  forecastTotal: number;
  /**
   * Etapa F4b, ambos opcionales para no romper ningún caller existente: si
   * se proveen los dos, se agrega una fila "Closed (Funded)" y la fila de
   * total pasa a mostrar Closed + Projection en vez de solo forecastTotal.
   */
  closedCount?: number;
  totalForecast?: number;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function fmtForecast(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Etapa F4h: icono de línea simple por etapa, sin librería externa
 * (lucide-react no estaba instalado -- ver Decisiones en la respuesta de
 * esa etapa). Mismo estilo que el ícono de "drop" ya usado en el estado
 * vacío de la página (stroke="currentColor", fill="none").
 *
 * Etapa F5i: antes eran 4 iconos keyed por nombre de bucket de Banked --
 * ahora son genéricos por POSICIÓN en la cascada (1ra/2da/3ra/4ta etapa),
 * así sirven igual para los 4 buckets de Banked o los 4 de Brokered, sin
 * necesidad de un set de iconos por canal.
 */
/** Path de cada ícono, por posición -- función en vez de array de JSX literal para no disparar react/jsx-key (esta lista nunca se recorre con .map, pero ESLint no lo distingue de una que sí). */
function stageIconPath(position: number): ReactNode {
  switch (position % 4) {
    case 0:
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l2.5 2.5" />
        </>
      );
    case 1:
      return (
        <>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </>
      );
    case 2:
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </>
      );
    default:
      return <path d="M20 6 9 17l-5-5" />;
  }
}

function StageIcon({ position }: { position: number }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ marginRight: '6px', flexShrink: 0, color: 'var(--muted)' }}
    >
      {stageIconPath(position)}
    </svg>
  );
}

/**
 * Tabla de trazabilidad del pull-through: por cada etapa, conteo Healthy
 * vs Total, la tasa acumulada aplicada, y el Forecast que produce. Nada
 * queda oculto detrás del número final -- ese es el requisito de negocio
 * no negociable desde F4h. Genérico desde F5i -- ver nota en
 * MilestoneCascadeRow arriba.
 */
export default function MilestoneCascade({ rows, forecastTotal, closedCount, totalForecast }: MilestoneCascadeProps) {
  const hasClosedBreakdown = closedCount !== undefined && totalForecast !== undefined;

  return (
    <div className="tbl-card">
      <table className="piv">
        <thead>
          <tr className="mo-row">
            <th className="lbl">Milestone</th>
            <th>Healthy</th>
            <th>Total</th>
            <th>% applied</th>
            <th className="totcol">Forecast</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const cumulativeRate = rows.slice(i).reduce((acc, r) => acc * r.rate, 1);
            return (
              <tr className="metric" key={row.key}>
                <td className="lbl mname" style={{ display: 'flex', alignItems: 'center' }}>
                  <StageIcon position={i} />
                  {row.label}
                </td>
                <td className="val">{fmtInt(row.healthy)}</td>
                <td className="val">{fmtInt(row.total)}</td>
                <td className="val">{fmtPct(cumulativeRate)}</td>
                <td className="totcol">{fmtForecast(row.forecast)}</td>
              </tr>
            );
          })}
          {hasClosedBreakdown && (
            <tr className="metric">
              <td className="lbl mname">Closed (Funded)</td>
              <td className="val" colSpan={3}></td>
              <td className="totcol">{fmtInt(closedCount as number)}</td>
            </tr>
          )}
          <tr className="grp total">
            <td className="lbl">{hasClosedBreakdown ? 'Total Forecast (Closed + Projection)' : 'Total Forecast'}</td>
            <td colSpan={3}></td>
            <td className="totcol">{fmtForecast(hasClosedBreakdown ? (totalForecast as number) : forecastTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
