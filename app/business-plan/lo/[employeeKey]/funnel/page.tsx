'use client';

import { use } from 'react';
import FunnelCatalog from '../../../components/FunnelCatalog';

/*
 * LA VIA DEL PERFIL — etapa BP55.
 *
 * El catalogo entero vive en `components/FunnelCatalog`, porque el Marketplace
 * monta el MISMO componente con la persona elegida en un selector. Acá la
 * persona llega fija, de la URL, y esta pagina no decide nada mas: si decidiera
 * algo serian dos lugares decidiendo, que es lo que esta etapa vino a cerrar.
 */
export default function ChooseFunnelPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey } = use(params);
  return <FunnelCatalog employeeKey={Number(employeeKey)} />;
}
