import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';
import type { MetricKey } from '@/config/metrics';
import { METRIC_MONTH_FIELD } from './metricMaps';

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
 * classifyLoan() (incluida la regla de Disbursement Date) -- acá solo se
 * compara contra `context.month`, nunca se recalcula.
 */
export function loansForCell(records: LoanRecord[], context: DrillDownContext): LoanRecord[] {
  const field = METRIC_MONTH_FIELD[context.metric];
  return records.filter((record) => {
    if (record[field] !== context.month) return false;
    if (context.branch !== undefined && record.branch !== context.branch) return false;
    if (context.drillBy && context.drillName !== undefined && record[context.drillBy] !== context.drillName) {
      return false;
    }
    return true;
  });
}
