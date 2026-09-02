import {
  BROKERED_FLAT_PULL_THROUGH_RATE,
  calculateForecast,
  countByMilestoneBucket,
  splitHealthyTotal,
  type BucketCounts,
  type DateRange,
  type ForecastByBucket,
  type PullThroughRates,
} from './aggregate';
import type { PipelineLoan } from './types';

/**
 * ============================================================================
 * LA CASCADA POR BRANCH+CANAL — etapa RPT1
 * ============================================================================
 *
 * ⚠ ARCHIVO NUEVO SIN LÓGICA NUEVA. Esto vivía dentro de `app/pipeline/
 * page.tsx`, en un bucle inline, y sale de ahí sin que cambie una tasa, una
 * población ni un redondeo. Se mueve porque el reporte mensual (RPT1) necesita
 * exactamente el mismo cálculo sobre OTRO snapshot --el del corte-- y copiarlo
 * habría dejado dos definiciones del forecast: la de la pantalla y la del
 * Excel, con la garantía de que algún día difieren y nadie sabe cuál está mal.
 *
 * Es el mismo criterio que ya sostiene `calculateTotalForecastWithClosed`: una
 * sola definición de cada número, leída desde los dos lados.
 *
 * Las tasas también se mudan acá. Estaban declaradas en `page.tsx` --con una
 * nota que explicaba que se duplicaban en vez de importarlas del fixture-- y
 * ahora las necesitan la pantalla y el reporte, así que su lugar es junto a la
 * función que las aplica.
 */

/**
 * Etapa F4: los cuatro micro-% de la cascada de Banked. El input editable en la
 * UI es una etapa futura, no aprobada.
 */
export const PULL_THROUGH_RATES: PullThroughRates = {
  Started: 0.8923,
  Processing: 0.93,
  Underwriting: 0.8459,
  Closing: 0.95,
};

/**
 * Lo que `page.tsx` arma por branch+channel (usado también para la cascada
 * agregada de `MilestoneCascade`). `PivotTable` sólo lee `loans` de acá para
 * alimentar el modal de auditoría.
 *
 * El tipo se declaraba en `PivotTable.tsx`. Se muda con la función que lo
 * produce: un módulo de `lib/` no puede depender de un componente, y el reporte
 * corre en el servidor, donde `PivotTable` no existe. `PivotTable` lo
 * re-exporta para no romper a quien lo importaba de ahí.
 */
export interface BranchForecastRow {
  branch: string;
  channel: PipelineLoan['channel'];
  totalCount: number;
  healthyCount: number;
  bucketTotal: BucketCounts;
  bucketHealthy: BucketCounts;
  forecastByBucket: ForecastByBucket;
  forecastTotal: number;
  /**
   * El mismo forecast SIN redondear — etapa RPT1, campo agregado.
   *
   * ⚠ NO ES UN SEGUNDO FORECAST: es el valor del que sale `forecastTotal` por
   * `Math.round`. Existe porque un total ya redondeado no sirve como PESO para
   * repartirlo entre partes --el reporte mensual abre cada branch por Loan
   * Officer-- y redondear cada parte por su cuenta rompería la suma. Es el
   * mismo patrón que `apportionByWeight` usa en todo el módulo.
   *
   * Nadie lo mostraba antes y nadie tiene que mostrarlo: mostrar medio préstamo
   * sigue estando mal.
   */
  forecastExact: number;
  loans: PipelineLoan[];
}

