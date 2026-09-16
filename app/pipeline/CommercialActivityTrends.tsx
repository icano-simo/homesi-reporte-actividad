'use client';

import { useState } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import { buildCommercialActivityMonthlyTrends, getDistinctStrategies } from '@/lib/aggregation/commercialActivityTrends';
import { shortMonth } from '@/lib/business-plan/months';
import CommercialActivityLineChart from './CommercialActivityLineChart';

export interface CommercialActivityTrendsProps {
  records: LoanRecord[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * "2024-11" -> "Nov 2024" -- SOLO presentación, la clave interna (`row.month`,
 * el `YearMonth` crudo) sigue siendo la de orden/join, sin tocar. No hay una
 * función ya armada para este formato exacto en el repo: `monthYearLabel`
 * (components/report/LoanDetailModal.tsx) es privada de ese módulo Y usa
 * `MONTH_NAMES` completo ("November", config/metrics.ts) en vez de
 * abreviado. Se compone acá con `shortMonth` (lib/business-plan/months.ts,
 * ya exportada y ya importada por CommercialActivityLineChart en este mismo
 * directorio) en vez de duplicar un array de nombres de mes.
 */
function monthYearLabel(ym: string): string {
  return shortMonth(ym) + ' ' + ym.slice(0, 4);
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

      <div className="tbl-card" style={{ padding: '16px' }}>
        <div className="tbl-card__head">
          <span className="tbl-card__title">Monthly Trends — File Creations, Credit Reports, Applications</span>
        </div>
        <CommercialActivityLineChart rows={rows} />
      </div>

      <div className="tbl-card">
        <div className="tbl-card__head">
          <span className="tbl-card__title">Monthly Detail</span>
        </div>
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
                    {monthYearLabel(row.month)}
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
