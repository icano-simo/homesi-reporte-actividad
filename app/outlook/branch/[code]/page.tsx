'use client';

import { Fragment, use, useCallback, useEffect, useState } from 'react';
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
import StrategyEditor from '@/app/outlook/components/StrategyEditor';
import NppmEditor from '@/app/outlook/components/NppmEditor';

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
 *
 * ---------------------------------------------------------------------------
 * ETAPA OL2 — acá se DECIDE, no sólo se mira
 * ---------------------------------------------------------------------------
 * Cada fila de estrategia abre su editor (benchmark + regla de crecimiento) y
 * cada fila de realtor abre el suyo. La edición vive donde está el número que
 * cambia, no en una pantalla de configuración aparte: quien mira una proyección
 * en cero y quiere arreglarla ya está en la fila correcta.
 *
 * ⚠ Al guardar se RECARGA todo con `loadOutlookData`, no se parchea el estado en
 * memoria. Es más lento y es a propósito: lo que queda en la pantalla es lo que
 * la base devuelve, así que un guardado que no tuvo el efecto esperado se ve
 * acá y no en el próximo refresh de alguien más.
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

  /* Qué se está editando: (persona, estrategia) o (realtor). Nunca los dos. */
  const [editing, setEditing] = useState<{ employeeKey: number; strategy: OutlookStrategy } | null>(null);
  const [editingNppm, setEditingNppm] = useState<{ realtor: string; ytd: number } | null>(null);

  /*
   * Recargar todo después de guardar. No hay `cancelled` acá a propósito: esto
   * corre por una acción del usuario que ya vio el guardado, no en el montaje.
   */
  const reload = useCallback(
    () =>
      loadOutlookData()
        .then(setData)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    []
  );

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
  /* Nadie con este branch en su roster: tiene cerrados y no proyecta. Ver vista 1. */
  const projectsNothing = !branch.loanOfficers.some((l) => l.primaryBranch === branch.branchCode);
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

              /*
                ⚠ La `key` va en el FRAGMENT, no en el primer <tr>.
                Cada Loan Officer rinde varias filas hermanas --la suya, cinco de
                estrategia y las de realtors-- y React necesita la key en el
                elemento que devuelve el `map`. Con `<>` no se le puede poner, y
                por eso hay `Fragment` explícito: la versión anterior dejaba un
                warning de keys duplicadas en consola y, peor, permitía que React
                reusara el estado de una fila para otra al reordenarse la tabla.
              */
              return (
                <Fragment key={lo.employeeKey}>
                  <tr className="grp togg d1" onClick={() => toggle(lo.employeeKey)}>
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
                        <Fragment key={lo.employeeKey + '-' + s}>
                          <tr className="metric mrow">
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
                            {/*
                              El benchmark se edita desde la celda del benchmark
                              y la regla desde la celda de la regla. Las dos
                              abren el mismo editor: son una sola decisión --
                              cuánto es la base y cuánto crece-- y verlas juntas
                              es lo que evita guardar una sin mirar la otra.
                            */}
                            <td className={'bp-center' + (bench ? '' : ' zero')}>
                              {fmt(bench)}
                              <button
                                type="button"
                                className="ol-edit"
                                onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                                title={
                                  s === 'Own Production'
                                    ? 'Su benchmark se edita en el Business Plan. Acá se edita su regla de crecimiento.'
                                    : `Fijar el benchmark de ${s} y su regla de crecimiento`
                                }
                              >
                                editar
                              </button>
                            </td>
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
                              <button
                                type="button"
                                className="bp-linkish"
                                style={{ fontSize: '11px', textAlign: 'left' }}
                                onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                              >
                                {ruleLabel(lo, s, months)}
                              </button>
                              <span className="bp-muted" style={{ fontSize: '10px', marginLeft: '6px' }}>
                                rev {lo.ruleRevision[s] || '—'}
                              </span>
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
                                  <button
                                    type="button"
                                    className="ol-edit"
                                    onClick={() => setEditingNppm({ realtor: r.realtor, ytd: r.ytd })}
                                    title={`Fijar el benchmark de ${r.realtor}`}
                                  >
                                    editar
                                  </button>
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
                        </Fragment>
                      );
                    })}
                </Fragment>
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

      {/*
        Igual que en la vista 1: se EXPLICA, no se calcula distinto. Una fila con
        cerrados y proyección en cero, sin texto, se reporta como bug.
      */}
      {projectsNothing && branch.ytd > 0 && (
        <div className="bp-notice" style={{ marginTop: '14px' }}>
          <b>{branch.branchCode} no proyecta.</b> Sus {branch.ytd} cerrados del año son reales, pero ningún Loan Officer
          tiene este branch en su roster — y la proyección se carga al branch del roster de cada persona, porque es un
          número por persona y no por préstamo. <b>A quién pertenece este presupuesto está pendiente de definir.</b>
        </div>
      )}

      {/*
        Los editores. Se busca la persona en `branch.loanOfficers` en cada render
        y no se guarda el objeto en el estado: después de un guardado, `reload`
        reemplaza `data` entera, y un objeto guardado apuntaría a la versión
        vieja -- el editor seguiría mostrando el benchmark anterior al que se
        acaba de escribir, que es exactamente el bug que uno no revisa.
      */}
      {editing &&
        (() => {
          const lo = branch.loanOfficers.find((l) => l.employeeKey === editing.employeeKey);
          if (!lo) return null;
          return (
            <StrategyEditor
              lo={lo}
              strategy={editing.strategy}
              data={data}
              onClose={() => setEditing(null)}
              onSaved={reload}
            />
          );
        })()}

      {editingNppm && (
        <NppmEditor
          realtor={editingNppm.realtor}
          ytd={editingNppm.ytd}
          data={data}
          onClose={() => setEditingNppm(null)}
          onSaved={reload}
        />
      )}

      <div className="foot-note" style={{ marginTop: '14px' }}>
        <b>La jerarquía es el cálculo</b>: un realtor NPPM suma a la estrategia NPPM, que suma al Loan Officer, que suma
        al branch. La producción de un realtor <b>no se cuenta dos veces</b> — su fila es el detalle de la de NPPM, no un
        agregado aparte.{' '}
        <b>El benchmark del Loan Officer</b> es la suma de sus cinco estrategias: calculado, no editable. El de{' '}
        <b>Own Production</b> se lee de <code>org.employee_benchmark</code> y se sigue editando en el perfil del Business
        Plan.{' '}
        <b>El mes actual por estrategia</b> dice <code>—</code> porque Forecast proyecta sobre el pipeline, que no lleva
        la estrategia consigo; repartir el total por peso del YTD sería inventar un número que parece dato. Queda como
        etapa propia: <code>pipeline_loans</code> guarda los cinco crudos desde F6b y{' '}
        <code>lib/pipeline/strategy.ts</code> ya sabe clasificarlos, así que es derivable sin inventar nada.{' '}
        <b>Cada celda proyectada</b> trae su cuenta completa en el tooltip: benchmark, regla que aplicó, períodos y
        resultado.{' '}
        <b>Todo lo que se edita se agrega, nunca se reemplaza</b>: un benchmark guardado es una fila nueva y una regla
        editada es una revisión nueva, las dos firmadas y fechadas, con las anteriores enteras en el historial. Y rige{' '}
        <b>desde el mes siguiente</b> — el mes en curso ya se está midiendo contra el benchmark anterior.
      </div>
    </div>
  );
}
