'use client';

/**
 * ============================================================================
 * EL PANEL DEL PASO EN CURSO
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 * Etapa RV2 — un solo botón, y el campo sólo en el lugar del paso.
 *
 * Va anclado abajo, encima de la pantalla del módulo que la fase visita. La
 * persona ve el gráfico de cierres real y el paso arriba: la máscara guía, no
 * reemplaza.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LOS CAMPOS DE COMENTARIO SÓLO EXISTEN ACÁ, Y SÓLO EN SU LUGAR
 * ---------------------------------------------------------------------------
 * No hay un campo de comentario de revisión en ninguna pantalla del portal: el
 * único vive en este componente, que sólo se monta con una sesión en curso.
 *
 * Y desde RV2 tampoco alcanza con que haya sesión. El campo aparece cuando:
 *
 *   · el paso NO declara lugar (`gate_config.target` vacío) — no hay requisito;
 *   · o el lugar del paso está en ESTA página.
 *
 * Estando en el perfil de otra persona, o en otra pantalla del módulo, el panel
 * dice a dónde ir y NO ofrece dónde escribir. Un comentario contestado lejos de
 * lo que se está mirando es un comentario sobre otra cosa.
 *
 * Lleva `data-review-comment` para que se pueda VERIFICAR desde afuera que no
 * aparece en la app normal. La aserción existe desde antes que el campo.
 *
 * ⚠ Y HAY OTRO CAMPO EN EL PERFIL QUE NO ES ÉSTE: el de `NotesPanel`, las notas
 * del Business Plan --«What was discussed with this loan officer»--, que existe
 * desde BP20 y no tiene nada que ver con la revisión. Medido: sin sesión en
 * curso hay CERO campos de revisión y ése sigue estando. Que los dos pregunten
 * casi lo mismo es lo que confunde, y está reportado aparte.
 *
 * ---------------------------------------------------------------------------
 * ⚠ UN SOLO BOTÓN: `OK` GUARDA Y AVANZA
 * ---------------------------------------------------------------------------
 * En RV1 eran dos acciones separadas y quedaba `Save again` junto a `Continue`
 * -- dos botones donde va uno, y el de guardar permanente sobre un paso ya
 * guardado. Probado por Isabella: escribió, dio `OK`, y se quedó en el paso.
 *
 * Ahora `OK` guarda y mueve el cursor en un gesto. Y si el comentario ya está
 * guardado, editarlo es ENTRAR de nuevo --un `Edit` que trae el campo-- y no un
 * botón de guardar que vive ahí para siempre.
 *
 * Lo que RV1 quería proteger sigue en pie: `Continue` no navega solo. Nada se
 * mueve sin que alguien apriete algo; lo que cambió es que ese algo es uno.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangleIcon } from '@/components/ui/icons';
import {
  allowsSecondFunnel,
  gateEvidence,
  gateLink,
  gateStatus,
  requiredClicks,
  enPalabras,
  type StepDraft,
} from '@/lib/review/gates';
import { latestResponse, orderedSteps, sameStep } from '@/lib/review/progress';
/* `useEffect` queda para el listener de clics, que SÍ es una suscripción. */
import type { ReviewResponse, ReviewScript, ReviewSession, StepRef } from '@/lib/review/types';

export interface ReviewStepPanelProps {
  script: ReviewScript;
  session: ReviewSession;
  responses: ReviewResponse[];
  loName: string;
  /** El funnel activo del Loan Officer, para la fase 3. `null` = no tiene. */
  funnelActual: string | null;
  /**
   * Si estamos donde el paso apunta. Lo resuelve `useReviewTarget` en el
   * anfitrión, que es quien puede mirar el DOM de la página entera.
   *
   * `null` = el paso no declara lugar, así que no hay requisito.
   */
  enSitio: boolean | null;
  /** A dónde ir cuando el lugar del paso no está acá. */
  rutaDelPaso: string;
  /** Guarda el paso. Devuelve el error, o `null` si salió bien. */
  onGuardar: (paso: StepRef, revision: number, comment: string, gate: Record<string, unknown> | null) => Promise<string | null>;
  /** Mueve el cursor. Lo dispara `OK`, en el mismo gesto que el guardado. */
  onContinuar: (destino: StepRef) => Promise<string | null>;
  /** Cierra la revisión. Sólo se ofrece en el último paso del guion. */
  onCerrar: () => Promise<string | null>;
}

