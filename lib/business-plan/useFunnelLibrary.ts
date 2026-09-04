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

/**
 * El avance de una persona DENTRO de un nodo de su plan -- etapa BP41.
 *
 * El nombre es el de la COPIA (`enrollment_node.name`) y no el de la
 * plantilla: si el nodo se renombro despues de activar, el plan de esa
 * persona sigue diciendo con que se activo.
 */
export interface EnrolledNodeProgress {
  name: string;
  done: number;
  total: number;
}

/**
 * Una persona enrolada en un funnel, con su avance — etapa BP40.
 *
 * ⚠ EL AVANCE SE CUENTA EN STEPS Y NO EN NODOS. Un nodo "a medias" no significa
 * nada: lo que alguien completa son steps, y un nodo de ocho pesa distinto que
 * uno de dos. Contar nodos daria un porcentaje que no se corresponde con el
 * trabajo hecho.
 */
export interface EnrolledPerson {
  employee_key: number;
  full_name: string;
  /** Steps completados y totales de SU copia, no de la plantilla. */
  done: number;
  total: number;
  /** 0-100, redondeado. `0` cuando no hay steps: no se divide por cero. */
  pct: number;
  /**
   * El desglose por nodo, en el orden del plan -- etapa BP41.
   *
   * Va POR PERSONA y no agregado porque el promedio esconde lo que importa:
   * alguien que termino el primer nodo y alguien que va en 1 de 3 dan el
   * mismo numero agregado, y no son la misma situacion.
   *
   * `done` y `total` de arriba se SUMAN de aca, no se cuentan aparte: si no,
   * "4 of 12" podria no ser la suma de los nodos escritos al lado.
   */
  nodes: EnrolledNodeProgress[];
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
  /**
   * QUIÉNES son esos enrolados, con su avance — etapa BP40.
   *
   * ⚠ Es la misma fuente que `enrollmentsByFunnel`, no una segunda cuenta: el
   * contador se deriva de la longitud de esta lista. Dos consultas del mismo
   * número son dos números que pueden diferir, y la biblioteca ya usa el
   * contador para decidir si un funnel se puede borrar.
   */
  enrolledByFunnel: Record<number, EnrolledPerson[]>;
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
  enrolledByFunnel: {},
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

