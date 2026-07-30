import { DEMO_LOANS, DEMO_RATES } from '@/fixtures/pipeline-demo';
import { splitHealthyTotal, countByMilestoneBucket, calculateForecast, type BucketCounts } from '@/lib/pipeline/aggregate';
import type { PipelineLoan } from '@/lib/pipeline/types';
import SummaryCards from './SummaryCards';
import MilestoneCascade from './MilestoneCascade';
import PivotTable, { type BranchForecastRow } from './PivotTable';

const EMPTY_BUCKETS: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };

function sumBuckets(a: BucketCounts, b: BucketCounts): BucketCounts {
  return {
    Started: a.Started + b.Started,
    Processing: a.Processing + b.Processing,
    Underwriting: a.Underwriting + b.Underwriting,
    Closing: a.Closing + b.Closing,
  };
}

/**
 * Página de Forecast (Etapa F3): componentes visuales sobre datos de
 * ejemplo (fixtures/pipeline-demo.ts). Todavía no conecta el parser real de
 * F1 ni Supabase -- eso es de una etapa posterior. No necesita 'use client'
 * porque no maneja estado: arma los datos server-side con aggregate.ts (F2,
 * sin tocar) y renderiza los 3 componentes cliente.
 */
export default function PipelinePage() {
  // Deriva los grupos branch+channel presentes en el fixture, sin asumir
  // ninguna lista fija de branches.
  const groups = new Map<string, { branch: string; channel: PipelineLoan['channel'] }>();
  for (const loan of DEMO_LOANS) {
    groups.set(loan.branch + '::' + loan.channel, { branch: loan.branch, channel: loan.channel });
  }

  const branchRows: BranchForecastRow[] = [...groups.values()].map(({ branch, channel }) => {
    const { total, healthy } = splitHealthyTotal(DEMO_LOANS, branch, channel);
    const bucketTotal = countByMilestoneBucket(total);
    const bucketHealthy = countByMilestoneBucket(healthy);
    const { forecastByBucket, forecastTotal } = calculateForecast(bucketHealthy, DEMO_RATES);
    return {
      branch,
      channel,
      totalCount: total.length,
      healthyCount: healthy.length,
      bucketTotal,
      bucketHealthy,
      forecastByBucket,
      forecastTotal,
      loans: total,
    };
  });

  const grandTotalCount = branchRows.reduce((sum, r) => sum + r.totalCount, 0);
  const grandHealthyCount = branchRows.reduce((sum, r) => sum + r.healthyCount, 0);
  const grandForecastTotal = branchRows.reduce((sum, r) => sum + r.forecastTotal, 0);
  const grandBucketTotal = branchRows.reduce((acc, r) => sumBuckets(acc, r.bucketTotal), EMPTY_BUCKETS);
  const grandBucketHealthy = branchRows.reduce((acc, r) => sumBuckets(acc, r.bucketHealthy), EMPTY_BUCKETS);
  const grandForecastByBucket = branchRows.reduce(
    (acc, r) => ({
      Started: acc.Started + r.forecastByBucket.Started,
      Processing: acc.Processing + r.forecastByBucket.Processing,
      Underwriting: acc.Underwriting + r.forecastByBucket.Underwriting,
      Closing: acc.Closing + r.forecastByBucket.Closing,
    }),
    { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 }
  );

  return (
    <div className="main">
      <div className="content">
        <h1 className="title">Forecast — Pipeline</h1>
        <div className="subtitle">
          Pull-through por branch: cascada de milestone visible en cada paso, sin números sueltos sin desglose detrás.
        </div>

        <SummaryCards totalCount={grandTotalCount} healthyCount={grandHealthyCount} forecastTotal={grandForecastTotal} />

        <div className="cards-head" style={{ marginTop: '24px' }}>
          Cascada de pull-through (todo el pipeline)
        </div>
        <MilestoneCascade
          bucketTotal={grandBucketTotal}
          bucketHealthy={grandBucketHealthy}
          forecastByBucket={grandForecastByBucket}
          forecastTotal={grandForecastTotal}
          rates={DEMO_RATES}
        />

        <div className="cards-head" style={{ marginTop: '24px' }}>
          Desglose por branch
        </div>
        <PivotTable rows={branchRows} />

        <div className="foot-note">
          Datos de ejemplo (fixture), todavía no conectados al parser real ni a Supabase. Cada número de la tabla por
          branch es clicable — por ahora solo imprime en la consola el detalle de préstamos de ese bucket.
        </div>
      </div>
    </div>
  );
}
