'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { cumulativeDays, type Funnel, type FunnelCategory, type FunnelNode, type NodeMilestone } from '@/lib/business-plan/funnels';
import type { SupportPerson } from '@/lib/business-plan/useFunnelLibrary';
import Modal from '../components/Modal';
import IconPicker from './IconPicker';

/**
 * ============================================================================
 * FORMULARIOS DE LA BIBLIOTECA — alta y edición de los tres niveles
 * ============================================================================
 *
 * Etapa BP13 — ARCHIVO NUEVO.
 *
 * Los tres formularios viven acá y no dentro de `page.tsx` porque esa página ya
 * carga tres pestañas y el constructor: sumarle tres formularios la volvería
 * ilegible.
 *
 * Cada uno sirve para crear Y para editar -- son el mismo conjunto de campos, y
 * duplicarlos sólo garantizaría que se desincronicen cuando se agregue uno.
 */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="bp-form__field">
      <span className="bp-form__label">{label}</span>
      {children}
    </label>
  );
}

/* ─────────────────────────────── Funnel ────────────────────────────────── */

export interface FunnelDraft {
  name: string;
  category: FunnelCategory;
  description: string;
  duration_weeks: string;
  icon: string;
}

export function FunnelForm({
  initial,
  onSave,
  onClose,
  busy,
}: {
  initial: Funnel | null;
  onSave: (d: FunnelDraft) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<FunnelDraft>({
    name: initial?.name ?? '',
    category: initial?.category ?? 'core',
    description: initial?.description ?? '',
    duration_weeks: initial?.duration_weeks == null ? '' : String(initial.duration_weeks),
    icon: initial?.icon ?? '',
  });
  const set = <K extends keyof FunnelDraft>(k: K, v: FunnelDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  return (
    <Modal title={initial ? 'Edit funnel' : 'New funnel'} onClose={onClose}>
      <div className="bp-form">
        <Field label="Name">
          <input className="field" value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Category">
          <select className="field" value={d.category} onChange={(e) => set('category', e.target.value as FunnelCategory)}>
            {/* Capitalizado sólo al mostrar; el `value` va en minúscula. */}
            <option value="core">Core</option>
            <option value="growth">Growth</option>
          </select>
        </Field>
        <Field label="Duration (weeks)">
          <input type="number" min="1" className="field" value={d.duration_weeks} onChange={(e) => set('duration_weeks', e.target.value)} />
        </Field>
        {/* Selector visual: escribir "trending" de memoria no era razonable. */}
        <Field label="Icon">
          <IconPicker value={d.icon} onChange={(name) => set('icon', name)} />
        </Field>
        <Field label="Description">
          <textarea className="field bp-form__area" value={d.description} onChange={(e) => set('description', e.target.value)} rows={3} />
        </Field>
        <div className="bp-form__actions">
          <button type="button" className="bp-btn bp-btn--primary" disabled={busy || d.name.trim() === ''} onClick={() => onSave(d)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="bp-linkish" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────── Nodo ─────────────────────────────────── */

export interface NodeDraft {
  name: string;
  description: string;
  icon: string;
  owners: number[];
  funnels: number[];
}

export function NodeForm({
  initial,
  initialOwners,
  initialFunnels,
  funnels,
  support,
  onSave,
  onClose,
  busy,
}: {
  initial: FunnelNode | null;
  initialOwners: number[];
  initialFunnels: number[];
  funnels: Funnel[];
  support: SupportPerson[];
  onSave: (d: NodeDraft) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<NodeDraft>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    icon: initial?.icon ?? '',
    owners: initialOwners,
    funnels: initialFunnels,
  });
  const toggle = (k: 'owners' | 'funnels', v: number) =>
    setD((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));

  return (
    <Modal title={initial ? 'Edit node' : 'New node'} onClose={onClose}>
      <div className="bp-form">
        <Field label="Name">
          <input className="field" value={d.name} onChange={(e) => setD((p) => ({ ...p, name: e.target.value }))} autoFocus />
        </Field>
        <Field label="Icon">
          <IconPicker value={d.icon} onChange={(name) => setD((p) => ({ ...p, icon: name }))} />
        </Field>
        <Field label="Description">
          <textarea
            className="field bp-form__area"
            rows={2}
            value={d.description}
            onChange={(e) => setD((p) => ({ ...p, description: e.target.value }))}
          />
        </Field>

        {/* Varios responsables por nodo: por eso casillas y no un desplegable. */}
        <Field label="Accountable people">
          <div className="bp-form__checks">
            {support.map((s) => (
              <label key={s.employee_key} className="bp-form__check">
                <input type="checkbox" checked={d.owners.includes(s.employee_key)} onChange={() => toggle('owners', s.employee_key)} />
                {s.full_name}
              </label>
            ))}
          </div>
        </Field>

        {/*
          Un nodo puede estar en VARIOS funnels, y desde acá se arma esa
          relación -- es el otro lado del constructor de secuencia. Sin esto,
          la única forma de vincular un nodo era abrir cada funnel por separado.
        */}
        <Field label="Used in funnels">
          <div className="bp-form__checks">
            {funnels.map((f) => (
              <label key={f.funnel_key} className="bp-form__check">
                <input type="checkbox" checked={d.funnels.includes(f.funnel_key)} onChange={() => toggle('funnels', f.funnel_key)} />
                {f.name}
              </label>
            ))}
          </div>
        </Field>

        <div className="bp-form__actions">
          <button type="button" className="bp-btn bp-btn--primary" disabled={busy || d.name.trim() === ''} onClick={() => onSave(d)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="bp-linkish" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ────────────────────────────── Milestone ──────────────────────────────── */

export interface MilestoneDraft {
  title: string;
  accountable_employee_key: string;
  sla_days: string;
  resource_url: string;
  position: string;
}

/** Un step del mismo nodo, para calcular en que dia cae cada uno -- BP40. */
export interface StepSibling {
  milestone_key: number;
  title: string;
  sla_days: number | null;
  position: number;
}

export function MilestoneForm({
  initial,
  support,
  siblings,
  onSave,
  onClose,
  busy,
}: {
  initial: NodeMilestone | null;
  /**
   * Los OTROS steps del nodo, en orden, para dibujar en que dia cae cada uno
   * con el delta que se esta escribiendo -- etapa BP40.
   *
   * Va como prop y no se lee de un hook: este formulario no sabe de donde
   * vienen los datos, y es el mismo que se usa para crear y para editar.
   */
  siblings: StepSibling[];
  support: SupportPerson[];
  onSave: (d: MilestoneDraft) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<MilestoneDraft>({
    title: initial?.title ?? '',
    accountable_employee_key: initial?.accountable_employee_key == null ? '' : String(initial.accountable_employee_key),
    sla_days: initial?.sla_days == null ? '' : String(initial.sla_days),
    resource_url: initial?.resource_url ?? '',
    position: String(initial?.position ?? 1),
  });
  const set = <K extends keyof MilestoneDraft>(k: K, v: MilestoneDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * EN QUE DIA CAE CADA STEP CON LO QUE SE ESTA ESCRIBIENDO -- etapa BP40
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Se recalcula en cada tecla, sobre la lista del nodo con ESTE step ya
   * sustituido por el borrador. Es la razon de ser del bloque: correr un step
   * corre a todos los que siguen, y sin verlo la primera vez parece un bug.
   *
   * Usa `cumulativeDays`, la misma funcion que la tabla del detalle. Sumar aca
   * por separado serian dos cuentas del mismo numero que pueden diferir --
   * exactamente lo que `strategyRows` vino a cerrar en Outlook.
   *
   * Un step NUEVO todavia no esta en `siblings`, asi que se agrega al final: es
   * donde va a caer, porque `position` arranca en el ultimo + 1.
   */
  const delta = d.sla_days.trim() === '' ? null : Number(d.sla_days);
  const vistaPrevia = useMemo(() => {
    const esNuevo = initial === null;
    const lista = esNuevo
      ? [...siblings, { milestone_key: -1, title: d.title || 'this step', sla_days: delta, position: 9999 }]
      : siblings.map((sb) =>
          sb.milestone_key === initial.milestone_key ? { ...sb, sla_days: delta, title: d.title || sb.title } : sb
        );
    const ordenada = [...lista].sort((a, b) => a.position - b.position);
    const dias = cumulativeDays(ordenada.map((sb) => sb.sla_days));
    const idEste = esNuevo ? -1 : initial.milestone_key;
    return ordenada.map((sb, i) => ({
      key: sb.milestone_key,
      title: sb.title,
      dia: dias[i],
      esEste: sb.milestone_key === idEste,
    }));
  }, [siblings, delta, d.title, initial]);

  /*
   * Cuantos se corren detras de este. Se cuenta desde su posicion y no se
   * compara contra los dias viejos a proposito: lo que hay que decir es que
   * mover ESTE mueve a los de atras, no cuanto se movio cada uno.
   */
  const idxEste = vistaPrevia.findIndex((v) => v.esEste);
  const corridos = idxEste < 0 ? 0 : vistaPrevia.length - idxEste - 1;

  return (
    <Modal title={initial ? 'Edit step' : 'New step'} onClose={onClose}>
      <div className="bp-form">
        <Field label="Title">
          <input className="field" value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </Field>
        {/* Persona, no rol: con un rol no se sabe quién puede marcarlo hecho. */}
        <Field label="Accountable">
          <select className="field" value={d.accountable_employee_key} onChange={(e) => set('accountable_employee_key', e.target.value)}>
            <option value="">— unassigned —</option>
            {support.map((s) => (
              <option key={s.employee_key} value={s.employee_key}>
                {s.full_name}
              </option>
            ))}
          </select>
        </Field>
        {/*
          ══════════════════════════════════════════════════════════════════════
          EL DELTA, Y EL EFECTO DEL DELTA -- etapa BP40
          ══════════════════════════════════════════════════════════════════════

          Decia "days from the start of the node" y era el dia absoluto. Ahora es
          los dias DESDE EL STEP ANTERIOR.

          Y SE MUESTRA EN QUE SE CONVIERTE, porque correr un step corre a todos
          los que siguen en su nodo. La primera vez que alguien lo vea sin aviso
          va a parecer un bug: la lista de abajo dibuja los dias resultantes de
          todo el nodo mientras se escribe, con este step marcado.

          `min="0"` Y NO `min="1"`: un delta de 0 es valido y significa "el mismo
          dia que el anterior" -- diez steps de la plantilla lo usan. Lo que no
          existe es un negativo, que seria vencer antes que el anterior.
        */}
        <Field label="Days from the previous step">
          <input
            type="number"
            min="0"
            className="field"
            value={d.sla_days}
            onChange={(e) => set('sla_days', e.target.value)}
          />
        </Field>
        {vistaPrevia.length > 0 && (
          <div className="bp-sla-preview">
            <span className="bp-sla-preview__lbl">Days in the node</span>
            <span className="bp-sla-preview__row">
              {vistaPrevia.map((v) => (
                <span key={v.key} className={'bp-sla-chip' + (v.esEste ? ' bp-sla-chip--this' : '')}>
                  {v.title.length > 20 ? v.title.slice(0, 19) + '…' : v.title}
                  <b>{' day ' + v.dia}</b>
                </span>
              ))}
            </span>
            {corridos > 0 && (
              <span className="bp-sla-preview__warn">
                {corridos} step{corridos === 1 ? '' : 's'} after this one move{corridos === 1 ? 's' : ''} too — a step
                shifts everything that follows it inside the node.
              </span>
            )}
          </div>
        )}
        {/*
          ═══════════════════════════════════════════════════════════════
          ACÁ HABÍA DOS CAMPOS QUE SE FUERON — etapa BP44
          ═══════════════════════════════════════════════════════════════

          `Position`: el orden lo da el arrastre y la base renumera 1..N en
          `reorder_node_steps`. Un campo con el número invita a escribirlo, que
          es exactamente lo que BP41 vino a eliminar -- podías poner `1` y `1`.
          El valor sigue existiendo en la tabla; lo que se fue es el campo.

          `Resource URL`: se saca de la vista, y la columna NO se borra.
          Medido antes de tocar nada: 2 de 106 steps de plantilla la tienen con
          valor, 0 de 75 copias, y NINGUNO de los dos valores es una URL --
          dicen "LO & BD Accountable for this" y "Topic defined by the host
          (LO)". O sea que la columna se estaba usando como nota libre y el
          `placeholder="https://…"` empujaba a lo contrario.

          Por eso se oculta y no se elimina: borrar la columna perdería esas dos
          notas, y qué hacer con ellas es una conversación aparte.

          ⚠ EL VALOR SE CONSERVA AL GUARDAR. `d.resource_url` sigue en el
          borrador y se manda igual, así que editar el título de uno de esos dos
          steps no le borra la nota. Sin esto, ocultar el campo habría sido un
          borrado silencioso en el primer guardado.
        */}
        <div className="bp-form__actions">
          <button type="button" className="bp-btn bp-btn--primary" disabled={busy || d.title.trim() === ''} onClick={() => onSave(d)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="bp-linkish" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Confirmación de borrado.
 *
 * Con `blockedReason` no se puede confirmar: es el caso de un funnel con
 * enrolamientos o un nodo usado por un funnel que tiene gente enrolada. El
 * motivo se muestra en vez del botón -- que el usuario descubra la regla por un
 * error de Postgres es una forma pobre de explicarla.
 */
export function ConfirmDelete({
  what,
  warning,
  blockedReason,
  onConfirm,
  onClose,
  busy,
}: {
  what: string;
  warning?: string;
  blockedReason?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal title={'Delete ' + what} onClose={onClose}>
      <div className="bp-form">
        {blockedReason ? (
          <p className="bp-modal__lead bp-modal__lead--warn">{blockedReason}</p>
        ) : (
          <>
            {warning && <p className="bp-modal__lead bp-modal__lead--warn">{warning}</p>}
            <p className="bp-modal__lead">This cannot be undone.</p>
          </>
        )}
        <div className="bp-form__actions">
          {!blockedReason && (
            <button type="button" className="bp-btn bp-btn--primary" disabled={busy} onClick={onConfirm}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <button type="button" className="bp-linkish" onClick={onClose}>
            {blockedReason ? 'close' : 'cancel'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
