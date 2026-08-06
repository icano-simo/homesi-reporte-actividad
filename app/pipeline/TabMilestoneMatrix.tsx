'use client';

import { useState } from 'react';
import {
  countByBrokeredMilestoneBucket,
  type PullThroughRates,
  type BrokeredPullThroughRates,
  type BucketCounts,
  type BrokeredBucketCounts,
} from '@/lib/pipeline/aggregate';
import MilestoneCascade, { type MilestoneCascadeRow } from './MilestoneCascade';
import type { BranchForecastRow } from './PivotTable';

export interface TabMilestoneMatrixProps {
  bankedRows: MilestoneCascadeRow[];
  brokeredRows: MilestoneCascadeRow[];
  bankedRates: PullThroughRates;
  brokeredRates: BrokeredPullThroughRates;
  /** Ajuste post-F6f: filas por branch (mismo tipo/mismo dato que ya recibe PivotTable) -- alimenta la matriz Branch x Milestone nueva. */
  rows: BranchForecastRow[];
}

type Channel = 'banked' | 'brokered';
type MetricView = 'total' | 'healthy';

/**
 * Ajuste post-F6f: los 3 valores crudos de Current Milestone que
 * MILESTONE_BUCKET (lib/pipeline/sources/salesforce-file.ts) colapsa en el
 * bucket único 'Underwriting' de Banked. Se desagregan acá SOLO para la
 * vista de la matriz -- el cálculo de pull-through no cambia, sigue
 * usando la tasa combinada de Underwriting sobre el conteo total de las 3
 * juntas (row.bucketTotal.Underwriting/row.bucketHealthy.Underwriting,
 * intactos, alimentan MilestoneCascade exactamente igual que antes).
 */
const UNDERWRITING_RAW_MILESTONES = ['Submittal', 'Initial Decision', 'Resubmittal'] as const;

function isUnderwritingRawMilestone(key: string): key is (typeof UNDERWRITING_RAW_MILESTONES)[number] {
  return (UNDERWRITING_RAW_MILESTONES as readonly string[]).includes(key);
}

/**
 * Columnas fijas de la matriz para Banked -- NO Object.keys(bankedRates)
 * (esa solo tiene las 4 keys de pull-through: Started/Processing/
 * Underwriting/Closing, no las 6 de esta vista). Started/Processing/
 * Closing siguen siendo 1 columna = 1 bucket real de countByMilestoneBucket,
 * sin cambios; Underwriting se reemplaza acá por sus 3 Current Milestone
 * crudos. Brokered sigue usando Object.keys(brokeredRates) tal cual (ver
 * `milestoneKeys` más abajo), sus 4 buckets ya están completos y correctos.
 */
const BANKED_MATRIX_COLUMNS: string[] = ['Started', 'Processing', ...UNDERWRITING_RAW_MILESTONES, 'Closing'];

/**
 * Cuenta a mano desde row.loans cuántos préstamos Banked tienen ese
 * rawMilestone exacto (.trim(), mismo criterio de comparación que usa
 * MILESTONE_BUCKET en el parser) -- countByMilestoneBucket ya los colapsó
 * en un solo bucket 'Underwriting', así que para desagregarlos en la vista
 * hace falta volver al dato crudo. Un préstamo con un rawMilestone fuera de
 * MILESTONE_BUCKET ya fue descartado por el parser (con warning) antes de
 * llegar acá -- no aparece en ninguna columna, mismo comportamiento que
 * tenía el bucket 'Underwriting' combinado.
 */
function bankedRawMilestoneCount(row: BranchForecastRow, rawMilestone: string, metricView: MetricView): number {
  const loans = metricView === 'total' ? row.loans : row.loans.filter((l) => l.healthy === true);
  return loans.filter((l) => l.rawMilestone.trim() === rawMilestone).length;
}

/** Suma los forecast ya calculados por fila -- MilestoneCascadeProps.forecastTotal es obligatorio y no viene como prop separado acá, así que se deriva de las mismas rows que se muestran (mismo total que ya suman internamente esas rows, no es un cálculo nuevo). */
function sumForecast(rows: MilestoneCascadeRow[]): number {
  return rows.reduce((sum, r) => sum + r.forecast, 0);
}

