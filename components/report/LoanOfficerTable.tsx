'use client';

import { useState, type ReactNode } from 'react';
import type { YearMonth } from '@/lib/parsing/types';
import type { Measure } from '@/lib/aggregation/types';
import type { LoanOfficerTree, LoanOfficerTreeItem } from '@/lib/aggregation/buildLoanOfficerTree';
import { METRICS, MONTH_NAMES, type MetricKey } from '@/config/metrics';
import { ChevronRightIcon } from '@/components/ui/icons';
import PivotRow from './PivotRow';

export interface LoanOfficerTableProps {
  tree: LoanOfficerTree;
  months: YearMonth[];
  measure: Measure;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  /** Etapa 12 (agregado): criterio de orden de la lista -- 'total' = suma de las 4 métricas (default), o una métrica específica. */
  sortBy: MetricKey | 'total';
  onSortByChange: (sortBy: MetricKey | 'total') => void;
}

function monthAbbrev(ym: YearMonth): string {
  return MONTH_NAMES[Number(ym.split('-')[1]) - 1].slice(0, 3);
}

/**
 * Duplicado deliberado del homónimo de PivotTable.tsx: ese archivo no está
 * en la lista de archivos a modificar de esta etapa, y la función no está
 * exportada -- se reutiliza el patrón visual (mismo JSX/clases), no el
 * código en sí.
 */
function YearHeaderCells({ months }: { months: YearMonth[] }) {
  const cells: ReactNode[] = [];
  let i = 0;
  while (i < months.length) {
    const year = months[i].split('-')[0];
    let span = 0;
    while (i + span < months.length && months[i + span].split('-')[0] === year) span++;
    cells.push(
      <th key={year + '-' + i} colSpan={span}>
        {year}
      </th>
    );
    i += span;
  }
  return <>{cells}</>;
}

function officerTotal(officer: LoanOfficerTreeItem, sortBy: MetricKey | 'total'): number {
  if (sortBy === 'total') return officer.metricGroups.reduce((sum, g) => sum + g.total, 0);
  return officer.metricGroups.find((g) => g.metric === sortBy)?.total ?? 0;
}

/**
 * Etapa 12 (agregado): solo cambia el criterio de ORDEN sobre los datos que
 * ya calculó buildLoanOfficerTree() -- no vuelve a computar ningún mapa ni
 * total nuevo, ni filtra nada distinto.
 */
function sortOfficers(officers: LoanOfficerTreeItem[], sortBy: MetricKey | 'total'): LoanOfficerTreeItem[] {
  return [...officers].sort((a, b) => officerTotal(b, sortBy) - officerTotal(a, sortBy) || a.name.localeCompare(b.name));
}

/**
 * Ajuste a Etapa 12: coincidencia parcial, insensible a mayúsculas/minúsculas,
 * sobre el nombre ya ordenado -- se llama DESPUÉS de sortOfficers(), nunca
 * antes, para que el orden entre los que quedan visibles no cambie.
 */
function filterOfficersByName(officers: LoanOfficerTreeItem[], searchText: string): LoanOfficerTreeItem[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return officers;
  return officers.filter((o) => o.name.toLowerCase().includes(needle));
}

function OfficerRows({
  officer,
  months,
  measure,
  collapsed,
  onToggleCollapse,
}: {
  officer: LoanOfficerTreeItem;
  months: YearMonth[];
  measure: Measure;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const officerId = 'lo::' + officer.name;
  const officerCollapsed = collapsed.has(officerId);

  return (
    <>
      <tr className="grp togg d1" onClick={() => onToggleCollapse(officerId)}>
        <td className="lbl">
          <span className="indent" style={{ width: '0px' }}></span>
          {/* Etapa UX1: chevron SVG en vez de "▸"/"▾" (spec §2). */}
          <span className={'chev' + (officerCollapsed ? '' : ' open')}>
            <ChevronRightIcon size={12} />
          </span>
          {officer.name}
        </td>
        <td colSpan={99}></td>
      </tr>
      {!officerCollapsed &&
        officer.metricGroups.map((g) => (
          <PivotRow
            key={g.metric}
            label={g.label}
            map={g.map}
            months={months}
            measure={measure}
            isClosedMetric={g.metric === 'cl'}
            rowClassName={'metric mrow' + (g.metric === 'cl' ? ' clm' : '')}
            indentPx={20}
          />
        ))}
    </>
  );
}

/**
 * Etapa 12: vista "Por Loan Officer" -- agrupa directamente por Loan
 * Officer cruzando todos los branches (buildLoanOfficerTree), sin nivel de
 * branch en medio. Mismo patrón visual que PivotTable/PivotRow (mismas
 * clases CSS: table.piv, tr.grp, tr.metric, .chev, etc.), jerarquía más
 * plana: Loan Officer (colapsable) -> sus 4 filas de métrica.
 *
 * Agregado (mismo alcance): control de orden arriba de la tabla -- reordena
 * `tree.officers` por el total de una métrica específica o por actividad
 * total (default), sin recalcular nada.
 *
 * Ajuste posterior: el control de orden pasó de botones a un único
 * <select> (mismo comportamiento, solo cambia el control visual), y se
 * agregó un buscador de texto (estado local, no persiste entre vistas --
 * no necesita vivir en app/page.tsx) que filtra por nombre DESPUÉS de
 * ordenar. Ninguno de los dos toca buildLoanOfficerTree ni ningún cálculo.
 */
export default function LoanOfficerTable({
  tree,
  months,
  measure,
  collapsed,
  onToggleCollapse,
  sortBy,
  onSortByChange,
}: LoanOfficerTableProps) {
  const [search, setSearch] = useState('');

  const sortedOfficers = sortOfficers(tree.officers, sortBy);
  const visibleOfficers = filterOfficersByName(sortedOfficers, search);

  return (
    <>
      {/* Etapa UX1: los estilos inline de estos 2 controles se reemplazaron por
          la clase compartida `.field` (components.css) -- misma apariencia que
          los filtros del Toolbar, en un solo lugar. */}
      <div className="table-tools">
        <span className="label-chip">Sort by</span>
        <select className="field" value={sortBy} onChange={(e) => onSortByChange(e.target.value as MetricKey | 'total')}>
          <option value="total">Total activity</option>
          {METRICS.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <span className="label-chip" style={{ marginLeft: '6px' }}>
          Search
        </span>
        <input
          type="text"
          className="field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Loan Officer name…"
          style={{ minWidth: '220px', cursor: 'text' }}
        />
      </div>

      {/* Etapa UX1: la tabla trae su propia tarjeta + contenedor de scroll, para
          que los controles de arriba queden FUERA del scroll horizontal. */}
      <div className="tbl-card">
        <div className="tbl-scroll">
          <table className="piv piv--tree" id="pivotLoanOfficer">
            <thead>
              <tr className="yr-row">
                <th className="lbl"></th>
                <YearHeaderCells months={months} />
                <th className="totcol"></th>
              </tr>
              <tr className="mo-row">
                <th className="lbl">Loan Officer</th>
                {months.map((ym) => (
                  <th key={ym}>{monthAbbrev(ym)}</th>
                ))}
                <th className="totcol">Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleOfficers.map((officer) => (
                <OfficerRows
                  key={officer.name}
                  officer={officer}
                  months={months}
                  measure={measure}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                />
              ))}

              {!sortedOfficers.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }}>
                    No Loan Officer with activity in the selected period.
                  </td>
                  <td colSpan={99}></td>
                </tr>
              )}

              {sortedOfficers.length > 0 && !visibleOfficers.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }}>
                    No Loan Officer matches the search.
                  </td>
                  <td colSpan={99}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
