'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadBusinessPlanData } from './loadData';
import type { BusinessPlanData } from './types';

/**
 * Carga los datos del módulo una sola vez por sesión de navegador.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 *
 * Las 3 pantallas son rutas separadas, así que sin caché cada navegación
 * (Portfolio -> Branch -> LO -> volver) volvería a leer el roster completo y
 * las ~4.6k filas del lote activo. La promesa se memoiza a nivel de módulo:
 * la primera pantalla que monta dispara la carga y las demás se cuelgan de la
 * misma promesa.
 *
 * Etapa BP5: ahora SÍ hace falta invalidarlo sin recargar. Editar el benchmark
 * de alguien o una tasa en Settings cambia veredictos en las tres pantallas, y
 * dejar el caché viejo mostraría el número nuevo con el veredicto anterior.
 * Para eso están `invalidateBusinessPlanData()` y el `reload` que devuelve el
 * hook.
 */

let cached: Promise<BusinessPlanData> | null = null;

function getData(): Promise<BusinessPlanData> {
  if (!cached) {
    cached = loadBusinessPlanData().catch((err) => {
      // Un fallo no debe quedar cacheado: si no se limpia, la app queda rota
      // hasta recargar aunque el problema haya sido momentáneo.
      cached = null;
      throw err;
    });
  }
  return cached;
}

export function invalidateBusinessPlanData(): void {
  cached = null;
}

export interface BusinessPlanState {
  data: BusinessPlanData | null;
  isLoading: boolean;
  error: string | null;
}

export function useBusinessPlanData(): BusinessPlanState & { reload: () => void } {
  const [state, setState] = useState<BusinessPlanState>({ data: null, isLoading: true, error: null });
  /* Un contador basta para reejecutar el efecto; no hace falta más estado. */
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    invalidateBusinessPlanData();
    setState({ data: null, isLoading: true, error: null });
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getData()
      .then((data) => {
        if (!cancelled) setState({ data, isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { ...state, reload };
}
