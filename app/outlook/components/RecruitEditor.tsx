'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { BranchRecruit } from '@/lib/outlook/loadData';
import { STAGE_LABEL } from '@/lib/outlook/recruitment';
import { saveRecruitLink, saveRecruitProjection } from '@/lib/outlook/save';

/**
 * ============================================================================
 * EL EDITOR DE UNA PROYECCIÓN DE RECLUTAMIENTO — etapa OL20
 * ============================================================================
 *
 * Hace dos cosas con el mismo formulario, porque son la misma fila: editar la
 * proyección de alguien que vino de la fuente, y CREAR una a mano para alguien
 * que no está en ninguna. La diferencia es sólo la `identity` --
 * `future:<id_fuente>` contra `manual:<uuid>` -- y de ahí sale el `source`.
 *
 * ⚠ CREAR A MANO NO TOCA EL ROSTER. Escribe en `outlook.recruitment_projection`
 * y nada más. `org.dim_employee` y `org.roster_current` los escribe el sync, no
 * esta pantalla: una persona inventada ahí aparecería como empleada real en
 * Business Plan y en Commercial Activity.
 *
 * ⚠ DOS FECHAS Y NO UNA, y hace falta que sean dos:
 *
 *   Start date      cuándo entra. Precargada de `fecha_inicio` cuando existe --
 *                   sólo la traen los 2 de `hr_pipeline`; los 13 de Salesforce
 *                   no tienen ninguna, así que sin este campo no habría de dónde
 *                   sacarla.
 *   Producing from  desde qué mes cuenta para el presupuesto. Puede ser
 *                   POSTERIOR a la de entrada: entrar y producir no son el mismo
 *                   mes, y alguien que empieza el 14 de septiembre no produce un
 *                   septiembre.
 *
 * ⚠ NUNCA SE USA `close_date` COMO FECHA DE ENTRADA. Es cuándo se cerró el
 * reclutamiento, no cuándo empieza a trabajar; usarla adelantaría la producción
 * de todos. Se muestra, porque explica la etapa, pero no se copia a ningún
 * campo.
 *
 * ⚠ Y EL BRANCH ES EDITABLE. `Recruitment` es un marcador de "todavía no se
 * sabe", no un lugar: cuando se sepa a dónde va alguien, se corrige acá sin
 * esperar a que la fuente lo traiga.
 *
 * ⚠ NO HAY CAMPO `Role`, Y ES A PROPÓSITO. El brief lo pedía, pero hoy nada lo
 * lee: un recluta NPPM tendría que proyectar bajo NPPM --que se abre por
 * realtor y no por persona-- y eso no existe. Un desplegable que no cambia
 * ningún número es peor que un campo que falta: se ve, se usa, y no pasa nada.
 * Toda alta a mano se guarda como `loan_officer`.
 *
 * Usa el mismo `Modal` y las mismas clases que `StrategyEditor` -- `ol-editor`,
 * `bp-form__label`, `bp-btn` -- porque es el mismo tipo de decisión y tiene que
 * verse igual. Inventar clases nuevas habría dado un panel sin estilos.
 */
/**
 * El marcador de "todavía no se sabe a qué branch va".
 *
 * ⚠ ES UNA CONSTANTE Y NO UN LITERAL SUELTO desde OL21: el bug del desplegable
 * salió justo de tenerlo escrito en dos lados --acá como valor por defecto y en
 * la vista como el código que se filtraba de la lista-- así que uno de los dos
 * podía moverse sin el otro. Y se movió.
 */
export const RECRUITMENT_BRANCH = 'Recruitment';

/**
 * El balde de `classifyBranch` para un `OrgID` que no está en el roster oficial.
 *
 * ⚠ NO ES UN DESTINO ASIGNABLE, y por eso el desplegable lo saca. Aparece como
 * fila en la tabla porque tiene cierres reales --los 2 del branch 150-- pero
 * "mandar a alguien a Branch Out of Division" no significa nada: es la etiqueta
 * de un branch que la división no reconoce, no un lugar donde trabajar.
 *
 * Se detectó ofreciéndolo: el `select` de OL21 pasó a listar `data.branches`
 * entero y este entró con los demás.
 */
export const OUT_OF_DIVISION_BRANCH = 'Branch Out of Division';

/**
 * Los branches que se pueden ELEGIR como destino, en el orden en que se ofrecen.
 *
 * ⚠ `Recruitment` PRIMERO Y SIEMPRE PRESENTE: es el valor por defecto del
 * formulario, y un valor por defecto que no está entre las opciones es la mitad
 * del bug que OL21 arregló. La otra mitad era el `datalist`.
 */
export function branchOptions(codes: string[]): string[] {
  return [
    RECRUITMENT_BRANCH,
    ...codes.filter((c) => c !== RECRUITMENT_BRANCH && c !== OUT_OF_DIVISION_BRANCH).sort(),
  ];
}

