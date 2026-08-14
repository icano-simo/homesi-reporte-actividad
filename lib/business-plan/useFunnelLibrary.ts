'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Funnel, FunnelNode, FunnelNodeLink, NodeMilestone, NodeOwner } from './funnels';

/**
 * ============================================================================
 * CARGA DE LA BIBLIOTECA DE FUNNELS
 * ============================================================================
 *
 * Etapa BP12 — ARCHIVO NUEVO.
 *
 * ⚠ TOLERANTE A QUE LAS TABLAS NO EXISTAN, y no por prolijidad: el SQL de la
 * fase 1 lo aplica el revisor, así que entre que este código se despliega y
 * alguien corre la migración hay una ventana en la que `business_plan.funnel`
 * no existe. Sin esto, el módulo entero tiraría un error 404 de PostgREST y la
 * biblioteca quedaría en blanco sin explicar por qué.
 *
 * Con `available = false` la pantalla dice exactamente qué falta.
 */

export interface SupportPerson {
  employee_key: number;
  full_name: string;
  email: string | null;
  job_title: string | null;
}

export interface FunnelLibrary {
  funnels: Funnel[];
  nodes: FunnelNode[];
  links: FunnelNodeLink[];
  milestones: NodeMilestone[];
  owners: NodeOwner[];
  support: SupportPerson[];
  /** Cuántos enrolamientos activos tiene cada funnel. Decide si se puede borrar. */
  enrollmentsByFunnel: Record<number, number>;
}

export interface LibraryState {
  data: FunnelLibrary | null;
  isLoading: boolean;
  /** false = las tablas todavía no están aplicadas en la base. */
  available: boolean;
  error: string | null;
  reload: () => void;
}

const EMPTY: FunnelLibrary = {
  funnels: [],
  nodes: [],
  links: [],
  milestones: [],
  owners: [],
  support: [],
  enrollmentsByFunnel: {},
};

export function useFunnelLibrary(): LibraryState {
  const [state, setState] = useState<Omit<LibraryState, 'reload'>>({
    data: null,
    isLoading: true,
    available: false,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const bp = supabase.schema('business_plan');
        const org = supabase.schema('org');

        /*
         * El equipo de soporte se lee siempre: existe desde antes de esta etapa
         * y es lo que puebla los desplegables de responsable.
         */
        const supportRes = await org
          .from('dim_employee')
          .select('employee_key, full_name, email, job_title')
          .eq('is_support', true)
          .eq('is_active', true)
          .order('full_name');

        const [funnelRes, nodeRes, linkRes, msRes, ownerRes, enrollRes] = await Promise.all([
          bp.from('funnel').select('*').order('position'),
          bp.from('node').select('*').order('name'),
          bp.from('funnel_node').select('*').order('position'),
          bp.from('node_milestone').select('*').order('position'),
          bp.from('node_owner').select('*'),
          bp.from('enrollment').select('funnel_key, status'),
        ]);
        if (cancelled) return;

        if (funnelRes.error) {
          // Las tablas no están aplicadas todavía. No es un fallo del usuario.
          setState({
            data: { ...EMPTY, support: (supportRes.data ?? []) as SupportPerson[] },
            isLoading: false,
            available: false,
            error: null,
          });
          return;
        }

        const enrollmentsByFunnel: Record<number, number> = {};
        for (const e of (enrollRes.data ?? []) as { funnel_key: number; status: string }[]) {
          if (e.status !== 'active') continue;
          enrollmentsByFunnel[e.funnel_key] = (enrollmentsByFunnel[e.funnel_key] ?? 0) + 1;
        }

        setState({
          data: {
            funnels: (funnelRes.data ?? []) as Funnel[],
            nodes: (nodeRes.data ?? []) as FunnelNode[],
            links: (linkRes.data ?? []) as FunnelNodeLink[],
            milestones: (msRes.data ?? []) as NodeMilestone[],
            owners: (ownerRes.data ?? []) as NodeOwner[],
            support: (supportRes.data ?? []) as SupportPerson[],
            enrollmentsByFunnel,
          },
          isLoading: false,
          available: true,
          error: null,
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            data: null,
            isLoading: false,
            available: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { ...state, reload };
}

/** El email de la sesión, para resolver quién puede marcar un milestone. */
export function useSessionEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSupabaseClient().auth.getUser();
      if (!cancelled) setEmail(data.user?.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return email;
}
