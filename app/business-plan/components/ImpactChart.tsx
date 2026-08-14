'use client';

import { shortMonth } from '@/lib/business-plan/months';
import { phaseOf, type MonthPhase } from '@/lib/business-plan/impact';

/**
 * ============================================================================
 * SERIE MENSUAL CON LA MARCA DEL ENROLAMIENTO
 * ============================================================================
 *
 * Etapa BP22 — ARCHIVO NUEVO.
 *
 * SVG no; `div` con alturas, igual que `MonthlyBarChart`. Y componente aparte y
 * no un modo más de aquél: el de Qualifier 1 apila tres segmentos de proyección
 * en el mes en curso, que acá no significan nada -- lo que se mira es una serie
 * histórica cortada por una fecha.
 *
 * ---------------------------------------------------------------------------
 * MENSUAL, NO SEMANAL
 * ---------------------------------------------------------------------------
 * Commercial Activity guarda `closing_month`, `app_date_month`,
 * `credit_report_month` y `file_creation_month`: MESES, sin día. Una serie
 * semanal habría que inventarla repartiendo cada mes entre sus semanas, y esa
 * invención se leería como dato.
 *
 * ---------------------------------------------------------------------------
 * EL COLOR DICE DE QUÉ LADO ESTÁ CADA MES
 * ---------------------------------------------------------------------------
 * CINCO estados, no dos: antes, el mes partido del enrolamiento, después, el
 * mes en curso que todavía no terminó, y los que ni siquiera llegaron -- el eje
 * dibuja los doce meses del año y hoy es agosto. El mes partido va rayado: un
 * color pleno lo pondría de un lado de la línea, y no está de ninguno.
 */

const H = 130;
const BAR_GAP = 5;

const PHASE_TITLE: Record<MonthPhase, string> = {
  before: 'Before the plan',
  partial: 'Enrolment month — split, counts on neither side',
  after: 'After the plan',
  running: 'Current month — still running',
  future: 'Has not happened yet',
};

export default function ImpactChart({
  months,
  series,
  enrollmentMonth,
  currentMonth,
  baseline,
  label,
}: {
  months: string[];
  series: Record<string, number>;
  enrollmentMonth: string;
  currentMonth: string;
  /** El promedio congelado, como línea horizontal de referencia. */
  baseline: number | null;
  label: string;
}) {
  const values = months.map((m) => series[m] ?? 0);
  const max = Math.max(1, ...values, baseline ?? 0);
  const scale = (v: number) => (v / max) * H;
  const barW = `calc((100% - ${(months.length - 1) * BAR_GAP}px) / ${months.length})`;

  return (
    <div className="bp-chart bp-impact-chart">
      <div className="bp-chart__plot" style={{ height: H + 'px' }}>
        {baseline !== null && (
          <div
            className="bp-chart__benchmark"
            style={{ bottom: scale(baseline) + 'px' }}
            title={`Baseline ${baseline.toFixed(2)} ${label.toLowerCase()} per month`}
          >
            <span className="bp-chart__benchmark-label">{baseline.toFixed(1)}</span>
          </div>
        )}
        <div className="bp-chart__bars" style={{ gap: BAR_GAP + 'px' }}>
          {months.map((m) => {
            const phase = phaseOf(m, enrollmentMonth, currentMonth);
            const v = series[m] ?? 0;
            return (
              <div key={m} className="bp-impact-chart__col" style={{ width: barW }}>
                {/*
                  La línea vertical del enrolamiento va pegada al BORDE
                  IZQUIERDO del mes partido, no en su centro: marca el momento
                  en que empieza ese mes, que es lo más cerca que se puede estar
                  del día real sin inventar una posición dentro del mes.
                */}
                {phase === 'partial' && <span className="bp-impact-chart__mark" aria-hidden="true" />}
                <div className="bp-chart__value">{v > 0 ? v : ''}</div>
                <div
                  className={'bp-chart__bar bp-impact-chart__bar is-' + phase}
                  style={{ height: scale(v) + 'px' }}
                  title={`${shortMonth(m)}: ${v} — ${PHASE_TITLE[phase]}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="bp-chart__axis" style={{ gap: BAR_GAP + 'px' }}>
        {months.map((m) => (
          <div
            key={m}
            className={'bp-chart__tick' + (m === enrollmentMonth ? ' is-current' : '')}
            style={{ width: barW }}
          >
            {shortMonth(m)}
          </div>
        ))}
      </div>
      <div className="bp-chart__legend">
        <span>
          <i className="bp-dot bp-dot--before" /> Before
        </span>
        <span>
          <i className="bp-dot bp-dot--partial" /> Enrolment month (split)
        </span>
        <span>
          <i className="bp-dot bp-dot--after" /> After
        </span>
        <span>
          <i className="bp-dot bp-dot--running" /> Running
        </span>
        <span>
          <i className="bp-dot bp-dot--future" /> Not yet
        </span>
      </div>
    </div>
  );
}
