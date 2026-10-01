'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import { fmt } from '@/lib/outlook/format';
import {
  correoDeLaSesion,
  grillaVigente,
  guardarVersion,
  historial,
  loadMargins,
  NIVELES,
  type CambioPedido,
  type Grilla,
  type MarginsData,
  type Nivel,
} from '@/lib/admin/margins';

/**
 * ============================================================================
 * MARGINS — los márgenes por branch y tipo de préstamo (etapa ADM3)
 * ============================================================================
 *
 * El lenguaje visual es el de Analytics: `page-head` con su filtro al lado,
 * `table.piv` para la tabla, `.tbl-card` para la tarjeta, `.empty` para el
 * estado sin datos y `.pill.warn` para lo que hay que decir. Ninguna de esas
 * clases se redefine acá -- viven en `app/styles/components.css`, que es global.
 * Lo propio del módulo lleva el prefijo `mg-`, que antes de usarlo no existía en
 * ninguna hoja (`git grep mg-`, cero resultados).
 *
 * ---------------------------------------------------------------------------
 * ⚠ LA CELDA VACÍA Y EL CERO NO SE ESCRIBEN IGUAL, Y ES EL PUNTO
 * ---------------------------------------------------------------------------
 * Los 14 ceros de la tabla están TODOS en la columna `Region`, que es justo la
 * que está vacía para 16 de los 21 branches. Así que en esa columna conviven:
 *
 *   `0`      se decidió que ese nivel no suma nada
 *   vacío    este branch no tiene ese nivel -- la fila no existe
 *
 * Se resuelve con `fmt()` de Outlook, que es la misma convención de todo el
 * portal: la ausencia no se escribe y el cero se escribe `0`. Lo que distingue
 * los dos estados es la presencia del dígito, no un rótulo que haya que
 * aprender.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS TRES FORMAS DE EDITAR ESCRIBEN LA MISMA VERSIÓN COMPLETA
 * ---------------------------------------------------------------------------
 * Una celda, una fila o el branch entero cambian cuántos valores trae la
 * persona, no cuántas filas se escriben. La diferencia entre las tres vive sólo
 * en esta pantalla; `guardarVersion` recibe una lista de cambios y siempre
 * reescribe la grilla vigente completa.
 */

/** Lo que está abierto para editar. `null` = nada. */
type Edicion =
  | { clase: 'celda'; branch: string; loanType: string; nivel: Nivel }
  | { clase: 'fila'; branch: string; loanType: string }
  | { clase: 'branch'; branch: string }
  | null;

const TODOS = '__all__';

