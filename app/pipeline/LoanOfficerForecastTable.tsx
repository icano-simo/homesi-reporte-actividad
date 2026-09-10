'use client';

import { useState } from 'react';
import type { LoanOfficerForecastByPerson } from '@/lib/pipeline/loanOfficerForecast';
import LoanDetailModal, { type LoanDetailModalLoan } from './LoanDetailModal';
import { openLoanToModalLoan, closedLoanToModalLoan } from './PivotTable';

export interface LoanOfficerForecastTableProps {
  rows: LoanOfficerForecastByPerson[];
}

interface ModalState {
  context: string;
  metric: string;
  loans: LoanDetailModalLoan[];
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

/**
 * Duplicado deliberado de CountCell (PivotTable.tsx, no exportada) --
 * mismo criterio que YearHeaderCells en components/report/LoanOfficerTable.tsx:
 * se reusa el patrón visual (mismas clases CSS), no el código en sí.
 */
function CountCell({ value, onClick, variant }: { value: number; onClick: () => void; variant?: 'closed' }) {
  const base = variant === 'closed' ? 'cell-trigger cell-trigger--closed' : 'cell-trigger';
  if (value === 0) {
    return <span className={base + ' is-zero'}>0</span>;
  }
  return (
    <button type="button" className={base} onClick={onClick}>
      {fmtInt(value)}
    </button>
  );
}

export default function LoanOfficerForecastTable({ rows }: LoanOfficerForecastTableProps) {
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null);
  const visibleRows = filterByName(rows, search);

  /**
   * Fila de totales -- suma directa de los 5 números YA CALCULADOS que
   * muestra cada fila visible (nunca recalcula pull-through/forecast).
   * Sobre `visibleRows`, no sobre `rows`: si el buscador filtra, el total
   * se recalcula sobre el resultado filtrado, igual que el resto de la
   * tabla responde al mismo filtro.
   */
  const totals = visibleRows.reduce(
    (acc, row) => ({
      totalCount: acc.totalCount + row.totalCount,
      healthyCount: acc.healthyCount + row.healthyCount,
      closedCount: acc.closedCount + row.closedCount,
      projectedToClose: acc.projectedToClose + row.projectedToClose,
      totalForecast: acc.totalForecast + row.totalForecast,
    }),
    { totalCount: 0, healthyCount: 0, closedCount: 0, projectedToClose: 0, totalForecast: 0 }
  );

  /**
   * Total/Healthy/Closed abren el modal con los loans reales detrás del
   * número -- mismo criterio que "Combined Total by Branch" en
   * PivotTable.tsx. Projected to Close y Total Forecast NO son clickeables:
   * son valores calculados (apportionByWeight), no un conjunto de
   * préstamos -- misma regla que ya aplica esa tabla.
   */
  function openTotal(row: LoanOfficerForecastByPerson) {
    setModal({ context: 'Loan Officer — ' + row.loanOfficer, metric: 'Total Pipeline', loans: row.loans.map(openLoanToModalLoan) });
  }

  function openHealthy(row: LoanOfficerForecastByPerson) {
    setModal({
      context: 'Loan Officer — ' + row.loanOfficer,
      metric: 'Healthy Pipeline',
      loans: row.loans.filter((l) => l.healthy === true).map(openLoanToModalLoan),
    });
  }

  function openClosed(row: LoanOfficerForecastByPerson) {
    setModal({ context: 'Loan Officer — ' + row.loanOfficer, metric: 'Closed', loans: row.closedLoans.map(closedLoanToModalLoan) });
  }

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
          <table className="piv piv--loanofficer">
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
                <tr className="metric" key={row.loanOfficerKey}>
                  <td className="lbl" style={{ textAlign: 'left' }}>{row.loanOfficer}</td>
                  <td className="val"><CountCell value={row.totalCount} onClick={() => openTotal(row)} /></td>
                  <td className="val"><CountCell value={row.healthyCount} onClick={() => openHealthy(row)} /></td>
                  <td className="val"><CountCell value={row.closedCount} onClick={() => openClosed(row)} variant="closed" /></td>
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
              {/*
                Mismo tratamiento visual que "Combined Total by Branch"
                (PivotTable.tsx) -- `tr.grp.total` (components.css), no una
                clase nueva. No clickeable (sin modal): fuera de alcance por
                ahora, a diferencia de Total Count/Healthy/Closed de las
                filas normales.
              */}
              {visibleRows.length > 0 && (
                <tr className="grp total">
                  <td className="lbl">Total</td>
                  <td className="val">{fmtInt(totals.totalCount)}</td>
                  <td className="val">{fmtInt(totals.healthyCount)}</td>
                  <td className="val">{fmtInt(totals.closedCount)}</td>
                  <td className="val">{fmtInt(totals.projectedToClose)}</td>
                  <td className="val">{fmtInt(totals.totalForecast)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LoanDetailModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        context={modal?.context ?? ''}
        metric={modal?.metric ?? ''}
        loans={modal?.loans ?? []}
        showBranchColumn
        hiddenColumns={['loanOfficer']}
      />
    </>
  );
}