export default function ReviewStepPanel({
  script,
  session,
  responses,
  loName,
  funnelActual,
  enSitio,
  rutaDelPaso,
  onGuardar,
  onContinuar,
  onCerrar,
}: ReviewStepPanelProps) {
  const cursor: StepRef = {
    phase_no: session.current_phase,
    step_in_phase: session.current_step_in_phase,
  };
  const paso = script.steps.find((s) => sameStep(s, cursor)) ?? null;
  const texto = script.prompts.find((t) => paso && sameStep(t, paso)) ?? null;
  const yaContestado = latestResponse(responses, cursor);

  /*
   * ⚠ EL BORRADOR SE REHACE REMONTANDO, NO CON UN EFECTO.
   *
   * Arranca con lo YA CONTESTADO si el paso tiene respuesta: volver a un paso
   * cerrado tiene que mostrar lo que se escribió, y un campo vacío sobre un paso
   * completo se lee como que se perdió.
   *
   * Al cambiar de paso hay que rehacer estos cinco estados: sin eso, el
   * comentario del paso anterior queda escrito en el siguiente, que es la forma
   * más rápida de guardar la respuesta equivocada.
   *
   * Lo escribí como un `useEffect` que llamaba a cinco `setState`, y eslint lo
   * marcó con `react-hooks/set-state-in-effect`. Tenía razón, y el arreglo no
   * es callar la regla: el ANFITRIÓN le pasa un `key` con el paso, así que React
   * desmonta y vuelve a montar el panel y estos valores iniciales hacen el
   * trabajo solos.
   *
   * Mismo criterio que el `:has()` del corrimiento de la barra: si la presencia
   * del componente ya dice el estado, no hay nada que sincronizar.
   */
  const [comment, setComment] = useState(yaContestado?.comment ?? '');
  const [numero, setNumero] = useState<string>('');
  const [clicks, setClicks] = useState<string[]>(() =>
    Array.isArray(yaContestado?.gate?.clicked) ? (yaContestado.gate.clicked as string[]) : []
  );
  /* Un paso ya contestado tiene su presupuesto guardado: si no, no habría
     podido cerrarse. */
  const [budgetListo, setBudgetListo] = useState(yaContestado !== null);
  /*
   * ⚠ `editando` ES EL ESTADO QUE REEMPLAZA AL BOTÓN `Save again`.
   *
   * Un paso sin contestar entra editando: hay que escribir algo. Un paso ya
   * contestado entra CERRADO --se lee lo que se dijo-- y volver a abrirlo es un
   * gesto explícito. Así no queda un campo de comentario abierto sobre un paso
   * que ya está guardado, que es lo que hacía que `Save again` pareciera
   * obligatorio.
   */
  const [editando, setEditando] = useState(yaContestado === null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * ⚠ LOS CLICS SE ESCUCHAN EN `document`, EN CAPTURA.
   *
   * Los números que el paso 4 pide abrir viven en la pantalla de Business Plan,
   * que no sabe nada de la revisión. En vez de tocar cinco pantallas para que
   * avisen, el panel escucha: cualquier elemento con `data-review-click="id"`
   * cuenta como abierto.
   *
   * En CAPTURA y no en burbujeo: varios de esos controles llaman
   * `stopPropagation` --el menú de la tarjeta de nodo lo hace-- y en burbujeo
   * este listener no se enteraría. Y no cancela nada: el clic sigue su camino y
   * abre lo que tenía que abrir.
   *
   * ⚠ ESTO SIGUE SIN VERIFICARSE. Necesita llegar al paso 4 dentro de una
   * sesión, y eso espera al recorrido de Isabella. Declarado como no medido.
   */
  /*
   * ⚠ SIN `useMemo`. Lo había envuelto en uno con `[paso]` como dependencia, y
   * `paso` sale de un `find`: es una referencia nueva en cada render, así que el
   * memo se recalculaba siempre -- no memoizaba nada y encima eslint lo marcaba
   * con `react-hooks/preserve-manual-memoization`.
   *
   * Filtrar un array de dos elementos es más barato que el memo. Lo que SÍ
   * necesita ser estable es la dependencia del efecto, y para eso se serializa.
   */
  const pedidos = paso ? requiredClicks(paso) : [];
  const pedidosClave = pedidos.join(',');
  useEffect(() => {
    const lista = pedidosClave === '' ? [] : pedidosClave.split(',');
    if (lista.length === 0) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const marca = t.closest('[data-review-click]');
      const id = marca?.getAttribute('data-review-click');
      if (id && lista.includes(id)) {
        setClicks((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [pedidosClave]);

  if (!paso || !texto) {
    /*
     * El cursor apunta a un paso que el guion no tiene. No puede pasar --hay
     * una FK compuesta que lo impide-- pero si pasara, decirlo es mejor que un
     * panel en blanco.
     */
    return (
      <div className="rv-panel" role="region" aria-label="Review step">
        <p className="rv-panel__gate">
          <AlertTriangleIcon size={13} /> This review points at a step that is not in the script
          any more. Nothing was lost — ask for the script to be checked.
        </p>
      </div>
    );
  }

  const orden = orderedSteps(script);
  const i = orden.findIndex((s) => sameStep(s, cursor));
  const siguiente = i >= 0 && i + 1 < orden.length ? orden[i + 1] : null;
  const esUltimo = siguiente === null;

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * EL PASO NO SE CONTESTA DESDE ACÁ — punto 1 y 3 del brief de RV2
   * ═══════════════════════════════════════════════════════════════════════
   *
   * `enSitio === false` es «el paso declara un lugar y no es esta página».
   * Distinto de `null`, que es «no declara ninguno». Ver `stepTarget`.
   *
   * Se dibuja la cabecera y la pregunta --así sabe qué viene-- y nada donde
   * escribir. El link lleva al módulo de la fase.
   */
  if (enSitio === false) {
    return (
      <div className="rv-panel rv-panel--lejos" role="region" aria-label="Review step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
          {yaContestado && <span className="rv-panel__done">answered</span>}
        </div>
        <p className="rv-panel__prompt">{texto.prompt}</p>
        <p className="rv-panel__gate">
          This step is answered on the screen it points at, and that is not this one. The comment
          box lives there.
        </p>
        <div className="rv-panel__actions">
          <Link className="bp-btn bp-btn--primary bp-btn--small" href={rutaDelPaso}>
            Go to the step →
          </Link>
        </div>
      </div>
    );
  }

  const draft: StepDraft = {
    comment,
    numero: numero.trim() === '' ? null : Number(numero),
    clicks,
    budgetListo,
  };
  const estado = gateStatus(paso, draft);
  const link = gateLink(paso);
  const rotuloSiguiente = siguiente
    ? script.steps.find((s) => sameStep(s, siguiente))?.label ?? null
    : null;

  /**
   * ⚠ GUARDAR Y AVANZAR, EN UN GESTO.
   *
   * Y en este orden, con corte: si el guardado falla no se mueve el cursor. Si
   * el guardado sale y el movimiento falla, el paso QUEDA GUARDADO y el error
   * habla del movimiento -- que es la verdad, y es recuperable apretando otra
   * vez.
   */
  async function guardarYSeguir() {
    if (!estado.ok || ocupado) return;
    setOcupado(true);
    const errGuardar = await onGuardar(cursor, texto!.revision, comment, gateEvidence(paso!, draft));
    if (errGuardar) {
      setError(errGuardar);
      setOcupado(false);
      return;
    }
    setError(await (esUltimo ? onCerrar() : onContinuar(siguiente!)));
    setOcupado(false);
  }

  return (
    <div className="rv-panel" role="region" aria-label="Review step">
      <div className="rv-panel__head">
        <span className="rv-panel__step">
          Phase {paso.phase_no} · step {paso.step_in_phase}
        </span>
        <span className="rv-panel__label">{paso.label}</span>
        {yaContestado && <span className="rv-panel__done">answered</span>}
      </div>

      <p className="rv-panel__prompt">{texto.prompt}</p>
      {texto.helper && <p className="rv-panel__helper">{texto.helper}</p>}

      {/* El link del paso 2: se abre y se acuerda el número ahí mismo. */}
      {link && (
        <p className="rv-panel__helper">
          <a href={link} target="_blank" rel="noreferrer">
            Open MMI
          </a>{' '}
          to agree on the number with {loName}.
        </p>
      )}

      {/*
        LA FASE 3, EN SUS DOS FORMAS. Con funnel activo se CONFIRMA el que hay;
        sin funnel se elige. Ni se salta ni se cambia a la fuerza: cambiarlo
        llama a `cancel_funnel`, que BORRA el plan -- y hay planes con steps
        completados. Una revisión no puede destruir trabajo de costado.
      */}
      {paso.phase_no === 3 && (
        <div className="rv-panel__funnel">
          {funnelActual === null ? (
            <p className="rv-panel__helper">
              {loName} has no active funnel. Pick one on the profile, then close this step.
            </p>
          ) : (
            <>
              <p className="rv-panel__helper">
                {loName} is on <strong>{funnelActual}</strong>. Confirming keeps it — nothing is
                cancelled.
              </p>
              {!allowsSecondFunnel(paso) && (
                <p className="rv-panel__gate">
                  <AlertTriangleIcon size={13} /> Adding a second funnel is not available yet:
                  today the app shows one plan per person, so a second one would be invisible.
                  Changing this funnel instead would cancel the current plan and its completed
                  steps.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {paso.gate_kind === 'number' && editando && (
        <label className="rv-panel__field">
          <span className="rv-panel__fieldlabel">Benchmark</span>
          <input
            className="field"
            type="number"
            min="0"
            step="1"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="closings per month"
          />
        </label>
      )}

      {pedidos.length > 0 && (
        <ul className="rv-panel__clicks">
          {pedidos.map((c) => (
            <li key={c} className={clicks.includes(c) ? 'is-done' : ''}>
              <span aria-hidden="true">{clicks.includes(c) ? '✓' : '○'}</span> {enPalabras(c)}
            </li>
          ))}
        </ul>
      )}

      {paso.gate_kind === 'budget' && editando && (
        <label className="rv-panel__check">
          <input
            type="checkbox"
            checked={budgetListo}
            onChange={(e) => setBudgetListo(e.target.checked)}
          />
          <span>I saved the budget for {loName} in Outlook</span>
        </label>
      )}

      {/*
        ⚠ EL CAMPO SÓLO EXISTE EDITANDO. Un paso ya guardado muestra lo que se
        dijo, y volver a abrirlo es el `Edit` de abajo. Es lo que reemplaza al
        `Save again` permanente.
      */}
      {editando ? (
        <label className="rv-panel__field">
          <span className="rv-panel__fieldlabel">Comment</span>
          <textarea
            className="field rv-panel__text"
            data-review-comment=""
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you discuss?"
          />
        </label>
      ) : (
        <div className="rv-panel__saved">
          <p className="rv-panel__savedtext">{comment}</p>
          <button
            type="button"
            className="rv-panel__edit"
            onClick={() => setEditando(true)}
            disabled={ocupado}
          >
            Edit this comment
          </button>
        </div>
      )}

      {error && (
        <p className="rv-panel__gate" role="alert">
          <AlertTriangleIcon size={13} /> {error}
        </p>
      )}

      {/*
        ⚠ EL MOTIVO AL LADO DEL BOTÓN, no sólo el botón apagado. Un control
        deshabilitado sin explicación obliga a adivinar si falta algo o si la
        app está rota.
      */}
      {editando && !estado.ok && estado.falta && <p className="rv-panel__gate">{estado.falta}</p>}

      <div className="rv-panel__actions">
        {/*
          UN SOLO BOTÓN, y dice lo que va a pasar. Editando guarda y avanza;
          cerrado sólo avanza, porque no hay nada nuevo que guardar.
        */}
        {editando ? (
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            disabled={!estado.ok || ocupado}
            onClick={guardarYSeguir}
          >
            {esUltimo ? 'OK and finish review' : 'OK'}
          </button>
        ) : (
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              setError(await (esUltimo ? onCerrar() : onContinuar(siguiente!)));
              setOcupado(false);
            }}
          >
            {esUltimo ? 'Finish review' : 'Continue →'}
          </button>
        )}

        {/* Qué sigue, en palabras. Un botón que mueve la pantalla tiene que
            decir a dónde antes de que se aprete. */}
        {!esUltimo && rotuloSiguiente && (
          <span className="rv-panel__next">next: {rotuloSiguiente}</span>
        )}
      </div>
    </div>
  );
}
