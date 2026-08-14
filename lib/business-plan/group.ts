import { evaluateQualifier1, evaluateQualifier2, combineVerdict, projectCurrentMonth } from './qualifiers';
import type { RateSettings } from './rates';
import type { LoanOfficerRow, OpenLoan, Qualifier1, Qualifier2, Verdict } from './types';

/**
 * ============================================================================
 * REVISIÓN CONJUNTA DE VARIOS LOAN OFFICERS
 * ============================================================================
 *
 * Etapa BP23 — ARCHIVO NUEVO. Funciones puras: la agregación es donde está el
 * riesgo de equivocarse, así que va separada de la pantalla y se puede probar
 * sin base ni navegador.
 *
 * ---------------------------------------------------------------------------
 * ⚠ 1. SE SUMAN LOS TOTALES. NO SE PROMEDIAN LOS PROMEDIOS.
 * ---------------------------------------------------------------------------
 * El promedio de 3 meses del grupo es `cierres totales del grupo ÷ 3`, no el
 * promedio de los promedios individuales.
 *
 * Los dos coinciden SÓLO si todos pesan igual, y nunca pesan igual. Con tres
 * personas que cerraron 12, 3 y 0 en la ventana:
 *
 *   correcto   (12 + 3 + 0) / 3 meses         = 5,00 por mes
 *   incorrecto (4,00 + 1,00 + 0,00) / 3 pers. = 1,67 por mes
 *
 * El segundo número no es "otra forma de verlo": es el promedio por persona por
 * mes, que responde una pregunta distinta de la que se está haciendo. Por eso
 * la agregación arma un mapa de cierres SUMADO y lo pasa por el MISMO
 * `evaluateQualifier1` que usa una persona sola -- no hay una segunda
 * implementación del cálculo que pueda divergir.
 *
 * ---------------------------------------------------------------------------
 * ⚠ 2. UN PRÉSTAMO COMPARTIDO SE CUENTA UNA VEZ
 * ---------------------------------------------------------------------------
 * Si dos personas del grupo aparecen en el mismo préstamo, sumar sus totales lo
 * contaría dos veces y el grupo parecería producir más de lo que produce.
 *
 * La deduplicación es por identificador de préstamo, y devuelve cuántos
 * encontró: un número que la pantalla muestra en vez de callarse. Verificado
 * contra los datos reales de hoy -- ver `dedupeOpenLoans`.
 *
 * ---------------------------------------------------------------------------
 * ⚠ 3. SIN BENCHMARK DE ALGUIEN, EL GRUPO NO ES EVALUABLE
 * ---------------------------------------------------------------------------
 * No se trata como cero. Un cero diría que a esa persona no se le pide nada, y
 * el GAP del grupo saldría mejor de lo que es. Se devuelve `null` y la pantalla
 * nombra a quién le falta.
 */

export interface GroupAggregate {
  members: LoanOfficerRow[];
  /** Cierres del grupo por mes, ya sumados. */
  closingsByMonth: Record<string, number>;
  /** Suma de los benchmarks, o `null` si a alguien le falta. */
  benchmark: number | null;
  /** Quiénes no tienen benchmark. Vacío si todos lo tienen. */
  missingBenchmark: LoanOfficerRow[];
  q1: Qualifier1;
  q2: Qualifier2;
  verdict: Verdict;
  projection: ReturnType<typeof projectCurrentMonth>;
  /** Actividad del mes en curso, sumada. */
  currentActivity: { fileCreations: number; creditReports: number; applications: number };
  /** Promedio mensual del grupo sobre los meses cerrados. */
  trailingActivityAvg: { fileCreations: number; creditReports: number; applications: number };
  /** Préstamos del pipeline que aparecían en más de un miembro. */
  sharedOpenLoans: number;
  /** Cierres del mes en curso que aparecían en más de un miembro. */
  sharedClosings: number;
}

/**
 * Préstamos abiertos del grupo, sin repetidos.
 *
 * La clave es `sourceLoanId`. Cuando viene nulo NO se puede saber si dos filas
 * son el mismo préstamo, así que se conservan las dos: perder producción real
 * por una clave faltante es peor que contar de más, y contar de más al menos se
 * nota en el total.
 */
export function dedupeOpenLoans(loans: OpenLoan[]): { loans: OpenLoan[]; duplicates: number } {
  const seen = new Set<string>();
  const out: OpenLoan[] = [];
  let duplicates = 0;
  for (const l of loans) {
    if (l.sourceLoanId === null) {
      out.push(l);
      continue;
    }
    if (seen.has(l.sourceLoanId)) {
      duplicates += 1;
      continue;
    }
    seen.add(l.sourceLoanId);
    out.push(l);
  }
  return { loans: out, duplicates };
}

/**
 * Cierres por mes del grupo.
 *
 * Se recorren las FILAS de cierre, no los conteos ya agregados, justamente para
 * poder descartar un préstamo repetido. Con los conteos no habría forma: 3 + 2
 * es 5 aunque uno de los cinco sea el mismo préstamo dos veces.
 *
 * ⚠ `loan_number` está vacío en el lote activo de Commercial Activity (se
 * empezó a persistir en BP9/BP11, después de esa carga). Sin identificador no
 * se puede deduplicar, así que hoy esta función devuelve `shared: 0` porque no
 * encuentra claves, NO porque haya comprobado que no hay repetidos. La pantalla
 * lo dice con esas palabras en vez de afirmar algo que no verificó.
 */
