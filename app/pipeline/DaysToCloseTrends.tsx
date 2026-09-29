'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import {
  computeDaysToCloseResults,
  groupDaysToCloseByDimension,
  buildDaysToCloseHistogram,
  buildDaysToCloseCtcToDisbHistogram,
  groupDaysToCloseByAppMonth,
  groupDaysToCloseByCtcMonth,
  groupDaysToCloseCtcToDisbByCtcMonth,
  groupDaysToCloseCtcToDisbByClosingMonth,
  dimensionLabel,
  type AverageDaysToCloseDimension,
  type DaysToCloseResult,
} from '@/lib/aggregation/buildAverageDaysToCloseByDimension';
import { shortMonth } from '@/lib/business-plan/months';
import { CloseIcon } from '@/components/ui/icons';
import DaysToCloseDimensionSelector, { DIMENSIONS } from '@/components/activity/DaysToCloseDimensionSelector';

export interface DaysToCloseTrendsProps {
  records: LoanRecord[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** 1 decimal para el promedio (es una división, casi nunca entero) -- min/max son conteos de días hábiles reales, siempre enteros, se muestran sin decimales. */
function fmtAvg(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

function fmtMinMax(n: number | null): string {
  return n === null ? '—' : fmtInt(n);
}

/** '2025-09' -> 'Sep 2025' -- mismo formato que ya usa CommercialActivityTrends.tsx para el mismo problema (2025 y 2026 conviven, "Sep" solo no alcanza). */
function monthYearLabel(ym: string): string {
  return shortMonth(ym) + ' ' + ym.slice(0, 4);
}

/** Las OTRAS 2 dimensiones (no la activa) -- columnas de contexto del modal de detalle. */
function otherDimensions(active: AverageDaysToCloseDimension): { key: AverageDaysToCloseDimension; label: string }[] {
  return DIMENSIONS.filter((d) => d.key !== active);
}

/**
 * ============================================================================
 * MODAL DE DETALLE POR GRUPO — Etapa AVG-DAYS-TO-CLOSE-4
 * ============================================================================
 *
 * Mismo patrón visual `.modal-*` que `app/pipeline/LoanDetailModal.tsx` y
 * `components/report/LoanDetailModal.tsx` -- pero NO reutiliza ninguno de
 * los dos componentes: los dos ya declaran explícito en su propio comentario
 * de cabecera que su dominio (Forecast/Pipeline uno, Commercial Activity el
 * otro) no es intercambiable con el de al lado, y `DaysToCloseResult` es un
 * tercer shape más (computado, con `days` ya resuelto) -- mismo criterio de
 * este repo ya aplicado dos veces: compartir el CSS, no el componente,
 * cuando el dominio difiere.
 */
function GroupDetailModal({
  groupLabel,
  dimension,
  rows,
  onClose,
}: {
  groupLabel: string;
  dimension: AverageDaysToCloseDimension;
  rows: DaysToCloseResult[];
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const contextCols = otherDimensions(dimension);
  const countLabel = rows.length.toLocaleString('en-US') + (rows.length === 1 ? ' Loan' : ' Loans');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box--wide" role="dialog" aria-modal="true" aria-label={groupLabel} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <div className="modal-eyebrow">{DIMENSIONS.find((d) => d.key === dimension)!.label}</div>
            <h2 className="modal-title">
              {groupLabel}
              <span className="badge badge--pill badge--sky">{countLabel}</span>
            </h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-table-scroll">
            <table className="piv">
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Loan Number</th>
                  <th>App Date</th>
                  <th>CTC Date</th>
                  <th>Business Days</th>
                  <th>Closing Date</th>
                  <th>Business Days (CTC→Disb)</th>
                  {contextCols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr className="metric" key={r.loanNumber}>
                    <td className="lbl" style={{ textAlign: 'left' }}>
                      {r.loanNumber}
                    </td>
                    <td className="val">{r.appDate}</td>
                    <td className="val">{r.ctcDate}</td>
                    <td className="val">{r.days === null ? '—' : fmtInt(r.days)}</td>
                    <td className="val">{r.closingDate ?? '—'}</td>
                    <td className="val">{r.daysCtcToDisb === null ? '—' : fmtInt(r.daysCtcToDisb)}</td>
                    {contextCols.map((c) => (
                      <td key={c.key} className="val">
                        {dimensionLabel(r, c.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * AVERAGE DAYS TO CLOSE (App → CTC) — Etapa AVG-DAYS-TO-CLOSE-2/3/4
 * ============================================================================
 *
 * Vive en `app/pipeline/` junto a `TabAnalytics.tsx`/`CommercialActivityTrends.tsx`
 * -- mismo criterio ya documentado en esos dos archivos: los componentes de
 * vista de Analytics conviven en esta carpeta sin importar qué ruta los monta
 * ni de qué schema salga el dato (éste, igual que `CommercialActivityTrends`,
 * lee `activity_report.loan_records_v2`, no `pipeline_forecast`).
 *
 * El cálculo por préstamo (`computeDaysToCloseResults`, las 445 llamadas a la
 * RPC) corre UNA sola vez, cuando `records` llega -- NO en cada cambio de
 * `dimension`. Tabla/Modal/Distribución/Tendencia mensual son 4 vistas
 * DISTINTAS sobre el mismo `results` cacheado -- ninguna vuelve a tocar la
 * RPC. Tres secciones visualmente separadas, sin sub-nav (Tabla,
 * Distribución, Tendencia mensual), siempre las 3 en la página a la vez.
 */
export default function DaysToCloseTrends({ records }: DaysToCloseTrendsProps) {
  const [dimension, setDimension] = useState<AverageDaysToCloseDimension>('branch');
  const [prevRecords, setPrevRecords] = useState(records);
  const [results, setResults] = useState<DaysToCloseResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalGroup, setModalGroup] = useState<string | null>(null);

  // Fix de lint (react-hooks/set-state-in-effect): el reset de
  // `results`/`error` al cambiar `records` se hace EN EL RENDER --patrón
  // que React documenta para "ajustar estado cuando cambia una prop"-- y no
  // dentro del efecto de abajo, que ya no llama a ningún `setState`
  // sincrónico (sólo dentro de `.then()`/`.catch()`, respondiendo a la
  // promesa). Sin cambio de comportamiento: el reset sigue disparándose
  // exactamente una vez por cada `records` nuevo.
  if (records !== prevRecords) {
    setPrevRecords(records);
    setResults(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    computeDaysToCloseResults(records)
      .then((r) => {
        if (cancelled) return;
        setResults(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [records]);

  const groups = useMemo(() => (results ? groupDaysToCloseByDimension(results, dimension) : null), [results, dimension]);
  // Etapa AVG-DAYS-TO-CLOSE-4: histograma y tendencia mensual -- SIEMPRE sobre
  // `results` completo, sin `dimension` en las deps: no cambian con el
  // selector.
  const histogram = useMemo(() => (results ? buildDaysToCloseHistogram(results) : null), [results]);
  const byAppMonth = useMemo(() => (results ? groupDaysToCloseByAppMonth(results) : null), [results]);
  const byCtcMonth = useMemo(() => (results ? groupDaysToCloseByCtcMonth(results) : null), [results]);
  // Etapa AVG-DAYS-TO-CLOSE-6: segundo tramo (CTC→Disbursement) -- distribución
  // y tendencia mensual propias, con su propio rango de buckets (ver
  // `daysHistogram` en el módulo de agregación); nunca comparten estado con
  // las de App→CTC de arriba.
  const histogramCtcToDisb = useMemo(() => (results ? buildDaysToCloseCtcToDisbHistogram(results) : null), [results]);
  const byCtcMonthCtcToDisb = useMemo(() => (results ? groupDaysToCloseCtcToDisbByCtcMonth(results) : null), [results]);
  const byClosingMonthCtcToDisb = useMemo(() => (results ? groupDaysToCloseCtcToDisbByClosingMonth(results) : null), [results]);

  const activeLabel = DIMENSIONS.find((d) => d.key === dimension)!.label;
  const modalRows = useMemo(
    () => (modalGroup !== null && results ? results.filter((r) => dimensionLabel(r, dimension) === modalGroup) : []),
    [modalGroup, results, dimension]
  );
  const maxHistogramCount = histogram ? Math.max(0, ...histogram.map((b) => b.count)) : 0;
  const maxHistogramCountCtcToDisb = histogramCtcToDisb ? Math.max(0, ...histogramCtcToDisb.map((b) => b.count)) : 0;

  return (
    <div>
      <DaysToCloseDimensionSelector value={dimension} onChange={setDimension} />

      {error && <span className="pill warn">{error}</span>}

      {groups === null && !error && (
        <div className="empty">
          <h2>Computing…</h2>
          <p>Calculating business days to close for {records.length.toLocaleString('en-US')} loans -- this runs once.</p>
        </div>
      )}

      {groups !== null && (
        <>
          {/* Sección 1: Tabla */}
          <div className="tbl-card">
            <div className="tbl-card__head">
              <span className="tbl-card__title">Average Days to Close (App → CTC), by {activeLabel}</span>
            </div>
            <div className="tbl-scroll">
              <table className="piv">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">{activeLabel}</th>
                    <th>Closed</th>
                    <th>Avg</th>
                    <th>Median</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Avg CTC→Disb</th>
                    <th>Median CTC→Disb</th>
                    <th>Min CTC→Disb</th>
                    <th>Max CTC→Disb</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr className="metric metric--drill" key={g.label} onClick={() => setModalGroup(g.label)}>
                      <td className="lbl" style={{ textAlign: 'left' }}>
                        {g.label}
                      </td>
                      <td className="val">{fmtInt(g.n)}</td>
                      <td className="val">{fmtAvg(g.avgBusinessDays)}</td>
                      <td className="val">{fmtAvg(g.medianBusinessDays)}</td>
                      <td className="val">{fmtMinMax(g.minBusinessDays)}</td>
                      <td className="val">{fmtMinMax(g.maxBusinessDays)}</td>
                      <td className="val">{fmtAvg(g.avgBusinessDaysCtcToDisb)}</td>
                      <td className="val">{fmtAvg(g.medianBusinessDaysCtcToDisb)}</td>
                      <td className="val">{fmtMinMax(g.minBusinessDaysCtcToDisb)}</td>
                      <td className="val">{fmtMinMax(g.maxBusinessDaysCtcToDisb)}</td>
                    </tr>
                  ))}
                  {!groups.length && (
                    <tr>
                      <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={10}>
                        No records for this dimension.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sección 2: Distribución (histograma) -- fija, no depende del selector */}
          {histogram && (
            <div className="tbl-card" style={{ marginTop: '20px' }}>
              <div className="tbl-card__head">
                <span className="tbl-card__title">Distribution — Business Days to Close (all {results!.length.toLocaleString('en-US')} loans)</span>
              </div>
              <div className="tbl-scroll">
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Business Days</th>
                      <th>Loans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {histogram.map((b) => (
                      <tr className="metric" key={b.label}>
                        <td className="lbl" style={{ textAlign: 'left' }}>
                          {b.label}
                        </td>
                        <td
                          className="val"
                          style={
                            maxHistogramCount > 0
                              ? {
                                  backgroundImage: `linear-gradient(to right, rgba(166, 222, 255, 0.35) ${(b.count / maxHistogramCount) * 100}%, transparent ${(b.count / maxHistogramCount) * 100}%)`,
                                }
                              : {}
                          }
                        >
                          {fmtInt(b.count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sección 3: Tendencia mensual -- 2 anclajes, fijos, no dependen del selector */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px', marginTop: '20px' }}>
            <div className="tbl-card">
              <div className="tbl-card__head">
                <span className="tbl-card__title">Monthly Trend — by App Date</span>
              </div>
              <div className="tbl-scroll">
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Month</th>
                      <th>Closed</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAppMonth?.map((row) => (
                      <tr className="metric" key={row.month}>
                        <td className="lbl" style={{ textAlign: 'left' }}>
                          {monthYearLabel(row.month)}
                        </td>
                        <td className="val">{fmtInt(row.n)}</td>
                        <td className="val">{fmtAvg(row.avgBusinessDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tbl-card">
              <div className="tbl-card__head">
                <span className="tbl-card__title">Monthly Trend — by CTC Date</span>
              </div>
              <div className="tbl-scroll">
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Month</th>
                      <th>Closed</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCtcMonth?.map((row) => (
                      <tr className="metric" key={row.month}>
                        <td className="lbl" style={{ textAlign: 'left' }}>
                          {monthYearLabel(row.month)}
                        </td>
                        <td className="val">{fmtInt(row.n)}</td>
                        <td className="val">{fmtAvg(row.avgBusinessDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ==================================================================
              SEGUNDO TRAMO: CTC → Disbursement — Etapa AVG-DAYS-TO-CLOSE-6
              ==================================================================
              Separado visualmente del bloque de arriba (App → CTC) con su
              propio encabezado de sección: mismo patrón de tarjetas, pero
              nunca mezclado en la misma tabla ni en el mismo gráfico. */}
          <h2 style={{ marginTop: '32px', marginBottom: '4px' }}>Clear to Close → Disbursement</h2>
          <p style={{ marginTop: 0, marginBottom: '16px', color: 'var(--slate-500)' }}>
            Segundo tramo: días hábiles entre Clear to Close ({'"'}ms_clear_to_close{'"'}) y Disbursement ({'"'}closing_date{'"'}), misma fuente
            (activity_report.loan_records_v2) que App → CTC arriba.
          </p>

          {histogramCtcToDisb && (
            <div className="tbl-card">
              <div className="tbl-card__head">
                <span className="tbl-card__title">
                  Distribution — Business Days CTC → Disbursement (all {results!.length.toLocaleString('en-US')} loans)
                </span>
              </div>
              <div className="tbl-scroll">
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Business Days</th>
                      <th>Loans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {histogramCtcToDisb.map((b) => (
                      <tr className="metric" key={b.label}>
                        <td className="lbl" style={{ textAlign: 'left' }}>
                          {b.label}
                        </td>
                        <td
                          className="val"
                          style={
                            maxHistogramCountCtcToDisb > 0
                              ? {
                                  backgroundImage: `linear-gradient(to right, rgba(166, 222, 255, 0.35) ${(b.count / maxHistogramCountCtcToDisb) * 100}%, transparent ${(b.count / maxHistogramCountCtcToDisb) * 100}%)`,
                                }
                              : {}
                          }
                        >
                          {fmtInt(b.count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px', marginTop: '20px' }}>
            <div className="tbl-card">
              <div className="tbl-card__head">
                <span className="tbl-card__title">Monthly Trend (CTC → Disb) — by CTC Date</span>
              </div>
              <div className="tbl-scroll">
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Month</th>
                      <th>Closed</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCtcMonthCtcToDisb?.map((row) => (
                      <tr className="metric" key={row.month}>
                        <td className="lbl" style={{ textAlign: 'left' }}>
                          {monthYearLabel(row.month)}
                        </td>
                        <td className="val">{fmtInt(row.n)}</td>
                        <td className="val">{fmtAvg(row.avgBusinessDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tbl-card">
              <div className="tbl-card__head">
                <span className="tbl-card__title">Monthly Trend (CTC → Disb) — by Closing Date</span>
              </div>
              <div className="tbl-scroll">
                <table className="piv">
                  <thead>
                    <tr className="mo-row">
                      <th className="lbl">Month</th>
                      <th>Closed</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byClosingMonthCtcToDisb?.map((row) => (
                      <tr className="metric" key={row.month}>
                        <td className="lbl" style={{ textAlign: 'left' }}>
                          {monthYearLabel(row.month)}
                        </td>
                        <td className="val">{fmtInt(row.n)}</td>
                        <td className="val">{fmtAvg(row.avgBusinessDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {modalGroup !== null && (
        <GroupDetailModal groupLabel={modalGroup} dimension={dimension} rows={modalRows} onClose={() => setModalGroup(null)} />
      )}
    </div>
  );
}
