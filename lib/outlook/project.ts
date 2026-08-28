/*
 * ============================================================================
 * LA PROYECCIÓN — el único lugar donde se calcula un mes futuro (etapa OL1)
 * ============================================================================
 *
 * Función pura: entra un benchmark y un conjunto de reglas, sale un número por
 * mes y la explicación de cómo salió. No lee la base ni conoce React.
 */

/** Las cinco, en el orden en que se muestran. */
export const OUTLOOK_STRATEGIES = ['Own Production', 'B2B', 'NPPM', 'Recruitment', 'Affinity'] as const;
export type OutlookStrategy = (typeof OUTLOOK_STRATEGIES)[number];

export type Cadence = 'monthly' | 'quarterly' | 'semiannual';

/** Cada cuántos meses se acumula un incremento. */
const MONTHS_PER_PERIOD: Record<Cadence, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
};

/** Un tramo de una regla: "desde este mes, este % con esta cadencia". */
export interface GrowthSegment {
  /** Primer día del mes desde el que aplica, como 'YYYY-MM'. */
  fromMonth: string;
  cadence: Cadence;
  /** Puntos porcentuales. 25 = 25%. */
  growthPct: number;
}

/** Lo que se muestra cuando alguien pregunta de dónde salió un número. */
export interface ProjectionStep {
  month: string;
  /** El benchmark que se usó como base. */
  benchmark: number;
  /** El tramo que aplicó, o null si ninguno alcanza a este mes. */
  segment: GrowthSegment | null;
  /** Períodos completos transcurridos desde el inicio del tramo. */
  periods: number;
  /** El multiplicador: 1 + periods × growthPct/100. */
  multiplier: number;
  /** benchmark × multiplier, sin redondear. */
  exact: number;
  /** El entero que se muestra. */
  value: number;
  /** La cuenta en una línea, para el tooltip. */
  explain: string;
}

/** Distancia en meses entre dos 'YYYY-MM'. Positiva si `to` es posterior. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
}

/**
 * ============================================================================
 * ⚠ EL CRECIMIENTO SE APLICA SOBRE EL BENCHMARK, NO SOBRE EL MES ANTERIOR
 * ============================================================================
 *
 *     proyección = benchmark × (1 + períodos × porcentaje)
 *
 * Es acumulación LINEAL, no capitalización. Con capitalización, cuatro
 * trimestres al 25% dan `1,25⁴ = 2,44`, o sea +144%, y la proyección se dispara
 * sin que nadie lo note al mirar la regla. Lineal, los mismos cuatro trimestres
 * dan +100%: se puede explicar en una frase y se puede predecir de memoria.
 *
 * ---------------------------------------------------------------------------
 * ⚠ DECISIÓN QUE EL BRIEF NO CIERRA — hay que confirmarla
 * ---------------------------------------------------------------------------
 * "Desde septiembre, 25% trimestral": ¿septiembre ya crece, o septiembre es la
 * base y el primer aumento cae al cumplirse el trimestre?
 *
 * Acá se implementó lo SEGUNDO: `periods` cuenta períodos COMPLETOS, así que
 * arranca en 0.
 *
 *     Sep → períodos 0 → ×1,00   (el benchmark tal cual)
 *     Oct → períodos 0 → ×1,00
 *     Nov → períodos 0 → ×1,00
 *     Dic → períodos 1 → ×1,25
 *
 * Tres razones para este lado:
 *
 *   1. El brief dice que el crecimiento se aplica SOBRE EL BENCHMARK. Si el
 *      primer mes ya viniera aumentado, el benchmark no sería la base de nada.
 *   2. Una regla "desde septiembre" que en septiembre ya está 25% arriba
 *      empieza, en realidad, antes de septiembre.
 *   3. Es el lado conservador: nunca infla el presupuesto más de lo que se
 *      pidió explícitamente.
 *
 * La otra lectura --que el incremento aplique desde el primer mes-- es
 * defendible y cambia TODOS los números del módulo: con 25% trimestral desde
 * septiembre y cuatro meses por delante, esta versión sólo mueve diciembre y la
 * otra movería los cuatro. Si es la que se quiere, se cambia una línea
 * (`periods + 1`) y queda anotado acá cuál se eligió y por qué.
 */
