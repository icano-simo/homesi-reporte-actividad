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
   */
  const applicable = segments
    .filter((s) => monthsBetween(s.fromMonth, month) >= 0)
    .sort((a, b) => monthsBetween(a.fromMonth, b.fromMonth));
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
