/**
 * ============================================================================
 * FUNNELS — plantillas, cálculo de fechas y copia al enrolar
 * ============================================================================
 *
 * Etapa BP12 — ARCHIVO NUEVO.
 *
 * Todo acá es función PURA: entra data, sale data. Sin fetch y sin `new Date()`
 * implícito -- la fecha de activación se pasa siempre por parámetro.
 *
 * No es una preferencia de estilo. Las tablas de este módulo todavía no están
 * aplicadas en la base (las aplica el revisor), así que la única forma de
 * demostrar que la copia y las fechas funcionan es ejecutarlas contra datos
 * armados a mano. Si esta lógica viviera dentro de un componente o pegada a un
 * cliente de Supabase, no habría nada que probar hasta después del deploy.
 */

/* ─────────────────────────── Plantillas ────────────────────────────────── */

export type FunnelCategory = 'core' | 'growth';

export interface Funnel {
  funnel_key: number;
  name: string;
  category: FunnelCategory;
  description: string | null;
  icon: string | null;
  duration_weeks: number | null;
  position: number;
  is_active: boolean;
  is_example: boolean;
}

export interface FunnelNode {
  node_key: number;
  name: string;
  description: string | null;
  icon: string | null;
  is_example: boolean;
}

export interface FunnelNodeLink {
  funnel_key: number;
  node_key: number;
  position: number;
}

export interface NodeMilestone {
  milestone_key: number;
  node_key: number;
  title: string;
  accountable_employee_key: number | null;
  sla_days: number | null;
  resource_url: string | null;
  position: number;
}

export interface NodeOwner {
  node_key: number;
  employee_key: number;
}

/* ─────────────────────────── Instancias ────────────────────────────────── */

export type MilestoneStatus = 'pending' | 'in_progress' | 'done';

export interface EnrollmentNodeDraft {
  source_node_key: number;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  milestones: EnrollmentMilestoneDraft[];
}

export interface EnrollmentMilestoneDraft {
  source_milestone_key: number;
  title: string;
  accountable_employee_key: number | null;
  resource_url: string | null;
  due_date: string;
  position: number;
}

/* ─────────────────────── Conteos de la tarjeta ─────────────────────────── */

export interface FunnelStats {
  nodeCount: number;
  subMilestoneCount: number;
  /** Derivado de los responsables de los nodos y de sus milestones. */
  supportTeam: number[];
}

/**
 * Los conteos de la tarjeta del catálogo se CUENTAN, nunca salen de un campo.
 *
 * Y el equipo de soporte se DERIVA de los responsables. Guardarlo lo
 * desincronizaría en cuanto alguien cambie un responsable en la biblioteca: la
 * tarjeta seguiría mostrando a quien ya no participa.
 */
export function funnelStats(
  funnelKey: number,
  links: FunnelNodeLink[],
  milestones: NodeMilestone[],
  owners: NodeOwner[]
): FunnelStats {
  const nodeKeys = links.filter((l) => l.funnel_key === funnelKey).map((l) => l.node_key);
  const nodeSet = new Set(nodeKeys);
  const mine = milestones.filter((m) => nodeSet.has(m.node_key));
  const team = new Set<number>();
  for (const o of owners) if (nodeSet.has(o.node_key)) team.add(o.employee_key);
  for (const m of mine) if (m.accountable_employee_key !== null) team.add(m.accountable_employee_key);
  return {
    nodeCount: nodeKeys.length,
    subMilestoneCount: mine.length,
    supportTeam: [...team].sort((a, b) => a - b),
  };
}

/* ────────────────────── Rangos de días por nodo ────────────────────────── */

export interface NodeDayRange {
  node_key: number;
  position: number;
  /** Día 1-based desde el inicio del plan. */
  fromDay: number;
  toDay: number;
}

/**
 * El rango "DAY 1-5" de cada nodo se CALCULA; no se escribe a mano.
 *
 * Un nodo dura lo que tarda su último milestone (el mayor `sla_days`, que se
 * cuenta desde el inicio DEL NODO). Los nodos van uno después del otro, así que
 * cada uno arranca donde terminó el anterior.
 *
 * La consecuencia práctica es la que importa: al reordenar la secuencia con el
 * drag and drop, los rangos se recalculan solos. Si estuvieran guardados,
 * reordenar dejaría todas las fechas mintiendo.
 *
 * Un nodo sin milestones, o con todos sin SLA, dura 1 día: no puede durar 0
 * porque entonces dos nodos empezarían el mismo día y el rango sería vacío.
 */
