'use client';

import { useState } from 'react';
import type { LoanOfficerForecastByPerson } from '@/lib/pipeline/loanOfficerForecast';

export interface LoanOfficerForecastTableProps {
  rows: LoanOfficerForecastByPerson[];
}

/**
 * Mismo patrón que filterOfficersByName() de components/report/
 * LoanOfficerTable.tsx -- coincidencia parcial, insensible a mayúsculas,
 * sin importar nada de ese archivo (componente aislado). `rows` ya llega
 * ordenado alfabéticamente (buildLoanOfficerForecastByPerson() ordena por
 * loanOfficer.localeCompare) -- el filtro se aplica DESPUÉS, así que el
 * orden entre los que quedan visibles no cambia al escribir.
 */
function filterByName(rows: LoanOfficerForecastByPerson[], searchText: string): LoanOfficerForecastByPerson[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.loanOfficer.toLowerCase().includes(needle));
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function LoanOfficerForecastTable({ rows }: LoanOfficerForecastTableProps) {
  const [search, setSearch] = useState('');
  const visibleRows = filterByName(rows, search);

  return (
    <>
      <div className="table-tools">
        <span className="label-chip">Search</span>
        <input
          type="text"
          className="field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Loan Officer name…"
          style={{ minWidth: '220px', cursor: 'text' }}
        />
      </div>

      <div className="tbl-card">
        <div className="tbl-scroll">
          <table className="piv">
            <thead>
              <tr className="mo-row">
                <th className="lbl">Loan Officer</th>
                <th>Total Count</th>
                <th>Healthy</th>
                <th>Closed</th>
                <th>Projected to Close</th>
                <th>Total Forecast</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr className="metric" key={row.loanOfficer}>
                  <td className="lbl" style={{ textAlign: 'left' }}>
                    {row.loanOfficer}
                  </td>
                  <td className="val">{fmtInt(row.totalCount)}</td>
                  <td className="val">{fmtInt(row.healthyCount)}</td>
                  <td className="val">{fmtInt(row.closedCount)}</td>
                  <td className="val">{fmtInt(row.projectedToClose)}</td>
                  <td className="val">{fmtInt(row.totalForecast)}</td>
                </tr>
              ))}
              {!visibleRows.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={6}>
                    No Loan Officer matches the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