export function projectMonth(
  month: string,
  benchmark: number,
  segments: GrowthSegment[]
): ProjectionStep {
  /*
   * El tramo que rige es el ÚLTIMO cuyo mes de inicio ya pasó. Se ordena acá y
   * no se confía en el orden de entrada: un tramo agregado después puede tener
   * un mes anterior, y "el último que aplica" no es "el último de la lista".
   *
   * ---------------------------------------------------------------------------
   * ⚠ ACÁ HABÍA UN COMPARADOR INVERTIDO, Y CON UN SOLO TRAMO ERA INVISIBLE
   * ---------------------------------------------------------------------------
   * La versión de OL1 ordenaba con `monthsBetween(a.fromMonth, b.fromMonth)`,
   * que es POSITIVO cuando `b` es posterior a `a`. Como comparador eso ordena al
   * revés --el más nuevo primero-- así que `applicable[length - 1]` devolvía el
   * tramo MÁS VIEJO, no el más nuevo.
   *
   * Con un tramo por regla, que es todo lo que había hasta OL1, las dos
   * versiones dan idéntico y el bug no existe. Apareció en la primera prueba de
   * OL2 con tres tramos: "40% trimestral desde septiembre, 0% mensual desde
   * octubre, 10% mensual desde noviembre" proyectaba diciembre con el 40% de
   * septiembre en vez del 10% de noviembre --6 en lugar de 4-- porque tomaba el
   * primero. El constructor de reglas habría entregado un presupuesto donde el
   * segundo tramo no hace nada, sin error y con el dato guardado bien.
   *
   * Se compara por texto: 'YYYY-MM' ordena igual alfabética que
   * cronológicamente, y así el comparador no depende de leer bien el signo de
   * otra función.
   */
  const applicable = segments
    .filter((s) => monthsBetween(s.fromMonth, month) >= 0)
    .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  const segment = applicable.length > 0 ? applicable[applicable.length - 1] : null;

  if (segment === null) {
    return {
      month,
      benchmark,
      segment: null,
      periods: 0,
      multiplier: 1,
      exact: benchmark,
      value: Math.round(benchmark),
      explain: `Benchmark ${benchmark} · sin regla que aplique a este mes → ${Math.round(benchmark)}`,
    };
  }

  const elapsed = monthsBetween(segment.fromMonth, month);
  const periods = Math.floor(elapsed / MONTHS_PER_PERIOD[segment.cadence]);
  const multiplier = 1 + (periods * segment.growthPct) / 100;
  const exact = benchmark * multiplier;

  return {
    month,
    benchmark,
    segment,
    periods,
    multiplier,
    exact,
    value: Math.round(exact),
    explain:
      `Benchmark ${benchmark} × (1 + ${periods} × ${segment.growthPct}%) = ${exact.toFixed(2)}` +
      ` → ${Math.round(exact)}` +
      `  ·  regla: ${segment.growthPct}% ${cadenceLabel(segment.cadence)} desde ${segment.fromMonth}` +
      `  ·  ${periods} período(s) completo(s) de ${MONTHS_PER_PERIOD[segment.cadence]} mes(es)`,
  };
}

/*
 * ============================================================================
 * ETAPA PENDIENTE — el mes en curso abierto por estrategia
 * ============================================================================
 *
 * Hoy la vista 2 muestra `—` en la columna del mes en curso de cada estrategia,
 * y eso es deliberado: la proyección del mes la calcula Forecast sobre el
 * snapshot del pipeline, que no lleva la estrategia consigo. Repartir el total
 * por peso del YTD daría un número plausible y falso -- la peor clase, porque
 * nadie lo cuestiona.
 *
 * Es DERIVABLE, y por eso queda anotado como etapa y no como límite:
 * `pipeline_forecast.pipeline_loans` persiste los cinco crudos desde F6b
 * (`strategy_raw`, `opportunity_owner_title`, `nppm_realtor`, `referred_by`,
 * `affinity_program`) y `lib/pipeline/strategy.ts` ya sabe clasificarlos con la
 * precedencia correcta. Lo que falta es correr esa clasificación sobre los
 * préstamos abiertos del snapshot y repartir la cascada de pull-through por
 * estrategia -- que es trabajo dentro de Forecast, no acá.
 */

export function cadenceLabel(c: Cadence): string {
  return c === 'monthly' ? 'mensual' : c === 'quarterly' ? 'trimestral' : 'semestral';
}

/** La proyección de varios meses de una vez. */
export function projectMonths(
  months: string[],
  benchmark: number,
  segments: GrowthSegment[]
): ProjectionStep[] {
  return months.map((m) => projectMonth(m, benchmark, segments));
}

/*
 * ============================================================================
 * EL BENCHMARK ES UNA SERIE, NO UN NÚMERO — etapa OL2
 * ============================================================================
 *
 * Hasta OL1 el benchmark entraba como un escalar, porque no había forma de
 * editarlo y la tabla estaba vacía. Con el editor ya no alcanza:
 *
 *   - todo lo que se guarda rige desde el PRIMER DÍA DEL MES SIGUIENTE, nunca
 *     sobre el mes en curso (ver `docs/sql/2026-08-outlook-schema.sql`);
 *   - la tabla es append-only, así que un mismo (persona, estrategia) acumula
 *     varias filas con distintos `effective_from`;
 *   - y nada impide --ni debería-- fijar hoy un benchmark que arranca en
 *     noviembre.
 *
 * Entonces cada mes proyectado usa el benchmark vigente EN ESE MES: la fila de
 * `effective_from` más alto que ya empezó. Con un escalar, un benchmark que
 * arranca en noviembre se habría aplicado a septiembre o se habría ignorado
 * entero, y en los dos casos el número saldría sin que nada fallara.
 *
 * ⚠ La regla de crecimiento NO se mueve cuando cambia el benchmark: sus períodos
 * se cuentan desde el `fromMonth` del tramo. Un benchmark nuevo en noviembre no
 * reinicia el trimestre; cambia la base sobre la que se multiplica. Es lo que
 * hace que las dos decisiones --cuánto es la base y cuánto crece-- se puedan
 * tomar por separado.
 */
