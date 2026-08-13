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
 *       └ .bp-columns                <- flex
 *           ├ .bp-sidebar  (220px)
 *           └ .bp-workspace (resto)
 *               ├ breadcrumb         <- alineado con el contenido, no con el menú
 *               └ children
 *
 * Etapa BP4: el breadcrumb bajó a la columna derecha. Arriba de las dos
 * columnas arrancaba sobre el menú lateral, que es justo con lo que no tiene
 * nada que ver -- las migas describen dónde estás DENTRO del workspace. Ahora
 * comparte el borde izquierdo con el contenido y su alto mínimo lo deja a la
 * misma altura que el tope del panel del menú.
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
 * El breadcrumb tiene que ir ARRIBA del contenido de la página, y quien sabe
 * qué dice es esa misma página. Un componente no puede pintar por encima de su
 * propio padre, así que las migas viajan hacia arriba en vez de hacia abajo.
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
   * Se pinta siempre, aunque todavía no haya migas: el alto mínimo está en el
   * CSS, así que el contenido no da un salto cuando llegan al hidratar.
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
        <div className="bp-columns">
          <ModuleSidebar />
          <div className="bp-workspace">
            <CrumbBar items={crumbs} />
            {children}
          </div>
        </div>
      </div>
    </BreadcrumbContext.Provider>
  );
}
