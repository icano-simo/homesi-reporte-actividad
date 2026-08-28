'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  loadOutlookData,
  projectLoanOfficer,
  projectBranch,
  yearTotal,
  type OutlookData,
  type OutlookLoanOfficer,
} from '@/lib/outlook/loadData';
import { OUTLOOK_STRATEGIES, cadenceLabel, type OutlookStrategy } from '@/lib/outlook/project';

/**
 * ============================================================================
 * OUTLOOK — VISTA 2: dentro de un branch (etapa OL1b)
 * ============================================================================
 *
 * Los Loan Officers del branch y, debajo de cada uno, sus cinco estrategias.
 * Dentro de NPPM, los realtors por nombre.
 *
 * ⚠ La jerarquía visual ES la jerarquía del cálculo:
 *
 *     realtor NPPM  →  estrategia  →  Loan Officer  →  branch
 *
 * Cada nivel es la suma del de abajo. Si una fila no da la suma de las que
 * tiene debajo, es un bug -- no hay una segunda fórmula que pueda divergir.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];

function fmt(n: number | null): string {
  if (n === null || !n) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * La regla en una línea, con lo que la vuelve legible: CUÁNDO cae el primer
 * aumento.
 *
 * ⚠ Sin eso, "25% trimestral desde septiembre" con Sep/Oct/Nov todos iguales al
 * benchmark se lee como un error de la tabla. El benchmark ES el objetivo de
 * septiembre y el primer aumento cae al cumplirse el trimestre -- en diciembre.
 */
function ruleLabel(lo: OutlookLoanOfficer, strategy: OutlookStrategy, months: string[]): string {
  const segments = lo.rulesByStrategy[strategy] ?? [];
  if (segments.length === 0) return 'sin regla';
  const steps = projectLoanOfficer(lo, months).stepsByStrategy[strategy] ?? [];
  const firstRaise = steps.find((s) => s.periods >= 1);
  const s = segments[0];
  const base = `${s.growthPct}% ${cadenceLabel(s.cadence)} desde ${monthLabel(s.fromMonth)}`;
  const extra = segments.length > 1 ? ` (+${segments.length - 1} tramo${segments.length > 2 ? 's' : ''})` : '';
  const raise = firstRaise ? ` · 1er aumento en ${monthLabel(firstRaise.month)}` : ' · sin aumento este año';
  return base + extra + raise;
}

