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
