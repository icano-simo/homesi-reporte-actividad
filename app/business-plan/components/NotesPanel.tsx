'use client';

import { useState } from 'react';
import { useNotes, type NoteTarget } from '@/lib/business-plan/useNotes';
import { Avatar } from './shared';

/**
 * ============================================================================
 * PANEL DE NOTAS — el mismo en los cuatro niveles
 * ============================================================================
 *
 * Etapa BP20 — ARCHIVO NUEVO.
 *
 * Un solo componente para funnel, nodo, paso y perfil del Loan Officer. Lo
 * único que cambia entre los cuatro es el `target`; el resto -- orden, formato,
 * quién firma, qué se puede hacer -- tiene que ser idéntico, y cuatro copias
 * garantizaban que dejara de serlo en la segunda edición.
 *
 * ---------------------------------------------------------------------------
 * NO HAY BOTÓN DE EDITAR NI DE BORRAR, Y NO ES UN OLVIDO
 * ---------------------------------------------------------------------------
 * Una nota es el registro de lo que se dijo. La base tampoco los permite: la
 * tabla no tiene política de UPDATE ni de DELETE. Poner los botones y que
 * fallaran contra RLS sería peor que no ponerlos.
 *
 * Para rectificar se escribe otra nota. Queda el error y la corrección.
 */

/** "isabella.cano@supremelending.com" -> "Isabella Cano". */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** "2026-08-14T13:07:19Z" -> "14 Aug 2026, 13:07". */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotesPanel({
  target,
  title = 'Follow-up notes',
  placeholder = 'What was discussed, what was agreed…',
  compact = false,
}: {
  target: NoteTarget | null;
  title?: string;
  placeholder?: string;
  /** En el paso, dentro de la fila: sin encabezado y con menos aire. */
  compact?: boolean;
}) {
  const { notes, isLoading, available, error, add } = useNotes(target);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    const err = await add(draft);
    setOpError(err);
    if (!err) setDraft('');
    setBusy(false);
  }

  if (!available) {
    return (
      <div className={'bp-notes' + (compact ? ' bp-notes--compact' : '')}>
        {!compact && <div className="bp-notes__title">{title}</div>}
        <p className="bp-muted-line">
          Notes are not in the database yet — apply <code>docs/sql/2026-08-business-plan-note.sql</code>.
        </p>
      </div>
    );
  }

  return (
    <div className={'bp-notes' + (compact ? ' bp-notes--compact' : '')}>
      {!compact && (
        <div className="bp-notes__title">
          {title}
          {notes.length > 0 && <span className="bp-notes__count">{notes.length}</span>}
        </div>
      )}

      {error && <p className="bp-muted-line">{error}</p>}

      <ul className="bp-notes__list">
        {notes.map((n) => {
          const who = nameFromEmail(n.author_email);
          return (
            <li key={n.note_key} className="bp-note">
              <Avatar name={who} title={n.author_email} />
              <div className="bp-note__body">
                <div className="bp-note__meta">
                  <span className="bp-note__who">{who}</span>
                  <span className="bp-note__when">{formatStamp(n.created_at)}</span>
                </div>
                {/* `pre-wrap` en el CSS: los saltos de línea de quien escribió se
                    respetan sin tener que interpretar nada. */}
                <p className="bp-note__text">{n.body}</p>
              </div>
            </li>
          );
        })}
        {!isLoading && notes.length === 0 && <li className="bp-muted-line">No notes yet.</li>}
      </ul>

      <div className="bp-notes__compose">
        <textarea
          className="field bp-notes__area"
          rows={compact ? 2 : 3}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="bp-btn bp-btn--primary bp-btn--small"
          disabled={busy || draft.trim() === ''}
          onClick={submit}
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </div>
      {opError && <p className="bp-muted-line">{opError}</p>}
    </div>
  );
}
