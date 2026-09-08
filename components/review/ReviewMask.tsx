'use client';

/**
 * ============================================================================
 * LA MÁSCARA DEL MODO REVISIÓN
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * ---------------------------------------------------------------------------
 * ⚠ VIVE EN EL LAYOUT RAÍZ, Y ESO ES EL REQUISITO, NO UNA UBICACIÓN CÓMODA
 * ---------------------------------------------------------------------------
 * La revisión cruza de Business Plan a Outlook y vuelve. Si la barra viviera en
 * el layout de un módulo se DESMONTARÍA al cruzar, y con ella el estado de la
 * sesión en memoria: la persona vería la máscara desaparecer en la mitad de una
 * conversación con el Loan Officer.
 *
 * La documentación de Next lo dice de forma explícita — «Layouts do not
 * re-render on navigation» (`03-api-reference/03-file-conventions/layout.md`),
 * y es por eso que el layout raíz es el único lugar donde esto funciona. Leído
 * antes de escribirlo, no después.
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y NO DIBUJA NADA SI NO HAY SESIÓN EN CURSO
 * ---------------------------------------------------------------------------
 * Ni la barra, ni el borde, ni un contenedor vacío. La app normal tiene que
 * quedar idéntica: si la máscara dejara un `<div>` de altura cero en el layout
 * raíz, cualquier regla futura de `body > div:first-child` cambiaría de
 * significado para las cuatro pantallas del portal.
 *
 * Es el mismo criterio que hace que los campos de comentario sólo existan en
 * modo revisión: lo que no está no puede quedar suelto.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { REVIEW_PATH } from '@/lib/auth/routes';
import { overallPercent, phaseProgress } from '@/lib/review/progress';
import type { MyReview, ReviewScript } from '@/lib/review/types';

export interface ReviewMaskProps {
  /** El guion. `null` mientras no llegó, o si el esquema no está expuesto. */
  script: ReviewScript | null;
  /** La revisión con sesión EN CURSO, o `null` si no hay ninguna. */
  activo: MyReview | null;
  /** Qué módulo está cargando, si alguno. Ver la nota del cruce. */
  cargandoModulo: string | null;
  onSaveAndExit: () => void;
}

export default function ReviewMask({
  script,
  activo,
  cargandoModulo,
  onSaveAndExit,
}: ReviewMaskProps) {
  const fases = useMemo(
    () => (script && activo ? phaseProgress(script, activo.responses) : []),
    [script, activo]
  );

  /*
   * Sin sesión en curso no hay máscara. Y sin guion tampoco: dibujar la barra
   * sin poder decir en qué fase va sería una barra que miente sobre el avance.
   */
  if (!activo || !activo.session || activo.session.status !== 'in_progress' || !script) {
    return null;
  }

  const pct = overallPercent(script, activo.responses);
  const faseActual = fases.find((f) => f.phase_no === activo.session!.current_phase) ?? null;
  const total = fases.length;

  return (
    <>
      {/*
        EL BORDE. Es un elemento propio y no un `border` en el `<body>`: un borde
        en el body empuja el contenido y recalcula el layout de las cuatro
        pantallas. Fijo, sin eventos de puntero, encima de todo.
      */}
      <div className="rv-edge" aria-hidden="true" />

      <div className="rv-bar" role="status" aria-live="polite">
        <div className="rv-bar__main">
          <span className="rv-bar__tag">Review mode</span>
          <span className="rv-bar__who">{activo.loName}</span>
          {faseActual && (
            <>
              <span className="rv-bar__sep">·</span>
              <span className="rv-bar__phase">
                Phase {faseActual.phase_no} of {total}
              </span>
              <span className="rv-bar__sep">·</span>
              <span className="rv-bar__mod">{faseActual.label}</span>
            </>
          )}
          <span className="rv-bar__sep">·</span>
          <span className="rv-bar__pct">{pct}%</span>

          {/*
            ⚠ EL AVISO DE CARGA. Cruzar a Outlook tarda segundos porque el módulo
            carga todo al entrar, y sin esto la pantalla queda en blanco: la
            persona no sabe si la app se colgó o si está trabajando. Va en la
            barra --que no se desmonta-- y no en la página, que es justamente la
            que todavía no existe.
          */}
          {cargandoModulo !== null && (
            <span className="rv-bar__loading">Loading {cargandoModulo}…</span>
          )}
        </div>

        {/*
          La lista de fases, con su avance. Tres estados y ninguno es sólo color:
          `✓` completa, `●` en curso, `○` sin abrir, y el conteo al lado.
        */}
        <ol className="rv-steps">
          {fases.map((f) => {
            const enCurso = f.phase_no === activo.session!.current_phase;
            const marca = f.complete ? '✓' : enCurso ? '●' : '○';
            return (
              <li
                key={f.phase_no}
                className={
                  'rv-steps__item' +
                  (f.complete ? ' is-done' : '') +
                  (enCurso ? ' is-current' : '')
                }
              >
                <span className="rv-steps__mark" aria-hidden="true">
                  {marca}
                </span>
                <span className="rv-steps__label">{f.label}</span>
                <span className="rv-steps__count">
                  {f.done} of {f.total}
                </span>
              </li>
            );
          })}
        </ol>

        {/*
          `Save and exit` deja la sesión EN CURSO, no la cierra: el punto 4 del
          brief. Lo que hace es soltar la máscara y volver a la lista; lo hecho
          ya está guardado paso por paso, así que no hay nada que confirmar.
        */}
        <Link className="rv-bar__exit" href={REVIEW_PATH} onClick={onSaveAndExit}>
          Save and exit
        </Link>
      </div>
    </>
  );
}
