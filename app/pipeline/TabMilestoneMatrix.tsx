'use client';

import { useState } from 'react';
import type { PipelineLoan } from '@/lib/pipeline/types';
import {
  countByBrokeredMilestoneBucket,
  type PullThroughRates,
  type BrokeredPullThroughRates,
  type BucketCounts,
  type BrokeredBucketCounts,
} from '@/lib/pipeline/aggregate';
import MilestoneCascade, { type MilestoneCascadeRow } from './MilestoneCascade';
import type { BranchForecastRow } from './PivotTable';
import LoanDetailModal, { type LoanDetailModalLoan } from './LoanDetailModal';

export interface TabMilestoneMatrixProps {
  bankedRows: MilestoneCascadeRow[];
  brokeredRows: MilestoneCascadeRow[];
  bankedRates: PullThroughRates;
  brokeredRates: BrokeredPullThroughRates;
  /** Ajuste post-F6f: filas por branch (mismo tipo/mismo dato que ya recibe PivotTable) -- alimenta la matriz Branch x Milestone nueva. */
  rows: BranchForecastRow[];
  /**
   * Etapa F5j-b: Closed y Total Forecast de Brokered YA calculados por
   * branch en page.tsx (la misma fuente que la tab Projected Forecast,
   * antes "Executive Branch Forecast" -- renombrada en UX9) --
   * se le pasan a MilestoneCascade para que su fila de total sea ese mismo
   * número, no uno recalculado acá. Banked no usa estos 2 props: su cascada
   * sigue mostrando solo la proyección (sin Closed), sin cambios.
   */
  brokeredClosedCount: number;
  brokeredTotalForecast: number;
}

type Channel = 'banked' | 'brokered';
type MetricView = 'total' | 'healthy';

/**
 * Ajuste post-F6f: los 3 valores crudos de Current Milestone que
 * MILESTONE_BUCKET (lib/pipeline/sources/salesforce-file.ts) colapsa en el
 * bucket único 'Underwriting' de Banked. Se desagregan acá SOLO para la
 * vista de la matriz -- el cálculo de pull-through no cambia, sigue
 * usando la tasa combinada de Underwriting sobre el conteo total de las 3
 * juntas (row.bucketTotal.Underwriting/row.bucketHealthy.Underwriting,
 * intactos, alimentan MilestoneCascade exactamente igual que antes).
 */
const UNDERWRITING_RAW_MILESTONES = ['Submittal', 'Initial Decision', 'Resubmittal'] as const;

/** Etapa UX8: ancho fijo (%) de la columna de total por fila en la matriz Branch x Milestone -- ver colgroup más abajo. */
const MATRIX_TOTAL_COL_PERCENT = 12;

function isUnderwritingRawMilestone(key: string): key is (typeof UNDERWRITING_RAW_MILESTONES)[number] {
  return (UNDERWRITING_RAW_MILESTONES as readonly string[]).includes(key);
}

/**
 * Columnas fijas de la matriz para Banked -- NO Object.keys(bankedRates)
 * (esa solo tiene las 4 keys de pull-through: Started/Processing/
 * Underwriting/Closing, no las 6 de esta vista). Started/Processing/
 * Closing siguen siendo 1 columna = 1 bucket real de countByMilestoneBucket,
 * sin cambios; Underwriting se reemplaza acá por sus 3 Current Milestone
 * crudos. Brokered sigue usando Object.keys(brokeredRates) tal cual (ver
 * `milestoneKeys` más abajo), sus 4 buckets ya están completos y correctos.
 */
const BANKED_MATRIX_COLUMNS: string[] = ['Started', 'Processing', ...UNDERWRITING_RAW_MILESTONES, 'Closing'];

/** Mismo filtro Total/Healthy que ya aplicaban bankedRawMilestoneCount/bucketsForRow -- extraído para reusarlo también en el filtro por celda del modal (ajuste posterior), en vez de repetir el ternario en cada función nueva. */
function applyMetricFilter(loans: PipelineLoan[], metricView: MetricView): PipelineLoan[] {
  return metricView === 'total' ? loans : loans.filter((l) => l.healthy === true);
}

