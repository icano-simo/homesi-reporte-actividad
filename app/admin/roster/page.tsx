'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeChange,
  haceCuanto,
  loadAdminData,
  shortDate,
  shortDateTime,
  SIN_BRANCH,
  type AdminData,
  type GrupoDeReclutamiento,
} from '@/lib/admin/loadRoster';

/**
 * ============================================================================
 * ROSTER — el tablero del roster (etapas ADM1, ADM2; movido y traducido en ADM3)
 * ============================================================================
 *
 * Tres bloques: los indicadores, los branches como tarjetas, y el reclutamiento
 * en el suyo. El lenguaje visual es el de Analytics --`.mcard` para un
 * indicador, `.tbl-card` para una tarjeta con cabecera-- y por eso esas clases
 * NO se redefinen acá: viven en `app/styles/components.css`, que es global.
 *
 * ⚠ Se usan las CLASES y no se importa el componente `KpiCard` de Business
 * Plan. Compartir la decision visual es lo que hace falta, y esa decision ya
 * vive en el CSS; importar el componente arrastraria `qualifiers`, `rates` y
 * `months` del otro modulo al bundle de Admin por tres lineas de JSX.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTA PANTALLA ESTABA EN ESPAÑOL, Y SE TRADUJO EN ADM3
 * ---------------------------------------------------------------------------
 * La regla del proyecto es que todo el texto de pantalla va en inglés, en todos
 * los módulos. ADM1 y ADM2 la dejaron en español y era la única del portal que
 * no la cumplía. ADM3 le cambia el nombre al módulo --de `Admin` a `Roster`-- y
 * la mueve de `/admin` a `/admin/roster`, así que la tocaba igual: dejarla en
 * español habría sido decidir que la excepción se queda, y nadie se iba a
 * acordar después.
 *
 * Los COMENTARIOS y los nombres de las variables siguen en español, como el
 * resto del repositorio. La regla gobierna lo que alguien lee en la pantalla.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NINGUN TEXTO AL LADO DE UNA PERSONA
 * ---------------------------------------------------------------------------
 * Pedido explicito, y gobierna el marcado: una fila del roster lleva EL NOMBRE
 * Y EL CARGO, y nada mas. Sin etiquetas de estado, sin avisos, sin `title`, sin
 * marcas de NPPM ni de "lo fijo una persona". El branch lo dice la cabecera de
 * su tarjeta.
 *
 * Lo que la pantalla necesite decir se dice UNA vez, en la cabecera de su
 * bloque o en el pie, donde no le cuelga a nadie.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS DOS FECHAS DEL RECLUTAMIENTO NO SON LA MISMA COSA
 * ---------------------------------------------------------------------------
 * `fecha_inicio` es el dia que la persona empieza --solo la traen los 7 de
 * RRHH--; `close_date` es la fecha ESPERADA de cierre de una oportunidad de
 * Salesforce --solo la traen los 14 de ahi--. Por eso el bloque va agrupado por
 * fuente, con la fecha rotulada en cada grupo, y no como una lista de 21 con
 * una columna "fecha": esa columna haria que 21 filas se lean como 21 ingresos.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `date_started` NO SE MUESTRA, Y NO ES QUE ESTE VACIA
 * ---------------------------------------------------------------------------
 * Medido el 2026-09-18: la tienen 45 de las 111 activas -- 41 de Colombia y las
 * 4 de CO/US, y CERO de las 64 de USA. O sea que la columna llega llena desde
 * el archivo de Colombia y vacia desde el de USA. No se muestra por decision de
 * la etapa; si mañana se mostrara, el hueco seria de USA y no del dato.
 */

/** Los tipos de cambio, como se leen. */
function changeLabel(t: string): string {
  const map: Record<string, string> = {
    added: 'added',
    removed: 'removed',
    branch_changed: 'branch changed',
    position_changed: 'position changed',
    reactivated: 'reactivated',
  };
  return map[t] ?? t;
}

/** El nombre de la fuente, como se lee. El dato crudo dice `hr_pipeline`. */
function fuenteLabel(origen: string): string {
  return origen === 'hr_pipeline' ? 'HR' : origen === 'salesforce' ? 'Salesforce' : origen;
}

/**
 * Qué es la fecha de este grupo, dicho en la cabecera.
 *
 * Es la unica forma de que las dos convivan en la pantalla sin que alguien las
 * sume: el rotulo no dice "fecha", dice cuál.
 */
