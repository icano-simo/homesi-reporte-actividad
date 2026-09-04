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

/**
 * Las cuatro areas de la division — etapa BP40.
 *
 * ⚠ ES UNA LISTA CERRADA, y el `check` de la base la repite. No es duplicacion
 * inutil: el desplegable necesita saber que ofrecer y la base necesita rechazar
 * lo que llegue por otra via. Si algun dia hay una quinta, van las dos.
 */
/**
 * ============================================================================
 * LAS AREAS, Y DONDE VIVE LA RED QUE ESTO DA -- leer antes de tocar
 * ============================================================================
 *
 * Estos cuatro nombres son HOY la unica definicion literal de las areas en todo
 * el codigo: cero comparaciones tipo `=== 'Marketing'` en la app, y las demas
 * apariciones iteran esta constante o usan el tipo que sale de ella.
 *
 * ⚠ Y ESO ES UNA RED QUE SE VA A PERDER, a proposito.
 *
 * `NodeArea` es un tipo UNION derivado de la constante, asi que hoy un area mal
 * escrita --`'Marketng'`-- es un error de COMPILACION. Cuando las areas pasen a
 * ser editables (BP44, fase B), esto se reemplaza por una clave numerica contra
 * `business_plan.area`, y el compilador deja de poder saber que areas existen:
 *
 *   · ANTES: `'Marketng'` no compila.
 *   · DESPUES: `area_key = 99` compila, y falla al guardar con un 400 de la FK
 *     `node_area_fk`.
 *
 * La red no desaparece, se MUEVE: de `tsc` a la base. Es el precio de que sean
 * editables y no hay forma de tener las dos -- un tipo union no puede conocer
 * filas que alguien va a crear manana.
 *
 * Quien venga buscando "donde se validan las areas": ya no es aca. Es la FK.
 *
 * ESTADO DE LA MIGRACION: la fase A esta aplicada. `business_plan.area` existe
 * con las cuatro filas, `node.area_key` esta poblada (25 de 32) y un trigger
 * bidireccional mantiene `node.area` en sincronia en las dos direcciones. Esta
 * constante sigue siendo la que dibuja la pantalla hasta que el codigo lea la
 * tabla; ver `docs/sql/2026-09-editable-areas.sql`.
 */
export const NODE_AREAS = ['Marketing', 'Sales Coaching', 'Performance', 'IT'] as const;
export type NodeArea = (typeof NODE_AREAS)[number];

