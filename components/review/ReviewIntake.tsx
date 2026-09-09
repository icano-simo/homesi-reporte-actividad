'use client';

/**
 * ============================================================================
 * EL INTAKE, BAJO EL NOMBRE DEL LOAN OFFICER
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO. Punto 5 del brief.
 *
 * Los comentarios de cada revisión, agrupados por fase, con su fecha y su
 * autor. Y si hay varias revisiones se pueden comparar: van una debajo de la
 * otra, la más nueva primero.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NO DEPENDE DEL MODO REVISIÓN
 * ---------------------------------------------------------------------------
 * Es un REGISTRO, no un paso. Se ve con o sin sesión en curso, y quien lo mira
 * no tiene que estar revisando a nadie — lo único que decide es RLS.
 *
 * Por eso no vive en la máscara: la máscara desaparece al terminar, y el intake
 * es justamente lo que queda.
 *
 * ---------------------------------------------------------------------------
 * ⚠ MUESTRA EL PROMPT QUE SE CONTESTÓ
 * ---------------------------------------------------------------------------
 * Y marca cuál cambió desde entonces, en vez de esconderlo. Un comentario
 * respondiendo a una pregunta que ya no existe se entiende mal sin la pregunta,
 * y peor con la pregunta equivocada.
 */

import { useState } from 'react';
import { AlertTriangleIcon, CalendarIcon } from '@/components/ui/icons';
import { useIntake } from '@/lib/review/useIntake';

export interface ReviewIntakeProps {
  /** De quién es el intake. */
  loEmployeeKey: number;
  loName: string;
  /**
   * `false` cuando quien mira no pertenece a la app. No consulta nada.
   * Lo resuelve el proveedor de la revisión, que ya lo sabe.
   */
  habilitado: boolean;
}

/** `2026-09-08T22:21:55Z` → `2026-09-08`. Sin hora: el día es lo que importa. */
const dia = (iso: string) => iso.slice(0, 10);

export default function ReviewIntake({ loEmployeeKey, loName, habilitado }: ReviewIntakeProps) {
  const { sessions, isLoading, unavailable, error, visible } = useIntake(loEmployeeKey, habilitado);
  /*
   * Cuál revisión está abierta. La más nueva por defecto, y las otras
   * colapsadas: con tres revisiones de ocho pasos son 24 comentarios, y
   * abiertos de golpe entierran el resto del perfil.
   *
   * `null` = ninguna elegida todavía, así que se abre la primera.
   */
  const [abierta, setAbierta] = useState<number | null>(null);

  if (!habilitado || unavailable) return null;
  if (isLoading) return null;
  if (error) {
    return (
      <section className="rv-intake">
        <h2 className="rv-intake__head">Review intake</h2>
        <p className="rv-hint rv-hint--warn">
          <AlertTriangleIcon size={13} /> {error}
        </p>
      </section>
    );
  }

  const lista = sessions ?? [];

  /*
   * ⚠ TRES VACÍOS DISTINTOS, Y SE DICEN DISTINTO.
   *
   *   · no hay revisiones de esta persona     → no se dibuja nada
   *   · hay revisiones y RLS no las deja ver  → se dice que falta permiso
   *   · hay revisiones sin comentarios        → se dice que no contestó nada
   *
   * El primero no dibuja NADA a propósito: un encabezado «Review intake» vacío
   * en el perfil de las 30 personas sin revisión es ruido en 30 pantallas.
   */
  if (lista.length === 0) return null;

  if (!visible) {
    return (
      <section className="rv-intake">
        <h2 className="rv-intake__head">Review intake</h2>
        <p className="rv-hint">
          {loName} has {lista.length} review{lista.length === 1 ? '' : 's'} on record, but you
          cannot read the comments: they are visible to the reviewer and to the Business Plan leads.
          This is a permission, not an empty record.
        </p>
      </section>
    );
  }

  const conComentarios = lista.filter((s) => s.fases.length > 0);
  if (conComentarios.length === 0) {
    return (
      <section className="rv-intake">
        <h2 className="rv-intake__head">Review intake</h2>
        <p className="rv-hint">
          {loName} has {lista.length} review{lista.length === 1 ? '' : 's'} started and no comments
          answered yet.
        </p>
      </section>
    );
  }

  const activa = abierta ?? conComentarios[0].session.session_key;

  return (
    <section className="rv-intake">
      <h2 className="rv-intake__head">
        Review intake
        <span className="rv-intake__n">
          {conComentarios.length} review{conComentarios.length === 1 ? '' : 's'}
        </span>
      </h2>

      {/*
        Las revisiones como pestañas, la más nueva primero. Con una sola no se
        dibujan: un grupo de una pestaña no ofrece ninguna elección.
      */}
      {conComentarios.length > 1 && (
        <div className="rv-intake__tabs" role="tablist" aria-label="Reviews">
          {conComentarios.map((s) => (
            <button
              key={s.session.session_key}
              type="button"
              role="tab"
              aria-selected={s.session.session_key === activa}
              className={
                'rv-intake__tab' + (s.session.session_key === activa ? ' is-on' : '')
              }
              onClick={() => setAbierta(s.session.session_key)}
            >
              {dia(s.session.completed_at ?? s.session.started_at)}
              {s.session.status === 'in_progress' && <span className="rv-intake__wip">in progress</span>}
            </button>
          ))}
        </div>
      )}

      {conComentarios
        .filter((s) => s.session.session_key === activa)
        .map((s) => (
          /* Sin clase: es un envoltorio para la `key` y no tiene nada que
             declarar. Una clase sin regla es lo que acabo de sacar de acá. */
          <div key={s.session.session_key}>
            <p className="rv-intake__meta">
              <CalendarIcon size={12} aria-hidden="true" />
              {s.session.status === 'completed' ? (
                <>completed {dia(s.session.completed_at ?? '')}</>
              ) : (
                <>started {dia(s.session.started_at)} · still in progress</>
              )}
              {' · '}
              reviewed by {s.reviewerEmail}
            </p>

            {s.fases.map((f) => (
              <div key={f.phase_no} className="rv-intake__phase">
                <h3 className="rv-intake__phasehead">
                  {f.label}
                  <span className="rv-intake__phasen">
                    {f.answers.length} answer{f.answers.length === 1 ? '' : 's'}
                  </span>
                </h3>

                {f.answers.map((a) => (
                  <article key={a.phase_no + ':' + a.step_in_phase} className="rv-intake__answer">
                    <p className="rv-intake__step">{a.stepLabel}</p>

                    {/*
                      LA PREGUNTA QUE SE CONTESTÓ, no la vigente. Y si cambió
                      desde entonces se dice: un comentario leído contra otra
                      pregunta se entiende mal.
                    */}
                    {a.prompt !== null ? (
                      <p className="rv-intake__prompt">
                        {a.prompt}
                        {a.promptDesactualizado && (
                          <span
                            className="rv-intake__old"
                            title="This is the wording that was on screen when the comment was written. The question has been edited since."
                          >
                            wording has changed since
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="rv-intake__prompt rv-intake__prompt--gone">
                        The question this answers is no longer on record.
                      </p>
                    )}

                    <p className="rv-intake__comment">{a.comment}</p>
                    <p className="rv-intake__by">
                      {a.answeredBy} · {dia(a.answeredAt)}
                    </p>
                  </article>
                ))}
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
