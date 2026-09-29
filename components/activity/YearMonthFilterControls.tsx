'use client';

import type { YearMonthFilter } from '@/components/activity/useYearMonthFilter';
import { shortMonth } from '@/lib/business-plan/months';

export interface YearMonthFilterControlsProps {
  filter: YearMonthFilter;
}

/**
 * UI del filtro compartido Year + Month mode -- ver `useYearMonthFilter`
 * para la lógica. Mismo `<select className="field">` que ya usa el resto
 * de Analytics/Toolbar.tsx para Year, mismo `.seg` (toggle-group) para el
 * modo, con el dropdown de "Pick a Month" apareciendo sólo en ese modo.
 */
export default function YearMonthFilterControls({ filter }: YearMonthFilterControlsProps) {
  const { year, setYear, availableYears, monthsForYear, monthMode, setMonthMode, pickedMonth, setPickedMonth } = filter;

  return (
    <>
      <div className="control-group">
        <span className="label-chip">Year</span>
        <select className="field" value={year} onChange={(e) => setYear(e.target.value)}>
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <div className="control-group">
        <span className="label-chip">Months</span>
        <div className="seg">
          <button type="button" className={monthMode === 'current' ? 'on' : ''} onClick={() => setMonthMode('current')}>
            Current Month
          </button>
          <button type="button" className={monthMode === 'last3' ? 'on' : ''} onClick={() => setMonthMode('last3')}>
            Last 3 Months
          </button>
          <button type="button" className={monthMode === 'pick' ? 'on' : ''} onClick={() => setMonthMode('pick')}>
            Pick a Month
          </button>
        </div>
        {monthMode === 'pick' && (
          <select
            className="field"
            value={pickedMonth && monthsForYear.includes(pickedMonth) ? pickedMonth : monthsForYear[0] ?? ''}
            onChange={(e) => setPickedMonth(e.target.value)}
          >
            {monthsForYear.map((m) => (
              <option key={m} value={m}>
                {shortMonth(m)}
              </option>
            ))}
          </select>
        )}
      </div>
    </>
  );
}
