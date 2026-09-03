'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import RecruitEditor, { RECRUITMENT_BRANCH, branchOptions } from '@/app/outlook/components/RecruitEditor';
import RecruitRampEditor from '@/app/outlook/components/RecruitRampEditor';
import type { Ramp } from '@/lib/outlook/recruitment';
import { composeYear, currentMonthByBranch, projectBranch, type OutlookData } from '@/lib/outlook/loadData';
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

/**
 * La rampa, en el botón que la abre: `25% · 50% · 100%`.
 *
 * ⚠ SE LEE DE `data.recruitRamp` y no se escribe a mano. Es la revisión vigente
 * de `outlook.recruitment_ramp`, así que el botón muestra lo que el motor está
 * usando de verdad -- un `25% · 50% · 100%` literal seguiría diciendo eso
 * después de que alguien la cambie.
 */
function rampaTexto(r: Ramp): string {
  const p = (v: number) => Math.round(v * 100) + '%';
  return `${p(r.month1)} · ${p(r.month2)} · ${p(r.month3Plus)}`;
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
  const [panel, setPanel] = useState<'ramp' | 'new' | null>(null);
  /* Los datos vienen del contexto del layout: una sola carga para las dos
     vistas. Ver `lib/outlook/useOutlookData.tsx`. */
  const { data, error, reload } = useOutlookDataContext();

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

  const { monthsOfYear, actualMonths, currentMonth, remainingMonths } = data;
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

  /* La fila de doce meses de cada branch, armada por la misma función. */
  const rows = data.branches.map((b) => ({
    branch: b,
    year: composeYear(monthsOfYear, currentMonth, b.actualByMonth, currentCell(b), projectBranch(b, remainingMonths)),
  }));

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
  const rowsActivos = rows.filter((r) => !r.branch.isInactive && !esMarcador(r.branch.branchCode));
  const rowsInactivos = rows.filter((r) => r.branch.isInactive && !esMarcador(r.branch.branchCode));
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
          </p>
        </div>
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
              {
                titulo: 'Inactive',
                nota: 'no active producer on the roster · counts in the division total · nothing to set here',
                lista: rowsInactivos,
              },
              {
                titulo: 'Not assigned yet',
                nota: 'people in hiring with no branch decided · they project here until someone assigns them',
                lista: rowsMarcador,
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
                {lista.map(({ branch: b, year: y }) => (
              <tr
                key={b.branchCode}
                className="metric bp-row-link"
                tabIndex={0}
                role="link"
                onClick={() => router.push('/outlook/branch/' + b.branchCode)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push('/outlook/branch/' + b.branchCode);
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
                  {isInactive(b.branchCode) && !esMarcador(b.branchCode) && (
                    <span className="bp-muted ol-tag">Inactive</span>
                  )}
                </td>
              </tr>
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
        ══════════════════════════════════════════════════════════════════════
        LAS HERRAMIENTAS DE RECLUTAMIENTO DEL MÓDULO — etapa OL21
        ══════════════════════════════════════════════════════════════════════

        La rampa y el alta a mano. Estaban dentro de la vista de un branch, y
        sólo en los que ya tenían gente en proceso: en el 747 sí y en el 724 no.
        Las dos son decisiones del MÓDULO --la rampa rige para los diecisiete
        branches, y un alta todavía no tiene branch-- así que vivían en el lugar
        que las hacía parecer de un branch y las escondía en los demás.

        Acá se dibujan siempre, al lado de la tabla de la división, que es donde
        una decisión de toda la división corresponde.

        ⚠ SÓLO SI HAY DÓNDE GUARDAR. Igual que `monthlyModeAvailable` con el modo
        mes a mes: sin las tres tablas de OL20 aplicadas, alguien llenaría el
        formulario para descubrir al apretar Guardar que no hay tabla.
      */}
      {data.diagnostics.recruitTablesAvailable && (
        <p className="ol-recbar">
          <span className="ol-recbar__lbl">In hiring</span>
          <span>
            {data.diagnostics.recruitsRead} in the hiring process · ramp
          </span>
          <button type="button" className="ol-pill" onClick={() => setPanel('ramp')}>
            {rampaTexto(data.recruitRamp)}
          </button>
          <button type="button" className="ol-pill ol-pill--empty" onClick={() => setPanel('new')}>
            + Add someone
          </button>
          <span>the same ramp for everyone, in every branch</span>
        </p>
      )}

      {panel === 'ramp' && (
        <RecruitRampEditor
          ramp={data.recruitRamp}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            void reload();
          }}
        />
      )}

      {panel === 'new' && (
        <RecruitEditor
          recruit={null}
          /*
            ⚠ TODOS, Y `Recruitment` PRIMERO. Es el valor por defecto del
            formulario, asi que tiene que estar entre las opciones -- excluirlo
            era la mitad del bug del desplegable que OL21 arregla.
          */
          branches={branchOptions(data.branches.map((b) => b.branchCode))}
          /* En un alta no hay a quien vincular todavia: la fila no existe. */
          roster={[]}
          currentMonth={currentMonth}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            void reload();
          }}
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

      <div className="bp-diagnostics">
        <div>
          Bands: <code>{actualMonths.length}</code> actual · <code>{monthLabel(currentMonth)}</code> forecast ·{' '}
          <code>{remainingMonths.length}</code> budgeted · edits apply from <code>{data.effectiveFrom}</code>
        </div>
        <div>
          YTD rows counted: <code>{data.diagnostics.ytdRowsCounted.toLocaleString('en-US')}</code> of{' '}
          <code>{data.diagnostics.activityRowsRead.toLocaleString('en-US')}</code> read ·{' '}
          <code>{data.diagnostics.strategyBenchmarkRows}</code> strategy benchmarks ·{' '}
          <code>{data.diagnostics.growthRuleRows}</code> growth rules
        </div>
        {/*
          Las dos lecturas de "cuánto cerró este mes". No es un chequeo interno:
          si difieren, el tooltip del mes en curso y la banda real cuentan cosas
          distintas, y eso hay que verlo acá antes de que aparezca como un
          descuadre en una reunión.
        */}
        <div>
          {monthLabel(currentMonth)} closed —{' '}
          <code>{data.diagnostics.currentMonthClosedRecords}</code> per activity ·{' '}
          <code>{data.diagnostics.currentMonthClosedForecast}</code> per forecast (inside the forecast column)
          {data.diagnostics.currentMonthClosedRecords !== data.diagnostics.currentMonthClosedForecast && (
            <>
              {' '}
              — <b>they differ</b>: two systems count the month&apos;s closings, like July&apos;s 57 against 59 in Commercial
              Activity. The month column uses Forecast&apos;s.
            </>
          )}
        </div>
        {/*
          De donde sale la LISTA de gente, que desde OL7 la decide el roster y no
          `org.employee_branch`. Los tres numeros son cotejables contra la base y
          explican por que la lista cambio de 34 personas a 37.

          ⚠ Y son la senal de que el roster se esta leyendo. Habia un aviso
          dedicado para eso, que se quito al aplicarse las policies; si algun dia
          la tabla vuelve a devolver vacio, "0 active producers" es lo que lo
          dice. Vale mirar el claim de su policy antes que el codigo: la RLS no
          rechaza, filtra.
        */}
        <div>
          <code>{data.diagnostics.activeProducers}</code> active producers in the roster ·{' '}
          <code>{data.diagnostics.producersWithoutIdentity}</code> without internal identity ·{' '}
          <code>{data.diagnostics.closedButNotProducing}</code> shown only because they closed
        </div>
        {/*
          ⚠ CERO BENCHMARKS DE ESTRATEGIA NO ES UN CONTEO, ES UN AVISO.
          El numero ya estaba en la linea de arriba, entre otros dos, y ahi se
          lee como estadistica. Pero con cero cargados TODO el presupuesto por
          estrategia proyecta cero salvo Own Production --que lee su benchmark de
          `org.employee_benchmark`, no de `outlook`-- y eso se ve igual que si el
          negocio no esperara nada de B2B ni de NPPM.

          Las 185 reglas de crecimiento no lo tapan: una regla multiplica un
          benchmark, y sobre cero da cero. Estan guardadas y no proyectan nada.

          Mismo criterio que el aviso del roster: la pantalla dice lo que no se
          puede deducir mirandola.
        */}
        {/*
          El aviso sobre el presupuesto de estrategias se fue en OL12: ahora se
          edita en la tabla del branch, y el lápiz es más claro que un párrafo.
          Los conteos de arriba siguen siendo la señal de si hay algo cargado.
        */}
        {data.diagnostics.unresolvedOfficers > 0 && (
          <div className="bp-diagnostics__warn">
            <code>{data.diagnostics.unresolvedOfficers.toLocaleString('en-US')}</code> closed loans whose loan officer
            did not resolve against the roster — they are not counted in any branch.
          </div>
        )}
      </div>
    </div>
  );
}
