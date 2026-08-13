'use client';

import Breadcrumbs from '../components/Breadcrumbs';
import { AlertTriangleIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * FUNNEL & NODE LIBRARY — placeholder
 * ============================================================================
 *
 * Etapa BP2 — ARCHIVO NUEVO.
 *
 * La ruta existe para que el segundo item del sidebar lleve a algún lado real
 * en vez de a un 404. El contenido NO se maqueta: el diseño de la biblioteca
 * todavía no está definido, y adelantar una maqueta acá crearía la impresión
 * de que hay decisiones tomadas que no lo están -- el mismo problema que el
 * motor de triage.
 */
export default function FunnelLibraryPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnel & Node Library' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Funnel &amp; Node Library</h1>
      </div>

      {/* Etapa BP4: eran tres bloques de texto para decir una sola cosa. */}
      <div className="bp-pending" role="status">
        <AlertTriangleIcon size={14} />
        <span>Not designed yet.</span>
      </div>
    </>
  );
}
