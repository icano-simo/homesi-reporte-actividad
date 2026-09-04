'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import { checkActivation, funnelStats, type Funnel } from '@/lib/business-plan/funnels';
import { funnelTotals } from '@/lib/business-plan/librarySearch';
import Breadcrumbs from '../components/Breadcrumbs';
import LibrarySearchBar from '../components/LibrarySearchBar';
import { FunnelGlyph } from '../components/funnelIcons';
import { ErrorState, LoadingState } from '../components/shared';
import { ConfirmDelete, FunnelForm } from '../library/LibraryForms';

/**
 * ============================================================================
 * FUNNELS — la segunda de las dos pantallas, etapa BP45
 * ============================================================================
 *
 * ARCHIVO NUEVO. Reemplaza a la pestaña `Funnels` de la biblioteca.
 *
 * Los nueve funnels con sus totales, y cada uno enlaza a su propia página. El
 * brief de BP41 pedía DOS pantallas: los nodos con sus steps, y los funnels con
 * los nodos que usan. Esta es la segunda.
 *
 * ⚠ EL TOTAL DE DÍAS ESTÁ ACÁ Y NO SÓLO ADENTRO. Medido contra la base, los
 * nueve van de 8 días (`Javier Growth Engine`) a 207 (`Network Leverage`), y dos
 * pasan de siete meses. Armar un funnel es decidir cuánto dura, así que el
 * número tiene que verse antes de entrar.
 */
export default function FunnelsPage() {
  const { data, isLoading, available, error, reload } = useFunnelLibrary();
  const [dialog, setDialog] = useState<
    { kind: 'form'; funnel: Funnel | null } | { kind: 'delete'; funnel: Funnel } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const bp = () => getSupabaseClient().schema('business_plan');

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setOpError(null);
    try {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
      setDialog(null);
      reload();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnels' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Funnels</h1>
        {data && <LibrarySearchBar data={data} />}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {opError && (
        <div className="bp-pending" role="alert">
          <span>{opError}</span>
        </div>
      )}

      {!isLoading && !error && !available && (
        <div className="bp-pending" role="status">
          <span>The Business Plan tables are not applied yet.</span>
        </div>
      )}

      {data && available && (
        <>
          <div className="bp-tabs" role="group" aria-label="Funnel actions">
            <button type="button" className="bp-tabs__tab is-on" onClick={() => setDialog({ kind: 'form', funnel: null })}>
              + New funnel
            </button>
          </div>

          <div className="bp-node-list">
            {data.funnels.map((f) => {
              const t = funnelTotals(f.funnel_key, data);
              const st = funnelStats(f.funnel_key, data.links, data.milestones, data.owners);
              const check = checkActivation(f.funnel_key, data.links, data.milestones);
              const enrolados = data.enrollmentsByFunnel[f.funnel_key] ?? 0;

              return (
                <article key={f.funnel_key} className="bp-nodecard">
                  <div className="bp-nodecard__left">
                    <h3 className="bp-nodecard__name">
                      <FunnelGlyph icon={f.icon} size={16} />
                      {/* Enlaza al funnel. El nombre entero, sin recorte. */}
                      <Link className="bp-funnel-link" href={'/business-plan/funnels/' + f.funnel_key}>
                        {f.name}
                      </Link>
                    </h3>
                    {f.description && <p className="bp-nodecard__desc">{f.description}</p>}
                  </div>

                  <div className="bp-nodecard__meta">
                    <span className="bp-metapill">{f.category}</span>
                    <span className="bp-metapill">
                      {t.nodes} node{t.nodes === 1 ? '' : 's'}
                    </span>
                    <span className="bp-metapill">
                      {t.steps} step{t.steps === 1 ? '' : 's'}
                    </span>
                    {/* `ends day N`, el número que decide cuánto dura. */}
                    <span className="bp-metapill">{t.steps === 0 ? '— days' : 'ends day ' + t.endsDay}</span>

                    {/* Cero NO es un botón: no hay lista que abrir. */}
                    {enrolados === 0 ? (
                      <span className="bp-metapill">nobody enrolled</span>
                    ) : (
                      <Link className="bp-metapill bp-metapill--link" href={'/business-plan/funnels/' + f.funnel_key}>
                        {enrolados} enrolled
                      </Link>
                    )}

                    {!f.is_active && <span className="bp-metapill bp-metapill--warn">inactive</span>}
                    {/*
                      Un funnel que no se puede activar lo dice acá, no al
                      intentarlo: es la diferencia entre una advertencia y un
                      rechazo. `st` trae el motivo desde `checkActivation`.
                    */}
                    {!check.ok && (
                      <span className="bp-metapill bp-metapill--warn" title={check.reason ?? undefined}>
                        cannot be activated
                      </span>
                    )}

                    <span className="bp-metapill">{st.supportTeam.length} owners</span>

                    <button
                      type="button"
                      className="bp-metapill bp-metapill--link"
                      onClick={() => setDialog({ kind: 'form', funnel: f })}
                    >
                      Edit
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {dialog?.kind === 'form' && (
        <FunnelForm
          initial={dialog.funnel}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(d) => {
            const row = {
              name: d.name.trim(),
              category: d.category,
              description: d.description.trim() || null,
              icon: d.icon.trim() || null,
              duration_weeks: d.duration_weeks === '' ? null : Number(d.duration_weeks),
            };
            /*
             * `is_active` NO va en el formulario: `FunnelDraft` no lo tiene, y
             * agregarlo seria otro cambio. Desactivar un funnel sigue siendo
             * una operacion aparte, como era en la pestana vieja.
             *
             * Y `position` solo al CREAR: al editar, sobreescribirla movería el
             * funnel de lugar en la lista sin que nadie lo pidiera.
             */
            run(() =>
              dialog.funnel
                ? bp().from('funnel').update(row).eq('funnel_key', dialog.funnel.funnel_key)
                : bp()
                    .from('funnel')
                    /* `data` está garantizado: el diálogo sólo se abre desde el
                       bloque que ya lo verificó, pero el compilador no lo sabe
                       y el `?? 0` es más honesto que un `!`. */
                    .insert({ ...row, position: (data?.funnels.length ?? 0) + 1 })
            );
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDelete
          what={'funnel "' + dialog.funnel.name + '"'}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => bp().from('funnel').delete().eq('funnel_key', dialog.funnel.funnel_key))}
        />
      )}
    </>
  );
}
