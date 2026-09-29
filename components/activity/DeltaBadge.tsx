'use client';

import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from '@/components/ui/icons';

export interface DeltaDisplay {
  text: string;
  /** Dirección MATEMÁTICA del cambio (para la flecha) -- sube o baja el número, sin juicio de valor. */
  direction: 'up' | 'down' | 'flat';
  /** Lectura de negocio del cambio (para el color) -- ver `BetterDirection`, más abajo. */
  sentiment: 'good' | 'bad' | 'neutral';
}

/**
 * En qué dirección MEJORA esta métrica puntual -- `'up'` (default, más es
 * mejor: Volume, Count, % On Time) o `'down'` (menos es mejor: días para
 * llegar a un hito, cualquier "tiempo hasta"). Sólo decide el COLOR
 * (`sentiment`); la flecha (`direction`) siempre refleja el número, subió
 * o bajó, sin importar la polaridad.
 */
export type BetterDirection = 'up' | 'down';

/**
 * ============================================================================
 * DELTA CONTRA EL PERÍODO ANTERIOR COMPARABLE — Etapa ACTIVITY-KPI-1,
 * polaridad agregada en Etapa ACTIVITY-KPI-2
 * ============================================================================
 *
 * Mismo componente visual que `DeltaBadge`/`computeDelta` de
 * `TabAnalytics.tsx` (badge suave + flecha, verde/rojo/gris) -- replicado,
 * no importado: esas 2 funciones son locales a ese archivo (no
 * exportadas), mismo criterio que `SectionScrollspyNav` con
 * `AnalyticsSectionNav` en la etapa anterior de este módulo.
 *
 * `computeRelativeDelta` es EXACTAMENTE la fórmula de `computeDelta` en
 * TabAnalytics.tsx (`((current-previous)/previous)*100`) -- se usa para
 * los 2 KPIs de Duration (Avg Days App→CTC/CTC→Disb), que son PROMEDIOS
 * de una magnitud sin techo (días), misma naturaleza que "Average Ticket"
 * en el Hero KPI de Forecast (que también usa la fórmula relativa, no
 * puntos).
 *
 * `computePointsDelta` es DISTINTA a propósito, para % On Time/% Delayed:
 * son TASAS acotadas 0-100%, y la convención estándar para comparar 2
 * tasas es la diferencia en PUNTOS PORCENTUALES, no el cambio relativo --
 * la fórmula relativa exagera enormemente un movimiento chico en una tasa
 * baja (2% -> 4% se leería "+100%", cuando en puntos es "+2pts", la
 * lectura que de verdad importa para una tasa). Mismo mecanismo visual
 * (badge/flecha/color), texto distinto ("pts" en vez de "%") para no
 * confundir un cambio relativo con uno absoluto.
 *
 * ⚠ ETAPA ACTIVITY-KPI-2 -- CORRECCIÓN DE POLARIDAD, y una aclaración sobre
 * la premisa con la que llegó esta tarea: se pidió "agregar la misma
 * noción de polaridad que ya existe en OnTimeKpiCards" -- medido leyendo
 * el código (`OnTimeKpiCards.tsx`, las 2 llamadas a `computePointsDelta`),
 * esa noción NO existe ahí. Las 2 llamadas (% On Time, % Delayed) usan
 * exactamente la misma convención neutra que tenía Duration -- de hecho el
 * comentario que documentaba esa convención ("un aumento de % Delayed
 * sube en verde... invertirlo sería una decisión nueva, fuera de
 * alcance") estaba escrito ACÁ, en este archivo, antes de esta etapa. No
 * se tocó `OnTimeKpiCards.tsx` -- sigue exactamente igual, sin pasar
 * `betterDirection`, así que su comportamiento no cambia un bit (ver el
 * default de los 2 `compute*` de abajo).
 *
 * `betterDirection` es un parámetro nuevo, opcional, con default `'up'` --
 * TODO llamador existente (los 2 de `OnTimeKpiCards.tsx`, y los 2 de
 * Duration antes de este fix) sigue exactamente igual si no lo pasa.
 * `DurationKpiCards.tsx` pasa `'down'` en sus 2 llamadas -- es la ÚNICA
 * diferencia de esta etapa.
 */
export function computeRelativeDelta(
  current: number,
  previous: number,
  previousHasData: boolean,
  betterDirection: BetterDirection = 'up'
): DeltaDisplay | null {
  if (!previousHasData || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const sentiment = direction === 'flat' ? 'neutral' : direction === betterDirection ? 'good' : 'bad';
  const sign = pct > 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(1)}%`, direction, sentiment };
}

export function computePointsDelta(
  currentPct: number,
  previousPct: number,
  previousHasData: boolean,
  betterDirection: BetterDirection = 'up'
): DeltaDisplay | null {
  if (!previousHasData) return null;
  const diff = currentPct - previousPct;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const sentiment = direction === 'flat' ? 'neutral' : direction === betterDirection ? 'good' : 'bad';
  const sign = diff > 0 ? '+' : '';
  return { text: `${sign}${diff.toFixed(1)} pts`, direction, sentiment };
}

export function DeltaBadge({ delta, previousLabel }: { delta: DeltaDisplay | null; previousLabel: string }) {
  if (delta === null) {
    return (
      <>
        <span className="kpi-hero__sub">No prior period</span>
        <div className="kpi-hero__sub" style={{ marginTop: '2px' }}>
          {previousLabel}
        </div>
      </>
    );
  }
  const cls = delta.sentiment === 'good' ? 'badge--up' : delta.sentiment === 'bad' ? 'badge--down' : 'badge--flat';
  const Icon = delta.direction === 'up' ? ArrowUpIcon : delta.direction === 'down' ? ArrowDownIcon : MinusIcon;
  return (
    <>
      <span className={'badge ' + cls}>
        <Icon size={9} />
        {delta.text}
      </span>
      <div className="kpi-hero__sub" style={{ marginTop: '2px' }}>
        vs {previousLabel}
      </div>
    </>
  );
}
