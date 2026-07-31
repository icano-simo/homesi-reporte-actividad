'use client';

import type { Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';
import { ymLabel } from '@/lib/aggregation/months';

export interface ToolbarProps {
  view: 'main' | 'b2b' | 'loanOfficer';
  onViewChange: (view: 'main' | 'b2b' | 'loanOfficer') => void;
  measure: Measure;
  onMeasureChange: (measure: Measure) => void;
  branchFilter: Branch | 'all';
  onBranchFilterChange: (branch: Branch | 'all') => void;
  year: 'all' | string;
  onYearChange: (year: 'all' | string) => void;
  start: YearMonth | null;
  onStartChange: (start: YearMonth | null) => void;
  availableBranches: Branch[];
  availableYears: string[];
  months: YearMonth[];
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/**
 * Controles de filtro del reporte (Ver por / Medida / Branch / Desde / Año)
 * como componente controlado: todo el estado vive en app/page.tsx, este
 * componente solo dispara los callbacks -- port de los segmented controls
 * del topbar y de .table-tools (branchSel/startSel/yrFilter) del legacy.
 *
 * Consolidados en un único bloque porque este componente recibe un solo
 * lugar de montaje: en el legacy, Ver por/Medida viven en el topbar y
 * Branch/Desde/Año viven en .table-tools (arriba de la tabla), en dos
 * lugares distintos del DOM. "Expandir todo"/"Colapsar todo" (Etapa 8)
 * solo vacían o llenan el Set `collapsed` de app/page.tsx -- el propio
 * colapso lo aplican PivotTable/PivotRow.
 */
export default function Toolbar({
  view,
  onViewChange,
  measure,
  onMeasureChange,
  branchFilter,
  onBranchFilterChange,
  year,
  onYearChange,
  start,
  onStartChange,
  availableBranches,
  availableYears,
  months,
  onExpandAll,
  onCollapseAll,
}: ToolbarProps) {
  return (
    <div className="table-tools">
      <button className="mini-btn" onClick={onExpandAll}>
        Expandir todo
      </button>
      <button className="mini-btn" onClick={onCollapseAll}>
        Colapsar todo
      </button>

      <span className="label-chip">Ver por</span>
      <div className="seg">
        <button className={view === 'main' ? 'on' : ''} onClick={() => onViewChange('main')}>
          Branch × Métrica
        </button>
        <button className={view === 'b2b' ? 'on' : ''} onClick={() => onViewChange('b2b')}>
          B2B
        </button>
        <button className={view === 'loanOfficer' ? 'on' : ''} onClick={() => onViewChange('loanOfficer')}>
          Loan Officer
        </button>
      </div>

      <span className="label-chip" style={{ marginLeft: '6px' }}>
        Medida
      </span>
      <div className="seg">
        <button className={measure === 'count' ? 'on' : ''} onClick={() => onMeasureChange('count')}>
          Cantidad
        </button>
        <button className={measure === 'amount' ? 'on' : ''} onClick={() => onMeasureChange('amount')}>
          Monto&nbsp;($)
        </button>
      </div>

      <span style={{ flex: '1' }}></span>

      {/* Etapa 12: la vista "Por Loan Officer" cruza todos los branches por diseño -- el filtro de Branch no aplica y se oculta. */}
      {view !== 'loanOfficer' && (
        <>
          <span className="label-chip">Branch</span>
          <select
            className="yb"
            style={{ cursor: 'pointer', maxWidth: '170px' }}
            value={branchFilter}
            onChange={(e) => onBranchFilterChange(e.target.value)}
          >
            <option value="all">Todos los branches</option>
            {availableBranches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </>
      )}

      <span className="label-chip">Desde</span>
      <select
        className="yb"
        style={{ cursor: 'pointer' }}
        value={start ?? ''}
        onChange={(e) => onStartChange(e.target.value || null)}
      >
        <option value="">{'Inicio (' + (months.length ? ymLabel(months[0]) : '') + ')'}</option>
        {months.map((ym) => (
          <option key={ym} value={ym}>
            {ymLabel(ym)}
          </option>
        ))}
      </select>

      <span className="label-chip">Año</span>
      <div className="yr">
        <button className={'yb' + (year === 'all' ? ' on' : '')} onClick={() => onYearChange('all')}>
          Todos
        </button>
        {availableYears.map((y) => (
          <button key={y} className={'yb' + (year === y ? ' on' : '')} onClick={() => onYearChange(y)}>
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}
