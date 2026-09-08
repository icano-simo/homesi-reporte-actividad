import type { ReactNode } from 'react';
/*
 * Se reusa la hoja del Business Plan --`.bp-btn`, `.bp-pending`, `.bp-hint`,
 * `.page-head`-- por el mismo motivo que Admin y Outlook: el lenguaje visual del
 * portal ya existe, y duplicar sus reglas garantiza que las dos versiones se
 * separen con el primer ajuste.
 *
 * ⚠ `review.css` NO se importa acá, y es lo que hay que notar: la MÁSCARA vive
 * en el layout raíz para sobrevivir al cruce de módulo, así que su CSS tiene
 * que estar cargado en las cuatro pantallas del portal y no sólo en `/review`.
 * Se importa desde `app/layout.tsx`. Este layout sólo trae lo del módulo.
 */
import '../business-plan/styles/bp-visual.css';

/**
 * ============================================================================
 * LAYOUT DEL MODO REVISIÓN — etapa RV1
 * ============================================================================
 *
 * ⚠ El acceso NO se controla acá. Lo controla `proxy.ts`, que corre ANTES de
 * renderizar: un gate en el layout es un componente que ya se pintó.
 *
 * Y son dos permisos distintos: `/review` la ve el BP Team entero con
 * `commercial_activity`, y `/review/settings` exige `review_admin`. Ver
 * `CLAIMED_MODULES` en `proxy.ts`.
 */
export default function ReviewLayout({ children }: { children: ReactNode }) {
  /*
   * ⚠ `hub-container` Y NO SOLO `{children}`.
   *
   * `hub-canvas` --el <main> del layout raíz-- NO tiene padding: el contenedor
   * real de cada vista es `.hub-container`, con sus 32px laterales, y en
   * Business Plan lo pone `BusinessPlanShell`. Estas pantallas no cuelgan de ese
   * layout, así que sin esto el título arranca pegado al borde de la ventana.
   *
   * Lo encontró la captura: las 24 aserciones medían el texto del aviso y
   * ninguna medía dónde empezaba.
   *
   * Y NO se reusa `BusinessPlanShell`: trae el sidebar del módulo y su
   * proveedor de datos, que acá no corresponden -- la revisión no es una
   * sección de Business Plan.
   */
  return <div className="hub-container">{children}</div>;
}
