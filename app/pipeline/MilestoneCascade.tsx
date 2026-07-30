'use client';

import type { BucketCounts, ForecastByBucket, PullThroughRates } from '@/lib/pipeline/aggregate';

const BUCKET_ORDER: Array<keyof BucketCounts> = ['Started', 'Processing', 'Underwriting', 'Closing'];

/**
 * Qué tasas se multiplican para llegar al Forecast de cada bucket -- mismo
 * orden que calculateForecast() en aggregate.ts. Esto es solo para ETIQUETAR
 * el "% aplicado" en la UI; el número de Forecast que se muestra siempre
 * viene de aggregate.ts (forecastByBucket), nunca se recalcula acá.
 */
const CUMULATIVE_FACTORS: Record<keyof BucketCounts, Array<keyof PullThroughRates>> = {
  Started: ['Started', 'Processing', 'Underwriting', 'Closing'],
  Processing: ['Processing', 'Underwriting', 'Closing'],
  Underwriting: ['Underwriting', 'Closing'],
  Closing: ['Closing'],
};

export interface MilestoneCascadeProps {
  bucketTotal: BucketCounts;
  bucketHealthy: BucketCounts;
  forecastByBucket: ForecastByBucket;
  forecastTotal: number;
  rates: PullThroughRates;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function fmtForecast(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Tabla de trazabilidad del pull-through: por cada bucket de milestone,
 * conteo Healthy vs Total, la tasa acumulada aplicada, y el Forecast que
 * produce. Nada queda oculto detrás del número final -- ese es el requisito
 * de negocio no negociable de esta etapa.
 */
export default function MilestoneCascade({
  bucketTotal,
  bucketHealthy,
  forecastByBucket,
  forecastTotal,
  rates,
}: MilestoneCascadeProps) {
  return (
    <div className="tbl-card">
      <table className="piv">
        <thead>
          <tr className="mo-row">
            <th className="lbl">Milestone</th>
            <th>Healthy</th>
            <th>Total</th>
            <th>% aplicado</th>
            <th className="totcol">Forecast</th>
          </tr>
        </thead>
        <tbody>
          {BUCKET_ORDER.map((bucket) => {
            const cumulativeRate = CUMULATIVE_FACTORS[bucket].reduce((acc, key) => acc * rates[key], 1);
            return (
              <tr className="metric" key={bucket}>
                <td className="lbl mname">{bucket}</td>
                <td className="val">{fmtInt(bucketHealthy[bucket])}</td>
                <td className="val">{fmtInt(bucketTotal[bucket])}</td>
                <td className="val">{fmtPct(cumulativeRate)}</td>
                <td className="totcol">{fmtForecast(forecastByBucket[bucket])}</td>
              </tr>
            );
          })}
          <tr className="grp total">
            <td className="lbl">Forecast total</td>
            <td colSpan={3}></td>
            <td className="totcol">{fmtForecast(forecastTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
