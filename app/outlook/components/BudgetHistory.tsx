'use client';

import { useMemo } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import { esConfirmacion, esLiberacion, type FilaDeTotal } from '@/lib/outlook/gobierno';
import type { PersonBudgetTotalRow, PersonBudgetBreakdownRow } from '@/lib/outlook/loadData';

/**
 * ============================================================================
 * EL HISTORIAL DE UN PRESUPUESTO — etapa OL50, ARCHIVO NUEVO
 * ============================================================================
 *
 * Hasta OL49 el pie del editor decía tres frases sueltas --quién fijó el total,
 * quién el desglose, quién confirmó por última vez-- y competían con el dato
 * que la gente viene a leer. Acá pasan a un botón: el que quiera saber de dónde
 * salió el número lo abre, y el que no, no lo ve.
 *
 * ⚠ NO HACE FALTA GUARDAR NADA PARA TENER ESTO. `outlook.budget_total` y
 * `outlook.budget_breakdown` son APPEND-ONLY: cada guardado escribe una
 * revisión nueva con `set_by`, `created_at` y `note`, y ninguna borra a la
 * anterior. El historial ya existía en el dato desde el primer día; lo único
 * que faltaba era mostrarlo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS TRES CLASES DE FILA, QUE ES LO QUE ESTE PANEL EXISTE PARA DISTINGUIR
 * ---------------------------------------------------------------------------
 *
 * Una lista de revisiones que sólo diga «revisión 3, Isabella, 21:11» miente
 * por omisión: Galo Rizzo tiene seis revisiones y CUATRO son confirmaciones
 * seguidas que no cambiaron ningún número. Leídas como cuatro cambios, parecen
 * alguien dudando; leídas como lo que son, son alguien buscando un acto que la
 * pantalla todavía no ofrecía.
 *
 *   NÚMERO        `total` con valor. «El presupuesto de este mes es éste.»
 *   CONFIRMACIÓN  `confirmed_only`. «Lo miré y está bien como está» -- no toca
 *                 el gobierno, y por eso el lector la descarta al elegir la
 *                 revisión vigente.
 *   LIBERACIÓN    `released_to_rule`. «Este mes vuelve a la regla de
 *                 crecimiento» -- SÍ gobierna, y lo que decide es que no haya
 *                 número.
 *
 * El criterio NO se reescribe acá: sale de `lib/outlook/gobierno.ts`, que es la
 * misma función que usan los dos lectores y el guardado. Una cuarta copia del
 * criterio es exactamente lo que OL41 vino a desarmar.
 *
 * ⚠ Y UNA REVISIÓN PUEDE SER MIXTA. `savePersonBudgetTotal` escribe números y
 * liberaciones en la MISMA revisión a propósito --«estos meses los fijo así y
 * estos otros los suelto» es una sola decisión-- así que una entrada puede
 * decir las dos cosas. Clasificar la revisión entera por su primera fila daría
 * un rótulo falso la primera vez que alguien haga las dos cosas juntas.
 */

/** Una revisión, ya juntada por mes. */
interface Entrada {
  tabla: 'total' | 'breakdown';
  revision: number;
  cuando: string;
  quien: string;
  nota: string | null;
  /** Mes → lo que esa revisión dice de ese mes. */
  fijados: Record<string, number>;
  soltados: string[];
  esConfirmacion: boolean;
  /** Para el desglose: bucket → mes → valor. */
  porBucket: Record<string, Record<string, number>>;
}

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mesCorto = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1] + (ym.slice(0, 4) === String(new Date().getFullYear()) ? '' : ' ' + ym.slice(2, 4));

