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
import Modal from '@/app/business-plan/components/Modal';
import { AlertTriangleIcon, CalendarIcon, DownloadIcon, SignedDocIcon } from '@/components/ui/icons';
import { useIntake, type IntakeSession } from '@/lib/review/useIntake';

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
  const { sessions, enCurso, isLoading, unavailable, error } = useIntake(loEmployeeKey, habilitado);
  /*
   * Cuál revisión está abierta. La más nueva por defecto, y las otras
   * colapsadas: con tres revisiones de ocho pasos son 24 comentarios, y
   * abiertos de golpe entierran el resto del perfil.
   *
   * `null` = ninguna elegida todavía, así que se abre la primera.
   */
  const [abierta, setAbierta] = useState<number | null>(null);
  /* La descarga del PDF: cuál sesión se está preparando, y el error si la ruta
     falla. `null` en las dos cosas es «nada en curso» y «nada que decir». */
  const [bajando, setBajando] = useState<number | null>(null);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);

  /*
   * ⚠ EL NAVEGADOR DESCARGA, NOSOTROS NO ABRIMOS PESTAÑAS. La ruta contesta
   * con `Content-Disposition: attachment`, así que alcanza con un blob y un
   * `<a download>` sintético: sin popup que el navegador pueda bloquear.
   */
  async function descargar(s: IntakeSession) {
    setBajando(s.session.session_key);
    setErrorPdf(null);
    try {
      const cuerpo = {
        loName,
        reviewerEmail: s.reviewerEmail,
        estado:
          s.session.status === 'completed'
            ? 'completed ' + dia(s.session.completed_at ?? '')
            : 'started ' + dia(s.session.started_at) + ' · still in progress',
        generadoEl: new Date().toISOString().slice(0, 10),
        fases: s.fases.map((f) => ({
          phase_no: f.phase_no,
          label: f.label,
          answers: f.answers.map((a) => ({
            stepLabel: a.stepLabel,
            phase_no: a.phase_no,
            step_in_phase: a.step_in_phase,
            prompt: a.prompt,
            promptDesactualizado: a.promptDesactualizado,
            comment: a.comment,
            answeredAt: a.answeredAt,
            answeredBy: a.answeredBy,
          })),
        })),
      };
      const r = await fetch('/api/business-plan/intake-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      if (!r.ok) {
        /* El motivo del servidor, si lo mandó: «failed» a secas no dice nada. */
        const detalle = await r.json().catch(() => null);
        throw new Error(detalle?.error ?? 'The PDF could not be generated (' + r.status + ').');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Coach_intake_' + loName.replace(/[^A-Za-z0-9]+/g, '_') + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorPdf(e instanceof Error ? e.message : String(e));
    } finally {
      setBajando(null);
    }
  }
  /*
   * ⚠ EL CONTENIDO ARRANCA PLEGADO — etapa RV4.
   *
   * Desplegado ocupaba media pantalla del perfil y competía con los números,
   * que son para lo que la gente entra. Ahora es una fila que dice cuántas
   * revisiones hay y cuándo fue la última, y el detalle se abre.
   *
   * Va en el MODAL del módulo y no en un desplegable en su lugar porque es el
   * criterio que `Modal.tsx` escribe para sí mismo: página si es un destino,
   * modal si es «quiero ver esto un segundo y cerrar». Los comentarios de una
   * revisión cerrada son lo segundo -- el destino es el perfil.
   */
  const [desplegado, setDesplegado] = useState(false);

  if (!habilitado || unavailable) return null;
  if (isLoading) return null;
  if (error) {
    return (
      <section className="rv-intake">
        <h2 className="rv-intake__head">Coach intake</h2>
        <p className="rv-hint rv-hint--warn">
          <AlertTriangleIcon size={13} /> {error}
        </p>
      </section>
    );
  }

  const lista = sessions ?? [];

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ TRES VACÍOS DISTINTOS, Y SE DICEN DISTINTO — reescritos en RV23
   * ══════════════════════════════════════════════════════════════════════════
   *
   *   · ni cerradas ni abiertas          → no se dibuja nada
   *   · ninguna cerrada y alguna abierta → «hay una revisión sin cerrar»
   *   · cerradas sin un solo comentario  → «se cerró sin comentarios»
   *
   * El primero no dibuja NADA a propósito: un encabezado «Coach intake» vacío
   * en el perfil de las 30 personas sin revisión es ruido en 30 pantallas.
   *
   * ⚠ EL QUE SE FUE ES «no podés leer los comentarios». Decía que faltaba
   * permiso mirando cero respuestas, y hoy esa causa NO PUEDE pasar:
   * `session_select` y `response_select` son el mismo predicado
   * --`has_access()`--, así que quien ve la sesión ve sus respuestas, y quien
   * no tiene el claim no ve ninguna de las dos ni entra a Business Plan.
   *
   * Lo que sí pasaba era el otro caso, y el mensaje lo tapaba: la sesión 62 de
   * Luis Silva se cerró sin una sola respuesta, y el perfil decía «no tenés
   * permiso» en vez de «se cerró vacía». Es la familia de siempre --dos causas
   * con el mismo síntoma-- con el agravante de que el código eligió la que ya
   * no ocurre.
   *
   * ⚠ SI `response_select` VUELVE A SER MÁS ESTRECHA que `session_select`, el
   * estado tiene que volver: ahí cero respuestas significa dos cosas otra vez.
   */
  const abiertas =
    enCurso === 0 ? null : (
      <>
        {' '}
        {enCurso} coaching session{enCurso === 1 ? ' is' : 's are'} in progress and not closed yet
        {enCurso === 1 ? '; its' : '; their'} comments appear here once closed.
      </>
    );

  if (lista.length === 0) {
    if (enCurso === 0) return null;
    return (
      <section className="rv-intake">
        <h2 className="rv-intake__head">Coach intake</h2>
        <p className="rv-hint">
          {loName} has no closed coaching sessions yet.{abiertas}
        </p>
      </section>
    );
  }

  const conComentarios = lista.filter((s) => s.fases.length > 0);
  if (conComentarios.length === 0) {
    /* El dato que explica el vacío: cuándo se cerró. Sin eso, «sin comentarios»
       se lee como un error de la pantalla y no como lo que pasó ese día. */
    const cuando = dia(lista[0].session.completed_at ?? lista[0].session.started_at);
    return (
      <section className="rv-intake">
        <h2 className="rv-intake__head">Coach intake</h2>
        <p className="rv-hint">
          {loName} has {lista.length} closed coaching session{lista.length === 1 ? '' : 's'} with no
          comments recorded: {lista.length === 1 ? 'it was' : 'the last one was'} closed on {cuando}{' '}
          without a single answer.{abiertas}
        </p>
      </section>
    );
  }

  const activa = abierta ?? conComentarios[0].session.session_key;
  const ultima = conComentarios[0].session;
  const cuantas = conComentarios.length;

  /* La fila. Dice lo que hace falta para decidir si abrirla: cuántas hay y
     cuándo fue la última. */
  const gatillo = (
    <button
      type="button"
      className="rv-intake__open"
      onClick={() => setDesplegado(true)}
      aria-haspopup="dialog"
    >
      <SignedDocIcon size={15} />
      <span className="rv-intake__opentxt">
        Coach intake
        <span className="rv-intake__n">
          {cuantas} session{cuantas === 1 ? '' : 's'}
        </span>
        {/*
          La abierta se ANUNCIA acá y no se abre: su contenido se está
          escribiendo --la regla de RV4-- pero quien mira el perfil tiene que
          saber que lo que lee no es todo. Se reusa la clase de las pestañas: el
          mismo significado se ve igual, y no hay una clase nueva que definir.
        */}
        {enCurso > 0 && (
          <span className="rv-intake__wip">
            {enCurso} in progress
          </span>
        )}
      </span>
      <span className="rv-intake__openwhen">
        last {dia(ultima.completed_at ?? ultima.started_at)}
      </span>
      <span className="rv-intake__opencta">Open →</span>
    </button>
  );

  if (!desplegado) return gatillo;

  return (
    <>
      {gatillo}
      <Modal title={'Coach intake for ' + loName} onClose={() => setDesplegado(false)}>
      <section className="rv-intake rv-intake--modal">

      {/*
        Las revisiones como pestañas, la más nueva primero. Con una sola no se
        dibujan: un grupo de una pestaña no ofrece ninguna elección.
      */}
      {conComentarios.length > 1 && (
        <div className="rv-intake__tabs" role="tablist" aria-label="Coaching sessions">
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
              {/*
                ⚠ ESTA RAMA NO SE ALCANZA desde RV4: el hook devuelve sólo
                cerradas, así que ninguna pestaña puede estar en curso. Se deja
                --y no se borra-- porque el día que el intake muestre una
                abierta, la pestaña tiene que decirlo; lo que hoy lo dice es la
                fila de arriba, con el conteo.
              */}
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
              coached by {s.reviewerEmail}
              {/*
                ══════════════════════════════════════════════════════════
                EL PDF, DE LA REVISIÓN QUE ESTÁ ABIERTA — etapa BP50
                ══════════════════════════════════════════════════════════

                De ESTA revisión y no de todas: las pestañas de arriba existen
                porque una revisión se compara con la anterior, no porque se
                lean juntas. Un PDF con las cuatro sesiones pegadas no es un
                intake, es un archivo.

                ⚠ MANDA LO QUE YA TIENE, y no vuelve a consultar: `useIntake`
                resolvió los prompts, marcó los desactualizados y pasó por RLS.
                Una segunda lectura del lado del servidor sería otra fuente que
                puede decir algo distinto -- ver la nota de la ruta.
              */}
              <button
                type="button"
                className="rv-intake__pdf"
                data-rv-intake-pdf=""
                disabled={bajando === s.session.session_key}
                onClick={() => descargar(s)}
              >
                <DownloadIcon size={12} />
                {bajando === s.session.session_key ? 'Preparing…' : 'PDF'}
              </button>
            </p>
            {errorPdf !== null && <p className="bp-notice bp-notice--warn">{errorPdf}</p>}

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

                    {/*
                      ══════════════════════════════════════════════════════
                      EL DESENLACE DE LA FASE 3 — etapa RV10
                      ══════════════════════════════════════════════════════

                      Sin esto, «decidieron no elegir» y «falta el paso» se leen
                      igual: el comentario explica el motivo, pero nada dice que
                      el motivo ES la respuesta. La única señal sería el conteo
                      de respuestas de la fase, que nadie mira.

                      ⚠ EL NOMBRE SALE DEL `gate` Y NO DE `enrollment`. Es el
                      registro de lo que se decidió ESE DÍA: `cancel_funnel`
                      borra enrolamientos, y el intake tiene que seguir diciendo
                      qué se eligió aunque ese plan ya no exista.
                    */}
                    {a.gate !== null && typeof a.gate.funnel_chosen === 'boolean' && (
                      <p className="rv-intake__prompt">
                        {a.gate.funnel_chosen === true ? (
                          <>
                            Funnel chosen:{' '}
                            <strong>
                              {typeof a.gate.funnel_name === 'string'
                                ? a.gate.funnel_name
                                : 'one was selected'}
                            </strong>
                          </>
                        ) : (
                          <>
                            <strong>No funnel chosen</strong> — decided, not skipped. The comment
                            says why.
                          </>
                        )}
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
      </Modal>
    </>
  );
}
