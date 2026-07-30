'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavItem {
  href: string | null;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    // grid/dashboard -- sin destino todavía
    href: null,
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    // gráfico de barras -- Actividad
    href: '/',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M3 3v18h18" />
        <rect x="7" y="10" width="3" height="7" />
        <rect x="12" y="6" width="3" height="11" />
        <rect x="17" y="13" width="3" height="4" />
      </svg>
    ),
  },
  {
    // gráfico de línea ascendente -- Forecast/Pipeline
    href: '/pipeline',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M17 7h4v4" />
      </svg>
    ),
  },
  {
    // layout/tabla -- sin destino todavía
    href: null,
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M9 20V9" />
      </svg>
    ),
  },
  {
    // globo -- sin destino todavía
    href: null,
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
      </svg>
    ),
  },
  {
    // cubo -- sin destino todavía
    href: null,
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M12 20l7-4V8l-7-4-7 4v8z" />
        <path d="M12 12l7-4M12 12v8M12 12L5 8" />
      </svg>
    ),
  },
];

/**
 * Barra lateral compartida (Etapa F0). Port del markup decorativo que vivía
 * embebido en app/page.tsx (Actividad) -- ahora vive una sola vez en
 * app/layout.tsx, así que aparece igual en cualquier ruta.
 *
 * Solo dos íconos navegan de verdad por ahora: gráfico de barras -> '/'
 * (Actividad) y línea ascendente -> '/pipeline' (Forecast). El resto (grid,
 * layout, globo, cubo, y el ícono de ajustes de abajo) quedan sin href,
 * exactamente como estaban de decorativos antes -- no se les inventó destino
 * en esta etapa.
 */
export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="logo">H</div>
      {NAV_ITEMS.map((item, i) =>
        item.href ? (
          <Link key={i} href={item.href} className={'nav-ic' + (pathname === item.href ? ' active' : '')}>
            {item.icon}
          </Link>
        ) : (
          <div key={i} className="nav-ic">
            {item.icon}
          </div>
        )
      )}
      <div className="nav-ic" style={{ marginTop: 'auto', marginBottom: '14px' }}>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 6 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.1a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </svg>
      </div>
    </aside>
  );
}