function cuandoLegible(iso: string): string {
  /* Sin `toLocaleString`: el servidor y el navegador pueden tener zonas
     distintas y la fecha bailaría entre el render y la hidratación. */
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * De qué clase es una revisión. UNA sola vez.
 *
 * ⚠ ESTABA ESCRITO TRES VECES --el `className`, el `data-` de la sonda y el
 * rótulo visible-- y eran la misma decisión: correctas al escribirlas, y la
 * primera que alguien editara dejaba a las otras dos diciendo otra cosa. Lo
 * encontró medirlo: el atributo decía `number` para una revisión del DESGLOSE,
 * que no es ninguna de las tres clases del total. La sonda leía el atributo, o
 * sea que el rótulo visible y lo que se verificaba podían separarse.
 */
function claseDe(e: Entrada): 'breakdown' | 'confirmation' | 'release' | 'number' {
  if (e.tabla === 'breakdown') return 'breakdown';
  if (e.esConfirmacion) return 'confirmation';
  if (e.soltados.length > 0 && Object.keys(e.fijados).length === 0) return 'release';
  return 'number';
}

const CLASE_LABEL: Record<ReturnType<typeof claseDe>, string> = {
  breakdown: 'Breakdown',
  confirmation: 'Reviewed as is',
  release: 'Released to the growth rule',
  number: 'Budget set',
};

const BUCKET_LABEL: Record<string, string> = {
  own_production: 'Own Production',
  b2b: 'B2B',
  nppm: 'NPPM',
  business_plan: 'Business Plan',
};

export default function BudgetHistory({
  title,
  totals,
  breakdowns,
  onClose,
}: {
  /** El nombre de quien se está mirando, para el encabezado. */
  title: string;
  /** TODAS las filas de esta persona, sin filtrar por revisión vigente. */
  totals: PersonBudgetTotalRow[];
  breakdowns: PersonBudgetBreakdownRow[];
  onClose: () => void;
}) {
  const entradas = useMemo<Entrada[]>(() => {
    const porRevision = new Map<string, Entrada>();
    for (const r of totals) {
      const k = 'total|' + r.revision;
      let e = porRevision.get(k);
      if (e === undefined) {
        e = {
          tabla: 'total',
          revision: r.revision,
          cuando: r.created_at,
          quien: r.set_by,
          nota: r.note,
          fijados: {},
          soltados: [],
          /* La clase sale de `gobierno.ts`, no de una comparación suelta. */
          esConfirmacion: esConfirmacion(r as FilaDeTotal),
          porBucket: {},
        };
        porRevision.set(k, e);
      }
      const m = r.target_month.slice(0, 7);
      if (esLiberacion(r as FilaDeTotal)) e.soltados.push(m);
      else if (r.total !== null && !esConfirmacion(r as FilaDeTotal)) e.fijados[m] = Number(r.total);
      /* Una revisión mixta deja de ser «una confirmación» en cuanto trae una
         fila que sí decide: la clase es de la revisión, no de su primera fila. */
      if (!esConfirmacion(r as FilaDeTotal)) e.esConfirmacion = false;
      if (r.created_at < e.cuando) e.cuando = r.created_at;
    }
    for (const r of breakdowns) {
      const k = 'breakdown|' + r.revision;
      let e = porRevision.get(k);
      if (e === undefined) {
        e = {
          tabla: 'breakdown',
          revision: r.revision,
          cuando: r.created_at,
          quien: r.set_by,
          nota: r.note,
          fijados: {},
          soltados: [],
          esConfirmacion: false,
          porBucket: {},
        };
        porRevision.set(k, e);
      }
      const m = r.target_month.slice(0, 7);
      (e.porBucket[r.bucket] ??= {})[m] = Number(r.value);
      if (r.created_at < e.cuando) e.cuando = r.created_at;
    }
    /* Del más viejo al más nuevo: un historial se lee como pasó. */
    return [...porRevision.values()].sort((a, b) => a.cuando.localeCompare(b.cuando));
  }, [totals, breakdowns]);

  /*
   * ⚠ QUÉ CAMBIÓ RESPECTO DE LA ANTERIOR, y «la anterior» es la anterior DE SU
   * TABLA: comparar una revisión del desglose contra una del total daría una
   * diferencia entre dos cosas que no son comparables.
   *
   * Y las confirmaciones no entran en la comparación: no cambian ningún
   * número, así que si contaran como «la anterior», la revisión siguiente
   * mostraría su diferencia contra una foto vacía y todo parecería nuevo.
   */
  const anteriorDe = (i: number): Entrada | null => {
    for (let j = i - 1; j >= 0; j--) {
      const c = entradas[j];
      if (c.tabla === entradas[i].tabla && !c.esConfirmacion) return c;
    }
    return null;
  };

  return (
    <Modal
      title={`Change history — ${title}`}
      onClose={onClose}
      footer={
        <div className="ol-hist__foot">
          <span className="bp-muted">
            {entradas.length} revision{entradas.length === 1 ? '' : 's'}. Nothing here is ever overwritten: every save
            appends a new revision, so this is the whole record.
          </span>
          <button type="button" className="bp-btn" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {entradas.length === 0 && (
        <p className="ol-editor__hint">Nobody has set a budget for this person yet, so there is nothing to show.</p>
      )}
      <ol className="ol-hist" data-ol-history="">
        {entradas.map((e, i) => {
          const prev = anteriorDe(i);
          const meses = [...new Set([...Object.keys(e.fijados), ...e.soltados])].sort();
          const clase = claseDe(e);
          return (
            <li
              key={e.tabla + e.revision}
              className={'ol-hist__item ol-hist__item--' + clase}
              data-ol-history-kind={clase}
            >
              <div className="ol-hist__head">
                <span className="ol-hist__what">{CLASE_LABEL[clase]}</span>
                <span className="bp-muted ol-hist__meta">
                  revision {e.revision} · <b>{e.quien}</b> · {cuandoLegible(e.cuando)}
                </span>
              </div>

              {/*
                ⚠ UNA CONFIRMACIÓN NO LLEVA NÚMEROS, y decirlo es el punto: sin
                esta línea, cuatro confirmaciones seguidas se leen como cuatro
                cambios. Galo Rizzo tiene exactamente ese caso.
              */}
              {e.esConfirmacion && (
                <p className="ol-hist__nada">Nothing was changed — this only records that someone looked at it.</p>
              )}

              {!e.esConfirmacion && e.tabla === 'total' && (
                <table className="ol-hist__tbl">
                  <tbody>
                    {meses.map((m) => {
                      const soltado = e.soltados.includes(m);
                      const ahora = soltado ? null : e.fijados[m];
                      const antesSoltado = prev?.soltados.includes(m) ?? false;
                      const antes = prev === null ? undefined : antesSoltado ? null : prev.fijados[m];
                      const igual = antes === ahora;
                      return (
                        <tr key={m}>
                          <td className="ol-hist__mes">{mesCorto(m)}</td>
                          <td className="ol-hist__val">
                            {soltado ? <span className="ol-hist__regla">by growth rule</span> : ahora}
                          </td>
                          <td className="ol-hist__delta bp-muted">
                            {prev === null
                              ? 'first time'
                              : igual
                                ? 'unchanged'
                                : antes === undefined
                                  ? 'new'
                                  : antes === null
                                    ? 'was on the growth rule'
                                    : 'was ' + antes}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {e.tabla === 'breakdown' && (
                <table className="ol-hist__tbl">
                  <tbody>
                    {Object.keys(e.porBucket).map((b) =>
                      Object.keys(e.porBucket[b])
                        .sort()
                        .map((m) => {
                          const ahora = e.porBucket[b][m];
                          const antes = prev?.porBucket[b]?.[m];
                          return (
                            <tr key={b + m}>
                              <td className="ol-hist__mes">
                                {BUCKET_LABEL[b] ?? b} · {mesCorto(m)}
                              </td>
                              <td className="ol-hist__val">{ahora}</td>
                              <td className="ol-hist__delta bp-muted">
                                {prev === null
                                  ? 'first time'
                                  : antes === undefined
                                    ? 'new'
                                    : antes === ahora
                                      ? 'unchanged'
                                      : 'was ' + antes}
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              )}

              {e.nota !== null && e.nota.trim() !== '' && <p className="ol-hist__nota">“{e.nota}”</p>}
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
