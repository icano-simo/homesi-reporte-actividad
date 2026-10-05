'use client';

import { useCallback, useEffect, useState } from 'react';
/* Las reglas de los dos grupos de prioridad — etapa ADM9. Las mismas que Outlook. */
import {
  GROUP_LABEL,
  DATE_LABEL,
  PERSON_LABEL,
  priorityDate,
  willNotProduce,
} from '@/lib/recruitment/prioridades';
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
 * ⚠ LA FECHA DE INGRESO SE MUESTRA DONDE EXISTE, Y NO SE DEDUCE
 * ---------------------------------------------------------------------------
 * Medido el 2026-10-02, al rebasar esta rama sobre el Roster movido: la tienen
 * 45 de las 112 activas, y CERO de las 65 de USA. No es que el sync no la
 * mapee: el archivo de USA no la trae, porque son dos sistemas de RRHH
 * distintos.
 *
 * ⚠ La nota decía «45 de 111» y «64 de USA», medidos el 2026-09-18. El roster
 * creció en una persona entre las dos fechas y los números de la nota
 * envejecieron sin que nadie los tocara. El del PIE de la pantalla no envejece
 * porque sale del dato en cada carga; éste es prosa y hay que re-medirlo.
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

  /* `reclutamiento` ya no se desestructura: lo consumía la sección que ADM10
     sacó. El loader lo sigue trayendo -- ver la nota de abajo. */
  const { indicadores: k, diagnostics, branches, prioridades, actualizado } = data;

  /*
   * El día de hoy en UTC, para marcar las fechas vencidas. Se calcula una vez
   * acá y se pasa a `priorityDate`: si cada fila leyera el reloj por su cuenta,
   * una lista larga podría quedar partida por un cambio de día a mitad del
   * render.
   */
  const hoy = new Date().toISOString().slice(0, 10);
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
      {/* ── 3a. A quién mirar primero ──────────────────────────────────── */}
      {/*
        ⚠ VA ANTES DEL BLOQUE DE ABAJO, y el orden es la mitad del punto: éste
        contesta "a quién miro hoy" y aquél "cómo está cada caso". Al revés, lo
        prioritario queda debajo de una grilla de cinco grupos.

        Los dos grupos NO se suman entre sí ni con los de abajo: son las mismas
        personas vistas con otro criterio. Por eso cada uno lleva su propio
        conteo y no hay un total.
      */}
      <section className="adm-block">
        <div className="adm-head">
          <h2 className="adm-h">Who to look at first</h2>
          <span className="adm-muted">
            {prioridades.salesforce_high.length + prioridades.hiring_process.length} across 2 groups
          </span>
        </div>

        <div className="adm-grid">
          {(['salesforce_high', 'hiring_process'] as const).map((grupo) => {
            const filas = prioridades[grupo];
            return (
              <div className="tbl-card adm-bcard adm-grupo" key={grupo} data-adm-prioridad={grupo}>
                <div className="tbl-card__head">
                  <span className="tbl-card__title adm-grupo__titulo">{GROUP_LABEL[grupo]}</span>
                  <span className="adm-bcard__n">{filas.length}</span>
                </div>
                {/*
                  Las DOS columnas que cambian de significado según el grupo,
                  dichas juntas: quién es la persona de la derecha y qué fecha
                  es la de la punta. Ver `PERSON_LABEL` y `DATE_LABEL`.
                */}
                <p className="adm-grupo__que">
                  {PERSON_LABEL[grupo]} · {DATE_LABEL[grupo]}
                </p>

                {/*
                  ⚠ VACÍO SE DICE, NO SE DESAPARECE. El grupo prioritario puede
                  quedar sin nadie y eso es correcto: significa que no hay nadie
                  en negociación con importancia alta. Una sección ausente se lee
                  como "esto no existe"; una vacía con su motivo, como "hoy no
                  hay nadie", que es la verdad.
                */}
                {filas.length === 0 ? (
                  <p className="adm-muted">
                    {grupo === 'salesforce_high'
                      ? 'Nobody is in a high-importance negotiation right now.'
                      : 'Nobody is in the hiring process right now.'}
                  </p>
                ) : (
                  <ul className="adm-personas">
                    {filas.map((r) => {
                      const f = priorityDate(r, grupo, hoy);
                      return (
                        <li className="adm-recluta" key={r.nombre} data-adm-prioridad-fila="">
                          <span className="adm-persona__nombre">{r.nombre}</span>
                          <span className="adm-persona__branch">{r.branchCode?.trim() || SIN_BRANCH}</span>
                          <span className="adm-persona__cargo">{r.recruiter?.trim() || SIN_BRANCH}</span>
                          <span className="adm-recluta__fecha">
                            {shortDate(f.date) ?? SIN_BRANCH}
                            {/*
                              Una fecha vencida es un DATO, no un error: una
                              negociación que no avanzó, o alguien que debía
                              haber entrado y no figura en el roster. Sin
                              marcarla, las dos se leen como si estuvieran por
                              pasar.
                            */}
                            {f.overdue ? <span className="adm-recluta__hace">overdue</span> : null}
                          </span>
                          {/*
                            Entra a la empresa pero no va a originar. Se rotula
                            en vez de sacarse: quien sume esta sección esperando
                            futuros originadores lo contaría de más.
                          */}
                          {willNotProduce(r) ? (
                            <span className="adm-persona__cargo">will not originate</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/*
          ⚠ LOS QUE QUEDAN FUERA, Y POR QUÉ. Sobre todo los que nadie triagó: la
          respuesta a "¿y por qué no está fulano?" es que falta que un reclutador
          les fije importancia, NO que se los descartó. Son dos cosas distintas y
          sólo una es accionable.
        */}
        {prioridades.excluded.length > 0 && (
          <p className="adm-hint">
            <b>{prioridades.excluded.length} not in either group.</b>{' '}
            {prioridades.excluded.filter((e) => e.reason === 'no_prioritario').length} triaged as low or medium,{' '}
            {prioridades.excluded.filter((e) => e.reason === 'fuera_de_negociacion').length} no longer in negotiation,
            and{' '}
            <b>
              {prioridades.excluded.filter((e) => e.reason === 'sin_triage').length} nobody has triaged yet — those are
              not low priority, they are waiting for a recruiter to set one.
            </b>
          </p>
        )}
      </section>

      {/*
        ADVERTENCIA: ACA HABIA UNA TERCERA SECCION, «Hiring in progress», Y SE
        FUE EN ADM10.

        Agrupaba las MISMAS filas por `origen + confianza` --hr confirmado,
        salesforce ganado, probable, tentative-- o sea las 14 de Salesforce sin
        filtrar por importancia, mezcladas con las 7 del tablero.

        Eso es CONFIANZA, que es otra pregunta: cuan firme es cada caso. Nadie
        la pidio, y al lado de los dos grupos de prioridad convertia la pantalla
        en tres listas de las mismas personas con tres criterios distintos.

        La pantalla contesta UNA pregunta: a quien hay que mirar primero. Las
        dos reglas de arriba son esa respuesta.
      */}

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
      {/*
        Por qué falta la fecha de ingreso en la mayoría de USA. Va acá, una vez,
        y no al lado de cada guion: son 64 filas y sería el mismo texto 64 veces.
      */}
      <p className="adm-foot">
        The <b>start date</b> comes from the HR file, and today only the Colombian one carries it: {k.conFechaDeIngreso}{' '}
        of the {k.activas} active people have it. The four in <b>CO/US</b> have it because they come from that same
        file, so they look different from the rest of USA.
      </p>
    </div>
  );
}
