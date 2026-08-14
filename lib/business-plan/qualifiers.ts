import type {
  CurrentMonthProjection,
  MilestoneBucket,
  OpenLoan,
  Qualifier1,
  Qualifier2,
  Qualifier2Metric,
  Verdict,
} from './types';
import type { RateSettings } from './rates';

/**
 * ============================================================================
 * MOTOR DE VEREDICTO — Qualifier 1, Qualifier 2 y combinación
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO. Reemplaza al `triage.ts` que sólo sabía decir
 * "no evaluable": las reglas ya están cerradas por el negocio.
 *
 * Todo acá es función pura: entra data, sale veredicto. Sin fetch, sin fechas
 * implícitas (la fecha de referencia se pasa siempre por parámetro). Eso es lo
 * que permite verificar el motor contra números conocidos sin levantar la app.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * QUALIFIER 1 — ¿tiene el volumen?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El promedio que manda INCLUYE el mes en curso con su proyección. Con fecha
 * de agosto, la ventana es junio + julio + agosto proyectado, sobre 3.
 *
 *     proyección = cerradosALaFecha
 *                + loansEnCTC
 *                + loansEnClosing
 *                + Σ (healthy restantes × tasa acumulada de su milestone)
 *
 * A los préstamos en CTC y en Closing NO se les aplica tasa. Se muestran
 * aparte en la pantalla y aplicarles el pull-through los contaría con
 * descuento además de contarlos dos veces.
 *
 * ---------------------------------------------------------------------------
 * TRES DECISIONES QUE SE FIJARON EN BP6 (antes eran lecturas mías)
 * ---------------------------------------------------------------------------
 * Los números de referencia del negocio permitieron cerrar tres cosas que el
 * brief no decía y que yo había resuelto de otra manera:
 *
 *  1. SÓLO ENTRAN LOS QUE CIERRAN ESTE MES. Un préstamo healthy con cierre
 *     estimado en septiembre no aporta a la proyección de agosto. Antes
 *     entraban todos los healthy, lo que adelantaba producción de meses
 *     siguientes al mes en curso.
 *
 *  2. BROKERED USA LA MISMA CASCADA QUE BANKED. La tasa plana del 40% sigue
 *     existiendo en `business_plan.settings` porque es de Forecast, pero NO se
 *     aplica acá. ⚠ Vale la pena mirarlo con el negocio: para alguien con
 *     pipeline mayormente Brokered la diferencia casi duplica la proyección
 *     (Haydee Tito-Pace: 2,24 con cascada contra 1,20 con la plana).
 *
 *  3. `cerradosALaFecha` sale de `pipeline_forecast.pipeline_resolved_loans`
 *     (funded con disbursement en el mes), no de Commercial Activity. Ver la
 *     nota en `loadData.ts`: son dos fuentes para el mismo concepto y la
 *     elección tiene que ser deliberada.
 */

/** Milestone crudo que Salesforce reporta como Clear To Close. */
const RAW_CLEAR_TO_CLOSE = 'Clear To Close';

/**
 * Proyección del mes en curso para una persona.
 *
 * `closedToDate` viene de Commercial Activity (cierres con `closing_month` en
 * el mes actual), no del pipeline: es el mismo origen que las barras de los
 * meses anteriores, así que la serie del gráfico es homogénea.
 */
export function projectCurrentMonth(
  closedToDate: number,
  openLoans: OpenLoan[],
  rates: RateSettings,
  /** 'YYYY-MM' del mes que se está proyectando. */
  currentMonth: string
): CurrentMonthProjection {
  const byMilestone: Record<MilestoneBucket, number> = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };
  let total = 0;
  let healthy = 0;
  let ctc = 0;
  let closing = 0;
  let projectedFromRest = 0;

  for (const loan of openLoans) {
    /*
     * `totalPipeline` y `healthyPipeline` cuentan TODO el pipeline abierto de
     * la persona, cierre cuando cierre: es lo que la pantalla muestra como
     * "Total Pipeline" y "Healthy", y sería engañoso recortarlo al mes.
     * El filtro por mes se aplica sólo a lo que aporta a la proyección.
     */
    total += 1;
    byMilestone[loan.milestone] += 1;
    if (!loan.healthy) continue;
    healthy += 1;
    if (loan.closeMonth !== currentMonth) continue;

    if (loan.milestone === 'Closing') {
      // CTC y Closing entran enteros, sin tasa. Ver la nota de arriba.
      if (loan.rawMilestone === RAW_CLEAR_TO_CLOSE) ctc += 1;
      else closing += 1;
      continue;
    }
    /*
     * Misma cascada para Brokered y para Banked (ver decisión 2 arriba). La
     * tasa plana de `rates.brokeredFlat` queda sin usar en este cálculo, a
     * propósito: pertenece al modelo de Forecast.
     */
    projectedFromRest += rates.milestone[loan.milestone];
  }

  return {
    closedToDate,
    totalPipeline: total,
    healthyPipeline: healthy,
    inCtc: ctc,
    inClosing: closing,
    projectedFromHealthy: projectedFromRest,
    projectedTotal: closedToDate + ctc + closing + projectedFromRest,
    byMilestone,
  };
}

