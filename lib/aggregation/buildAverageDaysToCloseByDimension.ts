import type { LoanRecord } from '@/lib/domain/types';
import { businessDaysToClose } from '@/lib/activity/businessDaysToClose';

export type AverageDaysToCloseDimension = 'branch' | 'loanOfficer' | 'processor';

export interface AverageDaysToCloseGroup {
  label: string;
  /** Préstamos elegibles de este grupo (app_date + ctcDate + countsForDivision), incluidos los que la RPC no pudo resolver. */
  n: number;
  /** Promedio SOLO sobre los préstamos del grupo con resultado no-null de la RPC. `null` si ninguno lo tuvo. */
  avgBusinessDays: number | null;
}

/**
 * RPC calls en paralelo por tandas -- ni una por una en serie (445 llamadas
 * secuenciales sería lento) ni las 445 juntas de una (satura la conexión sin
 * necesidad). El número es arbitrario dentro de ese rango, sin medición de
 * performance detrás.
 */
const CONCURRENCY = 20;

function dimensionLabel(record: LoanRecord, dimension: AverageDaysToCloseDimension): string {
  if (dimension === 'branch') return record.branch;
  if (dimension === 'loanOfficer') return record.loanOfficer;
  return record.loanProcessorName;
}

/**
 * ============================================================================
 * PROMEDIO DE DÍAS HÁBILES App → CTC, AGRUPADO — Etapa AVG-DAYS-TO-CLOSE-1
 * ============================================================================
 *
 * Población: SOLO préstamos con `appDate` + `ctcDate` pobladas y
 * `countsForDivision === true` -- la misma que reconcilió exacto en 445
 * contra la medición de Isa (457 con ambas fechas, menos 12 que no cuentan
 * para división). Cualquier otro filtro deja una población distinta a la
 * de ella, y el promedio no sería comparable.
 *
 * `businessDaysToClose()` puede rechazar (falla de red, error de la RPC) --
 * se atrapa ACÁ, por préstamo, y se registra explícito con
 * `console.error` (nunca en silencio): ese préstamo entra a `n` de su grupo
 * (es elegible, cumplía el filtro) pero no aporta al promedio, mismo
 * tratamiento que un `null` legítimo de la RPC.
 */
export async function buildAverageDaysToCloseByDimension(
  records: LoanRecord[],
  dimension: AverageDaysToCloseDimension
): Promise<AverageDaysToCloseGroup[]> {
  const eligible = records.filter(
    (r) => r.appDate !== null && r.ctcDate !== null && r.countsForDivision === true
  );

  const results: { label: string; days: number | null }[] = [];
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const chunk = eligible.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (record) => {
        const label = dimensionLabel(record, dimension);
        try {
          const days = await businessDaysToClose(record.appDate as string, record.ctcDate as string);
          return { label, days };
        } catch (err) {
          console.error(
            `[buildAverageDaysToCloseByDimension] business_days_between falló para el préstamo ${record.loanNumber} (${record.appDate} -> ${record.ctcDate}):`,
            err
          );
          return { label, days: null };
        }
      })
    );
    results.push(...chunkResults);
  }

  const byLabel = new Map<string, { sum: number; resolvedCount: number; n: number }>();
  for (const { label, days } of results) {
    const cur = byLabel.get(label) ?? { sum: 0, resolvedCount: 0, n: 0 };
    cur.n += 1;
    if (days !== null) {
      cur.sum += days;
      cur.resolvedCount += 1;
    }
    byLabel.set(label, cur);
  }

  return [...byLabel.entries()]
    .map(([label, { sum, resolvedCount, n }]) => ({
      label,
      n,
      avgBusinessDays: resolvedCount > 0 ? sum / resolvedCount : null,
    }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
