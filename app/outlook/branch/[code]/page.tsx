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
import { fmt } from '@/lib/outlook/format';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';
import StrategyEditor from '@/app/outlook/components/StrategyEditor';
import NppmEditor from '@/app/outlook/components/NppmEditor';

/**
 * ============================================================================
 * OUTLOOK — VISTA 2: dentro de un branch (etapas OL1b, OL2, OL3 y OL7)
 * ============================================================================
 *
 * DOS BLOQUES, y la razón por la que son dos — etapa OL7:
 *
 *   1. LOAN OFFICERS DEL BRANCH, en filas planas. Quiénes son y cuánto hace
 *      cada uno. Se lee de un barrido, sin abrir nada.
 *   2. PRESUPUESTO POR ESTRATEGIA, cada estrategia abriéndose a las personas
 *      que la aportan, con el editor adentro. Acá se decide.
 *
 * ⚠ ANTES ERA UNA SOLA TABLA con la jerarquía al revés: persona → estrategia.
 * Para saber cuánto NPPM tenía el branch había que abrir las ocho personas y
 * sumar a mano ocho filas, y la pregunta "¿cuánto vale esta estrategia acá?"
 * --que es la que se hace al fijar un presupuesto-- no tenía respuesta en la
 * pantalla. Invertir el segundo bloque la contesta directo, y el primero sigue
 * contestando "¿quién hace cuánto?".
 *
 * Los dos bloques miran los MISMOS números por la misma fórmula: la celda de una
 * persona en una estrategia se calcula en `cellOf` y las dos jerarquías la suman.
 * No hay una segunda cuenta que pueda divergir.
 *
 * ---------------------------------------------------------------------------
 * ETAPA OL2 — acá se DECIDE, no sólo se mira
 * ---------------------------------------------------------------------------
 * Cada fila de persona dentro de una estrategia abre su editor (benchmark +
 * regla de crecimiento) y cada fila de realtor abre el suyo. La edición vive
 * donde está el número que cambia, no en una pantalla de configuración aparte:
 * quien mira una proyección en cero y quiere arreglarla ya está en la fila
 * correcta.
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
 * ⚠ El bloque de estrategias NO suma el mes en curso, y el de personas sí: la
 * diferencia entre los dos totales es exactamente ese mes. Forecast lo calcula
 * sobre el pipeline, que no lleva la estrategia consigo, así que por estrategia
 * ese mes dice `no data` -- no 0, que sería afirmar que no va a cerrar nada.
 *
 * Es la única excepción a "cada nivel es la suma del de abajo" en todo el
 * módulo, y está dicha en la pantalla --en los tooltips de los dos totales y en
 * el rótulo del bloque-- porque una jerarquía que casi siempre cierra y una vez
 * no, sin explicación, se reporta como bug. Se cierra el día que el mes en curso
 * se pueda abrir por estrategia (ver la etapa pendiente en `project.ts`).
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];

function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
}

/**
 * Cómo se está fijando esta estrategia PARA ESTA PERSONA, en una línea.
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

/**
 * Qué dice el estado del roster, y por qué son cuatro rótulos y no dos.
 *
 * ⚠ EL RÓTULO DICE EL ESTADO REAL, no "ya no produce". `left` es alguien que
 * dejó la empresa; `not producing` alguien que sigue empleada y dejó de
 * originar. Hoy los dos casos existen por separado en el roster --Isabel Wagner
 * y Ludwig Aguillon son bajas-- y el día que aparezca el segundo el rótulo tiene
 * que poder distinguirlo. Un solo rótulo para los dos obligaría a preguntarle a
 * RRHH cuál es cuál.
 */
