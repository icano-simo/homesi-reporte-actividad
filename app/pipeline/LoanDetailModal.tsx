'use client';

import { useEffect, useState } from 'react';
import { healthStatusLabel, healthStatusVariant } from './healthStatus';
import { classifyStrategy, nppmRealtors } from '@/lib/pipeline/strategy';
import { CloseIcon } from '@/components/ui/icons';

/*
 * ============================================================================
 * AUDIT DRILL-DOWN — modal centrado
 * ============================================================================
 *
 * HOTFIX UX2: vuelve a ser un modal CENTRADO. La etapa anterior lo había
 * convertido en un flyout lateral de 520px pegado al borde derecho; con 6
 * columnas de datos ese ancho quedaba apretado y obligaba a scroll horizontal
 * dentro del panel — justo lo que hay que evitar en una vista de auditoría.
 *
 * Fase urgente (revisión post-validación visual): con las 2 columnas nuevas
 * (Loan Type/Loan Program, ver LoanDetailModalLoan) pasaron a ser 8 -- a
 * 768px (el máximo compartido con el modal de Activity, `.modal-box`,
 * components.css) varias quedaban truncadas con "...". `.modal-box--wide`
 * (clase propia de ESTE modal, no de `.modal-box` base) sube el máximo a
 * ~92vw/1400px -- el modal de Activity (6 columnas, `components/report/
 * LoanDetailModal.tsx`) no lleva esa clase y sigue exactamente en 768px, sin
 * tocar. `.modal-table-scroll` (envuelve la tabla, no `.modal-body` --
 * también compartida) deja que la tabla scrollee horizontal en vez de
 * comprimirse si el viewport es angosto y ni 92vw alcanza.
 *
 * Ajuste posterior (refinamiento visual): las columnas del <colgroup> de
 * abajo pasaron de % del modal a PX de referencia por contenido -- con
 * `table-layout: auto` (misma regla `.modal-table-scroll table.piv`) el
 * ancho de la tabla lo decide el contenido real, no el 92vw entero, así que
 * campos cortos (Loan #/Amount/Status) ya no se estiran con aire vacío. Ver
 * el comentario del colgroup para el detalle.
 *
 * Fase urgente (Notes): agrega la columna "Notes" (Production Support Note
 * History) al final -- preview de ~3 líneas visuales (CSS line-clamp, ver
 * NoteCell/.note-text--clamped) + "Show more"/"Hide note" POR FILA,
 * expandiendo/contrayendo dentro de la misma celda (nunca otro modal). El
 * ancho extra del modal ampliado (`.modal-box--wide`) se destina
 * principalmente a esta columna; el resto de columnas conserva su ancho
 * compacto de la etapa anterior, sin tocar.
 *
 * Este componente no sabe nada de branch/canal/cálculos: recibe una lista ya
 * filtrada más el contexto y el nombre de la métrica.
 *
 * Cierra con click en el backdrop, el botón X, o Esc.
 */

