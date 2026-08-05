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
  /** Ajuste post-F6h: estas 3 se mostraban antes de F6h en el loaded-row de page.tsx directamente -- se perdieron al mover ese bloque acá adentro, se restauran como props. */
  error?: string | null;
  formatDetected?: 'A' | 'B';
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

/**
 * Etapa F6b: barra superior del rediseño de Forecast -- compone los 3
 * controles que ya existían (UploadButton/DateRangeInput/MonthSelector, sin
 * tocar su lógica interna) más el selector de Branch nuevo. Componente
 * aislado todavía: page.tsx NO lo importa en esta etapa (eso es F6h) --
 * `selectedBranch`/`onSelectBranch` solo se exponen como props, el filtrado
 * real por branch se implementa en esa etapa futura.
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
    <div className="topbar">
      <div className="toolbar-row">
        <span className="label-chip">Data</span>
        <UploadButton onFileSelected={onFileSelected} isLoading={isLoading} />
        <DateRangeInput value={pipelineDateRange} onChange={onPipelineDateRangeChange} />
        <MonthSelector value={forecastMonth} onChange={onForecastMonthChange} />
        <span className="label-chip" style={{ marginLeft: '6px' }}>
          Branch
        </span>
        {/* .yb solo tiene estilo como descendiente de .yr (ver legacy-components.css)
            -- se envuelve el <select> en ese wrapper en vez de usar .yb suelto
            (que quedaría sin ningún estilo aplicado) o crear una clase nueva. */}
        <span className="yr">
          <select
            value={selectedBranch}
            onChange={(e) => onSelectBranch(e.target.value)}
            className="yb"
            style={{ cursor: 'pointer' }}
          >
            <option value="ALL">All Branches (Combined)</option>
            {availableBranches.map((b) => (
              <option key={b} value={b}>
                Branch {b}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="loaded-row">
        {fileName && <span className="pill">File: {fileName}</span>}
        {formatDetected && <span className="pill">Format detected: {formatDetected}</span>}
        {saveStatus === 'saving' && <span className="pill">Saving to Supabase…</span>}
        {saveStatus === 'saved' && <span className="pill">Saved to Supabase</span>}
        {saveStatus === 'error' && <span className="pill warn">Could not save to Supabase</span>}
        {error && <span className="pill warn">{error}</span>}
      </div>
    </div>
  );
}
