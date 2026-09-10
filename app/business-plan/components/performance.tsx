'use client';

import type { ReactNode } from 'react';
import { GAP_STATE_LABEL } from '@/lib/business-plan/qualifiers';
import { shortMonth } from '@/lib/business-plan/months';
import type { LoanOfficerRow, Qualifier2Metric } from '@/lib/business-plan/types';
import { ProvisionalTag, exactTitle, fmtActivityAvg, fmtAvg, fmtDecimal, fmtGap, fmtLoans } from './shared';

/**
 * ============================================================================
 * CURRENT Y FUTURE PERFORMANCE — los bloques que comparten las dos vistas
 * ============================================================================
 *
 * Etapa BP31 — ARCHIVO NUEVO. Nada acá es nuevo: todo salió del perfil del Loan
 * Officer, donde vivía escrito a mano.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * La revisión conjunta se construyó en BP23 con su propio markup, y no recibió
 * ninguno de los cambios posteriores. En BP29 la regla de Future performance
 * pasó al ritmo prorrateado y sólo cambió en el perfil: el grupo se quedó
 * mostrando "6 de 8" contra la meta del mes entero, que es la lógica que ese
 * cambio había reemplazado. Nadie se equivocó -- el diseño garantizaba que
 * pasara.
 *
 * Todo lo de acá recibe un `LoanOfficerRow` y no sabe si detrás hay una persona
 * o un grupo. Es lo que hace imposible que vuelvan a divergir: no hay dos
 * lugares donde cambiar una regla.
 *
 * Lo que NO se comparte, y está bien que no:
 *   · el editor del benchmark        -- el del grupo es una suma, no se edita
 *   · el aviso de veredicto informativo, la lista de miembros y la nota de
 *     préstamos compartidos           -- son propios del grupo
 *   · la barra de decisión y las notas -- se actúa sobre personas
 */

/* ─────────────────────── Current performance ───────────────────────────── */

/** Qué abre cada tarjeta. Lo resuelve quien la usa. */
export type ForensicTarget = 'closed' | 'pipeline' | 'healthy' | 'projected' | 'forecast';

/**
 * Las CINCO tarjetas del mes en curso, en el orden que pidió el negocio: de lo
 * más cierto a lo más pronosticado. Ese orden es el argumento -- primero lo que
 * ya pasó, después lo que falta -- y el total va al final.
 *
 * Todos los números ENTEROS: un préstamo es discreto. El valor exacto de los
 * que son fraccionarios queda en el `title`.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `data-review-click`: LAS CINCO ESTAN MARCADAS — etapa RV3
 * ---------------------------------------------------------------------------
 * El modo revisión puede pedir que un paso no se cierre hasta haber ABIERTO
 * ciertos números. Los identificadores viven en `gate_config.required_clicks`,
 * en la base, y el panel escucha los clics en `document`: cualquier elemento con
 * `data-review-click="id"` cuenta como abierto.
 *
 * ESTA PANTALLA NO SABE NADA DE LA REVISIÓN, y no tiene que saber: lo único que
 * aporta es el nombre de cada número. Por eso están las cinco y no las dos que
 * el guion pide hoy — pedir un clic nuevo tiene que ser una fila, no un cambio
 * acá.
 *
 * ⚠ Y LOS IDENTIFICADORES TIENEN QUE COINCIDIR CON LOS DE LA BASE. Si no
 * coinciden, el paso NO SE PUEDE CERRAR y nada falla: es exactamente lo que le
 * pasó a Isabella cuando el atributo no estaba escrito en ninguna parte. El
 * panel ahora lo dice en pantalla — ver `ReviewStepPanel`.
 */
