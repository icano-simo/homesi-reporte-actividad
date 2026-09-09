import type { ReactNode } from 'react';
import ModuleSidebar from '../business-plan/components/ModuleSidebar';
/*
 * Se reusa la hoja del Business Plan --`.bp-btn`, `.bp-pending`, `.page-head`--
 * por el mismo motivo que Admin y Outlook: el lenguaje visual del portal ya
 * existe, y duplicar sus reglas garantiza que las dos versiones se separen con
 * el primer ajuste.
 *
 * ⚠ Y lo que NO se reusa: esta nota decia `.bp-hint` y esa clase no existe en
 * ninguna hoja del arbol. Se usaba en siete lugares y nunca fallo, porque un
 * parrafo sin regla hereda el texto del documento -- el respaldo que siempre
 * tiene algo que dar. Ahora es `.rv-hint`, definida en `review.css`.
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
   * ---------------------------------------------------------------------------
   * ⚠ Y EL SIDEBAR, PORQUE SI NO LA ENTRADA DESAPARECE AL USARLA
   * ---------------------------------------------------------------------------
   * `ModuleSidebar` lo monta `BusinessPlanShell`, que vive en el layout de
   * Business Plan. Al agregarle una entrada `Review` --que SALE del módulo--
   * quedó un camino donde el menú no está: medido, `/review` tenía CERO
   * elementos `.bp-nav-item`, así que desde acá no había cómo volver salvo por
   * las migas.
   *
   * Es el patrón de `Branch Out of Division`: el código no cambió, cambió el
   * conjunto de rutas que lo alcanza. Y bastaba con recorrer el link.
   *
   * ⚠ SE MONTA SÓLO `ModuleSidebar`, NO `BusinessPlanShell`. El shell trae
   * además el proveedor de datos del módulo, el botón de refrescar y el
   * mecanismo de migas por contexto --que acá fue un no-op silencioso-- y
   * ninguna de las tres corresponde: la revisión no es una sección de Business
   * Plan, sólo se llega desde ahí.
   */
  return (
    <div className="hub-container">
      <div className="bp-columns">
        <ModuleSidebar />
        <div className="bp-workspace">{children}</div>
      </div>
    </div>
  );
}
