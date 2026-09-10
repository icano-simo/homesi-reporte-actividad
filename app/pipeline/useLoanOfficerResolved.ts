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
 * Se trae solo lo necesario para el paso 1 de `resolveOfficer()`: filas de
 * `org.loan_officer_resolved` con `person_code` NO nulo -- las filas con
 * `person_code` null (loan officer conocido en la fuente pero sin persona
 * resuelta) no aportan nada a este mecanismo, así que se descartan a nivel
 * de query (`.not('person_code', 'is', null)`), no en memoria. El resultado
 * es un Map `loan_officer_name -> { personCode, nombreCanonico }` -- ausencia
 * en el Map (nombre no vino con person_code, o no está en la tabla en
 * absoluto) es indistinguible a propósito: en los dos casos el fallback de
 * `resolveOfficer()` sigue al mecanismo actual (`org.employee_alias`), igual
 * que si esta tabla no existiera.
 */

export interface LoanOfficerResolvedEntry {
  personCode: string;
  nombreCanonico: string;
}

export interface LoanOfficerResolvedIndex {
  /** `loan_officer_name` (tal cual llega del export) -> persona resuelta. */
  index: Map<string, LoanOfficerResolvedEntry>;
  loading: boolean;
  error: string | null;
}

export function useLoanOfficerResolved(): LoanOfficerResolvedIndex {
  const [state, setState] = useState<LoanOfficerResolvedIndex>({
    index: new Map(),
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
          .select('loan_officer_name, person_code, nombre_canonico')
          .not('person_code', 'is', null);
        if (error) throw new Error('org.loan_officer_resolved: ' + error.message);
        if (cancelled) return;

        const index = new Map<string, LoanOfficerResolvedEntry>();
        for (const row of (data ?? []) as { loan_officer_name: string; person_code: string; nombre_canonico: string }[]) {
          index.set(row.loan_officer_name, { personCode: row.person_code, nombreCanonico: row.nombre_canonico });
        }

        setState({ index, loading: false, error: null });
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