        const [funnelRes, nodeRes, linkRes, msRes, ownerRes, enrollRes, enrNodeRes, enrMsRes, empRes] =
          await Promise.all([
          bp.from('funnel').select('*').order('position'),
          bp.from('node').select('*').order('name'),
          bp.from('funnel_node').select('*').order('position'),
          bp.from('node_milestone').select('*').order('position'),
          bp.from('node_owner').select('*'),
          /*
           * ⚠ EL ENROLAMIENTO ENTERO desde BP40, no sólo `funnel_key, status`:
           * hace falta la persona y sus steps para poder decir quién está y
           * cuánto lleva. Son tres consultas más sobre las seis que ya había,
           * todas en el mismo `Promise.all`.
           */
          bp.from('enrollment').select('enrollment_key, employee_key, funnel_key, status'),
          /* `name` y `position` — etapa BP41: el avance se muestra desglosado
             por nodo ("Social media set up 3 of 3 · Content calendar 1 of 3"),
             y el nombre se lee de la COPIA, no de la plantilla: si la
             plantilla se renombró después, el plan de esa persona sigue
             diciendo con qué nodo se activó. */
          bp.from('enrollment_node').select('enrollment_node_key, enrollment_key, name, position'),
          bp.from('enrollment_milestone').select('enrollment_node_key, status'),
          /*
           * ⚠ LOS NOMBRES, Y NO ALCANZA CON `supportRes`. Esa consulta trae solo
           * al equipo de soporte (`is_support`), y quien se enrola es un Loan
           * Officer: el nombre faltaba SIEMPRE y el fallback lo tapaba con
           * `employee 25`. La pantalla no rompia -- mostraba una clave donde iba
           * una persona.
           */
          org.from('dim_employee').select('employee_key, full_name'),
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

        /*
         * ══════════════════════════════════════════════════════════════════════
         * QUIÉN ESTÁ EN CADA FUNNEL, Y CUÁNTO LLEVA — etapa BP40
         * ══════════════════════════════════════════════════════════════════════
         *
         * Hoy hay tres personas enroladas y no había ningún lugar donde verlas
         * sin entrar a cada perfil, uno por uno.
         *
         * ⚠ EL CONTADOR SE DERIVA DE LA LISTA, no se cuenta aparte. La
         * biblioteca usa `enrollmentsByFunnel` para decidir si un funnel se
         * puede borrar; si la lista y el contador salieran de dos recorridos
         * distintos, podrían decir cosas distintas sobre lo mismo.
         *
         * ⚠ Y SÓLO LOS `active`. Un enrolamiento completado o cancelado no
         * ocupa el funnel ni impide borrarlo.
         */
        const enrollments = (enrollRes.data ?? []) as {
          enrollment_key: number;
          employee_key: number;
          funnel_key: number;
          status: string;
        }[];
        const enrNodes = (enrNodeRes.data ?? []) as {
          enrollment_node_key: number;
          enrollment_key: number;
          name: string;
          position: number;
        }[];
        const enrMs = (enrMsRes.data ?? []) as { enrollment_node_key: number; status: string }[];

        /*
         * Los steps de cada enrolamiento, por su nodo.
         *
         * ⚠ SE CUENTA POR NODO Y EL TOTAL SE SUMA DE AHÍ — etapa BP41. El
         * desglose y el total salen del mismo recorrido a propósito: contando
         * el total aparte, "4 of 12" podría no ser la suma de los nodos que
         * están escritos al lado, y es justo la comparación que alguien va a
         * hacer al mirarlo.
         */
        const nodoDeEnr = new Map<number, { enrollment: number; name: string; position: number }>();
        for (const n of enrNodes) {
          nodoDeEnr.set(n.enrollment_node_key, {
            enrollment: n.enrollment_key,
            name: n.name,
            position: n.position,
          });
        }
        const porNodo = new Map<number, Map<number, EnrolledNodeProgress & { position: number }>>();
        for (const m of enrMs) {
          const n = nodoDeEnr.get(m.enrollment_node_key);
          if (n === undefined) continue;
          const delEnr = porNodo.get(n.enrollment) ?? new Map();
          const acc = delEnr.get(m.enrollment_node_key) ?? {
            name: n.name,
            done: 0,
            total: 0,
            position: n.position,
          };
          acc.total += 1;
          if (m.status === 'completed') acc.done += 1;
          delEnr.set(m.enrollment_node_key, acc);
          porNodo.set(n.enrollment, delEnr);
        }
        const stepsOf = new Map<number, { done: number; total: number; nodes: EnrolledNodeProgress[] }>();
        for (const [ek, delEnr] of porNodo) {
          const nodes = [...delEnr.values()]
            .sort((a, b) => a.position - b.position)
            .map(({ name, done, total }) => ({ name, done, total }));
          stepsOf.set(ek, {
            done: nodes.reduce((s, n) => s + n.done, 0),
            total: nodes.reduce((s, n) => s + n.total, 0),
            nodes,
          });
        }

        const nameOf = new Map<number, string>();
        for (const e of (empRes.data ?? []) as { employee_key: number; full_name: string }[]) {
          nameOf.set(e.employee_key, e.full_name);
        }

        const enrolledByFunnel: Record<number, EnrolledPerson[]> = {};
        for (const e of enrollments) {
          if (e.status !== 'active') continue;
          const st = stepsOf.get(e.enrollment_key) ?? { done: 0, total: 0, nodes: [] };
          (enrolledByFunnel[e.funnel_key] ??= []).push({
            employee_key: e.employee_key,
            /*
             * ⚠ EL FALLBACK SE QUEDA, PERO YA NO SE EJERCE, y esa es la
             * diferencia. Antes tapaba una consulta que faltaba -- el nombre no
             * estaba NUNCA y la pantalla mostraba `employee 25`. Ahora los
             * nombres vienen de `dim_employee`, así que esto sólo actúa si una
             * persona enrolada dejó de existir en el roster, que es un dato roto
             * de verdad y conviene que se vea como tal.
             */
            full_name: nameOf.get(e.employee_key) ?? `employee ${e.employee_key}`,
            done: st.done,
            total: st.total,
            pct: st.total === 0 ? 0 : Math.round((st.done / st.total) * 100),
            nodes: st.nodes,
          });
        }
        for (const lista of Object.values(enrolledByFunnel)) {
          lista.sort((a, b) => b.pct - a.pct || a.full_name.localeCompare(b.full_name));
        }

        const enrollmentsByFunnel: Record<number, number> = {};
        for (const [fk, lista] of Object.entries(enrolledByFunnel)) {
          enrollmentsByFunnel[Number(fk)] = lista.length;
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
            enrolledByFunnel,
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
