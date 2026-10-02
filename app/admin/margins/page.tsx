'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/**
 * ============================================================================
 * LA TABLA DEL BRANCH, UNA SOLA VEZ — etapa ADM4
 * ============================================================================
 *
 * Las tres superficies de este módulo --la tabla, la ventana de edición y cada
 * versión del historial-- muestran LA MISMA FORMA: una fila por tipo de
 * préstamo y una columna por nivel. Lo que cambia es qué va adentro de la celda.
 *
 * ⚠ Y NO SE REPITE EL MARCADO TRES VECES, porque las tres tienen que decidir lo
 * mismo: QUÉ FILAS Y QUÉ COLUMNAS TIENE ESTE BRANCH. Eso no es una coincidencia
 * visual -- `Region` la tienen 5 de 21 y `Recruitment - BM` tiene sólo `Branch`,
 * así que tres copias divergirían con el primer `edit` y una mostraría una
 * columna que las otras dos no. Es la familia de las dos copias de la misma
 * decisión, con el disparador en el primer cambio y no en el tercer llamador.
 *
 * `celda` devuelve `null` para decir «este branch no tiene esa línea», que es lo
 * que se dibuja rayado y sin contenido. Un cero, en cambio, es un valor.
 */
function TablaDeMargenes({
  tipos,
  niveles,
  clase,
  rotulo,
  celda,
}: {
  tipos: string[];
  niveles: Nivel[];
  clase?: string;
  rotulo: (tipo: string) => ReactNode;
  celda: (tipo: string, nivel: Nivel) => { contenido: ReactNode; clase?: string; marca?: string } | null;
}) {
  return (
    <table className={'piv mg-tabla' + (clase ? ' ' + clase : '')}>
      <thead>
        <tr>
          <th className="lbl">Loan type</th>
          {NIVELES.map((n) => (
            <th key={n} className={niveles.includes(n) ? '' : 'mg-col-ausente'}>
              {n}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tipos.map((tipo) => (
          <tr key={tipo}>
            <td className="lbl">{rotulo(tipo)}</td>
            {NIVELES.map((n) => {
              const c = celda(tipo, n);
              if (c === null) {
                return (
                  <td
                    key={n}
                    className="val zero mg-ausente"
                    data-mg-celda-ausente={tipo + '/' + n}
                  />
                );
              }
              return (
                <td key={n} className={'val' + (c.clase ? ' ' + c.clase : '')} data-mg-marca={c.marca}>
                  {c.contenido}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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

  /*
   * ⚠ LAS SECCIONES SE FILTRAN CONTRA `visibles`, no se recalculan — etapa ADM5.
   *
   * El filtro de branch y el reparto en secciones son dos cosas distintas y
   * tienen que seguir siéndolo: con un branch elegido, se dibuja su sección y
   * las otras no existen, en vez de perder el encabezado que dice en cuál está.
   */
  const secciones = useMemo(() => {
    const dentro = new Set(visibles);
    const s = data?.secciones;
    return [
      {
        clave: 'active',
        titulo: 'Active branches',
        que: 'At least one active producer in the roster.',
        codigos: (s?.activos ?? []).filter((c) => dentro.has(c)),
        total: s?.activos.length ?? 0,
      },
      {
        /*
         * ⚠ VA ANTES DE LOS INACTIVOS, Y NO ES UN GUSTO — etapa ADM7.
         *
         * `Recruitment` no es un branch que dejó de producir: es una cola de
         * espera. Puesto después de los inactivos queda agrupado con lo que no
         * opera, y es lo contrario -- es lo que todavía no empezó.
         *
         * Y por eso no va en ninguna de las otras secciones: cumple la regla de
         * inactivo y llamarlo «Inactive» sería falso. Es la misma decisión que
         * Outlook tomó en OL21 para su propio marcador, escrita en
         * `margins-modelo.ts`.
         */
        clave: 'recruitment',
        titulo: 'Recruitment',
        que: 'Margins for people who do not have a branch yet — not branches.',
        codigos: (s?.marcadores ?? []).filter((c) => dentro.has(c)),
        total: s?.marcadores.length ?? 0,
      },
      {
        clave: 'inactive',
        titulo: 'Inactive branches',
        que: 'In the roster, with people, and no active producer.',
        codigos: (s?.inactivos ?? []).filter((c) => dentro.has(c)),
        total: s?.inactivos.length ?? 0,
      },
      {
        /*
         * ⚠ ERA UNA LÍNEA EN EL PIE Y PASÓ A SER SECCIÓN. Caía con los de
         * arriba porque la regla del portal los junta --ninguno tiene
         * productores-- y la diferencia tiene consecuencia: a una oficina con
         * gente se le puede fijar un margen esperando producción, y a un branch
         * donde no hay nadie, no. Nombrarlos juntos en una nota los dejaba
         * mezclados.
         */
        clave: 'no-roster',
        titulo: 'No one in the roster',
        /*
         * ⚠ NOMBRA, NO INTERPRETA — etapa ADM8.
         *
         * Decía «nobody to produce here», que se lee como una falta: un branch
         * al que hay que ponerle gente. Y no lo es necesariamente -- puede
         * haberse cerrado y la grilla quedó, o haberse abierto y todavía no
         * tener a nadie asignado. Un rótulo que afirma un problema manda a
         * alguien a buscar personas que no faltan, que es la misma forma que
         * `already above forecast`: una interpretación amable al lado de un
         * número, que nadie verifica.
         */
        que: 'No one is assigned to these branches in the roster.',
        nota:
          'A branch can have margins and nobody in the roster: it closed and the grid stayed, ' +
          'or it opened and nobody is assigned yet. Neither is something to fix from this screen.',
        codigos: (s?.sinRoster ?? []).filter((c) => dentro.has(c)),
        total: s?.sinRoster.length ?? 0,
      },
    ];
  }, [data, visibles]);

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
          {/*
            ⚠ EL ESPACIO VA EXPLÍCITO EN `{' '}`, y lo que sigue es lo medido y
            no el mecanismo, que no averigüé.

            Antes acá había un espacio escrito entre `</b>` y `The`, en la misma
            línea, y en el DOM NO HABÍA NINGÚN NODO entre los dos: la pantalla
            decía «does not have them.The P&L still reads». Medido leyendo los
            `childNodes` del aviso antes y después -- no el `textContent`, que
            no distingue «no hay nodo» de «el nodo está vacío».

            Por qué JSX se lo comió ahí y no en los otros cuatro `</b> The` de
            estas dos pantallas, no lo sé: lo probé en uno solo. `{' '}` es la
            forma explícita, que no depende de saberlo.

            Y lo encontró la CAPTURA. Ninguna aserción de texto lo veía, porque
            todas comparan contra un fragmento y el fragmento estaba entero.
          */}
          <b>{data.deLaApp} margin line(s) were edited here, and BigQuery does not have them.</b>{' '}
          The P&amp;L still reads the margin file, so a value edited on this screen is not reflected there until the
          file is updated.
        </div>
      )}

      {/*
        ⚠ LAS TARJETAS EN MOSAICO, Y LA GRILLA SIN NÚMERO DE COLUMNAS — etapa ADM4.

        `auto-fill` con `minmax` decide cuántas entran según el ancho que haya:
        en una pantalla angosta queda una sola y se apila sola, sin un
        `@media` que haya que mantener de acuerdo con el `min-width` de la
        tabla. Un número fijo de columnas se rompe en cuanto alguien cambia el
        ancho del contenedor, y el síntoma aparece en otra pantalla.

        El `min()` del minmax es lo que evita el desborde: sin él, una columna
        de 600px en una ventana de 480 arrastra la página entera -- que es el
        mismo mecanismo del `nowrap` sobre contenido variable.
      */}
      {data.rosterError && (
        <div className="bp-notice bp-notice--warn" data-mg-roster-error="">
          Could not read <code>org.roster_current</code>, so branches could not be split into active and inactive:{' '}
          {data.rosterError}
        </div>
      )}
      {!data.rosterError && data.rosterFilas === 0 && (
        <div className="bp-notice bp-notice--warn" data-mg-roster-vacio="">
          {/*
            ⚠ SIN ROSTER, TODOS CAEN EN INACTIVO por la regla --nadie tiene
            productores-- y la pantalla diría que la división entera dejó de
            operar. Un cero con `error: null` es una policy que no aplica, no un
            roster vacío, y la diferencia hay que decirla acá y no deducirla de
            una sección sospechosamente larga.
          */}
          <b>The roster came back empty, so every branch below is listed as inactive.</b>{' '}
          The read returned no error and zero rows, which is what you see when the table has a <code>GRANT</code> but
          no RLS policy applies to this session. Active and inactive cannot be told apart until that is fixed.
        </div>
      )}

      {secciones.map((s) =>
        s.codigos.length === 0 ? null : (
          <section className="mg-seccion" key={s.clave} data-mg-seccion={s.clave}>
            <div className="mg-seccion__cab">
              <h2 className="mg-seccion__titulo">{s.titulo}</h2>
              <span className="mg-seccion__n" data-mg-seccion-n={s.clave}>
                {s.codigos.length === s.total
                  ? s.codigos.length
                  : s.codigos.length + ' of ' + s.total}
              </span>
              <span className="mg-seccion__que">{s.que}</span>
            </div>
            {/*
              ⚠ LA NOTA DICE QUE ESTO NO ES UN PENDIENTE, y va una vez por
              sección y no al lado de cada tarjeta: son seis branches y sería el
              mismo texto seis veces.
            */}
            {s.nota && (
              <p className="mg-seccion__nota" data-mg-seccion-nota={s.clave}>
                {s.nota}
              </p>
            )}
            <div className="mg-grid" data-mg-grid={s.clave}>
      {s.codigos.map((codigo) => {
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

            <TablaDeMargenes
              tipos={grilla.tipos}
              niveles={grilla.niveles}
              /* El tipo de préstamo abre los niveles de esa fila. */
              rotulo={(tipo) => (
                <button
                  type="button"
                  className="mg-tipo"
                  data-mg-editar-fila={tipo}
                  onClick={() => setEdicion({ clase: 'fila', branch: codigo, loanType: tipo })}
                >
                  {tipo}
                </button>
              )}
              celda={(tipo, n) => {
                const c = grilla.celda(tipo, n);
                /*
                 * ⚠ ACÁ SE DECIDE LA DISTINCIÓN DEL CERO Y LA AUSENCIA.
                 * `null` es «este branch no tiene ese nivel» y NO lleva botón:
                 * no hay nada que editar. Un cero sí es un valor y sí se edita.
                 */
                if (c === null) return null;
                return {
                  clase: c.valor === 0 ? 'zero' : undefined,
                  contenido: (
                    <button
                      type="button"
                      className="mg-valor"
                      data-mg-celda={tipo + '/' + n}
                      onClick={() =>
                        setEdicion({ clase: 'celda', branch: codigo, loanType: tipo, nivel: n })
                      }
                    >
                      {fmt(c.valor)}
                    </button>
                  ),
                };
              }}
            />

            <Historial versiones={versiones} codigo={codigo} grilla={grilla} />
          </section>
        );
      })}
            </div>
          </section>
        )
      )}

      {/*
        ⚠ ACÁ ESTABA LA NOTA DEL PIE que nombraba a los que no tienen fila en el
        roster. Se fue porque ahora tienen sección propia: nombrarlos en una
        nota al final los dejaba mezclados con los que sí están en el roster, y
        la diferencia decide qué se puede hacer con cada uno.
      */}

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
  grilla,
}: {
  versiones: ReturnType<typeof historial>;
  codigo: string;
  grilla: Grilla;
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

          {/*
            ⚠ LA VERSIÓN, EN LA MISMA FORMA QUE LA TABLA — etapa ADM4.

            Antes cada línea era un renglón suelto, y una v1 de 26 altas eran 26
            renglones. Ahora es la grilla del branch con el antes y el después
            en la celda.

            ⚠ Y HAY QUE DISTINGUIR CUATRO ESTADOS CON TRES ASPECTOS, que es lo
            único delicado de este cambio:

              cambió      `449 → 455`
              se copió    celda VACÍA -- es lo que hace que `⟳ N` se entienda
                          sola: las vacías son esas N
              alta        `new 225`, que no es un cambio desde la nada
              ⚠ omitida   `—` en ámbar. NO puede quedar vacía: «no la escribió»
                          y «la escribió igual» significan cosas distintas, y la
                          primera deja a la vista sirviendo una versión anterior
                          para esa línea. Vacías las dos, serían el mismo píxel.

            Y la celda rayada sigue siendo la quinta: el branch no tiene esa
            línea en ninguna versión.
          */}
          <TablaDeMargenes
            clase="mg-hist__tabla"
            tipos={grilla.tipos}
            niveles={grilla.niveles}
            rotulo={(tipo) => tipo}
            celda={(tipo, n) => {
              if (grilla.celda(tipo, n) === null) return null;
              const k = tipo + '\u0000' + n;
              const escrita = v.lineas.find((l) => l.loanType + '\u0000' + l.nivel === k);
              const omitida = v.omitidas.find((l) => l.loanType + '\u0000' + l.nivel === k);
              if (omitida) {
                return {
                  clase: 'mg-hist__omitida',
                  marca: 'omitida',
                  contenido: <span title={'Not written by this version. Still ' + fmt(omitida.antes) + '.'}>—</span>,
                };
              }
              if (!escrita) return { contenido: '', marca: 'fuera' };
              if (escrita.estado === 'igual') return { contenido: '', marca: 'igual' };
              if (escrita.estado === 'alta') {
                return {
                  clase: 'mg-hist__alta',
                  marca: 'alta',
                  contenido: 'new ' + fmt(escrita.despues),
                };
              }
              return {
                clase: 'mg-hist__cambio',
                marca: 'cambio',
                contenido: fmt(escrita.antes) + ' → ' + fmt(escrita.despues),
              };
            }}
          />

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

  /*
   * Los tipos de préstamo que la ventana dibuja: los de las líneas que se
   * editan, en el orden de la tabla. Para el branch entero son los 14; para una
   * fila, uno; para una celda, uno.
   */
  const tiposDeLaVentana = useMemo(
    () => grilla.tipos.filter((t) => lineas.some((l) => l.loanType === t)),
    [grilla, lineas]
  );

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

        {/*
          ⚠ EN COLUMNAS Y NO EN LISTA — etapa ADM4, y es el punto 1 del pedido.

          El branch entero eran 28 renglones, uno por (tipo, nivel), y la ventana
          quedaba larguísima. Ahora son 14 filas con los niveles en columnas: la
          MISMA forma que la tabla de afuera, con el mismo componente.

          ⚠ Y LAS CELDAS QUE NO SE ESTÁN EDITANDO SE MUESTRAN, apagadas y sin
          campo. En la ventana de una celda o de una fila eso es el contexto --se
          ve qué más tiene ese tipo de préstamo-- y en la del branch no cambia
          nada, porque se editan todas. Dejarlas fuera habría hecho que la
          ventana de una celda fuera una tabla de una celda, que no es una tabla.

          Lo que NO cambia es qué se guarda: las líneas editables son las de
          `lineas`, y `cambios` sigue saliendo sólo de ellas.
        */}
        <div className="mg-form__tabla">
          <TablaDeMargenes
            clase="mg-form__piv"
            tipos={tiposDeLaVentana}
            niveles={grilla.niveles}
            rotulo={(tipo) => tipo}
            celda={(tipo, n) => {
              const linea = grilla.celda(tipo, n);
              if (linea === null) return null;
              const k = tipo + '/' + n;
              const editable = lineas.some((l) => l.loanType === tipo && l.nivel === n);
              if (!editable) {
                return {
                  clase: 'zero mg-form__fija',
                  marca: 'fija',
                  contenido: fmt(linea.valor),
                };
              }
              const crudo = (valores[k] ?? '').trim();
              const num = Number(crudo);
              const mal = crudo !== '' && (!Number.isFinite(num) || num < 0 || !Number.isInteger(num));
              return {
                marca: 'editable',
                contenido: (
                  <label className="mg-form__celda">
                    <span className="mg-form__actual" data-mg-actual={k}>
                      now {fmt(linea.valor)}
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
                      placeholder={linea.valor === null ? '' : String(linea.valor)}
                    />
                  </label>
                ),
              };
            }}
          />
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
