'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { buildAliasIndex, buildExcludedIndex, type AliasIndex } from '@/lib/business-plan/aliasIndex';
import type { DimBranch, DimEmployee, EmployeeAlias, SourceSystem } from '@/lib/business-plan/types';

/**
 * ============================================================================
 * ROSTER DE `org` PARA FORECAST (solo lectura) — Etapa F7, Parte 2
 * ============================================================================
 *
 * Decisión de arquitectura ya documentada en docs/ARQUITECTURA.md ("F7 —
 * decisión de acceso a org desde Forecast"): patrón client-side existente
 * (`getSupabaseClient().schema('org')`, el mismo mecanismo que ya usa
 * `getForecastDb()` para `pipeline_forecast`) -- no se toca
 * `lib/supabase/client.ts`, no se toca `lib/supabase/server.ts`, no se toca
 * `app/api/pipeline/**`.
 *
 * `buildAliasIndex`/`buildExcludedIndex` se importan tal cual de
 * `lib/business-plan/aliasIndex.ts` (lógica pura, sin cambios en ese
 * archivo) -- mismo criterio de resolución que ya usa Business Plan, para
 * no inventar una segunda forma de decidir qué nombre es qué persona.
 *
 * Se carga UNA sola vez (no en cada cambio de período/tab) -- el roster de
 * `org` no depende del período seleccionado ni cambia mientras dura la
 * sesión. Solo lo usa la pestaña Analytics; las otras 3 pestañas de
 * Forecast no importan este archivo y siguen leyendo `pipeline_forecast`
 * exactamente igual que antes.
 */

export interface OrgRoster {
  /** `org.dim_branch.branch_code` -- para el scorecard de branch. */
  knownBranchCodes: Set<string>;
  aliasIndex: AliasIndex;
  excludedIndex: { has(source: SourceSystem, nameRaw: string | null | undefined): boolean };
  /** `employee_key` -> `full_name`, para mostrar el nombre resuelto en los scorecards de persona. */
  employeeNameByKey: Map<number, string>;
  loading: boolean;
  error: string | null;
}

export function useOrgRoster(): OrgRoster {
  const [state, setState] = useState<OrgRoster>({
    knownBranchCodes: new Set(),
    aliasIndex: buildAliasIndex([]),
    excludedIndex: buildExcludedIndex([]),
    employeeNameByKey: new Map(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const org = getSupabaseClient().schema('org');
        const [branchesRes, employeesRes, aliasRes, excludedRes] = await Promise.all([
          org.from('dim_branch').select('branch_code'),
          org.from('dim_employee').select('employee_key, full_name'),
          org.from('employee_alias').select('source_system, name_raw, employee_key, match_method'),
          org.from('source_name_excluded').select('source_system, name_raw'),
        ]);
        for (const res of [branchesRes, employeesRes, aliasRes, excludedRes]) {
          if (res.error) throw new Error('org: ' + res.error.message);
        }
        if (cancelled) return;

        const knownBranchCodes = new Set(((branchesRes.data ?? []) as Pick<DimBranch, 'branch_code'>[]).map((b) => b.branch_code));
        const employeeNameByKey = new Map(
          ((employeesRes.data ?? []) as Pick<DimEmployee, 'employee_key' | 'full_name'>[]).map((e) => [e.employee_key, e.full_name])
        );
        const aliasIndex = buildAliasIndex((aliasRes.data ?? []) as EmployeeAlias[]);
        const excludedIndex = buildExcludedIndex(
          (excludedRes.data ?? []) as { source_system: SourceSystem; name_raw: string }[]
        );

        setState({ knownBranchCodes, aliasIndex, excludedIndex, employeeNameByKey, loading: false, error: null });
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
