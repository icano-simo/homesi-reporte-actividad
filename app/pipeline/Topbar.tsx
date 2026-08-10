'use client';

import type { DateRange } from '@/lib/pipeline/aggregate';
import UploadButton from './UploadButton';
import DateRangeInput from './DateRangeInput';
import MonthSelector from './MonthSelector';

export interface TopbarProps {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
  fileName: string | null;
  pipelineDateRange: DateRange;
  onPipelineDateRangeChange: (range: DateRange) => void;
  forecastMonth: string;
  onForecastMonthChange: (month: string) => void;
  availableBranches: string[];
  /** 'ALL' o un branch code. */
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  error?: string | null;
  formatDetected?: 'A' | 'B';
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

/**
 * Barra de control de Forecast: compone los 3 controles que ya existían
 * (UploadButton / DateRangeInput / MonthSelector, sin tocar su lógica) más el
 * selector de Branch global.
 *
 * Etapa UX1: dejó de ser la franja gris `.topbar` a todo el ancho del layout
 * viejo -- ahora es la tarjeta blanca `.control-bar` (spec §3B) dentro del
 * contenedor de 1440px, con dos grupos (datos a la izquierda, filtros a la
 * derecha) y las pills de estado en una línea propia abajo. El <select> de
 * branch usa la clase compartida `.field` en vez del alias `.yb` envuelto en
 * `.yr`, que era un workaround del CSS legado.
 */
export default function Topbar({
  onFileSelected,
  isLoading,
  fileName,
  pipelineDateRange,
  onPipelineDateRangeChange,
  forecastMonth,
  onForecastMonthChange,
  availableBranches,
  selectedBranch,
  onSelectBranch,
  error,
  formatDetected,
  saveStatus,
}: TopbarProps) {
  return (
    <div className="control-bar">
      <div className="control-group">
        <span className="label-chip">Data</span>
        <UploadButton onFileSelected={onFileSelected} isLoading={isLoading} />
      </div>

      <div className="control-group">
        <DateRangeInput value={pipelineDateRange} onChange={onPipelineDateRangeChange} />
        <MonthSelector value={forecastMonth} onChange={onForecastMonthChange} />
        <span className="label-chip" style={{ marginLeft: '6px' }}>
          Branch
        </span>
        <select className="field" value={selectedBranch} onChange={(e) => onSelectBranch(e.target.value)}>
          <option value="ALL">All Branches (Combined)</option>
          {availableBranches.map((b) => (
            <option key={b} value={b}>
              Branch {b}
            </option>
          ))}
        </select>
      </div>

      <div className="control-bar__status">
        {fileName && <span className="pill">File: {fileName}</span>}
        {formatDetected && <span className="pill">Format detected: {formatDetected}</span>}
        {saveStatus === 'saving' && <span className="pill">Saving to Supabase…</span>}
        {saveStatus === 'saved' && <span className="pill ok">Saved to Supabase</span>}
        {saveStatus === 'error' && <span className="pill warn">Could not save to Supabase</span>}
        {error && <span className="pill warn">{error}</span>}
      </div>
    </div>
  );
}