export function ForensicCards({
  lo,
  thisMonth,
  onOpen,
}: {
  lo: LoanOfficerRow;
  thisMonth: string;
  onOpen: (target: ForensicTarget) => void;
}) {
  /* Lo que aporta el pipeline, sin lo ya cerrado. Forecast Total suma los dos. */
  const projectedFromPipeline = lo.projection.projectedTotal - lo.projection.closedToDate;
  const ctcAndClosing = lo.projection.inCtc + lo.projection.inClosing;

  return (
    <div className="bp-forensic">
      <ForensicItem
        label={'Closings in ' + shortMonth(thisMonth) + ' so far'}
        value={lo.projection.closedToDate}
        onClick={() => onOpen('closed')}
        reviewClick="closings_so_far"
      />
      <ForensicItem label="Total Pipeline" value={lo.projection.totalPipeline} suffix="loans" onClick={() => onOpen('pipeline')} reviewClick="total_pipeline" />
      <ForensicItem label="Healthy" value={lo.projection.healthyPipeline} suffix="loans" onClick={() => onOpen('healthy')} reviewClick="healthy_loans" />
      <ForensicItem
        label="Projected to close after PT"
        value={fmtLoans(projectedFromPipeline)}
        title={exactTitle(projectedFromPipeline)}
        onClick={() => onOpen('projected')}
        reviewClick="projected_after_pt"
      />
      {/*
        Forecast Total = proyectado + cerrado. Es el número que alimenta el GAP,
        así que va destacado. Los préstamos en CTC/Closing se marcan con el mismo
        punto verde que usa Forecast en su pivot: están a un paso de cerrar.
      */}
      <ForensicItem
        label="Forecast Total"
        value={fmtLoans(lo.projection.projectedTotal)}
        title={exactTitle(lo.projection.projectedTotal)}
        strong
        onClick={() => onOpen('forecast')}
        reviewClick="forecast_total"
        badge={
          ctcAndClosing > 0 ? (
            <span className="bp-ctc-mark" title={`${lo.projection.inCtc} in CTC · ${lo.projection.inClosing} in Closing`}>
              <i className="ctc-dot" />
              {ctcAndClosing} CTC
            </span>
          ) : null
        }
      />
    </div>
  );
}

function ForensicItem({
  label,
  value,
  suffix,
  strong,
  title,
  onClick,
  badge,
  reviewClick,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  strong?: boolean;
  title?: string;
  onClick?: () => void;
  badge?: ReactNode;
  /**
   * El identificador con el que el MODO REVISIÓN cuenta este número como
   * abierto. Ver la nota de `ForensicCards`.
   */
  reviewClick?: string;
}) {
  return (
    <button
      type="button"
      className={'bp-forensic__item' + (strong ? ' is-strong' : '')}
      title={title}
      onClick={onClick}
      /*
       * ⚠ EL ATRIBUTO VA EN EL <button>, que es el elemento que se clickea.
       *
       * El listener de la revisión hace `closest('[data-review-click]')` desde
       * el objetivo del clic, así que la marca tiene que estar en el botón o en
       * un ancestro suyo. Ponerla en el `<div>` del valor habría funcionado para
       * el clic sobre el número y no para el clic sobre el rótulo.
       */
      data-review-click={reviewClick}
    >
      <div className="bp-forensic__value">
        {value}
        {suffix && <span className="bp-forensic__suffix"> {suffix}</span>}
      </div>
      <div className="bp-forensic__label">{label}</div>
      {badge}
    </button>
  );
}

/**
 * DESGLOSE POR CANAL. La proyección combina dos modelos distintos -- Banked por
 * cascada de milestone sobre los healthy, Brokered por tasa plana sobre el
 * total -- y sin abrirlo el número de arriba es imposible de explicar. Sólo se
 * muestran los canales con préstamos.
 */
