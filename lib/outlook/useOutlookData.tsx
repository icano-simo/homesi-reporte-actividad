'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadOutlookData, type OutlookData } from './loadData';

/*
 * ============================================================================
 * LOS DATOS DE OUTLOOK, UNA SOLA VEZ — etapa OL6
 * ============================================================================
 *
 * Mismo patrón que `lib/business-plan/useBusinessPlanData.ts` + su
 * `BusinessPlanDataContext`, y por el mismo síntoma: dos rutas separadas que
 * cargaban lo mismo por su cuenta.
 *
 * ---------------------------------------------------------------------------
 * ⚠ QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO
 * ---------------------------------------------------------------------------
 * Con el navegador, contando los requests REST a Supabase:
 *
 *   /outlook                    7.8 s · 33 requests
 *   /outlook/branch/733         7.2 s · 29 requests
 *   navegar de una a otra       5.4 s · 58 requests
 *
 * Y el reparto del tiempo: la última respuesta REST de la vista 1 llegaba a los
 * 7.58 s y la tabla aparecía a los 7.85 s. O sea que **el cálculo de las
 * proyecciones son 264 ms** --35 ms en la vista 2-- y todo lo demás es esperar
 * datos. Las 37 personas × 5 estrategias × 12 meses no son el problema; la
 * sospecha razonable estaba equivocada y se descartó midiendo.
 *
 * ---------------------------------------------------------------------------
 * DOS CACHÉS, NO UNA
 * ---------------------------------------------------------------------------
 * 1. La PROMESA se memoiza a nivel de módulo (`cached`). La primera pantalla
 *    que monta dispara la carga y las demás se cuelgan de la misma promesa. Eso
 *    resuelve tres cosas a la vez: navegar entre las dos vistas, el doble
 *    montaje de efectos que React hace en desarrollo, y dos componentes que
 *    pidan los datos en el mismo render.
 *
 * 2. El Provider vive en `app/outlook/layout.tsx`, que NO se desmonta al
 *    navegar entre las rutas del módulo. Sin eso, cada pantalla tendría su
 *    propio `useState({ isLoading: true })` y repetiría el "Loading…" aunque la
 *    promesa ya estuviera resuelta -- exactamente lo que documenta
 *    `BusinessPlanDataContext`.
 *
 * ⚠ Un fallo NO se cachea. Si se cacheara, un error momentáneo dejaría el
 * módulo roto hasta recargar la pestaña.
 */

let cached: Promise<OutlookData> | null = null;

function getData(): Promise<OutlookData> {
  if (!cached) {
    cached = loadOutlookData().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

/**
 * Tira el caché. La llaman los editores después de guardar: un benchmark o una
 * regla nueva cambian las columnas proyectadas de las dos vistas, y dejar el
 * caché viejo mostraría el dato guardado con la proyección anterior.
 */
export function invalidateOutlookData(): void {
  cached = null;
}

export interface OutlookState {
  data: OutlookData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * ============================================================================
 * ⚠ EL HORIZONTE ES DEL MÓDULO, NO DE UNA PANTALLA — etapa OL22
 * ============================================================================
 *
 * `Project through` vivía en el estado de la vista de cada branch, así que
 * elegir "Dec 2028" en el 747 no cambiaba nada en el 733 y había que repetir la
 * selección trece veces. Un horizonte distinto por branch no significa nada: el
 * presupuesto es de la división.
 *
 * Vive acá y no en `OutlookData` --que es lo que primero se piensa-- por la
 * razón que fijó OL12: meterlo en el loader obligaría a recargar las 33
 * consultas cada vez que alguien mira un año más. Es una decisión del USUARIO
 * sobre cuánto mirar, no un dato.
 *
 * `null` = hasta diciembre del año en curso, que es el valor por defecto y el
 * único con el que la tabla de la vista 1 sigue siendo los doce meses del año.
 * Cada pantalla lo traduce a su lista de meses.
 */
type OutlookContextValue = OutlookState & {
  reload: () => Promise<void>;
  /** Meses hacia adelante desde el actual. `null` = hasta diciembre. */
  horizonMonths: number | null;
  setHorizonMonths: (n: number | null) => void;
};

const OutlookDataContext = createContext<OutlookContextValue | null>(null);

export function OutlookDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OutlookState>({ data: null, isLoading: true, error: null });
  const [tick, setTick] = useState(0);
  /*
   * El horizonte, compartido por las dos vistas -- etapa OL22. Vive en el
   * Provider, que el layout monta UNA vez y no se desmonta al navegar entre
   * pantallas, asi que la seleccion sobrevive a ir de la vista 1 a un branch.
   */
  const [horizonMonths, setHorizonMonths] = useState<number | null>(null);

  /*
   * `reload` devuelve una promesa y los editores la ESPERAN antes de anunciar
   * el guardado -- ver la nota en `StrategyEditor`. Sin eso la pantalla decía
   * "guardada la revisión 2" mientras el título seguía mostrando la 1.
   */
  const reload = useCallback(() => {
    invalidateOutlookData();
    setState((s) => ({ ...s, isLoading: true }));
    setTick((t) => t + 1);
    return getData().then(
      () => undefined,
      () => undefined
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    getData()
      .then((data) => {
        if (!cancelled) setState({ data, isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ data: null, isLoading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <OutlookDataContext.Provider value={{ ...state, reload, horizonMonths, setHorizonMonths }}>
      {children}
    </OutlookDataContext.Provider>
  );
}

/** Debe usarse dentro de `OutlookDataProvider` (montado en app/outlook/layout.tsx). */
export function useOutlookDataContext(): OutlookContextValue {
  const ctx = useContext(OutlookDataContext);
  if (!ctx) throw new Error('useOutlookDataContext fuera de OutlookDataProvider');
  return ctx;
}
