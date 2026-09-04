'use client';

import { useState, type ReactNode } from 'react';
import type { Funnel, FunnelCategory, FunnelNode, NodeMilestone } from '@/lib/business-plan/funnels';
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

export function MilestoneForm({
  initial,
  support,
  onSave,
  onClose,
  busy,
}: {
  initial: NodeMilestone | null;
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
        <Field label="SLA (days from the start of the node)">
          <input type="number" min="0" className="field" value={d.sla_days} onChange={(e) => set('sla_days', e.target.value)} />
        </Field>
        <Field label="Resource URL">
          <input className="field" value={d.resource_url} onChange={(e) => set('resource_url', e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Position">
          <input type="number" min="1" className="field" value={d.position} onChange={(e) => set('position', e.target.value)} />
        </Field>
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
