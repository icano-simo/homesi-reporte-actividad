'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import BrandLockup from './HomesiLogo';
import { BarChartIcon, TrendingUpIcon } from '@/components/ui/icons';

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
];

/** Título de módulo del header. Constante nombrada para no repetir el string. */
const MODULE_TITLE = 'Analytics Portal';

export default function ServiceHubHeader() {
  const pathname = usePathname();

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
            const isActive = pathname === tab.href;
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
        </nav>
      </div>
    </header>
  );
}
