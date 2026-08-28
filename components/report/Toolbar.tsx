'use client';

import type { Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';
import { STRATEGY_ORDER, type StrategyFilter } from '@/lib/domain/strategy';
import { ymLabel } from '@/lib/aggregation/months';
import { ExpandIcon, CollapseIcon } from '@/components/ui/icons';

/**
 * Etapa 2 (refacción de filtros): reemplaza el `view: 'main'|'b2b'|'loanOfficer'`
 * excluyente. `GroupBy` es el modo de PRESENTACIÓN (cómo se agrupa la tabla:
 * por Branch o por Loan Officer, cruzando branches) -- sigue siendo un único
 * valor a la vez, igual que `view`, porque conceptualmente sigue siendo una
 * elección de layout, no un filtro de datos. B2B y `ChannelFilter` son
 * FILTROS DE DATOS, combinables entre sí y con cualquier GroupBy -- viven
 * como estado independiente en app/page.tsx (b2bOnly: boolean, channelFilter),
 * no acá.
 */
export type GroupBy = 'branch' | 'loanOfficer';

/**
 * Mismos 2 valores que ya usa LoanRecord.loanInfoChannel (lib/domain/types.ts),
 * sin normalizar ni inventar uno nuevo -- 'all' es el estado "sin filtrar",
 * propio de este componente. `'empty'` (micro-etapa: Channel vacío como
 * categoría) es también un sentinel propio de este filtro, NO el valor real
 * -- representa `loanInfoChannel === ''` (7 loans confirmados con Isabella:
 * cuentan en File Creations/All channels pero no son Banked ni Brokered, y
 * NO se les asigna un channel artificialmente). El dato original en
 * LoanRecord sigue siendo `''`, nunca `'empty'`; el mapeo pasa por
 * app/page.tsx.
 */
export type ChannelFilter = 'all' | 'Banked - Retail' | 'Brokered' | 'empty';

export interface ToolbarProps {
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  /**
   * Filtro de datos (LoanRecord.strategy) -- etapa V3, reemplaza al booleano
   * `b2bOnly`. B2B deja de ser un interruptor aparte y pasa a ser UNO de los
   * cinco valores posibles, que es lo que realmente es.
   */
  strategyFilter: StrategyFilter;
  onStrategyFilterChange: (strategy: StrategyFilter) => void;
  /** Filtro de datos (LoanRecord.loanInfoChannel), independiente de groupBy y de strategyFilter. */
  channelFilter: ChannelFilter;
  onChannelFilterChange: (channel: ChannelFilter) => void;
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

/** Etapa 2: 2 opciones (antes 3 -- 'b2b' ya no es un modo de presentación, ver GroupBy arriba). */
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'branch', label: 'Branch × Metric' },
  { value: 'loanOfficer', label: 'Loan Officer' },
];

const MEASURE_OPTIONS: { value: Measure; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'amount', label: 'Volume ($)' },
];

/*
 * Etapa V3: pasa de `seg` de 2 botones a `select`, como Branch y Channel.
 * Con 6 opciones un segmentado ocuparía toda la fila y obligaría a leer las
 * cinco estrategias siempre, incluso para no elegir ninguna.
 *
 * ⚠ El orden sale de STRATEGY_ORDER, que es el de PRECEDENCIA, no el
 * alfabético. Ver lib/domain/strategy.ts: así el desplegable enseña la
 * jerarquía (Affinity gana sobre NPPM, NPPM sobre Recruitment, y así) sin que
 * haya que explicarla en ningún texto.
 */
const STRATEGY_OPTIONS: { value: StrategyFilter; label: string }[] = [
  { value: 'all', label: 'All strategies' },
  ...STRATEGY_ORDER.map((s) => ({ value: s as StrategyFilter, label: s })),
];

const CHANNEL_OPTIONS: { value: ChannelFilter; label: string }[] = [
  { value: 'all', label: 'All channels' },
  { value: 'Banked - Retail', label: 'Banked - Retail' },
  { value: 'Brokered', label: 'Brokered' },
  { value: 'empty', label: 'Empty / Unclassified' },
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
  groupBy,
  onGroupByChange,
  strategyFilter,
  onStrategyFilterChange,
  channelFilter,
  onChannelFilterChange,
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
      {/*
       * Ajuste de UX: la barra pasa de una sola fila (que en la práctica ya
       * se envolvía sola en 2-3 líneas según el ancho, sin ninguna
       * organización intencional) a 2 niveles explícitos vía `.control-bar__row`
       * -- mismos estilos existentes (.seg/.field/.label-chip/.mini-btn), sin
       * componentes nuevos:
       *   Nivel 1 -- configuración principal: Group by, Measure, B2B.
       *   Nivel 2 -- filtros: Branch, Channel, From, Year, y Expand/Collapse
       *   all al extremo derecho (mismo `justify-content: space-between` que
       *   ya usaba la barra entera).
       */}
      <div className="control-bar__row">
        <div className="control-group">
          <span className="label-chip">Group by</span>
          <div className="seg">
            {GROUP_BY_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={groupBy === option.value ? 'on' : ''}
                onClick={() => onGroupByChange(option.value)}
                aria-pressed={groupBy === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span className="label-chip">Measure</span>
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
          <span className="label-chip">Strategy</span>
          <select
            className="field"
            style={{ maxWidth: '180px' }}
            value={strategyFilter}
            onChange={(e) => onStrategyFilterChange(e.target.value as StrategyFilter)}
          >
            {STRATEGY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="control-bar__row control-bar__row--filters">
        <div className="control-group">
          {/* La agrupación "Loan Officer" cruza todos los branches por diseño --
              el filtro de Branch no aplica y se oculta (sin cambios desde Etapa 12,
              solo se renombró `view` a `groupBy`). */}
          {groupBy !== 'loanOfficer' && (
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

          <span className="label-chip" style={{ marginLeft: groupBy !== 'loanOfficer' ? '6px' : '0' }}>
            Channel
          </span>
          <select
            className="field"
            style={{ maxWidth: '170px' }}
            value={channelFilter}
            onChange={(e) => onChannelFilterChange(e.target.value as ChannelFilter)}
          >
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="label-chip" style={{ marginLeft: '6px' }}>
            From
          </span>
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
        </div>

        <div className="control-group">
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
    </div>
  );
}
