'use client';

export interface MonthSelectorProps {
  /** 'YYYY-MM' -- formato nativo de <input type="month">. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * Etapa F5e: selector de UN SOLO MES, independiente del DateRange de
 * Pipeline (DateRangeInput.tsx) -- controla únicamente Cerrados y el
 * Forecast total (Disbursement Date). Cambiar este selector no afecta
 * Total/Healthy Pipeline ni la tabla de Adverse.
 *
 * <input type="month"> nativo en vez de reinventar un dropdown -- mismo
 * estilo (.pill/.label-chip) que ya usa DateRangeInput.tsx, sin CSS nuevo.
 */
export default function MonthSelector({ value, onChange }: MonthSelectorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span className="label-chip">Mes de Cerrados/Forecast</span>
      <input
        type="month"
        className="pill"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
      />
    </div>
  );
}
