'use client';

export interface SummaryBlock {
  /** Encabezado del bloque: "Banked - Retail" / "Brokered" / "Combined". */
  label: string;
  totalCount: number;
  healthyCount: number;
  /** Proyección por pull-through (sin cerrados) -- mismo significado de siempre, sin cambios. */
  forecastTotal: number;
  closedCount: number;
  /** Cerrados + proyección -- lo que se muestra como titular del bloque. */
  totalForecast: number;
}

export interface SummaryCardsProps {
  combined: SummaryBlock;
  banked: SummaryBlock;
  brokered: SummaryBlock;
  /**
   * Mes usado para Cerrados/Forecast (ej. "August 2026") -- solo para
   * mostrarlo, no un rango de fechas. Viene del MonthSelector.
   */
  targetMonthLabel?: string;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Etapa F4h: el Forecast final se muestra como entero -- el cálculo no cambia. */
function fmtRounded(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** "73" -> "73 Loans" / "1 Loan" (spec §4A usa esa unidad explícita en las tarjetas). */
function loansLabel(n: number): string {
  return fmtInt(n) + (n === 1 ? ' Loan' : ' Loans');
}

/**
 * Top Banner KPI Summary (spec §4A) -- 4 tarjetas ejecutivas sobre los números
 * COMBINADOS (banked + brokered).
 *
 * Etapa UX1, qué cambió respecto de F6c:
 *  - Los estilos inline (fontSize/fontWeight/background/border repetidos en
 *    cada tarjeta) se reemplazaron por clases del sistema: `.kpi-hero__*` y
 *    las variantes `.mcard--emerald` / `.mcard--sky`. El color de marca vive
 *    ahora en CSS, no en el JSX.
 *  - Healthy Pipeline pasó a tarjeta con fondo/borde emerald y el % dentro de
 *    un badge; Total Forecast a fondo/borde 'Light Sky'.
 *  - Se muestra "N Loans" en vez del número pelado, como pide el spec.
 *
 * Sin cambios de cálculo: los 3 bloques llegan ya calculados desde page.tsx.
 */
export default function SummaryCards({ combined, banked, brokered, targetMonthLabel }: SummaryCardsProps) {
  const healthyPct = combined.totalCount ? Math.round((combined.healthyCount / combined.totalCount) * 100) : 0;

  return (
    <div className="hero-banner">
      <div className="mcard">
        <div className="m-name">Total Pipeline</div>
        <div className="kpi-hero__value">{loansLabel(combined.totalCount)}</div>
        <div className="kpi-hero__sub">In Negotiation, within Pipeline Range</div>
      </div>

      <div className="mcard mcard--emerald">
        <div className="m-name">
          <span className="dot-healthy" />
          Healthy Pipeline
        </div>
        <div className="kpi-hero__value kpi-hero__value--emerald">{loansLabel(combined.healthyCount)}</div>
        <div style={{ marginTop: '8px' }}>
          <span className="badge badge--pill badge--emerald">{healthyPct}% of total</span>
        </div>
      </div>

      <div className="mcard">
        <div className="m-name">Closed</div>
        <div className="kpi-hero__value">{loansLabel(combined.closedCount)}</div>
        <div className="kpi-hero__sub">{targetMonthLabel ?? 'In target month'}</div>
      </div>

      <div className="mcard mcard--sky">
        <div className="m-name">Total Forecast</div>
        <div className="kpi-hero__value kpi-hero__value--lg">{fmtRounded(combined.totalForecast)}</div>
        {/*
         * Etapa F5j, Cambio 4: se saca el .toFixed(1) -- el forecast se
         * muestra siempre entero, en los 2 canales. `banked.totalForecast`/
         * `brokered.totalForecast` ya llegan como la suma de forecastTotal
         * ya redondeado por branch (page.tsx, summarizeChannel) más el
         * closedCount de ese canal (entero) -- son enteros de por sí acá,
         * fmtRounded() solo cubre el caso de que algún llamador futuro pase
         * un decimal.
         */}
        <div className="kpi-hero__sub">
          Banked: {fmtRounded(banked.totalForecast)} | Brokered: {fmtRounded(brokered.totalForecast)}
        </div>
        {/*
         * Etapa F5j, Cambio 5: con Brokered fuera de la cascada de
         * pull-through y operando sobre el Total (no Healthy), hace falta
         * una aclaración corta de qué significa "Brokered" acá -- discreta
         * (texto chico, gris), no un titular. Ver `.kpi-hero__note` en
         * forecast-visual.css.
         */}
        <div className="kpi-hero__note">Brokered applies a flat 40% pull-through rate on its open pipeline (Total).</div>
      </div>
    </div>
  );
}
