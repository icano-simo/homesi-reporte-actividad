'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * ============================================================================
 * LAS DOS PESTAÑAS DE `Funnels & Nodes` — etapa BP47
 * ============================================================================
 *
 * ARCHIVO NUEVO. El menú del módulo pasó de dos entradas a una, y la
 * conmutación entre las dos vistas vive acá.
 *
 * ---------------------------------------------------------------------------
 * SON RUTAS, NO ESTADO
 * ---------------------------------------------------------------------------
 * Cada pestaña es un `<Link>` a su propia ruta, y la pestaña activa se deduce
 * del `pathname`. Eso le da tres cosas que un `useState` no puede dar:
 *
 *   · sobrevive al refresco sin una línea escrita para lograrlo;
 *   · el link de la pestaña de nodos se puede pegar en un mensaje;
 *   · atrás y adelante del navegador funcionan.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LOS CONTEOS SALEN DE LA BASE, Y CUANDO NO ESTÁN NO SE INVENTAN
 * ---------------------------------------------------------------------------
 * Se reciben por props desde `useFunnelLibrary`. Hoy son 9 funnels y 32 nodos;
 * cuando se escribió el brief eran 8 y 31, y eso ya había envejecido.
 *
 * Y `undefined` NO se dibuja como `0`. Mientras la consulta viaja, la pestaña
 * va sin número: un `0` afirmaría que la biblioteca está vacía, que es una cosa
 * distinta de "todavía no sé cuántos hay". Es la misma distinción que sostiene
 * `outlook.snapshot.warnings` -- `NULL` es que nadie reportó, array vacío es que
 * se buscó y no había.
 */
export interface FunnelNodeTabsProps {
  /** Cuántos funnels hay. `undefined` mientras la consulta no volvió. */
  funnels?: number;
  /** Cuántos nodos hay. `undefined` mientras la consulta no volvió. */
  nodes?: number;
}

const PESTANAS = [
  { href: '/business-plan/funnels', label: 'Funnels', campo: 'funnels' as const },
  { href: '/business-plan/library', label: 'Nodes', campo: 'nodes' as const },
];

export default function FunnelNodeTabs({ funnels, nodes }: FunnelNodeTabsProps) {
  const pathname = usePathname();
  const cuenta = { funnels, nodes };

  return (
    <div className="bp-modtabs" role="tablist" aria-label="Funnels and nodes">
      {PESTANAS.map((t) => {
        /*
         * Coincidencia de sub-camino, no exacta: estando en la página de un
         * funnel (`/business-plan/funnels/7`) la pestaña `Funnels` tiene que
         * seguir encendida. Con igualdad estricta, entrar a un funnel apagaba
         * las dos.
         */
        const activa = pathname === t.href || pathname.startsWith(t.href + '/');
        const n = cuenta[t.campo];
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={activa}
            aria-current={activa ? 'page' : undefined}
            className={'bp-modtabs__tab' + (activa ? ' is-on' : '')}
          >
            {t.label}
            {n !== undefined && <span className="bp-modtabs__n">{n}</span>}
          </Link>
        );
      })}
    </div>
  );
}