/**
 * ============================================================================
 * CUÁNTO APORTA UN SOLO PRÉSTAMO AL FORECAST — etapa RPT3
 * ============================================================================
 *
 * ⚠ NO ES UNA SEGUNDA FÓRMULA: es la MISMA cascada, mirada préstamo por
 * préstamo en vez de por bucket. La suma de esto sobre un (branch, canal) da
 * exactamente el `forecastExact` de ese grupo, y hay una prueba que lo comprueba
 * -- si algún día dejaran de coincidir, una de las dos está mal.
 *
 * Existe para que el reporte mensual pueda poner el peso en una columna del
 * detalle y calcular el forecast con un `SUMIFS`. La alternativa era escribir el
 * número a mano en el resumen, y un número que nadie puede reconstruir filtrando
 * la hoja es exactamente lo que este reporte viene a eliminar.
 *
 * ⚠ LA CASCADA ES ACUMULATIVA. Un préstamo en `Started` no vale su tasa: vale el
 * PRODUCTO de las cuatro etapas que le faltan por pasar. Uno en `Closing` ya está
 * en la meta y vale sólo la suya. Por eso esto no es "la tasa de su bucket".
 *
 * ⚠ Y LOS DOS CANALES NO COMPARTEN NI LA TASA NI LA POBLACIÓN. Banked pesa sólo
 * si está HEALTHY; Brokered pesa 40% esté sano o no, porque su regla es plana
 * sobre el total de abiertos.
 */
export function pullThroughWeight(loan: PipelineLoan, rates: PullThroughRates = PULL_THROUGH_RATES): number {
  if (loan.channel === 'Brokered') return BROKERED_FLAT_PULL_THROUGH_RATE;
  if (loan.healthy !== true) return 0;
  switch (loan.milestone) {
    case 'Started':
      return rates.Started * rates.Processing * rates.Underwriting * rates.Closing;
    case 'Processing':
      return rates.Processing * rates.Underwriting * rates.Closing;
    case 'Underwriting':
      return rates.Underwriting * rates.Closing;
    case 'Closing':
      return rates.Closing;
  }
}

/**
 * Una fila por (branch, canal) presente en `openLoans`, con su forecast ya
 * redondeado.
 *
 * ⚠ EL REDONDEO VA ACÁ, POR FILA, y no al mostrar --Cambio 4 del brief F5j--.
 * `forecastTotal` de acá en más sólo se suma o se muestra, nunca alimenta otra
 * decisión de negocio, así que adelantar el redondeo hace que todo lo que sume
 * esto herede "sumar filas ya enteras". Como los cerrados son siempre enteros,
 * `round(cerrados + x) === cerrados + round(x)`: el valor de cada fila quedó
 * idéntico a antes de que el redondeo se adelantara.
 *
 * ⚠ Y LOS DOS CANALES NO COMPARTEN FÓRMULA. Banked es la cascada de cuatro
 * etapas sobre los HEALTHY; Brokered es un 40% plano sobre el TOTAL de abiertos
 * --otra población, no sólo otra tasa--. `bucketTotal`, `bucketHealthy` y
 * `forecastByBucket` se calculan igual para los dos por compatibilidad de tipos
 * con `BranchForecastRow`, pero en una fila Brokered nadie los lee: su desglose
 * real se recalcula aparte, en `page.tsx`.
 */
export function buildBranchForecastRows(
  openLoans: PipelineLoan[],
  pipelineDateRange: DateRange,
  rates: PullThroughRates = PULL_THROUGH_RATES
): BranchForecastRow[] {
  const rows: BranchForecastRow[] = [];
  const groups = new Map<string, { branch: string; channel: PipelineLoan['channel'] }>();
  for (const loan of openLoans) {
    groups.set(loan.branch + '::' + loan.channel, { branch: loan.branch, channel: loan.channel });
  }
  for (const { branch, channel } of groups.values()) {
    const { total, healthy } = splitHealthyTotal(openLoans, branch, channel, pipelineDateRange);
    const bucketTotal = countByMilestoneBucket(total);
    const bucketHealthy = countByMilestoneBucket(healthy);
    const { forecastByBucket, forecastTotal: bankedFormulaForecastTotal } = calculateForecast(bucketHealthy, rates);
    const forecastExact =
      channel === 'Brokered' ? total.length * BROKERED_FLAT_PULL_THROUGH_RATE : bankedFormulaForecastTotal;
    rows.push({
      branch,
      channel,
      totalCount: total.length,
      healthyCount: healthy.length,
      bucketTotal,
      bucketHealthy,
      forecastByBucket,
      forecastTotal: Math.round(forecastExact),
      forecastExact,
      loans: total,
    });
  }
  return rows;
}
