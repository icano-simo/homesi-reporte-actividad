'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { LoanOfficerRow } from '@/lib/business-plan/types';

/**
 * ============================================================================
 * BARRA DE DECISIÓN
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * Aparece SÓLO cuando hay algo que decidir:
 *
 *   On Risk  -> fondo navy, con el motivo y dos acciones. El Business Plan es
 *               obligatorio.
 *   Watch    -> la misma barra en tono de sugerencia. Falló un qualifier, no
 *               los dos.
 *   On Track -> no se muestra. Nada que hacer.
 *
 * La explicación del "por qué" no es decorativa: dice QUÉ qualifier falló y con
 * qué números. Sin eso, la barra le pide a alguien que actúe sin decirle sobre
 * qué -- y el Loan Officer que la reciba va a preguntar exactamente eso.
 */
export default function DecisionBar({
  lo,
  onChooseFunnel,
  onReviewed,
}: {
  lo: LoanOfficerRow;
  onChooseFunnel: () => void;
  onReviewed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lo.verdict === 'on_track' || lo.verdict === 'not_evaluable') return null;
  const mandatory = lo.verdict === 'on_risk';

  const reasons: string[] = [];
  if (lo.q1.passes === false) {
    reasons.push(
      `volume is short: projected average ${lo.q1.avgWithCurrent.toFixed(2)} against a benchmark of ` +
        `${lo.monthlyBenchmark?.toFixed(1)} (GAP ${lo.q1.gap?.toFixed(1)})`
    );
  }
  if (lo.q2.passes === false) {
    const short = lo.q2.metrics.filter((m) => !m.meets);
    reasons.push(
      `commercial activity is short in ${short.length} of 3: ` +
        short.map((m) => `${m.label} ${m.actual} of ${m.required}`).join(', ')
    );
  }

  async function markReviewed() {
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error('No authenticated session.');
      const { error: insertError } = await supabase.schema('business_plan').from('intervention').insert({
        employee_key: lo.employeeKey,
        status: 'reviewed',
        // funnel_key queda null: revisado SIN funnel es un estado válido, y es
        // justamente el que alimenta el "Revisado" del Status del branch.
        reviewed_at: new Date().toISOString(),
        reviewed_by: email,
      });
      if (insertError) throw new Error(insertError.message);
      onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={'bp-decision' + (mandatory ? '' : ' bp-decision--suggested')}>
      <div className="bp-decision__text">
        <div className="bp-decision__title">
          {mandatory ? 'Business Plan required' : 'Business Plan suggested'}
        </div>
        <p className="bp-decision__why">
          {mandatory ? 'Both qualifiers failed — ' : 'One qualifier failed — '}
          {reasons.join('; ')}.
        </p>
        {lo.intervention && (
          <p className="bp-decision__why">
            Already {lo.intervention.status} by {lo.intervention.reviewed_by ?? lo.intervention.activated_by ?? 'someone'}.
          </p>
        )}
        {error && <p className="bp-decision__why">{error}</p>}
      </div>
      <div className="bp-decision__actions">
        <button type="button" className="bp-btn bp-btn--primary" onClick={onChooseFunnel}>
          Choose a funnel
        </button>
        <button type="button" className="bp-btn bp-btn--ghost" onClick={markReviewed} disabled={saving || lo.intervention !== null}>
          {saving ? 'Saving…' : 'Mark as reviewed — funnel pending'}
        </button>
      </div>
    </div>
  );
}