export interface FunnelNode {
  node_key: number;
  name: string;
  description: string | null;
  icon: string | null;
  is_example: boolean;
  /**
   * ⚠ EL AREA, QUE ANTES ERA UN PREFIJO DE `description` — etapa BP40.
   *
   * Vivia como primeras palabras hasta el primer punto --`Marketing.`, `Sales
   * Coaching.`-- y ya se habia roto: de 31 nodos, 4 no lo tenian y 2 guardaron
   * un parrafo entero donde iba.
   *
   * `null` = nadie la asigno, NO "sin area". Un valor de relleno se vuelve
   * indistinguible de una decision el dia que alguien lo elija a proposito. Hoy
   * son 6 en null, y la biblioteca los agrupa aparte para que se vean.
   */
  area: NodeArea | null;
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

/**
 * Los TRES estados guardados de un step -- etapa BP42.
 *
 * `blocked` NO esta aca: se DERIVA de que la dependencia del nodo no este
 * completa. Un step en progreso cuyo antecesor no termino tiene dos estados a
 * la vez y una sola columna no los guarda -- al desbloquearlo habria que
 * adivinar cual era. Ver `isBlocked` mas abajo.
 *
 * `in_progress` conserva el guion bajo aunque se MUESTRE "In progress": nadie
 * ve el valor guardado, y un valor con espacio hace que la proxima comparacion
 * mal escrita sea un bug silencioso.
 */
export type MilestoneStatus = 'planned' | 'in_progress' | 'completed';

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
  /** Copia del SLA: sin él no se pueden recalcular las fechas al reordenar. */
  sla_days: number | null;
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
 * ============================================================================
 * EL DIA ACUMULADO DE CADA STEP -- etapa BP40
 * ============================================================================
 *
 * `sla_days` paso a ser los dias DESDE EL STEP ANTERIOR, no el dia absoluto
 * dentro del nodo. El dia en que cae un step es la suma corrida.
 *
 * POR QUE SE CAMBIO, y que costo: leido como absoluto, un numero menor que el
 * anterior no molestaba --cada step decia su dia por su cuenta-- asi que se
 * podia tener un plan donde el paso 4 caia ANTES que el paso 3. Los datos tenian
 * dos casos asi, invisibles hasta que se miro el acumulado. Con esta lectura eso
 * no es representable: un delta negativo no existe.
 *
 * Y LA CONSECUENCIA QUE HAY QUE MOSTRAR: correr un step corre a TODOS los que
 * siguen en su nodo. La primera vez que alguien lo vea sin aviso va a parecer un
 * bug, asi que el editor dibuja los dias resultantes mientras se escribe.
 *
 * Un step sin `sla_days` no aporta al acumulado y hereda el dia del anterior:
 * son los de plantillas viejas, y darle un dia inventado seria peor.
 */
export function cumulativeDays(slaDays: (number | null)[]): number[] {
  let acc = 0;
  return slaDays.map((d) => {
    acc += d ?? 0;
    return acc;
  });
}

/**
 * El rango "DAY 1-5" de cada nodo se CALCULA; no se escribe a mano.
 *
 * Un nodo dura la SUMA de los `sla_days` de sus steps. Los nodos van uno
 * después del otro, así que cada uno arranca donde terminó el anterior.
 *
 * ⚠ ANTES ERA `Math.max`, Y ESTABA MAL DESDE BP40.
 *
 * Hasta BP40 `sla_days` era el día ABSOLUTO dentro del nodo, así que el mayor
 * era efectivamente la duración. BP40 lo convirtió en el DELTA contra el step
 * anterior --con su migración de 12 `update`-- y esta función no se actualizó.
 *
 * El desfase medido en `Marketing Campaigns`, cuyos deltas son 5,1,3,5,30,0:
 * `max` daba 30 y la suma da 44. La tarjeta de la biblioteca ya decía 44
 * --sale de `cumulativeDays`-- así que dos pantallas mostraban dos duraciones
 * distintas para el mismo nodo.
 *
 * Se usa `cumulativeDays` en vez de sumar acá: dos sumas del mismo número son
 * dos números que pueden diferir, que es justo el error que esto vino a cerrar.
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
    const mine = milestones
      .filter((m) => m.node_key === node_key)
      .sort((a, b) => a.position - b.position);
    const acumulados = cumulativeDays(mine.map((m) => m.sla_days));
    const total = acumulados.length ? acumulados[acumulados.length - 1] : 0;
    const span = Math.max(1, total);
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
 * SLA ACUMULADOS del nodo, y el nodo arranca donde terminó el anterior.
 *
 * ⚠ ACUMULADOS, Y NO EL VALOR CRUDO. Esto estaba mal desde BP40 y se corrigió
 * midiendo los planes reales: 6 de 75 steps tenían una fecha límite ANTERIOR a
 * la del step que los precede en su propio nodo.
 *
 * El caso más claro, del plan 66: `Report results` con `sla_days = 0` quedaba
 * con fecha del día de activación, mientras el step anterior --`sla_days = 30`--
 * vencía un mes después. Leído como delta, `0` significa "el mismo día que el
 * anterior"; leído como absoluto, significa "el día de arranque".
 *
 * Las fechas YA GUARDADAS de los planes activados antes de esta corrección no
 * se recalculan solas: son datos, y recalcularlas cambia lo que la gente ve.
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
    /* El día de cada step DENTRO de su nodo, acumulando los deltas. Misma
       función que la tabla, el editor y `nodeDayRanges`. */
    const diaEnElNodo = cumulativeDays(mine.map((m) => m.sla_days));

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
           *
           * Y el día dentro del nodo es el ACUMULADO, no `m.sla_days`: ver la
           * nota del encabezado.
           */
          due_date: addDays(activationDate, range.fromDay - 1 + diaEnElNodo[j]),
          position: j + 1,
          sla_days: m.sla_days,
        })),
      },
    ];
  });
}

