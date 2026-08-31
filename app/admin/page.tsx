'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeChange,
  loadAdminData,
  shortDate,
  type AdminData,
  type RosterPerson,
} from '@/lib/admin/loadRoster';

/**
 * ============================================================================
 * ADMIN — el roster de RRHH y los cambios entre cargas (etapa ADMIN-1)
 * ============================================================================
 *
 * Para que se pueda ver quién está en cada branch, quién entró o salió y desde
 * cuándo, sin preguntarle a nadie.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTA PANTALLA REPORTA. NO DA NI QUITA DE BAJA A NADIE.
 * ---------------------------------------------------------------------------
 * Decisión explícita: un archivo de RRHH incompleto desactivaría a quien sí
 * está trabajando, así que la baja se decide a mano y fuera de acá. Lo único
 * que se escribe es el `acknowledged` de una fila del log -- "ya lo vi", nunca
 * "ya lo apliqué".
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL BRANCH DE ESTA PANTALLA ES EL DEL ROSTER
 * ---------------------------------------------------------------------------
 * Dónde RRHH tiene asignada a la persona, NO dónde produce. Un loan officer
 * puede originar préstamos en otro branch. Está dicho en la nota al pie y en el
 * encabezado de la sección, porque es la confusión más fácil de esta pantalla y
 * la que en Outlook ya costó un doble conteo.
 */

type Pais = 'todos' | 'CO' | 'US' | 'CO-US';
type Estado = 'activos' | 'inactivos' | 'todos';

function matchesPais(p: RosterPerson, filtro: Pais): boolean {
  if (filtro === 'todos') return true;
  return (p.country ?? '').trim().toUpperCase() === filtro;
}

function matchesEstado(p: RosterPerson, filtro: Estado): boolean {
  if (filtro === 'todos') return true;
  return filtro === 'activos' ? p.is_active : !p.is_active;
}