function fechaLabel(g: GrupoDeReclutamiento): string {
  return g.fecha === 'inicio' ? 'Start date' : 'Expected close';
}

export default function RosterPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (error) {
    return (
      <div className="hub-container adm-page">
        <div className="bp-notice bp-notice--warn adm-notice">Could not load the roster: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hub-container adm-page">
        <p className="adm-muted" data-adm-cargando="">
          Loading the roster…
        </p>
      </div>
    );
  }

  const { indicadores: k, diagnostics, branches, reclutamiento, actualizado } = data;
  const pendientes = data.changes.filter((c) => !c.acknowledged);
  const revisados = data.changes.filter((c) => c.acknowledged);
  const enProceso = reclutamiento.reduce((a, g) => a + g.gente.length, 0);

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

  /*
   * Los indicadores, todos sobre las ACTIVAS salvo el ultimo, y el encuadre va
   * escrito en el rotulo. Ver la nota de `Indicadores` en el loader: `colombia`
   * mas `usa incluyendo bajas` da 111 por dos errores que se compensan.
   *
   * ⚠ Y los 21 en proceso NO estan acá. Un octavo indicador al lado de los de
   * personas se sumaria con ellos, que es exactamente lo que el bloque de
   * reclutamiento viene a evitar: su conteo vive en su propio bloque, separado
   * por fuente, donde no se puede leer como "21 ingresos".
   */
  const tarjetas: { clave: string; rotulo: string; valor: number }[] = [
    { clave: 'activas', rotulo: 'Active people', valor: k.activas },
    { clave: 'loan-officers', rotulo: 'Loan Officers', valor: k.loanOfficers },
    { clave: 'nppm', rotulo: 'NPPM', valor: k.nppm },
    { clave: 'colombia', rotulo: 'Colombia', valor: k.colombia },
    { clave: 'usa', rotulo: 'USA', valor: k.usa },
    { clave: 'co-us', rotulo: 'CO/US', valor: k.coUs },
    { clave: 'inactivas', rotulo: 'Inactive', valor: k.inactivas },
  ];

  return (
    <div className="hub-container adm-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Roster</h1>
          <p className="page-head__subtitle">
            {k.activas} active people in {branches.length} branches
          </p>
        </div>
        <p className="adm-sello" data-adm-sello="">
          Updated {shortDateTime(actualizado.roster) ?? 'never'}
        </p>
      </div>

      {/*
        ⚠ Los avisos son distintos entre si a proposito. Con RLS, una tabla sin
        politica devuelve CERO FILAS y no un error, asi que "no tengo permiso",
        "todavia no hay datos" y "fallo la lectura" se ven igual si no se separan.
      */}
      {diagnostics.rosterError && (
        <div className="bp-notice bp-notice--warn adm-notice">
          Could not read <code>org.roster_current</code>: {diagnostics.rosterError}
        </div>
      )}
      {!diagnostics.rosterError && diagnostics.rosterRows === 0 && (
        <div className="bp-notice bp-notice--warn adm-notice">
          <b>The roster came back empty.</b> Reading <code>org.roster_current</code> returned no error and zero rows,
          which is what you see when the table has a <code>GRANT</code> but no RLS policy applies to this session. That
          is not the same as an empty table.
        </div>
      )}
      {diagnostics.reclutaError && (
        <div className="bp-notice bp-notice--warn adm-notice">
          Could not read <code>activity_report.future_loan_officer</code>: {diagnostics.reclutaError}
        </div>
      )}

      {/* ── 1. Los indicadores ────────────────────────────────────────── */}
      <section className="adm-block">
        <ul className="adm-kpis" data-adm-kpis="">
          {tarjetas.map((t) => (
            <li className="mcard adm-kpi" key={t.clave} data-adm-kpi={t.clave}>
              <span className="m-name">{t.rotulo}</span>
              <span className="kpi-hero__value adm-kpi__valor">{t.valor}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 2. Los branches ───────────────────────────────────────────── */}
      <section className="adm-block">
        <div className="adm-grid">
          {branches.map((b) => (
            <div className="tbl-card adm-bcard" key={b.branchCode} data-adm-branch={b.branchCode}>
              <div className="tbl-card__head">
                <span className="tbl-card__title adm-bcard__code">{b.branchCode}</span>
                <span className="adm-bcard__n">{b.people.length}</span>
              </div>
              <ul className="adm-personas">
                {b.people.map((p) => (
                  <li className="adm-persona" key={p.person_code} data-adm-persona={p.person_code}>
                    <span className="adm-persona__nombre">{p.display_name}</span>
                    <span className="adm-persona__cargo">{p.position?.trim() || SIN_BRANCH}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. Reclutamiento ──────────────────────────────────────────── */}
      <section className="adm-block">
        <div className="adm-head">
          <h2 className="adm-h">Hiring in progress</h2>
          <span className="adm-muted" data-adm-en-proceso="">
            {enProceso} in {reclutamiento.length} groups ·{' '}
            {shortDateTime(actualizado.reclutamiento) ?? 'never'}
          </span>
        </div>

        {/*
          Se dice una vez, acá arriba, y no al lado de cada persona: las dos
          fechas miden cosas distintas y los grupos no se suman entre si.
        */}
        <p className="adm-hint">
          <b>These groups do not add up.</b> The ones from HR have a <b>start date</b>: that is the day the person
          begins. The ones from Salesforce have an <b>expected close</b>, which is when the opportunity is expected to
          close — not the day anyone joins.
        </p>

        {reclutamiento.length === 0 && !diagnostics.reclutaError && (
          <p className="adm-muted">Nobody is being hired right now.</p>
        )}

        <div className="adm-grid">
          {reclutamiento.map((g) => (
            <div
              className="tbl-card adm-bcard adm-grupo"
              key={g.origen + g.confianza}
              data-adm-grupo={g.origen + '/' + g.confianza}
            >
              <div className="tbl-card__head">
                <span className="tbl-card__title adm-grupo__titulo">
                  {fuenteLabel(g.origen)} · {g.confianza}
                </span>
                <span className="adm-bcard__n">{g.gente.length}</span>
              </div>
              <p className="adm-grupo__que">{fechaLabel(g)}</p>
              <ul className="adm-personas">
                {g.gente.map((r) => {
                  const fecha = g.fecha === 'inicio' ? r.fecha_inicio : r.close_date;
                  const hace = g.fecha === 'close' ? haceCuanto(r.close_date) : null;
                  return (
                    <li className="adm-recluta" key={r.nombre} data-adm-recluta="">
                      <span className="adm-persona__nombre">{r.nombre}</span>
                      <span className="adm-persona__cargo">{r.cargo?.trim() || SIN_BRANCH}</span>
                      <span className="adm-persona__branch">{r.branch_code?.trim() || SIN_BRANCH}</span>
                      <span className="adm-recluta__fecha">
                        {shortDate(fecha) ?? SIN_BRANCH}
                        {hace ? <span className="adm-recluta__hace">{hace}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. Los cambios entre cargas ───────────────────────────────── */}
      <section className="adm-block">
        <div className="adm-head">
          <h2 className="adm-h">Changes detected between loads</h2>
        </div>
        {diagnostics.changeError && (
          <div className="bp-notice bp-notice--warn adm-notice">
            Could not read <code>org.roster_change_log</code>: {diagnostics.changeError}
          </div>
        )}
        {!diagnostics.changeError && data.changes.length === 0 && (
          <p className="adm-muted">No changes recorded yet.</p>
        )}
        {[...pendientes, ...revisados].map((c) => (
          <div className="adm-cambio" key={c.id}>
            <div className="adm-cambio__main">
              <b>{c.display_name ?? c.person_code}</b> — {changeLabel(c.change_type)}
              {c.old_value || c.new_value ? (
                <span className="adm-cambio__valores">
                  {c.old_value ?? '—'} → {c.new_value ?? '—'}
                </span>
              ) : null}
            </div>
            <div className="adm-cambio__pie">
              <span className="adm-muted">{shortDate(c.detected_at)}</span>
              {c.acknowledged ? (
                <span className="adm-muted">reviewed by {c.acknowledged_by ?? '—'}</span>
              ) : (
                <button type="button" onClick={() => marcar(c.id)} disabled={saving === c.id}>
                  {saving === c.id ? 'Saving…' : 'Mark as reviewed'}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      {/*
        El pie. Todo lo que hay que aclarar vive acá: una vez, y lejos de los
        nombres.
      */}
      <p className="adm-foot">
        The branch here is the one in the <b>roster</b> — where HR has the person assigned — not where they produce.
        Loan Officers are counted by who produces, not by job title. The {k.inactivas} inactive people are kept and are
        not listed here.
      </p>
    </div>
  );
}
