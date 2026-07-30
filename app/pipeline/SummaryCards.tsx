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

export interface SummaryCardsProps {
  /**
   * Etapa F4f: antes esto era un solo set de props (un bloque combinado).
   * Ahora son 3 bloques -- Banked, Brokered, Combinado -- que page.tsx arma
   * y pasa como array, en vez de triplicar los props sueltos. Se decidió
   * así (en vez de 3 componentes separados) porque los 3 bloques son
   * exactamente la misma tarjeta repetida con distintos números; un array +
   * un único render interno evita duplicar el JSX 3 veces.
   */
  blocks: SummaryBlock[];
  /** Rango de fechas usado para "Cerrados" en los 3 bloques -- solo para mostrarlo. */
  closedDateRangeLabel?: string;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtForecast(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function SummaryBlockCards({ block, closedDateRangeLabel }: { block: SummaryBlock; closedDateRangeLabel?: string }) {
  const healthyPct = block.totalCount ? Math.round((block.healthyCount / block.totalCount) * 100) : 0;

  return (
    <div className="cards-wrap" style={{ position: 'static' }}>
      <div className="cards-head">{block.label}</div>
      <div className="cards">
        <div className="mcard" style={{ flex: '0 0 220px' }}>
          <div className="m-name">Total Pipeline</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{fmtInt(block.totalCount)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>préstamos en Negotiation, en rango</div>
        </div>
        <div className="mcard" style={{ flex: '0 0 220px' }}>
          <div className="m-name">Healthy Pipeline</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--green)', lineHeight: 1.2 }}>{fmtInt(block.healthyCount)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>{healthyPct}% del total</div>
        </div>
        <div className="mcard" style={{ flex: '0 0 220px' }}>
          <div className="m-name">Forecast</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>
            {fmtForecast(block.totalForecast)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            {fmtInt(block.closedCount)} cerrados + {fmtForecast(block.forecastTotal)} proyección
          </div>
          {closedDateRangeLabel && (
            <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
              Cerrados: Disbursement Date {closedDateRangeLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tarjetas de resumen del Forecast, en 3 bloques (Banked - Retail /
 * Brokered / Combinado) -- ver Decisiones en la respuesta de F4f. Mismo
 * sistema visual de siempre (.cards-wrap/.mcard/.m-name), solo repetido 3
 * veces con distintos datos.
 */
export default function SummaryCards({ blocks, closedDateRangeLabel }: SummaryCardsProps) {
  return (
    <>
      {blocks.map((block, i) => (
        <div key={block.label} style={i > 0 ? { marginTop: '16px' } : undefined}>
          <SummaryBlockCards block={block} closedDateRangeLabel={closedDateRangeLabel} />
        </div>
      ))}
    </>
  );
}