export function sumClosings(members: LoanOfficerRow[]): { byMonth: Record<string, number>; shared: number } {
  const byMonth: Record<string, number> = {};
  const seenByMonth = new Map<string, Set<string>>();
  let shared = 0;

  for (const lo of members) {
    for (const [month, rows] of Object.entries(lo.activity.closingsRowsByMonth)) {
      const seen = seenByMonth.get(month) ?? new Set<string>();
      seenByMonth.set(month, seen);
      for (const row of rows) {
        if (row.loanNumber) {
          if (seen.has(row.loanNumber)) {
            shared += 1;
            continue;
          }
          seen.add(row.loanNumber);
        }
        byMonth[month] = (byMonth[month] ?? 0) + 1;
      }
    }
  }

  /*
   * Red de seguridad: si un mes no tuviera filas guardadas -- `closingsRowsByMonth`
   * sólo se puebla desde el lote activo -- se cae al conteo agregado para ese
   * mes. Sin esto, un mes con conteo y sin filas desaparecería del gráfico.
   */
  for (const lo of members) {
    for (const [month, count] of Object.entries(lo.activity.closingsByMonth)) {
      if ((lo.activity.closingsRowsByMonth[month] ?? []).length === 0 && count > 0) {
        byMonth[month] = (byMonth[month] ?? 0) + count;
      }
    }
  }

  return { byMonth, shared };
}

/** Suma una métrica mensual de todos los miembros. */
function sumByMonth(members: LoanOfficerRow[], pick: (lo: LoanOfficerRow) => Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lo of members) {
    for (const [month, n] of Object.entries(pick(lo))) out[month] = (out[month] ?? 0) + n;
  }
  return out;
}

const sumOver = (rec: Record<string, number>, months: string[]) => months.reduce((a, m) => a + (rec[m] ?? 0), 0);

export function aggregateGroup(
  members: LoanOfficerRow[],
  windowMonths: string[],
  closedMonths: string[],
  thisMonth: string,
  rates: RateSettings,
  /* Día del mes, para el ritmo prorrateado del Future performance. BP29. */
  dayOfMonth: number
): GroupAggregate {
  const closings = sumClosings(members);

  /*
   * ⚠ La proyección se RECALCULA sobre los préstamos deduplicados; no se suman
   * las proyecciones individuales. Sumarlas contaría dos veces un préstamo
   * compartido, y además impediría deduplicar: una vez que la proyección es un
   * número, ya no se sabe de qué préstamos está hecha.
   */
  const { loans: openLoans, duplicates } = dedupeOpenLoans(members.flatMap((m) => m.openLoanDetail));
  const closedThisMonth = closings.byMonth[thisMonth] ?? 0;
  const projection = projectCurrentMonth(closedThisMonth, openLoans, rates, thisMonth);

  /*
   * El benchmark del grupo es la SUMA de los individuales. Si a uno le falta,
   * la suma no existe -- no es "la suma de los que hay".
   */
  const missingBenchmark = members.filter((m) => m.monthlyBenchmark === null);
  const benchmark =
    missingBenchmark.length > 0 ? null : members.reduce((a, m) => a + (m.monthlyBenchmark ?? 0), 0);

  const filesByMonth = sumByMonth(members, (lo) => lo.activity.filesByMonth);
  const creditByMonth = sumByMonth(members, (lo) => lo.activity.creditReportsByMonth);
  const appsByMonth = sumByMonth(members, (lo) => lo.activity.applicationsByMonth);

  const trailingActivityAvg = {
    fileCreations: sumOver(filesByMonth, closedMonths) / closedMonths.length,
    creditReports: sumOver(creditByMonth, closedMonths) / closedMonths.length,
    applications: sumOver(appsByMonth, closedMonths) / closedMonths.length,
  };
  const currentActivity = {
    fileCreations: filesByMonth[thisMonth] ?? 0,
    creditReports: creditByMonth[thisMonth] ?? 0,
    applications: appsByMonth[thisMonth] ?? 0,
  };

  const q1 = evaluateQualifier1(closings.byMonth, windowMonths, projection, benchmark);
  const q2 = evaluateQualifier2(currentActivity, trailingActivityAvg, benchmark, rates, dayOfMonth);

  return {
    members,
    closingsByMonth: closings.byMonth,
    benchmark,
    missingBenchmark,
    q1,
    q2,
    verdict: combineVerdict(q1, q2),
    projection,
    currentActivity,
    trailingActivityAvg,
    sharedOpenLoans: duplicates,
    sharedClosings: closings.shared,
  };
}

/** '1-25-33' -> [1, 25, 33]. Las claves viajan en la URL para poder compartir el link. */
export function parseKeys(segment: string): number[] {
  return [
    ...new Set(
      decodeURIComponent(segment)
        .split('-')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isSafeInteger(n) && n > 0)
    ),
  ];
}

export function serializeKeys(keys: number[]): string {
  return [...keys].sort((a, b) => a - b).join('-');
}
