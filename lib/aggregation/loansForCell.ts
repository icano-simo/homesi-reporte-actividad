import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';
import type { MetricKey } from '@/config/metrics';
import { countsIn, METRIC_MONTH_FIELD, type AggregationScope } from './metricMaps';

/**
 * ⚠ Etapa V2: para quién es la celda en la que se hizo clic.
 *
 * Se DERIVA del contexto en vez de agregarse como campo, y eso es deliberado:
 * un campo nuevo habría que setearlo en los 4 lugares que abren un drill-down
 * (PivotTable: fila Total, fila de sucursal, ítem del desglose;
 * LoanOfficerTable: fila de officer), y olvidarse en uno daría el scope
 * equivocado en silencio. Derivarlo hace imposible ese olvido.
 *
 * La condición es exacta, no una heurística: `branch: undefined` sin `drillBy`
 * lo produce ÚNICAMENTE la fila Total del pivot. Las filas de sucursal siempre
 * mandan `branch`; las de LoanOfficerTable siempre mandan `drillBy`. Si algún
 * día aparece un caller que no cumpla ninguna de las dos, va a caer en
 * 'division' -- que es el lado conservador: nunca infla un total.
 */
function scopeOf(context: DrillDownContext): AggregationScope {
  return context.branch === undefined && context.drillBy === undefined ? 'division' : 'detail';
}

/**
 * Contexto mínimo para identificar exactamente qué LoanRecord forman una
 * celda de la tabla (Drill-down, Fase 1). NO es un filtro de negocio nuevo:
 * branch/metric/month son las mismas 3 claves que ya usa buildReportTree()
 * para agrupar (byBranch + METRIC_MONTH_FIELD), y drillBy/drillName son las
 * mismas que ya usa para el desglose por Loan Officer/BD -- ver
 * lib/aggregation/buildReportTree.ts, que arma sus items con
 * `record[drillBy]` exactamente igual.
 */
export interface DrillDownContext {
  metric: MetricKey;
  month: YearMonth;
  /** undefined = todos los branches (fila Total de PivotTable, o groupBy==='loanOfficer'). */
  branch?: Branch;
  /** Solo presente si el click vino de una fila de desglose por Loan Officer/BD. */
  drillBy?: 'loanOfficer' | 'bd';
  drillName?: string;
}

/**
 * Recupera los LoanRecord individuales que forman una celda concreta.
 *
 * `records` debe venir YA filtrado por quien llama (B2B, Channel) -- mismo
 * contrato que ya exige buildReportTree/buildLoanOfficerTree (ver comentario
 * en BuildReportTreeOptions.records): este módulo no decide qué filtrar,
 * solo selecciona. `closingMonth` en particular ya viene resuelto por
 * BigQuery (incluida la regla de Disbursement Date) -- acá solo se compara
 * contra `context.month`, nunca se recalcula.
 */
export function loansForCell(records: LoanRecord[], context: DrillDownContext): LoanRecord[] {
  const field = METRIC_MONTH_FIELD[context.metric];
  const scope = scopeOf(context);
  return records.filter((record) => {
    if (record[field] !== context.month) return false;
    // Etapa V2: la misma regla que usó la celda para contar. Sin esto, hacer
    // clic en la fila Total de julio mostraría 59 préstamos en un modal
    // abierto desde una celda que dice 57.
    if (!countsIn(record, context.metric, scope)) return false;
    if (context.branch !== undefined && record.branch !== context.branch) return false;
    if (context.drillBy && context.drillName !== undefined && record[context.drillBy] !== context.drillName) {
      return false;
    }
    return true;
  });
}
