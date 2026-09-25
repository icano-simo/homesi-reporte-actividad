import type { LoanRecord } from '@/lib/domain/types';
import { businessDaysToClose } from '@/lib/activity/businessDaysToClose';

export type AverageDaysToCloseDimension = 'branch' | 'loanOfficer' | 'processor';

export interface AverageDaysToCloseGroup {
  label: string;
  /** Préstamos elegibles de este grupo (app_date + ctcDate + countsForDivision), incluidos los que la RPC no pudo resolver. */
  n: number;
  /** Promedio SOLO sobre los préstamos del grupo con resultado no-null de la RPC. `null` si ninguno lo tuvo. */
  avgBusinessDays: number | null;
  /** Mediana sobre el mismo subconjunto no-null que `avgBusinessDays` -- promedio de los 2 valores centrales si el subconjunto es par. `null` si ninguno lo tuvo. */
  medianBusinessDays: number | null;
  /** Mínimo/máximo de días hábiles del grupo, sobre el mismo subconjunto no-null que `avgBusinessDays` -- `null` si ninguno lo tuvo. */
  minBusinessDays: number | null;
  maxBusinessDays: number | null;
}

/**
 * Resultado de UN préstamo -- las 3 etiquetas de dimensión ya resueltas acá
 * (una sola vez, junto con la llamada a la RPC), para que agrupar por
 * cualquiera de las 3 después no necesite volver a tocar `LoanRecord` ni la
 * RPC. `days: null` cubre tanto un `null` legítimo de `business_days_between`
 * como una llamada que rechazó (ver el `catch` en `computeDaysToCloseResults`).
 */
export interface DaysToCloseResult {
  loanNumber: string;
  days: number | null;
  branch: string;
  loanOfficer: string;
  processor: string;
  /** Etapa AVG-DAYS-TO-CLOSE-4: fechas exactas -- modal de detalle (Loan Number/App Date/CTC Date) y tendencia mensual por cada anclaje. Siempre pobladas (son parte del filtro de elegibilidad de `computeDaysToCloseResults`). */
  appDate: string;
  ctcDate: string;
}

/**
 * RPC calls en paralelo por tandas -- ni una por una en serie (445 llamadas
 * secuenciales sería lento) ni las 445 juntas de una (satura la conexión sin
 * necesidad). El número es arbitrario dentro de ese rango, sin medición de
 * performance detrás.
 */
const CONCURRENCY = 20;

/**
 * ============================================================================
 * DÍAS HÁBILES App → CTC, POR PRÉSTAMO — Etapa AVG-DAYS-TO-CLOSE-3
 * ============================================================================
 *
 * Único punto que llama a la RPC -- se corre UNA vez por sesión de la
 * pestaña (el caller cachea el resultado), nunca una vez por cambio de
 * selector. Antes, `buildAverageDaysToCloseByDimension` recalculaba las 445
 * llamadas cada vez que cambiaba la dimensión, porque el cálculo por
 * préstamo y el agrupamiento vivían en la misma función -- separado acá:
 * este paso es el único que hace red, `groupDaysToCloseByDimension` (más
 * abajo) es agrupamiento puro sobre lo que este paso ya devolvió.
 *
 * Población: SOLO préstamos con `appDate` + `ctcDate` pobladas y
 * `countsForDivision === true` -- la misma que reconcilió exacto en 445
 * contra la medición de Isa (457 con ambas fechas, menos 12 que no cuentan
 * para división). Cualquier otro filtro deja una población distinta a la
 * de ella, y el promedio no sería comparable.
 *
 * `businessDaysToClose()` puede rechazar (falla de red, error de la RPC) --
 * se atrapa ACÁ, por préstamo, y se registra explícito con
 * `console.error` (nunca en silencio): ese préstamo entra igual al array
 * devuelto (con `days: null`), mismo tratamiento que un `null` legítimo de
 * la RPC -- lo agrupa `groupDaysToCloseByDimension` sin distinguir el
 * motivo.
 */