function fmtPct(rate: number): string {
  return (rate * 100).toFixed(1) + '%';
}

/** "FileCreation" -> "File Creation" -- transformación genérica por regex, no una lista de nombres hardcodeados (funciona igual para las keys de Banked o de Brokered, cualquiera sea el set real). */
function labelFromKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Ajuste post-F6f: bucketTotal/bucketHealthy de BranchForecastRow (page.tsx,
 * countByMilestoneBucket aplicado sin importar el canal) son REALES para
 * Banked, pero VESTIGIALES para Brokered -- quedan con las keys de Banked
 * (Started/Processing/Underwriting/Closing), no las reales de Brokered
 * (FileCreation/AppDate/Processing/Submitted). Ver nota en page.tsx donde se
 * arman (línea ~317: "nadie los lee para una fila Brokered"). Para Brokered
 * se recalculan acá desde `row.loans` con countByBrokeredMilestoneBucket
 * (aggregate.ts, sin tocar) -- mismo patrón que ya usa page.tsx para el
 * total combinado de Brokered (brokeredBucketTotal/brokeredBucketHealthy).
 * Sin este ajuste, la matriz de Brokered mostraría columnas Started/
 * Processing/Underwriting/Closing con números que no son los milestones
 * reales de Brokered -- justo arriba de la cascada de abajo, que sí los
 * muestra bien.
 */
function bucketsForRow(
  row: BranchForecastRow,
  channel: Channel
): { total: BucketCounts | BrokeredBucketCounts; healthy: BucketCounts | BrokeredBucketCounts } {
  if (channel === 'banked') {
    return { total: row.bucketTotal, healthy: row.bucketHealthy };
  }
  const healthyLoans = row.loans.filter((l) => l.healthy === true);
  return {
    total: countByBrokeredMilestoneBucket(row.loans),
    healthy: countByBrokeredMilestoneBucket(healthyLoans),
  };
}

/** BucketCounts/BrokeredBucketCounts (aggregate.ts, sin tocar) no declaran index signature -- se angosta el cast acá, en el único punto donde hace falta indexar por una key dinámica, no sobre el objeto completo (mismo criterio ya usado abajo para `rates`). */
function bucketValue(bucket: BucketCounts | BrokeredBucketCounts, key: string): number {
  return (bucket as unknown as Record<string, number>)[key] ?? 0;
}

/**
 * Etapa F6f: tab "Milestone Pipeline Matrix" -- selector de canal (Banked -
 * Retail / Brokered, sin tercera opción combinada, a propósito: cada canal
 * tiene su propia cascada con buckets/tasas incompatibles entre sí, ver
 * aggregate.ts) + toggle Total/Healthy + cuadro de Pull-Through Rates con
 * los valores reales del canal activo (nunca hardcodeados).
 *
 * Ajuste post-F6f: se agrega la matriz Branch x Milestone real (filas=branch,
 * columnas=milestone del canal activo, celda=Total o Healthy según el
 * toggle) ARRIBA de la cascada. El selector de canal y el toggle Total/
 * Healthy ahora sí tienen efecto sobre algo: el canal filtra las 2 tablas
 * (matriz + cascada), el toggle Total/Healthy solo afecta la matriz nueva
 * (MilestoneCascade sigue mostrando Healthy y Total juntas, sin cambios,
 * fuera del alcance de este ajuste).
 *
 * Reusa MilestoneCascade tal cual (rows ya vienen armadas desde afuera, F6h
 * decide cómo) -- no se reimplementa la tabla.
 */
