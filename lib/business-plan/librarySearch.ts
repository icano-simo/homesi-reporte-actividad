import { cumulativeDays, nodeDayRanges, type Funnel, type FunnelNode, type FunnelNodeLink, type NodeMilestone, type NodeOwner } from './funnels';
import type { SupportPerson } from './useFunnelLibrary';

/**
 * ============================================================================
 * BÚSQUEDA GLOBAL Y ESTADÍSTICAS DE LA BIBLIOTECA — etapa BP41
 * ============================================================================
 *
 * ARCHIVO NUEVO, y va fuera de las pantallas a propósito: las dos —biblioteca
 * de nodos y funnels— llevan la misma barra de búsqueda, y dos copias del mismo
 * filtro son dos filtros que pueden empezar a diferir. Es el mismo motivo por
 * el que `strategyRows.ts` existe en Outlook.
 *
 * Y estando acá se puede probar sin navegador: son funciones puras sobre los
 * datos que ya trae `useFunnelLibrary`.
 */

/** Qué es cada resultado. Se muestra como etiqueta, así que es parte del dato. */
export type SearchKind = 'Funnel' | 'Node' | 'Step' | 'Owner';

export interface SearchHit {
  kind: SearchKind;
  /** Lo que se buscó y se encontró. */
  title: string;
  /**
   * Dónde vive. Un step vive en su nodo; un nodo, en los funnels que lo usan;
   * un funnel, en ninguna parte -- y entonces va vacío en vez de inventado.
   */
  where: string;
  /** A dónde lleva el resultado. */
  href: string;
  /**
   * POR QUÉ matcheó — etapa BP41. La etiqueta lo dice:
   * `Node · matched in description`.
   *
   * ⚠ Es parte del dato y no un detalle de presentación. Buscando `whatsapp`
   * sale el nodo `AI WhatsApp`, pero la palabra no está en su nombre sino en su
   * descripción --medido: ninguno de sus cuatro steps la dice tampoco--. Sin el
   * motivo, el resultado obliga a preguntarse por qué salió, y esa pregunta es
   * la que hace desconfiar de la lista entera.
   */
  matchedIn: 'name' | 'description';
  /**
   * Para desempatar sin que el orden dependa del recorrido: primero por
   * relevancia (empieza con lo buscado gana), después alfabético.
   */
  starts: boolean;
}

/**
 * Normaliza para comparar: minúsculas y sin acentos.
 *
 * ⚠ SIN ACENTOS A PROPÓSITO. Los nodos tienen nombres en dos idiomas y las
 * descripciones vienen con acentos escritos a mano (`Sesión 2 – CRM`), así que
 * buscar `sesion` tiene que encontrar `Sesión`. Sin esto, media biblioteca es
 * inalcanzable para quien escribe sin acentos, que es como se escribe al buscar.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    /* El rango va con escapes y no con los caracteres literales: son marcas
       combinantes, invisibles en el editor, y una que se pierda al copiar el
       archivo dejaria el filtro funcionando a medias sin que se note. */
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * El nombre de una persona, y QUE SE VEA si no se pudo resolver.
 *
 * ⚠ NO DEVUELVE `null` NI SE FILTRA. Los nombres salen de `support`
 * (`is_support` + `is_active`), y medido contra la base los 10 owners de nodo y
 * los 10 accountables de step estan ahi hoy. Pero si alguien deja de ser
 * soporte, filtrarlo haria DESAPARECER al owner de la tarjeta: el nodo se
 * veria sin responsable, que es exactamente lo que un nodo sin owner muestra,
 * y son dos cosas distintas.
 *
 * Es el mismo error que en BP40 mostraba `employee 25` -- pero ahi el fallback
 * tapaba una consulta que faltaba SIEMPRE. Aca la consulta esta bien y el
 * fallback solo se ejerce con datos rotos de verdad, que conviene ver.
 */
function ownerName(key: number, nameOf: Map<number, string>): string {
  return nameOf.get(key) ?? `employee ${key}`;
}

export interface SearchInput {
  funnels: Funnel[];
  nodes: FunnelNode[];
  links: FunnelNodeLink[];
  milestones: NodeMilestone[];
  owners: NodeOwner[];
  support: SupportPerson[];
}

/**
 * Los resultados de una búsqueda, mezclados y etiquetados.
 *
 * ⚠ MEZCLADOS Y NO EN SECCIONES SEPARADAS. Buscar `whatsapp` devuelve el nodo
 * `AI WhatsApp` y los steps que lo mencionan, y lo que interesa es verlos
 * juntos: separados por tipo, el nodo y sus steps quedan en dos listas y hay
 * que mirar dos veces para entender que hablan de lo mismo.
 *
 * Devuelve `[]` con menos de dos caracteres: con uno solo, casi todo matchea y
 * la lista deja de informar.
 */
