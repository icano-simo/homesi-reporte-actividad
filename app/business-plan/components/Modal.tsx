'use client';

import { useEffect, type ReactNode } from 'react';
import { CloseIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * MODAL — excepción acotada, no una forma de navegar
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * La regla del módulo sigue siendo CERO MODALES PARA NAVEGACIÓN: cada nivel de
 * la jerarquía (Portfolio → Branch → Loan Officer) es una página con su propia
 * URL, que se puede compartir, marcar y abrir en otra pestaña.
 *
 * Esta excepción es para DETALLE COMPLEMENTARIO, y son dos usos:
 *   - la actividad comercial del año de un Loan Officer
 *   - el detalle de préstamos por milestone
 *
 * El criterio para decidir: si es un lugar al que querés volver o mandar por
 * link, es página. Si es "quiero ver esto un segundo y cerrar", es modal.
 * Ninguno de estos dos es un destino.
 */
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Sin esto el fondo sigue scrolleando bajo el modal.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="bp-modal-backdrop"
      role="presentation"
      /* Sólo cierra si el clic fue en el fondo, no si burbujeó desde adentro. */
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bp-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="bp-modal__head">
          <h2 className="bp-modal__title">{title}</h2>
          <button type="button" className="bp-modal__close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="bp-modal__body">{children}</div>
      </div>
    </div>
  );
}