/** Los tipos de cambio, en español legible. */
function changeLabel(t: string): string {
  const map: Record<string, string> = {
    added: 'alta',
    removed: 'baja',
    branch_changed: 'cambio de branch',
    position_changed: 'cambio de cargo',
    reactivated: 'reactivación',
  };
  return map[t] ?? t;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pais, setPais] = useState<Pais>('todos');
  const [estado, setEstado] = useState<Estado>('activos');
  const [saving, setSaving] = useState<number | null>(null);

  const reload = useCallback(
    () =>
      loadAdminData()
        .then(setData)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    []
  );

  useEffect(() => {
    let cancelled = false;
    loadAdminData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="hub-container"><div className="bp-empty">Could not load Admin: {error}</div></div>;
  if (!data) return <div className="hub-container"><div className="bp-empty">Loading the roster…</div></div>;

  const { hayHistoriaDeCargas, hayEstadoDeBranches, diagnostics } = data;

  /* El filtro se aplica acá y los branches vacíos desaparecen: una sección con
     un título y cero filas se lee como un branch sin gente, no como un filtro. */
  const branches = data.branches
    .map((b) => ({ ...b, people: b.people.filter((p) => matchesPais(p, pais) && matchesEstado(p, estado)) }))
    .filter((b) => b.people.length > 0);
  const totalVisible = branches.reduce((a, b) => a + b.people.length, 0);

  const pendientes = data.changes.filter((c) => !c.acknowledged);
  const revisados = data.changes.filter((c) => c.acknowledged);

  async function marcar(id: number) {
    setSaving(id);
    try {
      await acknowledgeChange(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  /** `—` cuando no se puede saber; el valor cuando sí. Nunca una celda vacía. */
  function fecha(valor: string | null, motivo: string) {
    const d = shortDate(valor);
    if (d) return <>{d}</>;
    return (
      <span className="adm-muted" title={motivo}>
        sin registro
      </span>
    );
  }

  return (
    <div className="hub-container adm-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Admin</h1>
          <p className="page-head__subtitle">
            Roster de RRHH y cambios detectados entre cargas — {totalVisible} de {diagnostics.rosterRows} persona
            {diagnostics.rosterRows === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/*
        ⚠ Los tres avisos de abajo son distintos entre sí a propósito. Con RLS,
        una tabla sin política devuelve CERO FILAS y no un error, así que "no
        tengo permiso", "todavía no hay datos" y "falló la lectura" se ven
        exactamente igual en la pantalla si uno no los separa.
      */}
      {diagnostics.rosterError && (
        <div className="bp-notice bp-notice--warn adm-notice">
          No se pudo leer <code>org.roster_current</code>: {diagnostics.rosterError}
        </div>
      )}
      {!diagnostics.rosterError && diagnostics.rosterRows === 0 && (
        <div className="bp-notice bp-notice--warn adm-notice">
          <b>El roster viene vacío.</b> La lectura de <code>org.roster_current</code> no dio error y devolvió cero
          filas. El permiso está bien —la tabla tiene su <code>GRANT</code> y su política por el claim{' '}
          <code>admin</code>—, así que lo que falta son los datos: el roster todavía no se sincroniza desde{' '}
          <code>hr_centralizado.roster_for_admin</code>. Son 108 personas.
        </div>
      )}

      {/* ── 1. El roster, por branch ──────────────────────────────────── */}
      <section className="adm-block">
        <div className="adm-head">
          <h2 className="adm-h">Roster por branch</h2>
          <div className="adm-filtros">
            <div className="seg" role="group" aria-label="País">
              {(['todos', 'CO', 'US', 'CO-US'] as Pais[]).map((k) => (
                <button key={k} type="button" className={pais === k ? 'on' : ''} onClick={() => setPais(k)}>
                  {k === 'todos' ? 'Todos' : k}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Estado">
              {(['activos', 'inactivos', 'todos'] as Estado[]).map((k) => (
                <button key={k} type="button" className={estado === k ? 'on' : ''} onClick={() => setEstado(k)}>
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="adm-hint">
          <b>El branch de esta pantalla es el del roster</b>: dónde RRHH tiene asignada a la persona, no dónde produce.
          Un loan officer puede originar préstamos en otro branch.
        </p>

        {/*
          Estado transitorio, y por eso se dice una vez y no en cada grupo: las
          columnas de branch existen en la tabla desde antes de que el sync
          las llenara. Desaparece solo con la primera corrida. Sin este aviso,
          16 encabezados sin chip se leerían como que la función no llegó.
        */}
        {!hayEstadoDeBranches && diagnostics.rosterRows > 0 && (
          <p className="adm-hint">
            <b>El estado de los branches todavía no llegó</b>: el roster se sincronizó antes de que
            el sync trajera esa columna. Aparece en la próxima corrida. Que no haya chip no significa
            que el branch esté cerrado.
          </p>
        )}

        {branches.length === 0 && diagnostics.rosterRows > 0 && (
          <div className="bp-empty">Ninguna persona cumple estos filtros.</div>
        )}

        {branches.map((b) => (
          <div key={b.branchCode} className="adm-branch">
            {/*
              ⚠ ACÁ CONVIVEN DOS ESTADOS QUE NO SON EL MISMO.
              El chip habla del BRANCH; la columna "Estado" de la tabla, de
              cada PERSONA. Por eso el chip dice "Branch activo" y no sólo
              "Activa": sin esa palabra, el encabezado de un grupo con gente
              adentro se lee como si describiera a la gente.

              `null` no pinta chip. No es "inactiva", es que el sync todavía no
              trajo el dato; el aviso de arriba lo explica una vez para toda la
              pantalla en vez de repetirlo en cada grupo.
            */}
            <div className="adm-branch__head">
              <span className="adm-branch__code">{b.branchCode}</span>

              {b.branchIsActive === true && (
                <span className="adm-branch__state adm-branch__state--on">Branch activo</span>
              )}
              {b.branchIsActive === false && (
                <span className="adm-branch__state adm-branch__state--off">Branch inactivo</span>
              )}
              {b.branchNote && <span className="adm-muted">{b.branchNote}</span>}

              <span className="adm-muted">
                {b.people.length} persona{b.people.length === 1 ? '' : 's'}
              </span>

              {/*
                El caso Robert Kravitz. Se dice explícito porque es justo donde
                alguien concluiría que la persona ya no trabaja, y es falso: la
                branch cerró, el empleado sigue. Decirlo acá cuesta una línea;
                deducirlo mal cuesta una baja que nadie pidió.
              */}
              {b.activePeopleInInactiveBranch > 0 && (
                <span className="adm-branch__mixed">
                  {b.activePeopleInInactiveBranch === 1
                    ? '1 persona activa acá'
                    : `${b.activePeopleInInactiveBranch} personas activas acá`}
                </span>
              )}
            </div>
            <div className="tbl-scroll">
              <table className="piv adm-tbl">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Nombre</th>
                    <th className="lbl">Cargo</th>
                    <th className="lbl">Área</th>
                    <th className="bp-center">País</th>
                    <th className="bp-center">Estado</th>
                    <th className="bp-center">Ingreso</th>
                    <th className="bp-center">Primera carga</th>
                    <th className="bp-center">Última carga</th>
                  </tr>
                </thead>
                <tbody>
                  {b.people.map((p) => (
                    <tr key={p.person_code} className="metric">
                      <td className="lbl">
                        {p.display_name}
                        {/*
                          Las dos marcas que se pidieron. Van al lado del nombre
                          y no en una columna propia: son excepciones, y una
                          columna que está vacía en 106 de 108 filas ocupa
                          ancho para no decir nada.
                        */}
                        {p.source_kind === 'user_addition' && (
                          <span
                            className="adm-tag adm-tag--add"
                            title="La agregó la usuaria: RRHH no la tiene en sus archivos, así que no va a venir en la próxima carga."
                          >
                            agregada a mano
                          </span>
                        )}
                        {p.has_override && (
                          <span
                            className="adm-tag adm-tag--fix"
                            title="Un dato del archivo se corrigió a mano. Al lado va el valor original tal como vino."
                          >
                            corregida
                            {p.name_in_file && p.name_in_file !== p.display_name && (
                              <> · el archivo dice &ldquo;{p.name_in_file}&rdquo;</>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="lbl">{p.position ?? <span className="adm-muted">—</span>}</td>
                      <td className="lbl">{p.area ?? <span className="adm-muted">—</span>}</td>
                      <td className="bp-center">{p.country ?? <span className="adm-muted">—</span>}</td>
                      <td className="bp-center">
                        <span className={'adm-estado' + (p.is_active ? ' is-on' : '')}>
                          {p.is_active ? 'activo' : 'inactivo'}
                        </span>
                      </td>
                      {/*
                        ⚠ `date_started` es real pero SÓLO en Colombia: el archivo
                        de USA no trae la fecha de ingreso. Un vacío en una fila
                        de US no es un dato que falte, es un dato que la fuente
                        nunca tuvo -- y decir eso es distinto de dejar la celda
                        en blanco.
                      */}
                      <td className="bp-center">
                        {fecha(
                          p.date_started,
                          (p.country ?? '').toUpperCase() === 'US'
                            ? 'El archivo de RRHH de USA no trae fecha de ingreso. No es un dato que falte: la fuente nunca lo tuvo.'
                            : 'Esta persona no tiene fecha de ingreso en el archivo.'
                        )}
                      </td>
                      <td className="bp-center">
                        {fecha(
                          p.first_seen_at,
                          hayHistoriaDeCargas
                            ? 'No apareció en ninguna carga registrada.'
                            : 'La historia de cargas empieza con la próxima subida del roster: hasta entonces nadie tiene primera ni última carga.'
                        )}
                      </td>
                      <td className="bp-center">
                        {fecha(
                          p.last_seen_at,
                          hayHistoriaDeCargas
                            ? 'No apareció en ninguna carga registrada.'
                            : 'La historia de cargas empieza con la próxima subida del roster.'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      {/* ── 2. Los cambios ────────────────────────────────────────────── */}
      <section className="adm-block">
        <h2 className="adm-h">Cambios detectados</h2>

        {data.changes.length === 0 ? (
          /*
            El estado vacío EXPLICA en vez de decir "no hay datos". Va a estar
            vacío hasta la segunda carga, y "no hay cambios" se lee como "nadie
            entró ni salió", que es una afirmación distinta y falsa.
          */
          <div className="bp-notice adm-notice">
            <b>Todavía no hay cambios que mostrar.</b> Los cambios se detectan comparando una carga de roster con la
            anterior, así que aparecerán tras el próximo roster. No significa que nadie haya entrado o salido: significa
            que todavía no hay dos cargas que comparar.
          </div>
        ) : (
          <>
            {pendientes.length > 0 && <h3 className="adm-h3">Sin revisar ({pendientes.length})</h3>}
            {[...pendientes, ...revisados].map((c) => (
              <div key={c.id} className={'adm-cambio' + (c.acknowledged ? ' is-done' : '')}>
                <div className="adm-cambio__main">
                  <b>{c.display_name ?? c.person_code}</b>
                  <span className="adm-tag">{changeLabel(c.change_type)}</span>
                  {c.branch_code && <span className="adm-muted">branch {c.branch_code}</span>}
                  {c.country && <span className="adm-muted">{c.country}</span>}
                </div>
                {(c.old_value || c.new_value) && (
                  <div className="adm-cambio__valores">
                    <span className="adm-muted">{c.old_value ?? '—'}</span>
                    <span aria-hidden="true">→</span>
                    <span>{c.new_value ?? '—'}</span>
                  </div>
                )}
                <div className="adm-cambio__pie">
                  <span className="adm-muted">detectado {shortDate(c.detected_at)}</span>
                  {c.acknowledged ? (
                    <span className="adm-muted">
                      revisado por {c.acknowledged_by} el {shortDate(c.acknowledged_at)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="bp-btn bp-btn--small"
                      onClick={() => marcar(c.id)}
                      disabled={saving !== null}
                    >
                      {saving === c.id ? '…' : 'Marcar revisado'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {diagnostics.changeError && (
          <div className="bp-notice bp-notice--warn adm-notice">
            No se pudo leer <code>org.roster_change_log</code>: {diagnostics.changeError}
          </div>
        )}
      </section>

      <div className="foot-note adm-foot">
        <b>Esta pantalla no da ni quita de baja a nadie.</b> Reporta lo que dicen los archivos de RRHH; la decisión de
        desactivar a alguien se toma fuera y a mano, porque un archivo incompleto desactivaría a quien sí está
        trabajando. Lo único que se escribe acá es <b>marcar un cambio como revisado</b> — &ldquo;ya lo vi&rdquo;, no
        &ldquo;ya lo apliqué&rdquo;.{' '}
        <b>Las tres fechas no son la misma clase de dato</b>: <b>Ingreso</b> es real, pero sólo en Colombia — el archivo
        de USA no la trae. <b>Primera</b> y <b>última carga</b> salen de comparar subidas del roster.{' '}
        {!hayHistoriaDeCargas && (
          <>
            Hoy dicen <span className="adm-muted">sin registro</span> en todas: los rosters cargaban en modo{' '}
            <i>replace</i> y recién pasaron a <i>append</i>, así que la historia empieza con la próxima subida.{' '}
          </>
        )}
        <b>El branch es el del roster</b>, no el de producción: un loan officer puede originar en otro branch, y esta
        pantalla no lee <code>loan_records_v2</code> ni cruza las dos fuentes.
      </div>

      <div className="bp-diagnostics adm-diag">
        <div>
          <code>{diagnostics.rosterRows}</code> personas en <code>org.roster_current</code> ·{' '}
          <code>{diagnostics.changeRows}</code> filas en <code>org.roster_change_log</code> · historia de cargas:{' '}
          <code>{hayHistoriaDeCargas ? 'sí' : 'no'}</code>
        </div>
      </div>
    </div>
  );
}
