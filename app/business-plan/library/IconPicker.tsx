'use client';

import { OFFERED } from '../components/funnelIcons';

/**
 * ============================================================================
 * SELECTOR DE ICONOS
 * ============================================================================
 *
 * Etapa BP17 — ARCHIVO NUEVO. Etapa BP19 — iconos de negocio en vez del set de
 * interfaz. Etapa BP21 — el registro se mudó a `components/funnelIcons.tsx`.
 *
 * Reemplaza a un `<input type="text">` en el que había que escribir `trending`
 * de memoria. Nadie puede acertar un nombre que no está listado en ningún lado,
 * y uno mal escrito se guardaba igual: la columna es texto libre.
 *
 * ⚠ El catálogo YA NO VIVE ACÁ. Mientras vivió, `iconByName` era invisible para
 * el resto del módulo y el icono elegido no se dibujaba en ninguna pantalla --
 * el bug que reportó BP21. Este archivo quedó como lo que dice su nombre: la
 * grilla para elegir.
 */

export { iconByName, FunnelGlyph } from '../components/funnelIcons';

export default function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div className="bp-iconpick">
      {OFFERED.map((i) => (
        <button
          key={i.name}
          type="button"
          className={'bp-iconpick__opt' + (value === i.name ? ' is-on' : '')}
          onClick={() => onChange(value === i.name ? '' : i.name)}
          /* Sin etiqueta debajo: con el dibujo y el `title` alcanza, y así
             entran el doble de opciones en el mismo alto. */
          title={i.label}
          aria-pressed={value === i.name}
          aria-label={i.label}
        >
          {i.render(17)}
        </button>
      ))}
    </div>
  );
}