/* ───────────────────────────── Permisos ────────────────────────────────── */

/**
 * ============================================================================
 * QUIÉN PUEDE COMPLETAR UN STEP — reescrito en BP42
 * ============================================================================
 *
 * CUALQUIERA con acceso al módulo. Antes era sólo el responsable nominal, y eso
 * dejaba el módulo sin poder registrar avance: medido contra los cuatro planes
 * activos, los 75 steps están repartidos entre nueve personas, así que **69 de
 * 75 no ofrecían "completar" a quien estuviera mirando**. Cero steps completados
 * en toda la historia del módulo.
 *
 * Un plan de negocio es una herramienta de acompañamiento: el coach y el Loan
 * Officer lo revisan juntos y marcan lo que se hizo. Que sólo el responsable
 * pudiera cerrar un step lo convertía en un trámite.
 *
 * ⚠ NO SE PIERDE LA TRAZABILIDAD: `completed_by` guarda el email de quien lo
 * marcó, que es un dato distinto del responsable y ahora sí sirve para algo --
 * antes los dos eran siempre la misma persona por construcción.
 *
 * Se conserva la firma con `accountableEmail` a propósito, aunque ya no se use
 * para decidir: es lo que hace que el cambio se lea como una decisión y no como
 * un parámetro que alguien olvidó pasar. La vista sigue mostrando quién es el
 * responsable; lo que cambió es que no es un permiso.
 */
/* eslint-disable-next-line @typescript-eslint/no-unused-vars -- el parametro se
   conserva a proposito: es lo que hace que el cambio de BP42 se lea como una
   decision y no como un argumento que alguien olvido pasar. */
export function canToggleMilestone(sessionEmail: string | null, _accountableEmail: string | null): boolean {
  return Boolean(sessionEmail);
}

/**
 * ============================================================================
 * ¿QUÉ ESTADOS PUEDE ELEGIR ESTA PERSONA EN ESTE PASO? — etapa BP20
 * ============================================================================
 *
 * El estado dejó de ser un botón de "marcar hecho" y pasó a ser un desplegable
 * de tres. Eso multiplica los casos, así que la regla vive acá, en una función
 * pura que se puede leer entera, y no repartida por los `disabled` de la vista.
 *
 * Las dos reglas, y la primera cambió en BP42:
 *
 *   · COMPLETAR ya no es exclusivo del responsable -- ver
 *     `canToggleMilestone`. La base nunca lo restringió, así que esto era una
 *     regla de la vista y nada más.
 *   · Un paso ya hecho NO SE REABRE. Esto sí lo respalda la base: el `using
 *     (status <> 'completed')` de la policy de UPDATE hace invisible la fila, así
 *     que aunque alguien forzara la llamada, no actualizaría nada.
 *
 * Lo nuevo es el estado intermedio. `in_progress` es planificación, no un
 * hecho: cualquiera del equipo puede mover un paso a "en curso" o devolverlo a
 * "pendiente", igual que puede reprogramar la fecha. Restringirlo al
 * responsable no protegería nada y obligaría a pedirle a otro que mueva una
 * etiqueta.
 */
export function allowedStatuses(
  current: MilestoneStatus,
  sessionEmail: string | null,
  accountableEmail: string | null
): MilestoneStatus[] {
  /* Un completado no se reabre, y esto SÍ lo respalda la base: el
     `using (status <> 'completed')` de la policy de UPDATE hace invisible la
     fila. Devolver un solo estado es lo que deja el desplegable sin opciones
     que la base rechazaría en silencio. */
  if (current === 'completed') return ['completed'];
  const base: MilestoneStatus[] = ['planned', 'in_progress'];
  if (canToggleMilestone(sessionEmail, accountableEmail)) base.push('completed');
  return base;
}

