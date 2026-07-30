'use client';

import type { PipelineLoan } from '@/lib/pipeline/types';
import type { BucketCounts, ForecastByBucket } from '@/lib/pipeline/aggregate';

const BUCKET_ORDER: Array<keyof BucketCounts> = ['Started', 'Processing', 'Underwriting', 'Closing'];

export interface BranchForecastRow {
  branch: string;
  channel: PipelineLoan['channel'];
  totalCount: number;
  healthyCount: number;
  bucketTotal: BucketCounts;
  bucketHealthy: BucketCounts;
  forecastByBucket: ForecastByBucket;
  forecastTotal: number;
  /** Loans de este branch+channel (total, no solo healthy) -- para el drill-down futuro. */
  loans: PipelineLoan[];
}

export interface PivotTableProps {
  rows: BranchForecastRow[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtForecast(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Preparado para el futuro (pedido explícito, NO implementar el panel de
 * detalle todavía): cada celda de conteo es clicable. Por ahora solo hace
 * console.log del branch + bucket + los sourceLoanId healthy/total de ese
 * grupo -- construir el modal/panel real es una etapa aparte, no aprobada.
 */
function handleBucketClick(row: BranchForecastRow, bucket: keyof BucketCounts) {
  const loansInBucket = row.loans.filter((loan) => loan.milestone === bucket);
  const healthyLoanIds = loansInBucket.filter((loan) => loan.healthy === true).map((loan) => loan.sourceLoanId);
  const allLoanIds = loansInBucket.map((loan) => loan.sourceLoanId);
  console.log('[Forecast] click en bucket', {
    branch: row.branch,
    channel: row.channel,
    bucket,
    healthyLoanIds,
    allLoanIds,
  });
}

function BucketCell({ row, bucket }: { row: BranchForecastRow; bucket: keyof BucketCounts }) {
  return (
    <td className="val">
      <button
        type="button"
        onClick={() => handleBucketClick(row, bucket)}
        title="Ver préstamos de este bucket (por ahora solo consola)"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          font: 'inherit',
          fontVariantNumeric: 'inherit',
          color: 'var(--accent)',
          padding: 0,
        }}
      >
        {fmtInt(row.bucketHealthy[bucket])} / {fmtInt(row.bucketTotal[bucket])}
      </button>
    </td>
  );
}

/**
 * Desglose por branch. Cada fila trae su chevron de expandir (decorativo
 * por ahora -- "no necesita funcionar de verdad todavía", así que se
 * muestra siempre "expandida": todos los buckets healthy/total ya están
 * visibles sin necesidad de hacer clic en nada).
 */
export default function PivotTable({ rows }: PivotTableProps) {
  return (
    <div className="tbl-card">
      <table className="piv">
        <thead>
          <tr className="mo-row">
            <th className="lbl">Branch / Canal</th>
            {BUCKET_ORDER.map((bucket) => (
              <th key={bucket}>{bucket}</th>
            ))}
            <th>Healthy</th>
            <th>Total</th>
            <th className="totcol">Forecast</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="metric mrow" key={row.branch + '::' + row.channel}>
              <td className="lbl mname">
                <span className="chev">▾</span>
                {row.branch}
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {row.channel}</span>
              </td>
              {BUCKET_ORDER.map((bucket) => (
                <BucketCell key={bucket} row={row} bucket={bucket} />
              ))}
              <td className="val">{fmtInt(row.healthyCount)}</td>
              <td className="val">{fmtInt(row.totalCount)}</td>
              <td className="totcol">{fmtForecast(row.forecastTotal)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="lbl" style={{ color: 'var(--muted)', fontWeight: 500 }}>
                Sin datos de pipeline.
              </td>
              <td colSpan={99}></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
