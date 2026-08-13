import type { ReactNode } from 'react';
import ModuleSidebar from './components/ModuleSidebar';
import './styles/bp-visual.css';

/**
 * ============================================================================
 * LAYOUT DEL MÓDULO BUSINESS PLAN
 * ============================================================================
 *
 * Etapa BP2 — ARCHIVO NUEVO.
 *
 * Es la razón por la que el sidebar existe SÓLO acá: en App Router un
 * `layout.tsx` envuelve a todas las rutas hijas de su carpeta y a ninguna
 * otra. Commercial Activity (`/`) y Forecast (`/pipeline`) no cuelgan de este
 * layout, así que ni se enteran.
 *
 * Además el layout no se vuelve a montar al navegar entre rutas hijas: el
 * sidebar se dibuja una vez y conserva su estado de colapsado mientras se pasa
 * de Portfolio a Branch y a Loan Officer.
 *
 * `bp-visual.css` se importa acá y no en cada página: es el punto único por el
 * que pasa todo el módulo, y así no se repite el import en cuatro archivos.
 */
export default function BusinessPlanLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bp-shell">
      <ModuleSidebar />
      <div className="bp-workspace">{children}</div>
    </div>
  );
}