/**
 * Estado del GAP. Son RANGOS, no valores exactos: el promedio de 3 meses es
 * fraccionario y un GAP de exactamente −1 casi nunca ocurre.
 */
export function gapState(gap: number): Qualifier1['state'] {
  if (gap >= 0) return 'on_target';
  if (gap > -2) return 'on_risk';
  return 'need_attention';
}

export function evaluateQualifier1(
  monthlyClosings: Record<string, number>,
  windowMonths: string[],
  projection: CurrentMonthProjection,
  benchmark: number | null
): Qualifier1 {
  /*
   * `windowMonths` son los dos meses cerrados anteriores más el actual. El
   * último es el que se reemplaza por la proyección -- los otros son cierres
   * reales.
   */
  const closedPart = windowMonths.slice(0, -1).reduce((sum, m) => sum + (monthlyClosings[m] ?? 0), 0);
  const avgWithCurrent = (closedPart + projection.projectedTotal) / windowMonths.length;
  const gap = benchmark === null ? null : avgWithCurrent - benchmark;
  return {
    windowMonths,
    avgWithCurrent,
    gap,
    // Sin benchmark no hay veredicto: no se inventa un default.
    state: gap === null ? null : gapState(gap),
    passes: gap === null ? null : gap >= 0,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * QUALIFIER 2 — ¿tiene la actividad comercial?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La operación es DIVIDIR, no multiplicar:
 *
 *     requerido = ceil(benchmark / tasaDeConversión)
 *
 * Con benchmark 2:  files 2/0.20 = 10 · credit 2/0.30 = 7 · apps 2/0.667 = 3.
 * El embudo cierra: 10 → 7 → 3 → 2.
 *
 * Multiplicar daría 2 × 0.667 = 1.3 applications para lograr 2 cierres, que es
 * menos que el propio benchmark -- ese era el error del spec original.
 */

export function requiredUnits(benchmark: number, rate: number): number {
  if (rate <= 0) return Infinity;
  return Math.ceil(benchmark / rate);
}

export function evaluateQualifier2(
  current: { fileCreations: number; creditReports: number; applications: number },
  trailingAvg: { fileCreations: number; creditReports: number; applications: number },
  benchmark: number | null,
  rates: RateSettings
): Qualifier2 {
  if (benchmark === null) {
    return { metrics: [], belowCount: 0, passes: null };
  }
  const build = (
    key: Qualifier2Metric['key'],
    label: string,
    rate: number,
    actual: number,
    avg: number
  ): Qualifier2Metric => {
    const required = requiredUnits(benchmark, rate);
    return { key, label, rate, required, actual, trailingAvg: avg, meets: actual >= required };
  };

  const metrics: Qualifier2Metric[] = [
    build('fileCreations', 'File Creations', rates.q2.fileCreations, current.fileCreations, trailingAvg.fileCreations),
    build('creditReports', 'Credit Reports', rates.q2.creditReports, current.creditReports, trailingAvg.creditReports),
    build('applications', 'Applications', rates.q2.applications, current.applications, trailingAvg.applications),
  ];

  const belowCount = metrics.filter((m) => !m.meets).length;
  // Una sola métrica por debajo no lo tumba; dos o más sí.
  return { metrics, belowCount, passes: belowCount < 2 };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * VEREDICTO COMBINADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Q1 falla + Q2 falla -> On Risk   (Business Plan obligatorio)
 *   Q1 falla + Q2 pasa  -> Watch     (sugerido)
 *   Q1 pasa  + Q2 falla -> Watch     (sugerido)
 *   Q1 pasa  + Q2 pasa  -> On Track
 *
 * "Falla" en Qualifier 1 significa On Risk o Need Attention, o sea GAP < 0.
 */
export function combineVerdict(q1: Qualifier1, q2: Qualifier2): Verdict {
  if (q1.passes === null || q2.passes === null) return 'not_evaluable';
  if (!q1.passes && !q2.passes) return 'on_risk';
  if (q1.passes && q2.passes) return 'on_track';
  return 'watch';
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  on_track: 'On Track',
  watch: 'Watch',
  on_risk: 'On Risk',
  not_evaluable: '—',
};

export const VERDICT_CLASS: Record<Verdict, string> = {
  on_track: 'badge badge--pill badge--emerald',
  watch: 'badge badge--pill badge--amber',
  on_risk: 'badge badge--pill badge--rose',
  not_evaluable: 'bp-muted',
};

export const GAP_STATE_LABEL: Record<NonNullable<Qualifier1['state']>, string> = {
  on_target: 'On Target',
  on_risk: 'On Risk',
  need_attention: 'Need Attention',
};

/** Clase de color del número del GAP, según su estado. */
export const GAP_STATE_CLASS: Record<NonNullable<Qualifier1['state']>, string> = {
  on_target: 'bp-gap--ok',
  on_risk: 'bp-gap--warn',
  need_attention: 'bp-gap--risk',
};
