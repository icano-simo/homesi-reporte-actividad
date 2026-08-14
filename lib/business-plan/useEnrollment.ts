'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { MilestoneStatus } from './funnels';
import type { SupportPerson } from './useFunnelLibrary';

/**
 * ============================================================================
 * CARGA DEL PLAN ACTIVO DE UNA PERSONA
 * ============================================================================
 *
 * Etapa BP12, fase 4 — ARCHIVO NUEVO.
 *
 * Lee la INSTANCIA, no la plantilla: `enrollment_node` y `enrollment_milestone`
 * son copias propias de esta persona. Editarlas no toca a nadie más, que es
 * exactamente por lo que se copió al activar.
 *
 * Tolerante a que las tablas no existan todavía, igual que la biblioteca: el
 * SQL lo aplica el revisor.
 */

export interface PlanMilestone {
  enrollment_milestone_key: number;
  enrollment_node_key: number;
  title: string;
  accountable_employee_key: number | null;
  resource_url: string | null;
  due_date: string | null;
  status: MilestoneStatus;
  completed_at: string | null;
  completed_by: string | null;
  position: number;
}

export interface PlanNode {
  enrollment_node_key: number;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  milestones: PlanMilestone[];
}

export interface ActivePlan {
  enrollment_key: number;
  employee_key: number;
  funnel_key: number;
  funnel_name: string;
  activated_at: string;
  activated_by: string;
  nodes: PlanNode[];
  /** El equipo de soporte completo, para resolver nombres y emails. */
  support: SupportPerson[];
}

export interface EnrollmentState {
  plan: ActivePlan | null;
  isLoading: boolean;
  available: boolean;
  error: string | null;
  reload: () => void;
}

export function useEnrollment(employeeKey: number): EnrollmentState {
  const [state, setState] = useState<Omit<EnrollmentState, 'reload'>>({
    plan: null,
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

        const supportRes = await supabase
          .schema('org')
          .from('dim_employee')
          .select('employee_key, full_name, email, job_title')
          .eq('is_support', true)
          .eq('is_active', true)
          .order('full_name');

        const enrRes = await bp
          .from('enrollment')
          .select('*')
          .eq('employee_key', employeeKey)
          .eq('status', 'active')
          .limit(1);
        if (cancelled) return;

        if (enrRes.error) {
          setState({ plan: null, isLoading: false, available: false, error: null });
          return;
        }
        const enr = enrRes.data?.[0] as ActivePlan | undefined;
        if (!enr) {
          // Tablas aplicadas pero la persona no tiene plan: no es un error.
          setState({ plan: null, isLoading: false, available: true, error: null });
          return;
        }

        const [nodeRes, msRes] = await Promise.all([
          bp.from('enrollment_node').select('*').eq('enrollment_key', enr.enrollment_key).order('position'),
          bp.from('enrollment_milestone').select('*').order('position'),
        ]);
        if (cancelled) return;
        if (nodeRes.error) throw new Error(nodeRes.error.message);

        const rawNodes = (nodeRes.data ?? []) as Omit<PlanNode, 'milestones'>[];
        const nodeKeys = new Set(rawNodes.map((n) => n.enrollment_node_key));
        const allMs = ((msRes.data ?? []) as PlanMilestone[]).filter((m) => nodeKeys.has(m.enrollment_node_key));

        setState({
          plan: {
            ...enr,
            nodes: rawNodes.map((n) => ({
              ...n,
              milestones: allMs
                .filter((m) => m.enrollment_node_key === n.enrollment_node_key)
                .sort((a, b) => a.position - b.position),
            })),
            support: (supportRes.data ?? []) as SupportPerson[],
          },
          isLoading: false,
          available: true,
          error: null,
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            plan: null,
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
  }, [employeeKey, tick]);

  return { ...state, reload };
}
