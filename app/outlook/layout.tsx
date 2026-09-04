import type { ReactNode } from 'react';
import { OutlookDataProvider } from '@/lib/outlook/useOutlookData';
import OutlookTopBar from './components/OutlookTopBar';
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
/* Y las propias: el editor y la tabla del año -- ver la cabecera de cada una. */
import './styles/ol-scale.css';
import './styles/ol-editor.css';
import './styles/ol-year.css';

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
/*
 * ⚠ El Provider va ACÁ y no en cada pantalla — etapa OL6.
 *
 * Un `layout.tsx` envuelve a las rutas hijas y NO se desmonta al navegar entre
 * ellas, así que los datos se cargan una vez para las dos vistas. Con el estado
 * en cada pantalla, ir de la vista 1 a la de un branch volvía a pedir las 33
 * consultas: medido, 5.4 s y 58 requests para una navegación.
 *
 * Ver `lib/outlook/useOutlookData.tsx`, que además memoiza la promesa a nivel
 * de módulo -- eso es lo que hace que el doble montaje de efectos de React en
 * desarrollo no duplique la carga.
 */
/*
 * ⚠ LA BARRA DEL MODULO VA ACA — etapa OL22.
 *
 * Dos controles que son de todo Outlook --el horizonte y el simulador de
 * reclutamiento-- vivian dentro de una pantalla. Puestos en el layout, que
 * envuelve a las dos rutas y NO se desmonta al navegar entre ellas, la seleccion
 * del horizonte sobrevive a ir de la lista a un branch. Si la barra viviera en
 * cada pagina, volveria al valor por defecto en cada navegacion.
 */
export default function OutlookLayout({ children }: { children: ReactNode }) {
  return (
    <OutlookDataProvider>
      <OutlookTopBar />
      {children}
    </OutlookDataProvider>
  );
}
