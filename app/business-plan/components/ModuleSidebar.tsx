'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BuildingIcon, GridIcon, HandshakeIcon, SignedDocIcon, TargetIcon } from '@/components/ui/icons';
import ReviewProgress from '@/components/review/ReviewProgress';

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
}

const ITEMS: SidebarItem[] = [
  { href: '/business-plan', label: 'Branch Portfolio', icon: <BuildingIcon size={16} /> },
  /* Las DOS pantallas de BP41: los nodos con sus steps, y los funnels con los
     nodos que usan. Antes eran tres pestanas dentro de una sola. */
  { href: '/business-plan/library', label: 'Node Library', icon: <GridIcon size={16} /> },
  { href: '/business-plan/funnels', label: 'Funnels', icon: <GridIcon size={16} /> },
  /*
   * Etapa BP20. Las otras entradas miran el negocio por Loan Officer; ésta lo
   * mira por PERSONA DEL EQUIPO DE SOPORTE, que es lo que faltaba: para saber
   * todo lo que tenía pendiente alguien había que abrir los planes uno por uno.
   */
  { href: '/business-plan/team', label: 'BP Team', icon: <HandshakeIcon size={16} /> },
  /*
   * ═══════════════════════════════════════════════════════════════
   * EL MODO REVISIÓN — etapa RV1
   * ═══════════════════════════════════════════════════════════════
   *
   * Sin esto las dos pantallas sólo se alcanzaban escribiendo la URL. Isabella
   * las vio porque le pasaron el link -- nadie más las habría encontrado.
   *
   * ⚠ APUNTA A `/review` Y NO A LA CONFIGURACIÓN, y es deliberado: son dos
   * permisos distintos. `/review` la ve el BP Team entero con
   * `commercial_activity`; `/review/settings` exige `review_admin`, que hoy
   * tienen cuatro personas.
   *
   * Y la configuración NO es otra entrada del sidebar: es un enlace DENTRO de
   * `/review`, visible sólo para quien puede asignar. Una entrada de menú que
   * rebota al landing para 93 de las 97 personas es peor que ninguna -- promete
   * una sección que para ellas no existe. Mismo criterio que hace que
   * `ServiceHubHeader` no dibuje la pestaña de Outlook sin su claim.
   *
   * ⚠ Y NO LLEVA CLAIM PROPIO. Se dibuja para todos los que ya están en la app,
   * y quien no tenga nada asignado ve la lista vacía con su motivo -- que
   * distingue "no te asignaron" de "no estás en el roster". Un claim `review`
   * aparte habría que otorgarlo a las diez personas del BP Team y mantenerlo,
   * para no decir nada que RLS no diga mejor.
   */
  { href: '/review', label: 'Review', icon: <SignedDocIcon size={16} /> },
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
  const deepest = ITEMS.filter((i) => i.href !== '/business-plan').find(
    (i) => pathname === i.href || pathname.startsWith(i.href + '/')
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

      {/*
        ═══════════════════════════════════════════════════════════════
        EL AVANCE DE LA REVISIÓN — etapa RV2, punto 4
        ═══════════════════════════════════════════════════════════════

        Debajo del menú, que es donde hay espacio libre. Estaba en la barra de
        arriba y ahí se perdía entre el texto.

        ⚠ Se dibuja SOLO con una revisión en curso: sin sesión el componente
        devuelve `null` y el sidebar queda exactamente como estaba. No hay un
        contenedor vacío ni un margen de más para las 97 personas que no
        revisan a nadie.

        ⚠ Y lo que esto NO cubre, dicho acá porque es donde se decide: la fase 2
        visita Outlook, que no monta este sidebar. Ahí no hay tarjeta de avance
        -- queda la barra de arriba y el panel del paso. Es una pérdida real, y
        la alternativa era un segundo lugar donde dibujarlo con su propio
        criterio de posición, para dos pasos de ocho.
      */}
      <ReviewProgress />
    </aside>
  );
}
