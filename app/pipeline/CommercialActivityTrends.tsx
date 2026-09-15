'use client';

import { useState } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import { buildCommercialActivityMonthlyTrends, getDistinctStrategies } from '@/lib/aggregation/commercialActivityTrends';
import CommercialActivityLineChart from './CommercialActivityLineChart';

export interface CommercialActivityTrendsProps {
  records: LoanRecord[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * ============================================================================
 * COMMERCIAL ACTIVITY EN ANALYTICS — Trends (File Creations / Credit Reports
 * / Applications) — ARCHIVO NUEVO, PIEZA 1
 * ============================================================================
 *
 * Vive en `app/pipeline/` junto a `TabAnalytics.tsx` -- mismo criterio ya
 * documentado ahí ("sin mover", ver docs/ARQUITECTURA.md): los componentes
 * de vista de Analytics conviven en esta carpeta sin importar qué ruta los
 * monta. Este archivo NO importa nada de `TabAnalytics.tsx` ni lo modifica --
 * "no tocar Closing" se cumple también a nivel de archivo, no solo de lógica.
 *
 * El gráfico de líneas (`CommercialActivityLineChart`, mismo directorio) es
 * un componente NUEVO e independiente -- no `AvgTicketChart` generalizado.
 * Ver el comentario de cabecera de ese archivo para el porqué.
 */
export default function CommercialActivityTrends({ records }: CommercialActivityTrendsProps) {
  const [strategy, setStrategy] = useState<string>('all');
  const strategies = getDistinctStrategies(records);
  const rows = buildCommercialActivityMonthlyTrends(records, strategy);

  return (
    <div>
      <div className="control-group">
        <span className="label-chip">Strategy</span>
        <select className="field" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          <option value="all">All strategies</option>
          {strategies.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <CommercialActivityLineChart rows={rows} />

      <div className="tbl-card">
        <div className="tbl-scroll">
          <table className="piv">
            <thead>
              <tr className="mo-row">
                <th className="lbl">Month</th>
                <th>File Creations</th>
                <th>Credit Reports</th>
                <th>Applications</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="metric" key={row.month}>
                  <td className="lbl" style={{ textAlign: 'left' }}>
                    {row.month}
                  </td>
                  <td className="val">{fmtInt(row.fileCreations)}</td>
                  <td className="val">{fmtInt(row.creditReports)}</td>
                  <td className="val">{fmtInt(row.applications)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={4}>
                    No records for this strategy.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
