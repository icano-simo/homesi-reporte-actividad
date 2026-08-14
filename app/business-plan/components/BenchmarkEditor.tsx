'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { LoanOfficerRow } from '@/lib/business-plan/types';
import Modal from './Modal';
import { ProvisionalTag, PROVISIONAL_SET_BY, fmtAvg } from './shared';

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
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error('No authenticated session.');

      const { error: insertError } = await supabase.schema('org').from('employee_benchmark').insert({
        employee_key: lo.employeeKey,
        monthly_benchmark: parsed,
        /*
         * `effective_from` queda en el default de la base (hoy). Si ya existe
         * una fila de hoy para esta persona, el INSERT choca con la clave
         * primaria: es correcto, no hay dos benchmarks vigentes el mismo día.
         */
        set_by: email,
        note: note.trim() === '' ? null : note.trim(),
      });
      if (insertError) {
        throw new Error(
          insertError.code === '23505'
            ? 'This officer already has a benchmark set today. It takes effect from tomorrow onwards.'
            : insertError.message
        );
      }
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
      <div className="bp-stat__value bp-stat__value--small">
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
        <ProvisionalTag setBy={lo.benchmarkSetBy} note={lo.benchmarkNote} />
        <button type="button" className="bp-linkish bp-benchmark__edit" onClick={() => setEditing(true)}>
          edit
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
