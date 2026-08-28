import type { ReactNode } from 'react';
/*
 * ⚠ Se importa la hoja del Business Plan, no una nueva.
 *
 * El brief pide explícitamente la misma estética y no inventar un lenguaje
 * visual nuevo. `bp-visual.css` ya tiene `.mcard`, las tablas del módulo, las
 * píldoras de estado y el sidebar; duplicar cualquiera de esas reglas acá
 * garantizaría que las dos versiones se separen con el primer ajuste.
 *
 * Importarla desde otro módulo es una lectura, no un cambio: el archivo no se
 * toca. Si algún día Outlook necesita reglas propias, van en un
 * `app/outlook/styles/` aparte y ESTA sigue siendo la base.
 */
import '../business-plan/styles/bp-visual.css';

/**
 * ============================================================================
 * LAYOUT DEL MÓDULO OUTLOOK — etapa OL1
 * ============================================================================
 *
 * Igual que el del Business Plan: un `layout.tsx` envuelve sólo a las rutas
 * hijas de su carpeta, así que la hoja de estilos y cualquier shell futuro
 * quedan contenidos acá y los otros módulos no se enteran.
 *
 * ⚠ El acceso NO se controla acá. Lo controla `proxy.ts`, que corre ANTES de
 * renderizar: un gate en el layout es un componente que ya se pintó, y para
 * cuando redirige la persona ya vio la pantalla. Ver el bloque de Outlook en
 * `proxy.ts`.
 */
export default function OutlookLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
