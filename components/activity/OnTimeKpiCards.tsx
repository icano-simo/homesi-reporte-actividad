'use client';

import type { OnTimeDelayedTotals } from '@/lib/activity/onTimeDelayed';
import { DeltaBadge, computePointsDelta } from '@/components/activity/DeltaBadge';
import { unknownExcludedNote } from '@/lib/activity/onTimeDelayedNote';

export interface OnTimeKpiCardsProps {
  current: OnTimeDelayedTotals;
  previous: OnTimeDelayedTotals;
  previousLabel: string;
}

function fmtPct(n: number | null): string {
  return n === null ? '—' : n.toFixed(1) + '%';
}

function fmtDays(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

/**
 * ============================================================================
 * KPI CARDS — SECCIÓN ON TIME / DELAYED — Etapa ACTIVITY-KPI-1
 * ============================================================================
 *
 * `% On Time`/`% Delayed` llevan `DeltaBadge` EN PUNTOS PORCENTUALES
 * (`computePointsDelta`, no `computeRelativeDelta`) -- ver el porqué en
 * `DeltaBadge.tsx`. `Avg Days Late` NO lleva delta -- pedido explícito:
 * "un promedio no se lee igual mes a mes que un total", y es SOLO del
 * bucket Delayed (ver `onTimeDelayed.ts`, sin tocar esa regla acá).
 *
 * El total de Unknown del corte (mismo `current` que alimenta estas 3
 * tarjetas, así que es el MISMO corte que ve la tabla de abajo) va como
 * nota chica debajo de las tarjetas -- mismo texto exacto que la nota al
 * pie de `OnTimeDelayedTable.tsx` (`unknownExcludedNote`, compartida, no
 * reescrita acá).
 */
export default function OnTimeKpiCards({ current, previous, previousLabel }: OnTimeKpiCardsProps) {
  const previousHasData = previous.countOnTime + previous.countDelayed > 0;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', marginBottom: '10px' }}>
        <div className="mcard">
          <div className="m-name">% On Time</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{fmtPct(current.pctOnTime)}</div>
          <div style={{ marginTop: '8px' }}>
            {current.pctOnTime !== null ? (
              <DeltaBadge
                delta={computePointsDelta(current.pctOnTime, previous.pctOnTime ?? 0, previousHasData)}
                previousLabel={previousLabel}
              />
            ) : (
              <span className="kpi-hero__sub">No On Time/Delayed data this period</span>
            )}
          </div>
        </div>

        <div className="mcard">
          <div className="m-name">% Delayed</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{fmtPct(current.pctDelayed)}</div>
          <div style={{ marginTop: '8px' }}>
            {/*
              Etapa ACTIVITY-KPI-3 -- `betterDirection: 'down'`: % Delayed es
              lo opuesto de % On Time, menos es mejor acá. Sin esto, esta
              tarjeta heredaba el default de `computePointsDelta`
              (`betterDirection: 'up'`, pensado para % On Time) sin que
              nadie lo hubiera pedido para ÉSTA -- con datos reales daba
              "+20.7 pts" en VERDE, leyéndose como una mejora cuando en
              realidad más préstamos atrasados es peor. `direction` (la
              flecha) sigue reflejando el número tal cual subió o bajó;
              sólo cambia `sentiment` (el color). "% On Time" no se toca --
              ahí `betterDirection: 'up'` (el default) ya era correcto.
            */}
            {current.pctDelayed !== null ? (
              <DeltaBadge
                delta={computePointsDelta(current.pctDelayed, previous.pctDelayed ?? 0, previousHasData, 'down')}
                previousLabel={previousLabel}
              />
            ) : (
              <span className="kpi-hero__sub">No On Time/Delayed data this period</span>
            )}
          </div>
        </div>

        <div className="mcard">
          <div className="m-name">Avg Days Late</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{fmtDays(current.avgDaysLate)}</div>
          <div className="kpi-hero__sub" style={{ marginTop: '8px' }}>
            Delayed loans only
          </div>
        </div>
      </div>
      {current.countUnknown > 0 && <p className="foot-note">{unknownExcludedNote(current.countUnknown)}</p>}
    </>
  );
}
