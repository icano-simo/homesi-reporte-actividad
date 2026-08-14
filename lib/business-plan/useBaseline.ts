'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Baseline } from './impact';

/**
 * ============================================================================
 * LECTURA DE LA LÍNEA BASE CONGELADA
 * ============================================================================
 *
 * Etapa BP22 — ARCHIVO NUEVO. El modelo y el porqué de congelarla están en
 * `docs/sql/2026-08-enrollment-baseline.sql`.
 *
 * ⚠ Tolerante a que la tabla no exista: el SQL lo aplica el revisor, así que
 * hay una ventana en la que este código está desplegado y la tabla no está.
 */

export interface BaselineState {
  baseline: Baseline | null;
  isLoading: boolean;
  /** false = la tabla todavía no está aplicada en la base. */
  available: boolean;
  error: string | null;
}

interface BaselineRow {
  enrollment_key: number;
  avg_closings: number | string;
  avg_credit_applications: number | string;
  avg_pre_approvals: number | string;
  avg_file_creations: number | string;
  baseline_months: string[];
  enrollment_month: string;
  source: 'captured' | 'reconstructed';
  captured_at: string;
}

export function useBaseline(enrollmentKey: number | null): BaselineState {
  const [state, setState] = useState<BaselineState>({
    baseline: null,
    isLoading: true,
    available: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (enrollmentKey === null) return;
    (async () => {
      const res = await getSupabaseClient()
        .schema('business_plan')
        .from('enrollment_baseline')
        .select('*')
        .eq('enrollment_key', enrollmentKey)
        .limit(1);
      if (cancelled) return;
      if (res.error) {
        const missing =
          res.error.code === '42P01' || res.error.code === 'PGRST205' || res.error.code === 'PGRST106';
        setState({ baseline: null, isLoading: false, available: !missing, error: missing ? null : res.error.message });
        return;
      }
      const row = (res.data ?? [])[0] as BaselineRow | undefined;
      setState({
        /*
         * `numeric` de Postgres llega como string por PostgREST -- no como
         * number. Sin este `Number()` la aritmética del porcentaje concatenaría
         * cadenas y el "antes" saldría absurdo sin ningún error visible.
         */
        baseline: row
          ? {
              enrollmentKey: row.enrollment_key,
              closings: Number(row.avg_closings),
              creditApplications: Number(row.avg_credit_applications),
              preApprovals: Number(row.avg_pre_approvals),
              fileCreations: Number(row.avg_file_creations),
              baselineMonths: row.baseline_months,
              enrollmentMonth: row.enrollment_month,
              source: row.source,
              capturedAt: row.captured_at,
            }
          : null,
        isLoading: false,
        available: true,
        error: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enrollmentKey]);

  /* Sin enrolamiento no hay nada que leer, y el valor se deriva. */
  if (enrollmentKey === null) return { baseline: null, isLoading: false, available: true, error: null };
  return state;
}
