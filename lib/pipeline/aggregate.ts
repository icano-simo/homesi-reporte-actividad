import type { PipelineLoan, ResolvedLoan } from './types';

// Esta regla es la más importante de todo el módulo: aggregate.ts nunca
// importa nada de /lib/pipeline/sources/ -- solo recibe PipelineLoan[] ya
// armado por quien lo llame. Ningún parser ni fuente de datos se referencia
// desde acá.

export interface BucketCounts {
  Started: number;
  Processing: number;
  Underwriting: number;
  Closing: number;
}

export interface PullThroughRates {
  Started: number;
  Processing: number;
  Underwriting: number;
  Closing: number;
}

export interface ForecastByBucket {
  Started: number;
  Processing: number;
  Underwriting: number;
  Closing: number;
}

export interface ForecastResult {
  forecastByBucket: ForecastByBucket;
  forecastTotal: number;
}

export interface PipelineForecastSummary {
  totalCount: number;
  healthyCount: number;
  bucketCounts: BucketCounts;
  forecastByBucket: ForecastByBucket;
  forecastTotal: number;
}

/**
 * Separa los loans de una branch+channel en el universo total y el
 * subconjunto healthy (healthy === true; null y false quedan fuera de
 * "healthy" pero siguen contando para "total").
 *
 * Etapa F4f: además se filtra por `estClosingDate` dentro de `dateRange`
 * (inclusive, con límite inferior Y superior) -- un préstamo cuyo cierre
 * esperado cae fuera del rango activo no debe contar. Un préstamo sin
 * `estClosingDate` (null) se excluye también.
 *
 * Etapa F5c había cambiado esto a "estClosingDate <= fin de un mes
 * objetivo, sin límite inferior" -- Etapa F5e revierte ese cambio: Total/
 * Healthy Pipeline vuelven a usar el DateRange completo (con mínimo),
 * porque ahora Cerrados/Forecast tienen su PROPIO selector de mes,
 * independiente (ver forecastMonth en page.tsx) -- ya no hace falta que
 * Pipeline "tome prestado" un mes objetivo derivado de otro control.
 */
export function splitHealthyTotal(
  loans: PipelineLoan[],
  branch: string,
  channel: PipelineLoan['channel'],
  dateRange: DateRange
): { total: PipelineLoan[]; healthy: PipelineLoan[] } {
  const total = loans.filter(
    (loan) =>
      loan.branch === branch &&
      loan.channel === channel &&
      loan.estClosingDate !== null &&
      loan.estClosingDate >= dateRange.startDate &&
      loan.estClosingDate <= dateRange.endDate
  );
  const healthy = total.filter((loan) => loan.healthy === true);
  return { total, healthy };
}

/**
 * Cuenta cuántos loans caen en cada bucket de milestone. El campo
 * `milestone` ya viene clasificado en buckets desde el parser -- acá solo
 * se cuenta, no se reclasifica nada.
 */
export function countByMilestoneBucket(loans: PipelineLoan[]): BucketCounts {
  const counts: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };
  for (const loan of loans) {
    counts[loan.milestone] += 1;
  }
  return counts;
}

export interface CtcClosingSplit {
  ctcCount: number;
  closingCount: number;
}

/**
 * Desglose informativo de display: cuántos loans de un set tienen milestone
 * CRUDO "Clear To Close" vs "Closing" -- las dos etiquetas que
 * `MILESTONE_BUCKET` (`lib/pipeline/sources/salesforce-file.ts`, NO acá --
 * ese es el punto real donde el crudo se colapsa a `milestone: 'Closing'`,
 * antes de que un PipelineLoan llegue a esta función) fusiona en un único
 * bucket combinado. Ese bucket combinado (`countByMilestoneBucket(...).Closing`)
 * sigue siendo la única fuente que alimenta pull-through/forecast/totales --
 * esta función es puramente aditiva, solo separa para MOSTRAR lo que ya está
 * adentro del bucket combinado, nunca cambia qué cuenta como Closing ni
 * reclasifica nada.
 *
 * Recibe el mismo array de `PipelineLoan[]` que ya recibe
 * `countByMilestoneBucket` (misma fuente cruda, `rawMilestone` ya viene
 * poblado por el parser) -- quien la llama es responsable de pasarle el
 * mismo set de loans, para que `ctcCount + closingCount` sea comparable
 * 1:1 contra `countByMilestoneBucket(loans).Closing`.
 */
