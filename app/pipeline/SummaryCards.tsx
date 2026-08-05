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
  /**
   * Etapa F5c: mes usado para Cerrados/Forecast en los 3 bloques (ej.
   * "Agosto 2026") -- solo para mostrarlo, no un rango de fechas.
   * Etapa F5e: ese mes ya no se deriva del DateRange de Pipeline -- viene
   * de un selector de mes independiente (MonthSelector.tsx); el nombre del
   * prop no cambió, solo de dónde sale el valor que page.tsx le pasa.
   */
  targetMonthLabel?: string;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtForecast(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
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

function SummaryBlockCards({ block, targetMonthLabel }: { block: SummaryBlock; targetMonthLabel?: string }) {
  const healthyPct = block.totalCount ? Math.round((block.healthyCount / block.totalCount) * 100) : 0;

  return (
    <div className="cards-wrap" style={{ position: 'static' }}>
      <div className="cards-head">{block.label}</div>
      <div className="cards">
        <div className="mcard" style={{ flex: '0 0 200px' }}>
          <div className="m-name">Total Pipeline</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{fmtInt(block.totalCount)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>loans in Negotiation, in range</div>
        </div>
        <div className="mcard" style={{ flex: '0 0 200px' }}>
          <div className="m-name">
            <HealthyDot />
            Healthy Pipeline
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--green)', lineHeight: 1.2 }}>{fmtInt(block.healthyCount)}</div>
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
        <div className="mcard" style={{ flex: '0 0 200px' }}>
          <div className="m-name">Closed</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{fmtInt(block.closedCount)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>{targetMonthLabel ?? 'in target month'}</div>
        </div>
        <div
          className="mcard"
          style={{ flex: '0 0 200px', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)' }}
        >
          <div className="m-name">Forecast</div>
          <div style={{ fontSize: '34px', fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>
            {fmtRounded(block.totalForecast)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            {fmtInt(block.closedCount)} closed + {fmtForecast(block.forecastTotal)} projection
          </div>
          {targetMonthLabel && (
            <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>{targetMonthLabel}</div>
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
 *
 * Etapa F4h: se agregó una 4ta tarjeta "Cerrados" por bloque (antes solo
 * aparecía mezclado en el subtítulo de Forecast); el número de Forecast
 * ahora se redondea a entero (Math.round) -- el subtítulo "X cerrados + Y
 * proyección" se deja con su precisión original, es el desglose que
 * justifica el número redondeado de arriba, igual criterio que
 * MilestoneCascade con la cascada completa.
 */
export default function SummaryCards({ blocks, targetMonthLabel }: SummaryCardsProps) {
  return (
    <>
      {blocks.map((block, i) => (
        <div key={block.label} style={i > 0 ? { marginTop: '16px' } : undefined}>
          <SummaryBlockCards block={block} targetMonthLabel={targetMonthLabel} />
        </div>
      ))}
    </>
  );
}
