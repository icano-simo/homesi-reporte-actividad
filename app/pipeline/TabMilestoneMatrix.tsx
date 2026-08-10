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
import LoanDetailDrawer, { type LoanDetailDrawerLoan } from './LoanDetailDrawer';

export interface TabMilestoneMatrixProps {
  bankedRows: MilestoneCascadeRow[];
  brokeredRows: MilestoneCascadeRow[];
  bankedRates: PullThroughRates;
  brokeredRates: BrokeredPullThroughRates;
  /** Ajuste post-F6f: filas por branch (mismo tipo/mismo dato que ya recibe PivotTable) -- alimenta la matriz Branch x Milestone nueva. */
  rows: BranchForecastRow[];
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

/** "FileCreation" -> "File Creation" -- transformación genérica por regex, no una lista de nombres hardcodeados (funciona igual para las keys de Banked o de Brokered, cualquiera sea el set real). */
function labelFromKey(key: string): string {
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
 * Etapa F6f: tab "Milestone Pipeline Matrix" -- selector de canal (Banked -
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
export default function TabMilestoneMatrix({ bankedRows, brokeredRows, bankedRates, brokeredRates, rows }: TabMilestoneMatrixProps) {
  const [channel, setChannel] = useState<Channel>('banked');
  const [metricView, setMetricView] = useState<MetricView>('total');
  const [drawer, setDrawer] = useState<{ context: string; metric: string; loans: LoanDetailDrawerLoan[] } | null>(null);

  // Click en una celda de la matriz: arma el mismo filtro que ya usa esa celda
  // para contar (cellLoans), pero devolviendo la lista completa en vez del
  // número. rawHealthiness siempre está presente acá (son PipelineLoan,
  // pipeline abierto -- a diferencia de las filas "Closed" de PivotTable, que
  // vienen de ResolvedLoan y no tienen ese campo).
  //
  // Etapa UX1: abre el flyout lateral (LoanDetailDrawer) en vez del modal
  // centrado, y el título se parte en contexto + métrica.
  function openCellDrawer(row: BranchForecastRow, key: string) {
    const loans = cellLoans(row, channel, key, metricView);
    setDrawer({
      context: `Branch ${row.branch} — ${channel === 'banked' ? 'Banked - Retail' : 'Brokered'}`,
      metric: labelFromKey(key),
      loans: loans.map((loan) => ({
        sourceLoanId: loan.sourceLoanId,
        borrowerName: loan.borrowerName,
        loanOfficer: loan.loanOfficer,
        amount: loan.amount,
        rawMilestone: loan.rawMilestone,
        rawHealthiness: loan.rawHealthiness,
        branchTransferred: loan.branchTransferred,
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
          <table className="piv">
            <thead>
              <tr className="mo-row">
                <th className="lbl">Branch</th>
                {milestoneKeys.map((k) => (
                  <th key={k}>{labelFromKey(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredByChannel.map((row) => {
                const { total, healthy } = bucketsForRow(row, channel);
                const active = metricView === 'total' ? total : healthy;
                return (
                  <tr className="metric" key={row.branch}>
                    <td className="lbl">{row.branch}</td>
                    {milestoneKeys.map((k) => {
                      const value =
                        channel === 'banked' && isUnderwritingRawMilestone(k)
                          ? bankedRawMilestoneCount(row, k, metricView)
                          : bucketValue(active, k);
                      return (
                        <td className="val" key={k}>
                          {/* Spec §4D.2: el 0 va apagado y sin affordance de
                              click (no hay préstamos que auditar detrás). */}
                          {value === 0 ? (
                            <span className="cell-trigger is-zero">0</span>
                          ) : (
                            <button type="button" className="cell-trigger" onClick={() => openCellDrawer(row, k)}>
                              {value}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {!filteredByChannel.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={milestoneKeys.length + 1}>
                    No branches for this channel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-label" style={{ marginTop: '24px' }}>
        Pull-through Cascade
      </div>
      <MilestoneCascade rows={cascadeRows} forecastTotal={sumForecast(cascadeRows)} />

      {/* MilestoneCascade acá sigue en modo "sin desglose de cerrados" (no se le
          pasan closedCount/totalForecast) -- su "Total Forecast" es solo la
          proyección de pull-through, un número distinto al Forecast del
          banner/Executive (que sí suma cerrados). Se aclara con texto en vez de
          cambiar qué le pasamos al componente. */}
      <p className="foot-note">
        This total reflects pull-through projection only and does not include already-closed loans. See Executive Branch
        Forecast for the combined figure (closed + projection).
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

      <LoanDetailDrawer
        isOpen={drawer !== null}
        onClose={() => setDrawer(null)}
        context={drawer?.context ?? ''}
        metric={drawer?.metric ?? ''}
        loans={drawer?.loans ?? []}
      />
    </div>
  );
}
