'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import BrandLockup from './HomesiLogo';
import { BarChartIcon, TrendingUpIcon, TargetIcon } from '@/components/ui/icons';
import { isAuthRoute } from '@/lib/auth/routes';
import UserMenu from './UserMenu';

/*
 * ============================================================================
 * SERVICE HUB TOP BAR — Etapa UX1 (overhaul Service Hub)
 * ============================================================================
 *
 * REEMPLAZA a components/Sidebar.tsx (borrado). Ese componente era un rail
 * vertical navy de 64px con 6 iconos, de los cuales solo 2 navegaban de
 * verdad — los otros 4 eran decorativos, herencia del HTML monolítico
 * original. Acá quedan únicamente los 2 destinos reales, como pill tabs
 * horizontales siempre visibles (spec §1.3).
 *
 * Se monta una sola vez, en app/layout.tsx, así que es idéntico en toda la
 * app. El estado activo se deriva de la ruta (`usePathname`) — no hay estado
 * local ni props de navegación que puedan desincronizarse de la URL.
 */

interface NavTab {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV_TABS: NavTab[] = [
  { href: '/', label: 'Commercial Activity', icon: <BarChartIcon /> },
  { href: '/pipeline', label: 'Forecast & Pipeline', icon: <TrendingUpIcon /> },
  { href: '/business-plan', label: 'Business Plan', icon: <TargetIcon /> },
  // Etapa ANALYTICS-TAB-1: antes un sub-tab de Forecast & Pipeline (F7),
  // ahora ruta propia -- ver app/analytics/page.tsx y la nota en
  // docs/ARQUITECTURA.md.
  //
  // Etapa fix/hide-analytics-nav-tab: entrada comentada temporalmente --
  // el rediseño de Analytics (4 capas) sigue en curso en otra rama y
  // todavía no está listo para verse desde el menú principal. La ruta
  // (app/analytics/page.tsx) y su código siguen intactos -- se puede
  // seguir accediendo directo por URL mientras se termina. Restaurar
  // esta entrada (y el import de PieChartIcon de @/components/ui/icons
  // arriba) cuando el rediseño esté listo para publicarse.
  // { href: '/analytics', label: 'Analytics', icon: <PieChartIcon /> },
];

/**
 * Etapa BP1: antes era `pathname === tab.href`, comparación exacta. Business
 * Plan tiene rutas anidadas (/business-plan/branch/703, /business-plan/lo/12)
 * y con la comparación exacta el tab quedaba apagado apenas se bajaba un nivel.
 *
 * No se puede reemplazar por un `startsWith` a secas: '/' es prefijo de TODO,
 * así que Commercial Activity quedaría activo en cualquier ruta de la app. Por
 * eso la raíz se trata como caso aparte, con igualdad exacta, y el resto por
 * sub-camino -- comparando contra `href + '/'` para que un futuro '/pipeline-x'
 * no encienda el tab de '/pipeline'.
 */
function isTabActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/** Título de módulo del header. Constante nombrada para no repetir el string. */
const MODULE_TITLE = 'Analytics Portal';

export default function ServiceHubHeader() {
  const pathname = usePathname();

  /*
   * Etapa AUTH1: /login y /no-access no llevan el shell de la app. Mostrarle
   * los tabs de módulo a alguien que todavía no entró no tiene sentido, y en
   * /no-access serían un enlace a una vista que no puede abrir.
   *
   * Se resuelve acá y no con un route group (app/(auth)/...) porque mover las
   * 2 páginas existentes a un grupo cambiaría sus rutas de archivo sin cambiar
   * sus URLs -- un diff grande para un condicional de una línea. El componente
   * ya leía `pathname` para marcar el tab activo.
   */
  if (isAuthRoute(pathname)) return null;

  return (
    <header className="hub-header">
      <div className="hub-header__inner">
        <div className="hub-brand">
          <BrandLockup />
          <span className="hub-brand__divider" aria-hidden="true" />
          <span className="hub-brand__module">{MODULE_TITLE}</span>
        </div>

        <nav className="hub-nav" aria-label={MODULE_TITLE}>
          {NAV_TABS.map((tab) => {
            const isActive = isTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={'hub-nav__tab' + (isActive ? ' is-active' : '')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.icon}
                {tab.label}
              </Link>
            );
          })}
          <span className="hub-brand__divider" aria-hidden="true" />
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