export function nodeDayRanges(
  orderedNodeKeys: number[],
  milestones: NodeMilestone[]
): NodeDayRange[] {
  const out: NodeDayRange[] = [];
  let cursor = 1;
  orderedNodeKeys.forEach((node_key, i) => {
    const mine = milestones.filter((m) => m.node_key === node_key);
    const span = Math.max(1, ...mine.map((m) => m.sla_days ?? 0));
    out.push({ node_key, position: i + 1, fromDay: cursor, toDay: cursor + span - 1 });
    cursor += span;
  });
  return out;
}

/** 'YYYY-MM-DD' de `start` más `days` días. */
export function addDays(start: string, days: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/* ──────────────────── LA COPIA — el corazón del diseño ─────────────────── */

/**
 * Arma el plan de una persona COPIANDO la plantilla.
 *
 * ⚠ ES UNA COPIA, NO UNA REFERENCIA, y es la decisión central del módulo.
 *
 * Si el plan apuntara a la plantilla, editar un funnel en la biblioteca
 * cambiaría retroactivamente el plan de todos los enrolados: alguien con 11 de
 * 19 milestones hechos pasaría de golpe a otro plan y su progreso dejaría de
 * significar nada. Mismo principio que el histórico de forecast -- lo que pasó
 * no se recalcula cuando cambian las reglas.
 *
 * Es también lo que permite editar el plan de una persona sin afectar a nadie
 * más, y por eso no hace falta una plantilla nueva por cada variación.
 *
 * `source_node_key` y `source_milestone_key` viajan sólo como trazabilidad: en
 * la base son `ON DELETE SET NULL`, así que borrar la plantilla no rompe el
 * plan en curso.
 *
 * LAS FECHAS LÍMITE se resuelven acá, al copiar: fecha de activación más los
 * SLA acumulados. El SLA de un milestone se cuenta desde el inicio de SU nodo,
 * y el nodo arranca donde terminó el anterior.
 */
export function buildEnrollmentPlan(
  orderedNodeKeys: number[],
  nodes: FunnelNode[],
  milestones: NodeMilestone[],
  activationDate: string
): EnrollmentNodeDraft[] {
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const ranges = nodeDayRanges(orderedNodeKeys, milestones);

  return orderedNodeKeys.flatMap((node_key, i) => {
    const node = byKey.get(node_key);
    if (!node) return [];
    const range = ranges[i];
    const mine = milestones
      .filter((m) => m.node_key === node_key)
      .sort((a, b) => a.position - b.position);

    return [
      {
        source_node_key: node_key,
        name: node.name,
        description: node.description,
        icon: node.icon,
        position: i + 1,
        milestones: mine.map((m, j) => ({
          source_milestone_key: m.milestone_key,
          title: m.title,
          accountable_employee_key: m.accountable_employee_key,
          resource_url: m.resource_url,
          /*
           * `fromDay` es 1-based (el día 1 es el de activación), así que se
           * suma `fromDay - 1` para no correr todo el plan un día.
           */
          due_date: addDays(activationDate, range.fromDay - 1 + (m.sla_days ?? 0)),
          position: j + 1,
        })),
      },
    ];
  });
}

/* ───────────────────────────── Permisos ────────────────────────────────── */

/**
 * Sólo el responsable de un milestone puede marcarlo como hecho.
 *
 * La comparación es por EMAIL contra el del `accountable_employee_key`, que es
 * el mismo criterio con el que la sesión identifica a la persona. Comparar por
 * nombre sería frágil -- el roster tiene "Ana Zegarra (Peña)" y "Ana Peña" para
 * la misma persona.
 *
 * Sin responsable asignado no lo puede tocar nadie: dejar que cualquiera lo
 * marque sería peor que no poder marcarlo, porque el registro diría que alguien
 * responsable lo aprobó.
 */
export function canToggleMilestone(sessionEmail: string | null, accountableEmail: string | null): boolean {
  if (!sessionEmail || !accountableEmail) return false;
  return sessionEmail.trim().toLowerCase() === accountableEmail.trim().toLowerCase();
}

/** Un milestone ya hecho no se reabre ni se borra: marcarlo fue un hecho. */
export function canEditMilestone(status: MilestoneStatus): boolean {
  return status !== 'done';
}

/**
 * Un funnel con enrolamientos no se borra: se desactiva.
 *
 * La base ya lo impide (la FK de `enrollment` es RESTRICT), pero la interfaz
 * tiene que saberlo antes de ofrecer el botón -- que el usuario descubra la
 * regla por un error de Postgres es una forma pobre de explicarla.
 */
export function canDeleteFunnel(enrollmentCount: number): boolean {
  return enrollmentCount === 0;
}

/** Progreso de un plan, para el anillo y el stepper. */
export function progressOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}
