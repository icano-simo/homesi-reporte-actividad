'use client';

import { Fragment, use, useState } from 'react';
import Link from 'next/link';
import {
  composeYear,
  projectLoanOfficer,
  projectBranch,
  type OutlookLoanOfficer,
} from '@/lib/outlook/loadData';
import { OUTLOOK_STRATEGIES, cadenceLabel, type OutlookStrategy } from '@/lib/outlook/project';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';
import StrategyEditor from '@/app/outlook/components/StrategyEditor';
import NppmEditor from '@/app/outlook/components/NppmEditor';

/**
 * ============================================================================
 * OUTLOOK — VISTA 2: dentro de un branch (etapas OL1b, OL2 y OL3)
 * ============================================================================
 *
 * Los Loan Officers del branch y, debajo de cada uno, sus cinco estrategias.
 * Dentro de NPPM, los realtors por nombre. Por columna, los doce meses del año.
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
 *
 * ---------------------------------------------------------------------------
 * ETAPA OL3 — los doce meses, y LA ÚNICA FILA QUE NO CIERRA
 * ---------------------------------------------------------------------------
 * Las tres bandas (real · pronóstico · presupuesto) son las mismas que en la
 * vista 1 y se rotulan igual.
 *
 * ⚠ El total de un Loan Officer NO da la suma de sus cinco estrategias, y la
 * diferencia es exactamente el pronóstico del mes en curso: Forecast lo calcula
 * sobre el pipeline, que no lleva la estrategia consigo, así que las estrategias
 * tienen ese mes en `—` y su total no lo incluye.
 *
 * Es la única excepción a "cada nivel es la suma del de abajo" en todo el
 * módulo, y está dicha en la pantalla --en el tooltip del total y en la nota al
 * pie-- porque una jerarquía que casi siempre cierra y una vez no, sin
 * explicación, se reporta como bug. Se cierra el día que el mes en curso se
 * pueda abrir por estrategia (ver la etapa pendiente en `project.ts`).
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];

/** `—` no se puede saber · `–` cero · el número. */
function fmt(n: number | null): string {
  if (n === null) return '—';
  if (!n) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
}

/**
 * Cómo se está fijando esta estrategia, en una línea.
 *
 * ⚠ Dice el MODO primero, porque es lo que decide si el resto de la línea
 * significa algo — etapa OL4. Una regla de crecimiento en una estrategia fijada
 * mes a mes está guardada y no se aplica, y mostrarla sin decirlo haría pensar
 * que los meses salieron de ella.
 *
 * En modo `growth` la línea lleva CUÁNDO cae el primer aumento: sin eso, "25%
 * trimestral desde septiembre" con Sep/Oct/Nov todos iguales al benchmark se lee
 * como un error de la tabla. El benchmark ES el objetivo de septiembre y el
 * primer aumento cae al cumplirse el trimestre -- en diciembre.
 */
function ruleLabel(lo: OutlookLoanOfficer, strategy: OutlookStrategy, months: string[]): string {
  if ((lo.modeByStrategy[strategy] ?? 'growth') === 'monthly') {
    const rev = lo.targetRevision[strategy] ?? 0;
    return rev === 0 ? 'month by month · no numbers set' : 'month by month · numbers set by hand';
  }
  const segments = lo.rulesByStrategy[strategy] ?? [];
  if (segments.length === 0) return 'no rule';
  const steps = projectLoanOfficer(lo, months).stepsByStrategy[strategy] ?? [];
  const firstRaise = steps.find((s) => s.periods >= 1);
  const s = segments[0];
  const base = `${s.growthPct}% ${cadenceLabel(s.cadence)} from ${monthLabel(s.fromMonth)}`;
  const extra = segments.length > 1 ? ` (+${segments.length - 1} segment${segments.length > 2 ? 's' : ''})` : '';
  const raise = firstRaise ? ` · 1st raise in ${monthLabel(firstRaise.month)}` : ' · no raise this year';
  return base + extra + raise;
}

