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
 */

const LABEL_RESERVE = 18;

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

export interface CommercialActivityLineChartProps {
  rows: CommercialActivityMonthlyRow[];
}

export default function CommercialActivityLineChart({ rows }: CommercialActivityLineChartProps) {
  const plotHeight = 110;
  const bottomReserve = 18;
  const leftPad = 8;
  const rightPad = 8;
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

  const maxValue = Math.max(1, ...rows.flatMap((r) => SERIES.map((s) => r[s.key])));

  function x(i: number): number {
    return leftPad + i * step;
  }
  function y(value: number): number {
    return plotHeight - (value / maxValue) * plotHeight;
  }

  return (
    <div className="trend-chart">
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={LABEL_RESERVE + plotHeight + bottomReserve} viewBox={`0 0 ${width} ${LABEL_RESERVE + plotHeight + bottomReserve}`}>
          <g transform={`translate(0 ${LABEL_RESERVE})`}>
            {SERIES.map((series) => {
              const points = rows.map((r, i) => `${x(i)},${y(r[series.key])}`).join(' ');
              return <polyline key={series.key} points={points} fill="none" stroke={series.color} strokeWidth={2} />;
            })}
            {SERIES.map((series) =>
              rows.map((r, i) => (
                <circle key={series.key + r.month} cx={x(i)} cy={y(r[series.key])} r={3} fill={series.color}>
                  <title>{`${shortMonth(r.month)} ${r.month.slice(0, 4)} -- ${series.label}: ${r[series.key]}`}</title>
                </circle>
              ))
            )}
            {rows.map((r, i) => (
              <text key={r.month} x={x(i)} y={plotHeight + 14} textAnchor="middle" fontSize="10.5" fill="var(--slate-500)">
                {tickLabel(rows, i)}
              </text>
            ))}
          </g>
        </svg>
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
