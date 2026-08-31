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
 * LAYOUT DE ADMIN — etapa ADMIN-1
 * ============================================================================
 *
 * ⚠ El acceso NO se controla acá. Lo controla `proxy.ts` con el claim `admin`,
 * que corre ANTES de renderizar: un gate en el layout es un componente que ya
 * se pintó. Ver `CLAIMED_MODULES` en `proxy.ts`.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