export function ChannelBreakdown({ lo }: { lo: LoanOfficerRow }) {
  const { banked, brokered } = lo.projection;
  return (
    <div className="bp-channels">
      {banked.loans > 0 && (
        <div className="bp-channel">
          <span className="bp-channel__name">Banked</span>
          <span className="bp-channel__detail">
            {banked.loans} healthy loans → <strong>{fmtAvg(banked.projected)}</strong>{' '}
            <span className="bp-channel__how">milestone cascade</span>
          </span>
        </div>
      )}
      {brokered.loans > 0 && (
        <div className="bp-channel">
          <span className="bp-channel__name">Brokered</span>
          <span className="bp-channel__detail">
            {brokered.loans} loans → <strong>{fmtAvg(brokered.projected)}</strong>{' '}
            <span className="bp-channel__how">flat rate, on the whole pipeline</span>
          </span>
        </div>
      )}
      {banked.loans === 0 && brokered.loans === 0 && (
        <div className="bp-channel">
          <span className="bp-channel__detail bp-muted">No open loans due to close this month.</span>
        </div>
      )}
    </div>
  );
}

/**
 * El panel del GAP.
 *
 * JERARQUÍA — etapa BP10, y el orden es deliberado. Hasta BP9 el número grande
 * era el promedio con mes actual. Estaba mal: el promedio es el INSUMO y el GAP
 * es la CONCLUSIÓN, lo que decide el veredicto. Ahora todas las filas son
 * normales y sólo el GAP sale del renglón.
 *
 * `benchmarkSlot` es lo único que las dos vistas ponen distinto: el perfil pone
 * el editor, el grupo pone la suma con su desglose. Todo lo demás es idéntico.
 */