export default function TabMilestoneMatrix({ bankedRows, brokeredRows, bankedRates, brokeredRates, rows }: TabMilestoneMatrixProps) {
  const [channel, setChannel] = useState<Channel>('banked');
  const [metricView, setMetricView] = useState<MetricView>('total');

  const cascadeRows = channel === 'banked' ? bankedRows : brokeredRows;
  const rates = channel === 'banked' ? bankedRates : brokeredRates;

  const channelValue: BranchForecastRow['channel'] = channel === 'banked' ? 'Banked - Retail' : 'Brokered';
  const filteredByChannel = rows.filter((r) => r.channel === channelValue);
  // Ajuste post-F6f: Banked usa las 6 columnas fijas (Underwriting
  // desagregado en vista, ver BANKED_MATRIX_COLUMNS) -- Brokered sigue
  // igual que antes, las keys de `rates` (ya viene por canal, real, sin
  // lista fija), así la matriz sigue mostrando las columnas correctas
  // incluso si ese canal no tiene ningún branch en `filteredByChannel` (ej.
  // filtraste a un branch que solo tiene préstamos Banked, y elegís ver
  // Brokered).
  const milestoneKeys = channel === 'banked' ? BANKED_MATRIX_COLUMNS : Object.keys(rates);

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="channel-segment">
          <button className={channel === 'banked' ? 'on' : ''} onClick={() => setChannel('banked')}>
            Banked - Retail
          </button>
          <button className={channel === 'brokered' ? 'on' : ''} onClick={() => setChannel('brokered')}>
            Brokered
          </button>
        </div>
        <div className="channel-segment">
          <button className={metricView === 'total' ? 'on' : ''} onClick={() => setMetricView('total')}>
            Total
          </button>
          <button className={metricView === 'healthy' ? 'on' : ''} onClick={() => setMetricView('healthy')}>
            Healthy
          </button>
        </div>
      </div>

      <div className="cards-head">Branch x Milestone Breakdown</div>
      <table className="piv">
        <thead>
          <tr className="mo-row">
            <th className="lbl">Branch</th>
            {milestoneKeys.map((k) => (
              <th key={k}>{labelFromKey(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredByChannel.map((row) => {
            const { total, healthy } = bucketsForRow(row, channel);
            const active = metricView === 'total' ? total : healthy;
            return (
              <tr className="metric" key={row.branch}>
                <td className="lbl">{row.branch}</td>
                {milestoneKeys.map((k) => (
                  <td className="val" key={k}>
                    {channel === 'banked' && isUnderwritingRawMilestone(k)
                      ? bankedRawMilestoneCount(row, k, metricView)
                      : bucketValue(active, k)}
                  </td>
                ))}
              </tr>
            );
          })}
          {!filteredByChannel.length && (
            <tr>
              <td className="lbl" style={{ color: 'var(--muted)', fontWeight: 500 }} colSpan={milestoneKeys.length + 1}>
                No branches for this channel.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="cards-head" style={{ marginTop: '24px' }}>
        Pull-through Cascade
      </div>
      <MilestoneCascade rows={cascadeRows} forecastTotal={sumForecast(cascadeRows)} />

      {/* Ajuste post-F6f: MilestoneCascade acá sigue en modo "sin desglose de
          cerrados" (no se le pasan closedCount/totalForecast) -- su "Total
          Forecast" es solo la proyección de pull-through, un número distinto
          al Forecast del banner/Executive (que sí suma cerrados). Se aclara
          con texto en vez de cambiar qué le pasamos al componente. */}
      <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '12px', marginBottom: '16px' }}>
        This total reflects pull-through projection only and does not include already-closed loans. See Executive Branch
        Forecast for the combined figure (closed + projection).
      </p>

      <div className="cards-head" style={{ marginTop: '20px' }}>
        Pull-Through Rates
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Object.keys(rates).length}, 1fr)`, gap: '12px' }}>
        {/*
         * PullThroughRates/BrokeredPullThroughRates (aggregate.ts, sin tocar) no
         * declaran index signature -- Object.entries(rates) igual compila (su
         * firma no la exige), pero el array resultante queda tipado [string,
         * unknown][] en vez de [string, number][]. Se angosta acá, en el punto
         * exacto donde se itera -- no se le miente a TS sobre la forma de
         * `rates` completo, solo sobre la forma de este array puntual. Si
         * PullThroughRates ganara un campo no numérico el día de mañana, esto
         * rompe en el iterado (acá), no se arrastra a asunciones sobre todo el
         * objeto.
         */}
        {(Object.entries(rates) as [string, number][]).map(([key, rate]) => (
          <div className="mcard" key={key}>
            <div className="m-name">{labelFromKey(key)}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{fmtPct(rate)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
