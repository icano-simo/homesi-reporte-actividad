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
import { ClockIcon, ChevronRightIcon } from '@/components/ui/icons';
import FunnelNodeTabs from '../components/FunnelNodeTabs';
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
      <Breadcrumbs
        items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'Funnels & Nodes' }]}
      />

      <div className="page-head">
        <h1 className="page-head__title">Funnels &amp; Nodes</h1>
        {data && <LibrarySearchBar data={data} />}
      </div>

      {/* Los conteos salen de `data`; mientras no llego, la pestana va sin
          numero. Ver la nota de `FunnelNodeTabs`: un 0 no es "no se". */}
      <FunnelNodeTabs funnels={data?.funnels.length} nodes={data?.nodes.length} />

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

          <div className="bp-fnlist">
            {data.funnels.map((f) => {
              const t = funnelTotals(f.funnel_key, data);
              const st = funnelStats(f.funnel_key, data.links, data.milestones, data.owners);
              const check = checkActivation(f.funnel_key, data.links, data.milestones);
              const enrolados = data.enrollmentsByFunnel[f.funnel_key] ?? 0;

              /*
               * LA SECUENCIA DE NODOS, EN ORDEN. Sale de `links` y no de
               * `funnelStats`, porque hace falta el ORDEN y el nombre de cada
               * uno -- `st` trae conteos.
               */
              const secuencia = data.links
                .filter((l) => l.funnel_key === f.funnel_key)
                .sort((a, b) => a.position - b.position)
                .map((l) => data.nodes.find((x) => x.node_key === l.node_key))
                .filter((x): x is NonNullable<typeof x> => x !== undefined);

              return (
                <article key={f.funnel_key} className="bp-fnrow">
                  {/*
                    ═══════════════════════════════════════════════════════
                    LA CAJA ENTERA ES EL LINK — etapa BP47
                    ═══════════════════════════════════════════════════════

                    Un `<a>` vacío estirado sobre la franja, no un `onClick` en
                    el `<article>`. Y no envolviendo la franja tampoco: adentro
                    hay un botón (`Edit`) y otro link, y un `<a>` no puede
                    contener elementos interactivos -- el HTML es inválido y el
                    navegador reordena el árbol.

                    Con un `onClick` en el contenedor se pierden ctrl+clic,
                    clic del medio, "copiar dirección" y el foco por teclado.
                    Estirado, sigue siendo un link de verdad: el `z-index` de la
                    tira de controles lo deja debajo, así que `Edit` recibe su
                    propio clic.
                  */}
                  <Link
                    className="bp-fnrow__hit"
                    href={'/business-plan/funnels/' + f.funnel_key}
                    aria-label={'Open funnel ' + f.name}
                  />

                  <div className="bp-fnrow__main">
                    <h3 className="bp-fnrow__name">
                      <FunnelGlyph icon={f.icon} size={16} />
                      <span>{f.name}</span>
                    </h3>
                    {f.description && <p className="bp-fnrow__desc">{f.description}</p>}

                    {/*
                      ═══════════════════════════════════════════════════════
                      LA CADENA ENVUELVE Y NO SE RECORTA — etapa BP47
                      ═══════════════════════════════════════════════════════

                      Medido contra la base: el funnel más grande es
                      `Recruitment - DYS` con 12 nodos, 381 caracteres contando
                      los separadores; a 11px eso son ~2400px y la lista mide
                      ~1050. Necesita tres líneas. Ocho de los nueve necesitan
                      dos o menos.

                      ⚠ SE DESCARTÓ EL `+N more`. Recortar a un contador esconde
                      justo lo único que esta tira existe para mostrar -- el
                      ORDEN en que van los nodos--, y con 12 nodos habría
                      escondido ocho. Tres líneas en la franja más alta cuestan
                      menos que un dato que hay que ir a buscar.

                      ⚠ Y NINGÚN NOMBRE SE CORTA. Sin `text-overflow` y con
                      `overflow-wrap: anywhere`: un nombre a medias es
                      inidentificable, y el más largo tiene 53 caracteres
                      (`Build your own source of borrowers - Prospects Source`).
                      Es el bug de `table.piv` otra vez, que ahí dejó una tabla
                      de nombres con elipsis.
                    */}
                    {secuencia.length === 0 ? (
                      <p className="bp-hint">No nodes yet — open it to add the first one.</p>
                    ) : (
                      <ol className="bp-chain">
                        {secuencia.map((n, i) => (
                          <li key={n.node_key} className="bp-chain__item">
                            {/* La flecha va ANTES y no después: así la última
                                píldora no arrastra una flecha que no apunta a
                                nada, y al envolver la línea empieza con la
                                flecha, que es lo que dice que viene de arriba. */}
                            {i > 0 && (
                              <ChevronRightIcon size={12} className="bp-chain__arrow" aria-hidden="true" />
                            )}
                            <span className="bp-chain__pill">{n.name}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  <div className="bp-fnrow__meta" role="presentation">
                    <span className="bp-metapill">{f.category}</span>
                    <span className="bp-metapill">
                      {t.steps} step{t.steps === 1 ? '' : 's'}
                    </span>

                    {/*
                      EL DÍA FINAL, CON EL RELOJ. `ends day N` es lo que decide
                      cuánto dura, y los nueve van de 8 a 207 días.
                      El icono es un reloj y no un calendario a proposito: es un
                      contador de días desde el enrolamiento, no una fecha.
                    */}
                    <span className="bp-metapill bp-metapill--num">
                      <ClockIcon size={12} aria-hidden="true" />
                      {t.steps === 0 ? '— days' : 'ends day ' + t.endsDay}
                    </span>

                    {/*
                      ⚠ CERO NO ES UNA PÍLDORA. Con nadie enrolado no hay nada
                      que mostrar, y una píldora es un objeto: invita a un clic
                      que no lleva a ninguna parte. Medido, seis de los nueve
                      funnels están en cero, así que serían seis píldoras vacías
                      compitiendo con las tres que sí dicen algo.
                    */}
                    {enrolados === 0 ? (
                      <span className="bp-fnrow__none">nobody enrolled</span>
                    ) : (
                      <span className="bp-metapill bp-metapill--on">
                        {enrolados} enrolled
                      </span>
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