export async function computeDaysToCloseResults(records: LoanRecord[]): Promise<DaysToCloseResult[]> {
  const eligible = records.filter(
    (r) => r.appDate !== null && r.ctcDate !== null && r.countsForDivision === true
  );

  const results: DaysToCloseResult[] = [];
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const chunk = eligible.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (record) => {
        const base = {
          loanNumber: record.loanNumber,
          branch: record.branch,
          loanOfficer: record.loanOfficer,
          processor: record.loanProcessorName,
          appDate: record.appDate as string,
          ctcDate: record.ctcDate as string,
        };

        try {
          const days = await businessDaysToClose(record.appDate as string, record.ctcDate as string);
          return { ...base, days };
        } catch (err) {
          console.error(
            `[computeDaysToCloseResults] business_days_between falló para el préstamo ${record.loanNumber} (${record.appDate} -> ${record.ctcDate}):`,
            err
          );
          return { ...base, days: null };
        }
      })
    );
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Exportada -- Etapa AVG-DAYS-TO-CLOSE-4: el modal de detalle (`DaysToCloseTrends.tsx`)
 * filtra `results` por el mismo criterio que agrupó la tabla (`grupo clickeado
 * === dimensionLabel(result, dimension)`), para que "suma de préstamos del
 * modal" y "n de la fila" sean, por construcción, el mismo número -- nunca dos
 * implementaciones del mismo criterio que puedan divergir.
 */
export function dimensionLabel(result: DaysToCloseResult, dimension: AverageDaysToCloseDimension): string {
  if (dimension === 'branch') return result.branch;
  if (dimension === 'loanOfficer') return result.loanOfficer;
  return result.processor;
}

/**
 * Mediana de un array de días hábiles (ya sabido no-vacío por el caller) --
 * ordena una COPIA (nunca muta `values`, que en `groupDaysToCloseByDimension`
 * es el array acumulado del grupo) y promedia los 2 valores centrales si la
 * cantidad es par, mismo criterio estándar de "mediana" en cualquier lado.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * ============================================================================
 * AGRUPAMIENTO PURO, SOBRE RESULTADOS YA CALCULADOS — Etapa AVG-DAYS-TO-CLOSE-3/5
 * ============================================================================
 *
 * Sin `async`, sin RPC, sin `await` -- toma lo que ya devolvió
 * `computeDaysToCloseResults()` (una sola vez) y lo reagrupa por la
 * dimensión pedida. Cambiar de Branch a Loan Officer es esta función sola,
 * instantánea, sin ninguna llamada de red nueva.
 *
 * Orden por defecto: ASCENDENTE por `avgBusinessDays` -- quien cierra más
 * rápido primero. Los grupos sin ningún resultado resuelto
 * (`avgBusinessDays === null`) van al final, no al principio -- `null` no es
 * "el más rápido", es "no se pudo calcular". La mediana no participa del
 * orden -- se agrega como columna, el criterio de orden sigue siendo Avg.
 */
export function groupDaysToCloseByDimension(
  results: DaysToCloseResult[],
  dimension: AverageDaysToCloseDimension
): AverageDaysToCloseGroup[] {
  const byLabel = new Map<string, { sum: number; resolvedCount: number; n: number; min: number; max: number; days: number[] }>();
  for (const result of results) {
    const label = dimensionLabel(result, dimension);
    const cur = byLabel.get(label) ?? { sum: 0, resolvedCount: 0, n: 0, min: Infinity, max: -Infinity, days: [] };
    cur.n += 1;
    if (result.days !== null) {
      cur.sum += result.days;
      cur.resolvedCount += 1;
      cur.days.push(result.days);
      if (result.days < cur.min) cur.min = result.days;
      if (result.days > cur.max) cur.max = result.days;
    }
    byLabel.set(label, cur);
  }

  return [...byLabel.entries()]
    .map(([label, { sum, resolvedCount, n, min, max, days }]) => ({
      label,
      n,
      avgBusinessDays: resolvedCount > 0 ? sum / resolvedCount : null,
      medianBusinessDays: resolvedCount > 0 ? median(days) : null,
      minBusinessDays: resolvedCount > 0 ? min : null,
      maxBusinessDays: resolvedCount > 0 ? max : null,
    }))
    .sort((a, b) => {
      if (a.avgBusinessDays === null && b.avgBusinessDays === null) return a.label.localeCompare(b.label);
      if (a.avgBusinessDays === null) return 1;
      if (b.avgBusinessDays === null) return -1;
      return a.avgBusinessDays - b.avgBusinessDays || a.label.localeCompare(b.label);
    });
}

