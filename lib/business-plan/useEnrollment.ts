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
  /** Nulo en planes activados antes de BP14; ver el SQL de esa etapa. */
  sla_days: number | null;
  status: MilestoneStatus;
  completed_at: string | null;
  completed_by: string | null;
  position: number;
}

export interface PlanNode {
  enrollment_node_key: number;
  /** Nodo de la plantilla del que salió esta copia. Nulo si lo borraron. */
  source_node_key: number | null;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  milestones: PlanMilestone[];
  /**
   * ⚠ RESPONSABLES DEL NODO — etapa BP20. NO son los del paso.
   *
   * El del nodo responde por que la etapa avance; el del paso ejecuta ese paso
   * concreto y es el único que puede marcarlo hecho. En Cold Calling el nodo lo
   * llevan Juanjo Cabrera e Isabella Cano, y sus seis pasos se reparten entre
   * los dos: sin esta distinción la tarjeta mostraba avatares sueltos arriba a
   * la derecha que nadie sabía qué significaban.
   *
   * No están copiados en `enrollment_node` -- se resuelven en vivo contra
   * `node_owner` de la PLANTILLA, vía `source_node_key`. Es deliberado: quién
   * responde por una etapa es un hecho de organización actual, no una foto del
   * día en que alguien se enroló. Si Juanjo deja de llevar Cold Calling, deja
   * de llevarlo en los planes en curso también.
   */
  owners: SupportPerson[];
}

export interface ActivePlan {
  enrollment_key: number;
  employee_key: number;
  funnel_key: number;
  funnel_name: string;
  /** De la plantilla, en vivo: el enrolamiento no copia icono. Etapa BP21. */
  funnel_icon: string | null;
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

        const [nodeRes, msRes, ownerRes, funnelRes] = await Promise.all([
          bp.from('enrollment_node').select('*').eq('enrollment_key', enr.enrollment_key).order('position'),
          bp.from('enrollment_milestone').select('*').order('position'),
          /* Responsables de la PLANTILLA: ver el comentario de `PlanNode.owners`. */
          bp.from('node_owner').select('node_key, employee_key'),
          bp.from('funnel').select('funnel_key, icon').eq('funnel_key', enr.funnel_key).limit(1),
        ]);
        if (cancelled) return;
        if (nodeRes.error) throw new Error(nodeRes.error.message);

        const rawNodes = (nodeRes.data ?? []) as Omit<PlanNode, 'milestones' | 'owners'>[];
        const nodeKeys = new Set(rawNodes.map((n) => n.enrollment_node_key));
        const allMs = ((msRes.data ?? []) as PlanMilestone[]).filter((m) => nodeKeys.has(m.enrollment_node_key));
        const support = (supportRes.data ?? []) as SupportPerson[];
        const ownerRows = (ownerRes.data ?? []) as { node_key: number; employee_key: number }[];
        const funnelIcon =
          ((funnelRes.data ?? []) as { icon: string | null }[])[0]?.icon ?? null;

        setState({
          plan: {
            ...enr,
            funnel_icon: funnelIcon,
            nodes: rawNodes.map((n) => ({
              ...n,
              milestones: allMs
                .filter((m) => m.enrollment_node_key === n.enrollment_node_key)
                .sort((a, b) => a.position - b.position),
              owners:
                n.source_node_key === null
                  ? []
                  : (ownerRows
                      .filter((o) => o.node_key === n.source_node_key)
                      .map((o) => support.find((s) => s.employee_key === o.employee_key))
                      .filter(Boolean) as SupportPerson[]),
            })),
            support,
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
