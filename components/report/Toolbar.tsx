'use client';

import type { Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';
import { ymLabel } from '@/lib/aggregation/months';
import { ExpandIcon, CollapseIcon } from '@/components/ui/icons';

export type ReportView = 'main' | 'b2b' | 'loanOfficer';

export interface ToolbarProps {
  view: ReportView;
  onViewChange: (view: ReportView) => void;
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
 * Etapa UX1: las 3 vistas dejan de estar hardcodeadas en el JSX (3 <button>
 * casi idénticos) y pasan a una tabla de datos -- agregar una cuarta vista
 * ahora es una línea acá, no otro bloque copiado.
 */
const VIEW_OPTIONS: { value: ReportView; label: string }[] = [
  { value: 'main', label: 'Branch × Metric' },
  { value: 'b2b', label: 'B2B' },
  { value: 'loanOfficer', label: 'Loan Officer' },
];

const MEASURE_OPTIONS: { value: Measure; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'amount', label: 'Volume ($)' },
];

/**
 * Control & Filter Toolbar (spec §3B).
 *
 * Componente controlado: todo el estado sigue viviendo en app/page.tsx, este
 * componente solo dispara callbacks -- sin cambios respecto de antes.
 *
 * Etapa UX1, qué cambió:
 *  - Todo el contenido se consolidó en UNA tarjeta blanca (`.control-bar`) con
 *    dos grupos (selectores a la izquierda, filtros a la derecha), en vez de
 *    la fila suelta `.table-tools` sobre el fondo de la página.
 *  - Textos a inglés ("Ver por" -> "View by", "Medida" -> "Measure",
 *    "Cantidad/Monto" -> "Count/Volume ($)", etc.).
 *  - El filtro de Año pasó de una fila de botones a un <select> redondeado,
 *    como pide el spec para Branch y Year. El comportamiento es idéntico:
 *    'all' o un año concreto.
 *  - Expandir/Colapsar todo llevan icono SVG en vez de texto pelado.
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
    <div className="control-bar">
      <div className="control-group">
        <span className="label-chip">View by</span>
        <div className="seg">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={view === option.value ? 'on' : ''}
              onClick={() => onViewChange(option.value)}
              aria-pressed={view === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="label-chip" style={{ marginLeft: '6px' }}>
          Measure
        </span>
        <div className="seg">
          {MEASURE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={measure === option.value ? 'on' : ''}
              onClick={() => onMeasureChange(option.value)}
              aria-pressed={measure === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        {/* La vista "Loan Officer" cruza todos los branches por diseño -- el
            filtro de Branch no aplica y se oculta (sin cambios desde Etapa 12). */}
        {view !== 'loanOfficer' && (
          <>
            <span className="label-chip">Branch</span>
            <select
              className="field"
              style={{ maxWidth: '180px' }}
              value={branchFilter}
              onChange={(e) => onBranchFilterChange(e.target.value)}
            >
              <option value="all">All branches</option>
              {availableBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </>
        )}

        <span className="label-chip">From</span>
        <select className="field" value={start ?? ''} onChange={(e) => onStartChange(e.target.value || null)}>
          <option value="">{'Start (' + (months.length ? ymLabel(months[0]) : '—') + ')'}</option>
          {months.map((ym) => (
            <option key={ym} value={ym}>
              {ymLabel(ym)}
            </option>
          ))}
        </select>

        <span className="label-chip">Year</span>
        <select className="field" value={year} onChange={(e) => onYearChange(e.target.value)}>
          <option value="all">All years</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <span style={{ width: '1px', height: '22px', background: 'var(--slate-200)', margin: '0 2px' }} />

        <button className="mini-btn" onClick={onExpandAll}>
          <ExpandIcon size={13} />
          Expand all
        </button>
        <button className="mini-btn" onClick={onCollapseAll}>
          <CollapseIcon size={13} />
          Collapse all
        </button>
      </div>
    </div>
  );
}
