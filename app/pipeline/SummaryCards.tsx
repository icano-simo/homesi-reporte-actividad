'use client';

export interface SummaryBlock {
  /** Encabezado del bloque: "Banked - Retail" / "Brokered" / "Combinado". */
  label: string;
  totalCount: number;
  healthyCount: number;
  /** Proyección por pull-through (sin cerrados) -- mismo significado de siempre, sin cambios. */
  forecastTotal: number;
  closedCount: number;
  /** Cerrados + proyección -- lo que se muestra como titular del bloque. */
  totalForecast: number;
}

/**
 * Etapa F6c: antes eran 3 bloques repetidos (Banked/Brokered/Combinado, cada
 * uno con sus propias 4 tarjetas) -- ahora es UN solo banner de 4 tarjetas
 * con los números combinados; banked/brokered ya no se repiten como bloques
 * completos, solo aportan su totalForecast al desglose chico de la tarjeta
 * Forecast. page.tsx todavía no arma estas 3 props (eso es F6h) -- este
 * componente solo declara el contrato nuevo.
 */
export interface SummaryCardsProps {
  combined: SummaryBlock;
  banked: SummaryBlock;
  brokered: SummaryBlock;
  /**
   * Etapa F5c: mes usado para Cerrados/Forecast (ej. "Agosto 2026") -- solo
   * para mostrarlo, no un rango de fechas. Etapa F5e: viene de un selector
   * de mes independiente (MonthSelector.tsx).
   */
  targetMonthLabel?: string;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Etapa F4h: Forecast final se muestra como entero -- ver nota en la respuesta de esta etapa. */
function fmtRounded(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Etapa F4h: punto de color junto a "Healthy Pipeline", sin depender de ninguna librería de iconos. */
function HealthyDot() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: 'var(--green)',
        marginRight: '5px',
      }}
    />
  );
}

/**
 * Banner de resumen del Forecast -- 4 tarjetas (Total Pipeline / Healthy
 * Pipeline / Closed / Forecast) sobre los números COMBINADOS (banked +
 * brokered), en vez de las 3 filas de bloques repetidos de antes. Mismo
 * sistema visual de siempre (.cards-wrap/.mcard/.m-name) más el grid de 4
 * columnas .hero-banner agregado en F6a.
 *
 * La tarjeta Forecast conserva el tratamiento visual de la ronda anterior
 * (fondo/borde distintivo, valor a 34px) -- no se reinventa acá, solo
 * cambia su subtítulo: antes mostraba "X closed + Y projection", ahora
 * muestra el desglose Banked/Brokered del Forecast combinado.
 */
export default function SummaryCards({ combined, banked, brokered, targetMonthLabel }: SummaryCardsProps) {
  const healthyPct = combined.totalCount ? Math.round((combined.healthyCount / combined.totalCount) * 100) : 0;

  return (
    <div className="cards-wrap" style={{ position: 'static' }}>
      <div className="hero-banner">
        <div className="mcard">
          <div className="m-name">Total Pipeline</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>
            {fmtInt(combined.totalCount)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>loans in Negotiation, in range</div>
        </div>
        <div className="mcard">
          <div className="m-name">
            <HealthyDot />
            Healthy Pipeline
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--green)', lineHeight: 1.2 }}>
            {fmtInt(combined.healthyCount)}
          </div>
          <div style={{ marginTop: '6px' }}>
            <span
              style={{
                background: 'var(--green-tint)',
                color: 'var(--green)',
                borderRadius: '9999px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              {healthyPct}% of total
            </span>
          </div>
        </div>
        <div className="mcard">
          <div className="m-name">Closed</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>
            {fmtInt(combined.closedCount)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>{targetMonthLabel ?? 'in target month'}</div>
        </div>
        <div
          className="mcard"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-border)' }}
        >
          <div className="m-name">Forecast</div>
          <div style={{ fontSize: '34px', fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>
            {fmtRounded(combined.totalForecast)}
          </div>
          <div className="sub-breakdown">
            Banked: {banked.totalForecast.toFixed(1)} | Brokered: {brokered.totalForecast.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}