/** Etiquetas de estado, en un solo lugar. */
export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** Clase de la píldora de estado. Mismo lenguaje de color que el veredicto. */
export const MILESTONE_STATUS_CLASS: Record<MilestoneStatus, string> = {
  planned: 'badge badge--pill badge--neutral',
  in_progress: 'badge badge--pill badge--amber',
  completed: 'badge badge--pill badge--emerald',
};

/**
 * ============================================================================
 * `blocked` SE DERIVA, NO SE GUARDA -- etapa BP42
 * ============================================================================
 *
 * Un step esta trabado cuando su nodo espera a otro que todavia no esta
 * completo. Sale de `depends_on_enrollment_node_key`, que existe desde BP41.
 *
 * NO ES UN CUARTO VALOR DE `status`, y la razon que decide no es la
 * sincronizacion sino esta: un step que esta EN PROGRESO y cuyo antecesor no
 * termino tiene dos estados a la vez, y una sola columna no los guarda. Al
 * desbloquearlo habria que adivinar cual era.
 *
 * Guardado tambien podria quedar rancio -- completar el ultimo step del
 * antecesor tendria que dar vuelta cada dependiente, y cualquier camino que se
 * olvide deja un `blocked` que se lee como autoridad.
 *
 * `blocked` NO impide completar: describe, no prohibe. Si alguien hizo el
 * trabajo fuera de orden, el registro tiene que poder decirlo.
 */
export function isBlocked(
  node: { depends_on_enrollment_node_key: number | null },
  nodesById: Map<number, { milestones: { status: MilestoneStatus }[] }>
): boolean {
  const dep = node.depends_on_enrollment_node_key;
  if (dep === null) return false;
  const antecesor = nodesById.get(dep);
  /*
   * Un antecesor que no esta en el mapa NO se trata como completo: la
   * dependencia se declaro contra algo que no se puede leer, y decir "listo"
   * seria inventar. Se informa como trabado, que es lo que hace que se mire.
   */
  if (antecesor === undefined) return true;
  /* Un nodo SIN steps no traba a nadie: no hay nada que completar en el. */
  if (antecesor.milestones.length === 0) return false;
  return antecesor.milestones.some((m) => m.status !== 'completed');
}

/**
 * ¿Está vencido? Pendiente o en curso, con fecha límite anterior a hoy.
 *
 * Un paso HECHO nunca está vencido, aunque se haya cerrado tarde: la fecha
 * límite existe para saber qué falta, no para reprochar lo que ya se hizo.
 * `today` se pasa como argumento -- leer el reloj adentro haría la función
 * imposible de probar y volvería impuro cualquier render que la llame.
 */
export function isOverdue(status: MilestoneStatus, dueDate: string | null, today: string): boolean {
  if (status === 'completed' || dueDate === null) return false;
  return dueDate < today;
}

/**
 * ============================================================================
 * ¿SE PUEDE ACTIVAR ESTE FUNNEL?
 * ============================================================================
 *
 * Etapa BP13. Antes no se preguntaba, y el resultado fue un enrolamiento con 5
 * nodos copiados y CERO milestones, guardado como activo y sin una sola
 * advertencia. La persona quedaba con un plan que no le pedía hacer nada y un
 * anillo de progreso en 0 de 0.
 *
 * La causa inmediata fue activar antes de sembrar los milestones, pero el
 * escenario se repite solo: alguien crea un funnel en la biblioteca, lo deja a
 * medio armar y otro lo activa. Un funnel sin pasos no es un plan.
 *
 * Se valida ANTES de escribir nada. Detectarlo después dejaría un enrolamiento
 * huérfano que hay que ir a borrar a mano -- que es exactamente lo que pasó.
 */
export interface ActivationCheck {
  ok: boolean;
  /** Por qué no, para mostrarlo en el botón y en la tarjeta. */
  reason: string | null;
  nodeCount: number;
  milestoneCount: number;
}

