'use client';

/**
 * ============================================================================
 * LO QUE SE VA A GUARDAR, ANTES DE SOLTAR LA MÁSCARA
 * ============================================================================
 *
 * Etapa RV4 — ARCHIVO NUEVO. Punto 1 del brief.
 *
 * Al dar el último `OK` la revisión NO se cierra: se muestra todo lo que se
 * contestó, por fase, y desde acá se puede volver a cualquier paso a corregir.
 * La máscara se suelta cuando la persona lo dice.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ VA ANTES DE CERRAR Y NO DESPUÉS
 * ---------------------------------------------------------------------------
 * El brief pedía «al dar Finish, se muestra el intake completo para que se pueda
 * editar si algo quedó mal». Editar DESPUÉS de cerrar es imposible, y no por una
 * decisión de esta pantalla: `response_insert` exige `s.status = 'in_progress'`,
 * así que en cuanto la sesión pasa a `completed` la base rechaza toda respuesta
 * nueva. Verificado leyendo la policy.
 *
 * Así que el orden es: se muestra el resumen con la sesión TODAVÍA abierta, se
 * corrige lo que haga falta, y el cierre es el último gesto. Cumple lo que el
 * brief pide y no pelea con el modelo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y NO ES EL INTAKE DEL PERFIL
 * ---------------------------------------------------------------------------
 * Se parece --las mismas respuestas, agrupadas por fase-- y es otra cosa: el
 * intake es el REGISTRO de lo que ya pasó, y sólo muestra revisiones cerradas.
 * Esto es la última pantalla de una revisión abierta. Comparten el lenguaje
 * visual (`rv-intake__*`) porque leen igual, no el propósito.
 */

import { AlertTriangleIcon } from '@/components/ui/icons';
import { orderedSteps, sameStep } from '@/lib/review/progress';
import type { ReviewResponse, ReviewScript, StepRef } from '@/lib/review/types';

export interface ReviewSummaryProps {
  script: ReviewScript;
  responses: readonly ReviewResponse[];
  loName: string;
  /** Vuelve al paso a corregirlo. Cierra este resumen. */
  onCorregir: (paso: StepRef) => void;
  /** Cierra la revisión de verdad. El último gesto. */
  onCerrar: () => void;
  ocupado: boolean;
  error: string | null;
}

/** `2026-09-09T02:26:52Z` → `2026-09-09`. */
const dia = (iso: string) => iso.slice(0, 10);

export default function ReviewSummary({
  script,
  responses,
  loName,
  onCorregir,
  onCerrar,
  ocupado,
  error,
}: ReviewSummaryProps) {
  /*
   * La VIGENTE de cada paso: la tabla es append-only, así que corregir agrega
   * una fila. Se muestra la última, igual que el intake -- y por el mismo
   * motivo, que es que las tres no son tres respuestas sino una corregida dos
   * veces.
   */
  const ultimaDe = (paso: StepRef): ReviewResponse | null =>
    responses
      .filter((r) => sameStep(r, paso))
      .reduce<ReviewResponse | null>(
        (mejor, r) => (mejor === null || r.answered_at > mejor.answered_at ? r : mejor),
        null
      );

  const orden = orderedSteps(script);

  return (
    <div className="rv-panel rv-panel--resumen" role="region" aria-label="Review summary">
      <div className="rv-panel__head">
        <span className="rv-panel__step">Before closing</span>
        <span className="rv-panel__label">{loName}</span>
      </div>
      <p className="rv-panel__prompt">
        Everything you answered, in order. Fix anything that reads wrong — the session is still
        open. Closing it is the last step, and after that the comments cannot be edited.
      </p>

      <div className="rv-panel__resumenlista">
        {script.phases.map((f) => {
          const pasos = orden.filter((s) => s.phase_no === f.phase_no);
          return (
            <div key={f.phase_no} className="rv-intake__phase">
              <h3 className="rv-intake__phasehead">
                {f.label}
                <span className="rv-intake__phasen">
                  {pasos.filter((s) => ultimaDe(s) !== null).length} of {pasos.length}
                </span>
              </h3>
              {pasos.map((s) => {
                const r = ultimaDe(s);
                return (
                  <article
                    key={s.phase_no + ':' + s.step_in_phase}
                    className="rv-intake__answer"
                    data-review-summary-step={s.phase_no + '.' + s.step_in_phase}
                  >
                    <p className="rv-intake__step">{s.label}</p>
                    {/*
                      ⚠ UN PASO SIN RESPUESTA SE DICE. No debería poder pasar
                      --el último `OK` sólo llega estando todo contestado-- pero
                      si pasara, un hueco silencioso en el resumen es peor que
                      un aviso: es justo lo que este resumen viene a evitar.
                    */}
                    {r === null ? (
                      <p className="rv-intake__prompt rv-intake__prompt--gone">
                        Nothing answered for this step.
                      </p>
                    ) : (
                      <>
                        <p className="rv-intake__comment">{r.comment}</p>
                        <p className="rv-intake__by">
                          {r.answered_by} · {dia(r.answered_at)}
                        </p>
                      </>
                    )}
                    <button
                      type="button"
                      className="rv-panel__edit"
                      onClick={() => onCorregir({ phase_no: s.phase_no, step_in_phase: s.step_in_phase })}
                      disabled={ocupado}
                    >
                      {r === null ? 'Answer this step' : 'Fix this answer'}
                    </button>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="rv-panel__gate" role="alert">
          <AlertTriangleIcon size={13} /> {error}
        </p>
      )}

      <div className="rv-panel__actions">
        <button
          type="button"
          className="bp-btn bp-btn--primary bp-btn--small"
          onClick={onCerrar}
          disabled={ocupado}
        >
          {ocupado ? '…' : 'Close coaching'}
        </button>
        <span className="rv-panel__next">after this, the comments are read-only</span>
      </div>
    </div>
  );
}
