import type {
  CurrentMonthProjection,
  MilestoneBucket,
  OpenLoan,
  PaceBand,
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
 * El detalle por canal está en `projectCurrentMonth`.
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
 *  2. BROKERED USA SU TASA PLANA, sobre el total abierto y no sobre los
 *     healthy (confirmado en BP7: el mismo préstamo tiene que proyectar lo
 *     mismo en Business Plan y en Forecast).
 *
 *  3. `cerradosALaFecha` sale de `pipeline_forecast.pipeline_resolved_loans`
 *     (funded con disbursement en el mes), no de Commercial Activity. Ver la
 *     nota en `loadData.ts`: son dos fuentes para el mismo concepto y la
 *     elección tiene que ser deliberada.
 */

/** Milestone crudo que Salesforce reporta como Clear To Close. */
const RAW_CLEAR_TO_CLOSE = 'Clear To Close';

/** Valor de `pipeline_loans.channel` para Brokered. El resto es Banked. */
const CHANNEL_BROKERED = 'Brokered';

/**
 * Proyección del mes en curso para una persona.
 *
 * ---------------------------------------------------------------------------
 * DOS MODELOS, UNO POR CANAL (etapa BP7)
 * ---------------------------------------------------------------------------
 * No es una inconsistencia: es que Forecast modela los dos canales distinto, y
 * el mismo préstamo tiene que proyectar lo mismo en los dos módulos.
 *
 *   BANKED    cascada por milestone, SOBRE LOS HEALTHY.
 *             CTC y Closing entran enteros, sin tasa -- se muestran aparte en
 *             la pantalla y aplicarles el pull-through los contaría con
 *             descuento además de contarlos dos veces.
 *
 *   BROKERED  tasa plana (`pt_brokered_flat`, 40%) SOBRE EL TOTAL ABIERTO,
 *             healthy o no. Así lo hace Forecast: la tasa plana ya absorbe la
 *             mortalidad del canal, así que filtrar healthy además la
 *             descontaría dos veces.
 *
 * En los dos casos entran sólo los préstamos que cierran ESTE mes: uno con
 * cierre estimado en septiembre no aporta a la proyección de agosto.
 *
 * `closedToDate` viene de `pipeline_resolved_loans` (ver la nota en
 * `loadData.ts`): la proyección es "lo que cerró + lo que sigue abierto" y las
 * dos mitades tienen que venir del mismo sistema.
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
  let bankedProjected = 0;
  let bankedLoans = 0;
  let brokeredLoans = 0;

  for (const loan of openLoans) {
    /*
     * `totalPipeline` y `healthyPipeline` cuentan TODO el pipeline abierto de
     * la persona, cierre cuando cierre: es lo que la pantalla muestra como
     * "Total Pipeline" y "Healthy", y sería engañoso recortarlo al mes.
     * El filtro por mes se aplica sólo a lo que aporta a la proyección.
     */
    total += 1;
    byMilestone[loan.milestone] += 1;
    if (loan.healthy) healthy += 1;

    if (loan.closeMonth !== currentMonth) continue;

    if (loan.channel === CHANNEL_BROKERED) {
      // Tasa plana sobre el total: no se filtra por healthy (ver arriba).
      brokeredLoans += 1;
      continue;
    }

    // De acá para abajo, sólo Banked y sólo healthy.
    if (!loan.healthy) continue;
    bankedLoans += 1;
    if (loan.milestone === 'Closing') {
      if (loan.rawMilestone === RAW_CLEAR_TO_CLOSE) ctc += 1;
      else closing += 1;
      bankedProjected += 1;
      continue;
    }
    bankedProjected += rates.milestone[loan.milestone];
  }

  const brokeredProjected = brokeredLoans * rates.brokeredFlat;

  return {
    closedToDate,
    totalPipeline: total,
    healthyPipeline: healthy,
    inCtc: ctc,
    inClosing: closing,
    /* Lo que aporta el pipeline, sin contar lo ya cerrado. */
    projectedFromHealthy: bankedProjected - ctc - closing + brokeredProjected,
    projectedTotal: closedToDate + bankedProjected + brokeredProjected,
    byMilestone,
    banked: { loans: bankedLoans, projected: bankedProjected },
    brokered: { loans: brokeredLoans, projected: brokeredProjected },
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

/**
 * ============================================================================
 * PROGRESS TO DATE — el ritmo prorrateado. Etapa BP29.
 * ============================================================================
 *
 * ⚠ ESTO CORRIGE UN DEFECTO REAL, no es un refinamiento.
 *
 * Hasta BP28 el acumulado del mes se comparaba contra la meta del MES ENTERO.
 * El día 2 de cada mes, entonces, casi todo el mundo fallaba: se le exigía a
 * alguien con dos días de trabajo lo mismo que a fin de mes. El veredicto del
 * módulo dependía de qué día se mirara la pantalla.
 *
 * Ahora se compara contra lo que corresponde llevar A HOY:
 *
 *     ritmo diario   = requerido del mes / 30
 *     esperado a hoy = ritmo diario * día del mes
 *
 * Con benchmark 4, File Creations requiere 20 en el mes: 20/30 = 0,67 por día,
 * y el día 14 lo esperado son 9,33. Quien lleva 11 va por encima.
 *
 * ---------------------------------------------------------------------------
 * TRES DECISIONES CERRADAS POR EL NEGOCIO
 * ---------------------------------------------------------------------------
 * 1. TREINTA DÍAS FIJOS, no los días reales del mes. Es un sesgo chico y
 *    constante -- en febrero exige de menos, en los meses de 31 de más -- y se
 *    acepta a cambio de que el número sea el mismo todo el año y no haya que
 *    explicar por qué la meta diaria cambia entre marzo y abril.
 * 2. DÍAS CORRIDOS, no hábiles. Un mes con más fines de semana pide lo mismo.
 *    Queda anotado para revisar.
 * 3. El día del mes sale del RELOJ DEL SISTEMA, y llega por parámetro: leerlo
 *    acá volvería impura esta función y no se podría probar sin viajar en el
 *    tiempo.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES BANDAS, Y POR QUÉ EL 85%
 * ---------------------------------------------------------------------------
 *     >= 100%   on track
 *     85 – 99%  watch
 *      < 85%    at risk
 *
 * El umbral del 85% no es decorativo: lo esperado es fraccionario (9,33) y lo
 * real es entero (9). Sin margen, estar en 9 cuando toca 9,33 pintaría rojo a
 * alguien que está a un tercio de unidad de la meta -- una distancia que ni
 * siquiera se puede recorrer, porque no existe un tercio de file creation.
 */
export const PACE_WATCH_THRESHOLD = 0.85;

export function paceBandOf(ratio: number | null): PaceBand | null {
  if (ratio === null) return null;
  if (ratio >= 1) return 'on_track';
  return ratio >= PACE_WATCH_THRESHOLD ? 'watch' : 'at_risk';
}

/** Treinta días fijos. Ver el punto 1 de arriba. */
export const PACE_DAYS_IN_MONTH = 30;

export function evaluateQualifier2(
  current: { fileCreations: number; creditReports: number; applications: number },
  trailingAvg: { fileCreations: number; creditReports: number; applications: number },
  benchmark: number | null,
  rates: RateSettings,
  /** Día del mes, 1-31. Llega por parámetro para que esto siga siendo puro. */
  dayOfMonth: number
): Qualifier2 {
  if (benchmark === null) {
    return { metrics: [], belowCount: 0, passes: null };
  }
  const day = Math.min(Math.max(1, Math.round(dayOfMonth)), 31);

  const build = (
    key: Qualifier2Metric['key'],
    label: string,
    rate: number,
    actual: number,
    avg: number
  ): Qualifier2Metric => {
    const required = requiredUnits(benchmark, rate);
    const dailyPace = Number.isFinite(required) ? required / PACE_DAYS_IN_MONTH : 0;
    const expectedToDate = dailyPace * day;
    /*
     * Sin nada esperado no hay ritmo que medir, y NO es "cumplió": con
     * benchmark 0 no se le pide nada a nadie, así que la banda queda en null y
     * la métrica no cuenta ni a favor ni en contra.
     */
    const paceRatio = expectedToDate > 0 ? actual / expectedToDate : null;
    return {
      key, label, rate, required, actual,
      dailyPace, dayOfMonth: day, expectedToDate, paceRatio,
      band: paceBandOf(paceRatio),
      trailingAvg: avg,
      /* Contra la meta del mes entero. Desde BP29 sólo se muestra. */
      meets: actual >= required,
    };
  };

  const metrics: Qualifier2Metric[] = [
    build('fileCreations', 'File Creations', rates.q2.fileCreations, current.fileCreations, trailingAvg.fileCreations),
    build('creditReports', 'Credit Reports', rates.q2.creditReports, current.creditReports, trailingAvg.creditReports),
    build('applications', 'Applications', rates.q2.applications, current.applications, trailingAvg.applications),
  ];

  /*
   * ⚠ EL VEREDICTO SALE DE LA BANDA, NO DE `meets`. La regla de "2 o más" no
   * cambió; lo que cambió es qué se cuenta: antes, métricas por debajo de la
   * meta del mes entero; ahora, métricas en `at_risk` según el ritmo.
   */
  const belowCount = metrics.filter((m) => m.band === 'at_risk').length;
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