/**
 * Lista (no solo conteo) de préstamos Banked con ese rawMilestone exacto
 * (.trim(), mismo criterio de comparación que usa MILESTONE_BUCKET en el
 * parser) -- countByMilestoneBucket ya los colapsó en un solo bucket
 * 'Underwriting', así que para desagregarlos en la vista hace falta volver
 * al dato crudo. Un préstamo con un rawMilestone fuera de MILESTONE_BUCKET
 * ya fue descartado por el parser (con warning) antes de llegar acá -- no
 * aparece en ninguna columna, mismo comportamiento que tenía el bucket
 * 'Underwriting' combinado.
 */
function bankedRawMilestoneLoans(row: BranchForecastRow, rawMilestone: string, metricView: MetricView): PipelineLoan[] {
  return applyMetricFilter(row.loans, metricView).filter((l) => l.rawMilestone.trim() === rawMilestone);
}

/** Ajuste posterior: bankedRawMilestoneCount ahora reusa bankedRawMilestoneLoans en vez de duplicar el filtro -- mismo resultado de siempre, solo se le agregó una función hermana que devuelve la lista completa para el modal. */
function bankedRawMilestoneCount(row: BranchForecastRow, rawMilestone: string, metricView: MetricView): number {
  return bankedRawMilestoneLoans(row, rawMilestone, metricView).length;
}

/** Started/Processing/Closing de Banked -- estos 3 SÍ están bucketizados 1:1 en `loan.milestone` (a diferencia de Underwriting, que colapsa 3 rawMilestone distintos), así que el filtro es directo contra ese campo, sin necesidad de rawMilestone. */
function bankedBucketLoans(row: BranchForecastRow, milestone: string, metricView: MetricView): PipelineLoan[] {
  return applyMetricFilter(row.loans, metricView).filter((l) => l.milestone === milestone);
}

/**
 * Espejo local de BROKERED_MILESTONE_BUCKET (lib/pipeline/aggregate.ts,
 * NO exportada -- countByBrokeredMilestoneBucket() solo devuelve conteos
 * agregados, no permite filtrar préstamos individuales, y aggregate.ts
 * está fuera de la lista de archivos de este ajuste). Valores verificados
 * contra el código real de aggregate.ts antes de escribir esto:
 * Started->FileCreation, Processing->Processing, Submittal->Submitted.
 * 'AppDate' no tiene ningún rawMilestone real que mapee ahí -- la columna
 * siempre da 0, mismo criterio ya documentado para BANKED_MATRIX_COLUMNS
 * (ver riesgo 10 en docs/ARQUITECTURA.md). Si aggregate.ts cambia ese
 * mapeo el día de mañana, esta copia queda desactualizada en silencio --
 * mismo riesgo ya aceptado ahí, no uno nuevo.
 */
const BROKERED_COLUMN_TO_RAW_MILESTONE: Partial<Record<string, string>> = {
  FileCreation: 'Started',
  Processing: 'Processing',
  Submitted: 'Submittal',
};

function brokeredColumnLoans(row: BranchForecastRow, columnKey: string, metricView: MetricView): PipelineLoan[] {
  const rawMilestone = BROKERED_COLUMN_TO_RAW_MILESTONE[columnKey];
  if (!rawMilestone) return [];
  return applyMetricFilter(row.loans, metricView).filter((l) => l.rawMilestone.trim() === rawMilestone);
}

/** Dispatcher único para el click de celda -- decide qué filtro aplicar según canal/columna, sin que el JSX tenga que saber los detalles de cada caso. */
function cellLoans(row: BranchForecastRow, channel: Channel, key: string, metricView: MetricView): PipelineLoan[] {
  if (channel === 'banked') {
    return isUnderwritingRawMilestone(key) ? bankedRawMilestoneLoans(row, key, metricView) : bankedBucketLoans(row, key, metricView);
  }
  return brokeredColumnLoans(row, key, metricView);
}

/** Suma los forecast ya calculados por fila -- MilestoneCascadeProps.forecastTotal es obligatorio y no viene como prop separado acá, así que se deriva de las mismas rows que se muestran (mismo total que ya suman internamente esas rows, no es un cálculo nuevo). */
function sumForecast(rows: MilestoneCascadeRow[]): number {
  return rows.reduce((sum, r) => sum + r.forecast, 0);
}