/** El mes y el año de una fecha ISO, para el sello de la versión. */
function mesYAnio(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** La fecha larga del historial. */
function fechaLarga(iso: string | null): string {
  if (!iso) return 'no date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no date';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function MarginsPage() {
  const [data, setData] = useState<MarginsData | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>(TODOS);
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [correo, setCorreo] = useState<string | null>(null);

  const recargar = useCallback(
    () =>
      loadMargins()
        .then(setData)
        .catch((e: unknown) => setFallo(e instanceof Error ? e.message : String(e))),
    []
  );

  useEffect(() => {
    let cancelado = false;
    loadMargins()
      .then((d) => {
        if (!cancelado) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelado) setFallo(e instanceof Error ? e.message : String(e));
      });
    correoDeLaSesion().then((c) => {
      if (!cancelado) setCorreo(c);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  /*
   * ⚠ LA GRILLA DE CADA BRANCH SE CALCULA UNA VEZ, y de acá salen la tabla, el
   * historial y el valor actual que muestran las tres ventanas. Una segunda
   * lectura de «lo vigente» sería una segunda definición, y divergen con el
   * primer cambio.
   */
  const grillas = useMemo(() => {
    const m = new Map<string, Grilla>();
    if (!data) return m;
    for (const [codigo, filas] of data.porBranch) m.set(codigo, grillaVigente(filas));
    return m;
  }, [data]);

  const visibles = useMemo(
    () => (branch === TODOS ? (data?.branches ?? []) : data?.branches.filter((b) => b === branch) ?? []),
    [branch, data]
  );

  if (fallo) {
    return (
      <div className="hub-container mg-page">
        <div className="bp-notice bp-notice--warn">Could not load margins: {fallo}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hub-container mg-page">
        <div className="empty">
          <h2>Loading…</h2>
          <p>Reading margins.branch_margin.</p>
        </div>
      </div>
    );
  }

  /*
   * ⚠ LOS TRES CASOS DE UNA PANTALLA VACÍA, SEPARADOS. Con RLS, una policy que
   * no aplica devuelve cero filas y `error: null`: indistinguible de una tabla
   * vacía. Y acá hay un caso esperando -- la policy de SELECT no nombraba
   * `admin` hasta el SQL de esta etapa.
   */
  const sinDatos = data.error === null && data.filas === 0;

  return (
    <div className="hub-container mg-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Margins</h1>
          <p className="page-head__subtitle">
            {data.branches.length} branches · basis points by loan type and level
          </p>
        </div>
        <label className="mg-filtro">
          <span className="mg-filtro__label">Branch</span>
          <select
            className="field mg-filtro__select"
            data-mg-branch=""
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value={TODOS}>All branches</option>
            {data.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.error && (
        <div className="bp-notice bp-notice--warn">
          Could not read <code>margins.branch_margin</code>: {data.error}
        </div>
      )}

      {sinDatos && (
        <div className="bp-notice bp-notice--warn" data-mg-vacio="">
          <b>No margins came back.</b> The read returned no error and zero rows, which is what you see when the table
          has a <code>GRANT</code> but no RLS policy applies to this session. That is not the same as an empty table.
        </div>
      )}

      {data.sinVersion > 0 && (
        <div className="bp-notice bp-notice--warn">
          {data.sinVersion} row(s) were left out because they have no <code>version_num</code> or an unknown level.
          Without a version number a row cannot be placed between versions, so it is reported instead of being read as
          v1.
        </div>
      )}

      {/*
        ⚠ EL AVISO DE BIGQUERY SÓLO APARECE SI HAY ALGO QUE AVISAR. Un aviso que
        sale cuando no falta nada enseña a ignorarlo, y éste es el único que hay
        de que un número de esta pantalla no está en el P&L.
      */}
      {data.deLaApp > 0 && (
        <div className="bp-notice bp-notice--warn" data-mg-aviso-bq="">
          <b>{data.deLaApp} margin line(s) were edited here, and BigQuery does not have them.</b> The P&amp;L still
          reads the margin file, so a value edited on this screen is not reflected there until the file is updated.
        </div>
      )}

      {visibles.map((codigo) => {
        const grilla = grillas.get(codigo);
        if (!grilla) return null;
        const versiones = historial(data.porBranch.get(codigo) ?? []);
        const vigente = versiones[0];
        return (
          <section className="tbl-card mg-card" key={codigo} data-mg-tabla={codigo}>
            <div className="tbl-card__head">
              {/*
                ⚠ EL NOMBRE DEL BRANCH ES EL BOTÓN DE «editar las 14 filas». Es
                el tercero de los tres accesos, y va acá porque es donde está el
                branch -- no en un botón aparte que habría que explicar.
              */}
              <button
                type="button"
                className="tbl-card__title mg-branch"
                data-mg-editar-branch={codigo}
                onClick={() => setEdicion({ clase: 'branch', branch: codigo })}
              >
                {codigo}
              </button>
              <span className="mg-sello" data-mg-sello={codigo}>
                {vigente ? vigente.version : '—'}
                {vigente && mesYAnio(vigente.changedAt) ? ' · ' + mesYAnio(vigente.changedAt) : ''}
              </span>
            </div>

            <table className="piv mg-tabla">
              <thead>
                <tr>
                  <th className="lbl">Loan type</th>
                  {NIVELES.map((n) => (
                    <th key={n} className={grilla.niveles.includes(n) ? '' : 'mg-col-ausente'}>
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grilla.tipos.map((tipo) => (
                  <tr key={tipo}>
                    <td className="lbl">
                      {/*
                        El tipo de préstamo abre los tres niveles de esa fila.
                      */}
                      <button
                        type="button"
                        className="mg-tipo"
                        data-mg-editar-fila={tipo}
                        onClick={() => setEdicion({ clase: 'fila', branch: codigo, loanType: tipo })}
                      >
                        {tipo}
                      </button>
                    </td>
                    {NIVELES.map((n) => {
                      const celda = grilla.celda(tipo, n);
                      /*
                       * ⚠ ACÁ SE DECIDE LA DISTINCIÓN DEL PUNTO 2 DEL BRIEF.
                       * `celda === null` es «este branch no tiene ese nivel» y
                       * NO se dibuja un botón: no hay nada que editar. Un cero
                       * sí es un valor y sí se puede editar.
                       */
                      if (celda === null) {
                        return (
                          <td key={n} className="val zero mg-ausente" data-mg-celda-ausente={tipo + '/' + n} />
                        );
                      }
                      return (
                        <td key={n} className={'val' + (celda.valor === 0 ? ' zero' : '')}>
                          <button
                            type="button"
                            className="mg-valor"
                            data-mg-celda={tipo + '/' + n}
                            onClick={() =>
                              setEdicion({ clase: 'celda', branch: codigo, loanType: tipo, nivel: n })
                            }
                          >
                            {fmt(celda.valor)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <Historial versiones={versiones} codigo={codigo} />
          </section>
        );
      })}

      {edicion && (
        <EditorDeMargenes
          edicion={edicion}
          grilla={grillas.get(edicion.branch)!}
          autor={correo}
          onClose={() => setEdicion(null)}
          onGuardado={async () => {
            setEdicion(null);
            await recargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * ============================================================================
 * EL HISTORIAL
 * ============================================================================
 *
 * ⚠ LO QUE CAMBIÓ, SEPARADO DE LO QUE SE COPIÓ IGUAL. Cada versión escribe la
 * grilla completa del branch, así que sin esa separación una edición de un
 * número se vería como 28 cambios. Lo que se copió igual se cuenta y no se
 * lista.
 *
 * ⚠ Y UNA PRIMERA VERSIÓN NO ES UN CAMBIO. El 711 no tiene v1: sus 28 líneas
 * son altas. Sin distinguirlas, ese branch mostraría 28 filas de «— → x» como
 * si alguien hubiera cambiado todo.
 */
function Historial({
  versiones,
  codigo,
}: {
  versiones: ReturnType<typeof historial>;
  codigo: string;
}) {
  if (versiones.length === 0) return null;
  return (
    <details className="mg-hist" data-mg-historial={codigo}>
      <summary className="mg-hist__sum">Change history · branch {codigo}</summary>
      {versiones.map((v) => (
        <div className="mg-hist__ver" key={v.versionNum} data-mg-version={v.version}>
          <div className="mg-hist__cab">
            <span className="mg-hist__v">{v.version}</span>
            <span className="mg-hist__fecha">{fechaLarga(v.changedAt)}</span>
            <span className="mg-hist__de">
              {v.origen === 'app'
                ? 'edited here' + (v.changedBy ? ' by ' + v.changedBy : '')
                : v.esPrimera
                  ? 'initial load'
                  : 'from the margin file'}
            </span>
          </div>
          {v.reason && <p className="mg-hist__motivo">{v.reason}</p>}

          {/*
            ⚠ LAS OMITIDAS VAN PRIMERO Y EN AMBAR. Es el único estado que deja la
            pantalla mostrando un número que esta versión no escribió: la vista
            sigue sirviendo el valor de una versión anterior para esa línea.
            Hoy no ocurre en ningún branch -- la rama se ejerce en
            `margins.test.mjs` con una versión incompleta construida a propósito.
          */}
          {v.omitidas.length > 0 && (
            <p className="bp-notice bp-notice--warn mg-hist__omitidas" data-mg-omitidas={v.version}>
              <b>This version left out {v.omitidas.length} line(s).</b> The current view still serves the previous
              value for{' '}
              {v.omitidas.map((l) => l.loanType + ' · ' + l.nivel).join(', ')}.
            </p>
          )}

          {v.esPrimera ? (
            <p className="mg-hist__linea mg-hist__linea--alta">
              {v.lineas.length} line(s) created — this is the first version of this branch.
            </p>
          ) : (
            <>
              {v.cambios.map((l) => (
                <p className="mg-hist__linea" key={l.loanType + l.nivel}>
                  <span className="mg-hist__que">
                    {l.loanType} · {l.nivel}
                  </span>
                  <span className="mg-hist__valores">
                    {fmt(l.antes)} → {fmt(l.despues)}
                  </span>
                </p>
              ))}
              {v.altas.map((l) => (
                <p className="mg-hist__linea mg-hist__linea--alta" key={l.loanType + l.nivel}>
                  <span className="mg-hist__que">
                    {l.loanType} · {l.nivel}
                  </span>
                  <span className="mg-hist__valores">new · {fmt(l.despues)}</span>
                </p>
              ))}
            </>
          )}

          {v.igualNum > 0 && (
            <p className="mg-hist__igual" data-mg-sin-cambio={v.version}>
              ⟳ {v.igualNum} line(s) rewritten with the same value
            </p>
          )}
        </div>
      ))}
    </details>
  );
}

/**
 * ============================================================================
 * LAS TRES VENTANAS DE EDICIÓN, QUE SON UNA
 * ============================================================================
 *
 * Lo único que cambia entre «una celda», «una fila» y «el branch entero» es qué
 * líneas se ofrecen. Lo que se guarda es siempre lo mismo: la versión nueva con
 * la grilla completa.
 *
 * ⚠ EL VALOR ACTUAL SALE DE LA GRILLA, no de una segunda consulta. Es la misma
 * fuente que dibuja la tabla, así que no pueden discrepar.
 */
function EditorDeMargenes({
  edicion,
  grilla,
  autor,
  onClose,
  onGuardado,
}: {
  edicion: NonNullable<Edicion>;
  grilla: Grilla;
  autor: string | null;
  onClose: () => void;
  onGuardado: () => void | Promise<void>;
}) {
  const lineas = useMemo(() => {
    if (edicion.clase === 'celda') {
      const c = grilla.celda(edicion.loanType, edicion.nivel);
      return c ? [c] : [];
    }
    if (edicion.clase === 'fila') {
      return grilla.lineas
        .filter((l) => l.loanType === edicion.loanType)
        .sort((a, b) => NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel));
    }
    return [...grilla.lineas].sort(
      (a, b) =>
        a.loanType.localeCompare(b.loanType) || NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel)
    );
  }, [edicion, grilla]);

  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(lineas.map((l) => [l.loanType + '/' + l.nivel, l.valor === null ? '' : String(l.valor)]))
  );
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const titulo =
    edicion.clase === 'celda'
      ? 'Edit margin · ' + edicion.branch + ' · ' + edicion.loanType + ' · ' + edicion.nivel
      : edicion.clase === 'fila'
        ? 'Edit ' + edicion.loanType + ' · branch ' + edicion.branch
        : 'Edit all margins · branch ' + edicion.branch;

  /*
   * Lo que de verdad cambió: se compara contra el valor vigente, así que
   * reescribir el mismo número no cuenta como cambio y el botón lo dice.
   *
   * ⚠ Y UN CAMPO VACÍO NO ES UN CERO. Vaciarlo no significa «cero bps»; es no
   * haber escrito nada, y esa línea se guarda con su valor de hoy.
   */
  const cambios: CambioPedido[] = lineas.flatMap((l) => {
    const crudo = (valores[l.loanType + '/' + l.nivel] ?? '').trim();
    if (crudo === '') return [];
    const n = Number(crudo);
    if (!Number.isFinite(n) || n === l.valor) return [];
    return [{ loanType: l.loanType, nivel: l.nivel, valor: n }];
  });

  /*
   * ⚠ ENTEROS, Y EL CAMPO LO DICE. Los 726 valores de la tabla van de 0 a 725
   * sin un solo decimal. Aceptar 449.5 sería dejar que el primero aparezca
   * dentro de seis meses sin que nadie lo haya decidido -- y el `with check` de
   * la policy lo rechazaría del otro lado, con un error que no nombra el campo.
   */
  const invalidos = lineas.filter((l) => {
    const crudo = (valores[l.loanType + '/' + l.nivel] ?? '').trim();
    if (crudo === '') return false;
    const n = Number(crudo);
    return !Number.isFinite(n) || n < 0 || !Number.isInteger(n);
  });

  const sinAutor = autor === null;
  const puedeGuardar =
    !ocupado && cambios.length > 0 && invalidos.length === 0 && motivo.trim() !== '' && !sinAutor;

  async function guardar() {
    setOcupado(true);
    setAviso(null);
    try {
      const r = await guardarVersion(edicion.branch, grilla, cambios, motivo.trim(), autor ?? '');
      if (r.error) {
        setAviso(r.error);
        return;
      }
      await onGuardado();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal
      title={titulo}
      onClose={onClose}
      footer={
        <div className="bp-form__actions">
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            data-mg-guardar=""
            disabled={!puedeGuardar}
            onClick={guardar}
          >
            {ocupado
              ? 'Saving…'
              : cambios.length === 0
                ? 'Save'
                : 'Save ' + cambios.length + ' change(s) as v' + (grilla.versionMaxima + 1)}
          </button>
          <button type="button" className="bp-linkish" disabled={ocupado} onClick={onClose}>
            cancel
          </button>
        </div>
      }
    >
      <div className="bp-form mg-form">
        {/*
          ⚠ QUÉ VA A PASAR, DICHO ANTES DE QUE PASE. Nunca se actualiza una fila:
          se escribe una versión nueva con las líneas del branch. Sin esta frase,
          «guardar un margen» y «escribir 28 filas» se parecen demasiado.
        */}
        <p className="mg-form__que">
          Saving writes <b>version v{grilla.versionMaxima + 1}</b> of branch {edicion.branch} with all{' '}
          {grilla.lineas.length} of its lines. Nothing is updated in place, and the previous version stays readable in
          the history.
        </p>

        {sinAutor && (
          <p className="bp-notice bp-notice--warn">
            Could not read the session email, and every version records who wrote it. Reload the page before editing.
          </p>
        )}

        <div className="mg-form__lineas">
          {lineas.map((l) => {
            const k = l.loanType + '/' + l.nivel;
            const crudo = (valores[k] ?? '').trim();
            const n = Number(crudo);
            const mal = crudo !== '' && (!Number.isFinite(n) || n < 0 || !Number.isInteger(n));
            return (
              <label className="mg-form__linea" key={k}>
                <span className="mg-form__nombre">
                  {l.loanType} · {l.nivel}
                </span>
                <span className="mg-form__actual" data-mg-actual={k}>
                  now {fmt(l.valor)}
                </span>
                <input
                  className={'field mg-form__input' + (mal ? ' mg-form__input--mal' : '')}
                  data-mg-input={k}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={valores[k] ?? ''}
                  disabled={ocupado}
                  onChange={(e) => setValores({ ...valores, [k]: e.target.value })}
                  placeholder={l.valor === null ? '' : String(l.valor)}
                />
              </label>
            );
          })}
        </div>

        <p className="mg-form__nota">Whole basis points only — no decimals. Leave a field untouched to keep it.</p>

        {invalidos.length > 0 && (
          <p className="bp-notice bp-notice--warn" data-mg-invalidos="">
            {invalidos.length} value(s) are not whole basis points: {' '}
            {invalidos.map((l) => l.loanType + ' · ' + l.nivel).join(', ')}.
          </p>
        )}

        <label className="bp-form__field">
          <span className="bp-form__label">Reason</span>
          <textarea
            className="field mg-form__motivo"
            data-mg-motivo=""
            rows={3}
            value={motivo}
            disabled={ocupado}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Why is this margin changing?"
          />
        </label>

        {aviso && (
          <p className="bp-notice bp-notice--warn" role="alert" data-mg-error="">
            {aviso}
          </p>
        )}
      </div>
    </Modal>
  );
}
