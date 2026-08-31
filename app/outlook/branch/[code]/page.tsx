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
  const strategyBenchmarksSet = branch.byStrategy.filter(
    (bs) => bs.strategy !== 'Own Production' && bs.realtors.some((r) => !r.benchmarkIsDefault)
  ).length;

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /*
   * ⚠ SIEMPRE TRUE DESDE OL8, y se deja escrito en vez de borrado.
   *
   * El roster da UN branch por persona, y una fila sólo aparece en ese branch,
   * así que `primaryBranch` y el branch de la fila son el mismo. Hasta OL7 esto
   * podía ser falso --una persona aparecía en cada branch donde había cerrado y
   * su presupuesto se cargaba a uno solo-- y de ahí venía la etiqueta "budget in
   * X", que ya no puede ocurrir.
   *
   * Queda como una sola expresión para que el día que la regla vuelva a admitir
   * varias filas por persona haya UN lugar donde mirarlo, en vez de un supuesto
   * repartido por la pantalla.
   */
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
      /* El mes en curso: lo real cerrado. Ver la nota de `sYear`, misma razón. */
      year: composeYear(
        monthsOfYear,
        currentMonth,
        st?.actualByMonth ?? {},
        st?.actualByMonth[currentMonth] ?? 0,
        proj
      ),
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
          {/*
            ⚠ LOS DOS "+N" SON EL PRECIO DE DOS REGLAS, y van acá porque sin
            ellos el total del branch no da la suma de sus filas y nadie sabe por
            qué. Son cosas distintas:

              unattributed       el originador no pertenece a la división
                                 (`org.source_name_excluded`).
              closedByOutsiders  el originador SÍ es de la división, pero de otro
                                 branch: el roster lo pone en otro lado, así que
                                 su fila está allá. Nuevo en OL8.
          */}
          <p className="page-head__subtitle">
            {branch.loanOfficers.length} loan officer{branch.loanOfficers.length === 1 ? '' : 's'} · closed {branch.ytd}
            {branch.closedByOutsiders > 0 ? (
              <span title="Closed in this branch by loan officers whose roster branch is another one. Their production counts here, because the loan closed here; their row lives in their own branch.">
                {' '}
                (+{branch.closedByOutsiders} by loan officers from other branches)
              </span>
            ) : null}
            {branch.unattributed > 0 ? (
              <span title="Closed in this branch by someone who is not a loan officer of the division — listed in org.source_name_excluded with a written reason. Not counted in any branch total.">
                {' '}
                (+{branch.unattributed} outside the division)
              </span>
            ) : null}{' '}
            · {year} total {fmt(branchYear.total)}
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
                      className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                      title={
                        m === currentMonth
                          ? `Month forecast: ${lo.closedToDate} already closed and the rest is pipeline with its ` +
                            `rate. Closings are INSIDE this number.`
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

            <tr className="metric ol-total">
              <td className="lbl">Branch {branch.branchCode}</td>
              {monthsOfYear.map((m) => (
                <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {fmt(branchYear.byMonth[m] ?? null)}
                </td>
              ))}
              <td className="bp-center totcol">{fmt(branchYear.total)}</td>
              {/* El branch no tiene benchmark propio: la celda queda vacia. */}
              <td className="bp-center"></td>
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
        El presupuesto por estrategia. Cada estrategia se abre por lo que
        corresponde a SU unidad de decision -- ver `BranchStrategy` en el loader:

          Own Production  por LOAN OFFICER
          NPPM            por REALTOR
          B2B             no se abre: es del branch
          Recruitment     no se abre: es del branch
          Affinity        no se abre: es del branch
      */}
      <h2 className="ol-block__title">Budget by strategy</h2>

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            <tr className="mo-row">
              <th className="lbl">Strategy</th>
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
            {branch.byStrategy
              /*
                ⚠ NPPM NO SE MUESTRA DONDE NO HAY REALTORS.
                Se abre por realtor, así que sin realtors es una fila que no se
                puede abrir y que no tiene nada que decir. El 747 no tiene
                ninguno: mostrarla ahí sería una estrategia vacía compitiendo con
                las cuatro que sí existen.

                Las tres de branch --B2B, Recruitment, Affinity-- SÍ se quedan
                aunque estén en cero: son el lugar donde se les fija el
                presupuesto, y una estrategia sin presupuesto todavía es
                justamente la que hay que ver.
              */
              .filter((bs) => bs.strategy !== 'NPPM' || bs.realtors.length > 0)
              .map((bs) => {
              const s = bs.strategy;
              const abierta = open.has('s:' + s);
              const plegable = bs.opensBy !== 'branch';

              /*
                ⚠ EL PRESUPUESTO SOLO SE PROYECTA DONDE HAY DE DONDE.

                Own Production proyecta: su benchmark vive en
                `org.employee_benchmark`, por persona, y el motor ya lo resuelve.

                Las otras cuatro no proyectan, y no es lo mismo que proyectar
                cero: `outlook.strategy_benchmark` cuelga de `employee_key`, asi
                que una estrategia que ahora es DEL BRANCH no tiene donde guardar
                su presupuesto. Los meses van en `null` --celda vacia-- porque no
                hay ningun numero fijado, y un 0 afirmaria que se decidio que no
                cierre nada. El SQL para guardarlo esta entregado sin ejecutar en
                docs/sql; hasta entonces la fila lo dice en su columna de regla.
              */
              const proyecta = s === 'Own Production';
              const proj: Record<string, number | null> = {};
              if (proyecta) {
                for (const lo of branch.loanOfficers) {
                  const steps = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[s] ?? [];
                  remainingMonths.forEach((m, i) => {
                    proj[m] = (proj[m] ?? 0) + (steps[i]?.value ?? 0);
                  });
                }
              }
              /*
                ⚠ EL MES EN CURSO DE ESTE BLOQUE ES LO REAL CERRADO, no el
                pronóstico y no un hueco.
                Ninguna fila de acá tiene pronóstico: Forecast lo calcula sobre
                el pipeline, que no lleva la estrategia consigo. La regla del
                módulo para ese caso ya existe y es la de AFFINITY -- pronóstico
                si proyecta, y si no, lo que cerró.
                Lo que se ganó al aplicarla, medido: Laura Delgado tiene 5
                cierres en el 776 y la fila mostraba 2, porque 3 son de agosto y
                la celda de agosto estaba vacía. Tres cierres reales que no se
                veían en ninguna parte de la pantalla.
              */
              const sYear = composeYear(
                monthsOfYear,
                currentMonth,
                bs.actualByMonth,
                bs.actualByMonth[currentMonth] ?? 0,
                proj
              );

              /*
                El benchmark de la estrategia. Own Production suma los de sus
                personas; NPPM suma los de sus realtors --con el promedio de 3
                meses como default--; las otras tres no tienen benchmark posible
                todavia y van vacias.
              */
              const bench =
                s === 'Own Production'
                  ? branch.loanOfficers.reduce((a, lo) => a + (lo.strategyBenchmarks[s] ?? 0), 0)
                  : s === 'NPPM'
                    ? bs.realtors.reduce((a, r) => a + r.benchmark, 0)
                    : null;

              const conBenchmark = branch.loanOfficers.filter((lo) => (lo.strategyBenchmarks[s] ?? 0) > 0).length;
              const regla =
                s === 'Own Production'
                  ? `${conBenchmark} of ${branch.loanOfficers.length} with a benchmark`
                  : s === 'NPPM'
                    ? bs.realtors.length === 0
                      ? 'no realtors in this branch'
                      : `${bs.realtors.length} realtor${bs.realtors.length === 1 ? '' : 's'} · default is their 3-month average`
                    : 'branch level · nowhere to save a budget yet';

              return (
                <Fragment key={'s-' + s}>
                  <tr
                    className={'grp d1' + (plegable ? ' togg' : '')}
                    onClick={plegable ? () => toggle('s:' + s) : undefined}
                  >
                    <td className="lbl">
                      {plegable ? (
                        <span className={'chev' + (abierta ? ' open' : '')} aria-hidden="true">
                          ›
                        </span>
                      ) : (
                        /* Sin chevron, con la misma sangria: la fila no se abre. */
                        <span className="chev chev--none" aria-hidden="true" />
                      )}
                      {s}
                      {bs.opensBy === 'loanOfficer' && (
                        <span
                          className="bp-muted ol-tag"
                          title="Own production: the question is how much each loan officer does, so it opens by person. Its benchmark lives in the Business Plan."
                        >
                          by loan officer
                        </span>
                      )}
                      {bs.opensBy === 'realtor' && (
                        <span
                          className="bp-muted ol-tag"
                          title="The loan is brought in by the realtor, so it opens by realtor. Which loan officer processed it is not the unit of decision here."
                        >
                          by realtor
                        </span>
                      )}
                      {bs.opensBy === 'branch' && (
                        <span
                          className="bp-muted ol-tag"
                          title="This is the branch's, not a person's. The question is how many loans it brought in and how much it projects, not how much each person did — so there is nothing to open."
                        >
                          branch level
                        </span>
                      )}
                    </td>
                    {monthsOfYear.map((m) => (
                      <td
                        key={m}
                        className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                        title={
                          m === currentMonth
                            ? 'What actually closed this month. There is no forecast by strategy: Forecast projects the month from the pipeline, which does not carry the strategy — so this column shows the real closings, not a projection.'
                            : m > currentMonth && !proyecta
                              ? 'Nothing is set for this strategy yet, so there is no budget to show. Not the same as a budget of zero.'
                              : undefined
                        }
                      >
                        {fmt(sYear.byMonth[m] ?? null)}
                      </td>
                    ))}
                    <td
                      className="bp-center totcol"
                      title={`${monthLabel(currentMonth)} is what actually closed, not the forecast — so this total is below the one in the block above, by the part of the forecast that has not closed yet.`}
                    >
                      {fmt(sYear.total)}
                    </td>
                    <td className="bp-center">{fmt(bench)}</td>
                    <td className="lbl bp-muted">{regla}</td>
                  </tr>

                  {/* ── Own Production: se abre por Loan Officer ───────────── */}
                  {abierta &&
                    bs.opensBy === 'loanOfficer' &&
                    branch.loanOfficers.map((lo) => {
                      const cell = cellOf(lo, s);
                      const isMonthly = (lo.modeByStrategy[s] ?? 'growth') === 'monthly';
                      const b = lo.strategyBenchmarks[s] ?? 0;
                      return (
                        <tr key={'s-' + s + '-' + lo.employeeKey} className="metric mrow">
                          <td className="lbl" style={{ paddingLeft: '30px' }}>
                            {lo.fullName}
                          </td>
                          {monthsOfYear.map((m) => (
                            <td
                              key={m}
                              className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                              title={
                                m === currentMonth
                                  ? 'What actually closed this month, not a forecast: the pipeline does not carry the strategy.'
                                  : m > currentMonth
                                    ? cell.steps[remainingMonths.indexOf(m)]?.explain
                                    : undefined
                              }
                            >
                              {fmt(cell.year.byMonth[m] ?? null)}
                            </td>
                          ))}
                          <td className="bp-center totcol">{fmt(cell.year.total)}</td>
                          <td className="bp-center">
                            {isMonthly ? fmt(null) : fmt(b)}
                            <button
                              type="button"
                              className="ol-edit"
                              onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                              aria-label={`Edit ${lo.fullName}'s benchmark and rule in ${s}`}
                              title={
                                isMonthly
                                  ? 'Set month by month: the benchmark does not take part. It stays saved in case this goes back to growth rate.'
                                  : `Its benchmark is edited in the Business Plan. What is edited here is ${lo.fullName}'s growth rule.`
                              }
                            >
                              ✎
                            </button>
                          </td>
                          <td className="lbl ol-rule">
                            <button
                              type="button"
                              className="ol-rule__btn"
                              onClick={() => setEditing({ employeeKey: lo.employeeKey, strategy: s })}
                            >
                              {ruleLabel(lo, s, remainingMonths)}
                            </button>
                            <span className="bp-muted ol-tag">
                              rev {(isMonthly ? lo.targetRevision[s] : lo.ruleRevision[s]) || 0}
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                  {/* ── NPPM: se abre por realtor ──────────────────────────── */}
                  {abierta &&
                    bs.opensBy === 'realtor' &&
                    bs.realtors.map((r) => {
                      /*
                        Un realtor tiene meses REALES y nada mas: su benchmark no
                        proyecta (ver `NppmEditor`), asi que del mes en curso en
                        adelante la fila va vacia.
                      */
                      const rYear = composeYear(
                        monthsOfYear,
                        currentMonth,
                        r.actualByMonth,
                        r.actualByMonth[currentMonth] ?? 0,
                        {}
                      );
                      return (
                        <tr key={'s-' + s + '-r-' + r.realtor} className="metric mrow">
                          <td className="lbl" style={{ paddingLeft: '30px' }}>
                            {r.realtor}
                          </td>
                          {monthsOfYear.map((m) => (
                            <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                              {fmt(rYear.byMonth[m] ?? null)}
                            </td>
                          ))}
                          <td className="bp-center totcol">{fmt(rYear.total)}</td>
                          {/*
                            ⚠ EL DEFAULT ES EL PROMEDIO DE SUS 3 MESES CERRADOS, y
                            si nadie lo toca ESE es el valor -- no un cero ni un
                            hueco. Se marca `default` para que se distinga de un
                            numero que alguien decidio.
                          */}
                          {/*
                            ⚠ DOS decimales, no uno. El benchmark de un realtor
                            es el promedio de 3 meses y casi siempre fraccionario:
                            0,33 · 0,67 · 1,33. Con un decimal salen 0,3 · 0,7 ·
                            1,3 y se pierde de dónde viene el número -- son
                            tercios. El resto de la tabla sigue con un decimal,
                            que es lo que un pronóstico de pipeline necesita.
                          */}
                          <td className="bp-center">
                            {Number.isInteger(r.benchmark) ? r.benchmark : r.benchmark.toFixed(2)}
                            {r.benchmarkIsDefault && (
                              <span
                                className="bp-muted ol-tag"
                                title={
                                  `Nobody has set it, so what applies is the average of their closings over the ` +
                                  `3 closed months: ${r.avg3m.toFixed(2)}. Editing it saves one number for the ` +
                                  `realtor across every branch — their production is per branch, their benchmark is not.`
                                }
                              >
                                default
                              </span>
                            )}
                            <button
                              type="button"
                              className="ol-edit"
                              onClick={() => setEditingNppm({ realtor: r.realtor, ytd: r.ytd })}
                              aria-label={`Edit ${r.realtor}'s benchmark`}
                              title={`Set ${r.realtor}'s benchmark. One number per realtor, across every branch.`}
                            >
                              ✎
                            </button>
                          </td>
                          <td className="lbl bp-muted">
                            {r.benchmarkIsDefault ? `3-month average: ${r.avg3m.toFixed(2)}` : 'set by hand'}
                          </td>
                        </tr>
                      );
                    })}

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
      {strategyBenchmarksSet === 0 && (
        <div className="bp-notice ol-notice">
          <b>Only Own Production has a budget.</b> B2B, Recruitment and Affinity are the branch&apos;s, and{' '}
          <code>outlook.strategy_benchmark</code> hangs off a person — so as of this stage there is nowhere to save
          their budget, and their columns from {monthLabel(remainingMonths[0] ?? currentMonth)} on are{' '}
          <b>blank, not zero</b>: nothing has been decided, rather than a decision that nothing is expected. NPPM does
          have a benchmark per realtor, defaulting to their 3-month average, and it does not project yet either. The
          SQL to store a budget per branch is in <code>docs/sql</code>, not applied.
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
