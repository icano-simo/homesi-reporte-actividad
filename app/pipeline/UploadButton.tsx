'use client';

import type { ChangeEvent } from 'react';
import { UploadIcon } from '@/components/ui/icons';

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
      {/* Etapa UX1: CTA de marca ('Warm Embrace') + icono del set compartido,
          en vez de `.btn primary` con un <svg> copiado inline. */}
      <label className="btn cta" htmlFor={PIPELINE_FILE_INPUT_ID}>
        <UploadIcon />
        {isLoading ? 'Loading…' : 'Upload file'}
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
