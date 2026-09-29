'use client';

import { Fragment } from 'react';
import type { DaysToCloseCell } from '@/lib/activity/daysToClosePivotCells';
import { GROUP_BY_LABEL, type DaysToCloseGroupBy } from '@/lib/activity/daysToClosePivot';
import type { YearMonth } from '@/lib/parsing/types';
import { MONTH_NAMES } from '@/config/metrics';

export interface DaysToClosePivotTableProps {
  cells: DaysToCloseCell[];
  groupBy: DaysToCloseGroupBy;
  /**
   * De dónde salen los meses a mostrar -- el ORDEN de este array ya no
   * importa (el componente los reordena de más reciente a más antiguo por
   * su cuenta, ver el comentario más abajo). El caller lo sigue derivando
   * de `cells` (`Array.from(new Set(cells.map(c => c.month)))`), sin
   * cambios de ese lado.
   */
  months: YearMonth[];
  /**
   * Drill-down (opcional): dispara al clickear un Count > 0 -- si no se
   * provee, ningún Count queda clicable (mismo patrón opcional que
   * `onDrillDown` en `components/report/PivotTable.tsx`).
   */
  onCountClick?: (month: YearMonth, groupKey: string, metric: 'appToCtc' | 'ctcToDisb') => void;
}

/**
 * '2026-09' -> 'September' -- mismo `MONTH_NAMES` que ya usa
 * `components/report/PivotTable.tsx` (config/metrics.ts), nombre completo,
 * SIN el año: el año ya lo fija el selector YEAR de `app/analytics/page.tsx`
 * (siempre un solo año a la vez), así que repetirlo acá era redundante --
 * verificado que este componente no arma el string con `Intl.DateTimeFormat`
 * ni ninguna otra fuente, sólo esta concatenación.
 */
function monthOnlyLabel(ym: YearMonth): string {
  const [, month] = ym.split('-');
  return MONTH_NAMES[Number(month) - 1];
}

/** Mismo criterio de siempre: `null` es '—', nunca 0. Count sí muestra 0 -- un conteo real de "ninguno", no "no sé". */
function fmtAvg(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

/**
 * ============================================================================
 * PIVOT MES × DIMENSIÓN, EN PANTALLA — calco de "Closing On Time - Trend"
 * ============================================================================
 *
 * Reescrito de la versión cross-tab (mes en filas, groupKey en columnas) a
 * esta: una fila de encabezado por mes, y debajo una fila PLANA por cada
 * groupKey que tuvo al menos una celda ese mes -- no una fila por cada
 * groupKey posible. El motivo del cambio: con ~18 branches, la versión
 * cross-tab dejaba cada celda en ~49px reales, mucho menos que los ~130px
 * que necesita "App→CTC: 28.6 (n=5)" -- confirmado con
 * `scrollWidth`/`clientWidth` en pantalla, no una sospecha. Esta forma no
 * tiene ese problema: cada fila es una sola línea con sus 5 columnas.
 *
 * Fila de mes: `tr.grp` (`app/styles/components.css`, clase GLOBAL del
 * sistema de diseño -- no exclusiva de Forecast/Pipeline aunque
 * `components/report/PivotTable.tsx` sea quien más la usa hoy). No se usa
 * `.mo-row` para esto: esa clase está scopeada a `table.piv thead .mo-row
 * th` en el CSS -- fuera del `<thead>` no aplica ningún estilo, así que
 * hubiera quedado sin el look de encabezado.
 *
 * Meses de más reciente a más antiguo -- el componente los ordena, el
 * `months` que llega ya no dicta el orden de filas. Dentro de cada mes,
 * groupKey en orden alfabético. Sin subtotal por mes en esta vuelta.
 *
 * Drill-down: los Count > 0 son clicables vía `.drill-value` (mismo patrón
 * ya usado en `PivotRow.tsx` para Forecast -- el `<span>` es el target del
 * click, no el `<td>` entero, así el highlight queda acotado al número).
 * Un Count === 0 nunca es clicable -- no amerita abrir un modal vacío.
 */
export default function DaysToClosePivotTable({ cells, groupBy, months, onCountClick }: DaysToClosePivotTableProps) {
  const groupByLabel = GROUP_BY_LABEL[groupBy];
  const orderedMonths = [...months].sort((a, b) => b.localeCompare(a));

  const cellsByMonth = new Map<YearMonth, DaysToCloseCell[]>();
  for (const cell of cells) {
    const list = cellsByMonth.get(cell.month);
    if (list) list.push(cell);
    else cellsByMonth.set(cell.month, [cell]);
  }
  for (const list of cellsByMonth.values()) {
    list.sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  }

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">Days to Close, by Month × {groupByLabel}</span>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <thead>
            <tr className="mo-row">
              <th className="lbl">{groupByLabel}</th>
              <th>Avg App→CTC</th>
              <th>Count</th>
              <th>Avg CTC→Disb</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {orderedMonths.map((month) => {
              const monthCells = cellsByMonth.get(month) ?? [];
              return (
                <Fragment key={month}>
                  <tr className="grp">
                    <td className="lbl" colSpan={5}>
                      {monthOnlyLabel(month)}
                    </td>
                  </tr>
                  {monthCells.map((cell) => (
                    <tr className="metric" key={month + '::' + cell.groupKey}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {cell.groupKey}
                      </td>
                      <td className="val">{fmtAvg(cell.avgAppToCtc)}</td>
                      <td className="val">
                        {onCountClick && cell.countAppToCtc > 0 ? (
                          <span
                            className="drill-value"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCountClick(month, cell.groupKey, 'appToCtc');
                            }}
                          >
                            {cell.countAppToCtc}
                          </span>
                        ) : (
                          cell.countAppToCtc
                        )}
                      </td>
                      <td className="val">{fmtAvg(cell.avgCtcToDisbursement)}</td>
                      <td className="val">
                        {onCountClick && cell.countCtcToDisbursement > 0 ? (
                          <span
                            className="drill-value"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCountClick(month, cell.groupKey, 'ctcToDisb');
                            }}
                          >
                            {cell.countCtcToDisbursement}
                          </span>
                        ) : (
                          cell.countCtcToDisbursement
                        )}
                      </td>
                    </tr>
                  ))}
                  {!monthCells.length && (
                    <tr>
                      <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={5}>
                        No {groupByLabel.toLowerCase()} with data this month.
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!orderedMonths.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={5}>
                  No months to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
