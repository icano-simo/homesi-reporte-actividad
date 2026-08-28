'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  loadOutlookData,
  projectBranch,
  yearTotal,
  type OutlookData,
} from '@/lib/outlook/loadData';

/**
 * ============================================================================
 * OUTLOOK — VISTA 1: todas las branches × meses (etapa OL1)
 * ============================================================================
 *
 * Las 13 branches de división por fila; por columna, YTD, el mes en curso, un
 * mes por cada uno que queda del año, y el total.
 *
 * ⚠ NINGUNA celda se calcula acá. YTD y mes en curso vienen leídos (ver la
 * cabecera de `lib/outlook/loadData.ts`); los meses futuros salen de
 * `projectBranch`, que es la suma de los Loan Officers, que es la suma de sus
 * cinco estrategias. Esta pantalla sólo formatea.
 *
 * Los meses se derivan de la fecha del sistema: `remainingMonthsOf` recorre
 * hasta diciembre y devuelve vacío EN diciembre, sin ninguna fecha escrita a
 * mano. En enero la tabla vuelve a tener once columnas de proyección sola.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.split('-')[1]) - 1];
}

/** Entero cuando lo es, un decimal cuando no: el mes en curso es un pronóstico. */
function fmt(n: number): string {
  if (!n) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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

  const months = data.remainingMonths;
  const projectedByBranch = new Map(data.branches.map((b) => [b.branchCode, projectBranch(b, months)]));

  /* Los totales de la fila final son la suma de las filas, sin recalcular. */
  const totalYtd = data.branches.reduce((a, b) => a + b.ytd, 0);
  const totalCurrent = data.branches.reduce((a, b) => a + b.currentMonth, 0);
  const totalByMonth: Record<string, number> = {};
  for (const m of months) {
    totalByMonth[m] = data.branches.reduce((a, b) => a + (projectedByBranch.get(b.branchCode)?.[m] ?? 0), 0);
  }

  return (
    <div className="hub-container">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Outlook</h1>
          <p className="page-head__subtitle">
            Projection for the rest of {data.currentMonth.split('-')[0]} — by branch, loan officer and strategy
          </p>
        </div>
      </div>

      {/*
        El aviso NO es decoración: sin las tablas de `outlook` aplicadas, los
        benchmarks de las cuatro estrategias nuevas son 0 y las proyecciones
        salen en 0. Un cero sin explicación se lee como "no va a cerrar nada".
      */}
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
          crecimiento y las columnas proyectadas caen al benchmark de Own Production. YTD y el mes en curso sí son
          reales. Si el SQL de <code>docs/sql/2026-08-outlook-schema.sql</code> ya se aplicó, falta el paso que no es
          SQL: <b>Settings → API → Exposed schemas → agregar <code>outlook</code></b>.
        </div>
      )}

      <div className="tbl-scroll">
        <table className="piv bp-table--los">
          <colgroup>
            <col className="bp-col-name" />
            <col className="bp-col-metric" />
            <col className="bp-col-metric" />
            {months.map((m) => (
              <col key={m} className="bp-col-metric" />
            ))}
            <col className="bp-col-status" />
          </colgroup>
          <thead>
            <tr className="mo-row">
              <th className="lbl">Branch</th>
              <th className="bp-center">YTD</th>
              <th className="bp-center">{monthLabel(data.currentMonth)} (current)</th>
              {months.map((m) => (
                <th key={m} className="bp-center">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center">Year total</th>
            </tr>
          </thead>
          <tbody>
            {data.branches.map((b) => {
              const projected = projectedByBranch.get(b.branchCode) ?? {};
              return (
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
                  <td className="lbl">{b.branchCode}</td>
                  {/*
                    ⚠ El "+N sin atribuir" no es un detalle: es la explicación de
                    por qué este YTD no coincide con el de Commercial Activity.
                    Allá el 747 marca 51 y acá 47, y la diferencia son 4
                    préstamos de gente que no pertenece a la división. Sin este
                    número, alguien que compara las dos pantallas concluye que
                    una está mal.
                  */}
                  <td className={'bp-center' + (b.ytd ? '' : ' zero')}>
                    {fmt(b.ytd)}
                    {b.unattributed > 0 && (
                      <span
                        className="bp-muted"
                        style={{ fontSize: '10.5px', marginLeft: '5px' }}
                        title={
                          `${b.unattributed} préstamo(s) cerrado(s) en este branch por personas que no son Loan ` +
                          `Officers de la división (están en org.source_name_excluded, con motivo escrito). ` +
                          `Commercial Activity los cuenta porque mide el branch; Outlook no, porque presupuesta ` +
                          `producción de la división.`
                        }
                      >
                        +{b.unattributed} sin atribuir
                      </span>
                    )}
                  </td>
                  <td className={'bp-center' + (b.currentMonth ? '' : ' zero')}>{fmt(b.currentMonth)}</td>
                  {months.map((m) => (
                    <td key={m} className={'bp-center' + (projected[m] ? '' : ' zero')}>
                      {fmt(projected[m] ?? 0)}
                    </td>
                  ))}
                  <td className="bp-center">{fmt(yearTotal(b.ytd, b.currentMonth, projected))}</td>
                </tr>
              );
            })}
            <tr className="metric" style={{ fontWeight: 700 }}>
              <td className="lbl">Total</td>
              <td className="bp-center">{fmt(totalYtd)}</td>
              <td className="bp-center">{fmt(totalCurrent)}</td>
              {months.map((m) => (
                <td key={m} className="bp-center">
                  {fmt(totalByMonth[m])}
                </td>
              ))}
              <td className="bp-center">{fmt(yearTotal(totalYtd, totalCurrent, totalByMonth))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        Las tres cosas que un número de esta tabla necesita para leerse, y que
        no se deducen mirándola.
      */}
      <div className="foot-note" style={{ marginTop: '14px' }}>
        <b>YTD</b>: cerrados del año atribuibles a la división. Un{' '}
        <span className="bp-muted">+N sin atribuir</span> son préstamos de ese branch cerrados por personas que no son
        Loan Officers de HomeSí — Commercial Activity los cuenta, un presupuesto de división no.{' '}
        <b>Mes actual y proyección</b>: se cargan al branch del roster de cada persona, no al del préstamo. Son un número
        por persona y no se pueden repartir; Forecast agrega por branch del préstamo, así que los dos criterios son
        legítimos y distintos.{' '}
        <b>Los meses proyectados</b>: con la regla inicial de 25% trimestral desde septiembre, el benchmark ES el
        objetivo de septiembre y el primer aumento cae en <b>diciembre</b> — por eso Sep, Oct y Nov salen iguales. No es
        un error de la tabla.
      </div>

      <div className="bp-diagnostics" style={{ marginTop: '16px' }}>
        <div>
          Months projected: <code>{months.length ? months.map(monthLabel).join(' · ') : '(none — December)'}</code> ·
          current <code>{monthLabel(data.currentMonth)}</code> · edits apply from{' '}
          <code>{data.effectiveFrom}</code>
        </div>
        <div>
          YTD rows counted: <code>{data.diagnostics.ytdRowsCounted.toLocaleString('en-US')}</code> of{' '}
          <code>{data.diagnostics.activityRowsRead.toLocaleString('en-US')}</code> read ·{' '}
          <code>{data.diagnostics.strategyBenchmarkRows}</code> strategy benchmarks ·{' '}
          <code>{data.diagnostics.growthRuleRows}</code> growth rules
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