export default function RecruitEditor({
  recruit,
  branches,
  roster,
  currentMonth,
  onClose,
  onSaved,
}: {
  /** `null` = alta a mano: el mismo formulario, en blanco. */
  recruit: BranchRecruit | null;
  /**
   * TODOS los branches que ofrece el desplegable, `Recruitment` incluido y
   * primero. Ver la nota del `select`: excluirlo de esta lista era la mitad del
   * bug que OL21 arregla.
   */
  branches: string[];
  /**
   * El roster, para vincular a mano. Sin ranking y sin "candidatos sugeridos":
   * ver la nota del selector.
   */
  roster: { employeeKey: number; name: string; branchCode: string }[];
  /** Para precargar el mes de producción de un alta a mano: el que viene. */
  currentMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const esAlta = recruit === null;
  const [name, setName] = useState(recruit?.personName ?? '');
  const [branch, setBranch] = useState(recruit?.branchCodeActual ?? RECRUITMENT_BRANCH);
  const [startDate, setStartDate] = useState(recruit?.startDate ?? '');
  const [producingFrom, setProducingFrom] = useState(recruit?.producingFrom ?? mesSiguiente(currentMonth));
  /*
   * ⚠ EL BENCHMARK VIVE COMO TEXTO mientras se edita, y no como número: un
   * `number | null` no puede representar "el campo está vacío porque lo estoy
   * borrando". Vacío se guarda como `null`, que es "nadie fijó cuánto se
   * espera"; un 0 escrito a mano se guarda como 0, que es "no se espera que
   * produzca". Son dos cosas distintas y el editor tiene que poder decir las dos.
   */
  const [benchmark, setBenchmark] = useState(
    recruit && recruit.monthlyBenchmark !== null ? String(recruit.monthlyBenchmark) : ''
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numero = benchmark.trim() === '' ? null : Number(benchmark);
  const invalido = numero !== null && (!Number.isFinite(numero) || numero < 0);

  async function save() {
    if (invalido) {
      setError('Monthly production has to be a number, or empty if nobody has decided yet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      /*
       * ⚠ LA `identity` DE UN ALTA SE INVENTA UNA SOLA VEZ, acá, y no se deriva
       * del nombre. Hay dos `Jose Flores` distintos entre los quince de hoy, así
       * que un `manual:<nombre>` uniría a dos personas o partiría a una sola sin
       * que nada lo dijera. Un uuid no dice nada de nadie, que es la propiedad
       * que se necesita.
       */
      const identity = recruit?.identity ?? 'manual:' + crypto.randomUUID();
      await saveRecruitProjection({
        identity,
        source: identity.startsWith('manual:') ? 'manual' : 'future_loan_officer',
        personName: name,
        role: recruit?.role ?? 'loan_officer',
        branchCode: branch,
        startDate: startDate.trim() === '' ? null : startDate,
        producingFrom,
        monthlyBenchmark: numero,
        nmls: recruit?.nmls ?? null,
        note: note.trim() === '' ? null : note.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Vincular o desvincular. `key === null` desvincula, y es una fila nueva. */
  async function link(key: number | null) {
    if (!recruit) return;
    setBusy(true);
    setError(null);
    try {
      await saveRecruitLink({
        identity: recruit.identity,
        employeeKey: key,
        note: key === null ? 'Unlinked from the branch view.' : 'Linked from the branch view.',
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={esAlta ? 'Add someone in hiring' : `${recruit.personName} — ${STAGE_LABEL[recruit.stage]}`}
      onClose={onClose}
    >
      <div className="ol-editor">
        {esAlta && (
          <p className="ol-editor__hint">
            For someone who is being hired and is not in any source yet. This does <b>not</b> add them to the roster —
            it only projects what they are expected to produce, and it disappears from the budget once they show up on
            the roster and get linked.
          </p>
        )}

        {/*
          El `close_date` se muestra y no se edita: viene de la fuente, explica
          la etapa, y es lo que decide --por fecha-- si un `probable` sigue
          siendo pipeline o pasó a caso sin resolver.
        */}
        {recruit?.closeDate && (
          <p className="ol-editor__hint">
            Recruitment closed <b>{recruit.closeDate}</b>. That date comes from the source and is not edited here.
          </p>
        )}

        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="rec-name">
              Name
            </label>
            <input id="rec-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-branch">
              Branch
            </label>
            {/*
              ══════════════════════════════════════════════════════════════
              ⚠ UN `select`, Y ANTES ERA UN `input` CON `datalist` — etapa OL21
              ══════════════════════════════════════════════════════════════

              El bug que arregla, y el mecanismo, porque no es evidente: un
              `datalist` FILTRA sus opciones por lo que el campo tiene escrito.
              El campo nacía con `Recruitment`, y `Recruitment` no estaba entre
              las opciones --se lo filtraba a propósito, para no ofrecer "no se
              sabe" como destino--, así que el filtro no dejaba pasar ninguna:
              medido, 0 opciones visibles de 16. El desplegable parecía ofrecer
              sólo el `Recruitment` que ya tenía puesto.

              Dos defectos que se tapaban entre sí: el valor por defecto no
              estaba en la lista, y un `datalist` con un valor que no matchea no
              muestra nada. Un `select` no puede tener ninguno de los dos: siempre
              muestra todas sus opciones, y un valor fuera de la lista no es
              representable.

              ⚠ Y `Recruitment` AHORA SÍ ES UNA OPCIÓN. Sigue siendo el valor por
              defecto --es donde cae quien no tiene branch asignado-- y por eso
              tiene que poder elegirse de vuelta después de cambiarlo.
            */}
            <select id="rec-branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b === RECRUITMENT_BRANCH ? `${b} — not assigned yet` : b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ol-editor__row">
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-start">
              Start date
            </label>
            <input
              id="rec-start"
              type="date"
              className="field"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-from">
              Producing from
            </label>
            <input
              id="rec-from"
              type="month"
              className="field"
              value={producingFrom}
              onChange={(e) => setProducingFrom(e.target.value)}
            />
          </div>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-bench">
              Monthly production
            </label>
            <input
              id="rec-bench"
              type="text"
              inputMode="decimal"
              className="field ol-editor__num"
              value={benchmark}
              placeholder="—"
              onChange={(e) => setBenchmark(e.target.value)}
            />
          </div>
        </div>

        {/*
          La distinción entre vacío y cero, dicha donde se decide: es la que
          hace que una fila sin números se pueda leer sin preguntar.
        */}
        <p className="ol-editor__hint">
          Leave <b>Monthly production</b> empty if nobody has decided yet — the row shows no projection and says why. A
          zero means something different: that no production is expected. And a new hire ramps up — 25% of this the
          first month, 50% the second, 100% from the third.
        </p>

        {/*
          ══════════════════════════════════════════════════════════════════
          ⚠ EL VÍNCULO CON EL ROSTER, QUE ES LO QUE EVITA EL DOBLE CONTEO
          ══════════════════════════════════════════════════════════════════

          Una proyección vinculada deja de sumar: desde que la persona está en
          el roster, es el roster el que la proyecta. Sin esto, el mes que
          alguien entra su producción se cuenta dos veces -- una por su fila
          real y otra por esta.

          ⚠ Y ES UNA LISTA ALFABÉTICA, NO UNA LISTA DE CANDIDATOS SUGERIDOS.
          Medido contra los datos de hoy: de los 15 en proceso, `employee_alias`
          propone 0 y el nombre exacto contra `dim_employee` propone 0. Lo único
          que propone algo es el apellido, y las tres propuestas que da son de
          personas equivocadas -- Jose Flores contra Kelvin Flores, Jonathan
          Osorio contra Giovanni Osorio, Fidel Rodriguez contra tres Rodriguez
          distintos. Poner esos tres nombres con un botón al lado sería invitar
          al clic errado; es la misma trampa que el encabezado de `aliasIndex`
          ya documenta con Juseth Castro y July Castro.

          Así que se ordena por nombre y decide una persona. El NMLS sigue
          siendo el único vínculo que la app hace sola, porque es un registro
          nacional y un match ES identidad.
        */}
        {!esAlta && recruit.linkedEmployeeKey === null && (
          <div className="ol-editor__row">
            <div className="bp-form__field ol-editor__grow">
              <label className="bp-form__label" htmlFor="rec-link">
                Already on the roster? Link them
              </label>
              <select
                id="rec-link"
                className="field"
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value) void link(Number(e.target.value));
                }}
              >
                <option value="">Not on the roster yet</option>
                {roster.map((p) => (
                  <option key={p.employeeKey} value={p.employeeKey}>
                    {p.name} — {p.branchCode}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {!esAlta && recruit.linkedEmployeeKey !== null && (
          <p className="ol-editor__hint">
            Linked to{' '}
            <b>{roster.find((p) => p.employeeKey === recruit.linkedEmployeeKey)?.name ?? 'a roster employee'}</b>
            {recruit.linkedByNmls ? ' by NMLS, which is a national registry number and therefore an exact match' : ''},
            so this projection adds nothing: from here on the roster projects them.
          </p>
        )}

        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="rec-note">
              Why (optional)
            </label>
            <input id="rec-note" type="text" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {/*
            Desvincular se ofrece sólo cuando el vínculo lo puso una persona. El
            del NMLS no: es exacto, así que "desvincular" ahí sería decir que el
            registro nacional se equivocó. Si de verdad se equivocó, se arregla
            en el NMLS y no acá.
          */}
          {!esAlta && recruit.linkedEmployeeKey !== null && !recruit.linkedByNmls && (
            <button type="button" className="bp-btn bp-btn--small" onClick={() => void link(null)} disabled={busy}>
              Unlink
            </button>
          )}
          <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={busy || invalido}>
            {busy ? '…' : esAlta ? 'Add' : 'Save'}
          </button>
        </div>

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * El mes que viene, para precargar un alta.
 *
 * ⚠ NUNCA EL MES EN CURSO. `projectRecruit` no toca el mes actual --su
 * pronóstico ya está cerrado y sale del pipeline real-- así que un alta con
 * `producingFrom` igual al mes de hoy nacería vencida y sin sumar nada, que es
 * un formulario que se llena para que no pase nada.
 */
function mesSiguiente(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
