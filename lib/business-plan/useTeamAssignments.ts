'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { MilestoneStatus } from './funnels';
import type { SupportPerson } from './useFunnelLibrary';

/**
 * ============================================================================
 * CARGA DEL CONSOLIDADO DEL EQUIPO DE SOPORTE
 * ============================================================================
 *
 * Etapa BP20 — ARCHIVO NUEVO. Es lo que alimenta el módulo BP Team.
 *
 * ---------------------------------------------------------------------------
 * SE LEE TODO Y SE FILTRA EN MEMORIA. A PROPÓSITO.
 * ---------------------------------------------------------------------------
 * La consulta natural sería "los pasos de esta persona", con un `eq` sobre
 * `accountable_employee_key`. No se hace, por dos razones:
 *
 *   · El selector permite mirar el consolidado de OTRO del equipo, y con el
 *     filtro en la base cada cambio del desplegable dispararía cinco consultas
 *     de nuevo. Filtrando en memoria, cambiar de persona es instantáneo.
 *   · Los pasos de un plan no viven en la misma tabla que el plan: para saber
 *     de qué Loan Officer es un paso hay que subir por `enrollment_node` hasta
 *     `enrollment`. Con dos planes activos y catorce pasos cada uno, traer las
 *     tres tablas enteras son tres viajes; hacerlo al revés serían decenas.
 *
 * Cuando esto sean cientos de planes habrá que dar vuelta la decisión, y
 * entonces la vista correcta es una del lado de Postgres. Hoy no.
 */

/** Un paso de un plan activo, con todo lo que hace falta para mostrarlo. */
export interface TeamStep {
  enrollment_milestone_key: number;
  enrollment_key: number;
  /** El Loan Officer dueño del plan. */
  employee_key: number;
  funnel_name: string;
  funnel_icon: string | null;
  node_name: string;
  title: string;
  status: MilestoneStatus;
  due_date: string | null;
  accountable_employee_key: number | null;
}

/**
 * Una etapa de la que alguien es RESPONSABLE DE NODO.
 *
 * ⚠ No es lo mismo que tener pasos asignados, y por eso va en una lista aparte.
 * Se puede responder por que una etapa avance sin ejecutar ni uno de sus pasos
 * -- es justamente el caso de un manager. Mezclarlas en una sola tabla haría
 * pensar que hay trabajo asignado donde lo que hay es supervisión.
 */
export interface TeamNode {
  enrollment_node_key: number;
  employee_key: number;
  funnel_name: string;
  funnel_icon: string | null;
  node_name: string;
  ownerKeys: number[];
  done: number;
  total: number;
  /** La fecha límite más próxima entre sus pasos sin cerrar. */
  nextDue: string | null;
}

export interface TeamData {
  team: SupportPerson[];
  steps: TeamStep[];
  nodes: TeamNode[];
}

export interface TeamState {
  data: TeamData | null;
  isLoading: boolean;
  available: boolean;
  error: string | null;
  reload: () => void;
}

export function useTeamAssignments(): TeamState {
  const [state, setState] = useState<Omit<TeamState, 'reload'>>({
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

        const teamRes = await supabase
          .schema('org')
          .from('dim_employee')
          .select('employee_key, full_name, email, job_title')
          .eq('is_support', true)
          .eq('is_active', true)
          .order('full_name');

        const [enrRes, nodeRes, msRes, ownerRes, funnelRes] = await Promise.all([
          bp.from('enrollment').select('enrollment_key, employee_key, funnel_key, funnel_name').eq('status', 'active'),
          bp.from('enrollment_node').select('enrollment_node_key, enrollment_key, source_node_key, name, position'),
          bp.from('enrollment_milestone').select('*'),
          bp.from('node_owner').select('node_key, employee_key'),
          bp.from('funnel').select('funnel_key, icon'),
        ]);
        if (cancelled) return;

        if (enrRes.error) {
          // Tablas del catálogo sin aplicar. No es un fallo del usuario.
          setState({
            data: { team: (teamRes.data ?? []) as SupportPerson[], steps: [], nodes: [] },
            isLoading: false,
            available: false,
            error: null,
          });
          return;
        }

        const enrollments = (enrRes.data ?? []) as {
          enrollment_key: number;
          employee_key: number;
          funnel_key: number;
          funnel_name: string;
        }[];
        const rawNodes = (nodeRes.data ?? []) as {
          enrollment_node_key: number;
          enrollment_key: number;
          source_node_key: number | null;
          name: string;
          position: number;
        }[];
        const rawMs = (msRes.data ?? []) as {
          enrollment_milestone_key: number;
          enrollment_node_key: number;
          title: string;
          status: MilestoneStatus;
          due_date: string | null;
          accountable_employee_key: number | null;
        }[];
        const ownerRows = (ownerRes.data ?? []) as { node_key: number; employee_key: number }[];
        const iconOf = new Map(
          ((funnelRes.data ?? []) as { funnel_key: number; icon: string | null }[]).map((f) => [f.funnel_key, f.icon])
        );

        /* Sólo lo de los planes ACTIVOS: `enrollment_milestone` no se filtra por
           estado del plan, así que sin esto entrarían los cancelados. */
        const enrByKey = new Map(enrollments.map((e) => [e.enrollment_key, e]));
        const liveNodes = rawNodes.filter((n) => enrByKey.has(n.enrollment_key));
        const nodeByKey = new Map(liveNodes.map((n) => [n.enrollment_node_key, n]));

        const steps: TeamStep[] = [];
        for (const m of rawMs) {
          const n = nodeByKey.get(m.enrollment_node_key);
          if (!n) continue;
          const e = enrByKey.get(n.enrollment_key);
          if (!e) continue;
          steps.push({
            enrollment_milestone_key: m.enrollment_milestone_key,
            enrollment_key: e.enrollment_key,
            employee_key: e.employee_key,
            funnel_name: e.funnel_name,
            funnel_icon: iconOf.get(e.funnel_key) ?? null,
            node_name: n.name,
            title: m.title,
            status: m.status,
            due_date: m.due_date,
            accountable_employee_key: m.accountable_employee_key,
          });
        }

        const nodes: TeamNode[] = liveNodes.map((n) => {
          const e = enrByKey.get(n.enrollment_key)!;
          const own = n.source_node_key === null ? [] : ownerRows.filter((o) => o.node_key === n.source_node_key);
          const its = rawMs.filter((m) => m.enrollment_node_key === n.enrollment_node_key);
          const open = its.filter((m) => m.status !== 'done' && m.due_date !== null).map((m) => m.due_date as string);
          return {
            enrollment_node_key: n.enrollment_node_key,
            employee_key: e.employee_key,
            funnel_name: e.funnel_name,
            funnel_icon: iconOf.get(e.funnel_key) ?? null,
            node_name: n.name,
            ownerKeys: own.map((o) => o.employee_key),
            done: its.filter((m) => m.status === 'done').length,
            total: its.length,
            nextDue: open.length === 0 ? null : open.sort()[0],
          };
        });

        setState({
          data: { team: (teamRes.data ?? []) as SupportPerson[], steps, nodes },
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
