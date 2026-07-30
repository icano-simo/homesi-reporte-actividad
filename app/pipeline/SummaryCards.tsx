'use client';

export interface SummaryCardsProps {
  totalCount: number;
  healthyCount: number;
  forecastTotal: number;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtForecast(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * Tarjetas de resumen del Forecast: Total Pipeline / Healthy Pipeline /
 * Forecast. Reutiliza .cards-wrap/.mcard/.m-name de Actividad (mismo
 * sistema visual) -- position:sticky de .cards-wrap se neutraliza acá
 * porque esta página no implementa el ajuste dinámico de --cards-h que usa
 * Actividad (updateStick()); sin eso, dejarlo sticky podría solaparse con
 * los headers de las tablas de abajo.
 */
export default function SummaryCards({ totalCount, healthyCount, forecastTotal }: SummaryCardsProps) {
  const healthyPct = totalCount ? Math.round((healthyCount / totalCount) * 100) : 0;

  return (
    <div className="cards-wrap" style={{ position: 'static' }}>
      <div className="cards-head">Resumen del pipeline</div>
      <div className="cards">
        <div className="mcard" style={{ flex: '0 0 220px' }}>
          <div className="m-name">Total Pipeline</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{fmtInt(totalCount)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>préstamos en Negotiation</div>
        </div>
        <div className="mcard" style={{ flex: '0 0 220px' }}>
          <div className="m-name">Healthy Pipeline</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--green)', lineHeight: 1.2 }}>{fmtInt(healthyCount)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>{healthyPct}% del total</div>
        </div>
        <div className="mcard" style={{ flex: '0 0 220px' }}>
          <div className="m-name">Forecast</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>
            {fmtForecast(forecastTotal)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>cierres esperados (pull-through)</div>
        </div>
      </div>
    </div>
  );
}
