'use client';

import { useState } from 'react';
import type { ResolvedLoan } from '@/lib/pipeline/types';
import { buildLoanProgramRanking, buildLoanTypeRanking, earliestFundedDisbursementDate, fundedLoansInRange, type RankingRow } from '@/lib/pipeline/analytics';
import {
  buildBranchScorecard,
  buildBusinessDeveloperScorecard,
  buildLoanOfficerScorecard,
  type PersonScorecardResult,
  type ScorecardRow,
} from '@/lib/pipeline/scorecards';
import { getDefaultPeriodSelection, periodDateRange, periodLabel, type PeriodSelection } from '@/lib/pipeline/period';
import PeriodSelector from './PeriodSelector';
import { useOrgRoster } from './useOrgRoster';

export interface TabAnalyticsProps {
  /** Mismo array que ya reciben PivotTable/AdverseTable -- pipeline_resolved_loans del snapshot activo, sin filtrar por canal ni por fecha todavía. */
  resolvedLoans: ResolvedLoan[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function RankingTable({
  title,
  columnLabel,
  rows,
  totalCount,
}: {
  title: string;
  columnLabel: string;
  rows: RankingRow[];
  totalCount: number;
}) {
  const rowsTotalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const rowsTotalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

  /*
   * Red de seguridad, mismo criterio que splitCtcAndClosing/aggregate.ts: el
   * ranking agrupa TODOS los loans que recibe (el vacío va a "Sin
   * programa"/"Sin tipo", nunca se descarta uno), así que la suma de sus
   * counts tiene que coincidir siempre con el total de funded del período.
   * Si no coincide, es un préstamo contado dos veces o ninguna -- se avisa en
   * dev, no se esconde.
   */
  if (process.env.NODE_ENV !== 'production' && rowsTotalCount !== totalCount) {
    console.warn(`[TabAnalytics] ${title}: rowsTotalCount (${rowsTotalCount}) no coincide con totalCount (${totalCount})`);
  }

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">
          {title} ({fmtInt(rowsTotalCount)})
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <colgroup>
            <col style={{ width: '55%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '25%' }} />
          </colgroup>
          <thead>
            <tr className="mo-row">
              <th className="lbl">{columnLabel}</th>
              <th>Count</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="metric" key={row.label}>
                <td className="lbl" style={{ textAlign: 'left' }}>
                  {row.label}
                </td>
                <td className="val">{fmtInt(row.count)}</td>
                <td className="val">{fmtAmount(row.amount)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={3}>
                  No funded loans in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="grp total">
                <td className="lbl">Total</td>
                <td className="val">{fmtInt(rowsTotalCount)}</td>
                <td className="val">{fmtAmount(rowsTotalAmount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function fmtPercent(n: number): string {
  return n.toFixed(1) + '%';
}

/**
 * Scorecard genérico (Branch / Loan Officer / Business Developer): mismas
 * columnas para los 3 -- cerrados, monto total, monto promedio, % del
 * total. `totalCount` es el universo real del scorecard (para Branch, el
 * total de funded del período; para los de persona, `resolvedCount`, no
 * `totalInput` -- los excluidos/no-mapeados/vacíos no tienen fila propia,
 * así que no deben contarse en el % de cada fila resuelta).
 */
function ScorecardTable({ title, columnLabel, rows, totalCount }: { title: string; columnLabel: string; rows: ScorecardRow[]; totalCount: number }) {
  const rowsTotalCount = rows.reduce((sum, r) => sum + r.closedCount, 0);
  const rowsTotalAmount = rows.reduce((sum, r) => sum + r.totalAmount, 0);

  if (process.env.NODE_ENV !== 'production' && rowsTotalCount !== totalCount) {
    console.warn(`[TabAnalytics] ${title}: rowsTotalCount (${rowsTotalCount}) no coincide con totalCount (${totalCount})`);
  }

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">
          {title} ({fmtInt(rowsTotalCount)})
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <colgroup>
            <col style={{ width: '34%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr className="mo-row">
              <th className="lbl">{columnLabel}</th>
              <th>Closed</th>
              <th>Total Amount</th>
              <th>Avg Amount</th>
              <th>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="metric" key={row.key}>
                <td className="lbl" style={{ textAlign: 'left' }} title={row.label}>
                  {row.label}
                </td>
                <td className="val">{fmtInt(row.closedCount)}</td>
                <td className="val">{fmtAmount(row.totalAmount)}</td>
                <td className="val">{fmtAmount(Math.round(row.avgAmount))}</td>
                <td className="val">{fmtPercent(row.percentOfTotal)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={5}>
                  No funded loans in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="grp total">
                <td className="lbl">Total</td>
                <td className="val">{fmtInt(rowsTotalCount)}</td>
                <td className="val">{fmtAmount(rowsTotalAmount)}</td>
                <td className="val">—</td>
                <td className="val">100.0%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Reconciliación explícita para los scorecards de persona (Loan Officer /
 * Business Developer): a diferencia de Branch (donde todo loan tiene
 * branch), un loan puede quedar fuera de la tabla por 3 motivos distintos
 * -- se listan los 3, con su propio conteo, para que
 * `resolved + blank + excluded + unmapped === totalInput` sea verificable
 * a ojo, no una afirmación sin respaldo.
 */
function PersonDiagnostics({ result }: { result: PersonScorecardResult }) {
  const { diagnostics } = result;
  const { totalInput, resolvedCount, blankCount, excludedCount, unmappedCount, unmappedNames } = diagnostics;
  const accounted = resolvedCount + blankCount + excludedCount + unmappedCount;
  if (process.env.NODE_ENV !== 'production' && accounted !== totalInput) {
    console.warn(`[TabAnalytics] reconciliación de persona no cuadra: resolved+blank+excluded+unmapped=${accounted}, totalInput=${totalInput}`);
  }
  if (totalInput === 0) return null;
  return (
    <p className="foot-note" style={{ marginBottom: '12px' }}>
      {fmtInt(totalInput)} loans in this scorecard&apos;s population — {fmtInt(resolvedCount)} resolved to a person
      via <code>org.employee_alias</code>
      {blankCount > 0 && <>, {fmtInt(blankCount)} with no Loan Officer/Owner recorded</>}
      {excludedCount > 0 && <>, {fmtInt(excludedCount)} excluded as known non-person entries (e.g. system integrations, via <code>org.source_name_excluded</code>)</>}
      {unmappedCount > 0 && (
        <>
          , {fmtInt(unmappedCount)} with a name not yet in <code>org.employee_alias</code> ({unmappedNames.map((u) => `${u.nameRaw} (${u.rows})`).join(', ')})
        </>
      )}
      .
    </p>
  );
}

/**
 * Tab 4 — Analytics (Etapa F7, Parte 1): selector de período + rankings de
 * Loan Program y Loan Type. Solo lectura sobre `pipeline_resolved_loans`
 * (status='funded', filtrado por `disbursementDate` -- nunca `estClosingDate`,
 * regla explícita del brief). No toca ninguna regla de cálculo existente:
 * pull-through, Healthy, Adverse y las estrategias comerciales quedan
 * idénticos -- esta pestaña es un corte nuevo e independiente sobre los
 * mismos datos ya cargados.
 */
export default function TabAnalytics({ resolvedLoans }: TabAnalyticsProps) {
  const [period, setPeriod] = useState<PeriodSelection>(() => getDefaultPeriodSelection());
  const orgRoster = useOrgRoster();

  const range = periodDateRange(period);
  const earliestDate = earliestFundedDisbursementDate(resolvedLoans);
  /*
   * "Nunca un total incompleto disfrazado de total completo": si el período
   * pedido empieza antes de la disbursementDate más antigua que existe en el
   * snapshot, lo que se muestra no es "todo el período", es solo la parte que
   * el historial realmente cubre -- se avisa explícito en vez de mostrar un
   * número que parece completo y no lo es.
   */
  const exceedsHistory = earliestDate !== null && range.startDate < earliestDate;

  const fundedInRange = fundedLoansInRange(resolvedLoans, range);
  const programRanking = buildLoanProgramRanking(fundedInRange);
  const typeRanking = buildLoanTypeRanking(fundedInRange);

  const branchScorecard = buildBranchScorecard(fundedInRange, orgRoster.knownBranchCodes);
  const loanOfficerScorecard = buildLoanOfficerScorecard(
    fundedInRange,
    orgRoster.aliasIndex,
    orgRoster.excludedIndex,
    orgRoster.employeeNameByKey
  );
  const businessDeveloperScorecard = buildBusinessDeveloperScorecard(
    fundedInRange,
    orgRoster.aliasIndex,
    orgRoster.excludedIndex,
    orgRoster.employeeNameByKey
  );

  return (
    <>
      <p className="foot-note" style={{ marginBottom: '16px' }}>
        Funded loans (Disbursement Date) grouped by Loan Program and Loan Type, for the selected period. Read-only —
        doesn&apos;t affect pull-through, Healthy, Adverse, or strategy calculations elsewhere in Forecast.
      </p>

      <div className="control-bar" style={{ marginBottom: '16px' }}>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {exceedsHistory && (
        <p className="pill warn" style={{ marginBottom: '16px', display: 'inline-flex' }}>
          Data only goes back to {earliestDate}. {periodLabel(period)} ({range.startDate} to {range.endDate}) extends
          earlier than that — totals below cover only {earliestDate} to {range.endDate}, not the full period
          requested.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
        <RankingTable title="Loan Program" columnLabel="Program" rows={programRanking} totalCount={fundedInRange.length} />
        <RankingTable title="Loan Type" columnLabel="Type" rows={typeRanking} totalCount={fundedInRange.length} />
      </div>

      <h3 style={{ margin: '24px 0 12px' }}>Scorecards</h3>
      <p className="foot-note" style={{ marginBottom: '16px' }}>
        Resolved against <code>org.dim_branch</code>/<code>org.employee_alias</code> (schema <code>org</code>, read-only,
        same session as the rest of the app) — names are never compared with string equality, only via the alias
        table.
      </p>

      {orgRoster.loading && <p className="foot-note">Loading org roster…</p>}
      {orgRoster.error && <p className="pill warn" style={{ display: 'inline-flex' }}>Could not load org roster: {orgRoster.error}</p>}

      {!orgRoster.loading && !orgRoster.error && (
        <>
          {branchScorecard.unresolvedBranches.length > 0 && (
            <p className="foot-note" style={{ marginBottom: '12px' }}>
              {branchScorecard.unresolvedBranches.length} branch code(s) in this period&apos;s loans are not in{' '}
              <code>org.dim_branch</code>: {branchScorecard.unresolvedBranches.join(', ')}. Still counted in the
              scorecard below, just not confirmed against the org roster.
            </p>
          )}
          <div style={{ marginBottom: '20px' }}>
            <ScorecardTable title="Branch" columnLabel="Branch" rows={branchScorecard.rows} totalCount={fundedInRange.length} />
          </div>

          <PersonDiagnostics result={loanOfficerScorecard} />
          <div style={{ marginBottom: '20px' }}>
            <ScorecardTable
              title="Loan Officer"
              columnLabel="Loan Officer"
              rows={loanOfficerScorecard.rows}
              totalCount={loanOfficerScorecard.diagnostics.resolvedCount}
            />
          </div>

          <PersonDiagnostics result={businessDeveloperScorecard} />
          <div>
            <ScorecardTable
              title="Business Developer"
              columnLabel="Business Developer"
              rows={businessDeveloperScorecard.rows}
              totalCount={businessDeveloperScorecard.diagnostics.resolvedCount}
            />
          </div>
        </>
      )}
    </>
  );
}