export function searchLibrary(q: string, data: SearchInput): SearchHit[] {
  const needle = normalize(q.trim());
  if (needle.length < 2) return [];

  const hits: SearchHit[] = [];
  const nodeByKey = new Map(data.nodes.map((n) => [n.node_key, n]));
  const nameOf = new Map(data.support.map((p) => [p.employee_key, p.full_name]));

  /* Los funnels de cada nodo, para poder decir dónde vive. */
  const funnelsOfNode = new Map<number, string[]>();
  for (const l of data.links) {
    const f = data.funnels.find((x) => x.funnel_key === l.funnel_key);
    if (!f) continue;
    const lista = funnelsOfNode.get(l.node_key) ?? [];
    lista.push(f.name);
    funnelsOfNode.set(l.node_key, lista);
  }

  /*
   * Un resultado por objeto, y el nombre gana. Si el nodo matchea por nombre Y
   * por descripcion, `matchedIn` dice `name`: es la razon mas fuerte, y dos
   * filas del mismo nodo con motivos distintos serian el mismo objeto dos
   * veces.
   */
  const push = (
    kind: SearchKind,
    title: string,
    where: string,
    href: string,
    description?: string | null
  ) => {
    const n = normalize(title);
    if (n.includes(needle)) {
      hits.push({ kind, title, where, href, starts: n.startsWith(needle), matchedIn: 'name' });
      return;
    }
    /*
     * La descripcion, SOLO la del nodo -- decision de Isabella. Los steps no
     * tienen descripcion que buscar todavia, y ampliarlo sin un caso que lo
     * pida agrega resultados que nadie sabe de donde salieron.
     */
    if (description && normalize(description).includes(needle)) {
      hits.push({ kind, title, where, href, starts: false, matchedIn: 'description' });
    }
  };

  for (const f of data.funnels) {
    push('Funnel', f.name, '', '/business-plan/funnels/' + f.funnel_key);
  }

  for (const n of data.nodes) {
    const fs = funnelsOfNode.get(n.node_key) ?? [];
    /*
     * "in no funnel" y no una cadena vacía: un nodo sin funnel es un estado
     * válido --queda disponible en la biblioteca-- y hay que poder verlo. Hoy
     * no hay ninguno, medido, así que este texto es el que va a delatar el
     * primero que aparezca.
     */
    push(
      'Node',
      n.name,
      fs.length ? 'in ' + fs.join(', ') : 'in no funnel',
      '/business-plan/library#node-' + n.node_key,
      n.description
    );
  }

  for (const m of data.milestones) {
    const nodo = nodeByKey.get(m.node_key);
    if (!nodo) continue;
    push('Step', m.title, 'in ' + nodo.name, '/business-plan/library#node-' + m.node_key);
  }

  /*
   * Los owners: se busca la PERSONA y se devuelven los nodos que tiene a cargo.
   * Un resultado por persona-nodo y no uno por persona, porque lo que se quiere
   * al buscar un nombre es saber qué le toca, no confirmar que existe.
   */
  for (const o of data.owners) {
    const nodo = nodeByKey.get(o.node_key);
    /* Solo se saltea si falta el NODO, que si es un dato roto: un owner sin
       nombre resoluble se busca igual por su etiqueta de respaldo. */
    if (!nodo) continue;
    push('Owner', ownerName(o.employee_key, nameOf), 'owns ' + nodo.name, '/business-plan/library#node-' + o.node_key);
  }

  /*
   * Orden estable: relevancia, después tipo, después alfabético. El tipo entra
   * en el medio para que el nodo `AI WhatsApp` salga antes que sus steps, que
   * es el orden en que se lee "el nodo, y lo que tiene adentro".
   */
  const rank: Record<SearchKind, number> = { Funnel: 0, Node: 1, Step: 2, Owner: 3 };
  return hits.sort(
    (a, b) =>
      Number(b.starts) - Number(a.starts) ||
      /* Los que matchearon por nombre van antes que los de descripcion: es una
         coincidencia mas directa, y quien busca un titulo lo espera arriba. */
      Number(a.matchedIn === 'description') - Number(b.matchedIn === 'description') ||
      rank[a.kind] - rank[b.kind] ||
      a.title.localeCompare(b.title) ||
      a.where.localeCompare(b.where)
  );
}

/**
 * Lo que la tarjeta de un nodo necesita saber de sí mismo.
 *
 * `days` es la duración total del nodo: la suma de los SLA de sus steps, que
 * desde BP40 son días desde el step anterior. Sale de `cumulativeDays` --la
 * misma función que la tabla y el editor-- porque tres sumas del mismo número
 * son tres números que pueden diferir.
 */
export interface NodeStats {
  steps: number;
  days: number;
  /** En cuántos funnels se usa, y cuáles. Hoy hay uno en cinco. */
  funnelKeys: number[];
  funnelNames: string[];
  /** Todos los owners. Medido: 20 de 31 nodos tienen tres. */
  owners: string[];
}

