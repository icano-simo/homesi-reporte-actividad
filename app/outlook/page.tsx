'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { composeYear, loadOutlookData, projectBranch, type OutlookData } from '@/lib/outlook/loadData';

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
  const [data, setData] = useState<OutlookData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const closedThisMonth = data.branches.reduce((a, b) => a + b.closedToDate, 0);

  return (
    <div className="hub-container">
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
        <div className="bp-notice bp-notice--warn" style={{ marginBottom: '16px' }}>
          No se puede leer el esquema <code>outlook</code>, así que no hay benchmarks de estrategia ni reglas de
          crecimiento y las columnas del presupuesto caen al benchmark de Own Production. Los meses cerrados y el mes en
          curso sí son reales. Si el SQL de <code>docs/sql/2026-08-outlook-schema.sql</code> ya se aplicó, falta el paso
          que no es SQL: <b>Settings → API → Exposed schemas → agregar <code>outlook</code></b>.
        </div>
      )}

      {/*
        Producción real con mes posterior al actual: hoy imposible, y si pasara
        la tabla estaría tapándola con el presupuesto. Se avisa en vez de dejar
        que aparezca como una diferencia sin causa.
      */}
      {data.diagnostics.actualsAfterCurrentMonth > 0 && (
        <div className="bp-notice bp-notice--warn" style={{ marginBottom: '16px' }}>
          Hay <b>{data.diagnostics.actualsAfterCurrentMonth}</b> préstamo(s) cerrado(s) con mes posterior a{' '}
          {monthLabel(currentMonth)}. Esas columnas están mostrando el presupuesto, así que esa producción real no se ve.
          Hay que revisar <code>closing_month</code> antes de usar el total del año.
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
                        `${b.unattributed} préstamo(s) cerrado(s) en este branch por personas que no son Loan ` +
                        `Officers de la división (están en org.source_name_excluded, con motivo escrito). ` +
                        `Commercial Activity los cuenta porque mide el branch; Outlook no, porque presupuesta ` +
                        `producción de la división. Cerrados atribuibles del año: ${b.ytd}.`
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
                          ? `Sin pronóstico: nadie tiene este branch en su roster, y el pronóstico del mes se carga al ` +
                            `branch del roster de cada persona. Se muestra lo ya cerrado del mes ` +
                            `(${b.actualByMonth[currentMonth] ?? 0}), que es un piso real y no un pronóstico.`
                          : `Pronóstico del mes: ${b.closedToDate} ya cerraron (según Forecast, por roster) y el resto ` +
                            `es pipeline con su tasa. Los cerrados están DENTRO de este número, no al lado. La ` +
                            `actividad cuenta ${b.actualByMonth[currentMonth] ?? 0} cerrado(s) en este branch este mes, ` +
                            `atribuidos por préstamo — los dos criterios son distintos y los dos legítimos.`
                        : m > currentMonth && projectsNothing(b.branchCode)
                          ? `${b.branchCode} no proyecta: no hay Loan Officers con este branch en su roster. Sus ${b.ytd} ` +
                            `cerrados del año son reales; la proyección se carga al branch del roster de cada persona. ` +
                            `A quién pertenece este presupuesto está pendiente de definir.`
                          : undefined
                    }
                  >
                    {fmt(y.byMonth[m] ?? null)}
                  </td>
                ))}
                <td className="bp-center totcol">
                  {fmt(y.total)}
                  {b.ytd > 0 && projectsNothing(b.branchCode) && (
                    <span className="bp-muted ol-tag">sin LO asignados</span>
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

      {/* Las cosas que un número de esta tabla necesita para leerse. */}
      <div className="foot-note" style={{ marginTop: '14px' }}>
        <b>Tres clases de número en una fila.</b> <b>{actualMonths.length ? 'Ene–' + monthLabel(actualMonths[actualMonths.length - 1]) : 'La banda real'}</b>{' '}
        es lo cerrado, leído de la actividad. <b>{monthLabel(currentMonth)}</b> es el pronóstico de Forecast, y{' '}
        <b>ya incluye los {closedThisMonth} que cerraron</b> en el mes — por eso no hay una columna de YTD aparte: los
        meses reales son el YTD, y sumarle el mes en curso contaría agosto dos veces.{' '}
        <b>{remainingMonths.length ? monthLabel(remainingMonths[0]) + '–Dic' : 'El presupuesto'}</b> es benchmark ×
        regla de crecimiento, la única parte que se decide en este módulo.{' '}
        <b>El total del año</b> es la suma de las doce columnas, nada más.{' '}
        <b>Donde no hay pronóstico</b> —un branch que nadie tiene en su roster— la columna del mes muestra lo ya
        cerrado, que es un piso real y no una proyección: sin eso, AFFINITY perdía los 5 que cerró en el mes. El tooltip
        de cada celda dice cuál de las dos lecturas está mostrando.{' '}
        <b>El <span className="bp-muted">+N</span> junto al branch</b> son préstamos de ese branch cerrados por personas
        que no son Loan Officers de HomeSí — Commercial Activity los cuenta, un presupuesto de división no.{' '}
        <b>Real y presupuesto se atribuyen distinto</b>: lo cerrado va al branch del PRÉSTAMO; el pronóstico y el
        presupuesto, al branch del ROSTER de cada persona, porque son un número por persona y no se pueden repartir.{' '}
        <b>Un branch con <span className="bp-muted">sin LO asignados</span></b> tiene cerrados reales pero no proyecta:
        nadie lo tiene en su roster. A quién pertenece ese presupuesto está pendiente de definir.
      </div>

      <div className="bp-diagnostics" style={{ marginTop: '16px' }}>
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
              — <b>distintas</b>: dos sistemas cuentan el cierre del mes, como los 57 contra 59 de julio en Commercial
              Activity. La columna del mes usa la de Forecast.
            </>
          )}
        </div>
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