export function checkActivation(
  funnelKey: number,
  links: FunnelNodeLink[],
  milestones: NodeMilestone[]
): ActivationCheck {
  const nodeKeys = links.filter((l) => l.funnel_key === funnelKey).map((l) => l.node_key);
  const nodeSet = new Set(nodeKeys);
  const milestoneCount = milestones.filter((m) => nodeSet.has(m.node_key)).length;

  if (nodeKeys.length === 0) {
    return { ok: false, reason: 'This funnel has no nodes yet.', nodeCount: 0, milestoneCount: 0 };
  }
  if (milestoneCount === 0) {
    return {
      ok: false,
      reason: 'This funnel has nodes but no stages — there would be nothing to do.',
      nodeCount: nodeKeys.length,
      milestoneCount: 0,
    };
  }
  return { ok: true, reason: null, nodeCount: nodeKeys.length, milestoneCount };
}

/**
 * ¿Se puede borrar este nodo de la BIBLIOTECA?
 *
 * Borrarlo lo saca en cascada de todos los funnels que lo usan -- `funnel_node`
 * es ON DELETE CASCADE. Eso está bien para una plantilla, pero NO si alguno de
 * esos funnels tiene gente enrolada: el funnel quedaría con un paso menos para
 * quien lo elija después, sin que nadie lo haya decidido.
 *
 * Devuelve además en qué funnels está, para poder avisarlo antes de confirmar.
 */
export interface NodeDeleteCheck {
  ok: boolean;
  reason: string | null;
  usedIn: { funnel_key: number; name: string; enrollments: number }[];
}

