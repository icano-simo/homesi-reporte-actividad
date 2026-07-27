'use client';

import type { ReportTree, Measure, MetricMap } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import { METRICS, MONTH_NAMES, type MetricKey } from '@/config/metrics';
import { fmtVal } from '@/lib/aggregation/format';

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

/** Port de trendIcon() del legacy. */
function Trend({ metricKey, ym, current, maps, firstYM, measure }: TrendProps) {
  if (ym <= firstYM) return <span className="trend none"></span>;

  const prevYM = prevMonth(ym);
  const prev = maps[metricKey][prevYM] || 0;
  const prevLabel = monthName(prevYM).slice(0, 3);

  if (current > prev) {
    return (
      <span className="trend up" title={'↑ vs ' + prevLabel + ' (' + fmtVal(prev, measure) + ')'}>
        ▲
      </span>
    );
  }
  if (current < prev) {
    return (
      <span className="trend down" title={'↓ vs ' + prevLabel + ' (' + fmtVal(prev, measure) + ')'}>
        ▼
      </span>
    );
  }
  return (
    <span className="trend flat" title={'= vs ' + prevLabel + ' (' + fmtVal(prev, measure) + ')'}>
      –
    </span>
  );
}

/**
 * Port de renderCards() del legacy: una tarjeta .mcard por mes con las 4
 * métricas y su flecha de tendencia contra el mes anterior.
 *
 * Simplificación por el contrato de props de esta etapa (sin `view` ni
 * `branchFilter`): usa siempre tree.total.maps, igual que buildView(). El
 * legacy recalculaba renderCards() con sus propios recs filtrados por
 * branch, así que al filtrar por un branch específico sus tarjetas podían
 * diferir del total de la tabla -- eso queda para la Etapa 7, cuando este
 * componente reciba props de filtro reales.
 */
export default function SummaryCards({ tree, months, measure }: SummaryCardsProps) {
  const maps = tree.total.maps;

  if (!months.length) {
    return (
      <div className="cards">
        <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>
          Sin meses para el año seleccionado.
        </div>
      </div>
    );
  }

  const firstYM = months[0];

  return (
    <div className="cards">
      {months.map((ym) => (
        <div className="mcard" key={ym}>
          <div className="m-name">
            {monthName(ym)} {ym.split('-')[0]}
          </div>
          {METRICS.map(({ key, label }) => {
            const value = maps[key][ym] || 0;
            return (
              <div className="m-row" key={key}>
                <span className="m-lab">{label}</span>
                <span className="m-right">
                  <span className={'m-val ' + key}>{fmtVal(value, measure)}</span>
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
