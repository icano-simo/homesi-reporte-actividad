'use client';

import { useEffect } from 'react';
import type { LoanRecord } from '@/lib/domain/types';
import type { DrillDownContext } from '@/lib/aggregation/loansForCell';
import type { StrategyFilter } from '@/lib/domain/strategy';
import { METRICS, MONTH_NAMES } from '@/config/metrics';
import { CloseIcon } from '@/components/ui/icons';

export interface LoanDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** null cuando no hay drill-down activo -- el componente igual retorna null en ese caso. */
  context: DrillDownContext | null;
  /** Ya filtrados por loansForCell() -- este componente no filtra ni calcula nada, solo muestra. */
  loans: LoanRecord[];
  /**
   * Etapa V3: la estrategia activa en pantalla. NO filtra nada acá --`loans` ya
   * viene filtrado-- sólo decide QUÉ COLUMNAS tienen sentido mostrar. Ver el
   * comentario del `<colgroup>`.
   */
  strategyFilter: StrategyFilter;
}

/**
 * Drill-down de Activity (Fase 1) -- modal CENTRADO, mismo patrón visual que
 * `app/pipeline/LoanDetailModal.tsx` (clases `.modal-*` globales de
 * `app/styles/components.css`), pero NO es el mismo componente ni comparte
 * dominio: los campos de un LoanRecord de Activity no tienen nada que ver con
 * los de un loan de Forecast/Pipeline (sin borrowerName, sin milestone/health
 * de Forecast). Ver auditoría previa a esta etapa -- decisión explícita de no
 * reutilizar el modal de Forecast.
 *
 * Fase 1: solo MES/AÑO en el header (sin día) y sin columna de fecha en la
 * tabla -- todos los loans de una celda comparten el mismo mes por
 * definición, así que no hace falta repetirlo por fila.
 */
function monthYearLabel(ym: string): string {
  const [year, month] = ym.split('-');
  return MONTH_NAMES[Number(month) - 1] + ' ' + year;
}

function metricLabel(metric: DrillDownContext['metric']): string {
  return METRICS.find((m) => m.key === metric)?.label ?? metric;
}

/** '' (channel vacío, Etapa 2 de Activity) se muestra como "Unclassified" -- mismo criterio de negocio que CHANNEL_OPTIONS en Toolbar.tsx, sin inventar uno nuevo. */
function channelLabel(loanInfoChannel: string): string {
  return loanInfoChannel || 'Unclassified';
}

/**
 * Ajuste de UX (post-Fase 1): antes esto se aplanaba a un solo string
 * ("Branch 733" / "Loan Officer: NAME" / "BD: NAME" / "All branches") dentro
 * de `.modal-eyebrow`. Ahora se separa en {label, value} para poder renderizar
 * un campo propio del context header (ver JSX) -- mismo dato, misma
 * prioridad drillName > branch que ya tenía, sin lógica nueva: solo cambia
 * CÓMO se presenta, no QUÉ loans se muestran (eso sigue siendo
 * responsabilidad exclusiva de loansForCell(), sin tocar acá).
 */
function contextField(context: DrillDownContext): { label: string; value: string } {
  if (context.drillName) {
    return { label: context.drillBy === 'bd' ? 'BD' : 'Loan Officer', value: context.drillName };
  }
  // Sin drillName: Branch cuando hay uno filtrado, o 'All branches' para la
  // fila Total (ningún branch específico) -- Branch sigue siendo la etiqueta
  // en los dos casos, tal como se pidió.
  return { label: 'Branch', value: context.branch ?? 'All branches' };
}

