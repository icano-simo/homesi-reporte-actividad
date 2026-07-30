'use client';

import type { DateRange } from '@/lib/pipeline/aggregate';

export interface DateRangeInputProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

/**
 * Rango de fechas (Est. Closing Date) que decide qué préstamos cuentan como
 * "Cerrados" -- ver Decisiones en la respuesta de F4c. Cambiar cualquiera de
 * los dos inputs recalcula el Forecast en el navegador, sin volver a subir
 * el archivo (el estado ya parseado vive en page.tsx).
 */
export default function DateRangeInput({ value, onChange }: DateRangeInputProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <span className="label-chip">Cerrados entre</span>
      <input
        type="date"
        className="pill"
        value={value.startDate}
        onChange={(e) => onChange({ startDate: e.target.value, endDate: value.endDate })}
        style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
      />
      <span style={{ color: 'var(--muted)', fontSize: '13px' }}>y</span>
      <input
        type="date"
        className="pill"
        value={value.endDate}
        onChange={(e) => onChange({ startDate: value.startDate, endDate: e.target.value })}
        style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
      />
    </div>
  );
}
