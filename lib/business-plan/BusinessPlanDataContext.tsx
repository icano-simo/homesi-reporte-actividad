'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useBusinessPlanData, type BusinessPlanState } from './useBusinessPlanData';

/**
 * ============================================================================
 * CONTEXTO DE DATOS DEL MÓDULO — Etapa BUSINESS-PLAN-1
 * ============================================================================
 *
 * `useBusinessPlanData()` (sin tocar acá) ya cachea la carga de red a nivel de
 * módulo -- una sola vez por sesión, sin importar cuántas pantallas la pidan.
 * Lo que NO estaba resuelto es que cada pantalla llamaba al hook por su
 * cuenta, con su propio `useState({ isLoading: true, ... })` inicial: al
 * navegar de Portfolio a un branch, la pantalla nueva no repite la carga (la
 * promesa ya está resuelta), pero sí repite el flash de "Loading…" porque su
 * PROPIO estado de React arranca en `isLoading: true` hasta que el efecto
 * corre.
 *
 * Este archivo no reemplaza al hook ni duplica su lógica: el Provider llama a
 * `useBusinessPlanData()` una sola vez, montado en `layout.tsx` (que no se
 * desmonta al navegar entre las rutas del módulo -- ver ese archivo), y las
 * pantallas migradas leen ese mismo resultado por Context en vez de volver a
 * invocar el hook. El caché de módulo (`getData()`/`invalidateBusinessPlanData()`
 * en `useBusinessPlanData.ts`) sigue siendo la única fuente de verdad; esto
 * sólo cambia DÓNDE vive el `useState` que lo envuelve.
 *
 * Las pantallas que todavía no se migraron a este contexto (group, funnel,
 * impact, plan, settings, team) siguen llamando a `useBusinessPlanData()`
 * directo, sin cambios -- cuelgan de la misma caché de módulo, así que no hay
 * una segunda carga de red, sólo un segundo `useState` en paralelo.
 */

type BusinessPlanContextValue = BusinessPlanState & { reload: () => void };

const BusinessPlanDataContext = createContext<BusinessPlanContextValue | null>(null);

export function BusinessPlanDataProvider({ children }: { children: ReactNode }) {
  const state = useBusinessPlanData();
  return <BusinessPlanDataContext.Provider value={state}>{children}</BusinessPlanDataContext.Provider>;
}

/** Debe usarse dentro de `BusinessPlanDataProvider` (montado en app/business-plan/layout.tsx). */
export function useBusinessPlanDataContext(): BusinessPlanContextValue {
  const ctx = useContext(BusinessPlanDataContext);
  if (!ctx) {
    throw new Error('useBusinessPlanDataContext() se llamó fuera de BusinessPlanDataProvider.');
  }
  return ctx;
}
