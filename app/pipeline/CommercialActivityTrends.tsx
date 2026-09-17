'use client';

import { useState } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import {
  buildCommercialActivityMonthlyTrends,
  computeCommercialActivityKpis,
  getDefaultTrendsFromMonth,
  getDistinctStrategies,
  getDistinctYears,
  type CommercialActivityMonthlyRow,
} from '@/lib/aggregation/commercialActivityTrends';
import { contiguous } from '@/lib/aggregation/months';
import { businessToday } from '@/lib/pipeline/period';
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
 * Desplaza un `YearMonth` `delta` meses (negativo = hacia atrás) -- misma
 * aritmética de calendario que ya usa `contiguous()` (lib/aggregation/
 * months.ts), generalizada a un solo mes en vez de un rango. No vive en
 * ese archivo compartido porque acá el único uso es interno a este
 * componente (armar el bloque de comparación de los KPIs); si otro
 * consumidor la necesitara, ahí sí se extraería.
 */
function shiftMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split('-');
  let y = Number(yStr);
  let m = Number(mStr) + delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return y + '-' + String(m).padStart(2, '0');
}

/**
 * El bloque de N meses INMEDIATAMENTE anterior a `currentRows` (misma
 * longitud), tomado de `allRows` (sin filtrar por Year -- el filtro de
 * Year sólo acota qué se MUESTRA, no qué existe para comparar). `null` si
 * falta aunque sea un mes de esos N en `allRows` -- `buildCommercialActivityMonthlyTrends`
 * sólo crea una fila cuando al menos una de las 3 columnas es > 0, así que
 * un mes ausente es indistinguible de "no hay historia hasta ahí": se trata
 * como bloque incompleto en los dos casos, nunca se rellena con ceros
 * inventados.
 */
function getPreviousComparableBlock(
  allRows: CommercialActivityMonthlyRow[],
  currentRows: CommercialActivityMonthlyRow[]
): CommercialActivityMonthlyRow[] | null {
  if (currentRows.length === 0) return null;
  const n = currentRows.length;
  const firstMonth = currentRows[0].month;
  const expectedMonths = contiguous(shiftMonth(firstMonth, -n), shiftMonth(firstMonth, -1));
  const byMonth = new Map(allRows.map((r) => [r.month, r] as const));
  const block: CommercialActivityMonthlyRow[] = [];
  for (const m of expectedMonths) {
    const row = byMonth.get(m);
    if (!row) return null;
    block.push(row);
  }
  return block;
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
  /*
   * `year === ''` -- sentinel de "sin selección explícita todavía", nunca
   * una opción visible del <select> (mismo criterio que el `start` de
   * components/report/Toolbar.tsx: un valor fuera de la lista, no un
   * elemento más de ella). Mientras esté en ese estado se aplica la regla
   * de mínimo 6 meses (`getDefaultTrendsFromMonth`); al elegir "All" pasa a
   * `'all'` (sin límite inferior) y al elegir un año puntual pasa a ese
   * año como string ('2026'), igual que `availableYears`/`year` de
   * app/page.tsx -- sin tocar ese archivo, solo el mismo formato de valor.
   */
  const [year, setYear] = useState<string>('');
  const strategies = getDistinctStrategies(records);
  const years = getDistinctYears(records);
  const allRows = buildCommercialActivityMonthlyTrends(records, strategy);
  const defaultStartMonth = getDefaultTrendsFromMonth(businessToday());
  const rows =
    year === 'all'
      ? allRows
      : year === ''
        ? allRows.filter((r) => r.month >= defaultStartMonth)
        : allRows.filter((r) => r.month.startsWith(year + '-'));
  const previousRows = getPreviousComparableBlock(allRows, rows);
  const kpis = computeCommercialActivityKpis(rows, previousRows);
  /*
   * Mes en curso (hora de negocio, Bogotá) -- `businessToday()`, nunca
   * `new Date()` suelto acá (mismo criterio que `defaultStartMonth` arriba).
   * `rows` puede o no incluirlo según Year/rango elegido: sólo entonces sus
   * totales son parciales (el mes real todavía no cerró).
   */
  const today = businessToday();
  const partialMonth = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const partialMonthVisible = rows.some((r) => r.month === partialMonth);

  return (
    <div>
      {partialMonthVisible && (
        <div className="kpi-hero__sub" style={{ marginBottom: '8px' }}>
          {shortMonth(partialMonth)} is in progress — totals include partial data.
        </div>
      )}
      <div className="hero-banner">
        <div className="mcard">
          <div className="m-name">File Creations</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{fmtInt(kpis.fileCreations.value)}</div>
        </div>
        <div className="mcard">
          <div className="m-name">Applications</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{fmtInt(kpis.applications.value)}</div>
        </div>
        <div className="mcard">
          <div className="m-name">File Creation → Credit Report</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{kpis.fcToCrRate.value.toFixed(1)}%</div>
          <div className="kpi-hero__sub">Same calendar month, not cohort-tracked</div>
        </div>
        <div className="mcard">
          <div className="m-name">Credit Report → Application</div>
          <div className="kpi-hero__value kpi-hero__value--lg">{kpis.crToApRate.value.toFixed(1)}%</div>
          <div className="kpi-hero__sub">Same calendar month, not cohort-tracked</div>
        </div>
      </div>

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

        <span className="label-chip">Year</span>
        <select className="field" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">{'Recent (' + shortMonth(defaultStartMonth) + ' ' + defaultStartMonth.slice(0, 4) + '+)'}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
          <option value="all">All years</option>
        </select>
      </div>

      <div className="tbl-card" style={{ padding: '16px' }}>
        <div className="tbl-card__head">
          <span className="tbl-card__title">Monthly Trends — File Creations, Credit Reports, Applications</span>
        </div>
        <CommercialActivityLineChart rows={rows} partialMonth={partialMonth} />
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
                    {row.month === partialMonth ? ' (partial)' : ''}
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
