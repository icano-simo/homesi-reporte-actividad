'use client';

import { useState } from 'react';
import type { DateRange } from '@/lib/pipeline/aggregate';
import { SettingsGearIcon } from '@/components/ui/icons';
import DateRangeInput from './DateRangeInput';
import MonthSelector from './MonthSelector';

export interface TopbarProps {
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
 * contenedor de 1440px. El <select> de branch usa la clase compartida `.field`
 * en vez del alias `.yb` envuelto en `.yr`, que era un workaround del CSS
 * legado.
 *
 * ---------------------------------------------------------------------------
 * ETAPA BP16 — LA FRANJA SE ADELGAZA
 * ---------------------------------------------------------------------------
 * Antes tenía cuatro controles del mismo peso: subir archivo, Pipeline Range,
 * Forecast Month y Branch. Los dos del medio son parámetros que casi nadie
 * cambia -- se fijan una vez -- pero ocupaban el centro de la pantalla y
 * empujaban el banner de KPIs hacia abajo, que es lo primero que hay que leer.
 *
 * Ahora:
 *   Upload    se fue arriba, junto a Download Excel (ver page.tsx).
 *   Branch    queda a la vista: es el único que se cambia seguido.
 *   Range y   detrás de "Settings", plegados. Se muestra un resumen de en qué
 *   Month     están, para que estar plegados no signifique estar ocultos.
 */
export default function Topbar({
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
  const [showParams, setShowParams] = useState(false);

  return (
    <div className="control-bar">
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

      <div className="control-group">
        {/*
          Plegado no es oculto: el botón dice en qué quedaron los dos
          parámetros, para que nadie tenga que abrirlo sólo para saberlo. El
          engranaje (ícono de marca, ver components/ui/icons.tsx) reemplaza el
          texto "Settings" + el chevron -- el resumen de rango/mes se
          conserva igual, es lo que hace que "plegado" no sea "oculto"; solo
          el afordance de "esto es Settings, clickeable" cambió de texto a
          ícono. aria-label/title cubren la accesibilidad que el texto daba
          gratis.

          Ajuste de seguimiento: el resumen ("· ") no distinguía Pipeline
          Range de Forecast Month -- dos controles independientes (ver
          DateRangeInput.tsx/MonthSelector.tsx, cada uno filtra cosas
          distintas). Se separan con el mismo divisor vertical que ya usa
          SummaryCards.tsx (.kpi-hero__split-divider) entre dos valores
          agrupados, y "Forecast" se rotula con `.label-chip` -- la misma
          clase que ya usa MonthSelector.tsx para su propio input ("Forecast
          Month"), reutilizada acá en vez de un estilo nuevo. El rango de
          fechas no lleva chip: un rango de fechas ya se lee como tal por su
          propia forma (el "–" entre las dos fechas), y MonthSelector.tsx
          también rotula solo "Forecast Month", no "Pipeline Range" repetido
          dos veces en la misma fila. `white-space: nowrap` en el botón
          (forecast-visual.css) evita que el resumen se quiebre en dos líneas.
        */}
        <button
          type="button"
          className="fc-params__toggle"
          onClick={() => setShowParams((v) => !v)}
          aria-expanded={showParams}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsGearIcon size={16} />
          <span>
            {pipelineDateRange.startDate} – {pipelineDateRange.endDate}
          </span>
          <span className="fc-params__toggle-divider" aria-hidden="true" />
          <span className="label-chip">Forecast</span>
          <span>{forecastMonth}</span>
        </button>
      </div>

      {showParams && (
        <div className="fc-params">
          <DateRangeInput value={pipelineDateRange} onChange={onPipelineDateRangeChange} />
          <MonthSelector value={forecastMonth} onChange={onForecastMonthChange} />
          {/* Nombre de archivo: antes vivía siempre visible en control-bar__status;
              se mueve acá adentro (mismo panel que Range/Month) para que el
              engranaje sea el único punto de entrada a "detalles de esta carga". */}
          {fileName && <span className="pill">File: {fileName}</span>}
        </div>
      )}

      <div className="control-bar__status">
        {formatDetected && <span className="pill">Format detected: {formatDetected}</span>}
        {saveStatus === 'saving' && <span className="pill">Saving to Supabase…</span>}
        {saveStatus === 'saved' && <span className="pill ok">Saved to Supabase</span>}
        {saveStatus === 'error' && <span className="pill warn">Could not save to Supabase</span>}
        {error && <span className="pill warn">{error}</span>}
      </div>
    </div>
  );
}
