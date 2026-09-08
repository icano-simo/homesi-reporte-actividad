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
import { resumeCursor, orderedSteps } from '@/lib/review/progress';
import { useReview } from '@/components/review/ReviewProvider';
import { REVIEW_PATH } from '@/lib/auth/routes';

/** A dónde manda cada módulo del guion. */
function rutaDelModulo(modulo: string, loEmployeeKey: number): string {
  /*
   * ⚠ SE COMPARA CONTRA EL DATO DE LA BASE, que dice `business-plan` y
   * `outlook` -- con guion, igual que el segmento de la URL. Isabella lo aplicó
   * así y es mejor que lo que yo había sembrado (`business_plan`), justamente
   * porque coincide con la ruta.
   *
   * Y un módulo que este código no conoce cae en la lista de revisiones y no en
   * una ruta inventada: mandar a `/algo` daría un 404 en medio de una revisión.
   */
  if (modulo === 'business-plan') return '/business-plan/lo/' + loEmployeeKey;
  if (modulo === 'outlook') return '/outlook';
  return REVIEW_PATH;
}

export default function ArrancarRevisionPage() {
  const params = useParams<{ assignmentKey: string }>();
  const router = useRouter();
  const assignmentKey = Number(params.assignmentKey);

  /*
   * ⚠ DEL PROVEEDOR. Acá estaba el defecto: esta pantalla creaba la sesión y
   * llamaba a `reload()` de SU instancia del hook, y el anfitrión de la máscara
   * tenía otra. Ahora es una sola, así que `recargar()` hace aparecer la barra.
   */
  const { script: guion, reviews: filas, isLoading, scriptError, reviewsError, recargar } =
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
        setError('The review script has no steps. Nothing to do until it is loaded.');
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
      router.push(rutaDelModulo(fase?.module ?? '', fila.assignment.lo_employee_key));
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
        <Link href={REVIEW_PATH}>My reviews</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Starting…</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {fila ? 'Review of ' + fila.loName : 'Starting the review'}
          </h1>
          <p className="page-head__subtitle">
            Opening the session and taking you to where the review continues.
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
            This review is not on your list. Either it is assigned to someone else or it was
            deactivated — <Link href={REVIEW_PATH}>go back to your reviews</Link>.
          </span>
        </div>
      )}
    </>
  );
}
