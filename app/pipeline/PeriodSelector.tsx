'use client';

import {
  businessToday,
  getDefaultQuarterSelection,
  getDefaultYtdSelection,
  periodLabel,
  type PeriodSelection,
} from '@/lib/pipeline/period';

export interface PeriodSelectorProps {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
}

const QUARTERS: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

/**
 * Selector de período (Mes / Quarter / Año a la fecha) -- Etapa F7, Parte 1.
 *
 * Diseñado para reusarse en las etapas F7 siguientes (scorecards,
 * tendencias): no sabe nada de rankings ni de `resolvedLoans`, solo produce
 * un `PeriodSelection` (ver lib/pipeline/period.ts) para que el caller decida
 * qué hacer con el rango.
 *
 * El modo (`.seg`, mismo control que ya usa el toggle de canal en
 * TabMilestoneMatrix.tsx) decide qué sub-control se muestra: `<input
 * type="month">` para Mes (mismo patrón que MonthSelector.tsx), año + quarter
 * para Quarter, y ningún control adicional para YTD -- "año a la fecha" es
 * siempre el año en curso hasta hoy, no un año a elegir.
 */
export default function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  function setMode(mode: PeriodSelection['mode']) {
    if (mode === value.mode) return;
    if (mode === 'month') {
      const today = businessToday();
      onChange({ mode: 'month', year: today.year, month: today.month });
      return;
    }
    if (mode === 'quarter') {
      onChange(getDefaultQuarterSelection());
      return;
    }
    onChange(getDefaultYtdSelection());
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span className="label-chip">Period</span>
      <div className="seg">
        <button type="button" className={value.mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
          Month
        </button>
        <button type="button" className={value.mode === 'quarter' ? 'on' : ''} onClick={() => setMode('quarter')}>
          Quarter
        </button>
        <button type="button" className={value.mode === 'ytd' ? 'on' : ''} onClick={() => setMode('ytd')}>
          Year to Date
        </button>
      </div>

      {value.mode === 'month' && (
        <input
          type="month"
          className="field"
          value={`${value.year}-${String(value.month).padStart(2, '0')}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split('-').map(Number);
            if (y && m) onChange({ mode: 'month', year: y, month: m });
          }}
        />
      )}

      {value.mode === 'quarter' && (
        <>
          <input
            type="number"
            className="field"
            style={{ width: '90px' }}
            value={value.year}
            onChange={(e) => {
              const y = Number(e.target.value);
              if (y) onChange({ mode: 'quarter', year: y, quarter: value.quarter });
            }}
          />
          <select
            className="field"
            value={value.quarter}
            onChange={(e) => onChange({ mode: 'quarter', year: value.year, quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}
          >
            {QUARTERS.map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
        </>
      )}

      {value.mode === 'ytd' && (
        <span className="foot-note" style={{ margin: 0 }}>
          {periodLabel(value)}
        </span>
      )}
    </div>
  );
}
