'use client';

import { useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import { buildEnrollmentPlan, checkActivation, funnelStats, type Funnel, type FunnelCategory } from '@/lib/business-plan/funnels';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../../components/Breadcrumbs';
import { FunnelGlyph } from '../../../components/funnelIcons';
import { Avatar, ErrorState, LoadingState, VerdictBadge } from '../../../components/shared';
import FunnelExplorer from './FunnelExplorer';

/**
 * ============================================================================
 * CATÁLOGO — elegir el funnel de un Loan Officer
 * ============================================================================
 *
 * Etapa BP12, fase 3. Se llega desde "Choose a funnel" de la barra de decisión.
 *
 * ---------------------------------------------------------------------------
 * ⚠ AL ACTIVAR, EL PLAN SE COPIA. NO REFERENCIA LA PLANTILLA.
 * ---------------------------------------------------------------------------
 * Es lo central del diseño. Si el plan apuntara a la plantilla, editar un
 * funnel en la biblioteca cambiaría retroactivamente el plan de todos los
 * enrolados: alguien con 11 de 19 milestones hechos pasaría de golpe a otro
 * plan y su progreso dejaría de significar nada.
 *
 * Mismo principio que el histórico de forecast -- lo que pasó no se recalcula
 * cuando cambian las reglas. Y es lo que permite editar el plan de UNA persona
 * sin afectar a nadie más.
 *
 * La copia la arma `buildEnrollmentPlan` (función pura, probada aparte), que
 * también resuelve las fechas límite: activación + SLA acumulados.
 */

export default function ChooseFunnelPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey: rawKey } = use(params);
  const employeeKey = Number(rawKey);
  const router = useRouter();

  const { data: bpData, isLoading: loadingLo } = useBusinessPlanData();
  const { data: lib, isLoading: loadingLib, available, error, reload } = useFunnelLibrary();

  const [category, setCategory] = useState<FunnelCategory>('core');
  const [picked, setPicked] = useState<number | null>(null);
  /* Explorar y elegir son dos actos distintos: este estado es sólo el de mirar. */
  const [exploring, setExploring] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const lo = useMemo(
    () => bpData?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null,
    [bpData, employeeKey]
  );
  const branch = lo?.branchCodes[0] ?? null;

  const byCategory = useMemo((): Record<FunnelCategory, Funnel[]> => {
    /* Sólo los activos: un funnel desactivado sigue sirviendo a los planes en
       curso pero no se puede elegir de nuevo. */
    const active = (lib?.funnels ?? []).filter((f) => f.is_active);
    return {
      core: active.filter((f) => f.category === 'core'),
      growth: active.filter((f) => f.category === 'growth'),
    };
  }, [lib]);

  /*
   * Etapa BP21: recibe el funnel por argumento en vez de leer `picked`. El
   * modal de exploración ahora también activa, y con dos llamadores el estado
   * compartido era justamente la clase de ambigüedad que BP16 quiso sacar --
   * cuál de los dos gana si no coinciden.
   */
  async function activate(funnelKey: number) {
    if (!lib || !lo) return;
    setBusy(true);
    setOpError(null);
    try {
      const supabase = getSupabaseClient();
      const bp = supabase.schema('business_plan');
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error('No authenticated session.');

      const funnel = lib.funnels.find((f) => f.funnel_key === funnelKey);
      if (!funnel) throw new Error('That funnel no longer exists.');

      /*
       * ⚠ SE VALIDA ANTES DE ESCRIBIR NADA.
       *
       * Sin esto quedó un enrolamiento con 5 nodos copiados y CERO milestones,
       * activo y sin una sola advertencia: la persona tenía un plan que no le
       * pedía hacer nada. Y como la validación faltaba, hubo que ir a borrar el
       * enrolamiento huérfano a mano.
       *
       * El botón ya sale deshabilitado en ese caso, pero se revalida acá: entre
       * que la pantalla cargó y alguien hizo clic, otro pudo haber vaciado el
       * funnel desde la biblioteca.
       */
      const check = checkActivation(funnelKey, lib.links, lib.milestones);
      if (!check.ok) throw new Error(check.reason ?? 'This funnel cannot be activated.');

      const ordered = lib.links
        .filter((l) => l.funnel_key === funnelKey)
        .sort((a, b) => a.position - b.position)
        .map((l) => l.node_key);

      const today = new Date().toISOString().slice(0, 10);
      const draft = buildEnrollmentPlan(ordered, lib.nodes, lib.milestones, today);

      /*
       * ⚠ TODO O NADA.
       *
       * PostgREST no da transacciones entre llamadas, así que si el insert de
       * los milestones falla después del de la cabecera, queda un enrolamiento
       * con nodos y CERO milestones -- exactamente el estado roto que motivó
       * `checkActivation`. Pasó de verdad al probar: la columna `sla_days`
       * todavía no estaba aplicada, el insert devolvió 400 y el enrolamiento
       * quedó vivo igual.
       *
       * Por eso cada paso posterior deshace lo anterior si falla. No es una
       * transacción real -- si se cae la red en medio del rollback puede quedar
       * residuo -- pero cubre el caso que ocurre de verdad: un rechazo de la
       * base.
       */
      let enrollmentKey: number | null = null;
      try {
        // 1. El enrolamiento. `funnel_name` se copia: si mañana renombran la
        //    plantilla, el plan sigue diciendo con qué se activó.
        const { data: enr, error: e1 } = await bp
          .from('enrollment')
          .insert({
            employee_key: employeeKey,
            funnel_key: funnelKey,
            funnel_name: funnel.name,
            status: 'active',
            activated_by: email,
          })
          .select('enrollment_key')
          .single();
        if (e1) throw new Error(e1.message);
        enrollmentKey = (enr as { enrollment_key: number }).enrollment_key;

        // 2. Los nodos copiados, en orden.
        const { data: nodeRows, error: e2 } = await bp
          .from('enrollment_node')
          .insert(
            draft.map((n) => ({
              enrollment_key: enrollmentKey,
              source_node_key: n.source_node_key,
              name: n.name,
              description: n.description,
              icon: n.icon,
              position: n.position,
            }))
          )
          .select('enrollment_node_key, source_node_key');
        if (e2) throw new Error(e2.message);

        // 3. Los milestones copiados, con su fecha límite ya resuelta.
        const keyBySource = new Map(
          (nodeRows as { enrollment_node_key: number; source_node_key: number }[]).map((r) => [
            r.source_node_key,
            r.enrollment_node_key,
          ])
        );
        const milestoneRows = draft.flatMap((n) =>
          n.milestones.map((m) => ({
            enrollment_node_key: keyBySource.get(n.source_node_key),
            source_milestone_key: m.source_milestone_key,
            title: m.title,
            accountable_employee_key: m.accountable_employee_key,
            resource_url: m.resource_url,
            due_date: m.due_date,
            status: 'pending',
            position: m.position,
            /* Se copia para poder recalcular fechas si el plan se reordena. */
            sla_days: m.sla_days,
          }))
        );
        if (milestoneRows.length > 0) {
          const { error: e3 } = await bp.from('enrollment_milestone').insert(milestoneRows);
          if (e3) throw new Error(e3.message);
        }

        // 4. La intervención pasa a activa, que es lo que mueve el Status del
        //    branch de "Pendiente" a "Atendido".
        const { error: e4 } = await bp.from('intervention').insert({
          employee_key: employeeKey,
          status: 'active',
          funnel_key: funnelKey,
          activated_at: new Date().toISOString(),
          activated_by: email,
        });
        if (e4) throw new Error(e4.message);
      } catch (inner) {
        if (enrollmentKey !== null) {
          // Los nodos y milestones se van en cascada con el enrolamiento.
          await bp.from('enrollment').delete().eq('enrollment_key', enrollmentKey);
        }
        throw inner;
      }

      reload();
      /*
       * ⚠ `?activated=1` — etapa BP20: cae en el plan CON EL EDITOR ABIERTO.
       *
       * Es el único momento en que personalizar tiene sentido y no es
       * peligroso: el plan ya es una copia propia. Antes de activar no se puede
       * editar nada, porque lo único que existe es la plantilla y tocarla
       * cambiaría el plan de todos los enrolados.
       */
      router.push('/business-plan/lo/' + employeeKey + '/plan?activated=1');
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = byCategory[category];

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          ...(branch ? [{ label: branch, href: '/business-plan/branch/' + encodeURIComponent(branch) }] : []),
          ...(lo ? [{ label: lo.fullName, href: '/business-plan/lo/' + employeeKey }] : []),
          { label: 'Choose a funnel' },
        ]}
      />

      <div className="bp-eyebrow">Business Plan · Step 1 of 3</div>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Choose your commercial funnel</h1>
          <p className="page-head__subtitle">
            {lo ? lo.fullName : '—'}
            {branch && <> · Branch {branch}</>}
          </p>
        </div>
        {lo && <VerdictBadge verdict={lo.verdict} />}
      </div>

      {(loadingLo || loadingLib) && <LoadingState />}
      {error && <ErrorState message={error} />}
      {opError && (
        <div className="bp-pending" role="alert">
          <AlertTriangleIcon size={14} />
          <span>{opError}</span>
        </div>
      )}

      {!loadingLib && !error && !available && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            The funnel catalogue is empty — apply <code>docs/sql/2026-08-business-plan-funnels.sql</code> first.
          </span>
        </div>
      )}

      {lib && available && (
        <>
          <div className="control-bar">
            <div className="seg">
              <button className={category === 'core' ? 'on' : ''} onClick={() => setCategory('core')}>
                Core ({byCategory.core.length})
              </button>
              <button className={category === 'growth' ? 'on' : ''} onClick={() => setCategory('growth')}>
                Growth ({byCategory.growth.length})
              </button>
            </div>
          </div>

          <div className="bp-catalog">
            {shown.map((f) => {
              /*
               * Conteos y equipo de soporte DERIVADOS, nunca guardados: si se
               * guardaran, la tarjeta seguiría mostrando a quien ya no
               * participa en cuanto alguien cambie un responsable.
               */
              const s = funnelStats(f.funnel_key, lib.links, lib.milestones, lib.owners);
              const chain = lib.links
                .filter((l) => l.funnel_key === f.funnel_key)
                .sort((a, b) => a.position - b.position)
                .map((l) => lib.nodes.find((n) => n.node_key === l.node_key)?.name ?? '?');
              const team = s.supportTeam
                .map((k) => lib.support.find((p) => p.employee_key === k))
                .filter(Boolean) as typeof lib.support;
              /* Un funnel a medio armar no se puede elegir, y se dice por qué. */
              const check = checkActivation(f.funnel_key, lib.links, lib.milestones);

              return (
                /*
                  El clic ABRE el detalle; elegir es un botón aparte, adentro.
                  Antes el clic seleccionaba, y como la tarjeta no mostraba qué
                  pedía el funnel, la única forma de enterarse era activarlo.
                */
                <button
                  key={f.funnel_key}
                  type="button"
                  className={
                    'bp-catalog__card' +
                    (picked === f.funnel_key ? ' is-picked' : '') +
                    (check.ok ? '' : ' is-disabled')
                  }
                  disabled={!check.ok}
                  title={check.ok ? 'See what this funnel asks for' : check.reason ?? undefined}
                  onClick={() => setExploring(f.funnel_key)}
                >
                  {picked === f.funnel_key && <span className="bp-catalog__check" aria-hidden="true">✓</span>}
                  {/*
                    Etapa BP21: el nombre es LO QUE SE ESTÁ ELIGIENDO, así que
                    domina su tarjeta -- antes competía en tamaño con el conteo de
                    nodos y con la descripción. Y a la izquierda el icono que se
                    guardó en la biblioteca, que hasta ahora no se dibujaba en
                    ninguna pantalla.
                  */}
                  <div className="bp-catalog__ident">
                    <FunnelGlyph icon={f.icon} size={20} tone="strong" />
                    <div className="bp-catalog__name">{f.name}</div>
                  </div>
                  <div className="bp-catalog__meta">
                    <span className="bp-pill bp-pill--sky">{s.nodeCount} nodes</span>
                    <span className="bp-pill bp-pill--sky">{s.subMilestoneCount} sub-milestones</span>
                    {f.duration_weeks && <span className="bp-pill bp-pill--sky">~{f.duration_weeks} weeks</span>}
                  </div>
                  <p className="bp-catalog__desc">{f.description ?? ''}</p>
                  <div className="bp-catalog__chain">
                    {chain.map((n, i) => (
                      <span key={n + i} className="bp-catalog__chip">
                        {n}
                        {i < chain.length - 1 && <i className="bp-catalog__arrow" aria-hidden="true">→</i>}
                      </span>
                    ))}
                  </div>
                  {!check.ok && <div className="bp-catalog__blocked">{check.reason}</div>}
                  {/*
                    Elegir vive ACÁ, en la tarjeta, y explorar en el modal. Tener
                    el mismo acto en los dos lugares obligaba a mirar cuál ganó.
                    `stopPropagation` para que elegir no abra además el detalle.
                  */}
                  <div className="bp-catalog__foot">
                    <span className="bp-catalog__explore">Click to explore</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={'bp-btn bp-btn--small' + (picked === f.funnel_key ? '' : ' bp-btn--primary')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicked(f.funnel_key);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setPicked(f.funnel_key);
                        }
                      }}
                    >
                      {picked === f.funnel_key ? '✓ Selected' : 'Select'}
                    </span>
                  </div>
                  {team.length > 0 && (
                    <div className="bp-catalog__team" title={team.map((p) => p.full_name).join(', ')}>
                      {team.slice(0, 4).map((p) => (
                        <Avatar key={p.employee_key} name={p.full_name} />
                      ))}
                      {team.length > 4 && <span className="bp-catalog__more">+{team.length - 4}</span>}
                    </div>
                  )}
                </button>
              );
            })}
            {shown.length === 0 && <p className="bp-muted-line">No active funnels in this category.</p>}
          </div>

          {exploring !== null && (() => {
            const f = lib.funnels.find((x) => x.funnel_key === exploring);
            if (!f) return null;
            return (
              <FunnelExplorer
                funnel={f}
                nodes={lib.nodes}
                links={lib.links}
                milestones={lib.milestones}
                owners={lib.owners}
                support={lib.support}
                onClose={() => setExploring(null)}
                busy={busy}
                /*
                  Etapa BP21: el modal vuelve a tener "Select this funnel", pero
                  ahora ACTÚA. En BP16 se lo quitó porque no hacía nada al
                  apretarlo, que es peor que no estar; el problema no era tener
                  la acción ahí sino que fuera decorativa. Selecciona y activa en
                  un solo gesto, para poder decidir sin volver atrás.
                */
                onSelect={() => {
                  setPicked(f.funnel_key);
                  activate(f.funnel_key);
                }}
              />
            );
          })()}

          <div className="bp-catalog__actions">
            <button
              type="button"
              className="bp-btn bp-btn--primary"
              disabled={picked === null || busy}
              onClick={() => picked !== null && activate(picked)}
            >
              {busy
                ? 'Activating…'
                : picked === null
                  ? 'Pick a funnel to activate'
                  : 'Activate ' + (lib.funnels.find((f) => f.funnel_key === picked)?.name ?? '')}
            </button>
            <span className="bp-catalog__hint">
              The plan is copied from the template, so editing the library later will not change it.
            </span>
          </div>
        </>
      )}
    </>
  );
}