export default function OutlookBranchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [data, setData] = useState<OutlookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadOutlookData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="hub-container"><div className="bp-empty">Could not load Outlook: {error}</div></div>;
  if (!data) return <div className="hub-container"><div className="bp-empty">Loading…</div></div>;

  const branch = data.branches.find((b) => b.branchCode === code);
  if (!branch) {
    return (
      <div className="hub-container">
        <div className="bp-empty">
          Branch {code} has no production or roster this year. <Link href="/outlook">Back to Outlook</Link>
        </div>
      </div>
    );
  }

  const months = data.remainingMonths;
  const branchProjected = projectBranch(branch, months);
  const colCount = 5 + months.length;

  function toggle(key: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="hub-container">
      <div className="page-head">
        <div>
          <div className="bp-breadcrumbs">
            <Link href="/outlook">Outlook</Link> <span>›</span> <span>{branch.branchCode}</span>
          </div>
          <h1 className="page-head__title">Branch {branch.branchCode}</h1>
          <p className="page-head__subtitle">
            {branch.loanOfficers.length} loan officer{branch.loanOfficers.length === 1 ? '' : 's'} · YTD {branch.ytd}
            {branch.unattributed > 0 ? ` (+${branch.unattributed} sin atribuir)` : ''} · year total{' '}
            {fmt(yearTotal(branch.ytd, branch.currentMonth, branchProjected))}
          </p>
        </div>
      </div>

      <div className="tbl-scroll">
        <table className="piv bp-table--los">
          <thead>
            <tr className="mo-row">
              <th className="lbl">Loan Officer / Strategy</th>
              <th className="bp-center">YTD</th>
              <th className="bp-center">{monthLabel(data.currentMonth)}</th>
              <th className="bp-center">Benchmark</th>
              {months.map((m) => (
                <th key={m} className="bp-center">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="lbl">Rule / Funnel</th>
            </tr>
          </thead>
          <tbody>
            {branch.loanOfficers.map((lo) => {
              const { byMonth, stepsByStrategy } = projectLoanOfficer(lo, months);
              const isOpen = open.has(lo.employeeKey);
              /* El mes actual se carga al branch del roster -- ver primaryBranch. */
              const currentHere = lo.primaryBranch === branch.branchCode ? lo.currentMonth : 0;
              const projectedHere = lo.primaryBranch === branch.branchCode ? byMonth : {};

              return (
                <>
                  <tr key={lo.employeeKey} className="grp togg d1" onClick={() => toggle(lo.employeeKey)}>
                    <td className="lbl">
                      <span className={'chev' + (isOpen ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      {lo.fullName}
                    </td>
                    <td className="bp-center">{fmt(lo.ytd)}</td>
                    <td
                      className={'bp-center' + (currentHere ? '' : ' zero')}
                      title={
                        lo.primaryBranch === branch.branchCode
                          ? undefined
                          : `Su proyección se carga al branch ${lo.primaryBranch ?? '(sin roster)'}, el de su roster.`
                      }
                    >
                      {fmt(currentHere)}
                    </td>
                    <td className="bp-center" title="Suma de los benchmarks de sus cinco estrategias. Calculado, no editable.">
                      {fmt(lo.benchmarkTotal)}
                    </td>
                    {months.map((m) => (
                      <td key={m} className={'bp-center' + (projectedHere[m] ? '' : ' zero')}>
                        {fmt(projectedHere[m] ?? 0)}
                      </td>
                    ))}
                    <td className="lbl">
                      {lo.activePlan ? (
                        <span
                          className="bp-plan-chip"
                          title={`${lo.activePlan.funnelName} · ${lo.activePlan.doneMilestones} de ${lo.activePlan.totalMilestones} etapas`}
                        >
                          {lo.activePlan.funnelName} ·{' '}
                          {Math.round(
                            (lo.activePlan.doneMilestones / Math.max(1, lo.activePlan.totalMilestones)) * 100
                          )}
                          %
                        </span>
                      ) : (
                        <span className="bp-muted">sin funnel</span>
                      )}
                    </td>
                  </tr>

                  {isOpen &&
                    OUTLOOK_STRATEGIES.map((s) => {
                      const st = lo.strategies.find((x) => x.strategy === s);
                      const steps = stepsByStrategy[s] ?? [];
                      const bench = lo.strategyBenchmarks[s] ?? 0;
                      return (
                        <>
                          <tr key={lo.employeeKey + '-' + s} className="metric mrow">
                            <td className="lbl" style={{ paddingLeft: '30px' }}>
                              {s}
                              {s === 'Own Production' && (
                                <span
                                  className="bp-muted"
                                  style={{ fontSize: '10px', marginLeft: '6px' }}
                                  title="Su benchmark se lee de org.employee_benchmark y se edita en el perfil del Business Plan, no acá."
                                >
                                  (benchmark del Business Plan)
                                </span>
                              )}
                            </td>
                            <td className={'bp-center' + (st?.ytd ? '' : ' zero')}>{fmt(st?.ytd ?? 0)}</td>
                            {/*
                              ⚠ El mes actual NO se puede abrir por estrategia:
                              sale de la proyección de Forecast, que se calcula
                              sobre el snapshot del pipeline y no lleva la
                              estrategia consigo. Repartirlo por peso del YTD
                              sería inventar un número, así que dice '—'.
                            */}
                            <td
                              className="bp-center zero"
                              title="Forecast proyecta el mes sobre el pipeline, que no trae la estrategia. Repartir el total por estrategia sería inventarlo."
                            >
                              —
                            </td>
                            <td className={'bp-center' + (bench ? '' : ' zero')}>{fmt(bench)}</td>
                            {months.map((m, i) => (
                              <td
                                key={m}
                                className={'bp-center' + (steps[i]?.value ? '' : ' zero')}
                                title={steps[i]?.explain}
                              >
                                {fmt(steps[i]?.value ?? 0)}
                              </td>
                            ))}
                            <td className="lbl" style={{ fontSize: '11px' }}>
                              {ruleLabel(lo, s, months)}
                            </td>
                          </tr>

                          {/* Los realtors NPPM, por nombre, con su propio benchmark. */}
                          {s === 'NPPM' &&
                            (st?.byRealtor ?? []).map((r) => (
                              <tr key={lo.employeeKey + '-nppm-' + r.realtor} className="metric drow">
                                <td className="lbl" style={{ paddingLeft: '52px' }}>
                                  {r.realtor}
                                </td>
                                <td className="bp-center">{fmt(r.ytd)}</td>
                                <td className="bp-center zero">—</td>
                                <td
                                  className={'bp-center' + (r.benchmark ? '' : ' zero')}
                                  title="Benchmark del realtor, no del par realtor–loan officer: el mismo realtor trabaja con varias personas y branches."
                                >
                                  {fmt(r.benchmark)}
                                </td>
                                {months.map((m) => (
                                  <td key={m} className="bp-center zero">
                                    —
                                  </td>
                                ))}
                                <td className="lbl bp-muted" style={{ fontSize: '11px' }}>
                                  su producción ya está contada en NPPM
                                </td>
                              </tr>
                            ))}
                        </>
                      );
                    })}
                </>
              );
            })}

            <tr className="metric" style={{ fontWeight: 700 }}>
              <td className="lbl">Branch {branch.branchCode}</td>
              <td className="bp-center">{fmt(branch.ytd)}</td>
              <td className="bp-center">{fmt(branch.currentMonth)}</td>
              <td className="bp-center">–</td>
              {months.map((m) => (
                <td key={m} className="bp-center">
                  {fmt(branchProjected[m] ?? 0)}
                </td>
              ))}
              <td className="lbl"></td>
            </tr>
            {!branch.loanOfficers.length && (
              <tr>
                <td className="lbl bp-empty-cell" colSpan={colCount}>
                  No loan officers in this branch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="foot-note" style={{ marginTop: '14px' }}>
        <b>La jerarquía es el cálculo</b>: un realtor NPPM suma a la estrategia NPPM, que suma al Loan Officer, que suma
        al branch. La producción de un realtor <b>no se cuenta dos veces</b> — su fila es el detalle de la de NPPM, no un
        agregado aparte.{' '}
        <b>El benchmark del Loan Officer</b> es la suma de sus cinco estrategias: calculado, no editable. El de{' '}
        <b>Own Production</b> se lee de <code>org.employee_benchmark</code> y se sigue editando en el perfil del Business
        Plan.{' '}
        <b>El mes actual por estrategia</b> dice <code>—</code> porque Forecast proyecta sobre el pipeline, que no lleva
        la estrategia consigo; repartir el total por peso del YTD sería inventarlo.{' '}
        <b>Cada celda proyectada</b> trae su cuenta completa en el tooltip: benchmark, regla que aplicó, períodos y
        resultado.
      </div>
    </div>
  );
}
