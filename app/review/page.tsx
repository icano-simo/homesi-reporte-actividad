'use client';

/**
 * ============================================================================
 * MIS REVISIONES — para el BP Team
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Cada revisor ve SÓLO sus Loan Officers asignados, con su fecha límite y un
 * botón para arrancar.
 *
 * ⚠ EL FILTRO ES DE RLS, NO DE ESTA PANTALLA. La consulta pide todas las
 * asignaciones activas y la base devuelve las del email de la sesión — o todas,
 * si tiene `review_admin`. Filtrar acá también sería duplicar la regla en un
 * lugar donde no protege nada: si divergieran ganaría la de la base, así que la
 * de acá sólo podría esconder filas que sí corresponden.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
/*
 * ⚠ `CalendarIcon` y NO un reloj, y es lo contrario de lo que decidi en BP47.
 *
 * Allá el icono acompañaba a `ends day 207`, que es un contador de días desde
 * el enrolamiento y no una fecha -- un calendario habría dicho otra cosa. Acá
 * acompaña a `due 2026-09-15`, que es una fecha de calendario de verdad.
 *
 * El mismo argumento, aplicado al dato que hay, apunta al otro lado.
 */
import { AlertTriangleIcon, CalendarIcon } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '../business-plan/components/shared';
import { useReview } from '@/components/review/ReviewProvider';
import type { ReviewUnavailable } from '@/lib/review/useReviewData';
import {
  daysUntilDue,
  isAbandoned,
  overallPercent,
  phaseProgress,
} from '@/lib/review/progress';
import type { MyReview, ReviewScript } from '@/lib/review/types';

/**
 * Cuántos días sin tocarse hacen que una sesión se lea como abandonada.
 *
 * Vive acá y no en `progress.ts` porque es una decisión de ESTA pantalla: dos
 * días es razonable para una revisión con SLA semanal, y no hay un número
 * correcto en general. Isabella puede querer otro.
 */
const DIAS_SIN_TOCAR = 2;

/** Qué falta aplicar, dicho con el archivo que lo aplica. */
function Pendiente({ que }: { que: Exclude<ReviewUnavailable, null> }) {
  return (
    <div className="bp-pending" role="status">
      <AlertTriangleIcon size={14} />
      <span>
        {que === 'schema-not-exposed' ? (
          <>
            The review tables exist but PostgREST is not serving them yet — apply{' '}
            <code>docs/sql/2026-09-review-expose-schema.sql</code>. A new schema is not exposed on
            its own.
          </>
        ) : (
          <>
            The review tables are not in the database yet — apply{' '}
            <code>docs/sql/2026-09-review-mode.sql</code>.
          </>
        )}
      </span>
    </div>
  );
}

/**
 * El estado de una fila. `pending` sale de DERIVAR que la sesión está en curso
 * y sin tocarse — no hay un estado `abandoned` en la base.
 */
function estadoDe(
  fila: MyReview,
  script: ReviewScript | null,
  ahora: Date
): { clase: string; texto: string } {
  if (!fila.session) return { clase: 'rv-state--none', texto: 'not started' };
  if (fila.session.status === 'completed') {
    return {
      clase: 'rv-state--done',
      texto: 'completed ' + (fila.session.completed_at ?? '').slice(0, 10),
    };
  }
  if (isAbandoned(fila.session, fila.responses, { now: ahora, staleDays: DIAS_SIN_TOCAR })) {
    return { clase: 'rv-state--stale', texto: 'pending — left unfinished' };
  }
  const pct = script ? overallPercent(script, fila.responses) : 0;
  return { clase: 'rv-state--progress', texto: 'in progress · ' + pct + '%' };
}

/** El SLA, con la palabra al lado del color. */
function slaDe(dueOn: string, ahora: Date): { clase: string; texto: string } {
  const dias = daysUntilDue(dueOn, ahora);
  if (dias < 0) {
    return { clase: 'rv-due rv-due--late', texto: 'overdue by ' + -dias + ' day' + (dias === -1 ? '' : 's') };
  }
  if (dias === 0) return { clase: 'rv-due rv-due--soon', texto: 'due today' };
  if (dias <= 2) return { clase: 'rv-due rv-due--soon', texto: 'due in ' + dias + ' days' };
  return { clase: 'rv-due', texto: 'due ' + dueOn };
}

