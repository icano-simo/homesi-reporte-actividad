'use client';

import Breadcrumbs from '../components/Breadcrumbs';

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
    <div className="hub-container">
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnel & Node Library' }]} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">Funnel &amp; Node Library</h1>
          <p className="page-head__subtitle">Master library of funnels, nodes and owners.</p>
        </div>
      </div>

      <p className="bp-library-note">
        This section will hold the reusable building blocks of a business plan: the funnels a Loan Officer can be
        assigned, the nodes each funnel is made of, and who owns each one.
      </p>

      <div className="bp-placeholder">
        <span className="bp-placeholder__tag">Pending — not designed yet</span>
        <div className="bp-placeholder__title">Nothing is laid out here on purpose</div>
        <p className="bp-placeholder__note">
          The library&apos;s structure has not been defined with the business. Sketching a table or a card grid now
          would suggest decisions that nobody has taken — the same reason the triage engine is still empty.
        </p>
      </div>
    </div>
  );
}
