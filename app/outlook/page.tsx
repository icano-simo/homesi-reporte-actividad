'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RECRUITMENT_BRANCH } from '@/app/outlook/components/RecruitEditor';
import {
  composeYear,
  currentMonthByBranch,
  projectBranch,
  projectLoanOfficer,
  type OutlookData,
  type YearRow,
} from '@/lib/outlook/loadData';
import { personasDe, strategyRowsOf } from '@/lib/outlook/strategyRows';
import { OUTLOOK_STRATEGIES, type OutlookStrategy } from '@/lib/outlook/project';
import { remainingMonthsFor } from '@/lib/outlook/horizon';
import { fmt, sumOfShown } from '@/lib/outlook/format';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';

/**
 * ============================================================================
 * OUTLOOK — VISTA 1: todas las branches × LOS DOCE MESES (etapas OL1 y OL3)
 * ============================================================================
 *
 * Las branches por fila; por columna, los doce meses del año y el total.
 *
 * ⚠ NINGUNA celda se calcula acá. Los meses reales vienen leídos de
 * `loan_records_v2`, el mes en curso es el pronóstico que ya calcula Forecast, y
 * los meses futuros salen de `projectBranch`, que es la suma de los Loan
 * Officers, que es la suma de sus cinco estrategias. Esta pantalla formatea y
 * rotula; `composeYear` es la que decide qué pedazo va en cada mes.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES BANDAS SON UNA PARTICIÓN, Y ESO ES EL PUNTO — etapa OL3
 * ---------------------------------------------------------------------------
 * real (ene–jul) · pronóstico (agosto) · presupuesto (sep–dic). Cada mes está en
 * una sola banda, así que el total del año no puede contar nada dos veces.
 *
 * La versión anterior --`YTD | mes en curso | sep..dic`-- sí podía, y lo hacía:
 * ver el bloque del doble conteo en `composeYear`. Las bandas se rotulan en una
 * fila de cabecera propia porque tres tipos de número distintos en una misma
 * fila, sin decir cuál es cuál, invitan a compararlos como si fueran lo mismo.
 *
 * Nada de esto está escrito a mano: los meses salen de `monthsOfYear` y la
 * frontera de `currentMonth`, así que en enero la banda real queda vacía y en
 * diciembre queda vacía la del presupuesto, sin tocar este archivo.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.split('-')[1]) - 1];
}

/**
 * Entero cuando lo es, un decimal cuando no. Tres estados y no dos:
 *   `—` no se puede saber · `–` cero · el número
 */
/** La banda a la que pertenece un mes. Es también su clase de color. */
function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
}

/* `rampaTexto` se fue con la barra, a `OutlookTopBar` -- etapa OL22. */

/** Una persona en el desglose de un branch filtrado por estrategia — OL21. */
interface PersonaFila {
  name: string;
  year: YearRow;
}