export default function LoanDetailModal({ isOpen, onClose, context, loans, strategyFilter }: LoanDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Bloquea el scroll del documento mientras el modal está abierto -- mismo
  // patrón que el modal de Forecast, necesario porque acá también scrollea
  // el <body> y no un contenedor interno.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  /*
   * ⚠ Etapa V3 -- QUÉ COLUMNAS SE MUESTRAN, Y POR QUÉ NO SIEMPRE LAS OCHO.
   *
   * Con las 8 fijas la tabla queda ilegible: el modal mide 768px y Channel se
   * corta en "Banked - ...", Owner en "Javier Peñ..." y Referred By en
   * "WALTER ...". Verificado en pantalla antes de decidir esto.
   *
   * Las dos primeras condiciones son complementarias a propósito -- nunca están
   * las dos a la vez, así que se alternan en vez de sumarse:
   *
   *   * `showStrategy` -- sólo con el filtro en "All". Ahí la columna informa
   *     (cinco valores distintos). Con una estrategia elegida diría el mismo
   *     valor en todas las filas: ocupa ancho para repetir lo que ya dice el
   *     rótulo del filtro y de la fila Total.
   *   * `showContext` -- exactamente al revés. Owner y Referred By son el
   *     detalle que se mira cuando ya se está dentro de una estrategia; en la
   *     vista general son dos columnas de contexto que nadie pidió y que
   *     aprietan las seis de siempre.
   *
   * Resultado: 6 columnas con el filtro en "All" (las mismas de siempre, con
   * Strategy en el lugar de B2B), 7 con una estrategia elegida, y 8 sólo en
   * NPPM -- ver `showRecruiter`, abajo.
   */
  const showStrategy = strategyFilter === 'all';
  const showContext = !showStrategy;
  /*
   * Etapa V3b: el BD que reclutó al NPPM, SÓLO en la vista NPPM.
   *
   * Fuera de NPPM la columna no significa nada -- en las otras estrategias el
   * campo viene vacío o nombra a alguien que no tiene rol en ese negocio-- así
   * que aparecer siempre le costaría ancho a las siete que sí aplican.
   *
   * ⚠ Dentro de NPPM se solapa con Owner: de los 92 préstamos, en 68 dice lo
   * mismo, en 16 está vacío y sólo en 8 aporta un nombre distinto. Se muestran
   * las dos igual y a propósito: esos 8 --un BD reclutó al NPPM pero la
   * oportunidad quedó en otras manos-- son la pregunta que la columna viene a
   * responder, y no se pueden ver sin tener las dos al lado.
   */
  const showRecruiter = strategyFilter === 'NPPM';
  /*
   * Etapa "Stage SF": columna nueva, independiente de las de arriba -- no
   * depende de `strategyFilter` sino de la MÉTRICA del drill-down. Solo tiene
   * sentido para App Date: es el estado de venta en Salesforce mientras el
   * préstamo todavía no cerró ni se volvió adverse, y en las otras métricas
   * (fc/cr/cl) no aporta nada que esas vistas ya no digan de otra forma.
   *
   * Al ser independiente, se SUMA a cualquiera de los 3 casos de arriba en vez
   * de reemplazar uno: 6→7 en "All", 7→8 con una estrategia elegida, 8→9 en
   * NPPM. El caso de 8 (estrategia elegida + App Date) es nuevo y pasa a
   * necesitar el modal ancho igual que NPPM -- ver `isWide` más abajo.
   */
  const showStageSf = context?.metric === 'ap';
  /**
   * Ensancha el modal en los dos casos que llegan a 8+ columnas: NPPM (ya
   * ensanchaba antes de esta etapa) y ahora también estrategia elegida +
   * App Date. El caso "All" + App Date se queda en 7, mismo régimen que
   * "estrategia elegida" sin Stage SF -- entra cómodo en 768px.
   */
  const isWide = showRecruiter || (showStageSf && showContext);

  if (!isOpen || !context) return null;

  const countLabel = loans.length.toLocaleString('en-US') + (loans.length === 1 ? ' loan' : ' loans');
  const field = contextField(context);
  const metric = metricLabel(context.metric);
  const month = monthYearLabel(context.month);
  // Texto plano para aria-label -- el context header de abajo es solo la
  // presentación visual, esto es lo que anuncia un lector de pantalla al
  // abrir el modal (mismo contenido que antes, ahora armado desde los mismos
  // 3 campos que ya se muestran).
  const ariaLabel = field.label + ' ' + field.value + ' — ' + metric + ' — ' + month;

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* stopPropagation: un click DENTRO de la caja no debe cerrar el modal. */}
      <div
        /*
         * ⚠ Etapa V3b: el ancho sigue a la cantidad de columnas.
         *
         * Con 8 --sólo en NPPM-- los 768px de `.modal-box` no alcanzan: se
         * truncaba hasta el Loan #, que es el identificador de la fila.
         * `.modal-box--wide` no es una clase nueva: la creó el modal de
         * Forecast para este mismo problema con sus 8 columnas (ver
         * components.css). Se reusa en vez de inventar otra, y en vez de
         * sacrificar una columna: acá las tres de contexto dicen cosas
         * distintas --quién es dueño de la oportunidad, qué realtor refirió y
         * qué BD reclutó a ese realtor-- así que ninguna sobra.
         *
         * Los casos de 6 y 7 columnas se quedan en 768px, donde entran
         * cómodos. Ensanchar siempre sería pagar el ancho de la vista más
         * cargada en todas las demás.
         *
         * Etapa "Stage SF": el mismo problema aparece ahora también con
         * estrategia elegida + App Date (7→8) -- `isWide` cubre ese caso
         * además de NPPM.
         */
        className={'modal-box' + (isWide ? ' modal-box--wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          {/*
           * Ajuste de UX (post-Fase 1): "context header" estructurado en vez
           * de un solo string plano (eyebrow) + título -- el objetivo es que
           * se distinga de un vistazo QUÉ dimensión es cada dato (Branch vs.
           * Loan Officer, Metric, Month), no solo leerlo en una frase. Cada
           * campo reutiliza `.modal-eyebrow` tal cual (label pequeño/
           * secundario, ya global y compartido con el modal de Forecast, sin
           * tocarlo) + una clase nueva `.modal-context__value` para el valor
           * principal. Fila horizontal con wrap -- responsive, sin agregar
           * altura: sigue siendo 2 líneas de texto (labels arriba, valores
           * abajo), igual que antes con eyebrow+title.
           */}
          <div className="modal-context" style={{ minWidth: 0, flex: 1 }}>
            <div className="modal-context__field">
              <div className="modal-eyebrow">{field.label}</div>
              <div className="modal-context__value">{field.value}</div>
            </div>
            <div className="modal-context__field">
              <div className="modal-eyebrow">Metric</div>
              <div className="modal-context__value">{metric}</div>
            </div>
            <div className="modal-context__field">
              <div className="modal-eyebrow">Month</div>
              <div className="modal-context__value">{month}</div>
            </div>
            <div className="modal-context__field">
              <div className="modal-eyebrow">Loans</div>
              <div className="modal-context__value">{countLabel}</div>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/*
            `.modal-table-scroll` acompaña a `--wide`, igual que en Forecast: si
            el viewport es tan angosto que ni 92vw alcanza, scrollea la tabla en
            vez de comprimir las columnas hasta que dejen de leerse.
          */}
          <div className={isWide ? 'modal-table-scroll' : undefined}>
          <table className="piv">
            {/*
             * ⚠ Etapa V3: de 6 a 8 columnas.
             *
             * "B2B" (Yes/No) se reemplaza por "Strategy" con el valor real. No
             * se pierde información: B2B pasa a ser uno de los cinco valores
             * posibles en vez de un booleano que escondía a los otros cuatro.
             * Own Production domina la columna (3.449 de 4.794, ~72%) y eso es
             * correcto, no un error de datos.
             *
             * Se agregan Owner y Referred By. NO se agrega "NPPM Realtor",
             * aunque estaba pedida: `nppm_realtor` es NULL en las 4.794 filas,
             * incluidos los 92 préstamos NPPM, así que sería una columna
             * permanentemente vacía. El campo se lee igual (ver
             * LoanRecord.nppmRealtor) y el día que el sync la llene, agregarla
             * es una columna más acá.
             *
             * Anchos explícitos: las 8 columnas entran sin scroll horizontal.
             * Ajuste post-validación visual: se quitó Affinity -- no es un
             * atributo individual del loan en este drill-down (Affinity es un
             * modelo de negocio que Activity ya representa vía branch
             * 'AFFINITY', ver classifyBranch; un loan con True OrgID de otro
             * branch, ej. 716 o 700, puede pertenecer igual a ese modelo, así
             * que el campo crudo LoanRecord.affinity quedaba fuera de lugar
             * acá). Branch se conserva -- ese sí es el branch clasificado del
             * loan, y ya puede mostrar 'AFFINITY' cuando corresponde.
             */}
            <colgroup>
              {/*
                Los anchos de la variante con contexto están medidos, no
                estimados: con Channel en 14% "Banked - Retail" se cortaba en
                "Banked - Ret...". Es un vocabulario de dos valores fijos, así
                que se le da lo que necesita (17%) sacándoselo a Loan # -- doce
                dígitos entran de sobra en 15%.

                ⚠ Estos porcentajes NO se aplican en ningún caso `isWide`
                (NPPM, o estrategia elegida + App Date): ahí el modal lleva
                `.modal-table-scroll`, y esa regla pone la tabla en
                `table-layout: auto; width: auto` (components.css), así que las
                columnas se dimensionan al contenido. Es justamente lo que da
                cero truncamiento con 8-9 columnas, y también por qué la tabla no
                estira hasta el borde del modal ancho: toma lo que necesita y
                nada más, igual que el modal de Forecast. Los `<col>` se dejan
                porque siguen rigiendo en las variantes NO anchas (6, 7 sin
                Stage SF, 7 con Stage SF en "All").
              */}
              <col style={{ width: showStrategy ? (showStageSf ? '15%' : '20%') : showRecruiter ? '13%' : '15%' }} />
              <col style={{ width: showStrategy ? (showStageSf ? '17%' : '20%') : showRecruiter ? '15%' : '17%' }} />
              <col style={{ width: showStrategy ? (showStageSf ? '8%' : '11%') : showRecruiter ? '7%' : '8%' }} />
              <col style={{ width: showStrategy ? (showStageSf ? '15%' : '17%') : showRecruiter ? '15%' : '17%' }} />
              {showStrategy && <col style={{ width: showStageSf ? '12%' : '13%' }} />}
              <col style={{ width: showStrategy ? (showStageSf ? '18%' : '19%') : showRecruiter ? '11%' : '13%' }} />
              {showStageSf && <col style={{ width: showStrategy ? '15%' : '13%' }} />}
              {showContext && <col style={{ width: showRecruiter ? '13%' : '15%' }} />}
              {showContext && <col style={{ width: showRecruiter ? '13%' : '15%' }} />}
              {showRecruiter && <col style={{ width: '13%' }} />}
            </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">Loan #</th>
                <th style={{ textAlign: 'left' }}>Loan Officer</th>
                <th style={{ textAlign: 'left' }}>Branch</th>
                <th style={{ textAlign: 'left' }}>Channel</th>
                {showStrategy && <th style={{ textAlign: 'left' }}>Strategy</th>}
                <th style={{ textAlign: 'left' }}>Program</th>
                {showStageSf && <th style={{ textAlign: 'left' }}>Stage SF</th>}
                {showContext && <th style={{ textAlign: 'left' }}>Owner</th>}
                {showContext && <th style={{ textAlign: 'left' }}>Referred By</th>}
                {showRecruiter && <th style={{ textAlign: 'left' }}>Recruited By</th>}
              </tr>
            </thead>
            <tbody>
              {loans.map((loan, i) => (
                <tr className="metric" key={loan.loanNumber || i}>
                  <td className="lbl" title={loan.loanNumber}>
                    {loan.loanNumber || '—'}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.loanOfficer}>
                    {loan.loanOfficer}
                  </td>
                  <td style={{ textAlign: 'left' }}>{loan.branch}</td>
                  <td style={{ textAlign: 'left' }} title={channelLabel(loan.loanInfoChannel)}>
                    {channelLabel(loan.loanInfoChannel)}
                  </td>
                  {showStrategy && (
                    <td style={{ textAlign: 'left' }} title={loan.strategy}>
                      {loan.strategy || '—'}
                    </td>
                  )}
                  <td style={{ textAlign: 'left' }} title={loan.loanProgram}>
                    {loan.loanProgram || '—'}
                  </td>
                  {showStageSf && (
                    <td style={{ textAlign: 'left' }} title={loan.sfStage}>
                      {loan.sfStage || '—'}
                    </td>
                  )}
                  {showContext && (
                    <td style={{ textAlign: 'left' }} title={loan.opportunityOwner}>
                      {loan.opportunityOwner || '—'}
                    </td>
                  )}
                  {showContext && (
                    <td style={{ textAlign: 'left' }} title={loan.referredByRealtor}>
                      {loan.referredByRealtor || '—'}
                    </td>
                  )}
                  {showRecruiter && (
                    <td style={{ textAlign: 'left' }} title={loan.nppmRecruitedBy}>
                      {loan.nppmRecruitedBy || '—'}
                    </td>
                  )}
                </tr>
              ))}
              {!loans.length && (
                <tr>
                  <td
                    className="lbl"
                    style={{ color: 'var(--slate-500)', fontWeight: 500 }}
                    colSpan={(showStrategy ? 6 : showRecruiter ? 8 : 7) + (showStageSf ? 1 : 0)}
                  >
                    No loans.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