export default function OutlookBranchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  /*
   * Del contexto del layout, igual que la vista 1 -- una sola carga.
   *
   * `reload` sale del mismo contexto: tira el caché de módulo y vuelve a
   * cargar, así que después de guardar las DOS vistas ven el dato nuevo. Antes
   * cada pantalla tenía su propio `loadOutlookData`, y guardar en la vista 2
   * dejaba la vista 1 con la proyección vieja hasta recargar la pestaña.
   *
   * Un error de la recarga llega por `error` del contexto: no hace falta un
   * segundo estado de error acá.
   */
  const { data, error, reload } = useOutlookDataContext();
  const [open, setOpen] = useState<Set<number>>(new Set());

  /* Qué se está editando: (persona, estrategia) o (realtor). Nunca los dos. */
  const [editing, setEditing] = useState<{ employeeKey: number; strategy: OutlookStrategy } | null>(null);
  const [editingNppm, setEditingNppm] = useState<{ realtor: string; ytd: number } | null>(null);


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

  const { monthsOfYear, actualMonths, currentMonth, remainingMonths } = data;
  const year = currentMonth.split('-')[0];
  /* Nadie con este branch en su roster: tiene cerrados y no proyecta. Ver vista 1. */
  const projectsNothing = !branch.loanOfficers.some((l) => l.primaryBranch === branch.branchCode);
  /*
   * ⚠ El mes en curso: el pronóstico, o lo cerrado del mes cuando no hay ninguno.
   *
   * Misma regla que la vista 1, y por el mismo motivo: el pronóstico se atribuye
   * por roster y lo cerrado por préstamo, así que un branch sin nadie
   * rosterizado tiene pronóstico 0 -- y sus cierres reales del mes se perderían.
   * Medido en AFFINITY: 5 cerrados en agosto que la primera versión no mostraba.
   */
  const branchCurrent = projectsNothing ? (branch.actualByMonth[currentMonth] ?? 0) : branch.currentMonth;
  const branchYear = composeYear(
    monthsOfYear,
    currentMonth,
    branch.actualByMonth,
    branchCurrent,
    projectBranch(branch, remainingMonths)
  );
  /* nombre + doce meses + total + benchmark + regla */
  const colCount = monthsOfYear.length + 4;

  function toggle(key: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="hub-container ol-page">
      <div className="page-head">
        <div>
          <div className="bp-breadcrumbs">
            <Link href="/outlook">Outlook</Link> <span>›</span> <span>{branch.branchCode}</span>
          </div>
          <h1 className="page-head__title">Branch {branch.branchCode}</h1>
          <p className="page-head__subtitle">
            {branch.loanOfficers.length} loan officer{branch.loanOfficers.length === 1 ? '' : 's'} · closed {branch.ytd}
            {branch.unattributed > 0 ? ` (+${branch.unattributed} unattributed)` : ''} · {year} total{' '}
            {fmt(branchYear.total)}
          </p>
        </div>
      </div>

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            <tr className="yr-row">
              <th className="lbl"></th>
              {actualMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--actual" colSpan={actualMonths.length}>
                  Actual — closed
                </th>
              )}
              <th className="bp-center ol-band ol-band--forecast">Forecast</th>
              {remainingMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--budget" colSpan={remainingMonths.length}>
                  Budget
                </th>
              )}
              <th className="bp-center"></th>
              <th className="bp-center ol-band ol-band--decide" colSpan={2}>
                Decision
              </th>
            </tr>
            <tr className="mo-row">
              <th className="lbl">Loan Officer / Strategy</th>
              {monthsOfYear.map((m) => (
                <th key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center totcol">{year}</th>
              <th className="bp-center">Benchmark</th>
              <th className="lbl">Rule / Funnel</th>
            </tr>
          </thead>
          <tbody>
            {branch.loanOfficers.map((lo) => {
              const { byMonth, stepsByStrategy } = projectLoanOfficer(lo, remainingMonths);
              const isOpen = open.has(lo.employeeKey);
              /* El mes actual y la proyección se cargan al branch del roster. */
              const here = lo.primaryBranch === branch.branchCode;
              /*
               * Quien no tiene este branch en su roster no aporta pronóstico
               * acá, pero sus cerrados del mes en este branch son reales: se
               * muestran, con la misma regla que el branch. Ver el bloque de la
               * celda del mes en curso más arriba.
               */
              const loCurrent = here ? lo.currentMonth : (lo.actualByMonth[currentMonth] ?? 0);
              const loYear = composeYear(monthsOfYear, currentMonth, lo.actualByMonth, loCurrent, here ? byMonth : {});
              /*
                La suma de las cinco estrategias, sólo para poder EXPLICAR la
                diferencia con el total de la persona. No se muestra como
                número propio: sería un tercer total en la misma fila.
              */
              /* Las que están fijadas mes a mes, para explicar el benchmark. */
              const monthlyStrategies = OUTLOOK_STRATEGIES.filter(
                (s) => (lo.modeByStrategy[s] ?? 'growth') === 'monthly'
              );
              const strategiesTotal = OUTLOOK_STRATEGIES.reduce((acc, s) => {
                const st = lo.strategies.find((x) => x.strategy === s);
                const steps = stepsByStrategy[s] ?? [];
                const proj: Record<string, number | null> = {};
                remainingMonths.forEach((m, i) => (proj[m] = here ? (steps[i]?.value ?? 0) : 0));
                return acc + composeYear(monthsOfYear, currentMonth, st?.actualByMonth ?? {}, null, proj).total;
              }, 0);

              return (
                /*
                  ⚠ La `key` va en el FRAGMENT, no en el primer <tr>.
                  Cada Loan Officer rinde varias filas hermanas --la suya, cinco
                  de estrategia y las de realtors-- y React necesita la key en el
                  elemento que devuelve el `map`.
                */
                <Fragment key={lo.employeeKey}>
                  <tr className="grp togg d1" onClick={() => toggle(lo.employeeKey)}>
                    <td className="lbl">
                      <span className={'chev' + (isOpen ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      {lo.fullName}
                      {/*
                        ⚠ EL ROTULO DICE EL ESTADO REAL, no "ya no produce".
                        `left` es alguien que dejo la empresa; `not producing`
                        alguien que sigue empleada y dejo de originar. Hoy los
                        dos casos existen por separado en el roster --Isabel
                        Wagner y Ludwig Aguillon son bajas-- y el dia que
                        aparezca el segundo caso el rotulo tiene que poder
                        distinguirlo. Un solo rotulo para los dos obligaria a
                        preguntarle a RRHH cual es cual.
                      */}
                      {lo.rosterState === 'left' && (
                        <span
                          className="bp-muted ol-tag"
                          title={
                            'No longer with the company, per the roster. Their closings are real and already ' +
                            'happened, which is why the row is here and why the branch total adds up. What changed ' +
                            'is that they will not produce from now on, so there is no forecast and no budget.'
                          }
                        >
                          left
                        </span>
                      )}
                      {lo.rosterState === 'not_producing' && (
                        <span
                          className="bp-muted ol-tag"
                          title={
                            'Still with the company and no longer originating, per the roster. Not the same as ' +
                            'having left: this row is here because of closings that already happened.'
                          }
                        >
                          not producing
                        </span>
                      )}
                      {lo.rosterState === 'unknown' && (
                        <span
                          className="bp-muted ol-tag"
                          title={
                            'Closed in this branch and does not appear in the roster, so there is no way to say ' +
                            'whether they still produce. The row is here because the closings are real.'
                          }
                        >
                          not in roster
                        </span>
                      )}
                      {!lo.hasIdentity && (
                        <span
                          className="bp-muted ol-tag"
                          title={
                            'The roster says they produce, but there is no person_code alias tying them to an ' +
                            'internal identity, and benchmark and plan both hang off it. Shown with name and branch ' +
                            'so the branch total keeps adding up. Someone has to create the alias.'
                          }
                        >
                          no internal identity
                        </span>
                      )}
                      {/*
                        El rol, que la tabla ya tiene y no cuesta nada mostrar.
                        Son 10 de los productores, y en `org.employee_branch`
                        tienen DOS filas --una 'LO' y una 'BM'--, que es lo que
                        hacia que un conteo ingenuo diera 44 personas en vez de 34.
                      */}
                      {lo.isBranchManager && (
                        <span className="bp-muted ol-tag" title="Manages the branch as well as producing.">
                          BM
                        </span>
                      )}
                    </td>
                    {monthsOfYear.map((m) => (
                      <td
                        key={m}
                        className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth) + (loYear.byMonth[m] ? '' : ' zero')}
                        title={
                          m === currentMonth && here
                            ? `Month forecast: ${lo.closedToDate} already closed and the rest is pipeline with its ` +
                              `rate. Closings are INSIDE this number.`
                            : m === currentMonth && !here
                              ? `Their forecast is charged to branch ${lo.primaryBranch ?? '(no roster)'}, their roster ` +
                                `branch. What is shown here is what they already closed in this branch this month.`
                              : m > currentMonth && !here
                              ? `Their forecast and budget are charged to branch ${lo.primaryBranch ?? '(no roster)'}, ` +
                                `their roster branch. Their closings do count here, because those belong to the loan.`
                              : undefined
                        }
                      >
                        {fmt(loYear.byMonth[m] ?? null)}
                      </td>
                    ))}
                    <td
                      className="bp-center totcol"
                      title={
                        `Sum of the twelve columns. Their five strategies add up to ${strategiesTotal}: the ` +
                        `difference is ${monthLabel(currentMonth)}'s forecast, which Forecast does not break down by strategy.`
                      }
                    >
                      {fmt(loYear.total)}
                    </td>
                    <td
                      className="bp-center"
                      title={
                        monthlyStrategies.length > 0
                          ? `Sum of the benchmarks of the strategies projected by growth rate. ` +
                            `${monthlyStrategies.join(', ')} ${monthlyStrategies.length === 1 ? 'is' : 'are'} set month ` +
                            `by month: those months do not come from a benchmark, so they do not add up here.`
                          : 'Sum of the benchmarks of their five strategies. Calculated, not editable.'
                      }
                    >
                      {fmt(lo.benchmarkTotal)}
                      {monthlyStrategies.length > 0 && (
                        <span className="bp-muted ol-tag">+{monthlyStrategies.length} month by month</span>
                      )}
                    </td>
                    <td className="lbl">
                      {lo.activePlan ? (
                        <span
                          className="bp-plan-chip"
                          title={`${lo.activePlan.funnelName} · ${lo.activePlan.doneMilestones} of ${lo.activePlan.totalMilestones} milestones`}
                        >
                          {lo.activePlan.funnelName} ·{' '}
                          {Math.round(
                            (lo.activePlan.doneMilestones / Math.max(1, lo.activePlan.totalMilestones)) * 100
                          )}
                          %
                        </span>
                      ) : (
                        <span className="bp-muted">no funnel</span>
                      )}
                    </td>
                  </tr>

                  {isOpen &&
                    OUTLOOK_STRATEGIES.map((s) => {
                      const st = lo.strategies.find((x) => x.strategy === s);
                      const steps = stepsByStrategy[s] ?? [];
                      const bench = lo.strategyBenchmarks[s] ?? 0;
                      const isMonthly = (lo.modeByStrategy[s] ?? 'growth') === 'monthly';
                      /*
                        ⚠ El mes en curso va en `null`, no en 0: Forecast lo
                        calcula sobre el pipeline, que no lleva la estrategia
                        consigo. Un 0 diría que esta estrategia no va a cerrar
                        nada este mes, que es una afirmación que nadie hizo.
                      */
                      const proj: Record<string, number | null> = {};
                      remainingMonths.forEach((m, i) => (proj[m] = here ? (steps[i]?.value ?? 0) : 0));
                      const sYear = composeYear(monthsOfYear, currentMonth, st?.actualByMonth ?? {}, null, proj);

                      return (
                        <Fragment key={lo.employeeKey + '-' + s}>
                          <tr className="metric mrow">
                            <td className="lbl" style={{ paddingLeft: '30px' }}>
                              {s}
                              {s === 'Own Production' && (
                                <span
                                  className="bp-muted ol-tag"
                                  title="Its benchmark is read from org.employee_benchmark and edited in the Business Plan profile, not here."
                                >
                                  BP
                                </span>
                              )}
                            </td>
                            {monthsOfYear.map((m) => (
                              <td
                                key={m}
                                className={
                                  'bp-center ol-m ol-m--' + bandOf(m, currentMonth) + (sYear.byMonth[m] ? '' : ' zero')
                                }
                                title={
                                  m === currentMonth
                                    ? 'Forecast projects the month from the pipeline, which does not carry the strategy. Splitting the total by strategy would be inventing it.'
                                    : m > currentMonth
                                      ? steps[remainingMonths.indexOf(m)]?.explain
                                      : undefined
                                }
                              >
                                {fmt(sYear.byMonth[m] ?? null)}
                              </td>
                            ))}
                            <td
                              className="bp-center totcol"
                              title={`Without ${monthLabel(currentMonth)}: the current month cannot be broken down by strategy.`}
                            >
                              {fmt(sYear.total)}
                            </td>
                            {/*
                              El benchmark se edita desde la celda del benchmark
                              y la regla desde la celda de la regla. Las dos
                              abren el mismo editor: son una sola decisión --
                              cuánto es la base y cuánto crece-- y verlas juntas
                              es lo que evita guardar una sin mirar la otra.
                            */}
                            {/*
                              El benchmark sólo significa algo en modo `growth`:
                              es la BASE de un cálculo. En modo mes a mes los
                              meses son el resultado directo, así que la celda
                              dice `—` en vez de mostrar un número guardado que
                              no está interviniendo en ninguna celda de la fila.
                            */}
                            <td className={'bp-center' + (isMonthly || !bench ? ' zero' : '')}>
                              {isMonthly ? '—' : fmt(bench)}
                              <button
                                type="button"
                                className="ol-edit"
                                onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                                title={
                                  isMonthly
                                    ? 'Set month by month: the benchmark does not take part. It stays saved in case this goes back to growth rate.'
                                    : s === 'Own Production'
                                      ? 'Its benchmark is edited in the Business Plan. What is edited here is its growth rule.'
                                      : `Set ${s}'s benchmark and its growth rule`
                                }
                              >
                                edit
                              </button>
                            </td>
                            <td className="lbl ol-rule">
                              <button
                                type="button"
                                className="bp-linkish ol-rule__btn"
                                onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                              >
                                {ruleLabel(lo, s, remainingMonths)}
                              </button>
                              <span className="bp-muted ol-tag">
                                rev {(isMonthly ? lo.targetRevision[s] : lo.ruleRevision[s]) || '—'}
                              </span>
                            </td>
                          </tr>

                          {/* Los realtors NPPM, por nombre, con su propio benchmark. */}
                          {s === 'NPPM' &&
                            (st?.byRealtor ?? []).map((r) => {
                              /*
                                Un realtor tiene meses reales y nada más: su
                                benchmark no proyecta (ver `NppmEditor`), así que
                                del mes en curso en adelante va `—` y no 0.
                              */
                              const rYear = composeYear(monthsOfYear, currentMonth, r.actualByMonth, null, {});
                              return (
                                <tr key={lo.employeeKey + '-nppm-' + r.realtor} className="metric drow">
                                  <td className="lbl" style={{ paddingLeft: '52px' }}>
                                    {r.realtor}
                                  </td>
                                  {monthsOfYear.map((m) => (
                                    <td
                                      key={m}
                                      className={
                                        'bp-center ol-m ol-m--' +
                                        bandOf(m, currentMonth) +
                                        (rYear.byMonth[m] ? '' : ' zero')
                                      }
                                    >
                                      {fmt(rYear.byMonth[m] ?? null)}
                                    </td>
                                  ))}
                                  <td className="bp-center totcol">{fmt(rYear.total)}</td>
                                  <td
                                    className={'bp-center' + (r.benchmark ? '' : ' zero')}
                                    title="The realtor's benchmark, not the realtor–loan officer pair's: the same realtor works with several people and branches."
                                  >
                                    {fmt(r.benchmark)}
                                    <button
                                      type="button"
                                      className="ol-edit"
                                      onClick={() => setEditingNppm({ realtor: r.realtor, ytd: r.ytd })}
                                      title={`Set ${r.realtor}'s benchmark`}
                                    >
                                      edit
                                    </button>
                                  </td>
                                  <td className="lbl bp-muted ol-rule">
                                    their production is already counted in NPPM
                                  </td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}

            <tr className="metric" style={{ fontWeight: 700 }}>
              <td className="lbl">Branch {branch.branchCode}</td>
              {monthsOfYear.map((m) => (
                <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {fmt(branchYear.byMonth[m] ?? null)}
                </td>
              ))}
              <td className="bp-center totcol">{fmt(branchYear.total)}</td>
              <td className="bp-center">–</td>
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
        <div className="bp-notice ol-notice">
          <b>{branch.branchCode} does not project.</b> Its {branch.ytd} closings this year are real, but no Loan Officer
          has this branch on their roster — and the projection is charged to each person&apos;s roster branch, because it is
          one number per person, not per loan. <b>Who owns this budget is still to be decided.</b>
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

      {/*
        ⚠ ACÁ HABÍA UN PÁRRAFO LARGO, Y SE FUE A PROPÓSITO — etapa OL6.
      
        Explicaba la jerarquía, la excepción del mes en curso, cómo se atribuye
        cada cosa y qué significa cada modo. Ocupaba más alto que la tabla que
        venía a explicar.
      
        Lo que decía no se perdió: vive donde se busca cuando hace falta.
          · el detalle del cálculo de cada celda, en su tooltip
          · el motivo de un branch que no proyecta, en `sin LO asignados` y en
            su tooltip
          · el porqué de cada regla, en las cabeceras de `lib/outlook/*.ts`
      
        Si algo de la tabla necesita un párrafo para entenderse, el problema
        está en la tabla.
      */}
    </div>
  );
}