export default function OutlookPage() {
  const router = useRouter();
  /*
   * El panel abierto: la rampa global o el alta a mano -- etapa OL21. Los dos
   * son del módulo, así que su estado vive en esta vista y no en un branch.
   *
   * ⚠ El hook va ANTES de los early returns. React exige el mismo orden de
   * hooks en cada render, y abajo hay dos `return` que salen antes de la tabla.
   */
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ EL FILTRO DE ESTRATEGIA — etapa OL21
   * ══════════════════════════════════════════════════════════════════════════
   *
   * `null` = todas, que es la tabla que ya existía. Con una estrategia elegida,
   * cada fila de branch muestra los números DE esa estrategia y se puede abrir
   * para ver su gente.
   *
   * ⚠ NO ESCONDE BRANCHES, y es una decisión de Isabella con un motivo: un
   * branch que aparece vacío dice algo --"acá no hay B2B"-- y uno que desaparece
   * hace que el total deje de ser el de la división, que es exactamente el
   * defecto que la otra mitad de esta etapa vino a arreglar.
   *
   * ⚠ Y NO SE DESPLIEGAN TODOS DE UNA. Trece branches abiertos a la vez es una
   * pantalla ilegible; el clic para abrir uno es barato.
   */
  const [filtro, setFiltro] = useState<OutlookStrategy | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  /* Los datos vienen del contexto del layout: una sola carga para las dos
     vistas. Ver `lib/outlook/useOutlookData.tsx`. */
  const { data, error, horizonMonths } = useOutlookDataContext();

  if (error) {
    return (
      <div className="hub-container">
        <div className="bp-empty">Could not load Outlook: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hub-container">
        <div className="bp-empty">Loading the year&apos;s outlook…</div>
      </div>
    );
  }

  /*
   * ⚠ LOS MESES SALEN DEL HORIZONTE DEL MODULO — etapa OL22, no de `data`.
   *
   * `data.monthsOfYear` es siempre el ano calendario. Con el selector arriba,
   * esta tabla tiene que estirarse igual que la de un branch: si no, el control
   * estaria ahi sin hacer nada en la mitad del modulo -- el "lapiz que no hacia
   * nada" otra vez.
   *
   * Por defecto (`horizonMonths === null`) da exactamente los doce meses del
   * ano, asi que quien no lo toca ve lo de antes.
   */
  const { actualMonths, currentMonth } = data;
  const remainingMonths = remainingMonthsFor(currentMonth, horizonMonths);
  const monthsOfYear = [...actualMonths, currentMonth, ...remainingMonths];
  const year = currentMonth.split('-')[0];

  /*
   * ⚠ Branches con producción y SIN nadie que proyecte -- se define antes de
   * armar las filas porque la celda del mes en curso depende de esto.
   *
   * La proyección se carga al branch del ROSTER de cada persona, así que un
   * branch donde nadie está rosterizado no proyecta nada aunque tenga cerrados.
   * AFFINITY es el caso, y 741 y 771 aparecieron solos al generalizarlo.
   *
   * No se calcula distinto -- se EXPLICA. Un YTD de 31 con proyección cero y sin
   * texto se reporta como bug, y quien lo reporta tiene razón en preguntar.
   * A quién pertenece ese presupuesto es una decisión de negocio pendiente.
   */
  /*
   * ⚠ AHORA SALE DEL LOADER Y NO DE `loanOfficers` — etapa OL21.
   *
   * Antes se preguntaba "¿alguien de la lista tiene este branch como primario?",
   * que no es lo mismo: `loanOfficers` incluye a los `outsiders` de OL16 --gente
   * cuyo branch de roster es otro y que cerró acá-- así que un branch con un
   * cierre ajeno podía contestar que sí. Medido: el 741 tiene 2 cierres de
   * Nathan Martinez, que en el roster no es del 741.
   *
   * `isInactive` le pregunta al ROSTER, que es quien decide. Y la regla es por
   * dato: el 741 vuelve a activo solo el día que le asignen a alguien.
   */
  const isInactive = (code: string) => data.branches.find((b) => b.branchCode === code)?.isInactive ?? false;

  /*
   * ============================================================================
   * ⚠ LA CELDA DEL MES EN CURSO — el pronóstico, o lo real cuando no hay ninguno
   * ============================================================================
   *
   * Etapa OL3. El pronóstico se atribuye por el branch del ROSTER de cada persona;
   * lo cerrado, por el branch del PRÉSTAMO. Son dos criterios distintos y los dos
   * legítimos -- ya está dicho para las otras columnas.
   *
   * En el mes en curso eso tiene una consecuencia que la primera versión de esta
   * tabla se comió: un branch donde NADIE está rosterizado tiene pronóstico 0, así
   * que su mes en curso salía en 0 y sus cierres reales del mes desaparecían.
   * Medido: AFFINITY cerró 5 en agosto, su YTD de referencia es 31 y la fila
   * sumaba 26. Cinco préstamos reales, borrados por una proyección que nadie pidió.
   *
   * La regla: si hay pronóstico, manda el pronóstico --que YA incluye lo cerrado
   * del mes, así que no se le suma nada--; si no hay, se muestra lo cerrado del
   * mes, que es un piso real y no un pronóstico. Y el tooltip dice siempre las dos
   * lecturas, para que una diferencia entre ellas se vea en vez de deducirse.
   */
  /*
   * Entero, y repartido para que la columna sume el total. Ver
   * `currentMonthByBranch` en el loader: la misma función la usa la tabla de un
   * branch, así que las dos pantallas muestran el mismo número.
   */
  const currentByBranch = currentMonthByBranch(data);
  const currentCell = (b: OutlookData['branches'][number]) => currentByBranch.get(b.branchCode) ?? 0;

  /*
   * La fila de doce meses de cada branch, armada por la misma función.
   *
   * ⚠ CON FILTRO, LA FILA ES LA DE LA ESTRATEGIA, y sale de `strategyRowsOf` --
   * la MISMA función que usa la vista de un branch. No se recalcula acá: dos
   * cálculos del mismo número se separan en el primer arreglo que se haga en uno
   * solo, y nada avisa porque cada uno suma bien por su cuenta.
   *
   * Un branch sin esa estrategia devuelve `null` y su fila sale vacía --no en
   * cero-- porque no tiene esa estrategia, no tiene cero de esa estrategia.
   */
  const rows = data.branches.map((b) => {
    const completa = composeYear(
      monthsOfYear,
      currentMonth,
      b.actualByMonth,
      currentCell(b),
      projectBranch(b, remainingMonths)
    );
    if (filtro === null) return { branch: b, year: completa, gente: [] as PersonaFila[] };

    const deEstrategia = strategyRowsOf(data, b, monthsOfYear, remainingMonths).find((r) => r.strategy === filtro);
    if (!deEstrategia) {
      return {
        branch: b,
        year: { byMonth: Object.fromEntries(monthsOfYear.map((m) => [m, null])) } as typeof completa,
        gente: [] as PersonaFila[],
      };
    }
    /*
     * Su gente, para el desglose. Sólo en las estrategias que se abren por
     * persona: NPPM se abre por realtor y B2B/Affinity por dueño de la
     * oportunidad, y meterlos acá como si fueran personas del branch diría algo
     * falso. Para esas, el desglose sigue estando donde vive: dentro del branch.
     */
    const gente: PersonaFila[] = personasDe(b, deEstrategia.bs).map((lo) => {
      const st = lo.strategies.find((x) => x.strategy === filtro);
      const pasos = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[filtro] ?? [];
      const proj: Record<string, number | null> = {};
      remainingMonths.forEach((m, i) => (proj[m] = pasos[i]?.value ?? 0));
      return {
        name: lo.fullName,
        year: composeYear(
          monthsOfYear,
          currentMonth,
          st?.actualByMonth ?? {},
          st?.actualByMonth[currentMonth] ?? 0,
          proj
        ),
      };
    });
    return { branch: b, year: deEstrategia.year, gente };
  });

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ DOS BLOQUES, Y LOS INACTIVOS AL FINAL — etapa OL21
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Pedido de Isabella, y la razón es de lectura: un branch que produjo cuatro
   * préstamos en enero y no tiene a nadie desde entonces, puesto entre los que
   * operan, se lee como un branch que anda mal. Puesto aparte se lee como lo que
   * es -- historia.
   *
   * ⚠ SIGUEN SUMANDO AL TOTAL DE LA DIVISIÓN. Separarlos es de presentación, no
   * de cuenta: la fila `Total` recorre `rows`, que son los dos bloques juntos.
   * Si algún día alguien filtra la lista, tiene que filtrar `rows` y no cada
   * bloque, o el total deja de ser el de la división -- que es exactamente el
   * defecto que esta etapa vino a arreglar.
   *
   * El orden DENTRO de cada bloque es el que ya traía el loader (por YTD), así
   * que no se reordena nada: sólo se parte en dos.
   */
  /*
   * ⚠ Y `Recruitment` NO ES NINGUNO DE LOS DOS, así que va en su propio bloque.
   *
   * Cumple la regla de `isInactive` --no tiene ni un productor en el roster-- y
   * aun así llamarlo "Inactive" seria falso: nunca estuvo activo. Es el marcador
   * de la gente en contratación que todavía no tiene branch asignado, así que su
   * fila en cero no es un branch que dejó de producir, es una cola de espera.
   *
   * Meterlo en el bloque `Inactive` lo ponía al lado del 741 --que sí produjo y
   * sí se quedó sin nadie-- y las dos filas se leían como lo mismo.
   */
  const esMarcador = (code: string) => code === RECRUITMENT_BRANCH;
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ AFFINITY OPERA, ASÍ QUE VA CON LOS ACTIVOS — etapa OL22
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Cumple `isInactive` --no tiene ni una fila en `org.roster_current`-- y aun
   * así llamarlo inactivo es falso: cerró 32 préstamos en ocho meses del año,
   * de enero a agosto, más que nueve de los branches que sí tienen gente. Lo
   * que no tiene es gente PROPIA: su producción la abren dos Account Executives
   * --Shirley Camargo y David Álvarez-- que pertenecen al roster de otros
   * branches.
   *
   * ⚠ ESO LO DISTINGUE DEL 741 Y DEL 771, que también cumplen `isInactive`: esos
   * produjeron y se quedaron sin nadie. AFFINITY nunca tuvo gente propia y sigue
   * produciendo. La regla del roster no alcanza para separarlos, así que la
   * excepción se escribe -- y se escribe con su motivo, no con su nombre.
   */
  const operaSinRoster = (code: string) => code === 'AFFINITY';
  const rowsActivos = rows.filter(
    (r) => (!r.branch.isInactive || operaSinRoster(r.branch.branchCode)) && !esMarcador(r.branch.branchCode)
  );
  const rowsInactivos = rows.filter(
    (r) => r.branch.isInactive && !operaSinRoster(r.branch.branchCode) && !esMarcador(r.branch.branchCode)
  );
  const rowsMarcador = rows.filter((r) => esMarcador(r.branch.branchCode));

  /**
   * El contenido de una celda de mes.
   *
   * ⚠ SÓLO CAMBIA PARA LOS INACTIVOS, y sólo a `null`. Un branch activo sigue
   * mostrando su cero: ahí un cero SÍ es información --estaba y no cerró-- y
   * vaciarlo perdería la diferencia con un mes que todavía no llegó.
   *
   * ⚠ Y NO TOCA `totalByMonth`. El total suma `y.byMonth`, que es el número de
   * verdad; esto es de presentación. Si el total se calculara sobre esto, vaciar
   * una celda haría bajar el total de la división -- y el 741 dejaría de aportar
   * sus 4 cierres, que es justo lo contrario de lo que la etapa vino a hacer.
   */
  const celda = (
    b: OutlookData['branches'][number],
    y: { byMonth: Record<string, number | null> },
    m: string
  ): number | null => {
    const v = y.byMonth[m] ?? null;
    if (!b.isInactive) return v;
    return v === 0 ? null : v;
  };

  /*
   * Los totales de la fila final son la suma de las filas, sin recalcular. El
   * del AÑO se calcula al mostrarlo, sumando lo que se ve -- ver `sumOfShown`.
   */
  const totalByMonth: Record<string, number | null> = {};
  for (const m of monthsOfYear) {
    totalByMonth[m] = rows.reduce((a, r) => a + (r.year.byMonth[m] ?? 0), 0);
  }

  return (
    <div className="hub-container ol-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Outlook</h1>
          <p className="page-head__subtitle">
            {year} month by month — {actualMonths.length} closed, {monthLabel(currentMonth)} forecast,{' '}
            {remainingMonths.length} budgeted
            {filtro !== null && (
              <>
                {' · '}
                <b>{filtro}</b> only
              </>
            )}
          </p>
        </div>
        {/*
          El filtro de estrategia — etapa OL21. Va en el encabezado y no arriba
          de la tabla, al lado del selector de horizonte de la otra vista: es una
          decisión sobre QUÉ se mira, no sobre una fila.
        */}
        <label className="ol-filter">
          <span className="ol-filter__lbl">Strategy</span>
          <select
            className="field"
            value={filtro ?? ''}
            onChange={(e) => {
              setFiltro((e.target.value || null) as OutlookStrategy | null);
              /* Al cambiar de estrategia se cierran los desgloses: los abiertos
                 eran de la anterior y dejarlos abiertos muestra otra cosa con la
                 misma forma. */
              setAbiertos(new Set());
            }}
          >
            <option value="">All strategies</option>
            {OUTLOOK_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
        ⚠ El aviso dice "no se puede LEER", no "no está aplicado". La diferencia
        importa y costó un rato: el esquema puede estar creado y sembrado --185
        reglas-- y aun así devolver 406, porque PostgREST sólo sirve los schemas
        de "Exposed schemas". Un aviso que dijera "no está aplicado" mandaría a
        alguien a correr un SQL que ya corrió.
      */}
      {!data.diagnostics.outlookTablesAvailable && (
        <div className="bp-notice bp-notice--warn">
          The <code>outlook</code> schema cannot be read, so there are no strategy benchmarks or growth rules and the
          budget columns fall back to the Own Production benchmark. Closed months and the current month are still real.
          If <code>docs/sql/2026-08-outlook-schema.sql</code> has already been applied, what is missing is the step that
          is not SQL: <b>Settings → API → Exposed schemas → add <code>outlook</code></b>.
        </div>
      )}

      {/*
        Producción real con mes posterior al actual: hoy imposible, y si pasara
        la tabla estaría tapándola con el presupuesto. Se avisa en vez de dejar
        que aparezca como una diferencia sin causa.
      */}
      {data.diagnostics.actualsAfterCurrentMonth > 0 && (
        <div className="bp-notice bp-notice--warn">
          <b>{data.diagnostics.actualsAfterCurrentMonth}</b> closed loan(s) have a month later than{' '}
          {monthLabel(currentMonth)}. Those columns are showing the budget, so that real production is not visible.
          Check <code>closing_month</code> before using the year total.
        </div>
      )}

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            {/*
              La fila de bandas. `colSpan` sale de la longitud de cada banda, no
              de un número escrito: en enero la banda real es 0 columnas y su
              <th> no se dibuja.
            */}
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
            </tr>
            <tr className="mo-row">
              <th className="lbl">Branch</th>
              {monthsOfYear.map((m) => (
                <th key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center totcol">{year}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { titulo: null, nota: null, lista: rowsActivos },
              /*
                ⚠ RECRUITMENT VA ANTES QUE LOS INACTIVOS — etapa OL22.
                Estaba al final y se leia como si fuera del mismo grupo. Es lo
                contrario: los inactivos dejaron de producir y esta es gente que
                todavia no empezo. El orden dice de que lado del tiempo esta
                cada bloque.
              */
              {
                titulo: 'Not assigned yet',
                nota: 'people in hiring with no branch decided · they project here until someone assigns them',
                lista: rowsMarcador,
              },
              {
                titulo: 'Inactive',
                nota: 'no active producer on the roster · counts in the division total · nothing to set here',
                lista: rowsInactivos,
              },
            ].map(({ titulo, nota, lista }) => (
              <Fragment key={titulo ?? 'active'}>
                {/*
                  El encabezado del bloque. No se dibuja si el bloque esta vacio:
                  un "Inactive" solo, sin filas debajo, se lee como un error de
                  la pantalla -- y el dia que a los cinco branches les asignen
                  gente, el bloque tiene que desaparecer solo.
                */}
                {titulo !== null && lista.length > 0 && (
                  <tr className="metric ol-blockhead">
                    <td className="lbl" colSpan={monthsOfYear.length + 2}>
                      {titulo}
                      <span className="bp-muted ol-tag">{nota}</span>
                    </td>
                  </tr>
                )}
                {lista.map(({ branch: b, year: y, gente }) => (
              <Fragment key={b.branchCode}>
              <tr
                className="metric bp-row-link"
                tabIndex={0}
                role="link"
                /*
                  ⚠ CON FILTRO, EL CLIC ABRE EL DESGLOSE; sin filtro, navega al
                  branch — etapa OL21.

                  Es la misma fila haciendo dos cosas, y la razón es que la
                  pregunta cambia: sin filtro se está eligiendo un branch para
                  ir a verlo; con filtro se está mirando UNA estrategia en toda
                  la división, y lo que se quiere es su gente sin perder la
                  comparación con los otros branches. Navegar ahí obligaría a
                  volver y re-elegir la estrategia para mirar el siguiente.
                */
                onClick={() => {
                  if (filtro === null) {
                    router.push('/outlook/branch/' + b.branchCode);
                    return;
                  }
                  setAbiertos((prev) => {
                    const next = new Set(prev);
                    if (next.has(b.branchCode)) next.delete(b.branchCode);
                    else next.add(b.branchCode);
                    return next;
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.currentTarget.click();
                  }
                }}
              >
                {/*
                  ⚠ ACÁ HABÍA UN "+N SIN ATRIBUIR" Y SE FUE — etapa OL11.

                  Contaba los préstamos cerrados en el branch por gente que no es
                  Loan Officer de la división, para explicar por qué este número
                  no coincide con Commercial Activity. La explicación sigue
                  haciendo falta, pero no acá: en una lista de dieciséis branches
                  son dieciséis etiquetas compitiendo con el código, y la pregunta
                  --"¿por qué el 747 marca 47 y allá 51?"-- se hace mirando UN
                  branch, no la lista.

                  Vive en el subtítulo de la vista del branch, donde además está
                  el otro "+N" con el que se confundía: los cerrados por Loan
                  Officers de OTRO branch.
                */}
                <td
                  className="lbl"
                  title={
                    b.unattributed > 0
                      ? `${b.unattributed} more closed in this branch by people who are not division Loan Officers. ` +
                        `Open the branch to see it broken down.`
                      : undefined
                  }
                >
                  {b.branchCode}
                </td>
                {monthsOfYear.map((m) => (
                  <td
                    key={m}
                    className={
                      /* Sin `.zero`: un cero ya se distingue por ser un 0 y no un numero. */
                      'bp-center ol-m ol-m--' + bandOf(m, currentMonth)
                    }
                    title={
                      m === currentMonth
                        ? isInactive(b.branchCode)
                          ? `No forecast: nobody has this branch on their roster, and the month's forecast is charged ` +
                            `to each person's roster branch. What is shown is what already closed this month ` +
                            `(${b.actualByMonth[currentMonth] ?? 0}) — a real floor, not a forecast.`
                          : `Month forecast: ${b.closedToDate} already closed (per Forecast, by roster) and the rest is ` +
                            `pipeline with its rate. Closings are INSIDE this number, not next to it. Activity counts ` +
                            `${b.actualByMonth[currentMonth] ?? 0} closing(s) in this branch this month, attributed by ` +
                            `loan — the two criteria differ and both are legitimate.`
                        : m > currentMonth && isInactive(b.branchCode)
                          ? `${b.branchCode} does not project: no Loan Officer has this branch on their roster. Its ` +
                            `${b.ytd} closings this year are real; the projection is charged to each person's roster ` +
                            `branch. Who owns this budget is still to be decided.`
                          : undefined
                    }
                  >
                    {/*
                      ⚠ VACÍO Y NO CERO en un branch inactivo — etapa OL21.

                      Un cero afirmaría que el branch estaba y no cerró nada. No
                      estaba: no tiene a nadie asignado. Los meses en que SÍ
                      produjo muestran su número, que es la parte que importa --
                      el 741 muestra 2 en enero y 2 en febrero, y el resto vacío.

                      Es la misma distinción que el módulo usa en todas partes:
                      cero es una decisión, vacío es que no hay ninguna.
                    */}
                    {fmt(celda(b, y, m))}
                  </td>
                ))}
                <td className="bp-center totcol">
                  {/* La suma de lo MOSTRADO -- ver `sumOfShown`. */}
                  {fmt(sumOfShown(monthsOfYear.map((m) => celda(b, y, m))))}
                  {/*
                    ⚠ DECÍA "no LOs assigned" Y AHORA DICE "Inactive" — OL21.

                    El texto viejo describía la CAUSA --nadie asignado-- y lo que
                    hace falta leer de un tirón es el ESTADO. La causa sigue
                    estando, en el tooltip de la celda y en el bloque en el que
                    la fila vive.
                  */}
                  {/*
                    ⚠ TRES ESTADOS Y NO DOS — etapa OL22. `isInactive` es una
                    sola pregunta al roster, pero contesta lo mismo para cosas
                    distintas: el 741 se quedo sin nadie, AFFINITY nunca tuvo
                    gente propia y sigue produciendo, y Recruitment es una cola
                    de espera. Una etiqueta unica los nombraria igual.
                  */}
                  {isInactive(b.branchCode) && !esMarcador(b.branchCode) && (
                    <span className="bp-muted ol-tag">
                      {operaSinRoster(b.branchCode) ? 'opens by account executive' : 'Inactive'}
                    </span>
                  )}
                </td>
              </tr>
              {/*
                El desglose: la gente del branch en esa estrategia. Sólo con
                filtro y sólo si el branch está abierto.

                ⚠ NO SUMA AL TOTAL, y no debe: `totalByMonth` recorre `rows`,
                que son las filas de BRANCH. Estas son sus hijas -- contarlas
                también sería contar la misma producción dos veces, que es
                exactamente lo que las tres bandas de OL3 vinieron a evitar.

                ⚠ Y SÓLO APARECE EN LAS ESTRATEGIAS QUE SE ABREN POR PERSONA.
                NPPM se abre por realtor y B2B/Affinity por dueño de la
                oportunidad, así que `gente` viene vacía: su desglose no son
                personas del branch y mostrarlo como si lo fueran diría algo
                falso. Para esas, el desglose sigue estando dentro del branch.
              */}
              {filtro !== null &&
                abiertos.has(b.branchCode) &&
                gente.map((p) => (
                  <tr key={b.branchCode + '|' + p.name} className="metric mrow">
                    <td className="lbl" style={{ paddingLeft: '26px' }}>
                      {p.name}
                    </td>
                    {monthsOfYear.map((m) => (
                      <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                        {fmt(p.year.byMonth[m] ?? null)}
                      </td>
                    ))}
                    <td className="bp-center totcol">
                      {fmt(sumOfShown(monthsOfYear.map((m) => p.year.byMonth[m] ?? null)))}
                    </td>
                  </tr>
                ))}
              {/*
                Un branch abierto que no tiene a nadie en esa estrategia lo dice.
                Sin esto, el clic no hace nada visible y se lee como un boton
                roto -- el mismo criterio del "lapiz que no hacia nada".
              */}
              {filtro !== null && abiertos.has(b.branchCode) && gente.length === 0 && (
                <tr className="metric mrow">
                  <td className="lbl bp-muted" colSpan={monthsOfYear.length + 2} style={{ paddingLeft: '26px' }}>
                    {`No ${filtro} broken down by person here — ${
                      filtro === 'NPPM'
                        ? 'NPPM opens by realtor'
                        : filtro === 'B2B' || filtro === 'Affinity'
                          ? 'it opens by opportunity owner'
                          : 'nobody in this branch takes part in it'
                    }. Open the branch to see it.`}
                  </td>
                </tr>
              )}
              </Fragment>
                ))}
              </Fragment>
            ))}
            <tr className="metric ol-total">
              <td className="lbl">Total</td>
              {monthsOfYear.map((m) => (
                <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {fmt(totalByMonth[m] ?? null)}
                </td>
              ))}
              <td className="bp-center totcol">{fmt(sumOfShown(monthsOfYear.map((m) => totalByMonth[m])))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        ⚠ LA BARRA DE RECLUTAMIENTO SE FUE A LA BARRA DEL MODULO — etapa OL22.
        En OL21 subio del branch a esta vista; ahora sube un escalon mas, al
        layout, para que este tambien dentro de un branch. Y el boton dice el
        estado --cuantos hay en proceso y cuantos con benchmark-- porque esas
        quince personas viven repartidas en cuatro branches y no habia forma de
        saber que existian sin recorrerlos.
      */}

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

      {/*
        ══════════════════════════════════════════════════════════════════════
        ⚠ ACÁ HABÍA CINCO RENGLONES DE DIAGNÓSTICO Y SE FUERON — etapa OL22
        ══════════════════════════════════════════════════════════════════════

        Decían las bandas, las filas leídas contra las contadas, los benchmarks
        y reglas cargados, las dos lecturas del mes en curso, los productores
        del roster y los cierres sin resolver. Cinco líneas debajo de la tabla,
        que sólo se leen la primera vez.

        Es el criterio de RPT4 y el mismo que ya vació este pie en OL6 y OL12:
        si algo necesita cinco renglones para explicarse, no va en la pantalla.

        ⚠ DÓNDE VIVE AHORA CADA COSA, porque no se perdió ninguna:

          las bandas            en la fila de cabecera de la tabla, que las
                                rotula y las separa con una línea
          desde cuándo rigen    en el editor, que lo dice al guardar
          los dos conteos del   en el tooltip de la celda del mes en curso, que
          mes en curso          dice siempre las dos lecturas
          los sin resolver      en la fila `LO out of branch` de cada branch y en
                                `outOfDivision`, CON NOMBRE -- que es más útil
                                que el conteo, y desde OL21 además ya no son "no
                                contados": suman al total de la división
          los productores y     en `data.diagnostics`, para quien lo mire desde
          las filas leídas      el código; ninguna decisión de la pantalla
                                depende de esos números

        ⚠ Lo único que NO se puede mirar en un tooltip es el estado del
        reclutamiento, así que ese subió al botón de la barra:
        `15 in process · 0 with target`.
      */}
    </div>
  );
}