export interface DaysToCloseHistogramBucket {
  /** Día de arranque del bucket (0, 10, 20, ...) -- `-1` para el bucket especial "Unresolved". */
  bucketStart: number;
  label: string;
  count: number;
}

/**
 * ============================================================================
 * DISTRIBUCIÓN (HISTOGRAMA), FIJA — Etapa AVG-DAYS-TO-CLOSE-4
 * ============================================================================
 *
 * Sobre los 445 completos, SIN filtrar por dimensión -- a diferencia de
 * `groupDaysToCloseByDimension`, esta función no recibe `dimension`: es la
 * misma distribución sin importar qué esté elegido en el selector.
 *
 * Buckets de 10 días hábiles desde 0 (0-9, 10-19, ...) -- el número de
 * buckets se deriva del máximo real observado (`Math.max` sobre los
 * resueltos), no un tope hardcodeado, para no quedar corto si el máximo
 * sube en una carga futura.
 *
 * Un préstamo con `days === null` (RPC no resuelta) no tiene bucket de días
 * -- va a un bucket separado "Unresolved" en vez de desaparecer de la suma
 * total (mismo criterio de trazabilidad que el resto de este módulo). Sólo
 * se agrega ese bucket si hay al menos uno así (hoy: cero).
 */
export function buildDaysToCloseHistogram(results: DaysToCloseResult[]): DaysToCloseHistogramBucket[] {
  const resolved = results.filter((r) => r.days !== null);
  const unresolvedCount = results.length - resolved.length;

  const maxDays = resolved.reduce((max, r) => Math.max(max, r.days as number), 0);
  const bucketCount = Math.floor(maxDays / 10) + 1;
  const buckets: DaysToCloseHistogramBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = i * 10;
    buckets.push({ bucketStart: start, label: `${start}-${start + 9}`, count: 0 });
  }
  for (const r of resolved) {
    buckets[Math.floor((r.days as number) / 10)].count += 1;
  }
  if (unresolvedCount > 0) {
    buckets.push({ bucketStart: -1, label: 'Unresolved', count: unresolvedCount });
  }
  return buckets;
}

export interface DaysToCloseMonthlyRow {
  /** 'YYYY-MM'. */
  month: string;
  n: number;
  avgBusinessDays: number | null;
}

/**
 * ============================================================================
 * TENDENCIA MENSUAL, POR ANCLAJE — Etapa AVG-DAYS-TO-CLOSE-4
 * ============================================================================
 *
 * `dateOf` decide el anclaje (App Date o CTC Date) -- misma agregación en
 * los dos casos, sólo cambia de qué fecha sale el mes. `appDate`/`ctcDate`
 * siempre están pobladas en `DaysToCloseResult` (son parte del filtro de
 * elegibilidad), así que agrupar por mes de cualquiera de las dos cubre los
 * 445 sin excepción -- a diferencia de `avgBusinessDays`, que sí puede ser
 * `null` por préstamo dentro de cada mes.
 */
function monthlyRows(results: DaysToCloseResult[], dateOf: (r: DaysToCloseResult) => string): DaysToCloseMonthlyRow[] {
  const byMonth = new Map<string, { sum: number; resolvedCount: number; n: number }>();
  for (const r of results) {
    const month = dateOf(r).slice(0, 7);
    const cur = byMonth.get(month) ?? { sum: 0, resolvedCount: 0, n: 0 };
    cur.n += 1;
    if (r.days !== null) {
      cur.sum += r.days;
      cur.resolvedCount += 1;
    }
    byMonth.set(month, cur);
  }
  return [...byMonth.entries()]
    .map(([month, { sum, resolvedCount, n }]) => ({
      month,
      n,
      avgBusinessDays: resolvedCount > 0 ? sum / resolvedCount : null,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Tendencia mensual anclada en App Date -- cuándo se ABRIERON los préstamos que hoy tienen CTC. */
export function groupDaysToCloseByAppMonth(results: DaysToCloseResult[]): DaysToCloseMonthlyRow[] {
  return monthlyRows(results, (r) => r.appDate);
}

/** Tendencia mensual anclada en CTC Date -- cuándo LLEGARON a Clear to Close. */
export function groupDaysToCloseByCtcMonth(results: DaysToCloseResult[]): DaysToCloseMonthlyRow[] {
  return monthlyRows(results, (r) => r.ctcDate);
}
