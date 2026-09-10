'use client';

/**
 * ============================================================================
 * ARRANCAR O RETOMAR UNA REVISIÓN
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Esta pantalla no se queda: crea o retoma la sesión y manda a la persona al
 * módulo de la fase donde hay que seguir. La máscara y el panel del paso viven
 * en el layout raíz, así que a partir de acá acompañan solos.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LA SESIÓN SE CREA AL LLEGAR, NO AL HACER CLIC EN LA LISTA
 * ---------------------------------------------------------------------------
 * Si se creara en el botón, un clic accidental dejaría una sesión abierta — y
 * `session_one_in_progress_idx` la volvería un bloqueo para ese Loan Officer
 * hasta que alguien la cierre. Acá el efecto está atado a la ruta, así que
 * llegar es la intención.
 *
 * Y `arrancarOSeguir` devuelve la que ya está en curso si hay: retomar es el
 * caso normal, no una excepción.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangleIcon } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '../../business-plan/components/shared';
import { arrancarOSeguir } from '@/lib/review/actions';
import { volverALaMascara } from '@/lib/review/maskExit';
import { buscarBranches, rutaDelModulo } from '@/lib/review/branches';
import { resumeCursor, orderedSteps } from '@/lib/review/progress';
import { useReview } from '@/components/review/ReviewProvider';
import { REVIEW_PATH } from '@/lib/auth/routes';


export default function ArrancarRevisionPage() {
  const params = useParams<{ assignmentKey: string }>();
  const router = useRouter();
  const assignmentKey = Number(params.assignmentKey);

  /*
   * ⚠ DEL PROVEEDOR. Acá estaba el defecto: esta pantalla creaba la sesión y
   * llamaba a `reload()` de SU instancia del hook, y el anfitrión de la máscara
   * tenía otra. Ahora es una sola, así que `recargar()` hace aparecer la barra.
   */
  /*
   * `myReviews` y no `reviews`: el aviso de abajo dice «no está en TU lista», y
   * con la lista completa --la que ve quien tiene `review_admin`-- eso era
   * falso: encontraba la asignación ajena e intentaba arrancarle una sesión.
   * RLS lo paraba (`session_insert` pide `owns_session`), así que el resultado
   * era un error crudo en vez del aviso que ya estaba escrito para este caso.
   */
  const { script: guion, myReviews: filas, isLoading, scriptError, reviewsError, recargar } =
    useReview();
  const [error, setError] = useState<string | null>(null);
  /* Que el efecto no corra dos veces: crear una sesión no es idempotente en el
     tiempo, y en desarrollo React monta dos veces a propósito. */
  const yaCorrio = useRef(false);

  const fila = useMemo(
    () => (filas ?? []).find((r) => r.assignment.assignment_key === assignmentKey) ?? null,
    [filas, assignmentKey]
  );

  useEffect(() => {
    if (yaCorrio.current) return;
    if (!guion || !fila) return;
    yaCorrio.current = true;

    (async () => {
      const orden = orderedSteps(guion);
      if (orden.length === 0) {
        setError('The coaching script has no steps. Nothing to do until it is loaded.');
        return;
      }
      const r = await arrancarOSeguir(assignmentKey, fila.assignment.lo_employee_key, {
        phase_no: orden[0].phase_no,
        step_in_phase: orden[0].step_in_phase,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }

      /*
       * ⚠ EL DESTINO SALE DE DÓNDE HAY QUE SEGUIR, no del cursor guardado.
       *
       * Si alguien completó el 1 y el 2, volvió a mirar el 1 y salió, el cursor
       * dice 1 y ahí no hay nada que hacer. `resumeCursor` da el primero
       * incompleto, que es lo que la persona necesita al reentrar.
       */
      /*
       * ⚠ VOLVER A ENTRAR A LA MÁSCARA — etapa RV5.
       *
       * `Save and exit` deja una marca local de que se salió de esta sesión, y
       * esa marca sobrevive a una recarga a propósito. Retomar es lo que la
       * borra, y ESTE es el punto de retomar: sin esto, salir una vez dejaría la
       * revisión sin máscara para siempre y `Continue` de `/review` no haría
       * nada visible.
       */
      volverALaMascara(r.data.session_key);

      const seguir = resumeCursor(guion, fila.responses) ?? {
        phase_no: r.data.current_phase,
        step_in_phase: r.data.current_step_in_phase,
      };
      const fase = guion.phases.find((f) => f.phase_no === seguir.phase_no);
      /*
       * ⚠ RECARGAR ANTES DE NAVEGAR. El proveedor es uno solo, así que esto es
       * lo que hace que la barra ya esté dibujada cuando la pantalla del módulo
       * aparece -- en vez de aparecer después, o no aparecer.
       */
      recargar();
      /*
       * ⚠ EL BRANCH SE ESPERA, igual que al avanzar de fase. La copia de esta
       * pantalla mandaba a `/outlook` y la del anfitrión al branch: retomar una
       * revisión parada en la fase 2 llevaba a la lista de los trece. Las dos
       * copias eran correctas cuando se escribieron; lo que las separó fue
       * editar una sola.
       */
      const codigos =
        fase?.module === 'outlook' ? await buscarBranches(fila.assignment.lo_employee_key) : [];
      router.push(
        rutaDelModulo(
          fase?.module ?? '',
          fila.assignment.lo_employee_key,
          codigos.length > 0 ? codigos[0] : null
        )
      );
    })();
    /* `recargar` y `router` fuera: el efecto tiene que correr una sola vez, y lo
       garantiza `yaCorrio` más la guarda de datos de arriba. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guion, fila, assignmentKey]);

  return (
    <>
      <nav className="rv-crumbs" aria-label="Breadcrumb">
        <Link href="/business-plan">Branch Portfolio</Link>
        <span aria-hidden="true">›</span>
        <Link href={REVIEW_PATH}>My coachees</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Starting…</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {fila ? 'Coaching ' + fila.loName : 'Starting the session'}
          </h1>
          <p className="page-head__subtitle">
            Opening the session and taking you to where the coaching continues.
          </p>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {scriptError && <ErrorState message={scriptError} />}
      {reviewsError && <ErrorState message={reviewsError} />}
      {error && (
        <div className="bp-pending" role="alert">
          <AlertTriangleIcon size={14} />
          <span>{error}</span>
        </div>
      )}

      {/*
        La asignación que no aparece tiene dos causas y las dos se dicen: no es
        tuya --RLS la filtró-- o no existe. Cero filas con `error: null` no
        distingue una de la otra, así que la pantalla nombra las dos en vez de
        elegir una.
      */}
      {!isLoading && !reviewsError && fila === null && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            This coaching session is not on your list. Either it is assigned to someone else or it was
            deactivated — <Link href={REVIEW_PATH}>go back to your coachees</Link>.
          </span>
        </div>
      )}
    </>
  );
}
