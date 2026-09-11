'use client';

import { useState } from 'react';
import { fijarBenchmark } from '@/lib/business-plan/benchmark';
import type { LoanOfficerRow } from '@/lib/business-plan/types';
import Modal from './Modal';
import { PROVISIONAL_SET_BY, fmtAvg } from './shared';

/**
 * ============================================================================
 * BENCHMARK: VALOR VIGENTE, EDICIÓN E HISTORIAL
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO. Etapa BP7 — historial en modal y nota opcional.
 *
 * Cada cambio INSERTA una fila en `org.employee_benchmark`; nunca actualiza.
 * Y eso no es sólo una convención del código: la política de RLS concede
 * INSERT y no UPDATE ni DELETE, así que la historia la protege la base aunque
 * alguien llame a la API directamente. Verificado: los dos devuelven 403.
 *
 * `set_by` sale del usuario autenticado, NO de un campo del formulario. Si
 * viniera del formulario, cualquiera podría firmar con el nombre de otro. La
 * política lo verifica además del lado del servidor.
 *
 * El historial va en un MODAL, que entra en la excepción ya acordada: es
 * detalle complementario, no un lugar al que se quiera volver o mandar por
 * link. Toda la navegación del módulo sigue siendo por página.
 */
export default function BenchmarkEditor({ lo, onSaved }: { lo: LoanOfficerRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [value, setValue] = useState(lo.monthlyBenchmark === null ? '' : String(lo.monthlyBenchmark));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Enter a number of 0 or more.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      /*
       * ⚠ EL `insert` SE MUDÓ A `lib/business-plan/benchmark.ts` — etapa RV3.
       *
       * Desde que el paso 2 de la revisión también fija el benchmark, hay dos
       * pantallas escribiendo la misma tabla append-only. Dos `insert` con su
       * propio criterio de autor y de error es la forma exacta en que se
       * separan, así que hay uno.
       *
       * Y ahi se documenta lo que este archivo decía mal: el mensaje de
       * «benchmark ya fijado hoy» describía una clave primaria que BP29 cambió.
       */
      const r = await fijarBenchmark(lo.employeeKey, parsed, note);
      if (!r.ok) throw new Error(r.error ?? 'The benchmark was not saved.');
      setEditing(false);
      setNote('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="bp-benchmark__form">
        <input
          type="number"
          step="0.5"
          min="0"
          className="field bp-benchmark__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Monthly benchmark"
          autoFocus
        />
        <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={saving}>
          {saving ? '…' : 'Save'}
        </button>
        <button type="button" className="bp-linkish" onClick={() => setEditing(false)} disabled={saving}>
          cancel
        </button>
        {/* La nota es opcional pero es lo único que explica POR QUÉ ese número. */}
        <input
          type="text"
          className="field bp-benchmark__note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this number? (optional)"
          aria-label="Reason for this benchmark"
        />
        {error && <div className="bp-benchmark__error">{error}</div>}
      </div>
    );
  }

  return (
    <>
      {/*
        Etapa BP51: la marca de provisional ya no va acá -- se consolidó en
        UNA sola, en la cabecera de `Q1Panel` (`Provisional data`). Repetirla
        por renglón era una de las tres veces que se veía "provisional" en la
        misma tarjeta. La condición sigue viviendo en `ProvisionalTag`; sólo
        se dejó de llamarla desde acá.

        Y "Edit" pasó de enlace de texto a botón real (`bp-btn`, no
        `bp-linkish`) -- es una acción, no una navegación.
      */}
      <div className="bp-stat__value">
        {lo.monthlyBenchmark === null ? (
          <span className="bp-muted">—</span>
        ) : (
          <button
            type="button"
            className="bp-benchmark__open"
            onClick={() => setShowHistory(true)}
            title="See every version of this benchmark"
          >
            {fmtAvg(lo.monthlyBenchmark)}
          </button>
        )}
        <button type="button" className="bp-btn bp-btn--small bp-benchmark__edit" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>

      {showHistory && (
        <Modal title={lo.fullName + ' — benchmark history'} onClose={() => setShowHistory(false)}>
          <table className="piv">
            <thead>
              <tr className="mo-row">
                <th className="lbl">Effective from</th>
                <th className="bp-center">Benchmark</th>
                <th className="bp-left">Set by</th>
                <th className="bp-left">Set at</th>
                <th className="bp-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {[...lo.benchmarkHistory]
                .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
                .map((r) => (
                  <tr key={r.effective_from} className="metric">
                    <td className="lbl">{r.effective_from}</td>
                    <td className="bp-center">{fmtAvg(Number(r.monthly_benchmark))}</td>
                    <td className="bp-left">
                      {r.set_by === PROVISIONAL_SET_BY ? <span className="bp-provisional">provisional seed</span> : r.set_by}
                    </td>
                    <td className="bp-left">{String(r.set_at).slice(0, 16).replace('T', ' ')}</td>
                    <td className="bp-left bp-history__note">{r.note ?? '—'}</td>
                  </tr>
                ))}
              {lo.benchmarkHistory.length === 0 && (
                <tr>
                  <td className="lbl bp-empty-cell" colSpan={5}>
                    No benchmark has been set for this officer yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
