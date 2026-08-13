'use client';

import { useContext, useEffect } from 'react';
import { BreadcrumbContext } from './BusinessPlanShell';

/**
 * Breadcrumb del módulo.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 * Etapa BP3 — dejó de pintar. Ahora REGISTRA.
 *
 * Es la contrapartida de la decisión de no usar modales: como cada nivel es una
 * página con su propia URL, hace falta algo que muestre el camino y permita
 * volver. Cada segmento anterior es un <Link> real -- se puede abrir en pestaña
 * nueva, copiar, o volver con el botón del navegador. El último es texto plano:
 * ya estás ahí.
 *
 * Lo que cambió en BP3 es SÓLO dónde se dibuja. El breadcrumb va arriba del par
 * sidebar/workspace y a lo ancho del canvas completo, o sea por encima del
 * propio padre de este componente. Así que la página sigue declarando sus migas
 * igual que antes y este componente se las pasa al shell, que las pinta en su
 * lugar. El markup vive ahora en `BusinessPlanShell`.
 */

export interface Crumb {
  label: string;
  /** Ausente en el último segmento. */
  href?: string;
}

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const setItems = useContext(BreadcrumbContext);

  /*
   * `items` es un array literal nuevo en cada render de la página, así que no
   * sirve como dependencia -- el efecto correría siempre. Se compara por
   * contenido serializado y se reconstruye desde ahí, con lo cual la lista de
   * dependencias queda completa y honesta (nada de silenciar el linter).
   */
  const serialized = JSON.stringify(items);

  useEffect(() => {
    if (!setItems) return;
    setItems(JSON.parse(serialized) as Crumb[]);
  }, [serialized, setItems]);

  return null;
}