export default function MyReviewsPage() {
  /*
   * ⚠ DEL PROVEEDOR y no de un hook propio. Dos instancias del mismo hook
   * fueron el defecto que dejo la mascara invisible: la de esta pantalla creaba
   * la sesion y recargaba, y la del anfitrion nunca se enteraba.
   */
  const { script: guion, reviews: filasCrudas, isLoading, scriptError, reviewsError,
    scriptUnavailable, reviewsUnavailable, myEmployeeKey, canAssign } = useReview();

  /*
   * `now` se congela al montar y NO se recalcula en cada render.
   *
   * Con `new Date()` suelto en el cuerpo, dos filas de la misma lista podrían
   * caer en días distintos si el render cruza la medianoche -- y peor, el
   * cálculo cambiaría entre renders sin que ningún dato se moviera. Es el mismo
   * motivo del `mountedAt` de la pantalla del plan.
   */
  const [ahora] = useState(() => new Date());

  const filas = useMemo(() => {
    const xs = filasCrudas ?? [];
    /* Las que hay que hacer primero arriba: por fecha de SLA, y las vencidas
       antes que las de hoy porque ya se pasaron. `due_on` ordena las dos. */
    return [...xs].sort((a, b) => a.assignment.due_on.localeCompare(b.assignment.due_on));
  }, [filasCrudas]);

  const pendiente = reviewsUnavailable ?? scriptUnavailable;

  return (
    <>
      {/*
        ⚠ NO SE USA `Breadcrumbs`, y no por gusto: ese componente NO PINTA NADA
        por sí solo -- registra las migas por contexto y las dibuja
        `BusinessPlanShell`, que vive en el layout de Business Plan. Acá abajo no
        hay tal shell, así que llamarlo era un no-op silencioso: la captura no
        mostraba ninguna miga y nada fallaba.
      */}
      <nav className="rv-crumbs" aria-label="Breadcrumb">
        <Link href="/business-plan">Branch Portfolio</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">My reviews</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-head__title">My reviews</h1>
          <p className="page-head__subtitle">
            The Loan Officers assigned to you, with the date each review is due.
          </p>
        </div>

        {/*
          ⚠ LA CONFIGURACIÓN ES UN ENLACE ACÁ, NO OTRA ENTRADA DEL SIDEBAR.
          `/review` la ve el BP Team entero; `/review/settings` exige
          `review_admin`, que hoy tienen cuatro personas. Una entrada de menú
          que rebota al landing para las otras 93 promete una sección que para
          ellas no existe.

          Y `canAssign` sale de `review.can_assign()` — la MISMA función que
          protege las escrituras, así que el enlace y el permiso no pueden
          divergir. Mientras la respuesta viaja no se dibuja nada: `undefined`
          no es `false`.
        */}
        {canAssign === true && (
          <Link className="bp-btn bp-btn--small" href="/review/settings">
            Review settings
          </Link>
        )}
      </div>

      {isLoading && <LoadingState />}
      {reviewsError && <ErrorState message={reviewsError} />}
      {scriptError && <ErrorState message={scriptError} />}
      {pendiente && <Pendiente que={pendiente} />}

      {/*
        ═══════════════════════════════════════════════════════════════════
        DOS VACÍOS QUE NO SON EL MISMO — etapa RV1
        ═══════════════════════════════════════════════════════════════════

        Las policies comparan contra `review.my_employee_key()`, que busca al
        empleado ACTIVO con el email de la sesión. Si no lo encuentra devuelve
        `null`, y entonces todas las consultas vuelven vacías con `error: null`.

        Así que cero filas tiene dos causas con la misma forma:

          · estás en el roster y nadie te asignó nada → se arregla asignando;
          · tu email no está en el roster → no se arregla desde esta app, y no
            vas a ver una asignación nunca.

        Medido con el usuario de prueba: `my_employee_key` devuelve `null` y la
        lista vuelve `[]` sin un solo error. Sin esta distinción, alguien con el
        email mal cargado esperaría para siempre una asignación que ya existe.

        Es la misma distinción que sostiene `outlook.snapshot.warnings` -- NULL
        es que nadie reportó, vacío es que se buscó y no había -- aplicada a la
        identidad en vez de a los datos.
      */}
      {!pendiente && !isLoading && !reviewsError && filas.length === 0 &&
        myEmployeeKey === null && (
          <div className="bp-pending" role="status">
            <AlertTriangleIcon size={14} />
            <span>
              Your sign-in email is not on the active roster, so no review can be assigned to you —
              and this list will stay empty until that is fixed. This is not something you can
              change from here: ask the Business Plan leads to check the email on your roster row.
            </span>
          </div>
        )}

      {!pendiente && !isLoading && !reviewsError && filas.length === 0 &&
        myEmployeeKey !== null && (
          <p className="bp-hint">
            {myEmployeeKey === undefined
              ? 'Checking who you are…'
              : 'Nothing assigned to you yet. Assignments are set in Review settings by the Business Plan leads.'}
          </p>
        )}

      {filas.length > 0 && (
        <div className="rv-list">
          {filas.map((fila) => {
            const est = estadoDe(fila, guion, ahora);
            const sla = slaDe(fila.assignment.due_on, ahora);
            const fases = guion ? phaseProgress(guion, fila.responses) : [];
            const enCurso = fila.session?.status === 'in_progress';
            return (
              <article key={fila.assignment.assignment_key} className="rv-row">
                <div className="rv-row__main">
                  <h2 className="rv-row__who">{fila.loName}</h2>
                  <div className="rv-row__meta">
                    <span className={sla.clase}>
                      <CalendarIcon size={11} aria-hidden="true" /> {sla.texto}
                    </span>
                    <span className={'rv-state ' + est.clase}>{est.texto}</span>
                    {/*
                      El avance por fase, también acá y no sólo en la máscara: es
                      lo que permite decidir a cuál volver sin abrir ninguna.
                    */}
                    {fases.length > 0 && (
                      <span>
                        {fases.map((f) => f.done + '/' + f.total).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="rv-row__actions">
                  {/*
                    ⚠ UN LINK Y NO UN BOTÓN QUE NAVEGA. Arrancar una revisión es
                    ir a una pantalla, así que ctrl+clic y "abrir en pestaña
                    nueva" tienen que funcionar. La sesión se crea al llegar, no
                    al hacer clic: si se creara acá, un clic accidental dejaría
                    una sesión abierta que después bloquea al Loan Officer por el
                    índice único de "una sola en curso".
                  */}
                  <Link
                    className="bp-btn bp-btn--primary bp-btn--small"
                    href={'/review/' + fila.assignment.assignment_key}
                  >
                    {enCurso ? 'Resume review' : fila.session ? 'Review again' : 'Start review'}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
