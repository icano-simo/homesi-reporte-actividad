'use client';

import { useRouter } from 'next/navigation';
import { composeYear, projectBranch, type OutlookData } from '@/lib/outlook/loadData';
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
function fmt(n: number | null): string {
  if (n === null) return '—';
  if (!n) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** La banda a la que pertenece un mes. Es también su clase de color. */
function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
}

export default function OutlookPage() {
  const router = useRouter();
  /* Los datos vienen del contexto del layout: una sola carga para las dos
     vistas. Ver `lib/outlook/useOutlookData.tsx`. */
  const { data, error } = useOutlookDataContext();

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
  const projectsNothing = (code: string) =>
    !data.branches.find((b) => b.branchCode === code)?.loanOfficers.some((l) => l.primaryBranch === code);

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
  const currentCell = (b: OutlookData['branches'][number]) =>
    projectsNothing(b.branchCode) ? (b.actualByMonth[currentMonth] ?? 0) : b.currentMonth;

  /* La fila de doce meses de cada branch, armada por la misma función. */
  const rows = data.branches.map((b) => ({
    branch: b,
    year: composeYear(monthsOfYear, currentMonth, b.actualByMonth, currentCell(b), projectBranch(b, remainingMonths)),
  }));

  /* Los totales de la fila final son la suma de las filas, sin recalcular. */
  const totalByMonth: Record<string, number | null> = {};
  for (const m of monthsOfYear) {
    totalByMonth[m] = rows.reduce((a, r) => a + (r.year.byMonth[m] ?? 0), 0);
  }
  const grandTotal = rows.reduce((a, r) => a + r.year.total, 0);

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
            {rows.map(({ branch: b, year: y }) => (
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
                  ⚠ El "+N sin atribuir" no es un detalle: es la explicación de
                  por qué este año no coincide con el de Commercial Activity.
                  Allá el 747 marca 51 y acá 47, y la diferencia son 4 préstamos
                  de gente que no pertenece a la división. Sin este número,
                  alguien que compara las dos pantallas concluye que una está mal.

                  En OL3 se movió al nombre del branch: la columna de YTD, donde
                  vivía, ya no existe -- los meses reales SON el YTD.
                */}
                <td className="lbl">
                  {b.branchCode}
                  {b.unattributed > 0 && (
                    <span
                      className="bp-muted ol-tag"
                      title={
                        `${b.unattributed} loan(s) closed in this branch by people who are not division Loan ` +
                        `Officers (they are in org.source_name_excluded, each with a written reason). Commercial ` +
                        `Activity counts them because it measures the branch; Outlook does not, because it budgets ` +
                        `division production. Attributable closings this year: ${b.ytd}.`
                      }
                    >
                      +{b.unattributed}
                    </span>
                  )}
                </td>
                {monthsOfYear.map((m) => (
                  <td
                    key={m}
                    className={
                      'bp-center ol-m ol-m--' + bandOf(m, currentMonth) + (y.byMonth[m] ? '' : ' zero')
                    }
                    title={
                      m === currentMonth
                        ? projectsNothing(b.branchCode)
                          ? `No forecast: nobody has this branch on their roster, and the month's forecast is charged ` +
                            `to each person's roster branch. What is shown is what already closed this month ` +
                            `(${b.actualByMonth[currentMonth] ?? 0}) — a real floor, not a forecast.`
                          : `Month forecast: ${b.closedToDate} already closed (per Forecast, by roster) and the rest is ` +
                            `pipeline with its rate. Closings are INSIDE this number, not next to it. Activity counts ` +
                            `${b.actualByMonth[currentMonth] ?? 0} closing(s) in this branch this month, attributed by ` +
                            `loan — the two criteria differ and both are legitimate.`
                        : m > currentMonth && projectsNothing(b.branchCode)
                          ? `${b.branchCode} does not project: no Loan Officer has this branch on their roster. Its ` +
                            `${b.ytd} closings this year are real; the projection is charged to each person's roster ` +
                            `branch. Who owns this budget is still to be decided.`
                          : undefined
                    }
                  >
                    {fmt(y.byMonth[m] ?? null)}
                  </td>
                ))}
                <td className="bp-center totcol">
                  {fmt(y.total)}
                  {b.ytd > 0 && projectsNothing(b.branchCode) && (
                    <span className="bp-muted ol-tag">no LOs assigned</span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="metric" style={{ fontWeight: 700 }}>
              <td className="lbl">Total</td>
              {monthsOfYear.map((m) => (
                <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {fmt(totalByMonth[m] ?? null)}
                </td>
              ))}
              <td className="bp-center totcol">{fmt(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

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
        */}
        <div>
          <code>{data.diagnostics.activeProducers}</code> active producers in the roster ·{' '}
          <code>{data.diagnostics.producersWithoutIdentity}</code> without internal identity ·{' '}
          <code>{data.diagnostics.closedButNotProducing}</code> shown only because they closed
        </div>
        {/*
          ⚠ ESTE AVISO ES EL MAS IMPORTANTE DEL PIE.
          Un roster ilegible no se nota mirando: la pantalla sale llena, con la
          lista anterior --la de `org.employee_branch`-- y numeros plausibles.
          Asi se descubrio en el desarrollo de OL7: parecia bien y mostraba a
          alguien que ya no produce, y le faltaban dos productores activos.
          `org.roster_current` devuelve cero filas SIN error cuando la policy no
          aplica: la RLS no rechaza, filtra.
        */}
        {!data.diagnostics.rosterAvailable && (
          <div className="bp-diagnostics__warn">
            <b>org.roster_current could not be read</b> — this list is the previous one, built from{' '}
            <code>org.employee_branch</code>. It looks complete but it is not: it can include people who no longer
            produce and miss active producers. The table returns zero rows without an error when no policy applies, so
            this line is the only signal. Needs the <code>outlook</code> read policy —{' '}
            <code>docs/sql/2026-08-outlook-roster-read.sql</code>.
          </div>
        )}
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
