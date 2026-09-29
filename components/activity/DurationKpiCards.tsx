'use client';

import type { DurationWindowSummary } from '@/lib/activity/activityComparablePeriod';
import { DeltaBadge, computeRelativeDelta } from '@/components/activity/DeltaBadge';

export interface DurationKpiCardsProps {
  current: DurationWindowSummary;
  previous: DurationWindowSummary;
  previousLabel: string;
}

/** `null` es '—', nunca 0 -- mismo criterio que el resto del módulo (Days to Close/On Time). */
function fmtDays(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * ============================================================================
 * KPI CARDS — SECCIÓN DURATION — Etapa ACTIVITY-KPI-1
 * ============================================================================
 *
 * Mismas 4 clases del Hero KPI de TabAnalytics.tsx (`.mcard`,
 * `.kpi-hero__value`, `.kpi-hero__value--lg`, `.badge`), sin ningún
 * sistema de tarjetas nuevo. El contenedor grid de 3 columnas vive ACÁ
 * adentro (no en `app/analytics/page.tsx`) -- mismo criterio que
 * `OnTimeKpiCards`, que además necesita un hijo (la nota de Unknown)
 * FUERA del grid: los 2 componentes quedan autocontenidos, la página
 * sólo los renderiza.
 *
 * "Closed Loans" no lleva `DeltaBadge` -- pedido explícito, es de
 * referencia (población elegible del corte, no una magnitud que se
 * compare período a período acá).
 *
 * Etapa ACTIVITY-KPI-2 -- `betterDirection: 'down'` en las 2 llamadas:
 * App→CTC/CTC→Disb son DÍAS para llegar a un hito, menos es mejor. Antes
 * de esta etapa el badge usaba la convención neutra (sube = verde,
 * siempre) -- con datos reales eso mostraba "+15.7% App→CTC" en VERDE,
 * leyéndose como una mejora cuando en realidad el proceso se hizo más
 * lento. Con `betterDirection: 'down'`, la flecha sigue mostrando la
 * dirección real del número (↑ porque el promedio subió), pero el color
 * pasa a rojo -- confirmado en pantalla, ver el reporte de esta etapa.
 */
export default function DurationKpiCards({ current, previous, previousLabel }: DurationKpiCardsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', marginBottom: '20px' }}>
      <div className="mcard">
        <div className="m-name">Avg Days App→CTC</div>
        <div className="kpi-hero__value kpi-hero__value--lg">{fmtDays(current.avgAppToCtc)}</div>
        <div style={{ marginTop: '8px' }}>
          {current.avgAppToCtc !== null ? (
            <DeltaBadge
              delta={computeRelativeDelta(current.avgAppToCtc, previous.avgAppToCtc ?? 0, previous.countAppToCtc > 0, 'down')}
              previousLabel={previousLabel}
            />
          ) : (
            <span className="kpi-hero__sub">No data this period</span>
          )}
        </div>
      </div>

      <div className="mcard">
        <div className="m-name">Avg Days CTC→Disbursement</div>
        <div className="kpi-hero__value kpi-hero__value--lg">{fmtDays(current.avgCtcToDisbursement)}</div>
        <div style={{ marginTop: '8px' }}>
          {current.avgCtcToDisbursement !== null ? (
            <DeltaBadge
              delta={computeRelativeDelta(
                current.avgCtcToDisbursement,
                previous.avgCtcToDisbursement ?? 0,
                previous.countCtcToDisbursement > 0,
                'down'
              )}
              previousLabel={previousLabel}
            />
          ) : (
            <span className="kpi-hero__sub">No data this period</span>
          )}
        </div>
      </div>

      <div className="mcard">
        <div className="m-name">Closed Loans</div>
        <div className="kpi-hero__value kpi-hero__value--lg">{fmtInt(current.closedLoansCount)}</div>
      </div>
    </div>
  );
}
