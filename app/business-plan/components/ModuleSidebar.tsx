'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BuildingIcon, GridIcon, HandshakeIcon, TargetIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * SIDEBAR DEL MÓDULO BUSINESS PLAN
 * ============================================================================
 *
 * Etapa BP2 — ARCHIVO NUEVO.
 * Etapa BP4 — se quitó el botón de colapsar y todo su estado.
 *
 * Vive en `app/business-plan/layout.tsx`, que es lo que hace que exista en
 * TODAS las rutas del módulo y en NINGUNA otra: Commercial Activity (`/`) y
 * Forecast (`/pipeline`) no lo montan porque no están debajo de ese layout.
 * Montarlo en `ServiceHubHeader` habría sido el error opuesto -- aparecería en
 * los tres módulos.
 *
 * Con dos items y 220px de ancho, poder colapsarlo no compraba nada: el
 * componente dejó de tener estado y volvió a ser una lista de enlaces. Por
 * debajo de 900px sigue reduciéndose a iconos, pero eso ahora lo decide el CSS
 * solo, sin nada que sincronizar.
 */

interface SidebarItem {
  href: string;
  label: string;
  icon: ReactNode;
  /**
   * Otras rutas que dejan este item seleccionado — etapa BP47.
   *
   * Hace falta porque `Funnels & Nodes` es UN item con DOS rutas, y las dos no
   * comparten prefijo: `/business-plan/funnels` no es prefijo de
   * `/business-plan/library`. Sin esto, cambiar de pestaña apagaba el item del
   * menú y encendía la raíz del módulo, que es la fallback.
   */
  tambien?: string[];
}

const ITEMS: SidebarItem[] = [
  { href: '/business-plan', label: 'Branch Portfolio', icon: <BuildingIcon size={16} /> },
  /*
   * ═════════════════════════════════════════════════════════════════
   * UN ITEM PARA LAS DOS PANTALLAS — etapa BP47
   * ═════════════════════════════════════════════════════════════════
   *
   * En BP41 eran dos entradas. Son la misma cosa mirada de los dos lados -- un
   * nodo está en varios funnels y un funnel usa varios nodos-- y como entradas
   * separadas el menú prometía dos secciones que comparten hasta la búsqueda.
   *
   * La CONMUTACION es un par de pestañas adentro (`FunnelNodeTabs`), y las dos
   * pestañas son RUTAS y no estado:
   *
   *   · la ruta sobrevive al refresco sin escribir una linea para lograrlo;
   *   · se puede compartir el link de la pestaña de nodos;
   *   · atrás y adelante del navegador funcionan.
   *
   * Un `?view=nodes` sobre una sola ruta habría sido una SEGUNDA fuente de
   * verdad al lado de la que ya existe, y las dos páginas ya estaban escritas.
   */
  {
    href: '/business-plan/funnels',
    label: 'Funnels & Nodes',
    icon: <GridIcon size={16} />,
    tambien: ['/business-plan/library'],
  },
  /*
   * Etapa BP20. Las otras entradas miran el negocio por Loan Officer; ésta lo
   * mira por PERSONA DEL EQUIPO DE SOPORTE, que es lo que faltaba: para saber
   * todo lo que tenía pendiente alguien había que abrir los planes uno por uno.
   */
  { href: '/business-plan/team', label: 'BP Team', icon: <HandshakeIcon size={16} /> },
  { href: '/business-plan/settings', label: 'Settings', icon: <TargetIcon size={16} /> },
];

/**
 * Mismo criterio que el `isTabActive` del header global: coincidencia exacta o
 * de sub-camino. Estando en `/business-plan/branch/703` o en
 * `/business-plan/lo/5`, el activo tiene que seguir siendo Branch Portfolio.
 *
 * `/business-plan` es prefijo de `/business-plan/library`, así que la raíz del
 * módulo se resuelve aparte: sólo queda activa si NINGÚN otro item coincide.
 */
function resolveActiveHref(pathname: string): string {
  const coincide = (base: string) => pathname === base || pathname.startsWith(base + '/');
  const deepest = ITEMS.filter((i) => i.href !== '/business-plan').find(
    (i) => coincide(i.href) || (i.tambien ?? []).some(coincide)
  );
  return deepest ? deepest.href : '/business-plan';
}

export default function ModuleSidebar() {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname);

  return (
    <aside className="bp-sidebar" aria-label="Business Plan sections">
      {ITEMS.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={'bp-nav-item' + (isActive ? ' is-active' : '')}
            aria-current={isActive ? 'page' : undefined}
            /* Angosto el sidebar el texto se oculta: el title es lo único que
               queda para saber a dónde lleva cada icono. */
            title={item.label}
          >
            {item.icon}
            <span className="bp-sidebar__label">{item.label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
