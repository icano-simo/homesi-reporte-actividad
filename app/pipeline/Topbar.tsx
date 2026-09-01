'use client';

import { useState } from 'react';
import type { DateRange } from '@/lib/pipeline/aggregate';
import { SettingsGearIcon } from '@/components/ui/icons';
import DateRangeInput from './DateRangeInput';

export interface TopbarProps {
  pipelineDateRange: DateRange;
  onPipelineDateRangeChange: (range: DateRange) => void;
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
   *
   * Ocupa el lugar de `formatDetected` y `saveStatus`, que describían la carga
   * que esta pantalla ya no hace.
   */
  lastUpdatedLabel?: string | null;
}

/**
 * Barra de control de Forecast: compone DateRangeInput y MonthSelector, sin
 * tocar su lógica, más el selector de Branch global.
 *
 * Antes también componía UploadButton. Ese componente se eliminó junto con la
 * carga desde esta pantalla; en su lugar la barra muestra cuándo se actualizó
 * el snapshot.
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
  pipelineDateRange,
  onPipelineDateRangeChange,
  availableBranches,
  selectedBranch,
  onSelectBranch,
  error,
  lastUpdatedLabel,
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
          Plegado no es oculto: el botón dice en qué quedó el único parámetro
          que sigue detrás de Settings (Pipeline Range) -- Forecast Month
          salió de aquí, ver Etapa FORECAST-MONTH-VISIBLE: ahora vive como
          filtro visible debajo del título "Forecast & Pipeline" (page.tsx,
          clase `.fc-month`), no plegado. El engranaje (ícono de marca, ver
          components/ui/icons.tsx) reemplaza el texto "Settings" + el
          chevron; aria-label/title cubren la accesibilidad que el texto
          daba gratis. `white-space: nowrap` en el botón (forecast-visual.css)
          evita que el resumen se quiebre en dos líneas.
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
        </button>
      </div>

      {showParams && (
        <div className="fc-params">
          <DateRangeInput value={pipelineDateRange} onChange={onPipelineDateRangeChange} />
          {/*
            Acá estaba el pill "File: <nombre>". Se va con la carga: el snapshot
            ya no viene de un archivo que alguien eligió en esta pantalla, y
            `file_name` pasó a ser 'bigquery:<batch>' -- un identificador para
            auditar en la base, no algo que signifique nada en pantalla. Lo que
            la gente necesita saber del origen es si está fresco, y eso lo dice
            "Updated on ..." en la barra.
          */}
        </div>
      )}

      {/*
        Donde estaban los indicadores de la carga ("Format detected", "Saving to
        Supabase…") ahora va cuándo se actualizó el dato -- la misma pregunta
        que reemplaza a "¿qué archivo estoy mirando?" cuando nadie carga
        archivos desde acá. Mismo cambio, y por el mismo motivo, que ya se hizo
        en Actividad (app/page.tsx, `lastSync`).
      */}
      <div className="control-bar__status">
        {lastUpdatedLabel && <span className="pill">{lastUpdatedLabel}</span>}
        {error && <span className="pill warn">{error}</span>}
      </div>
    </div>
  );
}
