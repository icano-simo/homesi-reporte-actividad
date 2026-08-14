'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { LoanOfficerRow } from '@/lib/business-plan/types';

/**
 * ============================================================================
 * BENCHMARK EDITABLE, CON AUDITORÍA
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * Cada cambio INSERTA una fila en `org.employee_benchmark`; nunca actualiza.
 * Así se puede responder "¿con qué benchmark se evaluó a esta persona en
 * marzo?" sin reconstruir nada.
 *
 * Eso no es sólo una convención del código: la política de RLS de esa tabla
 * concede INSERT y no UPDATE ni DELETE, así que la historia la protege la base
 * aunque alguien llame a la API directamente. Ver
 * `docs/sql/2026-08-org-employee-benchmark.sql`.
 *
 * `set_by` sale del usuario autenticado, NO de un campo del formulario. Si
 * viniera del formulario, cualquiera podría firmar con el nombre de otro y la
 * auditoría no valdría nada. La política lo verifica además del lado del
 * servidor: exige que `set_by` sea el email del propio JWT.
 */
export default function BenchmarkEditor({ lo, onSaved }: { lo: LoanOfficerRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(lo.monthlyBenchmark === null ? '' : String(lo.monthlyBenchmark));
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
         * El mensaje se traduce abajo para que no llegue crudo de PostgREST.
         */
        set_by: email,
      });
      if (insertError) {
        throw new Error(
          insertError.code === '23505'
            ? 'This officer already has a benchmark set today. It takes effect from tomorrow onwards.'
            : insertError.message
        );
      }
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="bp-stat__value bp-stat__value--small">
        {lo.monthlyBenchmark === null ? <span className="bp-muted">—</span> : lo.monthlyBenchmark.toFixed(1)}
        <button type="button" className="bp-linkish bp-benchmark__edit" onClick={() => setEditing(true)}>
          edit
        </button>
        {lo.benchmarkSetBy && (
          <div className="bp-stat__sub" title={'Effective from ' + lo.benchmarkEffectiveFrom}>
            {lo.benchmarkSetBy}
          </div>
        )}
      </div>
    );
  }

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
      {error && <div className="bp-benchmark__error">{error}</div>}
    </div>
  );
}
