'use client';

export interface TopbarProps {
  availableBranches: string[];
  /** 'ALL' o un branch code. */
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  error?: string | null;
  /**
   * "Updated on DD/MM/YYYY at HH:MM", ya formateado por page.tsx.
   *
   * Llega armado y no como fecha cruda a propósito: el formato depende de la
   * zona de quien mira, así que se calcula del lado del cliente después de
   * montar. Acá sólo se pinta.
   */
  lastUpdatedLabel?: string | null;
}

/**
 * Barra de control de Forecast: Branch global + el estado de actualización
 * del snapshot.
 *
 * Etapa PIPELINE-RANGE-AUTO: se eliminan Pipeline Range y el botón de
 * Settings que los alojaba (`fc-params__toggle`/`fc-params`) -- Pipeline
 * Range dejó de ser un parámetro que el usuario ajusta (ver page.tsx,
 * pipelineRangeFromForecastMonth). Forecast Month ya había salido de aquí
 * en la Etapa FORECAST-MONTH-VISIBLE. Sin ningún parámetro "avanzado" que
 * quede, el botón de Settings no tenía nada que mostrar -- se elimina, no
 * se deja vacío.
 */
export default function Topbar({
  availableBranches,
  selectedBranch,
  onSelectBranch,
  error,
  lastUpdatedLabel,
}: TopbarProps) {
  return (
    <div className="control-bar">
      <div className="control-bar__row">
        <div className="control-group">
          <span className="label-chip">Branch</span>
          <select className="field" value={selectedBranch} onChange={(e) => onSelectBranch(e.target.value)}>
            <option value="ALL">All Branches (Combined)</option>
            {availableBranches.map((b) => (
              <option key={b} value={b}>
                Branch {b}
              </option>
            ))}
          </select>
        </div>
        {lastUpdatedLabel && <span className="pill">{lastUpdatedLabel}</span>}
      </div>
      {error && (
        <div className="control-bar__status">
          <span className="pill warn">{error}</span>
        </div>
      )}
    </div>
  );
}