export interface BenchmarkPoint {
  /** Primer mes en que rige, 'YYYY-MM'. */
  fromMonth: string;
  value: number;
}

/**
 * El benchmark vigente en `month`: el punto de `fromMonth` más alto que no lo
 * supera. Si ninguno arrancó todavía, 0 — no el primero futuro.
 *
 * ⚠ Los puntos se ordenan acá y no se confía en el orden de entrada, por lo
 * mismo que en `projectMonth`: una fila insertada después puede regir antes.
 */
export function benchmarkAt(points: BenchmarkPoint[], month: string): number {
  let best: BenchmarkPoint | null = null;
  for (const p of points) {
    if (monthsBetween(p.fromMonth, month) < 0) continue;
    if (best === null || monthsBetween(best.fromMonth, p.fromMonth) > 0) best = p;
  }
  return best === null ? 0 : best.value;
}

/*
 * ============================================================================
 * LOS DOS MODOS, Y LA ÚNICA PUERTA POR LA QUE SE PROYECTA — etapa OL4
 * ============================================================================
 *
 * Un presupuesto se puede fijar de dos maneras:
 *
 *   `growth`    benchmark + regla de crecimiento  ->  los meses se CALCULAN
 *   `monthly`   un número por mes                 ->  los meses se ESCRIBEN
 *
 * ⚠ `projectPlan` es la ÚNICA función que decide cuál se usa, y la llaman los
 * tres lugares que muestran un mes futuro: la tabla de la vista 1, la de la
 * vista 2 y la vista previa del editor.
 *
 * Que sea una sola importa más de lo que parece. Una vista previa con su propia
 * aritmética sería peor que no tener vista previa: mostraría con autoridad un
 * número que después no aparece en la tabla, y nadie revisa dos veces algo que
 * ya vio confirmado. El único modo de garantizar que la previa dice la verdad es
 * que no tenga forma de mentir.
 *
 * `projectMonth` sigue siendo la aritmética del crecimiento y no sabe que existe
 * el otro modo. `projectPlan` es la que elige.
 */
export type ProjectionMode = 'growth' | 'monthly';

export interface StrategyPlan {
  /** El modo que RIGE. Lo del otro modo queda guardado y no se aplica. */
  mode: ProjectionMode;
  /** Modo `growth`: la serie de benchmarks y los tramos. */
  benchmarks: BenchmarkPoint[];
  segments: GrowthSegment[];
  /** Modo `monthly`: 'YYYY-MM' → número fijado. */
  targets: Record<string, number>;
}

/**
 * Un mes fijado a mano, con la misma forma que uno calculado.
 *
 * ⚠ Devuelve un `ProjectionStep` completo y no un número suelto: las celdas de
 * la tabla muestran `step.explain` en el tooltip, y si este modo devolviera algo
 * distinto habría que preguntar en cada celda de qué tipo es. Un mes fijado
 * tiene benchmark 0, ningún tramo y cero períodos porque no depende de ninguno
 * de los tres -- eso NO es "faltan datos", es lo que significa fijarlo a mano.
 */
function fixedMonth(month: string, target: number | undefined): ProjectionStep {
  const value = target ?? 0;
  return {
    month,
    benchmark: 0,
    segment: null,
    periods: 0,
    multiplier: 1,
    exact: value,
    value: Math.round(value),
    explain:
      target === undefined
        ? `Modo mes a mes · este mes no tiene número fijado → 0`
        : `Modo mes a mes · número fijado a mano: ${value} · no depende de benchmark ni de regla`,
  };
}

/** La proyección de una estrategia, por el modo que rige. */
export function projectPlan(months: string[], plan: StrategyPlan): ProjectionStep[] {
  if (plan.mode === 'monthly') {
    return months.map((m) => fixedMonth(m, plan.targets[m]));
  }
  return months.map((m) => projectMonth(m, benchmarkAt(plan.benchmarks, m), plan.segments));
}

/** Cómo se llama el modo en la pantalla. */
export function modeLabel(mode: ProjectionMode): string {
  return mode === 'growth' ? 'por porcentaje' : 'mes a mes';
}