const STATE_TAG: Record<string, { text: string; title: string }> = {
  left: {
    text: 'left',
    title:
      'No longer with the company, per the roster. Their closings are real and already happened, which is why the ' +
      'row is here and why the branch total adds up. What changed is that they will not produce from now on, so ' +
      'there is no forecast and no budget.',
  },
  not_producing: {
    text: 'not producing',
    title:
      'Still with the company and no longer originating, per the roster. Not the same as having left: this row is ' +
      'here because of closings that already happened.',
  },
  unknown: {
    text: 'not in roster',
    title:
      'Closed in this branch and does not appear in the roster, so there is no way to say whether they still ' +
      'produce. The row is here because the closings are real.',
  },
};

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
  /*
   * Qué está abierto, con claves de TEXTO: el bloque 2 tiene dos niveles
   * plegables --la estrategia y, dentro de NPPM, la persona con sus realtors--
   * así que una clave numérica de persona ya no alcanza.
   */
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  /*
   * ⚠ Cuantos benchmarks de estrategia hay CARGADOS en este branch.
   *
   * Own Production queda afuera a proposito: su benchmark no vive en `outlook`
   * sino en `org.employee_benchmark`, y lo edita el Business Plan. Contarlo
   * haria que un branch con Own Production cargado y nada mas parezca tener
   * presupuesto por estrategia cuando las otras cuatro estan en cero.
   */
  const strategyBenchmarksSet = branch.loanOfficers.reduce(
    (a, lo) =>
      a +
      OUTLOOK_STRATEGIES.filter((s) => s !== 'Own Production' && (lo.strategyBenchmarks[s] ?? 0) > 0).length,
    0
  );

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* Si esta persona aporta pronóstico y presupuesto ACÁ, o sólo cerrados. */
  const isHere = (lo: OutlookLoanOfficer) => lo.primaryBranch === branch.branchCode;

  /**
   * ⚠ LA CELDA DE UNA PERSONA EN UNA ESTRATEGIA, EN UN SOLO LUGAR.
   *
   * Los dos bloques la usan y las dos jerarquías la suman, así que no hay una
   * segunda cuenta que pueda divergir. Antes vivía dentro del `map` de la única
   * tabla, y al partir la pantalla en dos habría quedado duplicada -- que es el
   * modo de falla que este módulo evita en todos lados: dos fórmulas para el
   * mismo número, y la de arriba que no da la suma de la de abajo.
   *
   * El mes en curso va en `null` --y sale como `no data`-- porque Forecast
   * proyecta el mes desde el pipeline, que no lleva la estrategia consigo.
   */
  function cellOf(lo: OutlookLoanOfficer, s: OutlookStrategy) {
    const here = isHere(lo);
    const st = lo.strategies.find((x) => x.strategy === s);
    const steps = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[s] ?? [];
    const proj: Record<string, number | null> = {};
    remainingMonths.forEach((m, i) => (proj[m] = here ? (steps[i]?.value ?? 0) : 0));
    return {
      here,
      steps,
      year: composeYear(monthsOfYear, currentMonth, st?.actualByMonth ?? {}, null, proj),
      realtors: st?.byRealtor ?? [],
    };
  }

  /**
   * ⚠ QUIÉN APORTA A ESTA ESTRATEGIA, Y POR QUÉ TENER UNA REGLA NO CUENTA.
   *
   * Aporta quien tenga PRODUCCIÓN, o BENCHMARK, o MESES FIJADOS a mano. Los
   * tres mueven un número de la fila de la estrategia.
   *
   * Tener una regla de crecimiento NO alcanza, y esto se descubrió mirando la
   * pantalla: la siembra de OL1 dejó 185 reglas --las 37 personas × 5
   * estrategias-- así que "tiene regla" es verdad para TODOS. Con esa condición
   * cada estrategia abría las 9 personas del branch, 45 filas casi todas en `–`
   * y todas con el mismo texto de regla. Una regla sobre un benchmark en cero no
   * proyecta nada: es una intención guardada, no un aporte.
   *
   * Quien no aporta sigue siendo alcanzable --hay que poder fijarle un
   * presupuesto-- detrás de "show the N with no budget", al final de la
   * estrategia abierta. Lo que se ve por defecto es lo que tiene números.
   */
  /* Arrow y no `function`: una declaracion hoisted pierde el estrechamiento de
     `branch` que hizo el guard de arriba. */
  const contributes = (lo: OutlookLoanOfficer, s: OutlookStrategy): boolean => {
    const st = lo.strategies.find((x) => x.strategy === s);
    if (st && st.ytd) return true;
    if (lo.strategyBenchmarks[s]) return true;
    if (Object.keys(lo.targetsByStrategy[s] ?? {}).length) return true;
    return false;
  };

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

      {/*
        ══════════════════════════ BLOQUE 1 ══════════════════════════════════
        Las personas, en filas planas. Nada que abrir: quién es y cuánto hace.
      */}
      <h2 className="ol-block__title">Loan officers</h2>

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
              <th className="lbl">Loan officer</th>
              {monthsOfYear.map((m) => (
                <th key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center totcol">{year}</th>
              <th className="bp-center">Benchmark</th>
              <th className="lbl">Funnel</th>
            </tr>
          </thead>
          <tbody>
            {branch.loanOfficers.map((lo) => {
              const { byMonth } = projectLoanOfficer(lo, remainingMonths);
              const here = isHere(lo);
              /*
               * Quien no tiene este branch en su roster no aporta pronóstico
               * acá, pero sus cerrados del mes en este branch son reales: se
               * muestran, con la misma regla que el branch.
               */
              const loCurrent = here ? lo.currentMonth : (lo.actualByMonth[currentMonth] ?? 0);
              const loYear = composeYear(monthsOfYear, currentMonth, lo.actualByMonth, loCurrent, here ? byMonth : {});
              const monthlyStrategies = OUTLOOK_STRATEGIES.filter(
                (s) => (lo.modeByStrategy[s] ?? 'growth') === 'monthly'
              );
              const tag = STATE_TAG[lo.rosterState];

              return (
                <tr key={lo.employeeKey} className="metric">
                  <td className="lbl">
                    {lo.fullName}
                    {tag && (
                      <span className="bp-muted ol-tag" title={tag.title}>
                        {tag.text}
                      </span>
                    )}
                    {!lo.hasIdentity && (
                      <span
                        className="bp-muted ol-tag"
                        title={
                          'The roster says they produce, but there is no person_code alias tying them to an internal ' +
                          'identity, and benchmark and plan both hang off it. Shown with name and branch so the ' +
                          'branch total keeps adding up. Someone has to create the alias.'
                        }
                      >
                        no internal identity
                      </span>
                    )}
                    {/*
                      El rol, que la tabla ya tiene y no cuesta nada mostrar. Son
                      10 de los productores, y en `org.employee_branch` tienen
                      DOS filas --una 'LO' y una 'BM'--, que es lo que hacía que
                      un conteo ingenuo diera 44 personas en vez de 34.
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
                            ? `Their forecast is charged to branch ${lo.primaryBranch ?? '(not in roster)'}, their ` +
                              `roster branch. What is shown here is what they already closed in this branch this month.`
                            : m > currentMonth && !here
                              ? `Their forecast and budget are charged to branch ${lo.primaryBranch ?? '(not in roster)'}, ` +
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
                      `Sum of the twelve columns, ${monthLabel(currentMonth)} included. Below, by strategy, that ` +
                      `month says "no data": Forecast does not break it down by strategy.`
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
                          `by month: their months are the result, not a base, so their benchmark is not part of this.`
                        : 'Sum of the five strategy benchmarks. Set them in Budget by strategy, below.'
                    }
                  >
                    {fmt(lo.benchmarkTotal)}
                  </td>
                  <td className="lbl">
                    {lo.activePlan ? (
                      <span
                        className="bp-plan-chip"
                        title={`${lo.activePlan.funnelName} · ${lo.activePlan.doneMilestones} of ${lo.activePlan.totalMilestones} milestones`}
                      >
                        {lo.activePlan.funnelName} ·{' '}
                        {Math.round((lo.activePlan.doneMilestones / Math.max(1, lo.activePlan.totalMilestones)) * 100)}%
                      </span>
                    ) : (
                      <span className="bp-muted">no funnel</span>
                    )}
                  </td>
                </tr>
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
              <td className="bp-center zero">–</td>
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
        ══════════════════════════ BLOQUE 2 ══════════════════════════════════
        El presupuesto, por estrategia. Cada una se abre a las personas que la
        aportan, y el editor está en la fila de la persona: la decisión se toma
        donde está el número que cambia.
      */}
      <h2 className="ol-block__title">Budget by strategy</h2>

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            <tr className="mo-row">
              <th className="lbl">Strategy / loan officer</th>
              {monthsOfYear.map((m) => (
                <th key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center totcol">{year}</th>
              <th className="bp-center">Benchmark</th>
              <th className="lbl">Rule</th>
            </tr>
          </thead>
          <tbody>
            {OUTLOOK_STRATEGIES.map((s) => {
              const people = branch.loanOfficers.filter((lo) => contributes(lo, s));
              /* Los que no aportan: detras de un pliegue, para poder editarlos. */
              const rest = branch.loanOfficers.filter((lo) => !contributes(lo, s));
              const isOpen = open.has('s:' + s);
              const restOpen = open.has('rest:' + s);
              const cells = people.map((lo) => ({ lo, cell: cellOf(lo, s) }));
              const restCells = restOpen ? rest.map((lo) => ({ lo, cell: cellOf(lo, s) })) : [];

              /*
               * La fila de la estrategia es la SUMA de las de abajo, mes por
               * mes. El mes en curso queda en `null` porque ninguna de las de
               * abajo lo sabe -- sumar `no data` no da un número.
               */
              const byMonth: Record<string, number | null> = {};
              for (const m of monthsOfYear) {
                if (m === currentMonth) {
                  byMonth[m] = null;
                  continue;
                }
                byMonth[m] = cells.reduce((a, { cell }) => a + (cell.year.byMonth[m] ?? 0), 0);
              }
              const total = cells.reduce((a, { cell }) => a + cell.year.total, 0);

              /* El benchmark de la estrategia: sólo las que proyectan por tasa. */
              const benchSum = cells.reduce(
                (a, { lo }) => a + ((lo.modeByStrategy[s] ?? 'growth') === 'monthly' ? 0 : (lo.strategyBenchmarks[s] ?? 0)),
                0
              );
              const withBench = cells.filter(({ lo }) => (lo.strategyBenchmarks[s] ?? 0) > 0).length;
              const monthly = cells.filter(({ lo }) => (lo.modeByStrategy[s] ?? 'growth') === 'monthly').length;

              return (
                <Fragment key={'s-' + s}>
                  <tr className="grp togg d1" onClick={() => toggle('s:' + s)}>
                    <td className="lbl">
                      <span className={'chev' + (isOpen ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      {s}
                      {/*
                        ⚠ "N de M", no "N personas": el branch tiene M personas y
                        sólo N tienen algo en esta estrategia. Decir sólo N haría
                        pensar que el branch tiene N, y decir M --que es lo que
                        decía la primera version-- daba 9 en las cinco
                        estrategias, incluidas las que no tienen ni un cierre.
                      */}
                      <span
                        className="bp-muted ol-tag"
                        title={
                          `${people.length} of the ${branch.loanOfficers.length} people in this branch have ` +
                          `production, a benchmark or months set by hand in ${s}. The rest are behind the link at ` +
                          `the end, so a budget can be set for them.`
                        }
                      >
                        {people.length} of {branch.loanOfficers.length}
                      </span>
                      {s === 'Own Production' && (
                        <span
                          className="bp-muted ol-tag"
                          title="Its benchmark is read from org.employee_benchmark and edited in the Business Plan profile, not here. What is edited here is its growth rule."
                        >
                          BP
                        </span>
                      )}
                    </td>
                    {monthsOfYear.map((m) => (
                      <td
                        key={m}
                        className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth) + (byMonth[m] ? '' : ' zero')}
                        title={
                          m === currentMonth
                            ? 'Forecast projects the month from the pipeline, which does not carry the strategy. Splitting the total by strategy would be inventing it.'
                            : undefined
                        }
                      >
                        {fmt(byMonth[m])}
                      </td>
                    ))}
                    <td
                      className="bp-center totcol"
                      title={`Without ${monthLabel(currentMonth)}: the current month cannot be broken down by strategy.`}
                    >
                      {fmt(total)}
                    </td>
                    <td className={'bp-center' + (benchSum ? '' : ' zero')}>{fmt(benchSum)}</td>
                    <td className="lbl bp-muted">
                      {people.length === 0
                        ? 'no budget set here'
                        : [
                            `${withBench} with a benchmark`,
                            monthly > 0 ? `${monthly} month by month` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </td>
                  </tr>

                  {isOpen && people.length === 0 && (
                    <tr className="metric">
                      <td className="lbl bp-empty-cell" colSpan={colCount} style={{ paddingLeft: '30px' }}>
                        Nobody in this branch has production or a budget in {s} yet.
                      </td>
                    </tr>
                  )}

                  {isOpen &&
                    [...cells, ...restCells].map(({ lo, cell }) => {
                      const isMonthly = (lo.modeByStrategy[s] ?? 'growth') === 'monthly';
                      const bench = lo.strategyBenchmarks[s] ?? 0;
                      /* Los realtors sólo existen bajo NPPM, y con su propio pliegue. */
                      const hasRealtors = s === 'NPPM' && cell.realtors.length > 0;
                      const realtorKey = 'r:' + s + ':' + lo.employeeKey;
                      const realtorsOpen = open.has(realtorKey);

                      return (
                        <Fragment key={'s-' + s + '-' + lo.employeeKey}>
                          <tr
                            className={'metric mrow' + (hasRealtors ? ' togg' : '')}
                            onClick={hasRealtors ? () => toggle(realtorKey) : undefined}
                          >
                            <td className="lbl" style={{ paddingLeft: '30px' }}>
                              {hasRealtors && (
                                <span className={'chev' + (realtorsOpen ? ' open' : '')} aria-hidden="true">
                                  ›
                                </span>
                              )}
                              {lo.fullName}
                              {!cell.here && (
                                <span
                                  className="bp-muted ol-tag"
                                  title={
                                    `Their budget is charged to branch ${lo.primaryBranch ?? '(not in roster)'}, their ` +
                                    `roster branch. What is shown here is what they closed in this branch.`
                                  }
                                >
                                  budget in {lo.primaryBranch ?? 'no branch'}
                                </span>
                              )}
                            </td>
                            {monthsOfYear.map((m) => (
                              <td
                                key={m}
                                className={
                                  'bp-center ol-m ol-m--' +
                                  bandOf(m, currentMonth) +
                                  (cell.year.byMonth[m] ? '' : ' zero')
                                }
                                title={
                                  m === currentMonth
                                    ? 'Forecast projects the month from the pipeline, which does not carry the strategy. Splitting the total by strategy would be inventing it.'
                                    : m > currentMonth
                                      ? cell.steps[remainingMonths.indexOf(m)]?.explain
                                      : undefined
                                }
                              >
                                {fmt(cell.year.byMonth[m] ?? null)}
                              </td>
                            ))}
                            <td
                              className="bp-center totcol"
                              title={`Without ${monthLabel(currentMonth)}: the current month cannot be broken down by strategy.`}
                            >
                              {fmt(cell.year.total)}
                            </td>
                            {/*
                              El benchmark se edita desde su celda y la regla
                              desde la celda de la regla. Las dos abren el mismo
                              editor: son una sola decisión --cuánto es la base y
                              cuánto crece-- y verlas juntas es lo que evita
                              guardar una sin mirar la otra.

                              El benchmark sólo significa algo en modo `growth`:
                              es la BASE de un cálculo. En modo mes a mes los
                              meses son el resultado directo, así que la celda
                              dice `no data` en vez de mostrar un número guardado
                              que no está interviniendo en ninguna celda.
                            */}
                            <td
                              className={'bp-center' + (isMonthly || !bench ? ' zero' : '')}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isMonthly ? 'no data' : fmt(bench)}
                              <button
                                type="button"
                                className="ol-edit"
                                onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                                title={
                                  isMonthly
                                    ? 'Set month by month: the benchmark does not take part. It stays saved in case this goes back to growth rate.'
                                    : s === 'Own Production'
                                      ? 'Its benchmark is edited in the Business Plan. What is edited here is its growth rule.'
                                      : `Set ${lo.fullName}'s benchmark in ${s} and its growth rule`
                                }
                              >
                                edit
                              </button>
                            </td>
                            <td className="lbl ol-rule" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="bp-linkish ol-rule__btn"
                                onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                              >
                                {ruleLabel(lo, s, remainingMonths)}
                              </button>
                              <span className="bp-muted ol-tag">
                                rev {(isMonthly ? lo.targetRevision[s] : lo.ruleRevision[s]) || '–'}
                              </span>
                            </td>
                          </tr>

                          {/* Los realtors NPPM, por nombre, con su propio benchmark. */}
                          {hasRealtors &&
                            realtorsOpen &&
                            cell.realtors.map((r) => {
                              /*
                                Un realtor tiene meses reales y nada más: su
                                benchmark no proyecta (ver `NppmEditor`), así que
                                del mes en curso en adelante va `no data` y no 0.
                              */
                              const rYear = composeYear(monthsOfYear, currentMonth, r.actualByMonth, null, {});
                              return (
                                <tr key={'s-' + s + '-' + lo.employeeKey + '-' + r.realtor} className="metric drow">
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
                  {/*
                    Los que no tienen nada en esta estrategia. Estan detras de un
                    pliegue y no escondidos: hay que poder fijarles un presupuesto,
                    y es la unica pantalla desde donde se hace.
                  */}
                  {isOpen && rest.length > 0 && (
                    <tr className="metric togg" onClick={() => toggle('rest:' + s)}>
                      <td className="lbl" colSpan={colCount} style={{ paddingLeft: '30px' }}>
                        <button type="button" className="bp-linkish">
                          {restOpen
                            ? `hide the ${rest.length} with no budget in ${s}`
                            : `show the ${rest.length} with no budget in ${s}`}
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        El aviso va DEBAJO del bloque 2, pegado a los ceros que explica. En el
        pie de la pagina lo leeria quien ya se hizo la pregunta; aca lo lee quien
        esta mirando la columna en cero.
      */}
      {strategyBenchmarksSet === 0 && branch.loanOfficers.length > 0 && (
        <div className="bp-notice ol-notice">
          <b>No strategy benchmarks set in this branch.</b> That is why every strategy above projects zero from{' '}
          {monthLabel(remainingMonths[0] ?? currentMonth)} on, except Own Production, whose benchmark comes from the
          Business Plan. Growth rules do not fill the gap: a rule multiplies a benchmark, and over zero it gives zero.
          It is <b>not set yet</b>, not a decision that nothing is expected — use <b>edit</b>{' '}
          on a person&apos;s row.
        </div>
      )}

      {/*
        Igual que en la vista 1: se EXPLICA, no se calcula distinto. Una fila con
        cerrados y proyección en cero, sin texto, se reporta como bug.
      */}
      {projectsNothing && branch.ytd > 0 && (
        <div className="bp-notice ol-notice">
          {/*
            ⚠ El espacio va EXPLICITO. Sin `{' '}` el compilador se come el que
            hay entre la expresion y el texto que sigue, y salia "Its 2closings".
            Estaba asi desde OL1b y no se noto porque solo lo ven los tres
            branches que no proyectan.
          */}
          <b>{branch.branchCode} does not project.</b> Its {branch.ytd}{' '}
          closings this year are real, but no Loan Officer has this branch on their roster — and the projection is charged to each person&apos;s roster branch, because it is
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
          · el motivo de un branch que no proyecta, en `does not project` y en su
            tooltip
          · el porqué de cada regla, en las cabeceras de `lib/outlook/*.ts`

        Si algo de la tabla necesita un párrafo para entenderse, el problema
        está en la tabla.
      */}
    </div>
  );
}
