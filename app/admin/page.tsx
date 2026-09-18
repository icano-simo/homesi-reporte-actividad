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
 * ADMIN — el tablero del roster (etapa ADM2)
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
 * ⚠ LA FECHA DE INGRESO SE MUESTRA DONDE EXISTE, Y NO SE DEDUCE
 * ---------------------------------------------------------------------------
 * Medido el 2026-09-18: la tienen 45 de las 111 activas -- 41 de Colombia y las
 * 4 de CO/US, y CERO de las 64 de USA. No es que el sync no la mapee: el
 * archivo de USA no la trae, porque son dos sistemas de RRHH distintos.
 *
 * ⚠ Y NO SE RELLENA CON `first_seen_at`. Esa columna dice cuando la persona
 * aparecio por primera vez en un archivo que subimos NOSOTROS, y el historico
 * empezo el 2026-08-28: alguien con diez años en la empresa figuraria como
 * ingresado en agosto de 2026. Es peor que el vacio, porque un vacio se ve y
 * una fecha falsa no. `verificar:estados` prohibe que `first_seen_at` vuelva a
 * entrar a esta pantalla.
 *
 * ⚠ Y LOS 4 DE `CO/US` VAN A PARECER INCONSISTENTES con el resto de USA: la
 * tienen completa porque vienen del archivo de Colombia. No es un error de la
 * pantalla ni de esas cuatro personas -- es de que fuente salio cada fila.
 */

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

/** El nombre de la fuente, como se lee. El dato crudo dice `hr_pipeline`. */
function fuenteLabel(origen: string): string {
  return origen === 'hr_pipeline' ? 'RRHH' : origen === 'salesforce' ? 'Salesforce' : origen;
}

/**
 * Qué es la fecha de este grupo, dicho en la cabecera.
 *
 * Es la unica forma de que las dos convivan en la pantalla sin que alguien las
 * sume: el rotulo no dice "fecha", dice cuál.
 */
function fechaLabel(g: GrupoDeReclutamiento): string {
  return g.fecha === 'inicio' ? 'Fecha de inicio' : 'Cierre esperado';
}

export default function AdminPage() {
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
        <div className="bp-notice bp-notice--warn adm-notice">No se pudo cargar el roster: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hub-container adm-page">
        <p className="adm-muted" data-adm-cargando="">
          Cargando el roster…
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
    { clave: 'activas', rotulo: 'Personas activas', valor: k.activas },
    { clave: 'loan-officers', rotulo: 'Loan Officers', valor: k.loanOfficers },
    { clave: 'nppm', rotulo: 'NPPM', valor: k.nppm },
    { clave: 'colombia', rotulo: 'Colombia', valor: k.colombia },
    { clave: 'usa', rotulo: 'USA', valor: k.usa },
    { clave: 'co-us', rotulo: 'CO/US', valor: k.coUs },
    { clave: 'inactivas', rotulo: 'Inactivas', valor: k.inactivas },
  ];

  return (
    <div className="hub-container adm-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Roster</h1>
          <p className="page-head__subtitle">
            {k.activas} personas activas en {branches.length} branches
          </p>
        </div>
        <p className="adm-sello" data-adm-sello="">
          Actualizado {shortDateTime(actualizado.roster) ?? 'sin registro'}
        </p>
      </div>

      {/*
        ⚠ Los avisos son distintos entre si a proposito. Con RLS, una tabla sin
        politica devuelve CERO FILAS y no un error, asi que "no tengo permiso",
        "todavia no hay datos" y "fallo la lectura" se ven igual si no se separan.
      */}
      {diagnostics.rosterError && (
        <div className="bp-notice bp-notice--warn adm-notice">
          No se pudo leer <code>org.roster_current</code>: {diagnostics.rosterError}
        </div>
      )}
      {!diagnostics.rosterError && diagnostics.rosterRows === 0 && (
        <div className="bp-notice bp-notice--warn adm-notice">
          <b>El roster viene vacío.</b> La lectura de <code>org.roster_current</code> no dio error y devolvió cero
          filas, que es lo que se ve cuando la tabla tiene <code>GRANT</code> pero ninguna política de RLS le aplica a
          esta sesión. No es lo mismo que una tabla vacía.
        </div>
      )}
      {diagnostics.reclutaError && (
        <div className="bp-notice bp-notice--warn adm-notice">
          No se pudo leer <code>activity_report.future_loan_officer</code>: {diagnostics.reclutaError}
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
                    {/*
                      La fecha de ingreso donde existe, y un guion donde no. El
                      guion no es un aviso ni un mensaje: es el valor ausente.
                      Ver la nota de la cabecera -- nunca se rellena con
                      `first_seen_at`.
                    */}
                    <span className="adm-persona__ingreso">{shortDate(p.date_started) ?? SIN_BRANCH}</span>
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
          <h2 className="adm-h">En proceso de contratación</h2>
          <span className="adm-muted" data-adm-en-proceso="">
            {enProceso} en {reclutamiento.length} grupos ·{' '}
            {shortDateTime(actualizado.reclutamiento) ?? 'sin registro'}
          </span>
        </div>

        {/*
          Se dice una vez, acá arriba, y no al lado de cada persona: las dos
          fechas miden cosas distintas y los grupos no se suman entre si.
        */}
        <p className="adm-hint">
          <b>Los grupos no se suman.</b> Los de RRHH tienen <b>fecha de inicio</b>: empiezan ese día. Los de
          Salesforce tienen <b>cierre esperado</b>, que es la fecha en que se espera cerrar la oportunidad, no el día
          que alguien entra.
        </p>

        {reclutamiento.length === 0 && !diagnostics.reclutaError && (
          <p className="adm-muted">No hay nadie en proceso de contratación.</p>
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
          <h2 className="adm-h">Cambios detectados entre cargas</h2>
        </div>
        {diagnostics.changeError && (
          <div className="bp-notice bp-notice--warn adm-notice">
            No se pudo leer <code>org.roster_change_log</code>: {diagnostics.changeError}
          </div>
        )}
        {!diagnostics.changeError && data.changes.length === 0 && (
          <p className="adm-muted">Ningún cambio registrado todavía.</p>
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
                <span className="adm-muted">revisado por {c.acknowledged_by ?? '—'}</span>
              ) : (
                <button type="button" onClick={() => marcar(c.id)} disabled={saving === c.id}>
                  {saving === c.id ? 'Guardando…' : 'Marcar como revisado'}
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
        El branch es el del <b>roster</b> —dónde RRHH tiene asignada a la persona—, no dónde produce. Los Loan
        Officers se cuentan por quién produce y no por el cargo. Las {k.inactivas} personas inactivas se conservan y no
        se listan acá.
      </p>
      {/*
        Por qué falta la fecha de ingreso en la mayoría de USA. Va acá, una vez,
        y no al lado de cada guion: son 64 filas y sería el mismo texto 64 veces.
      */}
      <p className="adm-foot">
        La <b>fecha de ingreso</b> sale del archivo de RRHH, y hoy sólo la trae el de Colombia: la tienen{' '}
        {k.conFechaDeIngreso} de las {k.activas} personas activas. Las cuatro de <b>CO/US</b> la tienen porque vienen
        de ese mismo archivo, así que se ven distintas del resto de USA.
      </p>
    </div>
  );
}
