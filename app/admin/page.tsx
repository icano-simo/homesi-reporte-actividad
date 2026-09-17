'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeChange,
  loadAdminData,
  shortDate,
  shortDateTime,
  SIN_BRANCH,
  type AdminData,
} from '@/lib/admin/loadRoster';

/**
 * ============================================================================
 * ADMIN — el roster, por cargo (etapa ADM1)
 * ============================================================================
 *
 * Reemplaza la pantalla agrupada por branch. Ahora es un roster con
 * indicadores, secciones por cargo, y una seccion aparte de contrataciones.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NINGUN TEXTO AL LADO DE UNA PERSONA
 * ---------------------------------------------------------------------------
 * Pedido explicito, y es la regla que gobierna el marcado de abajo: una fila de
 * persona lleva EL NOMBRE Y EL BRANCH, y nada mas. Sin etiquetas de estado, sin
 * avisos, sin `title` que explique algo, sin marcas de NPPM ni de "lo fijo una
 * persona". El cargo lo dice el encabezado de su seccion.
 *
 * La version anterior tenia seis marcas distintas colgando de los nombres
 * --`user_addition`, `has_override`, NPPM, los dos `set_by_hand`, el estado--,
 * cada una con su `title` explicativo. Las seis se fueron.
 *
 * Lo que la pantalla necesite decir se dice UNA vez, en el encabezado de su
 * seccion o en el pie, donde no le cuelga a nadie.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL ROSTER VIVO ES `is_active`, Y LAS BAJAS SE CONSERVAN
 * ---------------------------------------------------------------------------
 * Las 4 personas inactivas no se listan: `left_detected_at` guarda cuando se
 * detecto que dejaron de venir en el archivo, asi que el dato no se pierde por
 * no mostrarlo. El indicador las cuenta, que es como se ven sin que aparezcan
 * mezcladas con quien si trabaja. Una seccion aparte para ellas esta a un
 * `filter` de distancia y no se hizo porque no esta decidido.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL BRANCH DE ESTA PANTALLA ES EL DEL ROSTER
 * ---------------------------------------------------------------------------
 * Donde RRHH tiene asignada a la persona, no donde produce. Se dice en el pie,
 * una vez -- no al lado de cada branch, que seria exactamente lo que esta
 * pantalla no hace.
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

  const { indicadores: k, diagnostics, secciones, proximosIngresos, actualizado } = data;
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

  /*
   * Los indicadores. Todos sobre las ACTIVAS salvo el ultimo, y el encuadre va
   * escrito en el rotulo: "activas" no es decoracion, es lo que hace que los
   * numeros se puedan sumar sin que el lector tenga que adivinar cual incluye
   * las bajas. Ver la nota de `Indicadores` en el loader.
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
            {k.activas} personas activas en {secciones.length} cargos
          </p>
        </div>
        <p className="adm-sello" data-adm-sello="">
          Actualizado {shortDateTime(actualizado.roster) ?? 'sin registro'}
          {actualizado.contrataciones && actualizado.contrataciones.slice(0, 10) !== actualizado.roster?.slice(0, 10)
            ? ` · contrataciones ${shortDateTime(actualizado.contrataciones)}`
            : ''}
        </p>
      </div>

      {/*
        ⚠ Los avisos de abajo son distintos entre si a proposito. Con RLS, una
        tabla sin politica devuelve CERO FILAS y no un error, asi que "no tengo
        permiso", "todavia no hay datos" y "fallo la lectura" se ven igual en la
        pantalla si uno no los separa.
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
      {diagnostics.hiringError && (
        <div className="bp-notice bp-notice--warn adm-notice">
          No se pudo leer <code>org.hiring_tracking</code>: {diagnostics.hiringError}
        </div>
      )}

      {/* ── 1. Los indicadores ────────────────────────────────────────── */}
      <section className="adm-block">
        <ul className="adm-kpis" data-adm-kpis="">
          {tarjetas.map((t) => (
            <li className="adm-kpi" key={t.clave} data-adm-kpi={t.clave}>
              <span className="adm-kpi__valor">{t.valor}</span>
              <span className="adm-kpi__rotulo">{t.rotulo}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 2. El roster, por cargo ───────────────────────────────────── */}
      <section className="adm-block">
        {secciones.map((s) => (
          <div className="adm-seccion" key={s.cargo} data-adm-seccion={s.cargo}>
            <h2 className="adm-seccion__head">
              <span className="adm-seccion__cargo">{s.cargo}</span>
              <span className="adm-seccion__n">{s.people.length}</span>
            </h2>
            <ul className="adm-personas">
              {s.people.map((p) => (
                <li className="adm-persona" key={p.person_code} data-adm-persona={p.person_code}>
                  <span className="adm-persona__nombre">{p.display_name}</span>
                  <span className="adm-persona__branch">{p.branch_code?.trim() || SIN_BRANCH}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ── 3. Contrataciones ─────────────────────────────────────────── */}
      <section className="adm-block">
        <div className="adm-seccion" data-adm-seccion="__ingresos">
          <h2 className="adm-seccion__head">
            <span className="adm-seccion__cargo">Próximos ingresos</span>
            <span className="adm-seccion__n">{proximosIngresos.length}</span>
          </h2>
          {proximosIngresos.length === 0 ? (
            <p className="adm-muted">
              {diagnostics.hiringError
                ? 'No se pudo leer el tablero de contrataciones.'
                : 'El tablero de contrataciones no tiene ingresos próximos.'}
            </p>
          ) : (
            <ul className="adm-personas">
              {proximosIngresos.map((h) => (
                <li className="adm-ingreso" key={h.person_code ?? h.nombre} data-adm-ingreso="">
                  <span className="adm-persona__nombre">{h.nombre}</span>
                  <span className="adm-ingreso__cargo">{h.cargo?.trim() || SIN_BRANCH}</span>
                  <span className="adm-persona__branch">{h.branch_en_el_tablero?.trim() || SIN_BRANCH}</span>
                </li>
              ))}
            </ul>
          )}
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
    </div>
  );
}