export function nodeStats(nodeKey: number, data: SearchInput): NodeStats {
  const steps = data.milestones
    .filter((m) => m.node_key === nodeKey)
    .sort((a, b) => a.position - b.position);
  const dias = cumulativeDays(steps.map((m) => m.sla_days));

  const enFunnels = data.links.filter((l) => l.node_key === nodeKey);
  const nombresDeFunnel = enFunnels
    .map((l) => data.funnels.find((f) => f.funnel_key === l.funnel_key)?.name)
    .filter((x): x is string => typeof x === 'string')
    .sort((a, b) => a.localeCompare(b));

  const nameOf = new Map(data.support.map((p) => [p.employee_key, p.full_name]));
  const owners = data.owners
    .filter((o) => o.node_key === nodeKey)
    .map((o) => ownerName(o.employee_key, nameOf))
    .sort((a, b) => a.localeCompare(b));

  return {
    steps: steps.length,
    /* `0` cuando el nodo no tiene steps: no hay último día que leer. */
    days: dias.length ? dias[dias.length - 1] : 0,
    funnelKeys: enFunnels.map((l) => l.funnel_key),
    funnelNames: nombresDeFunnel,
    owners,
  };
}

/**
 * LAS INICIALES DE UN OWNER — etapa BP41, y por qué iniciales.
 *
 * La maqueta pedía "un solo owner con nombre completo" en la tarjeta. Medido
 * contra la base, eso no se puede hacer con honestidad: de los 31 nodos, 20
 * tienen TRES owners, 2 tienen cuatro, 2 tienen dos y solo 7 tienen uno.
 * Ninguno tiene cero.
 *
 * Mostrar "el primero" habría sido un dato inventado con forma de dato:
 * `node_owner` no tiene orden declarado --su PK es `(node_key, employee_key)`--
 * así que "el primero" es el que devolvió la consulta esta vez.
 *
 * Las iniciales muestran a todos, entran en una fila, y el nombre completo va
 * en el `title` del elemento. No se pierde información y no hace falta que
 * nadie decida 31 veces.
 *
 * Dos letras y no una: con una sola, `Isabella Cano` y `Ricardo Cera` son las
 * dos `I`/`R` de nadie en particular. Y si el nombre trae una sola palabra
 * --pasa con el respaldo `employee 77`-- se toman sus dos primeras letras en
 * vez de inventar un apellido.
 */
export function initialsOf(fullName: string): string {
  const partes = fullName.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Los totales del encabezado de un funnel: `4 nodes · 12 steps · ends day 42`.
 *
 * ⚠ `endsDay` ES LA SUMA DE TODOS LOS SLA DEL FUNNEL, en el orden de sus nodos.
 * Medido contra la base, va de 8 (`Javier Growth Engine`) a 207 (`Network
 * Leverage`), así que el número no es decorativo: armar un funnel es decidir
 * cuánto dura, y dos de los nueve pasan de siete meses.
 *
 * No incluye paralelismo todavía. Cuando las dependencias existan, dos nodos
 * que esperan al mismo antecesor no suman sus días -- corren a la vez. Queda
 * anotado porque el número va a tener que cambiar, y es mejor que se sepa por
 * qué que descubrirlo cuando baje solo.
 */
export interface FunnelTotals {
  nodes: number;
  steps: number;
  endsDay: number;
}

export function funnelTotals(funnelKey: number, data: SearchInput): FunnelTotals {
  const enOrden = data.links
    .filter((l) => l.funnel_key === funnelKey)
    .sort((a, b) => a.position - b.position);

  const steps = enOrden.reduce(
    (acc, l) => acc + data.milestones.filter((m) => m.node_key === l.node_key).length,
    0
  );

  /*
   * ⚠ `endsDay` SE DERIVA DE `nodeDayRanges`, no se suma aparte.
   *
   * Sumaba los `sla_days` del funnel, y eso difiere del ultimo dia que muestran
   * las tarjetas en un caso concreto: un nodo SIN steps ocupa 1 dia igual --dos
   * nodos no pueden arrancar el mismo dia-- y la suma no lo contaba.
   *
   * Medido cuando aparecio el primer nodo sin steps de la biblioteca: el
   * encabezado de `Recruitment - DYS` decia "ends day 88" y su ultima tarjeta
   * decia "day 89-89". Dos numeros para lo mismo, en la misma pantalla.
   *
   * Ahora hay una sola cuenta. Mismo criterio que hizo derivar
   * `enrollmentsByFunnel` de `enrolledByFunnel` en BP40.
   */
  const rangos = nodeDayRanges(
    enOrden.map((l) => l.node_key),
    data.milestones
  );
  const endsDay = rangos.length ? rangos[rangos.length - 1].toDay : 0;

  return { nodes: enOrden.length, steps, endsDay };
}
