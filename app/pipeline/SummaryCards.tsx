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
   * Etapa UX9: reemplaza `targetMonthLabel` como subtítulo de la tarjeta
   * Closed -- suma de `bucketTotal.Closing` (page.tsx) de todas las filas de
   * branch, ya existente (no es un cálculo nuevo), pasada acá para mostrar
   * cuántos préstamos del pipeline abierto están en milestone Clear to
   * Close/Closing (ya posicionados para cerrar pronto).
   */
  projectedToCloseSoon: number;
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
 * Desglose Banked/Brokered de una tarjeta del banner (etapa UX7). Las 4
 * tarjetas son conteos/forecast enteros y suman exacto al combinado (ver
 * `size="lg"` más abajo, para la variante más grande de Total Forecast).
 */
function ChannelSplit({
  bankedValue,
  brokeredValue,
  size,
}: {
  bankedValue: string;
  brokeredValue: string;
  size?: 'lg';
}) {
  return (
    <div className={`kpi-hero__split${size === 'lg' ? ' kpi-hero__split--lg' : ''}`}>
      <div className="kpi-hero__split-item">
        <span className="kpi-hero__split-value">{bankedValue}</span>
        <span className="kpi-hero__split-label">Banked</span>
      </div>
      <div className="kpi-hero__split-divider" />
      <div className="kpi-hero__split-item">
        <span className="kpi-hero__split-value">{brokeredValue}</span>
        <span className="kpi-hero__split-label">Brokered</span>
      </div>
    </div>
  );
}

/**
 * Top Banner KPI Summary (spec §4A) -- 4 tarjetas ejecutivas sobre los números
 * COMBINADOS (banked + brokered), con el desglose por canal debajo (etapa UX7).
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
 * Etapa UX7 -- desglose por canal:
 *  - Las 3 primeras tarjetas son conteos enteros: `fmtInt` alcanza y el
 *    desglose siempre suma exacto al combinado.
 *  - Total Forecast era fraccionario en UX7: se conservaba 1 decimal en el
 *    desglose (`toFixed(1)`) porque redondear cada canal por separado podía
 *    no sumar el total mostrado (38.1+4.3=42.4 vs. un titular de 42).
 *
 * Etapa F5j -- ya no hace falta el decimal: `page.tsx` ahora redondea
 * `forecastTotal` por fila de branch ANTES de sumar (para los 2 canales,
 * ver esa nota ahí), así que todo lo que llega acá ya es entero por
 * construcción y Banked+Brokered siempre suma el titular exacto. `fmtRounded`
 * en el desglose es solo una red de seguridad, no el mecanismo real.
 *
 * Sin cambios de cálculo: los 3 bloques llegan ya calculados desde page.tsx.
 */
export default function SummaryCards({ combined, banked, brokered, projectedToCloseSoon }: SummaryCardsProps) {
  const healthyPct = combined.totalCount ? Math.round((combined.healthyCount / combined.totalCount) * 100) : 0;

  return (
    <div className="hero-banner">
      <div className="mcard">
        <div className="m-name">Total Pipeline</div>
        <div className="kpi-hero__value">{loansLabel(combined.totalCount)}</div>
        <ChannelSplit bankedValue={fmtInt(banked.totalCount)} brokeredValue={fmtInt(brokered.totalCount)} />
        <div className="kpi-hero__sub">In Negotiation, within Pipeline Range</div>
      </div>

      <div className="mcard mcard--emerald">
        <div className="m-name">
          <span className="dot-healthy" />
          Healthy Pipeline
        </div>
        <div className="kpi-hero__value kpi-hero__value--emerald">{loansLabel(combined.healthyCount)}</div>
        <ChannelSplit bankedValue={fmtInt(banked.healthyCount)} brokeredValue={fmtInt(brokered.healthyCount)} />
        <div style={{ marginTop: '8px' }}>
          <span className="badge badge--pill badge--emerald">{healthyPct}% of total</span>
        </div>
      </div>

      <div className="mcard">
        <div className="m-name">Closed</div>
        <div className="kpi-hero__value">{loansLabel(combined.closedCount)}</div>
        <ChannelSplit bankedValue={fmtInt(banked.closedCount)} brokeredValue={fmtInt(brokered.closedCount)} />
        <div className="kpi-hero__sub">{loansLabel(projectedToCloseSoon)} Projected to close soon</div>
      </div>

      <div className="mcard mcard--sky">
        <div className="m-name">Total Forecast</div>
        <div className="kpi-hero__value kpi-hero__value--lg">{fmtRounded(combined.totalForecast)}</div>
        {/*
         * Etapa F5j, Cambio 4: se saca el .toFixed(1) -- el forecast se
         * muestra siempre entero, en los 2 canales. Desde F5j/F5j-b,
         * `banked.totalForecast`/`brokered.totalForecast` ya llegan como la
         * suma de forecastTotal ya redondeado por branch (page.tsx,
         * summarizeChannel) más el closedCount de ese canal (entero) -- son
         * enteros de por sí acá, `fmtRounded()` solo cubre el caso de que
         * algún llamador futuro pase un decimal. Reemplaza la asimetría de
         * redondeo de UX7 (1 decimal acá, entero en el resto): con la regla
         * de F5j ("redondear por fila y sumar, no al revés") ya no hace
         * falta -- ambos canales llegan enteros por construcción, no por un
         * .toFixed(1) que ocultaba el redondeo.
         */}
        <ChannelSplit bankedValue={fmtRounded(banked.totalForecast)} brokeredValue={fmtRounded(brokered.totalForecast)} size="lg" />
        {/*
         * Etapa UX9: se achica el subtítulo (`kpi-hero__sub--sm`, ver
         * forecast-visual.css) y se saca la aclaración del 40% de Brokered
         * (vivía acá desde F5j) -- esa nota solo aplica a un canal, no a esta
         * tarjeta que resume ambos, así que se movió debajo de la tabla
         * Brokered en PivotTable.tsx (Etapa UX9).
         */}
        <div className="kpi-hero__sub kpi-hero__sub--sm">Forecast = On Track Loans after PT + Closed</div>
      </div>
    </div>
  );
}
