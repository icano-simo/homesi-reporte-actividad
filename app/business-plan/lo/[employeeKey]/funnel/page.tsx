'use client';

import { useMemo, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { useFunnelLibrary } from '@/lib/business-plan/useFunnelLibrary';
import { useEnrollment } from '@/lib/business-plan/useEnrollment';
import { buildEnrollmentPlan, checkActivation, funnelStats, type Funnel, type FunnelCategory } from '@/lib/business-plan/funnels';
import { averageOver, monthOf, monthsBefore } from '@/lib/business-plan/impact';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../../components/Breadcrumbs';
import Modal from '../../../components/Modal';
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

  const searchParams = useSearchParams();
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * `?change=<enrollment_key>` — MODO CAMBIO DE FUNNEL, etapa BP40
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Cambiar de funnel se hace ACA, en el catalogo, y no en un selector propio
   * dentro del plan. La razon: elegir el funnel nuevo necesita exactamente lo
   * que esta pantalla ya tiene -- las categorias, el explorador de nodos, y
   * sobre todo `checkActivation`, que es lo que impide activar un funnel vacio.
   * Un selector aparte en el plan habria sido una segunda forma de elegir, con
   * su propia copia de esa validacion; es la duplicacion que BP31 vino a cerrar.
   *
   * El valor es la clave del enrolamiento a reemplazar, no un `1`: la RPC
   * necesita saber CUAL plan cancela, y tomarlo de la URL en vez de volver a
   * buscarlo evita cancelar el equivocado si la persona tuviera dos.
   */
  const changingKey = Number(searchParams.get('change')) || null;
  /*
   * El plan que se va a reemplazar sale del MISMO hook que usa la pantalla del
   * plan, no de una consulta nueva: el numero de steps hechos que se muestra en
   * la confirmacion tiene que ser el mismo que la persona vio ahi. Dos consultas
   * del mismo dato pueden diferir, y esta es la que autoriza un borrado.
   */
  const { plan: current } = useEnrollment(employeeKey);
  const doneCount = current ? current.nodes.reduce((a, n) => a + n.milestones.filter((m) => m.status === 'done').length, 0) : 0;
  /*
   * ⚠ EL ENLACE PUEDE ESTAR VIEJO. Si la clave de la URL no es la del plan
   * activo, no se cambia nada: alguien pudo cancelar o cambiar el plan en otra
   * pestana, y `change_funnel` cancelaria un enrolamiento que ya no es el suyo.
   * Se compara en vez de confiar, y se compara contra el plan activo -- no se
   * "corrige" la clave sola, porque adivinar cual quiso decir es peor.
   */
  const staleLink = changingKey !== null && current !== null && current.enrollment_key !== changingKey;
  /* El funnel que se esta por confirmar en modo cambio. */
  const [confirming, setConfirming] = useState<Funnel | null>(null);
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
  /*
   * ═══════════════════════════════════════════════════════════════════════
   * EL ÚNICO CAMINO PARA ELEGIR — etapa BP40
   * ═══════════════════════════════════════════════════════════════════════
   *
   * La tarjeta y el modal del explorador pasan por acá, y ninguno llama a
   * `activate` directo. Es lo que hace que los dos se comporten igual: antes el
   * modal activaba de una y la tarjeta solo marcaba.
   *
   * ⚠ Y ES DONDE SE PIDE LA CONFIRMACIÓN. Activar sobre nada es reversible
   * --se cancela y listo--; cambiar de funnel BORRA el plan actual, con sus
   * steps hechos y sus notas. Eso no se deshace, así que no puede pasar por el
   * mismo gesto de un solo clic: en modo cambio el clic abre la confirmación, y
   * la confirmación DICE CUÁNTOS steps hechos se van. "Se va a borrar el plan"
   * es una advertencia genérica que nadie lee; "tiene 5 steps completados" es un
   * dato que hace parar.
   */
  function elegir(funnel: Funnel) {
    if (busy) return;
    /* Sin `lo` no hay a quién activarle nada: se dice, en vez de no hacer nada.
       El mensaje lo pone `activate`, que es donde vive la condición real. */
    if (!lo) {
      activate(funnel.funnel_key);
      return;
    }
    if (changingKey) {
      /*
       * ⚠ GUARDA REDUNDANTE, A PROPÓSITO. La tarjeta del funnel actual ya no
       * dibuja el botón, pero el modal del explorador tiene su propio
       * "Select this funnel" y llega acá igual. Cambiar al mismo funnel
       * cancelaría el plan y lo repondría vacío: se perdería el progreso y la
       * pantalla quedaría igual que antes.
       */
      if (current !== null && current.funnel_key === funnel.funnel_key) {
        setOpError('That is already the active funnel. Switching to it would delete the current progress and put back an empty plan.');
        return;
      }
      setConfirming(funnel);
      return;
    }
    setPicked(funnel.funnel_key);
    activate(funnel.funnel_key);
  }

  async function activate(funnelKey: number) {
    /*
     * ⚠ ESTE GUARDIA RETORNABA EN SILENCIO — arreglado en BP40.
     *
     * Cuando la persona no está en la población del módulo, `lo` es null y acá
     * no pasaba nada: ni activación, ni error, ni nada en la consola. Se
     * comprobó contra la base con el empleado 77 -- el catálogo se dibuja
     * completo, con sus siete tarjetas, y el botón no hace absolutamente nada.
     *
     * El bug es viejo, pero hasta ahora hacían falta dos clics para llegar: el
     * clic único de BP40 lo dejó a un gesto de distancia. Es el mismo patrón de
     * antes -- un caso nuevo activa un bug que nadie escribió hoy.
     *
     * `lib` sigue junto en la condición porque tampoco se puede activar sin la
     * biblioteca, y el mensaje sirve para los dos: no hay con qué armar el plan.
     */
    if (!lib || !lo) {
      setOpError(
        !lo
          ? 'This person is not in the Business Plan population, so a plan cannot be activated for them. ' +
            'They need a branch assignment first.'
          : 'The funnel library has not loaded yet.'
      );
      return;
    }
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
       * ═══════════════════════════════════════════════════════════════════════
       * UNA SOLA LLAMADA, UNA SOLA TRANSACCIÓN — etapa BP40
       * ═══════════════════════════════════════════════════════════════════════
       *
       * Acá vivían CINCO escrituras seguidas con rollback a mano, porque
       * PostgREST no da transacciones entre llamadas. El comentario que estaba
       * en su lugar decía qué hacer cuando la función existiera: reemplazar el
       * bloque entero por un `.rpc()`, sin dejar los dos caminos conviviendo.
       * `activate_funnel` ya está aplicada, así que es lo que se hizo.
       *
       * LO QUE SE GANA NO ES BREVEDAD. El rollback manual cubría el caso que
       * ocurre de verdad --un rechazo de la base-- pero si se cortaba la red en
       * medio del rollback quedaba residuo, y no había quien lo deshiciera. Y
       * el borrado de `intervention` podía no poder: la tabla no tenía policy
       * de delete, así que el rollback dejaba la fila en `closed` como consuelo.
       * Ahora un fallo no deja nada: la transacción no llegó a hacer commit.
       *
       * `checkActivation` NO se sacó de acá: sigue corriendo antes, y la función
       * repite las validaciones del lado de la base. Es a propósito -- la de
       * acá da el mensaje que se lee, la de la base es la que no se puede saltar.
       *
       * `funnel_name` ya no se manda: la función lo lee de la plantilla. Es una
       * copia histórica y no tiene por qué depender de lo que diga el cliente.
       */
      const enrollmentMonth = monthOf(new Date().toISOString());
      const baseMonths = monthsBefore(enrollmentMonth, 3);
      const avg = averageOver(lo.activity, baseMonths);
      /*
       * ⚠ LA LÍNEA BASE VA EN LA MISMA LLAMADA — etapa BP22, y sigue valiendo.
       *
       * Si se escribiera después, un fallo dejaría un plan activo sin foto del
       * antes, y esa foto no se puede reconstruir más tarde sin mentir:
       * Commercial Activity se recalcula con cada carga --el cambio de Heather
       * movió préstamos de un mes a otro-- así que "los 3 meses previos" leídos
       * dentro de dos semanas ya no son los mismos números que se ven hoy.
       *
       * No se mandan `source` ni `captured_by`: la función fija `'captured'` y
       * toma el email de la sesión. Mandarlos haría creer que se pueden elegir.
       */
      const baseline = {
        avg_closings: avg.closings,
        avg_credit_applications: avg.creditApplications,
        avg_pre_approvals: avg.preApprovals,
        avg_file_creations: avg.fileCreations,
        baseline_months: baseMonths,
        enrollment_month: enrollmentMonth,
      };

      /*
       * CAMBIAR DE FUNNEL ES OTRA FUNCIÓN, NO DOS LLAMADAS — etapa BP40.
       *
       * Cancelar y activar tienen que pasar las dos o ninguna: si la activación
       * falla, el plan viejo tiene que seguir ahí. Con dos llamadas, un funnel
       * nuevo que no se puede activar dejaría a la persona sin ningún plan --
       * probado contra la base con un funnel sin steps, y la cancelación se
       * revierte.
       */
      const { error: eRpc } = changingKey
        ? await bp.rpc('change_funnel', {
            p_enrollment_key: changingKey,
            p_employee_key: employeeKey,
            p_funnel_key: funnelKey,
            p_plan: draft,
            p_baseline: baseline,
          })
        : await bp.rpc('activate_funnel', {
            p_employee_key: employeeKey,
            p_funnel_key: funnelKey,
            p_plan: draft,
            p_baseline: baseline,
          });
      if (eRpc) throw new Error(eRpc.message);

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

      <div className="bp-eyebrow">
        {changingKey ? 'Business Plan · Change funnel' : 'Business Plan · Step 1 of 3'}
      </div>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {changingKey ? 'Choose a different funnel' : 'Choose your commercial funnel'}
          </h1>
          <p className="page-head__subtitle">
            {lo ? lo.fullName : '—'}
            {branch && <> · Branch {branch}</>}
          </p>
        </div>
        {lo && <VerdictBadge verdict={lo.verdict} />}
      </div>

      {(loadingLo || loadingLib) && <LoadingState />}
      {error && <ErrorState message={error} />}
      {/*
        ⚠ EL ENLACE QUEDO VIEJO. No se ofrece "seguir igual": la clave de la URL
        apunta a un enrolamiento que ya no es el activo, y `change_funnel`
        cancelaría ese. Se manda a recargar el plan, que es donde se ve qué hay
        de verdad.
      */}
      {staleLink && (
        <div className="bp-pending" role="alert">
          <AlertTriangleIcon size={14} />
          <span>
            This link points to a plan that is no longer the active one — it may have been changed or
            cancelled somewhere else.{' '}
            <a href={'/business-plan/lo/' + employeeKey + '/plan'}>Open the current plan</a> and try again.
          </span>
        </div>
      )}
      {/*
        En modo cambio se dice lo que está en juego ANTES de mirar el catálogo,
        con el número de steps hechos. La confirmación lo repite al apretar, pero
        para entonces ya se eligió uno: el aviso de arriba es el que puede hacer
        volver atrás sin haber elegido nada.
      */}
      {changingKey !== null && !staleLink && current && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            Picking a funnel here replaces <strong>{current.funnel_name}</strong> — the current plan is
            deleted, including{' '}
            <strong>
              {doneCount} completed step{doneCount === 1 ? '' : 's'}
            </strong>{' '}
            and its notes. This cannot be undone.
          </span>
        </div>
      )}
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
              /* En modo cambio, el que ya tiene puesto no es un destino. */
              const esElActual = changingKey !== null && current !== null && current.funnel_key === f.funnel_key;

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
                    <FunnelGlyph icon={f.icon} size={20} />
                    <div className="bp-catalog__name">{f.name}</div>
                  </div>
                  <div className="bp-catalog__meta">
                    <span className="bp-pill bp-pill--sky">{s.nodeCount} nodes</span>
                    <span className="bp-pill bp-pill--sky">{s.subMilestoneCount} steps</span>
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

                    ═══════════════════════════════════════════════════════════
                    UN SOLO CLIC — etapa BP40
                    ═══════════════════════════════════════════════════════════

                    Este boton SELECCIONABA y despues había que apretar "Activate"
                    al pie: dos gestos para un acto, y el segundo lejos del
                    primero. El modal ya activaba en uno solo desde BP21, así que
                    la tarjeta y el modal hacían cosas distintas con el mismo
                    nombre. Ahora las dos activan.

                    `picked` no se borro: pasa a significar "este es el que se
                    esta activando", que es lo que deja mostrar "Activating…" en
                    la tarjeta correcta y no en todas.
                  */}
                  <div className="bp-catalog__foot">
                    <span className="bp-catalog__explore">Click to explore</span>
                    {/*
                      ⚠ EL FUNNEL ACTUAL NO SE OFRECE COMO DESTINO — etapa BP40.
                      Encontrado mirando la captura, no midiendo nada: en modo
                      cambio las siete tarjetas decían "Switch to this",
                      incluida la del funnel que la persona ya tiene. Apretarla
                      habría cancelado el plan y activado el MISMO funnel: el
                      progreso se pierde y la pantalla queda igual que antes, que
                      es la peor forma de perder datos -- sin que se note.
                    */}
                    {esElActual ? (
                      <span className="bp-catalog__explore bp-strong">Current plan</span>
                    ) : (
                    <span
                      role="button"
                      tabIndex={0}
                      className={'bp-btn bp-btn--small' + (picked === f.funnel_key ? '' : ' bp-btn--primary')}
                      onClick={(e) => {
                        e.stopPropagation();
                        elegir(f);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          elegir(f);
                        }
                      }}
                    >
                      {busy && picked === f.funnel_key
                        ? 'Activating…'
                        : changingKey
                          ? 'Switch to this'
                          : 'Select'}
                    </span>
                    )}
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
                onSelect={() => elegir(f)}
              />
            );
          })()}

          {/*
            ═══════════════════════════════════════════════════════════════════
            ACÁ HABÍA UN SEGUNDO BOTÓN, Y SE FUE — etapa BP40
            ═══════════════════════════════════════════════════════════════════

            Decía "Pick a funnel to activate" y luego "Activate <nombre>". Con la
            tarjeta activando de una, este botón solo podía repetir el acto que
            ya se hizo: quedaba deshabilitado para siempre, porque `picked` deja
            de estar vacío justo cuando la activación ya arrancó.

            La NOTA se queda. Es lo único de este bloque que informaba algo, y es
            lo que explica por qué editar la biblioteca después no rompe planes.
          */}
          <div className="bp-catalog__actions">
            <span className="bp-catalog__hint">
              The plan is copied from the template, so editing the library later will not change it.
            </span>
          </div>

          {/*
            LA CONFIRMACIÓN DICE EL NÚMERO — etapa BP40. No "se va a borrar el
            plan actual", que es genérico y no se lee, sino cuántos steps hechos
            se pierden. Solo aparece en modo cambio: activar sobre nada no borra
            nada, y pedir confirmación ahí ensuciaría el gesto de un clic.
          */}
          {confirming !== null && current !== null && (
            <Modal title="Replace the current plan?" onClose={() => setConfirming(null)}>
              <div className="bp-form">
                <p className="bp-modal__lead">
                  <strong>{lo?.fullName ?? 'This person'}</strong> is on{' '}
                  <strong>{current.funnel_name}</strong>, started {current.activated_at.slice(0, 10)}.
                  Switching to <strong>{confirming.name}</strong> deletes that plan.
                </p>
                {/*
                  El número va en la línea de advertencia, no en la de contexto:
                  `--warn` es lo que la pinta distinto del resto del modal, y este
                  es el dato por el que alguien puede decidir no seguir.
                */}
                <p className="bp-modal__lead bp-modal__lead--warn">
                  It has{' '}
                  <strong>
                    {doneCount} completed step{doneCount === 1 ? '' : 's'}
                  </strong>
                  {doneCount > 0 ? ', and they are deleted too' : ''} — along with its notes and its
                  baseline. This cannot be undone.
                </p>
                <div className="bp-form__actions">
                <button
                  type="button"
                  className="bp-btn bp-btn--primary"
                  disabled={busy}
                  onClick={() => {
                    const key = confirming.funnel_key;
                    setConfirming(null);
                    setPicked(key);
                    activate(key);
                  }}
                >
                  {busy ? 'Switching…' : 'Replace the plan'}
                </button>
                <button type="button" className="bp-linkish" onClick={() => setConfirming(null)}>
                  cancel
                </button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
