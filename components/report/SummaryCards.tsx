'use client';

import type { ReportTree, Measure, MetricMap } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import { METRICS, MONTH_NAMES, type MetricKey } from '@/config/metrics';
import { fmtVal } from '@/lib/aggregation/format';
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from '@/components/ui/icons';

export interface SummaryCardsProps {
  tree: ReportTree;
  months: YearMonth[];
  measure: Measure;
}

function monthName(ym: YearMonth): string {
  return MONTH_NAMES[Number(ym.split('-')[1]) - 1];
}

function prevMonth(ym: YearMonth): YearMonth {
  const [y, m] = ym.split('-').map(Number);
  let year = y;
  let month = m - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return year + '-' + String(month).padStart(2, '0');
}

interface TrendProps {
  metricKey: MetricKey;
  ym: YearMonth;
  current: number;
  maps: Record<MetricKey, MetricMap>;
  firstYM: YearMonth;
  measure: Measure;
}

/**
 * Badge de tendencia contra el mes anterior.
 *
 * Etapa UX1: antes eran los caracteres tipográficos "▲"/"▼"/"–" pintados de
 * verde/rojo saturado. El spec (§2 "Zero Emojis" y §3A) pide iconos SVG
 * dentro de un badge de fondo suave -- emerald para subida, rose para bajada,
 * slate para variación nula. La LÓGICA de comparación es el mismo port de
 * trendIcon() del legado: se compara contra el mes anterior real del mapa, no
 * contra el mes anterior mostrado en pantalla.
 */
function Trend({ metricKey, ym, current, maps, firstYM, measure }: TrendProps) {
  // Sin mes previo con el que comparar: no se dibuja nada (antes se ocupaba
  // el espacio con visibility:hidden; el grid ya no lo necesita).
  if (ym <= firstYM) return null;

  const prevYM = prevMonth(ym);
  const prev = maps[metricKey][prevYM] || 0;
  const prevLabel = monthName(prevYM).slice(0, 3);
  const comparison = ' vs ' + prevLabel + ' (' + fmtVal(prev, measure) + ')';

  if (current > prev) {
    return (
      <span className="badge badge--up" title={'Up' + comparison}>
        <ArrowUpIcon size={9} />
      </span>
    );
  }
  if (current < prev) {
    return (
      <span className="badge badge--down" title={'Down' + comparison}>
        <ArrowDownIcon size={9} />
      </span>
    );
  }
  return (
    <span className="badge badge--flat" title={'Flat' + comparison}>
      <MinusIcon size={9} />
    </span>
  );
}

/**
 * Monthly Totals: una tarjeta por mes con las 4 métricas y su tendencia
 * contra el mes anterior.
 *
 * Etapa UX1 (spec §3A): pasó de una fila con scroll horizontal
 * (`.cards` + `overflow-x:auto` + tarjetas de ancho fijo) a una grilla de 8
 * columnas (`.kpi-strip`) que envuelve a una segunda fila cuando hay más de
 * 8 meses visibles. El scroll horizontal era justamente lo que prohíbe el
 * spec §6.
 *
 * Sin cambios de cálculo: sigue leyendo tree.total.maps, igual que antes.
 */
export default function SummaryCards({ tree, months, measure }: SummaryCardsProps) {
  const maps = tree.total.maps;

  if (!months.length) {
    return (
      <div className="mcard" style={{ color: 'var(--slate-500)', fontSize: '13px' }}>
        No months available for the selected year.
      </div>
    );
  }

  const firstYM = months[0];

  return (
    <div className="kpi-strip">
      {months.map((ym) => (
        <div className="mcard" key={ym}>
          <div className="kpi-card__month">
            {monthName(ym)} {ym.split('-')[0]}
          </div>
          {METRICS.map(({ key, label }) => {
            const value = maps[key][ym] || 0;
            return (
              <div className="kpi-row" key={key}>
                <span className="kpi-row__label">{label}</span>
                <span className="kpi-row__right">
                  <span className="kpi-row__value">{fmtVal(value, measure)}</span>
                  <Trend metricKey={key} ym={ym} current={value} maps={maps} firstYM={firstYM} measure={measure} />
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
