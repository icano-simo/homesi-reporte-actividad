'use client';

import { Fragment } from 'react';
import type { OnTimeDelayedGroupCell } from '@/lib/activity/onTimeDelayed';
import { GROUP_BY_LABEL, type DaysToCloseGroupBy } from '@/lib/activity/daysToClosePivot';
import type { YearMonth } from '@/lib/parsing/types';
import { MONTH_NAMES } from '@/config/metrics';
import { AlertTriangleIcon } from '@/components/ui/icons';
import { unknownExcludedNote } from '@/lib/activity/onTimeDelayedNote';

export interface OnTimeDelayedTableProps {
  cells: OnTimeDelayedGroupCell[];
  /**
   * Etapa ON-TIME-GROUPBY-1 -- MISMO estado compartido que ya usan
   * `DurationKpiCards`/`DaysToClosePivotTable` (`pivotGroupBy` en
   * `page.tsx`), no un selector propio: esta tabla ya no está fija "by
   * Month × Branch" -- sigue la dimensión activa. Decide el rótulo de
   * columna/título (`GROUP_BY_LABEL`, mismo mapa que usa
   * `DaysToClosePivotTable.tsx`, importado y no reescrito).
   */
  groupBy: DaysToCloseGroupBy;
  /** De dónde salen los meses a mostrar -- el componente los reordena de más reciente a más antiguo por su cuenta (mismo criterio que DaysToClosePivotTable). */
  months: YearMonth[];
  /**
   * Drill-down (opcional) -- dispara al clickear el Count de On Time O de
   * Delayed (los 2 llevan a LA MISMA celda, mismo criterio que
   * `OnTimeDelayedDrillDown`: acá no hay "metric" que distinguir, es la
   * celda groupKey × mes entera). Sin este prop, ningún Count queda
   * clicable -- mismo patrón opcional que `onCountClick` en
   * `DaysToClosePivotTable.tsx`.
   */
  onCellClick?: (month: YearMonth, groupKey: string) => void;
}

/** '2026-09' -> 'September' -- mismo `MONTH_NAMES` sin año que ya usa `DaysToClosePivotTable.tsx` (el año ya lo fija el selector Year de la página). */
function monthOnlyLabel(ym: YearMonth): string {
  const [, month] = ym.split('-');
  return MONTH_NAMES[Number(month) - 1];
}

/** `null` es '—', nunca 0 -- "no hubo Delayed para promediar" no es lo mismo que "el atraso promedio fue 0 días". Mismo criterio que fmtAvg en el resto del módulo. */
function fmtPct(n: number | null): string {
  return n === null ? '—' : n.toFixed(1) + '%';
}

