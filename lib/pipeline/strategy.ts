/**
 * ============================================================================
 * ESTRATEGIA COMERCIAL — clasificación de un préstamo
 * ============================================================================
 *
 * Etapa F6 — ARCHIVO NUEVO.
 *
 * La estrategia es una DIMENSIÓN DE CORTE, no una fórmula. Nada de acá entra en
 * ningún cálculo: pipeline, healthy, pull-through por canal, CTC/Closing,
 * forecast y adverse siguen exactamente igual. Lo único que hace este módulo es
 * decidir a qué grupo pertenece cada préstamo.
 *
 * Función pura y sin dependencias a propósito: la regla se puede probar contra
 * el archivo de referencia sin levantar la app ni tocar la base, que es como se
 * verificó la distribución de 883 filas.
 */

export type Strategy = 'NPPM' | 'Affinity' | 'Recruitment' | 'B2B' | 'Own production';

/**
 * Orden de PRESENTACIÓN, de mayor a menor volumen en el archivo de referencia.
 * No es el orden de evaluación -- ese es el de `classifyStrategy` y no se toca.
 */
export const STRATEGY_ORDER: Strategy[] = ['Own production', 'B2B', 'Affinity', 'Recruitment', 'NPPM'];

/** Las branches cuyo negocio ES el reclutamiento. Decisión del negocio, no derivable. */
export const RECRUITMENT_BRANCHES = new Set(['710', '711', '777']);

/** Lo mínimo que hace falta saber de un préstamo para clasificarlo. */
export interface StrategyInput {
  branch: string;
  strategyRaw: string;
  opportunityOwnerTitle: string;
}

/**
 * ============================================================================
 * ⚠ EL ORDEN DE EVALUACIÓN ES LA REGLA. NO ES UN DETALLE DE IMPLEMENTACIÓN.
 * ============================================================================
 *
 * Se para en la primera que coincide, y cada prioridad existe por un choque
 * REAL en los datos, no por prolijidad:
 *
 * 1. NPPM antes que B2B. Los 24 préstamos con `Strategy = NPPM` tienen TODOS
 *    `Opportunity Owner: Title = Business Developer`. Sin esta prioridad los 24
 *    caerían en B2B y NPPM quedaría en cero.
 *
 * 2. Recruitment antes que B2B. 20 préstamos de las branches de recruitment
 *    dicen `B2B Strategy` en la columna. Confirmado por el negocio: "los de
 *    recruitment son recruitment así diga Business Developer".
 *
 * ---------------------------------------------------------------------------
 * ⚠ `Strategy` SE USA SOLO PARA DETECTAR NPPM
 * ---------------------------------------------------------------------------
 * Los 171 préstamos que dicen `B2B Strategy` NO determinan B2B: B2B se define
 * por el TITLE del owner. Son poblaciones distintas y se verificó cuánto se
 * pisan -- `Strategy = 'B2B Strategy'` son 171, `title = 'Business Developer'`
 * son 205, y sólo 77 filas están en las dos. Usar la columna `Strategy` para
 * B2B daría un número distinto del que pidió el negocio.
 *
 * ---------------------------------------------------------------------------
 * ⚠ RIESGO CONOCIDO: COMPARACIÓN POR IGUALDAD EXACTA
 * ---------------------------------------------------------------------------
 * Sin `trim` ni normalización de mayúsculas, igual que hace hoy el canal. Si un
 * export futuro trae `business developer` en minúscula, o `NPPM ` con un espacio
 * al final, NO va a coincidir y el préstamo va a caer en `Own production` sin
 * ninguna advertencia.
 *
 * Queda anotado como riesgo a propósito en vez de normalizar por cuenta propia:
 * normalizar es una decisión de negocio -- define qué valores se consideran el
 * mismo -- y este módulo no la puede tomar solo. `Own production` es el default,
 * así que el modo de fallo es silencioso: conviene revisar la distribución
 * cuando cambie el formato del export.
 */
