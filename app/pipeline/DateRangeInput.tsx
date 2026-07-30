'use client';

import type { DateRange } from '@/lib/pipeline/aggregate';

export interface DateRangeInputProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

/**
 * Rango de fechas del Forecast -- ver Decisiones en la respuesta de F4c.
 * Etapa F4g: renombrado de "Cerrados entre" porque desde F4f este rango ya
 * no filtra solo Cerrados (Disbursement Date), también Total/Healthy
 * Pipeline (Est. Closing Date). Cambiar cualquiera de los dos inputs
 * recalcula el Forecast en el navegador, sin volver a subir el archivo (el
 * estado ya parseado vive en page.tsx).
 */
export default function DateRangeInput({ value, onChange }: DateRangeInputProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <span className="label-chip">Rango del Forecast</span>
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
