'use client';

import { Fragment, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  composeYear,
  loadOutlookData,
  projectLoanOfficer,
  projectBranch,
  type OutlookData,
  type OutlookLoanOfficer,
} from '@/lib/outlook/loadData';
import { OUTLOOK_STRATEGIES, cadenceLabel, type OutlookStrategy } from '@/lib/outlook/project';
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
    return rev === 0 ? 'mes a mes · sin números fijados' : 'mes a mes · números fijados a mano';
  }
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
    <div className="hub-container">
      <div className="page-head">
        <div>
          <div className="bp-breadcrumbs">
            <Link href="/outlook">Outlook</Link> <span>›</span> <span>{branch.branchCode}</span>
          </div>
          <h1 className="page-head__title">Branch {branch.branchCode}</h1>
          <p className="page-head__subtitle">
            {branch.loanOfficers.length} loan officer{branch.loanOfficers.length === 1 ? '' : 's'} · closed {branch.ytd}
            {branch.unattributed > 0 ? ` (+${branch.unattributed} sin atribuir)` : ''} · {year} total{' '}
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
                  Real — cerrado
                </th>
              )}
              <th className="bp-center ol-band ol-band--forecast">Pronóstico</th>
              {remainingMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--budget" colSpan={remainingMonths.length}>
                  Presupuesto
                </th>
              )}
              <th className="bp-center"></th>
              <th className="bp-center ol-band ol-band--decide" colSpan={2}>
                Decisión
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
                    </td>
                    {monthsOfYear.map((m) => (
                      <td
                        key={m}
                        className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth) + (loYear.byMonth[m] ? '' : ' zero')}
                        title={
                          m === currentMonth && here
                            ? `Pronóstico del mes: ${lo.closedToDate} ya cerraron y el resto es pipeline con su tasa. ` +
                              `Los cerrados van DENTRO de este número.`
                            : m === currentMonth && !here
                              ? `Su pronóstico se carga al branch ${lo.primaryBranch ?? '(sin roster)'}, el de su ` +
                                `roster. Acá se muestra lo que ya cerró en este branch este mes, que es real.`
                              : m > currentMonth && !here
                              ? `Su pronóstico y su presupuesto se cargan al branch ${lo.primaryBranch ?? '(sin roster)'}, ` +
                                `el de su roster. Sus cerrados sí se cuentan acá, porque son del préstamo.`
                              : undefined
                        }
                      >
                        {fmt(loYear.byMonth[m] ?? null)}
                      </td>
                    ))}
                    <td
                      className="bp-center totcol"
                      title={
                        `Suma de las doce columnas. Sus cinco estrategias suman ${strategiesTotal}: la diferencia es el ` +
                        `pronóstico de ${monthLabel(currentMonth)}, que Forecast no abre por estrategia.`
                      }
                    >
                      {fmt(loYear.total)}
                    </td>
                    <td
                      className="bp-center"
                      title={
                        monthlyStrategies.length > 0
                          ? `Suma de los benchmarks de las estrategias que proyectan por porcentaje. ` +
                            `${monthlyStrategies.join(', ')} ${monthlyStrategies.length === 1 ? 'está fijada' : 'están fijadas'} ` +
                            `mes a mes: sus meses no salen de un benchmark, así que no suman acá.`
                          : 'Suma de los benchmarks de sus cinco estrategias. Calculado, no editable.'
                      }
                    >
                      {fmt(lo.benchmarkTotal)}
                      {monthlyStrategies.length > 0 && <span className="bp-muted ol-tag">+{monthlyStrategies.length} mes a mes</span>}
                    </td>
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
                                  title="Su benchmark se lee de org.employee_benchmark y se edita en el perfil del Business Plan, no acá."
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
                                    ? 'Forecast proyecta el mes sobre el pipeline, que no trae la estrategia. Repartir el total por estrategia sería inventarlo.'
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
                              title={`Sin ${monthLabel(currentMonth)}: el mes en curso no se puede abrir por estrategia.`}
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
                                    ? 'Fijada mes a mes: el benchmark no interviene. Sigue guardado por si vuelve a modo porcentaje.'
                                    : s === 'Own Production'
                                      ? 'Su benchmark se edita en el Business Plan. Acá se edita su regla de crecimiento.'
                                      : `Fijar el benchmark de ${s} y su regla de crecimiento`
                                }
                              >
                                editar
                              </button>
                            </td>
                            <td className="lbl" style={{ fontSize: '11px' }}>
                              <button
                                type="button"
                                className="bp-linkish"
                                style={{ fontSize: '11px', textAlign: 'left' }}
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
                                  <td className="lbl bp-muted" style={{ fontSize: '11px' }}>
                                    su producción ya está contada en NPPM
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
        <b>Con una excepción, y es {monthLabel(currentMonth)}</b>: el total de una persona no da la suma de sus cinco
        estrategias, y la diferencia es exactamente el pronóstico del mes. Forecast lo calcula sobre el pipeline, que no
        lleva la estrategia consigo; repartirlo por peso del YTD sería inventar un número que parece dato. Las
        estrategias tienen ese mes en <code>—</code> y su total no lo incluye. Queda como etapa propia:{' '}
        <code>pipeline_loans</code> guarda los cinco crudos desde F6b y <code>lib/pipeline/strategy.ts</code> ya sabe
        clasificarlos, así que es derivable sin inventar nada.{' '}
        <b>El benchmark del Loan Officer</b> es la suma de sus cinco estrategias: calculado, no editable. El de{' '}
        <b>Own Production</b> se lee de <code>org.employee_benchmark</code> y se sigue editando en el perfil del Business
        Plan.{' '}
        <b>Cada celda del presupuesto</b> trae su cuenta completa en el tooltip: benchmark, regla que aplicó, períodos y
        resultado.{' '}
        <b>{monthLabel(currentMonth)} es la única columna que puede no cerrar hacia arriba</b>, y siempre por el mismo
        motivo: el pronóstico se atribuye por el branch del <b>roster</b> y lo cerrado por el branch del{' '}
        <b>préstamo</b>. Donde no hay pronóstico —nadie rosterizado— la celda muestra lo ya cerrado del mes, que es un
        piso real; el tooltip de cada celda dice cuál de las dos lecturas está mostrando.{' '}
        <b>Cada estrategia se fija de una de dos maneras</b>: por porcentaje —un benchmark y una regla, y los meses se
        calculan— o <b>mes a mes</b>, escribiendo el número de cada mes. La columna de la derecha dice cuál rige. Lo
        guardado del otro modo <b>no se borra y no se aplica</b>: volver al otro lo reactiva tal como estaba.{' '}
        <b>Todo lo que se edita se agrega, nunca se reemplaza</b>: un benchmark guardado es una fila nueva y una regla
        editada es una revisión nueva, las dos firmadas y fechadas, con las anteriores enteras en el historial. Y rige{' '}
        <b>desde el mes siguiente</b> — el mes en curso ya se está midiendo contra el benchmark anterior.
      </div>
    </div>
  );
}
