'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
/*
 * Se reusa la hoja del Business Plan --tablas `.piv`, `.bp-notice`, `.bp-btn`,
 * `.bp-empty`-- por el mismo motivo que Outlook: el lenguaje visual del portal
 * ya existe y duplicar sus reglas garantiza que las dos versiones se separen
 * con el primer ajuste. Lo propio de Admin va en `styles/admin.css`.
 */
import '../business-plan/styles/bp-visual.css';
import './styles/admin.css';

/**
 * ============================================================================
 * LAYOUT DE ADMIN — etapa ADM3
 * ============================================================================
 *
 * ⚠ El acceso NO se controla acá. Lo controla `proxy.ts` con el claim `admin`,
 * que corre ANTES de renderizar: un gate en el layout es un componente que ya
 * se pintó. Ver `CLAIMED_MODULES` en `proxy.ts`.
 *
 * ---------------------------------------------------------------------------
 * DOS MÓDULOS BAJO UN CLAIM — etapa ADM3
 * ---------------------------------------------------------------------------
 * Lo que era `/admin` pasó a `/admin/roster`, y al lado entró `/admin/margins`.
 * Los dos siguen detrás del mismo claim, y eso no es una simplificación: el
 * bucle de `proxy.ts` compara POR PREFIJO, así que `/admin` cubre los dos sin
 * tocar el gate. Dos pestañas de nivel superior habrían obligado a decidir un
 * claim nuevo para una pantalla que hoy usa una sola persona.
 *
 * ⚠ Y LA SUB-NAVEGACIÓN VIVE EN EL LAYOUT, que es lo que la hace sobrevivir a
 * la navegación. Es la lección de la entrada `Review` en el sidebar del Business
 * Plan: una entrada que SACA del módulo donde vive el menú deja la pantalla
 * siguiente sin forma de volver. Acá las dos rutas son hijas de este layout, así
 * que el menú está en las dos.
 */

const SUB_TABS: { href: string; label: string }[] = [
  { href: '/admin/roster', label: 'Roster' },
  { href: '/admin/margins', label: 'Margins' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      {/*
        ⚠ SE REUSA `.seg` DE ANALYTICS, no una clase nueva que se le parezca —
        etapa ADM7.

        Dos tratamientos de pestaña que hoy se ven igual divergen con el primer
        `edit`, que es la misma decisión que la de las tres tablas de Margins.
        `.seg` ya vive en `app/styles/components.css`, que es global, así que no
        hubo nada que sacar de ninguna pantalla: lo que estaba atado a Analytics
        no era la clase sino el SELECTOR --`.seg button`-- y ahí se agregó `a`.

        ⚠ Y SIGUEN SIENDO `<Link>` Y NO `<button>`. Son dos rutas: un botón
        pierde el click del medio, el «abrir en otra pestaña» y el `href` que el
        navegador muestra abajo. El tratamiento visual es lo que se comparte.
      */}
      <div className="hub-container adm-subnav">
        <nav className="seg" aria-label="Admin sections">
          {SUB_TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={pathname.startsWith(t.href) ? 'on' : ''}
              aria-current={pathname.startsWith(t.href) ? 'page' : undefined}
              data-adm-tab={t.label.toLowerCase()}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}
