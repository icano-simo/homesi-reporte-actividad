'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { invalidateBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { DEFAULT_RATES, RATE_KEYS, SHARED_KEYS, formatRate, type RateKey } from '@/lib/business-plan/rates';
import { AlertTriangleIcon } from '@/components/ui/icons';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import Breadcrumbs from '../components/Breadcrumbs';
import { Diagnostics, ErrorState, LoadingState } from '../components/shared';

/**
 * ============================================================================
 * SETTINGS — tasas de pull-through
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * ⚠ EL AVISO DE ALCANCE NO ES DECORATIVO, LEER ANTES DE SACARLO
 * Hoy sólo Business Plan lee `business_plan.settings`. Forecast & Pipeline
 * sigue con sus constantes en `app/pipeline/page.tsx`.
 *
 * O sea que editar una tasa marcada como "shared" cambia lo que ve Business
 * Plan y NO cambia Forecast. Es deuda deliberada -- `app/pipeline/**` está
 * fuera del alcance de esta etapa y hay otras ramas trabajando ahí. Está
 * anotado en docs/ARQUITECTURA.md.
 *
 * Alguien que edite "Milestone Processing" esperando que cambien los dos
 * módulos y no lo vea reflejado en Forecast va a pensar que hay un bug. Por eso
 * la pantalla lo dice en voz alta, y por eso el aviso se queda hasta que
 * Forecast consuma la tabla.
 */
export default function SettingsPage() {
  /*
   * El diagnóstico de la corrida se mudó acá en BP16. En el perfil competía con
   * los números de la persona; acá es lo que alguien viene a consultar cuando
   * se pregunta CÓMO se está calculando, que es de lo que trata esta pantalla.
   */
  const { data: bpData } = useBusinessPlanData();
  const [values, setValues] = useState<Record<RateKey, number> | null>(null);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<RateKey | null>(null);

  /*
   * La lectura vive dentro del efecto y no en un `useCallback` de afuera: el
   * lint de React marca (con razón) el patrón de llamar a un setState que
   * viene de un callback externo dentro del cuerpo del efecto. Con el flag de
   * cancelación es además correcto si el componente se desmonta a mitad.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data, error: readError } = await supabase.schema('business_plan').from('settings').select('key, value');
        if (cancelled) return;
        if (readError) {
          // Sin tabla la pantalla sigue siendo útil: muestra los defaults en uso.
          setValues({ ...DEFAULT_RATES });
          setAvailable(false);
          return;
        }
        const next = { ...DEFAULT_RATES };
        for (const r of (data ?? []) as { key: string; value: number }[]) {
          if (r.key in next) next[r.key as RateKey] = Number(r.value);
        }
        setValues(next);
        setAvailable(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: RateKey, percent: string) {
    const parsed = Number(percent) / 100;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      setError('Rates must be between 0 and 100%.');
      return;
    }
    setSavingKey(key);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error('No authenticated session.');
      const { error: updateError } = await supabase
        .schema('business_plan')
        .from('settings')
        .update({ value: parsed, updated_by: email, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (updateError) throw new Error(updateError.message);
      setValues((v) => (v ? { ...v, [key]: parsed } : v));
      // Los veredictos de las otras pantallas dependen de esto.
      invalidateBusinessPlanData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Settings' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Settings</h1>
      </div>

      <div className="bp-pending" role="status">
        <AlertTriangleIcon size={14} />
        <span>
          Editing a rate here changes <strong>Business Plan only</strong>. Forecast &amp; Pipeline still uses its own
          constants.
        </span>
      </div>

      {error && <ErrorState message={error} />}
      {!values && !error && <LoadingState />}

      {values && (
        <>
          <div className="tbl-card">
            <div className="tbl-scroll">
              <table className="piv bp-table--settings">
                <colgroup>
                  <col className="bp-col-name" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-status" />
                </colgroup>
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Rate</th>
                    <th className="bp-center">Scope</th>
                    <th className="bp-center">Current</th>
                    <th className="bp-center">Set</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(RATE_KEYS) as RateKey[]).map((key) => (
                    <RateRow
                      key={key}
                      rateKey={key}
                      label={RATE_KEYS[key]}
                      value={values[key]}
                      saving={savingKey === key}
                      disabled={!available}
                      onSave={(pct) => save(key, pct)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bp-calc-note">
            <p>
              The four milestone rates are <strong>cumulative</strong>: the chance that a loan sitting at that milestone
              eventually closes. They come from multiplying Forecast&apos;s per-step cascade forward, which is why
              Applications inherits Started — they are the same probability seen from the two modules.
            </p>
            <p>
              Applications defaults to the Started rate but is its own row: change it here and it stops following.
              Credit Reports and File Creations exist only for Qualifier 2.
            </p>
            {!available && (
              <p>
                <code>business_plan.settings</code> is not reachable yet — the migration in <code>docs/sql/</code> has
                not been applied, so these are the code defaults and editing is disabled.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Cómo se está calculando ─────────────────────────────────────── */}
      {bpData && (
        <>
          <h2 className="bp-section-title">How this is being calculated</h2>
          <Diagnostics data={bpData} />
        </>
      )}
    </>
  );
}

function RateRow({
  rateKey,
  label,
  value,
  saving,
  disabled,
  onSave,
}: {
  rateKey: RateKey;
  label: string;
  value: number;
  saving: boolean;
  disabled: boolean;
  onSave: (percent: string) => void;
}) {
  const [draft, setDraft] = useState((value * 100).toFixed(2));
  return (
    <tr className="metric">
      <td className="lbl">{label}</td>
      <td className="bp-center">
        <span className={SHARED_KEYS.has(rateKey) ? 'badge badge--pill badge--sky' : 'badge badge--pill badge--neutral'}>
          {SHARED_KEYS.has(rateKey) ? 'shared' : 'BP only'}
        </span>
      </td>
      <td className="bp-center">{formatRate(value)}</td>
      <td className="bp-center">
        <div className="bp-rate-edit">
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            className="field bp-rate-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={disabled || saving}
            aria-label={label + ' percentage'}
          />
          <button type="button" className="bp-btn bp-btn--small" onClick={() => onSave(draft)} disabled={disabled || saving}>
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </td>
    </tr>
  );
}
