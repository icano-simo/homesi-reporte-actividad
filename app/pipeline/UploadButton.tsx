'use client';

import type { ChangeEvent } from 'react';

export interface UploadButtonProps {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
}

/** Único id real del <input type="file">; page.tsx lo reusa para el botón del empty state (mismo patrón que fileInput en Actividad: un solo input, varios <label htmlFor> que lo disparan). */
export const PIPELINE_FILE_INPUT_ID = 'pipelineFileInput';

/**
 * Botón de carga de archivo, mismo patrón visual que "Cargar archivo" de
 * Actividad (app/page.tsx): un <label class="btn primary"> + un
 * <input type="file"> oculto (input[type=file]{display:none} ya existe en
 * legacy-components.css). No incluye lógica de parsing -- solo entrega el
 * File crudo a quien lo use via onFileSelected.
 */
export default function UploadButton({ onFileSelected, isLoading }: UploadButtonProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = '';
  }

  return (
    <>
      <label className="btn primary" htmlFor={PIPELINE_FILE_INPUT_ID}>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />
        </svg>
        {isLoading ? 'Cargando…' : 'Cargar archivo'}
      </label>
      <input
        type="file"
        id={PIPELINE_FILE_INPUT_ID}
        accept=".xlsx,.xls"
        onChange={handleChange}
        disabled={isLoading}
      />
    </>
  );
}