function fmtPct(rate: number): string {
  return (rate * 100).toFixed(1) + '%';
}

/**
 * "FileCreation" -> "File Creation" -- transformación genérica por regex, no
 * una lista de nombres hardcodeados (funciona igual para las keys de Banked o
 * de Brokered, cualquiera sea el set real). Etapa UX9: 'Closing' es la única
 * excepción explícita -- el rótulo visible pasa a ser "CTC + Closing" (acá y
 * en el título del modal de celda, que reusa esta misma función), pero la key
 * `Closing` de BucketCounts (aggregate.ts) y toda la lógica que la usa NO
 * cambian, solo este texto de display.
 *
 * Ajuste posterior: el rótulo era "Clear to Close" (ocultaba la palabra
 * "Closing" del todo, pese a que la columna combina AMBOS milestones crudos
 * -- mismo bucket combinado que el desglose "X CTC + X Closing" ya muestra
 * en Forecast/PivotTable.tsx). Pasa a "CTC + Closing" para que quede
 * explícito que son las dos etiquetas fusionadas, no solo una de ellas.
 */
function labelFromKey(key: string): string {
  if (key === 'Closing') return 'CTC + Closing';
  return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Ajuste post-F6f: bucketTotal/bucketHealthy de BranchForecastRow (page.tsx,
 * countByMilestoneBucket aplicado sin importar el canal) son REALES para
 * Banked, pero VESTIGIALES para Brokered -- quedan con las keys de Banked
 * (Started/Processing/Underwriting/Closing), no las reales de Brokered
 * (FileCreation/AppDate/Processing/Submitted). Ver nota en page.tsx donde se
 * arman (línea ~317: "nadie los lee para una fila Brokered"). Para Brokered
 * se recalculan acá desde `row.loans` con countByBrokeredMilestoneBucket
 * (aggregate.ts, sin tocar) -- mismo patrón que ya usa page.tsx para el
 * total combinado de Brokered (brokeredBucketTotal/brokeredBucketHealthy).
 * Sin este ajuste, la matriz de Brokered mostraría columnas Started/
 * Processing/Underwriting/Closing con números que no son los milestones
 * reales de Brokered -- justo arriba de la cascada de abajo, que sí los
 * muestra bien.
 */
function bucketsForRow(
  row: BranchForecastRow,
  channel: Channel
): { total: BucketCounts | BrokeredBucketCounts; healthy: BucketCounts | BrokeredBucketCounts } {
  if (channel === 'banked') {
    return { total: row.bucketTotal, healthy: row.bucketHealthy };
  }
  const healthyLoans = row.loans.filter((l) => l.healthy === true);
  return {
    total: countByBrokeredMilestoneBucket(row.loans),
    healthy: countByBrokeredMilestoneBucket(healthyLoans),
  };
}

/** BucketCounts/BrokeredBucketCounts (aggregate.ts, sin tocar) no declaran index signature -- se angosta el cast acá, en el único punto donde hace falta indexar por una key dinámica, no sobre el objeto completo (mismo criterio ya usado abajo para `rates`). */
function bucketValue(bucket: BucketCounts | BrokeredBucketCounts, key: string): number {
  return (bucket as unknown as Record<string, number>)[key] ?? 0;
}

/**
 * Etapa F6f: tab "Pipeline by Milestone" (renombrado en UX8, era "Milestone
 * Pipeline Matrix" -- el nombre del archivo/componente no cambió, solo el
 * texto visible en TabNavigation.tsx) -- selector de canal (Banked -
 * Retail / Brokered, sin tercera opción combinada, a propósito: cada canal
 * tiene su propia cascada con buckets/tasas incompatibles entre sí, ver
 * aggregate.ts) + toggle Total/Healthy + cuadro de Pull-Through Rates con
 * los valores reales del canal activo (nunca hardcodeados).
 *
 * Ajuste post-F6f: se agrega la matriz Branch x Milestone real (filas=branch,
 * columnas=milestone del canal activo, celda=Total o Healthy según el
 * toggle) ARRIBA de la cascada. El selector de canal y el toggle Total/
 * Healthy ahora sí tienen efecto sobre algo: el canal filtra las 2 tablas
 * (matriz + cascada), el toggle Total/Healthy solo afecta la matriz nueva
 * (MilestoneCascade sigue mostrando Healthy y Total juntas, sin cambios,
 * fuera del alcance de este ajuste).
 *
 * Reusa MilestoneCascade tal cual (rows ya vienen armadas desde afuera, F6h
 * decide cómo) -- no se reimplementa la tabla.
 */
export default function TabMilestoneMatrix({
  bankedRows,
  brokeredRows,
  bankedRates,
  brokeredRates,
  rows,
  brokeredClosedCount,
  brokeredTotalForecast,
}: TabMilestoneMatrixProps) {
  const [channel, setChannel] = useState<Channel>('banked');
  const [metricView, setMetricView] = useState<MetricView>('total');
  const [modal, setModal] = useState<{ context: string; metric: string; loans: LoanDetailModalLoan[] } | null>(null);

  // Click en una celda de la matriz: arma el mismo filtro que ya usa esa celda
  // para contar (cellLoans), pero devolviendo la lista completa en vez del
  // número. rawHealthiness siempre está presente acá (son PipelineLoan,
  // pipeline abierto -- a diferencia de las filas "Closed" de PivotTable, que
  // vienen de ResolvedLoan y no tienen ese campo).
  //
  // Etapa UX1: abre el modal centrado (LoanDetailModal) en vez del modal
  // centrado, y el título se parte en contexto + métrica.
  function openCellModal(row: BranchForecastRow, key: string) {
    const loans = cellLoans(row, channel, key, metricView);
    setModal({
      context: `Branch ${row.branch} — ${channel === 'banked' ? 'Banked - Retail' : 'Brokered'}`,
      metric: labelFromKey(key),
      loans: loans.map((loan) => ({
        sourceLoanId: loan.sourceLoanId,
        // Etapa F6: crudos para el realtor del NPPM. Ver LoanDetailModalLoan.
        branch: loan.branch,
        strategyRaw: loan.strategyRaw,
        opportunityOwnerTitle: loan.opportunityOwnerTitle,
        opportunityOwner: loan.opportunityOwner,
        nppmRealtor: loan.nppmRealtor,
        referredBy: loan.referredBy,
        borrowerName: loan.borrowerName,
        loanOfficer: loan.loanOfficer,
        amount: loan.amount,
        rawMilestone: loan.rawMilestone,
        rawHealthiness: loan.rawHealthiness,
        branchTransferred: loan.branchTransferred,
        loanType: loan.loanType,
        loanProgram: loan.loanProgram,
        noteHistory: loan.noteHistory,
        // Etapa PROPERTY-STATE-1: fuera del alcance de archivos declarado,
        // mecánicamente inevitable -- ver el comentario en PivotTable.tsx.
        propertyState: loan.propertyState,
      })),
    });
  }

  const cascadeRows = channel === 'banked' ? bankedRows : brokeredRows;
  const rates = channel === 'banked' ? bankedRates : brokeredRates;

  const channelValue: BranchForecastRow['channel'] = channel === 'banked' ? 'Banked - Retail' : 'Brokered';
  const filteredByChannel = rows.filter((r) => r.channel === channelValue);
  // Ajuste post-F6f: Banked usa las 6 columnas fijas (Underwriting
  // desagregado en vista, ver BANKED_MATRIX_COLUMNS) -- Brokered sigue
  // igual que antes, las keys de `rates` (ya viene por canal, real, sin
  // lista fija), así la matriz sigue mostrando las columnas correctas
  // incluso si ese canal no tiene ningún branch en `filteredByChannel` (ej.
  // filtraste a un branch que solo tiene préstamos Banked, y elegís ver
  // Brokered).
  const milestoneKeys = channel === 'banked' ? BANKED_MATRIX_COLUMNS : Object.keys(rates);

  // Etapa UX9: se saca el cálculo por fila del .map() del JSX (antes vivía
  // inline dentro del <tbody>) para poder derivar columnTotals/grandTotal sin
  // recalcular rowValues una segunda vez. Mismo resultado de siempre por fila
  // -- rowTotal sigue siendo la suma de rowValues, no row.totalCount/
  // healthyCount (mismo motivo ya documentado abajo, en el comentario
  // original: para Brokered esos 2 números pueden diferir de lo mostrado).
  const rowsWithValues = filteredByChannel.map((row) => {
    const { total, healthy } = bucketsForRow(row, channel);
    const active = metricView === 'total' ? total : healthy;
    const values = milestoneKeys.map((k) =>
      channel === 'banked' && isUnderwritingRawMilestone(k) ? bankedRawMilestoneCount(row, k, metricView) : bucketValue(active, k)
    );
    const rowTotal = values.reduce((sum, v) => sum + v, 0);
    return { row, values, rowTotal };
  });
  // Etapa UX9: totales por columna, agregados a la matriz junto con el total
  // por fila (UX8). La celda esquina (grandTotal) es matemáticamente igual a
  // la suma de columnTotals (por construcción) y a la suma de rowTotal de
  // cada fila (asociatividad de la suma sobre la misma grilla) -- reconciliado
  // también con datos reales en el reporte de esta etapa, no solo asumido.
  const columnTotals = milestoneKeys.map((_, i) => rowsWithValues.reduce((sum, r) => sum + r.values[i], 0));
  const grandTotal = columnTotals.reduce((sum, v) => sum + v, 0);

  return (
    <div>
      {/* Spec §4D.1: selector de canal (Banked por defecto) + selector de métrica. */}
      <div className="control-bar">
        <div className="control-group">
          <span className="label-chip">Channel</span>
          <div className="seg">
            <button className={channel === 'banked' ? 'on' : ''} onClick={() => setChannel('banked')}>
              Banked - Retail
            </button>
            <button className={channel === 'brokered' ? 'on' : ''} onClick={() => setChannel('brokered')}>
              Brokered
            </button>
          </div>
        </div>
        <div className="control-group">
          <span className="label-chip">Metric</span>
          <div className="seg">
            <button className={metricView === 'total' ? 'on' : ''} onClick={() => setMetricView('total')}>
              Total Pipeline
            </button>
            <button className={metricView === 'healthy' ? 'on' : ''} onClick={() => setMetricView('healthy')}>
              Healthy Pipeline
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-card">
        <div className="tbl-card__head">
          <span className="tbl-card__title">Branch × Milestone Breakdown</span>
          <span className="badge badge--pill badge--sky">
            {metricView === 'total' ? 'Total Pipeline' : 'Healthy Pipeline'}
          </span>
        </div>
        <div className="tbl-scroll">
          <table className="piv piv--matrix">
            {/* Primera columna fija en %, el resto repartido en
                partes iguales segun cuantos milestones tenga el canal activo --
                asi la matriz llena el ancho exacto sin desbordar.
                Etapa UX8: se resta el % de la columna Total (fija, 12%) del
                presupuesto de 84% que antes se repartían solo los milestones,
                así la tabla sigue sin desbordar con una columna más. */}
            <colgroup>
              <col className="matrix-branch-col" />
              {milestoneKeys.map((k) => (
                <col key={k} style={{ width: `${((84 - MATRIX_TOTAL_COL_PERCENT) / milestoneKeys.length).toFixed(2)}%` }} />
              ))}
              <col style={{ width: `${MATRIX_TOTAL_COL_PERCENT}%` }} />
            </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">Branch</th>
                {milestoneKeys.map((k) => (
                  <th key={k}>{labelFromKey(k)}</th>
                ))}
                {/* Etapa UX8: columna de total por fila -- `totcol` es la
                    misma clase que ya usa PivotTable.tsx para su columna de
                    total (borde izquierdo + fondo distinto + bold), así se
                    lee como "total" con el mismo lenguaje visual del resto
                    de la app, no como un milestone más. */}
                <th className="totcol">Total</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithValues.map(({ row, values, rowTotal }) => (
                <tr className="metric" key={row.branch}>
                  <td className="lbl">{row.branch}</td>
                  {milestoneKeys.map((k, i) => {
                    const value = values[i];
                    return (
                      <td className="val" key={k}>
                        {/* Spec §4D.2: el 0 va apagado y sin affordance de
                            click (no hay préstamos que auditar detrás). */}
                        {value === 0 ? (
                          <span className="cell-trigger is-zero">0</span>
                        ) : (
                          <button type="button" className="cell-trigger" onClick={() => openCellModal(row, k)}>
                            {value}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  {/* No es clickeable -- es la suma de las celdas de al
                      lado, no una lista de préstamos propia que auditar
                      (cada milestone individual ya es auditable). */}
                  <td className="val totcol">{rowTotal}</td>
                </tr>
              ))}
              {!filteredByChannel.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={milestoneKeys.length + 2}>
                    No branches for this channel.
                  </td>
                </tr>
              )}
              {/* Etapa UX9: fila de totales por columna, además del total por
                  fila (UX8). `tr.grp.total td` ya está estilado de forma
                  genérica en components.css -- se reusa sin CSS nuevo. */}
              {!!filteredByChannel.length && (
                <tr className="grp total">
                  <td className="lbl">Total</td>
                  {columnTotals.map((v, i) => (
                    <td className="val" key={milestoneKeys[i]}>
                      {v}
                    </td>
                  ))}
                  <td className="val totcol">{grandTotal}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-label" style={{ marginTop: '24px' }}>
        Pull-through Cascade
      </div>
      {/*
       * Etapa F5j-b: Brokered SÍ recibe closedCount/totalForecast (a
       * diferencia de Banked, que sigue sin pasarlos, sin cambios) -- así su
       * fila de total pasa a ser "Closed + Projection" y muestra EXACTAMENTE
       * el mismo número que el Forecast de Brokered en Executive Branch
       * Forecast (misma fuente: brokeredSummary en page.tsx), en vez de
       * recalcular su propia proyección con otra partición de redondeo. Ver
       * docs/ARQUITECTURA.md, Etapa F5j-b, para por qué hacía falta esto.
       */}
      <MilestoneCascade
        rows={cascadeRows}
        forecastTotal={sumForecast(cascadeRows)}
        closedCount={channel === 'brokered' ? brokeredClosedCount : undefined}
        totalForecast={channel === 'brokered' ? brokeredTotalForecast : undefined}
      />

      {/* Banked: MilestoneCascade sigue en modo "sin desglose de cerrados" --
          su "Total Forecast" es solo la proyección de pull-through, sin
          cambios de F5j-b. Brokered: desde F5j-b el total de esta cascada YA
          incluye Closed y coincide con Executive -- el texto de abajo lo
          dice explícito en vez de repetir la aclaración vieja, que para
          Brokered dejó de ser cierta. */}
      <p className="foot-note">
        {channel === 'banked'
          ? 'This total reflects pull-through projection only and does not include already-closed loans. See Projected Forecast for the combined figure (closed + projection).'
          : 'This total already includes Closed loans (Closed + Projection) and matches the Brokered figure shown in Projected Forecast.'}
      </p>

      {/* Spec §4D.3: tarjeta de Pull-Through Rates al pie del tab. */}
      <div className="tbl-card" style={{ marginTop: '24px', padding: '16px' }}>
        <div className="section-label">Pull-Through Rates — {channel === 'banked' ? 'Banked - Retail' : 'Brokered'}</div>
        <div className="pt-rate-grid">
          {/*
           * PullThroughRates/BrokeredPullThroughRates (aggregate.ts, sin tocar) no
           * declaran index signature -- Object.entries(rates) igual compila (su
           * firma no la exige), pero el array resultante queda tipado [string,
           * unknown][] en vez de [string, number][]. Se angosta acá, en el punto
           * exacto donde se itera -- no se le miente a TS sobre la forma de
           * `rates` completo, solo sobre la de este array puntual.
           */}
          {(Object.entries(rates) as [string, number][]).map(([key, rate]) => (
            <div className="pt-rate" key={key}>
              <span className="pt-rate__label">{labelFromKey(key)}</span>
              <span className="badge badge--pill badge--emerald">{fmtPct(rate)}</span>
            </div>
          ))}
        </div>
      </div>

      <LoanDetailModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        context={modal?.context ?? ''}
        metric={modal?.metric ?? ''}
        loans={modal?.loans ?? []}
        showChannelColumn={false}
      />
    </div>
  );
}
