'use client';

import { useState } from 'react';
import {
  splitHealthyTotal,
  countByMilestoneBucket,
  calculateForecast,
  calculateTotalForecastWithClosed,
  type BucketCounts,
  type PullThroughRates,
  type DateRange,
} from '@/lib/pipeline/aggregate';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import SummaryCards from './SummaryCards';
import MilestoneCascade from './MilestoneCascade';
import PivotTable, { type BranchForecastRow } from './PivotTable';
import UploadButton, { PIPELINE_FILE_INPUT_ID } from './UploadButton';
import DateRangeInput from './DateRangeInput';

/**
 * Etapa F4: mismos valores que DEMO_RATES (F3). El input editable en la UI
 * para estos 4 micro-% es una etapa futura, no aprobada todavía -- se
 * duplican acá en vez de importar fixtures/pipeline-demo.ts porque esta
 * página ya no depende del módulo de fixture (ver Decisiones en la
 * respuesta de F4).
 */
const PULL_THROUGH_RATES: PullThroughRates = {
  Started: 0.8923,
  Processing: 0.93,
  Underwriting: 0.8459,
  Closing: 0.95,
};

const EMPTY_BUCKETS: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };

function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Etapa F4c: default = día 1 del mes anterior al mes actual, hasta el
 * último día del mes actual (usa la fecha real del sistema, no un valor
 * fijo). Ej. hoy=29 julio 2026 -> 1 junio 2026 a 31 julio 2026.
 */
function getDefaultDateRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: formatDateLocal(start), endDate: formatDateLocal(end) };
}

function sumBuckets(a: BucketCounts, b: BucketCounts): BucketCounts {
  return {
    Started: a.Started + b.Started,
    Processing: a.Processing + b.Processing,
    Underwriting: a.Underwriting + b.Underwriting,
    Closing: a.Closing + b.Closing,
  };
}

interface ParseApiResponse {
  openLoans: PipelineLoan[];
  resolvedLoans: ResolvedLoan[];
  warnings: string[];
  formatDetected: 'A' | 'B';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Página de Forecast (Etapa F4, ampliada en F4b): integración real, sin
 * Supabase todavía (eso es F5). El usuario sube el Excel -> se parsea
 * server-side en /api/pipeline/parse (usa el parser de F1 sin tocarlo) ->
 * el cálculo de aggregate.ts (F2, puro, sin I/O) corre acá en el cliente
 * sobre el JSON ya recibido -> se renderiza con los componentes de F3
 * (ampliados en F4b para el desglose Cerrados+Proyección y por Loan
 * Officer). Los datos viven solo en memoria del navegador mientras dure la
 * sesión.
 */
export default function PipelinePage() {
  const [data, setData] = useState<ParseApiResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);

