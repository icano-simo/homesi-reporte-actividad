'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import BrandLockup from './HomesiLogo';
import { BarChartIcon, TrendingUpIcon, TargetIcon, CalendarIcon, PieChartIcon } from '@/components/ui/icons';
import { ANALYTICS_PATH, isAuthRoute, OUTLOOK_PATH } from '@/lib/auth/routes';
import { ANALYTICS_CLAIM, OUTLOOK_CLAIM } from '@/lib/auth/appAccess';
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
  /**
   * Etapa OL1: claim que hace falta para que la pestaña SE DIBUJE. Sin esto la
   * pestaña es pública dentro de la app, que es el caso de las tres primeras.
   *
   * ⚠ Esto no protege nada -- de eso se encargan `proxy.ts` y RLS. Existe para
   * que nadie vea una puerta que no puede abrir.
   */
  claim?: string;
}

const NAV_TABS: NavTab[] = [
  { href: '/', label: 'Commercial Activity', icon: <BarChartIcon /> },
  { href: '/pipeline', label: 'Forecast & Pipeline', icon: <TrendingUpIcon /> },
  { href: '/business-plan', label: 'Business Plan', icon: <TargetIcon /> },
  /*
   * Etapa ANALYTICS-TAB-1: antes un sub-tab de Forecast & Pipeline (F7), ahora
   * ruta propia -- ver app/analytics/page.tsx y la nota en docs/ARQUITECTURA.md.
   *
   * ⚠ Etapa ANALYTICS-GATE: esta entrada estuvo COMENTADA (etapa
   * `fix/hide-analytics-nav-tab`) mientras se terminaba el rediseño. Apagarla
   * por código tenía dos problemas al mismo tiempo: no la veía nadie --tampoco
   * quien tenía que revisarla-- y la ruta seguía abierta para cualquiera que
   * escribiera la URL, porque comentar una pestaña no cierra nada.
   *
   * Ahora está detrás del claim `analytics`, igual que Outlook: la ven quienes
   * lo tengan, y `proxy.ts` cierra la ruta para el resto. Volver a esconderla
   * es quitar el claim, sin desplegar.
   */
  { href: ANALYTICS_PATH, label: 'Analytics', icon: <PieChartIcon />, claim: ANALYTICS_CLAIM },
  /*
   * Etapa OL1 — Outlook: la proyección del resto del año. Es la primera
   * pestaña con claim propio; hoy la ven cuatro personas.
   */
  { href: OUTLOOK_PATH, label: 'Outlook', icon: <CalendarIcon />, claim: OUTLOOK_CLAIM },
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

export default function ServiceHubHeader({ allowedApps }: { allowedApps: string[] }) {
  const pathname = usePathname();
  /*
   * ⚠ Etapa OL1: las pestañas con `claim` sólo se dibujan si la sesión lo tiene,
   * y los claims llegan POR PROP DESDE EL SERVIDOR.
   *
   * El primer intento fue un hook que leía la sesión en el cliente. No sirve, y
   * el motivo vale anotarlo: el cliente de navegador devuelve el usuario pero
   * SIN `app_metadata.allowed_apps` -- medido, el hook resolvía `[]` con una
   * sesión que sí tenía el claim, así que la pestaña no aparecía nunca.
   *
   * Leerlo en el servidor es además mejor por dos razones que no dependen de
   * ese bug: es la MISMA fuente que usa el gate de `proxy.ts`, así que la
   * pestaña y el gate no pueden discrepar; y no hay parpadeo, porque el HTML ya
   * llega con las pestañas que corresponden.
   */
  const visibleTabs = NAV_TABS.filter((tab) => !tab.claim || allowedApps.includes(tab.claim));

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
          {visibleTabs.map((tab) => {
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
