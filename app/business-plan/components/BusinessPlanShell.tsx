'use client';

import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Fragment } from 'react';
import ModuleSidebar from './ModuleSidebar';
import type { Crumb } from './Breadcrumbs';

/**
 * ============================================================================
 * SHELL DEL MÓDULO — contenedor de 1380px, breadcrumb, sidebar y workspace
 * ============================================================================
 *
 * Etapa BP3 — ARCHIVO NUEVO.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * En BP2 el sidebar colgaba del borde de la ventana: el `.bp-shell` envolvía al
 * `.hub-container` de cada página, así que el contenedor centrado quedaba
 * ADENTRO de la columna derecha y el sidebar afuera de todo.
 *
 * Ahora es al revés. El contenedor va primero y el par sidebar/workspace vive
 * adentro:
 *
 *     .hub-container.bp-shell        <- 1380px centrados, padding lateral 32px
 *       └ breadcrumb                 <- ancho completo del canvas
 *       └ .bp-columns                <- flex
 *           ├ .bp-sidebar  (220px)
 *           └ .bp-workspace (resto)
 *
 * El ancho NO se declara acá: se reusa `.hub-container` de `app/styles/shell.css`,
 * que ya vale `max-width: var(--container-max)` con `padding: 32px 32px 64px`.
 * Como `.hub-header__inner` usa ese mismo max-width y el mismo padding lateral
 * de 32px, el borde izquierdo del sidebar cae exactamente sobre el del logo de
 * HOMESÍ. Declarar un max-width propio acá rompería esa alineación en cuanto
 * alguno de los dos cambiara.
 *
 * EL BREADCRUMB Y POR QUÉ HAY UN CONTEXT
 * --------------------------------------
 * El breadcrumb tiene que ir ARRIBA del par sidebar/workspace y ocupar el ancho
 * completo, pero quien sabe qué dice es cada página, que se renderiza DENTRO del
 * workspace. Un componente no puede pintar por encima de su propio padre.
 *
 * De las salidas posibles, esta es la que deja la responsabilidad donde
 * corresponde: la página sigue declarando sus migas con `<Breadcrumbs items>`
 * como siempre, y el shell decide dónde se dibujan. La alternativa —que el
 * layout dedujera las migas del pathname— lo obligaría a cargar el roster para
 * saber el nombre de un Loan Officer, incluyendo en /library, que no necesita
 * datos.
 *
 * Consecuencia conocida: las migas se registran en un efecto, así que no salen
 * en el HTML del servidor y aparecen al hidratar. Es invisible en la práctica
 * porque el cuerpo de estas páginas también se arma en el cliente.
 */

/** El setter viaja por context; `Breadcrumbs` lo consume y no pinta nada. */
export const BreadcrumbContext = createContext<((items: Crumb[]) => void) | null>(null);

function CrumbBar({ items }: { items: Crumb[] }) {
  /*
   * Se reserva el alto aunque todavía no haya migas: si el nav apareciera de
   * la nada al hidratar, el contenido de abajo daría un salto.
   */
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

export default function BusinessPlanShell({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  /* Estable entre renders: si cambiara en cada uno, el efecto de `Breadcrumbs`
     se dispararía en bucle. */
  const setItems = useCallback((items: Crumb[]) => setCrumbs(items), []);
  const value = useMemo(() => setItems, [setItems]);

  return (
    <BreadcrumbContext.Provider value={value}>
      <div className="hub-container bp-shell">
        <CrumbBar items={crumbs} />
        <div className="bp-columns">
          <ModuleSidebar />
          <div className="bp-workspace">{children}</div>
        </div>
      </div>
    </BreadcrumbContext.Provider>
  );
}