export function checkNodeDelete(
  nodeKey: number,
  links: FunnelNodeLink[],
  funnels: Funnel[],
  enrollmentsByFunnel: Record<number, number>
): NodeDeleteCheck {
  const usedIn = links
    .filter((l) => l.node_key === nodeKey)
    .map((l) => {
      const f = funnels.find((x) => x.funnel_key === l.funnel_key);
      return {
        funnel_key: l.funnel_key,
        name: f?.name ?? 'unknown funnel',
        enrollments: enrollmentsByFunnel[l.funnel_key] ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const blocked = usedIn.filter((u) => u.enrollments > 0);
  if (blocked.length > 0) {
    return {
      ok: false,
      reason:
        'It is used by ' +
        blocked.map((b) => `${b.name} (${b.enrollments} active plan${b.enrollments === 1 ? '' : 's'})`).join(', ') +
        '. Remove it from those funnels first.',
      usedIn,
    };
  }
  return { ok: true, reason: null, usedIn };
}

/* ══════════════════════════════════════════════════════════════════════════
 * EDICIÓN DEL PLAN DE UNA PERSONA (etapa BP14)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El plan es una COPIA, así que agregar, quitar o reordenar acá no toca la
 * plantilla ni el plan de nadie más. Es lo que reemplaza la idea de crear una
 * plantilla por cada variación.
 */

/** Lo mínimo que el cálculo necesita saber de un milestone del plan. */
export interface PlanMilestoneLike {
  enrollment_milestone_key: number;
  status: MilestoneStatus;
  sla_days: number | null;
  due_date: string | null;
}

export interface PlanNodeLike {
  enrollment_node_key: number;
  position: number;
  milestones: PlanMilestoneLike[];
}

/**
 * ¿Se puede quitar este nodo del plan?
 *
 * NO si tiene algún milestone en `done`. La base ya lo impide -- la política de
 * borrado de `enrollment_node` comprueba que no haya ninguno completado,
 * justamente porque el borrado en cascada NO evalúa la RLS del hijo y si no
 * arrastraría milestones históricos.
 *
 * Pero la base devuelve 0 filas, en silencio. Sin esta comprobación el botón
 * parecería no funcionar. Mismo patrón que `checkActivation`: se valida antes
 * de mostrar y se revalida al ejecutar.
 */
export interface RemoveNodeCheck {
  ok: boolean;
  reason: string | null;
  doneCount: number;
}

export function canRemovePlanNode(node: PlanNodeLike): RemoveNodeCheck {
  const doneCount = node.milestones.filter((m) => m.status === 'completed').length;
  if (doneCount > 0) {
    return {
      ok: false,
      reason: `${doneCount} milestone${doneCount === 1 ? '' : 's'} in this node ${
        doneCount === 1 ? 'is' : 'are'
      } already done. Completed work is history and cannot be removed.`,
      doneCount,
    };
  }
  return { ok: true, reason: null, doneCount: 0 };
}

/** Una fecha nueva para un milestone del plan. */
export interface DueDateUpdate {
  enrollment_milestone_key: number;
  due_date: string;
}

/**
 * Recalcula las fechas límite después de reordenar los nodos del plan.
 *
 * Misma fórmula que la activación -- fecha de activación + los SLA acumulados
 * -- pero sobre el orden NUEVO. Un nodo que pasa del cuarto al primer lugar
 * arranca el día 1 y sus milestones vencen antes.
 *
 * ⚠ LOS QUE YA ESTÁN EN `done` NO SE TOCAN. Su fecha es historia: decir que un
 * paso completado el 3 de septiembre "vence" el 20 de agosto porque alguien
 * reordenó después sería reescribir el pasado. Y además la base los rechazaría,
 * porque una fila en `done` es invisible para UPDATE.
 *
 * Un milestone sin `sla_days` conserva su fecha en vez de recibir una
 * inventada: son los de planes activados antes de que la columna existiera.
 * Devuelve sólo los que CAMBIAN, para no mandar updates que no hacen nada.
 */
export function recalcDueDates(orderedNodes: PlanNodeLike[], activationDate: string): DueDateUpdate[] {
  const out: DueDateUpdate[] = [];
  let cursor = 1; // día de inicio del nodo, 1-based

  for (const node of orderedNodes) {
    const span = Math.max(1, ...node.milestones.map((m) => m.sla_days ?? 0));
    for (const m of node.milestones) {
      if (m.status === 'completed') continue;
      if (m.sla_days === null) continue;
      const next = addDays(activationDate, cursor - 1 + m.sla_days);
      if (next !== m.due_date) out.push({ enrollment_milestone_key: m.enrollment_milestone_key, due_date: next });
    }
    cursor += span;
  }
  return out;
}

/** Un milestone ya hecho no se reabre ni se borra: marcarlo fue un hecho. */
export function canEditMilestone(status: MilestoneStatus): boolean {
  return status !== 'completed';
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


/**
 * ============================================================================
 * ¿YA EXISTE UN NODO CON ESE NOMBRE? — etapa BP25
 * ============================================================================
 *
 * ⚠ NACIÓ DE UN DUPLICADO REAL. Convivieron "Cold Calling" y "Cold calling":
 * dos nodos distintos para lo mismo, y el segundo se coló en tres funnels antes
 * de que alguien lo notara. Hubo que borrarlo a mano y rehacer las secuencias.
 *
 * La columna `name` ES única, y aun así pasó: en Postgres `text` distingue
 * mayúsculas, así que para la base son dos nombres diferentes. Una mayúscula de
 * más basta, y un espacio doble también.
 *
 * Esto no reemplaza a la restricción de la base, la complementa: la base impide
 * el duplicado exacto y esto impide el que se le parece. Lo correcto de verdad
 * sería un índice único sobre `lower(btrim(name))`, y queda anotado como TODO
 * en la doc -- pero eso es una migración más, y mientras tanto la app puede
 * dejar de crearlos.
 *
 * Devuelve el nombre YA GUARDADO, no un booleano: decir "ya existe" sin decir
 * cuál obliga a ir a buscarlo, y el que existe casi nunca se escribe igual que
 * el que se está intentando crear -- si se escribiera igual, no habría problema.
 */
export function findNodeNameClash(
  name: string,
  nodes: { node_key: number; name: string }[],
  /** Al renombrar, el propio nodo no cuenta como choque consigo mismo. */
  exceptNodeKey?: number | null
): string | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const target = norm(name);
  if (target === '') return null;
  const hit = nodes.find((n) => n.node_key !== exceptNodeKey && norm(n.name) === target);
  return hit ? hit.name : null;
}