export function splitCtcAndClosing(loans: PipelineLoan[]): CtcClosingSplit {
  let ctcCount = 0;
  let closingCount = 0;
  for (const loan of loans) {
    if (loan.rawMilestone === 'Clear To Close') ctcCount++;
    else if (loan.rawMilestone === 'Closing') closingCount++;
  }
  return { ctcCount, closingCount };
}

/**
 * Cascada de pull-through: cada bucket forecastea hacia adelante multiplicando
 * su propio count por las tasas de todos los buckets que le faltan por pasar
 * (incluida la suya). Closing ya está en la meta, así que solo usa su propia
 * tasa.
 *
 * IMPORTANTE (ver Decisiones en la respuesta): `bucketCounts` acá debe ser el
 * conteo de loans HEALTHY por bucket, no el total -- así es como se validó
 * contra Summary SL del Excel real. Esta función en sí no filtra nada, solo
 * multiplica lo que le pasen; quien la llama es responsable de pasarle los
 * counts correctos (ver buildPipelineForecast).
 */
export function calculateForecast(bucketCounts: BucketCounts, pullThroughRates: PullThroughRates): ForecastResult {
  const { Started, Processing, Underwriting, Closing } = pullThroughRates;

  const forecastByBucket: ForecastByBucket = {
    Started: bucketCounts.Started * Started * Processing * Underwriting * Closing,
    Processing: bucketCounts.Processing * Processing * Underwriting * Closing,
    Underwriting: bucketCounts.Underwriting * Underwriting * Closing,
    Closing: bucketCounts.Closing * Closing,
  };

  const forecastTotal =
    forecastByBucket.Started + forecastByBucket.Processing + forecastByBucket.Underwriting + forecastByBucket.Closing;

  return { forecastByBucket, forecastTotal };
}

/**
 * Junta todo: dado el universo completo de PipelineLoan más un branch/channel
 * y las tasas de pull-through, arma el resumen completo del Forecast.
 *
 * `bucketCounts` en el resultado son los conteos TOTALES por bucket (para
 * mostrar, p.ej. "Underwriting: 33 loans"). El forecast en sí se calcula
 * sobre los conteos HEALTHY por bucket -- son dos cosas distintas, ver nota
 * en calculateForecast() y en la respuesta de esta etapa.
 */
export function buildPipelineForecast(
  loans: PipelineLoan[],
  branch: string,
  channel: PipelineLoan['channel'],
  pullThroughRates: PullThroughRates,
  dateRange: DateRange
): PipelineForecastSummary {
  const { total, healthy } = splitHealthyTotal(loans, branch, channel, dateRange);

  const bucketCounts = countByMilestoneBucket(total);
  const healthyBucketCounts = countByMilestoneBucket(healthy);

  const { forecastByBucket, forecastTotal } = calculateForecast(healthyBucketCounts, pullThroughRates);

  return {
    totalCount: total.length,
    healthyCount: healthy.length,
    bucketCounts,
    forecastByBucket,
    forecastTotal,
  };
}

export interface TotalForecastWithClosed {
  closedCount: number;
  pullThroughForecast: number;
  totalForecast: number;
}

export interface DateRange {
  /** 'YYYY-MM-DD', inclusive. */
  startDate: string;
  /** 'YYYY-MM-DD', inclusive. */
  endDate: string;
}

export interface TargetMonth {
  year: number;
  /** 1-12. */
  month: number;
}

function monthKeyOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISODateLocal(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/**
 * Etapa F5c: deriva un único "mes objetivo" de negocio a partir de un
 * `dateRange`. Si el mes calendario de `today` cae dentro del rango, el mes
 * objetivo es el de `today`; si no, es el último mes que sí cae dentro del
 * rango -- como el rango es contiguo, ese es simplemente el mes de
 * `dateRange.endDate`. `today` es un parámetro explícito (no `new Date()`
 * interno) para poder testear esta función aislada con cualquier fecha fija.
 *
 * Etapa F5e: page.tsx ya NO llama a esta función -- Cerrados/Forecast pasó
 * a usar un selector de mes independiente (forecastMonth), no un mes
 * derivado del DateRange de Pipeline. Se deja sin borrar (no rompe nada,
 * sigue exportada y correcta) por si hace falta este mismo criterio de
 * derivación en otro lado más adelante.
 */
export function getTargetMonth(dateRange: DateRange, today: Date): TargetMonth {
  const todayKey = today.getFullYear() + '-' + pad2(today.getMonth() + 1);
  const startKey = monthKeyOf(dateRange.startDate);
  const endKey = monthKeyOf(dateRange.endDate);

  if (todayKey >= startKey && todayKey <= endKey) {
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }

  const [endYear, endMonth] = endKey.split('-').map(Number);
  return { year: endYear, month: endMonth };
}

/** Primer y último día del mes objetivo, como 'YYYY-MM-DD' -- lo que consumen calculateTotalForecastWithClosed (rango completo) y splitHealthyTotal (solo el endDate). */
export function targetMonthRange(target: TargetMonth): DateRange {
  const start = new Date(target.year, target.month - 1, 1);
  const end = new Date(target.year, target.month, 0);
  return { startDate: toISODateLocal(start), endDate: toISODateLocal(end) };
}

/**
 * Etapa F4b: el Forecast final del negocio no es solo la proyección de
 * pull-through -- son los préstamos que YA cerraron (Stage=Closed Won,
 * status='funded' en ResolvedLoan) MÁS esa proyección. Confirmado contra el
 * Excel real (Pipeline_Review.xlsx, hoja Forecast).
 *
 * Etapa F4c: "cerraron" ahora se acota a un rango de fechas -- inicialmente
 * Est. Closing Date; Etapa F4e cambió la fuente a ResolvedLoan.disbursementDate
 * (Disbursement Date, confirmado como el campo correcto contra datos reales;
 * cae a Est. Closing Date solo si el archivo no trae esa columna -- ver
 * parser).
 *
 * Etapa F5c le había pasado el rango de un "mes objetivo" derivado del
 * DateRange de Pipeline (ver getTargetMonth). Etapa F5e: ahora ese rango
 * viene de un selector de mes NUEVO e independiente (forecastMonth en
 * page.tsx) -- ya no tiene relación con el DateRange de Pipeline en
 * absoluto. La lógica de filtrado en sí no cambió (sigue siendo
 * "disbursementDate dentro de [startDate, endDate]"), solo qué le pasa el
 * caller y de dónde sale ese rango.
 *
 * Los 'adverse' nunca se suman a nada acá -- ya se cayeron del pipeline, ni
 * siquiera se cuentan, solo se ignoran (igual que en page.tsx, que ya no los
 * usaba para ningún cálculo desde F4).
 *
 * No toca ni reemplaza calculateForecast/countByMilestoneBucket/
 * splitHealthyTotal -- recibe el forecastTotal que esas funciones ya
 * calcularon, y le suma encima los cerrados.
 *
 * IMPORTANTE: este conteo es una aproximación a partir de los datos de
 * Salesforce (Stage=Closed Won + fecha en rango). No va a coincidir
 * exactamente con un Excel armado a mano, que suele tener ajustes manuales
 * que esta regla no puede replicar -- no es un bug si difiere.
 */
export function calculateTotalForecastWithClosed(
  resolvedLoans: ResolvedLoan[],
  forecastTotal: number,
  forecastMonthRange: DateRange
): TotalForecastWithClosed {
  const closedCount = resolvedLoans.filter(
    (loan) =>
      loan.status === 'funded' &&
      loan.disbursementDate >= forecastMonthRange.startDate &&
      loan.disbursementDate <= forecastMonthRange.endDate
  ).length;
  return {
    closedCount,
    pullThroughForecast: forecastTotal,
    totalForecast: closedCount + forecastTotal,
  };
}

// ============================================================
// Brokered: cascada de pull-through propia (Etapa F5i)
// ============================================================
//
// Hasta F5h, Brokered pasaba por exactamente el mismo camino que Banked
// (splitHealthyTotal -> countByMilestoneBucket -> calculateForecast, con
// PULL_THROUGH_RATES de Banked) -- no existía ninguna fórmula "Cerrados +
// Healthy al 100%" en el código (se verificó explícitamente en la
// respuesta de esta etapa; la premisa del brief sobre el "antes" no
// coincidía con lo que había, se avisó antes de tocar nada). Ahora
// Brokered tiene su PROPIA cascada de 4 etapas, con tasas confirmadas por
// un estudio de conversión histórico -- no comparte ningún tipo con el
// bloque de Banked de arriba a propósito (misma cantidad de etapas, pero
// nombres y significado distintos; forzarlas al mismo shape hubiera sido
// más confuso que dos juegos de tipos separados).
//
// Mapeo de Current Milestone (PipelineLoan.rawMilestone, NO el `milestone`
// ya bucketizado a la Banked que arma el parser) a bucket de Brokered --
// confirmado con el usuario en la respuesta de F5i después de verificar
// contra 2 archivos reales (_scratch/) que, en pipeline abierto
// (Stage=Negotiation), Brokered solo usa 3 valores reales de Current
// Milestone: "Started", "Processing", "Submittal". Los 5 nombres del
// estudio (File Creation/App Date/Processing/Submitted/Completion) NO
// aparecen tal cual en los datos -- el mapeo confirmado es:
//   Started   -> bucket FileCreation (le faltan las 4 etapas)
//   Processing -> bucket Processing   (le faltan Processing->Submitted y Submitted->Completion)
//   Submittal  -> bucket Submitted    (le falta solo Submitted->Completion)
// El bucket AppDate queda SIEMPRE en 0: ningún Current Milestone real
// visto en los datos cae ahí (existe en la fórmula porque conceptualmente
// es una etapa intermedia del estudio, no porque haya loans que lo usen
// hoy). Un rawMilestone de un préstamo Brokered que no sea ninguno de los
// 3 valores confirmados (ej. si algún archivo futuro trae "Initial
// Decision" o "Clear To Close" en un préstamo Brokered -- no visto en la
// muestra de 2 archivos) NO incrementa ningún bucket -- ver riesgo en la
// respuesta de esta etapa.

export interface BrokeredBucketCounts {
  FileCreation: number;
  AppDate: number;
  Processing: number;
  Submitted: number;
}

export interface BrokeredPullThroughRates {
  /** File Creation -> App Date. */
  FileCreation: number;
  /** App Date -> Processing. */
  AppDate: number;
  /** Processing -> Submitted. */
  Processing: number;
  /** Submitted -> Completion. */
  Submitted: number;
}

export interface BrokeredForecastByBucket {
  FileCreation: number;
  AppDate: number;
  Processing: number;
  Submitted: number;
}

export interface BrokeredForecastResult {
  forecastByBucket: BrokeredForecastByBucket;
  forecastTotal: number;
}

/**
 * Etapa F5j (2026-08-12): tasa plana de pull-through para Brokered, acordada
 * con el negocio -- reemplaza a BROKERED_PULL_THROUGH_RATES (la cascada de 4
 * etapas por milestone queda desactivada, ver nota de código muerto debajo).
 * Se aplica sobre el TOTAL de préstamos abiertos de Brokered, NO sobre
 * Healthy -- a diferencia de la cascada vieja (y a diferencia de Banked, que
 * sigue su propia cascada de siempre sobre Healthy, sin ningún cambio acá).
 * Forecast Brokered = round(totalCount * BROKERED_FLAT_PULL_THROUGH_RATE) +
 * Closed Brokered (ver page.tsx).
 */
export const BROKERED_FLAT_PULL_THROUGH_RATE = 0.4;

/**
 * Código muerto desde la Etapa F5j -- Brokered ya no usa una tasa distinta
 * por milestone (ver BROKERED_FLAT_PULL_THROUGH_RATE arriba). Se deja sin
 * borrar a propósito (así lo pidió el brief de F5j): borrarla ahora habría
 * ampliado el radio de este cambio sin necesidad. Pendiente de limpieza en
 * una etapa futura si se confirma que no hace falta volver a la cascada por
 * etapa.
 */
export const BROKERED_PULL_THROUGH_RATES: BrokeredPullThroughRates = {
  FileCreation: 1.0,
  AppDate: 0.875,
  Processing: 0.286,
  Submitted: 0.9,
};

const BROKERED_MILESTONE_BUCKET: Record<string, keyof BrokeredBucketCounts> = {
  Started: 'FileCreation',
  Processing: 'Processing',
  Submittal: 'Submitted',
};

/**
 * Clasifica loans de Brokered en los 4 buckets propios a partir de
 * `rawMilestone` (Current Milestone crudo). Un rawMilestone fuera de
 * BROKERED_MILESTONE_BUCKET no incrementa ningún bucket -- ver nota de
 * riesgo arriba del bloque.
 */
export function countByBrokeredMilestoneBucket(loans: PipelineLoan[]): BrokeredBucketCounts {
  const counts: BrokeredBucketCounts = { FileCreation: 0, AppDate: 0, Processing: 0, Submitted: 0 };
  for (const loan of loans) {
    const bucket = BROKERED_MILESTONE_BUCKET[loan.rawMilestone.trim()];
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/**
 * Código muerto desde la Etapa F5j -- Brokered ya no usa esta cascada por
 * etapa (ver BROKERED_FLAT_PULL_THROUGH_RATE arriba y el comentario de
 * código muerto sobre BROKERED_PULL_THROUGH_RATES). Se deja sin borrar a
 * propósito, mismo motivo. Pendiente de limpieza futura.
 *
 * Mismo patrón que calculateForecast() de Banked (ver arriba): cada bucket
 * forecastea multiplicando su count por las tasas de todas las etapas que
 * le faltan por pasar, incluida la suya. Submitted ya está en la última
 * etapa antes de Completion, así que solo usa su propia tasa.
 */
export function calculateBrokeredForecast(
  bucketCounts: BrokeredBucketCounts,
  rates: BrokeredPullThroughRates
): BrokeredForecastResult {
  const { FileCreation, AppDate, Processing, Submitted } = rates;

  const forecastByBucket: BrokeredForecastByBucket = {
    FileCreation: bucketCounts.FileCreation * FileCreation * AppDate * Processing * Submitted,
    AppDate: bucketCounts.AppDate * AppDate * Processing * Submitted,
    Processing: bucketCounts.Processing * Processing * Submitted,
    Submitted: bucketCounts.Submitted * Submitted,
  };

  const forecastTotal =
    forecastByBucket.FileCreation + forecastByBucket.AppDate + forecastByBucket.Processing + forecastByBucket.Submitted;

  return { forecastByBucket, forecastTotal };
}

// ============================================================
// Etapa F5j-b: reparto de un total ya fijado (Brokered)
// ============================================================
//
// F5j (primera pasada) redondeaba el forecast de Brokered en 2 lugares
// independientes -- por branch (Executive) y por milestone-bucket (Matrix)
// -- y cada partición arrastra el redondeo distinto (mismos 19 préstamos:
// 6 por branch, 8 por bucket; verificado contra el snapshot activo). No era
// un bug de una fórmula puntual: es aritmética, redondear-y-sumar da
// resultados distintos según cómo se agrupen las filas antes de sumar.
//
// La regla que lo resuelve: el total por branch es la ÚNICA fuente de
// verdad para el forecast de Brokered (page.tsx lo calcula una sola vez,
// ahí). Cualquier otra vista que necesite un desglose (Matrix, por
// milestone) tiene que REPARTIR ese total ya fijado, nunca recalcularlo.

/**
 * Reparte un total entero ya fijado entre N categorías, en proporción a un
 * peso por categoría, garantizando que la suma de las partes sea
 * EXACTAMENTE el total recibido -- nunca se lo recalcula a partir de las
 * partes. Método de mayor resto (Hamilton apportionment, el mismo que usan
 * varios sistemas electorales para repartir bancas): cada categoría recibe
 * el piso de su porción proporcional exacta; el resto entero que falta para
 * llegar al total se reparte de a 1, empezando por las categorías con mayor
 * parte fraccionaria descartada. Determinista para el mismo input.
 *
 * Sin pesos (`weights` todos 0): si `total` también es 0, todas las partes
 * quedan en 0 (el caso normal, ninguna categoría tiene préstamos). Si
 * `total` no es 0 sin ningún peso -- no debería pasar en la práctica, pero
 * ante ese dato inconsistente se lo lleva completo la primera categoría en
 * vez de perderlo en silencio (la suma tiene que seguir dando `total`).
 */
export function apportionByWeight(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    const parts = weights.map(() => 0);
    if (total !== 0 && parts.length > 0) parts[0] = total;
    return parts;
  }

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const byRemainderDesc = floors
    .map((_, i) => i)
    .sort((a, b) => exact[b] - floors[b] - (exact[a] - floors[a]));

  const parts = [...floors];
  for (let k = 0; k < byRemainderDesc.length && remainder > 0; k++) {
    parts[byRemainderDesc[k]] += 1;
    remainder -= 1;
  }
  return parts;
}
