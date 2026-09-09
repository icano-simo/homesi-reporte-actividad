'use client';

/**
 * ============================================================================
 * EL AVANCE DE LA REVISIÓN, DEBAJO DEL MENÚ
 * ============================================================================
 *
 * Etapa RV2 — ARCHIVO NUEVO. Punto 4 del brief.
 *
 * Estaba en la barra de arriba y ahí se perdía entre el texto: el rótulo del
 * modo --`Review mode` entonces, `Coach mode` desde RV9--,
 * el nombre, la fase, el módulo, el porcentaje y las tres fases con su conteo,
 * todo en una línea de 42px. Debajo del sidebar hay espacio libre y no compite
 * con nada.
 *
 * La barra se queda con lo mínimo: que hay una revisión activa y de quién.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ VIVE ACÁ Y NO EN EL LAYOUT RAÍZ, COMO LA BARRA
 * ---------------------------------------------------------------------------
 * Porque «debajo del sidebar» sólo existe donde hay sidebar, y el sidebar lo
 * monta el layout del módulo. Ponerlo en el layout raíz y ubicarlo con CSS
 * habría sido un elemento fijo adivinando dónde termina un menú que no ve.
 *
 * ⚠ Y LA CONSECUENCIA, QUE HAY QUE SABER: en la fase 2 la revisión visita
 * Outlook, que no monta este sidebar. Ahí no hay tarjeta de avance — queda la
 * barra de arriba diciendo que hay una revisión y de quién, y el panel del paso
 * abajo. El avance vuelve al volver a Business Plan.
 *
 * Es una pérdida real y se declara en vez de taparse: la alternativa era un
 * segundo lugar donde dibujarlo, con su propio criterio de posición, para dos
 * pasos de ocho.
 */

import { useMemo } from 'react';
import { overallPercent, phaseProgress } from '@/lib/review/progress';
import { useReview } from './ReviewProvider';

export default function ReviewProgress() {
  /* `recorriendo` y no la lista: salió de la máscara significa que el sidebar
     tampoco muestra el avance. La sesión sigue abierta y se retoma desde
     `/review`, que es donde se ve que sigue abierta. */
  const { script, recorriendo, habilitado } = useReview();
  const activo = recorriendo;
  const fases = useMemo(
    () => (script && activo ? phaseProgress(script, activo.responses) : []),
    [script, activo]
  );

  /* Sin revisión en curso no hay tarjeta. Y sin guion tampoco: dibujar un
     avance sin poder decir de cuántas fases sería un número que miente. */
  if (!habilitado || !activo || !activo.session || activo.session.status !== 'in_progress' || !script) {
    return null;
  }

  const pct = overallPercent(script, activo.responses);
  const faseActual = activo.session.current_phase;

  return (
    <section className="rv-prog" aria-label="Review progress">
      <h2 className="rv-prog__head">
        Review progress
        <span className="rv-prog__pct">{pct}%</span>
      </h2>

      {/*
        La barra del porcentaje. `aria-hidden` porque el número ya está escrito
        arriba: leerlo dos veces con un lector de pantalla no agrega nada.
      */}
      <div className="rv-prog__bar" aria-hidden="true">
        <span className="rv-prog__fill" style={{ width: pct + '%' }} />
      </div>

      <ol className="rv-prog__list">
        {fases.map((f) => {
          const enCurso = f.phase_no === faseActual;
          /* Tres estados y ninguno es sólo color: la marca los dice también. */
          const marca = f.complete ? '✓' : enCurso ? '●' : '○';
          return (
            <li
              key={f.phase_no}
              className={
                'rv-prog__item' + (f.complete ? ' is-done' : '') + (enCurso ? ' is-current' : '')
              }
              aria-current={enCurso ? 'step' : undefined}
            >
              <span className="rv-prog__mark" aria-hidden="true">
                {marca}
              </span>
              <span className="rv-prog__label">{f.label}</span>
              <span className="rv-prog__count">
                {f.done} of {f.total}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
