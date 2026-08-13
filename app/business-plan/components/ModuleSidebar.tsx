'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BuildingIcon, GridIcon, CollapseIcon, ExpandIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * SIDEBAR DEL MÓDULO BUSINESS PLAN
 * ============================================================================
 *
 * Etapa BP2 — ARCHIVO NUEVO.
 *
 * Vive en `app/business-plan/layout.tsx`, que es lo que hace que exista en
 * TODAS las rutas del módulo y en NINGUNA otra: Commercial Activity (`/`) y
 * Forecast (`/pipeline`) no lo montan porque no están debajo de ese layout.
 * Montarlo en `ServiceHubHeader` habría sido el error opuesto -- aparecería en
 * los tres módulos.
 *
 * Como el layout no se re-renderiza al navegar entre rutas hijas, el estado de
 * colapsado sobrevive a moverse de Portfolio a Branch y a Loan Officer.
 */

interface SidebarItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const ITEMS: SidebarItem[] = [
  { href: '/business-plan', label: 'Branch Portfolio', icon: <BuildingIcon size={16} /> },
  { href: '/business-plan/library', label: 'Funnel & Node Library', icon: <GridIcon size={16} /> },
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
  const deepest = ITEMS.filter((i) => i.href !== '/business-plan').find(
    (i) => pathname === i.href || pathname.startsWith(i.href + '/')
  );
  return deepest ? deepest.href : '/business-plan';
}

export default function ModuleSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const activeHref = resolveActiveHref(pathname);

  return (
    <aside className={'bp-sidebar' + (collapsed ? ' bp-sidebar--collapsed' : '')} aria-label="Business Plan sections">
      <div className="bp-sidebar__title bp-sidebar__label">Business Plan</div>

      {ITEMS.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={'bp-nav-item' + (isActive ? ' is-active' : '')}
            aria-current={isActive ? 'page' : undefined}
            /* Con el sidebar colapsado el texto se oculta: el title es lo único
               que queda para saber a dónde lleva cada icono. */
            title={item.label}
          >
            {item.icon}
            <span className="bp-sidebar__label">{item.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        className="bp-sidebar__toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ExpandIcon size={14} /> : <CollapseIcon size={14} />}
        <span className="bp-sidebar__label">{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>
    </aside>
  );
}
