'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { useSessionEmail } from '@/lib/business-plan/useFunnelLibrary';
import { useTeamAssignments } from '@/lib/business-plan/useTeamAssignments';
import { MILESTONE_STATUS_CLASS, MILESTONE_STATUS_LABEL, isOverdue } from '@/lib/business-plan/funnels';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../components/Breadcrumbs';
import { FunnelGlyph } from '../components/funnelIcons';
import { Avatar, ErrorState, LoadingState } from '../components/shared';

/**
 * ============================================================================
 * BP TEAM — el consolidado de una persona del equipo de soporte
 * ============================================================================
 *
 * Etapa BP20 — ARCHIVO NUEVO. Cuarta entrada del menú del módulo.
 *
 * Las otras tres pantallas están organizadas por Loan Officer: para saber todo
 * lo que tiene pendiente Angela había que abrir los planes uno por uno y buscar
 * su nombre en cada lista de pasos. Esta lo da vuelta y ordena por PERSONA DEL
 * EQUIPO, que es como trabaja el equipo de soporte.
 *
 * ---------------------------------------------------------------------------
 * ⚠ DOS TABLAS, PORQUE SON DOS RESPONSABILIDADES DISTINTAS
 * ---------------------------------------------------------------------------
 * Arriba, los PASOS asignados: trabajo concreto con fecha. Abajo, las ETAPAS de
 * las que se es responsable de nodo: se responde por que avancen, sin
 * necesariamente ejecutar ninguno de sus pasos. Es la misma distinción que hace
 * la tarjeta del nodo en el plan, y juntarlas acá la volvería a borrar.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE IDENTIFICA A LA PERSONA
 * ---------------------------------------------------------------------------
 * Por el EMAIL de la sesión contra `org.dim_employee.email`, igual que la regla
 * de quién puede cerrar un paso. Los ocho del equipo tienen su email cargado y
 * coincide con el de `auth.users`.
 *
 * Si el email de la sesión no es de nadie del equipo, NO se muestra una tabla
 * vacía: una tabla vacía se lee como "no tenés nada pendiente", que es una
 * respuesta falsa a una pregunta que no se hizo. Se dice que esa cuenta no
 * tiene asignaciones y se ofrece el selector.
 */

