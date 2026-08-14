'use client';

import { use } from 'react';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../../components/Breadcrumbs';

/**
 * Elección de funnel — placeholder.
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * La ruta existe para que "Choose a funnel" lleve a algún lado real en vez de a
 * un 404. El catálogo de funnels está explícitamente fuera del alcance de esta
 * etapa, así que acá no se maqueta nada: adelantar una lista de funnels
 * inventados sugeriría que el catálogo ya está decidido.
 */
export default function ChooseFunnelPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey } = use(params);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          { label: 'Loan Officer', href: '/business-plan/lo/' + employeeKey },
          { label: 'Choose a funnel' },
        ]}
      />
      <div className="page-head">
        <h1 className="page-head__title">Choose a funnel</h1>
      </div>
      <div className="bp-pending" role="status">
        <AlertTriangleIcon size={14} />
        <span>The funnel catalogue does not exist yet.</span>
      </div>
    </>
  );
}