function fmtDays(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

/** "1 loan has..."/"3 loans have..." -- mismo criterio de concordancia singular/plural que ya usa personDiagnosticsNote en TabAnalytics.tsx, nunca "loan(s)" literal en pantalla. */
function unknownTooltip(count: number): string {
  return count === 1
    ? '1 loan has no original closing estimate on file'
    : `${count} loans have no original closing estimate on file`;
}

/**
 * ============================================================================
 * ON TIME / DELAYED, POR MES × BRANCH — EN PANTALLA
 * ============================================================================
 *
 * Vista SEPARADA del pivot de Days to Close (App→CTC/CTC→Disb) -- misma
 * forma plana (fila de mes + una fila por groupKey con dato ese mes, calcada
 * de `DaysToClosePivotTable.tsx`), pero nunca en la misma tabla: son 2
 * preguntas de negocio distintas (cuánto tardó vs. si llegó a tiempo contra
 * su propia estimación original).
 *
 * Etapa ON-TIME-GROUPBY-1 -- corrección de alcance de una etapa anterior,
 * que había dejado esta tabla fija "by Month × Branch" sin importar el
 * `pivotGroupBy` de la página. Ahora sigue la MISMA dimensión que
 * `DaysToClosePivotTable` (prop `groupBy`, ver arriba) -- `cells` ya llega
 * agrupado por esa dimensión (`computeOnTimeDelayedByMonthAndGroup` en
 * `page.tsx`), este componente sólo decide el rótulo.
 *
 * Etapa ACTIVITY-COLLAPSE-1: Unknown deja de tener columna propia -- con
 * `avgDaysLate` ya angosto y "% On Time"/"% Delayed" al lado, una 7ma
 * columna que en la mayoría de las filas vale 0 era ruido visual constante
 * para una excepción (pedido explícito de Heather). El dato NO se pierde:
 * - por fila, cuando `countUnknown > 0`, un ícono de advertencia junto al
 *   nombre del branch (mismo `AlertTriangleIcon` + tooltip nativo que ya
 *   usa `ScorecardTable`/`personDiagnosticsNote` en TabAnalytics.tsx para
 *   el mismo tipo de aviso -- "dato real, pero no en la columna
 *   principal") -- ausente por completo cuando `countUnknown === 0`, cero
 *   ruido.
 * - agregado, al pie de la tabla: una nota con el total de Unknown del
 *   CORTE VISIBLE (`cells`, que la página ya filtra por el mes/año
 *   elegido) -- se recalcula solo con el filtro, sin que este componente
 *   sepa que existe un filtro de mes.
 *
 * `avgDaysLate` es SIEMPRE positivo y SOLO del bucket Delayed -- nunca un
 * promedio con signo ni combinado con On Time. El % sigue calculándose
 * SOLO sobre On Time + Delayed (ver `onTimeDelayed.ts`) -- sin cambios acá,
 * esta etapa es sólo de presentación.
 */
export default function OnTimeDelayedTable({ cells, groupBy, months, onCellClick }: OnTimeDelayedTableProps) {
  const groupByLabel = GROUP_BY_LABEL[groupBy];
  const orderedMonths = [...months].sort((a, b) => b.localeCompare(a));

  const cellsByMonth = new Map<YearMonth, OnTimeDelayedGroupCell[]>();
  for (const cell of cells) {
    const list = cellsByMonth.get(cell.month);
    if (list) list.push(cell);
    else cellsByMonth.set(cell.month, [cell]);
  }
  for (const list of cellsByMonth.values()) {
    list.sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  }

  /** Total del corte VISIBLE -- suma sobre `cells` tal cual llega (ya filtrado por mes/año por el caller), nunca sobre un total global fijo. */
  const totalUnknown = cells.reduce((sum, c) => sum + c.countUnknown, 0);

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">On Time / Delayed, by Month × {groupByLabel}</span>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <thead>
            <tr className="mo-row">
              <th className="lbl">{groupByLabel}</th>
              <th>On Time</th>
              <th>Delayed</th>
              <th>% On Time</th>
              <th>% Delayed</th>
              <th>Avg Days Late</th>
            </tr>
          </thead>
          <tbody>
            {orderedMonths.map((month) => {
              const monthCells = cellsByMonth.get(month) ?? [];
              return (
                <Fragment key={month}>
                  <tr className="grp">
                    <td className="lbl" colSpan={6}>
                      {monthOnlyLabel(month)}
                    </td>
                  </tr>
                  {monthCells.map((cell) => (
                    <tr className="metric" key={month + '::' + cell.groupKey}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {cell.groupKey}
                        {cell.countUnknown > 0 && (
                          <span
                            title={unknownTooltip(cell.countUnknown)}
                            style={{
                              marginLeft: '6px',
                              color: 'var(--amber-700)',
                              cursor: 'help',
                              display: 'inline-flex',
                              verticalAlign: 'middle',
                            }}
                          >
                            <AlertTriangleIcon size={12} />
                          </span>
                        )}
                      </td>
                      <td className="val">
                        {onCellClick && cell.countOnTime > 0 ? (
                          <span className="drill-value" onClick={(e) => { e.stopPropagation(); onCellClick(cell.month, cell.groupKey); }}>
                            {cell.countOnTime}
                          </span>
                        ) : (
                          cell.countOnTime
                        )}
                      </td>
                      <td className="val">
                        {onCellClick && cell.countDelayed > 0 ? (
                          <span className="drill-value" onClick={(e) => { e.stopPropagation(); onCellClick(cell.month, cell.groupKey); }}>
                            {cell.countDelayed}
                          </span>
                        ) : (
                          cell.countDelayed
                        )}
                      </td>
                      <td className="val">{fmtPct(cell.pctOnTime)}</td>
                      <td className="val">{fmtPct(cell.pctDelayed)}</td>
                      <td className="val">{fmtDays(cell.avgDaysLate)}</td>
                    </tr>
                  ))}
                  {!monthCells.length && (
                    <tr>
                      <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={6}>
                        No {groupByLabel.toLowerCase()} with data this month.
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!orderedMonths.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={6}>
                  No months to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalUnknown > 0 && (
        <p className="foot-note" style={{ margin: '10px 16px 0' }}>
          {unknownExcludedNote(totalUnknown)}
        </p>
      )}
    </div>
  );
}