export interface LoanDetailModalLoan {
  sourceLoanId: string;
  borrowerName: string;
  loanOfficer: string;
  amount: number;
  rawMilestone: string;
  /**
   * Solo presente en préstamos abiertos (PipelineLoan). ResolvedLoan (ya
   * cerrados) no tiene este campo: ausente = badge '—', no "undefined".
   */
  rawHealthiness?: string;
  /**
   * De la columna "Branch Transfer" del origen. Solo informativo, no afecta
   * branch ni cálculos.
   */
  branchTransferred?: boolean;
  /**
   * Columna "Loan Type" del origen. '' cuando no hay valor real -- ya sea
   * porque el snapshot restaurado es anterior al fix que empezó a guardar
   * esta columna (dato nunca capturado, no "vacío a propósito"), o porque el
   * Excel de origen realmente no traía nada en esa celda. Se muestra
   * `NOT_AVAILABLE_TEXT`, nunca se inventa un valor.
   */
  loanType: string;
  /** Columna "Loan Program" del origen. Mismo criterio que `loanType` de arriba. */
  loanProgram: string;
  /**
   * Columna "Production Support Note History" del origen. Mismo criterio que
   * `loanType`/`loanProgram` de arriba. Valor completo, sin recortar -- el
   * recorte visual a ~3 líneas es puramente de presentación (CSS line-clamp,
   * ver NoteCell más abajo), este campo siempre conserva el texto real
   * completo.
   */
  noteHistory: string;
  /**
   * ============================================================================
   * ⚠ ETAPA F6 — LO QUE HACE FALTA PARA EL REALTOR DEL NPPM
   * ============================================================================
   *
   * Los dos primeros son para CLASIFICAR (el realtor sólo se muestra en
   * préstamos de estrategia NPPM) y los dos últimos son el dato en sí.
   *
   * Se pasan los CRUDOS y se clasifica acá, en vez de recibir un booleano
   * `isNppm` ya resuelto: así la regla vive en un solo lugar
   * (`lib/pipeline/strategy.ts`) y no hay dos formas de decidir qué es NPPM.
   */
  /* `branch` hace falta para clasificar: Affinity y Recruitment se deciden
     por branch, no por una columna del préstamo. */
  branch: string;
  strategyRaw: string;
  opportunityOwnerTitle: string;
  nppmRealtor: string;
  referredBy: string;
}

/**
 * Bug fix -- ver checklist de la fase: los snapshots restaurados desde
 * Supabase de ANTES de que `loan_type`/`loan_program`/
 * `production_support_note_history` existieran como columnas quedan en NULL
 * (`?? ''` en app/api/pipeline/latest/route.ts) -- eso es indistinguible de
 * "el préstamo no tiene programa asignado" si se muestra como el mismo '—'
 * ambiguo que usan otros campos de esta tabla. Estos 3 campos usan este
 * texto explícito en su lugar, tanto para ese caso (histórico, no capturado)
 * como para un valor genuinamente vacío en el Excel de origen (mismo texto
 * para los dos -- distinguirlos requeriría guardar metadata adicional por
 * snapshot que hoy no existe, y ninguno de los dos casos debe leerse como
 * "se verificó y no tiene").
 */
const NOT_AVAILABLE_TEXT = 'Not available for this snapshot';

export interface LoanDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Contexto de la celda clickeada, ej. "Branch 707 — Banked - Retail". */
  context: string;
  /** Métrica auditada, ej. "Total Pipeline". El conteo lo agrega este componente. */
  metric: string;
  loans: LoanDetailModalLoan[];
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function HealthBadge({ rawHealthiness }: { rawHealthiness?: string }) {
  if (rawHealthiness === undefined) {
    return <span style={{ color: 'var(--slate-400)' }}>—</span>;
  }
  const label = healthStatusLabel(rawHealthiness);
  return <span className={'badge badge--pill ' + healthStatusVariant(label)}>{label}</span>;
}

/**
 * Celda de Notes: preview de ~3 líneas VISUALES (CSS `-webkit-line-clamp`,
 * `.note-text--clamped` en components.css) -- no un recorte por cantidad de
 * caracteres. El texto completo (`note`) va siempre en el DOM, colapsado o
 * expandido; lo único que cambia es la clase CSS que lo clampea o no.
 *
 * "Show more" solo debe aparecer si el navegador REALMENTE clampeó algo --
 * un recorte por caracteres no puede saber eso (una nota de 200 caracteres
 * puede entrar en 3 líneas si son cortas, y una de 80 puede no entrar si
 * tiene saltos de línea reales). Se mide el nodo clampeado apenas se monta
 * (`scrollHeight > clientHeight` = hay contenido oculto) con un CALLBACK
 * REF, no con un efecto: un ref callback corre en el commit, no es un
 * Effect, así que llamar a `setState` ahí no dispara el lint de "setState
 * dentro de un effect" (react-hooks/set-state-in-effect) que si aplicaría
 * a un useEffect/useLayoutEffect haciendo lo mismo.
 *
 * `isOverflowing` es estado LOCAL de este componente -- cada <NoteCell> ya
 * es una instancia por fila (una por <tr>, ver el .map() de abajo), así que
 * no hace falta un Set con sourceLoanId para que quede por fila: React ya
 * aísla el estado de cada instancia.
 */