export default function TeamPage() {
  const { data: bpData, isLoading: loadingRoster } = useBusinessPlanData();
  const { data, isLoading, available, error } = useTeamAssignments();
  const sessionEmail = useSessionEmail();

  const [picked, setPicked] = useState<number | null>(null);

  /* Hoy, fijado al montar: leer el reloj en cada render haría que dos renders
     del mismo estado pudieran discrepar al cruzar la medianoche. */
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  /** Quién de los ocho es la sesión. `null` si el email no es de ninguno. */
  const sessionPerson = useMemo(() => {
    if (!data || !sessionEmail) return null;
    const norm = sessionEmail.trim().toLowerCase();
    return data.team.find((p) => (p.email ?? '').trim().toLowerCase() === norm) ?? null;
  }, [data, sessionEmail]);

  /* El selector manda; si nadie eligió, se muestra a la persona de la sesión. */
  const viewingKey = picked ?? sessionPerson?.employee_key ?? null;
  const viewing = data?.team.find((p) => p.employee_key === viewingKey) ?? null;
  const isSelf = viewing !== null && sessionPerson !== null && viewing.employee_key === sessionPerson.employee_key;

  /** Nombre y branch del Loan Officer, del roster que ya calcula la atribución. */
  const loInfo = (employeeKey: number) => {
    const lo = bpData?.loanOfficers.find((x) => x.employeeKey === employeeKey);
    return { name: lo?.fullName ?? 'Employee ' + employeeKey, branch: lo?.branchCodes[0] ?? null };
  };

  const mySteps = useMemo(() => {
    if (!data || viewingKey === null) return [];
    return data.steps
      .filter((s) => s.accountable_employee_key === viewingKey)
      /*
       * Por FECHA, no por plan ni por funnel: la pregunta que trae a alguien a
       * esta pantalla es "qué me toca ahora". Los sin fecha van al final --
       * ordenarlos como si vencieran hoy los pondría arriba de todo lo urgente.
       */
      .sort((a, b) => {
        if (a.due_date === b.due_date) return a.title.localeCompare(b.title);
        if (a.due_date === null) return 1;
        if (b.due_date === null) return -1;
        return a.due_date < b.due_date ? -1 : 1;
      });
  }, [data, viewingKey]);

  const myNodes = useMemo(() => {
    if (!data || viewingKey === null) return [];
    return data.nodes
      .filter((n) => n.ownerKeys.includes(viewingKey))
      .sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'));
  }, [data, viewingKey]);

  const overdueCount = mySteps.filter((s) => isOverdue(s.status, s.due_date, today)).length;
  const openCount = mySteps.filter((s) => s.status !== 'done').length;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: 'BP Team' }]} />

      <div className="bp-eyebrow">Business Plan · Support team</div>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">What I am accountable for</h1>
          <p className="page-head__subtitle">
            Every active plan, consolidated by person — the steps assigned to you and the stages you own.
          </p>
        </div>
        {data && data.team.length > 0 && (
          <div className="bp-team-picker">
            <label className="bp-form__label" htmlFor="bp-team-person">
              Showing
            </label>
            <select
              id="bp-team-person"
              className="field"
              value={viewingKey ?? ''}
              onChange={(e) => setPicked(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">— pick a person —</option>
              {data.team.map((p) => (
                <option key={p.employee_key} value={p.employee_key}>
                  {p.full_name}
                  {p.employee_key === sessionPerson?.employee_key ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(isLoading || loadingRoster) && <LoadingState />}
      {error && <ErrorState message={error} />}

      {!isLoading && !error && !available && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            The plan tables are not in the database yet — apply{' '}
            <code>docs/sql/2026-08-business-plan-funnels.sql</code> first.
          </span>
        </div>
      )}

      {/*
        La cuenta no es de nadie del equipo. Se dice, en vez de mostrar dos
        tablas vacías que se leerían como "no tenés nada pendiente".
      */}
      {data && available && sessionPerson === null && picked === null && (
        <div className="empty">
          <h2>This account has no assignments</h2>
          <p>
            {sessionEmail ? <code>{sessionEmail}</code> : 'This session'} is not one of the {data.team.length} people on
            the support team, so nothing is assigned to it. Pick someone above to review their workload.
          </p>
        </div>
      )}

      {data && available && viewing && (
        <>
          <div className="bp-team-head">
            <Avatar name={viewing.full_name} size="md" />
            <div>
              <h2 className="bp-team-head__name">
                {viewing.full_name}
                {isSelf && <span className="bp-chip">you</span>}
              </h2>
              <p className="bp-team-head__meta">{viewing.job_title ?? '—'}</p>
            </div>
            <div className="bp-team-head__counts">
              <span className="bp-pill bp-pill--sky">{openCount} open steps</span>
              {overdueCount > 0 && <span className="bp-pill bp-pill--late">{overdueCount} overdue</span>}
              <span className="bp-pill bp-pill--sky">{myNodes.length} stages owned</span>
            </div>
          </div>

          {/* ── Pasos asignados ─────────────────────────────────────────────── */}
          <h3 className="bp-section-title">Steps assigned to {viewing.full_name.split(' ')[0]}</h3>
          <div className="tbl-card">
            <div className="tbl-scroll">
            <table className="piv bp-table--team">
              <colgroup>
                <col className="bp-col-tlo" />
                <col className="bp-col-tbranch" />
                <col className="bp-col-tfunnel" />
                <col className="bp-col-tnode" />
                <col className="bp-col-tstep" />
                <col className="bp-col-tstatus" />
                <col className="bp-col-tdate" />
              </colgroup>
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Loan Officer</th>
                  <th className="bp-center">Branch</th>
                  <th className="bp-left">Funnel</th>
                  <th className="bp-left">Node</th>
                  <th className="bp-left">Step</th>
                  <th className="bp-center">Status</th>
                  <th className="bp-center">Target date</th>
                </tr>
              </thead>
              <tbody>
                {mySteps.map((s) => {
                  const info = loInfo(s.employee_key);
                  const late = isOverdue(s.status, s.due_date, today);
                  return (
                    <tr key={s.enrollment_milestone_key} className={'metric' + (late ? ' is-late' : '')}>
                      <td className="lbl">
                        {/* Al plan de esa persona, que es donde se actúa. */}
                        <Link href={'/business-plan/lo/' + s.employee_key + '/plan'} className="bp-linkish">
                          {info.name}
                        </Link>
                      </td>
                      <td className="bp-center">{info.branch ?? '—'}</td>
                      <td className="bp-left">
                        <FunnelGlyph icon={s.funnel_icon} size={14} />
                        {s.funnel_name}
                      </td>
                      <td className="bp-left">{s.node_name}</td>
                      <td className="bp-left bp-wrap">{s.title}</td>
                      <td className="bp-center">
                        <span className={MILESTONE_STATUS_CLASS[s.status]}>{MILESTONE_STATUS_LABEL[s.status]}</span>
                      </td>
                      {/*
                        Lo vencido, destacado. No es sólo color: lleva la palabra
                        "overdue" en el `title`, porque un rojo suelto obliga a
                        adivinar qué significa.
                      */}
                      <td className={'bp-center' + (late ? ' bp-late-cell' : '')} title={late ? 'Overdue' : undefined}>
                        {s.due_date ?? '—'}
                      </td>
                    </tr>
                  );
                })}
                {mySteps.length === 0 && (
                  <tr>
                    <td className="lbl bp-empty-cell" colSpan={7}>
                      No steps assigned across the active plans.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/* ── Etapas de las que es responsable ────────────────────────────── */}
          <h3 className="bp-section-title">Stages owned</h3>
          <p className="bp-muted-line">
            Being accountable for a stage is not the same as having its steps assigned — it means answering for the stage
            moving forward, whoever executes it.
          </p>
          <div className="tbl-card">
            <div className="tbl-scroll">
            <table className="piv bp-table--owned">
              <colgroup>
                <col className="bp-col-tlo" />
                <col className="bp-col-tbranch" />
                <col className="bp-col-tfunnel" />
                <col className="bp-col-tnode" />
                <col className="bp-col-tstatus" />
                <col className="bp-col-tdate" />
              </colgroup>
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Loan Officer</th>
                  <th className="bp-center">Branch</th>
                  <th className="bp-left">Funnel</th>
                  <th className="bp-left">Node</th>
                  <th className="bp-center">Progress</th>
                  <th className="bp-center">Next date</th>
                </tr>
              </thead>
              <tbody>
                {myNodes.map((n) => {
                  const info = loInfo(n.employee_key);
                  const late = n.nextDue !== null && n.nextDue < today && n.done < n.total;
                  return (
                    <tr key={n.enrollment_node_key} className={'metric' + (late ? ' is-late' : '')}>
                      <td className="lbl">
                        <Link href={'/business-plan/lo/' + n.employee_key + '/plan'} className="bp-linkish">
                          {info.name}
                        </Link>
                      </td>
                      <td className="bp-center">{info.branch ?? '—'}</td>
                      <td className="bp-left">
                        <FunnelGlyph icon={n.funnel_icon} size={14} />
                        {n.funnel_name}
                      </td>
                      <td className="bp-left">{n.node_name}</td>
                      <td className="bp-center">
                        {n.done}/{n.total}
                      </td>
                      <td className={'bp-center' + (late ? ' bp-late-cell' : '')} title={late ? 'Overdue' : undefined}>
                        {n.nextDue ?? '—'}
                      </td>
                    </tr>
                  );
                })}
                {myNodes.length === 0 && (
                  <tr>
                    <td className="lbl bp-empty-cell" colSpan={6}>
                      Not accountable for any stage in the active plans.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