export function classifyStrategy(loan: StrategyInput): Strategy {
  if (loan.strategyRaw === 'NPPM') return 'NPPM';
  if (loan.branch === 'Affinity') return 'Affinity';
  if (RECRUITMENT_BRANCHES.has(loan.branch)) return 'Recruitment';
  if (loan.opportunityOwnerTitle === 'Business Developer') return 'B2B';
  return 'Own production';
}

/**
 * ¿Estos préstamos traen los datos que la clasificación necesita?
 *
 * ⚠ Hace falta porque `Own production` es el default. Un snapshot restaurado
 * desde Supabase ANTES de que existan las columnas nuevas trae los cinco campos
 * vacíos, y entonces `classifyStrategy` devuelve `Own production` para los 883
 * préstamos -- una respuesta perfectamente formada y completamente falsa.
 *
 * Con esto la pantalla puede decir "no hay datos de estrategia en este
 * snapshot" en vez de mostrar una distribución inventada. Es el mismo criterio
 * que el `data_as_of` nulo de S1: mejor decir que falta que rellenar.
 */
export function hasStrategyData(loans: StrategyInput[]): boolean {
  return loans.some((l) => l.strategyRaw !== '' || l.opportunityOwnerTitle !== '');
}

/**
 * ============================================================================
 * EL REALTOR DEL NPPM — los cuatro casos
 * ============================================================================
 *
 * Sólo aplica a préstamos de estrategia NPPM, y sólo en el modal de detalle:
 * en la tabla no va, para no meter una columna que está vacía en el 97% de las
 * filas.
 *
 * Devuelve la lista de lo que hay que mostrar, ya resuelta:
 *
 *   1. los dos con el MISMO valor  -> uno solo (no se repite el nombre)
 *   2. valores distintos           -> los dos
 *   3. sólo uno con valor          -> ese
 *   4. ninguno                     -> lista vacía, y la vista no dibuja nada
 *
 * ⚠ El caso 4 devuelve `[]` y no `['—']`: un placeholder ocuparía una fila para
 * decir que no hay nada. Los cuatro casos ocurren de verdad en el archivo de
 * referencia -- 20 coinciden, 1 difiere, 1 tiene uno solo, 1 no tiene ninguno.
 */
export interface NppmRealtor {
  label: string;
  value: string;
}

export function nppmRealtors(loan: { nppmRealtor: string; referredBy: string }): NppmRealtor[] {
  const nppm = loan.nppmRealtor.trim();
  const referred = loan.referredBy.trim();

  if (nppm !== '' && referred !== '') {
    /* Mismo valor: una sola línea. Se compara ya recortado -- un espacio de
       diferencia no es información, es ruido del export. */
    if (nppm === referred) return [{ label: 'NPPM Realtor', value: nppm }];
    return [
      { label: 'NPPM Realtor', value: nppm },
      { label: 'Referred by', value: referred },
    ];
  }
  if (nppm !== '') return [{ label: 'NPPM Realtor', value: nppm }];
  if (referred !== '') return [{ label: 'Referred by', value: referred }];
  return [];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Agrupar préstamos por estrategia
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Agrupa una lista de préstamos por estrategia, en el orden de presentación.
 *
 * Sólo devuelve las estrategias con al menos un préstamo -- **salvo
 * `Own production`, que va SIEMPRE**, incluso en cero.
 *
 * ⚠ La excepción no es un capricho. `Own production` es el 63% de los
 * préstamos: en el branch 703 canal Banked son 31 de 57. Si se ocultara cuando
 * da cero por un filtro, el desglose mostraría 26 debajo de un subtotal de 57 y
 * nadie entendería adónde fueron los otros 31. Que aparezca en cero es
 * información; que desaparezca es un agujero.
 */
export function groupByStrategy<T extends StrategyInput>(loans: T[]): { strategy: Strategy; loans: T[] }[] {
  const buckets = new Map<Strategy, T[]>();
  for (const loan of loans) {
    const s = classifyStrategy(loan);
    const bucket = buckets.get(s);
    if (bucket) bucket.push(loan);
    else buckets.set(s, [loan]);
  }
  return STRATEGY_ORDER.filter((s) => s === 'Own production' || (buckets.get(s)?.length ?? 0) > 0).map((s) => ({
    strategy: s,
    loans: buckets.get(s) ?? [],
  }));
}