  async function handleFileSelected(file: File) {
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/pipeline/parse', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'No se pudo procesar el archivo.');
      }
      setData(body as ParseApiResponse);
      setFileName(file.name);
    } catch (err) {
      setError(errorMessage(err));
      setData(null);
      setFileName(null);
    } finally {
      setIsLoading(false);
    }
  }

  // Cálculo derivado -- igual que en F3, pero sobre data.openLoans (real) en
  // vez de DEMO_LOANS. aggregate.ts (F2) no se modificó: se llaman sus
  // mismas funciones exportadas.
  const branchRows: BranchForecastRow[] = [];
  if (data) {
    const groups = new Map<string, { branch: string; channel: PipelineLoan['channel'] }>();
    for (const loan of data.openLoans) {
      groups.set(loan.branch + '::' + loan.channel, { branch: loan.branch, channel: loan.channel });
    }
    for (const { branch, channel } of groups.values()) {
      const { total, healthy } = splitHealthyTotal(data.openLoans, branch, channel);
      const bucketTotal = countByMilestoneBucket(total);
      const bucketHealthy = countByMilestoneBucket(healthy);
      const { forecastByBucket, forecastTotal } = calculateForecast(bucketHealthy, PULL_THROUGH_RATES);
      branchRows.push({
        branch,
        channel,
        totalCount: total.length,
        healthyCount: healthy.length,
        bucketTotal,
        bucketHealthy,
        forecastByBucket,
        forecastTotal,
        loans: total,
      });
    }
  }

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

  // Etapa F4b: el Forecast del negocio real es Cerrados (Funded) + la
  // proyección de pull-through que ya calculaba aggregate.ts -- no la
  // proyección sola. calculateTotalForecastWithClosed() es la única función
  // nueva agregada a aggregate.ts en F4b; no toca ninguna de las 3 ya
  // aprobadas (splitHealthyTotal/countByMilestoneBucket/calculateForecast).
  const { closedCount, totalForecast } = data
    ? calculateTotalForecastWithClosed(data.resolvedLoans, grandForecastTotal, dateRange)
    : { closedCount: 0, totalForecast: 0 };

  // resolvedLoans (Funded/Adverse) no entran a ningún OTRO cálculo -- los
  // 'adverse' nunca se suman a nada; solo una línea informativa, sin tabla
  // ni drill-down (eso es una etapa futura).
  let resolvedSummary: string | null = null;
  if (data && data.resolvedLoans.length > 0) {
    const funded = data.resolvedLoans.filter((l) => l.status === 'funded').length;
    const adverse = data.resolvedLoans.filter((l) => l.status === 'adverse').length;
    resolvedSummary =
      'Además, ' +
      data.resolvedLoans.length.toLocaleString('en-US') +
      ' préstamos ya resueltos (' +
      adverse.toLocaleString('en-US') +
      ' adverse, ' +
      funded.toLocaleString('en-US') +
      ' funded) en este archivo -- no cuentan para el Forecast.';
  }

  return (
    <div className="main">
      <div className="topbar">
        <div className="toolbar-row">
          <span className="label-chip">Datos</span>
          <UploadButton onFileSelected={handleFileSelected} isLoading={isLoading} />
          <DateRangeInput value={dateRange} onChange={setDateRange} />
        </div>
        <div className="loaded-row">
          {fileName && <span className="pill">Archivo: {fileName}</span>}
          {data && <span className="pill">Formato detectado: {data.formatDetected}</span>}
          {data && <span className="pill">Préstamos abiertos: {data.openLoans.length.toLocaleString('en-US')}</span>}
          {error && <span className="pill warn">{error}</span>}
        </div>
      </div>

      <div className="content">
        <h1 className="title">Forecast — Pipeline</h1>
        <div className="subtitle">
          Pull-through por branch: cascada de milestone visible en cada paso, sin números sueltos sin desglose detrás.
        </div>

        {!data && !isLoading && (
          <div className="empty">
            <div className="drop-ic">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 3v5h5" />
                <path d="M14 3H6v18h12V8z" />
                <path d="M9 15h6M9 11h6" />
              </svg>
            </div>
            <h2>Carga el reporte de pipeline</h2>
            <p>
              Sube el Excel exportado de Salesforce (Formato A &quot;agrupado&quot; con Report Builder, o Formato B
              &quot;plano&quot; tipo Printable View). El formato se detecta solo.
            </p>
            <label className="btn primary" htmlFor={PIPELINE_FILE_INPUT_ID} style={{ display: 'inline-flex' }}>
              Seleccionar archivo
            </label>
          </div>
        )}

        {isLoading && (
          <div className="empty">
            <h2>Procesando archivo…</h2>
          </div>
        )}

        {data && (
          <>
            <SummaryCards
              totalCount={grandTotalCount}
              healthyCount={grandHealthyCount}
              forecastTotal={grandForecastTotal}
              closedCount={closedCount}
              totalForecast={totalForecast}
              closedDateRangeLabel={dateRange.startDate + ' a ' + dateRange.endDate}
            />

            <div className="cards-head" style={{ marginTop: '24px' }}>
              Cascada de pull-through (todo el pipeline)
            </div>
            <MilestoneCascade
              bucketTotal={grandBucketTotal}
              bucketHealthy={grandBucketHealthy}
              forecastByBucket={grandForecastByBucket}
              forecastTotal={grandForecastTotal}
              rates={PULL_THROUGH_RATES}
              closedCount={closedCount}
              totalForecast={totalForecast}
            />

            <div className="cards-head" style={{ marginTop: '24px' }}>
              Desglose por Branch + Loan Officer
            </div>
            <PivotTable rows={branchRows} resolvedLoans={data.resolvedLoans} rates={PULL_THROUGH_RATES} dateRange={dateRange} />

            {resolvedSummary && <div className="foot-note">{resolvedSummary}</div>}

            {data.warnings.length > 0 && (
              <div className="foot-note">
                <strong>
                  Warnings del parser ({data.warnings.length}):
                </strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                  {data.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
