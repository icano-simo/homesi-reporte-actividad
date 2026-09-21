'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * ============================================================================
 * `org.loan_officer_resolved` PARA EL FORECAST DE LOAN OFFICER (solo lectura)
 * ============================================================================
 *
 * Archivo hermano de `useOrgRoster.ts`, deliberadamente SEPARADO -- no se
 * mezcla ahí adentro. `useOrgRoster` carga el roster general (`dim_branch`,
 * `dim_employee`, `employee_alias`, `source_name_excluded`) que usan varias
 * pestañas de Forecast/Analytics; este hook es un fetch propio, angosto,
 * consumido HOY solo por `buildLoanOfficerForecastRows()`
 * (lib/pipeline/loanOfficerForecast.ts) -- no se vuelve una dependencia
 * global de otros tabs con este cambio.
 *
 * Se trae de `org.loan_officer_resolved` lo necesario para los DOS usos de
 * `resolveOfficer()`: el paso 1 (filas con `person_code` NO nulo -> persona
 * resuelta) y la marca "Fuera de división" del paso 2 (filas con
 * `person_code` NULO -> si esa fila trae `es_de_la_division = false`). Ya NO
 * se filtra a nivel de query -- antes (`.not('person_code', 'is', null)`) las
 * filas sin persona resuelta no aportaban nada y se descartaban en la propia
 * consulta; ahora hacen falta para saber si el nombre crudo es un caso
 * conocido de "fuera de división" y no simplemente un nombre ausente de la
 * vista. El resultado son DOS Maps separados por ese mismo corte:
 * `index` (persona resuelta) y `outOfDivisionIndex` (marca para el
 * fallback). Un nombre ausente de los dos Maps sigue siendo indistinguible
 * de un nombre "fuera de división" con la marca en `false` -- en ambos casos
 * el fallback de `resolveOfficer()` muestra el nombre crudo sin marca.
 */

export interface LoanOfficerResolvedEntry {
  personCode: string;
  nombreCanonico: string;
}

export interface LoanOfficerResolvedIndex {
  /** `loan_officer_name` (tal cual llega del export) -> persona resuelta. */
  index: Map<string, LoanOfficerResolvedEntry>;
  /**
   * `loan_officer_name` -> `es_de_la_division === false`, solo para las
   * filas SIN `person_code` (las que no entran en `index`). Se consulta
   * únicamente cuando `resolveOfficer()` ya cayó al fallback de nombre
   * crudo -- ver lib/pipeline/loanOfficerForecast.ts.
   */
  outOfDivisionIndex: Map<string, boolean>;
  loading: boolean;
  error: string | null;
}

export function useLoanOfficerResolved(): LoanOfficerResolvedIndex {
  const [state, setState] = useState<LoanOfficerResolvedIndex>({
    index: new Map(),
    outOfDivisionIndex: new Map(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const org = getSupabaseClient().schema('org');
        const { data, error } = await org
          .from('loan_officer_resolved')
          .select('loan_officer_name, person_code, nombre_canonico, es_de_la_division');
        if (error) throw new Error('org.loan_officer_resolved: ' + error.message);
        if (cancelled) return;

        const index = new Map<string, LoanOfficerResolvedEntry>();
        const outOfDivisionIndex = new Map<string, boolean>();
        for (const row of (data ?? []) as {
          loan_officer_name: string;
          person_code: string | null;
          nombre_canonico: string;
          es_de_la_division: boolean | null;
        }[]) {
          if (row.person_code !== null) {
            index.set(row.loan_officer_name, { personCode: row.person_code, nombreCanonico: row.nombre_canonico });
          } else {
            outOfDivisionIndex.set(row.loan_officer_name, row.es_de_la_division === false);
          }
        }

        setState({ index, outOfDivisionIndex, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : String(err) }));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
