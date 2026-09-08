import { getSupabaseClient } from '@/lib/supabase/client';
import { findNodeNameClash, type FunnelNode, type FunnelNodeLink } from './funnels';

/**
 * ============================================================================
 * GUARDAR UN NODO — etapa BP45, ARCHIVO NUEVO
 * ============================================================================
 *
 * Se extrajo del handler de la biblioteca porque ahora hay DOS pantallas que
 * crean nodos: la biblioteca y la página del funnel (`+ New node`).
 *
 * ⚠ Y NO SE COPIÓ, SE MOVIÓ. Es exactamente la duplicación que BP31 vino a
 * cerrar en `strategyRows`: dos copias del mismo guardado empiezan iguales y
 * divergen en el detalle que importa. Acá el detalle que importa es el chequeo
 * de nombre duplicado -- si la pantalla nueva no lo hiciera, el problema de
 * BP25 volvería por la puerta de al lado.
 *
 * Devuelve `{ error }` con la misma forma que PostgREST para que los `run` de
 * las dos pantallas lo muestren igual que cualquier otro error, sin una segunda
 * vía de mensajes que mantener.
 */
export interface SaveNodeDraft {
  name: string;
  description: string;
  icon: string;
  owners: number[];
  funnels: number[];
}

export async function saveNode(opts: {
  draft: SaveNodeDraft;
  /** Los nodos que ya existen, para el chequeo de nombre. */
  nodes: FunnelNode[];
  /** Los vínculos actuales, para calcular la posición del nuevo. */
  links: FunnelNodeLink[];
  /** `null` para crear. */
  nodeKey: number | null;
  /**
   * Funnels a los que el nodo tiene que pertenecer además de los del borrador.
   *
   * Existe para el `+ New node` de la página de un funnel: ahí el funnel actual
   * no es una opción a destildar, es el contexto. Sin esto, crear un nodo desde
   * un funnel y no tildar su casilla lo dejaría fuera del funnel donde se lo
   * acaba de crear -- que es lo contrario de lo que pidió quien apretó el botón.
   */
  ensureFunnels?: number[];
}): Promise<{ error: { message: string } | null }> {
  const { draft, nodes, links, nodeKey: existente, ensureFunnels = [] } = opts;
  const bp = getSupabaseClient().schema('business_plan');

  /*
   * ⚠ Etapa BP25, y se conserva palabra por palabra. Convivieron "Cold Calling"
   * y "Cold calling", y el segundo se coló en TRES funnels antes de que alguien
   * lo notara. La columna ES única, pero `text` distingue mayúsculas: para la
   * base eran dos nombres distintos.
   */
  const clash = findNodeNameClash(draft.name, nodes, existente);
  if (clash) {
    return {
      error: {
        message:
          'A node called "' + clash + '" already exists. Names must be different beyond upper/lower ' +
          'case and spacing — use that one, or pick another name.',
      },
    };
  }

  const row = {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    icon: draft.icon.trim() || null,
  };

  let nodeKey = existente;
  if (nodeKey) {
    const up = await bp.from('node').update(row).eq('node_key', nodeKey);
    if (up.error) return up;
  } else {
    const ins = await bp.from('node').insert(row).select('node_key').single();
    if (ins.error) return ins;
    nodeKey = (ins.data as { node_key: number }).node_key;
  }

  /* Responsables: se reescriben enteros, son pocos. */
  const delO = await bp.from('node_owner').delete().eq('node_key', nodeKey);
  if (delO.error) return delO;
  if (draft.owners.length) {
    const insO = await bp
      .from('node_owner')
      .insert(draft.owners.map((employee_key) => ({ node_key: nodeKey, employee_key })));
    if (insO.error) return insO;
  }

  /*
   * Pertenencia a funnels. Se calcula el DELTA y se escribe sólo eso: borrar
   * todos los vínculos y reponerlos perdería `position` y
   * `depends_on_node_key` de los que ya estaban -- el orden dentro del funnel y
   * las dependencias declaradas.
   *
   * Y el nuevo va al FINAL de cada funnel: agregarlo en medio cambiaría una
   * secuencia que alguien ya ordenó.
   */
  const deseados = [...new Set([...draft.funnels, ...ensureFunnels])];
  const actuales = links.filter((l) => l.node_key === nodeKey).map((l) => l.funnel_key);
  for (const k of actuales.filter((k) => !deseados.includes(k))) {
    const r = await bp.from('funnel_node').delete().eq('funnel_key', k).eq('node_key', nodeKey);
    if (r.error) return r;
  }
  for (const k of deseados.filter((k) => !actuales.includes(k))) {
    const last = Math.max(0, ...links.filter((l) => l.funnel_key === k).map((l) => l.position));
    const r = await bp.from('funnel_node').insert({ funnel_key: k, node_key: nodeKey, position: last + 1 });
    if (r.error) return r;
  }

  return { error: null };
}