function NoteCell({ note, expanded, onToggle }: { note: string; expanded: boolean; onToggle: () => void }) {
  const [isOverflowing, setIsOverflowing] = useState(false);

  function measureClamp(node: HTMLSpanElement | null) {
    if (!node) return;
    const overflowing = node.scrollHeight > node.clientHeight + 1;
    setIsOverflowing((prev) => (prev === overflowing ? prev : overflowing));
  }

  if (!note) return <span style={{ color: 'var(--slate-400)' }}>{NOT_AVAILABLE_TEXT}</span>;

  if (expanded) {
    return (
      <>
        <span className="note-text note-text--full">{note}</span>
        <button type="button" className="note-toggle" onClick={onToggle}>
          Hide note
        </button>
      </>
    );
  }

  return (
    <>
      <span ref={measureClamp} className="note-text note-text--clamped">
        {note}
      </span>
      {isOverflowing && (
        <button type="button" className="note-toggle" onClick={onToggle}>
          Show more
        </button>
      )}
    </>
  );
}

export default function LoanDetailModal({ isOpen, onClose, context, metric, loans }: LoanDetailModalProps) {
  /**
   * Expansión de Notes POR FILA -- Set de sourceLoanId (identificador
   * estable ya usado como `key` en cada <tr>, ver el .map() más abajo), NO
   * un boolean único: abrir la nota de un loan no debe afectar a los demás.
   */
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  function toggleNote(sourceLoanId: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(sourceLoanId)) next.delete(sourceLoanId);
      else next.add(sourceLoanId);
      return next;
    });
  }

  /**
   * Envuelve el onClose del padre para resetear la expansión de notas al
   * cerrar -- en el handler del evento (click en backdrop/botón X, o Esc),
   * no en un efecto que observe `isOpen` (eso dispararía un setState
   * síncrono dentro de un effect, que el lint de React marca como
   * antipatrón -- cascading renders). Así la próxima apertura empieza con
   * todas las notas colapsadas, sin depender de un effect para lograrlo.
   */
  function handleClose() {
    setExpandedNotes(new Set());
    onClose();
  }

  useEffect(() => {
    if (!isOpen) return;
    // Inline en vez de llamar a handleClose(): setExpandedNotes (el setter
    // de useState) es estable entre renders, así que esto puede depender
    // solo de [isOpen, onClose] -- mismos deps que ya tenía este efecto
    // antes de agregar Notes, sin necesitar handleClose acá adentro.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setExpandedNotes(new Set());
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /*
   * Bloquea el scroll del documento mientras el modal está abierto. Hace falta
   * desde el rediseño: antes el scroll lo manejaba un `.content` interno, ahora
   * scrollea el <body> y sin esto la página de atrás se mueve bajo el modal.
   */
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const countLabel = loans.length.toLocaleString('en-US') + (loans.length === 1 ? ' Loan' : ' Loans');

  return (
    <div className="modal-overlay" onClick={handleClose}>
      {/* stopPropagation: un click DENTRO de la caja no debe cerrar el modal. */}
      <div
        className="modal-box modal-box--wide"
        role="dialog"
        aria-modal="true"
        aria-label={context + ' — ' + metric}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <div className="modal-eyebrow">{context}</div>
            <h2 className="modal-title">
              {metric}
              <span className="badge badge--pill badge--sky">{countLabel}</span>
            </h2>
          </div>
          <button type="button" className="modal-close" onClick={handleClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/*
           * `.modal-table-scroll` (no `.modal-body`, compartida con el modal
           * de Activity): scroll horizontal propio de la tabla si el
           * viewport es angosto -- ver nota de `.modal-box--wide` arriba.
           */}
          <div className="modal-table-scroll">
            <table className="piv">
              {/*
               * Refinamiento visual: anchos en PX de referencia, no % del
               * modal -- con `table-layout: auto` (.modal-table-scroll
               * table.piv, components.css) el navegador los toma como
               * mínimos por columna y ajusta por contenido real, en vez de
               * estirar cada columna proporcional al 92vw/1400px del modal
               * (eso era lo que dejaba aire vacío entre campos cortos como
               * Loan #/Amount/Status). Los primeros 8 anchos NO se tocaron
               * (misma etapa anterior) -- el ancho nuevo del modal se le da
               * casi entero a Notes (última columna), la única con texto de
               * largo variable; el resto sigue compacto.
               */}
              <colgroup>
                <col style={{ width: '115px' }} />
                <col style={{ width: '190px' }} />
                <col style={{ width: '175px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '145px' }} />
                <col style={{ width: '95px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '115px' }} />
                <col style={{ width: '240px' }} />
              </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">Loan #</th>
                <th style={{ textAlign: 'left' }}>Borrower</th>
                <th style={{ textAlign: 'left' }}>Loan Officer</th>
                <th style={{ textAlign: 'left' }}>Loan Type</th>
                <th style={{ textAlign: 'left' }}>Loan Program</th>
                <th>Amount</th>
                <th style={{ textAlign: 'left' }}>Milestone</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'left' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr className="metric" key={loan.sourceLoanId}>
                  <td className="lbl" title={loan.sourceLoanId}>
                    {loan.sourceLoanId}
                    {loan.branchTransferred && (
                      <span className="branch-transfer-chip" title="Branch reassigned due to license (Branch Transfer)">
                        T
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.borrowerName}>
                    {loan.borrowerName}
                    {/*
                      ⚠ EL REALTOR DEL NPPM — etapa F6.
                      Sólo en préstamos de estrategia NPPM (24 de 883), y por eso
                      va debajo del prestatario y NO como columna propia: una
                      columna estaría vacía en el 97% de las filas y le robaría
                      ancho a las ocho que sí tienen dato en todas.
                      `nppmRealtors()` ya resuelve los cuatro casos -- si no hay
                      ninguno devuelve lista vacía y acá no se dibuja nada, sin
                      placeholder.
                    */}
                    {classifyStrategy(loan) === 'NPPM' &&
                      nppmRealtors(loan).map((r) => (
                        <span className="nppm-realtor" key={r.label} title={r.label + ': ' + r.value}>
                          <span className="nppm-realtor__label">{r.label}</span>
                          {r.value}
                        </span>
                      ))}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.loanOfficer}>
                    {loan.loanOfficer || '—'}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.loanType || NOT_AVAILABLE_TEXT}>
                    {loan.loanType || NOT_AVAILABLE_TEXT}
                  </td>
                  <td style={{ textAlign: 'left' }} title={loan.loanProgram || NOT_AVAILABLE_TEXT}>
                    {loan.loanProgram || NOT_AVAILABLE_TEXT}
                  </td>
                  <td className="val">{fmtAmount(loan.amount)}</td>
                  <td style={{ textAlign: 'left' }} title={loan.rawMilestone}>
                    {loan.rawMilestone || '—'}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <HealthBadge rawHealthiness={loan.rawHealthiness} />
                  </td>
                  <td className="note-cell">
                    <NoteCell
                      note={loan.noteHistory}
                      expanded={expandedNotes.has(loan.sourceLoanId)}
                      onToggle={() => toggleNote(loan.sourceLoanId)}
                    />
                  </td>
                </tr>
              ))}
              {!loans.length && (
                <tr>
                  <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={9}>
                    No loans.
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