export function Q1Panel({ lo, benchmarkSlot }: { lo: LoanOfficerRow; benchmarkSlot: ReactNode }) {
  const { budget, budgetMet, benchmarkMet, gapAgainst, budgetSource } = lo.q1;

  /*
   * ============================================================================
   * LA NOTA DEL GAP — dice CONTRA QUÉ se cumplió o no, etapa BP51
   * ============================================================================
   * Reemplaza a los dos `.bp-stat__flag` que vivían pegados a la fila de
   * Starting benchmark y a la de Budget ("Forecast meets it" / "...is below
   * it"): la MISMA información, dicha una sola vez, debajo del número que
   * decide -- el GAP -- y no al lado de las dos filas que sólo lo alimentan.
   * `gapAgainst` ya dice contra cuál de las dos se mide; esta nota dice si se
   * cumplió, con la misma frase para las dos referencias.
   */
  const gapNote =
    gapAgainst === 'budget'
      ? budgetMet
        ? 'Forecast meets the budget for this month.'
        : 'Forecast is currently below the budget for this month.'
      : gapAgainst === 'benchmark'
        ? benchmarkMet
          ? 'Forecast meets the starting benchmark.'
          : 'Forecast is currently below the starting benchmark.'
        : null;

  return (
    <div className="mcard bp-stats">
      {/*
        ============================================================================
        CABECERA — UNA sola marca de "Provisional data", etapa BP51
        ============================================================================
        Antes "provisional" podía aparecer TRES veces en la misma tarjeta: el
        rótulo de Starting benchmark, el valor del benchmark (dentro de
        `BenchmarkEditor`) y el rótulo del GAP cuando el benchmark era su
        referencia activa. Las tres decían lo MISMO -- el benchmark de esta
        persona es un seed circular (`set_by = 'provisional-seed'`), no un
        número que alguien fijó -- así que se consolidan acá, una vez, para
        toda la tarjeta. La condición sigue siendo la de `ProvisionalTag`; acá
        sólo cambia el texto (`label`), para que la cabecera diga "Provisional
        data" y no "provisional" a secas.
      */}
      <div className="bp-stats__head">
        <span className="bp-stats__title">Performance summary</span>
        <ProvisionalTag setBy={lo.benchmarkSetBy} note={lo.benchmarkNote} label="Provisional data" />
      </div>

      {/*
        ============================================================================
        CUATRO BLOQUES, POR LA MATEMÁTICA DEL NEGOCIO — etapa BP52
        ============================================================================
        Antes las siete filas eran una lista plana, sin nada que dijera que
        Starting benchmark y Budget son justamente los dos insumos del GAP, ni
        que los dos promedios de arriba son otra cosa (contexto histórico, no
        una decisión). Ahora son cuatro bloques en el orden en que se razona:
        primero lo que YA PASÓ (los promedios), después lo que se le pide a
        esta persona (benchmark y budget), la conclusión que sale de comparar
        los dos (el GAP), y por separado el acumulado del año.
      */}
      <div className="bp-stats__group bp-stats__group--divided">
        <span className="bp-stats__group-title">Historical averages</span>
        {/*
          Los DOS promedios, y no para suavizar el veredicto: son diagnósticos
          distintos y cambian el tipo de ayuda.
            histórico bajo + proyección baja  = problema sostenido
            histórico bueno + proyección baja = se le secó el pipeline
            histórico bajo + proyección buena = ya está reaccionando
          El GAP sale SIEMPRE del que incluye el mes actual.
        */}
        <div className="bp-stat">
          <span className="bp-stat__label">Avg 3M (with current month)</span>
          <span className="bp-stat__value" title={exactTitle(lo.q1.avgWithCurrent)}>
            {fmtAvg(lo.q1.avgWithCurrent)}
          </span>
        </div>
        <div className="bp-stat bp-stat--muted">
          <span className="bp-stat__label">Avg 3M (closed months)</span>
          <span className="bp-stat__value" title={exactTitle(lo.avgClosedMonths)}>
            {fmtAvg(lo.avgClosedMonths)}
          </span>
        </div>
      </div>

      {/*
        ============================================================================
        GOALS & BUDGET — los DOS insumos del GAP, etapa BP52
        ============================================================================
        Starting benchmark y Budget van juntos, en una caja de fondo muy
        tenue, justo arriba de la caja del GAP -- ver `.bp-stats__group--boxed`
        en bp-visual.css para por qué esto no es volver a las cajas rosadas
        que BP51 sacó.
      */}
      <div className="bp-stats__group bp-stats__group--boxed">
        <span className="bp-stats__group-title">Goals &amp; budget</span>
        {/*
          STARTING BENCHMARK — etapa BP49, simplificado en BP51.
          Mismo campo de siempre (`org.employee_benchmark`, vigente) -- no hay
          uno nuevo, sólo se lo llama por lo que es en esta pantalla: el PISO
          contra el que cae el gap cuando el budget no se cumple o no está
          fijado. Ver `gapAgainstOf` en qualifiers.ts.

          Ya NO lleva sombreado ni badge propios -- BP51 sacó las dos cosas de
          acá: si se cumple o no ahora lo dice `gapNote`, debajo del GAP, que
          es donde se decide. Esta fila sólo muestra el número y su editor.

          `data-rv-anchor="benchmark"` es un ANCLA ESTABLE para la flecha del
          paso 1.2 -- ver `stepArrows` en `lib/review/gates.ts`. Se queda
          igual que antes de BP49: el ancla es la fila, no el texto de su
          rótulo.
        */}
        <div className="bp-stat" data-rv-anchor="benchmark">
          <span className="bp-stat__label">Starting benchmark</span>
          {benchmarkSlot}
        </div>

        {/*
          BUDGET (THIS MONTH) — etapa BP49, ampliado en BP49b, marca en BP53.
          De Outlook (`outlook.person_budget_total`, mes en curso, última
          revisión) -- y cuando nadie lo fijó a mano, la proyección de la
          regla de crecimiento de Own Production, LEÍDA y no escrita (ver la
          cascada en `loadData.ts`). `null` es un ESTADO -- ni total ni regla
          -- y no un cero.

          ⚠ `budgetSource` dice CUÁL DE LOS DOS ES, y `'rule'` lleva la MISMA
          marca que "Starting benchmark" -- `.bp-provisional`, ámbar tenue --
          para que las dos digan lo mismo con la misma forma: un número que
          nadie confirmó. La condición es otra (`budgetSource === 'rule'`,
          no `setBy === PROVISIONAL_SET_BY`), así que esto NO reusa el
          componente `ProvisionalTag` -- reusa la CLASE, que es lo que hace
          que se vean iguales.

          ⚠ Chica y pegada al número, no en la cabecera. La del benchmark se
          consolidó arriba porque se repetía tres veces en la misma tarjeta;
          ésta es una sola marca, en un solo lugar, y va donde el número que
          describe.
        */}
        <div className="bp-stat">
          <span className="bp-stat__label">Budget (this month)</span>
          {budget === null ? (
            <span className="bp-muted" title="Nobody set a budget for this month, and there's no growth rule for Own Production to read either.">
              Not set
            </span>
          ) : (
            <span className="bp-stat__value">
              {fmtDecimal(budget)}
              {budgetSource === 'rule' && (
                <span
                  className="bp-provisional"
                  title="Nobody fixed a total for this month -- this reads today's growth-rule projection for Own Production, the same one Outlook shows. It moves if the rule changes."
                >
                  Provisional data
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/*
        GAP: su propio contenedor, número grande y la píldora del estado al lado.
        El color viene del ESTADO y no fijo en rojo -- alguien On Target con GAP
        +0,6 dentro de un recuadro rojo leería lo contrario de su veredicto.

        Un decimal siempre: redondear a entero convertiría un −0,5 en 0, o sea On
        Target, y eso cambia veredictos, no la presentación.

        ⚠ ETAPA BP49: el rótulo dice CONTRA QUÉ se calculó -- "vs budget" o "vs
        starting benchmark" -- porque desde esta etapa el gap ya no mide
        siempre contra lo mismo, y un número sin esa aclaración se prestaría a
        leerse contra el de siempre.

        ⚠ ETAPA BP51: `gapNote`, debajo del número, es el único lugar de la
        tarjeta que dice si el forecast cumple o no -- antes esa frase vivía
        DOS veces, pegada a la fila que corresponde y con `white-space: nowrap`,
        que era lo que se salía de la tarjeta. Acá puede envolver en dos
        líneas sin romper nada, porque el GAP es el único bloque con fondo
        propio -- ver `.bp-gap-hero` -- y el ancho lo tiene disponible.
      */}
      <div className={'bp-gap-hero' + (lo.q1.state ? ' bp-gap-hero--' + lo.q1.state : '')}>
        <span className="bp-stat__label">
          GAP{gapAgainst && ' — vs ' + (gapAgainst === 'budget' ? 'budget' : 'starting benchmark')}
        </span>
        {lo.q1.gap === null ? (
          <span className="bp-muted">—</span>
        ) : (
          <>
            <div className="bp-gap-hero__row">
              <span className="bp-gap-hero__value" title={exactTitle(lo.q1.gap)}>
                {fmtGap(lo.q1.gap)}
              </span>
              {lo.q1.state && <span className="bp-gap-hero__state">{GAP_STATE_LABEL[lo.q1.state]}</span>}
            </div>
            {gapNote && <div className="bp-gap-hero__note">{gapNote}</div>}
          </>
        )}
      </div>

      {/*
        YTD CLOSINGS — cuarto y último bloque, etapa BP52. Separado con un
        borde superior (`.bp-stat--ytd`) y no con un `.bp-stats__group`
        propio: es una sola fila, y un encabezado de grupo para una fila sola
        agruparía algo que no tiene con qué agruparse.
      */}
      <div className="bp-stat bp-stat--ytd">
        <span className="bp-stat__label">YTD closings</span>
        <span className="bp-stat__value">{lo.ytdClosings}</span>
      </div>
    </div>
  );
}

/* ──────────────────────── Future performance ───────────────────────────── */

/**
 * Las tres tarjetas de actividad, cada una con sus dos bloques.
 *
 * ⚠ ARRIBA VA LO QUE DECIDE — etapa BP29. Progress to date compara el acumulado
 * contra lo esperado A HOY (requerido ÷ 30 × día del mes); Month to date compara
 * contra la meta del mes entero y quedó como visibilidad. El orden es el
 * argumento: al revés, lo primero que se leería sería el número que ya no manda.
 *
 * Compartir esto es el punto de todo BP31: era exactamente lo que el grupo tenía
 * desactualizado.
 */
export function FuturePerformanceCards({
  metrics,
  onOpenMetric,
}: {
  metrics: Qualifier2Metric[];
  onOpenMetric: (key: Qualifier2Metric['key']) => void;
}) {
  return (
    <div className="bp-q2-cards">
      {metrics.map((m) => {
        const short = Math.max(0, m.required - m.actual);
        const monthPct = m.required <= 0 ? 0 : Math.min(100, (m.actual / m.required) * 100);
        /*
         * La barra puede pasarse del 100% -- se recorta al dibujar, pero el
         * número dice el porcentaje real, que es el dato.
         */
        const pacePct = m.paceRatio === null ? 0 : Math.min(100, m.paceRatio * 100);
        const band = m.band ?? 'at_risk';
        return (
          <div key={m.key} className={'bp-q2-card is-' + band}>
            <button type="button" className="bp-q2-card__name" onClick={() => onOpenMetric(m.key)}>
              {m.label}
            </button>

            <div className="bp-q2-block">
              <div className="bp-q2-block__head">
                <span className="bp-q2-block__title">Progress to date</span>
                <span className={'bp-q2-block__band bp-q2-block__band--' + band}>
                  {band === 'on_track' ? 'On track' : band === 'watch' ? 'Watch' : 'At risk'}
                </span>
              </div>
              <div className="bp-q2-card__count">
                {m.actual} of {m.expectedToDate.toFixed(1)}
                <span className="bp-q2-card__req"> expected by day {m.dayOfMonth}</span>
              </div>
              <div className="bp-q2-bar">
                <div className={'bp-q2-bar__fill bp-q2-bar__fill--' + band} style={{ width: pacePct + '%' }} />
              </div>
              <div
                className="bp-q2-block__math"
                title={`${m.required} required ÷ 30 days = ${m.dailyPace.toFixed(2)}/day × day ${m.dayOfMonth}`}
              >
                {m.required} ÷ 30 = {m.dailyPace.toFixed(2)}/day ·{' '}
                {m.paceRatio === null ? '—' : Math.round(m.paceRatio * 100) + '% of pace'}
              </div>
            </div>

            {/*
              Month to date. Se queda porque sigue siendo la pregunta de fin de
              mes -- cuánto falta para la meta completa -- pero ya no decide
              nada, y por eso va en gris y sin banda.
            */}
            <div className="bp-q2-block bp-q2-block--muted">
              <div className="bp-q2-block__head">
                <span className="bp-q2-block__title">Month to date</span>
                <span className="bp-q2-block__note">{m.meets ? 'Met' : short + ' to go'}</span>
              </div>
              <div className="bp-q2-card__count">
                {m.actual} of {m.required}
                <span className="bp-q2-card__req"> for the full month</span>
              </div>
              <div className="bp-q2-bar bp-q2-bar--muted">
                <div className="bp-q2-bar__fill bp-q2-bar__fill--muted" style={{ width: monthPct + '%' }} />
              </div>
            </div>

            <div className="bp-q2-card__avg" title="Average of the three closed months">
              usually {fmtActivityAvg(m.trailingAvg)}/month
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** El modal que abre cada métrica de Future performance. */
export function modalKindOfMetric(key: Qualifier2Metric['key']): 'files' | 'credit' | 'apps' {
  return key === 'fileCreations' ? 'files' : key === 'creditReports' ? 'credit' : 'apps';
}
