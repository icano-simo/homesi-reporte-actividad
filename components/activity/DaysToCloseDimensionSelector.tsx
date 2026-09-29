'use client';

import type { DaysToCloseGroupBy } from '@/lib/activity/daysToClosePivot';

export interface DaysToCloseDimensionSelectorProps {
  value: DaysToCloseGroupBy;
  onChange: (v: DaysToCloseGroupBy) => void;
}

/**
 * Extraído de `DaysToCloseTrends.tsx` (vivía inline ahí) -- queda exportado
 * porque ese archivo todavía lo necesita para 2 cosas que no son el
 * selector en sí: el label de la dimensión activa (`activeLabel`) y las
 * OTRAS 2 dimensiones que arma el modal de detalle (`otherDimensions`).
 * Ninguna de las dos se duplica -- las dos leen de este mismo array.
 */
export const DIMENSIONS: { key: DaysToCloseGroupBy; label: string }[] = [
  { key: 'branch', label: 'Branch' },
  { key: 'loanOfficer', label: 'Loan Officer' },
  { key: 'processor', label: 'Processor' },
];

/**
 * Mismo bloque `.control-group`/`.label-chip`/`.seg` que ya vivía inline en
 * `DaysToCloseTrends.tsx` -- mismas clases, mismo comportamiento, sin
 * cambio visual. Componente controlado, sin estado propio -- mismo patrón
 * que `Toolbar.tsx` (value/onChange, todo el estado vive en el caller).
 */
export default function DaysToCloseDimensionSelector({ value, onChange }: DaysToCloseDimensionSelectorProps) {
  return (
    <div className="control-group">
      <span className="label-chip">Group by</span>
      <div className="seg">
        {DIMENSIONS.map(({ key, label }) => (
          <button key={key} type="button" className={value === key ? 'on' : ''} onClick={() => onChange(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
