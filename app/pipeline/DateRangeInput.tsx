'use client';

import type { DateRange } from '@/lib/pipeline/aggregate';

export interface DateRangeInputProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

/**
 * Rango de fechas de Pipeline -- ver Decisiones en la respuesta de F4c.
 * Etapa F4g: renombrado de "Cerrados entre" porque desde F4f este rango ya
 * no filtra solo Cerrados (Disbursement Date), también Total/Healthy
 * Pipeline (Est. Closing Date).
 * Etapa F5e: Cerrados/Forecast pasaron a MonthSelector.tsx, un control
 * independiente -- este rango solo controla Total/Healthy Pipeline y
 * Adverse. Etapa F5d: label traducido a "Pipeline Range" (antes "Rango del
 * Forecast" ya no era preciso desde F5e, y toda la UI pasa a inglés).
 * Cambiar cualquiera de los dos inputs recalcula el Forecast en el
 * navegador, sin volver a subir el archivo (el estado ya parseado vive en
 * page.tsx).
 */
export default function DateRangeInput({ value, onChange }: DateRangeInputProps) {
  return (
    // Etapa UX1: los inputs pasan de `.pill` + borde inline a la clase
    // compartida `.field` (components.css), la misma de todos los filtros.
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span className="label-chip">Pipeline Range</span>
      <input
        type="date"
        className="field"
        value={value.startDate}
        onChange={(e) => onChange({ startDate: e.target.value, endDate: value.endDate })}
      />
      <span style={{ color: 'var(--slate-400)', fontSize: '12px' }}>to</span>
      <input
        type="date"
        className="field"
        value={value.endDate}
        onChange={(e) => onChange({ startDate: value.startDate, endDate: e.target.value })}
      />
    </div>
  );
}
