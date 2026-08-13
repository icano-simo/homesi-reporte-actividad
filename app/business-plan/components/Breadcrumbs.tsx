'use client';

import Link from 'next/link';
import { Fragment } from 'react';

/**
 * Breadcrumb del módulo.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 *
 * Es la contrapartida de la decisión de no usar modales: como cada nivel es una
 * página con su propia URL, hace falta algo que muestre el camino y permita
 * volver. Cada segmento anterior es un <Link> real -- se puede abrir en pestaña
 * nueva, copiar, o volver con el botón del navegador. El último es texto plano:
 * ya estás ahí.
 */

export interface Crumb {
  label: string;
  /** Ausente en el último segmento. */
  href?: string;
}

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="bp-crumbs" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <Fragment key={item.label + i}>
            {i > 0 && (
              <span className="bp-crumbs__sep" aria-hidden="true">
                ›
              </span>
            )}
            {isLast || !item.href ? (
              <span className="bp-crumbs__current" aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link href={item.href}>{item.label}</Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
