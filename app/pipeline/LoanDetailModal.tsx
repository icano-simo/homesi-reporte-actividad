'use client';

import { useEffect, useState } from 'react';
import { healthStatusLabel, healthStatusVariant } from './healthStatus';
import { classifyStrategy, nppmRealtors } from '@/lib/pipeline/strategy';
import { CloseIcon } from '@/components/ui/icons';
import type { PipelineLoan } from '@/lib/pipeline/types';

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
  /**
   * Columna "Channel" del origen -- dato real del loan (PipelineLoan/
   * ResolvedLoan), nunca inferido del tab/toggle activo. Opcional: el modal
   * de Milestone Matrix (TabMilestoneMatrix.tsx) no lo provee -- ausente =
   * badge '—', mismo criterio que rawHealthiness más abajo.
   */
  channel?: PipelineLoan['channel'];
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
   * Etapa PROPERTY-STATE-1: columna "Subject Property State" del origen.
   * Mismo criterio que `loanType`/`loanProgram` de arriba -- '' cuando no
   * hay valor real, se muestra `NOT_AVAILABLE_TEXT`, nunca se inventa.
   */
  propertyState: string;
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
  opportunityOwner: string;
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

/**
 * Nombres estables de columna -- mismo vocabulario que los campos de
 * `LoanDetailModalLoan`, para `hiddenColumns`.
 *
 * Etapa AJUSTES-ANALYTICS-1, punto 6b: se agrega `'notes'` -- a
 * diferencia de las demás, Notes SIEMPRE se había renderizado sin ningún
 * mecanismo de opt-out (columna fija, ver `visibleColumnCount`/el
 * `<td className="note-cell">` de abajo). Se agrega al mismo array de
 * opt-out (no un prop dedicado como `showChannelColumn`) porque el
 * comportamiento por default (mostrada) es el correcto para los 3
 * consumidores existentes (PivotTable.tsx, TabMilestoneMatrix.tsx,
 * AdverseTable) -- ninguno la pasa hoy en `hiddenColumns`, así que ninguno
 * cambia. Analytics (TabAnalytics.tsx) es el único que la agrega, porque
 * ahí `loans` son siempre préstamos ya cerrados -- no aplica.
 */
export type LoanDetailModalColumn =
  | 'loanOfficer'
  | 'loanType'
  | 'loanProgram'
  | 'propertyState'
  | 'milestone'
  | 'status'
  | 'channel'
  | 'notes';

export interface LoanDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Contexto de la celda clickeada, ej. "Branch 707 — Banked - Retail". */
  context: string;
  /** Métrica auditada, ej. "Total Pipeline". El conteo lo agrega este componente. */
  metric: string;
  loans: LoanDetailModalLoan[];
  /**
   * Etapa F7, Parte 6 -- oculta columnas que ya son redundantes con el
   * corte que abrió el modal (ej. Analytics abriendo por Loan Program no
   * necesita repetir esa misma columna), o que en ese contexto siempre
   * vienen vacías. Default `undefined`: los 3 consumidores existentes
   * (PivotTable.tsx, TabMilestoneMatrix.tsx, AdverseTable) no lo pasan y
   * ven exactamente las mismas columnas que hoy, sin cambio de
   * comportamiento -- mismo criterio que `showChannelColumn` de abajo,
   * generalizado a cualquier columna en vez de solo Channel.
   */
  hiddenColumns?: LoanDetailModalColumn[];
  /**
   * Combined Total by Branch (PivotTable.tsx) sí tiene channel real por loan;
   * Milestone Matrix (TabMilestoneMatrix.tsx) ya filtra por un solo canal vía
   * su propio toggle banked/brokered, así que la columna sería redundante
   * ahí -- se omite del todo (no solo se oculta con CSS), no solo su celda.
   * Default true: los demás callers no necesitan pasarlo.
   */
  showChannelColumn?: boolean;
  /**
   * Etapa AJUSTES-ANALYTICS-1, punto 6b: columnas Strategy/Branch,
   * EXCLUSIVAS de Analytics (préstamos cerrados). Default `false` a
   * propósito -- AL REVÉS de `showChannelColumn` (default `true`): acá el
   * default protege a los 3 consumidores YA existentes (PivotTable.tsx,
   * TabMilestoneMatrix.tsx, AdverseTable), que nunca pidieron estas 2
   * columnas y no deben empezar a verlas por un cambio de default. Si en
   * vez de un prop dedicado se hubiera agregado 'strategy'/'branch' al
   * mecanismo de opt-OUT `hiddenColumns` (como `loanType`/`loanProgram`),
   * agregar la columna habría cambiado el comportamiento de esos 3
   * consumidores sin que ellos hicieran nada -- exactamente el riesgo que
   * este punto de la tarea pide confirmar que NO pasa. `classifyStrategy`
   * (ya importado en este archivo, para el realtor NPPM) calcula el valor
   * de Strategy -- ninguna lógica de clasificación nueva.
   */
  showStrategyColumn?: boolean;
  showBranchColumn?: boolean;
  /**
   * CTC/Closing (punto CtcDot, PivotTable.tsx): agrupa `loans` por milestone
   * real en vez de una sola tabla plana -- cada sección trae su propio
   * encabezado ("Clear to Close:"/"Closing:") dentro del tbody. `loans` de
   * arriba sigue siendo obligatorio (el count del header y el caso "No
   * loans." lo siguen usando tal cual, sin duplicar esa lógica acá) y debe
   * ser la unión de todas las secciones. Si se omite, se renderiza la tabla
   * plana de siempre (comportamiento sin cambios para el resto de modales).
   * El caller ya excluye secciones vacías (un branch con solo CTC no manda
   * una sección "Closing" vacía) -- este componente no decide eso.
   */
  sections?: { label: string; loans: LoanDetailModalLoan[] }[];
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

export default function LoanDetailModal({
  isOpen,
  onClose,
  context,
  metric,
  loans,
  showChannelColumn = true,
  showStrategyColumn = false,
  showBranchColumn = false,
  hiddenColumns,
  sections,
}: LoanDetailModalProps) {
  /** `channel` sigue gobernado por `showChannelColumn` (comportamiento previo, sin cambios) -- las demás columnas por `hiddenColumns`. */
  const showLoanOfficerColumn = !hiddenColumns?.includes('loanOfficer');
  const showLoanTypeColumn = !hiddenColumns?.includes('loanType');
  const showLoanProgramColumn = !hiddenColumns?.includes('loanProgram');
  const showPropertyStateColumn = !hiddenColumns?.includes('propertyState');
  const showMilestoneColumn = !hiddenColumns?.includes('milestone');
  const showStatusColumn = !hiddenColumns?.includes('status');
  /** Etapa AJUSTES-ANALYTICS-1, punto 6b: Notes pasa a ser opcional -- ver el comentario largo en `LoanDetailModalColumn` arriba. */
  const showNotesColumn = !hiddenColumns?.includes('notes');
  /** Loan #, Borrower, Amount son siempre visibles -- no tienen entrada en `hiddenColumns` ni prop dedicado. */
  const visibleColumnCount =
    3 +
    (showLoanOfficerColumn ? 1 : 0) +
    (showChannelColumn && !hiddenColumns?.includes('channel') ? 1 : 0) +
    (showLoanTypeColumn ? 1 : 0) +
    (showLoanProgramColumn ? 1 : 0) +
    (showPropertyStateColumn ? 1 : 0) +
    (showStrategyColumn ? 1 : 0) +
    (showBranchColumn ? 1 : 0) +
    (showMilestoneColumn ? 1 : 0) +
    (showStatusColumn ? 1 : 0) +
    (showNotesColumn ? 1 : 0);
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

  /** Una <tr> de préstamo -- extraído para reusarse tanto en la tabla plana (loans.map) como dentro de cada sección agrupada (sections), sin duplicar el JSX de la fila. */
  function renderLoanRow(loan: LoanDetailModalLoan) {
    return (
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
            Sólo en préstamos de estrategia NPPM (24 de 883), y por eso va debajo
            del prestatario y NO como columna propia: una columna estaría vacía
            en el 97% de las filas y le robaría ancho a las nueve que sí tienen
            dato siempre. `nppmRealtors()` resuelve los cuatro casos -- si no hay
            ninguno devuelve lista vacía y acá no se dibuja nada, sin placeholder.

            ⚠ Va ACÁ y no en el `loans.map` de abajo: Heather extrajo la fila a
            `renderLoanRow` para reusarla en la tabla plana y en las secciones
            agrupadas del modal del punto de CTC. Si el bloque se quedara en el
            map, el realtor aparecería en la vista plana y desaparecería en la
            agrupada -- la misma fila con dos contenidos según por dónde se
            entre. Una sola plantilla de fila, un solo lugar.
          */}
          {classifyStrategy(loan) === 'NPPM' &&
            nppmRealtors(loan).map((r) => (
              <span className="nppm-realtor" key={r.label} title={r.label + ': ' + r.value}>
                <span className="nppm-realtor__label">{r.label}</span>
                {r.value}
              </span>
            ))}
          {/*
            ⚠ OWNER PARA B2B Y DEMÁS ESTRATEGIAS — etapa F7, Parte 4.
            Extiende el mismo patrón de arriba (sub-label debajo del prestatario,
            misma clase `.nppm-realtor`/`.nppm-realtor__label`) a cualquier
            préstamo que NO sea NPPM. Etapa ANALYTICS-OWNER-1: el dato mostrado
            pasa a ser `opportunityOwner` (el NOMBRE real de la persona), no
            `opportunityOwnerTitle` (el rol -- "Business Developer", etc.) --
            ese título sigue usándose solo para decidir SI se muestra este
            bloque (misma condición de gate de siempre), nunca como el valor
            mostrado. Si `opportunityOwner` viene vacío se muestra
            `NOT_AVAILABLE_TEXT` -- NUNCA cae de vuelta al rol. Se omite el
            bloque entero si el título viene vacío (mismo criterio que arriba,
            sin placeholder) o si por alguna razón coincide exactamente con
            `loanOfficer` (columna ya visible más abajo en esta misma fila) --
            para no duplicar el mismo valor dos veces.
          */}
          {classifyStrategy(loan) !== 'NPPM' &&
            loan.opportunityOwnerTitle.trim() !== '' &&
            loan.opportunityOwnerTitle.trim() !== loan.loanOfficer.trim() && (
              <span className="nppm-realtor" title={'Owner: ' + (loan.opportunityOwner.trim() || NOT_AVAILABLE_TEXT)}>
                <span className="nppm-realtor__label">Owner</span>
                {loan.opportunityOwner.trim() || NOT_AVAILABLE_TEXT}
              </span>
            )}
        </td>
        {showLoanOfficerColumn && (
          <td style={{ textAlign: 'left' }} title={loan.loanOfficer}>
            {loan.loanOfficer || '—'}
          </td>
        )}
        {showChannelColumn && !hiddenColumns?.includes('channel') && (
          <td style={{ textAlign: 'left' }} title={loan.channel ?? '—'}>
            {loan.channel ?? '—'}
          </td>
        )}
        {showLoanTypeColumn && (
          <td style={{ textAlign: 'left' }} title={loan.loanType || NOT_AVAILABLE_TEXT}>
            {loan.loanType || NOT_AVAILABLE_TEXT}
          </td>
        )}
        {showLoanProgramColumn && (
          <td style={{ textAlign: 'left' }} title={loan.loanProgram || NOT_AVAILABLE_TEXT}>
            {loan.loanProgram || NOT_AVAILABLE_TEXT}
          </td>
        )}
        {showPropertyStateColumn && (
          <td style={{ textAlign: 'left' }} title={loan.propertyState || NOT_AVAILABLE_TEXT}>
            {loan.propertyState || NOT_AVAILABLE_TEXT}
          </td>
        )}
        {/* Etapa AJUSTES-ANALYTICS-1, punto 6b: Strategy/Branch -- ver el comentario de showStrategyColumn/showBranchColumn en LoanDetailModalProps. */}
        {showStrategyColumn && (
          <td style={{ textAlign: 'left' }} title={classifyStrategy(loan)}>
            {classifyStrategy(loan)}
          </td>
        )}
        {showBranchColumn && (
          <td style={{ textAlign: 'left' }} title={loan.branch || '—'}>
            {loan.branch || '—'}
          </td>
        )}
        <td className="val">{fmtAmount(loan.amount)}</td>
        {showMilestoneColumn && (
          <td style={{ textAlign: 'left' }} title={loan.rawMilestone}>
            {loan.rawMilestone || '—'}
          </td>
        )}
        {showStatusColumn && (
          <td style={{ textAlign: 'left' }}>
            <HealthBadge rawHealthiness={loan.rawHealthiness} />
          </td>
        )}
        {showNotesColumn && (
          <td className="note-cell">
            <NoteCell
              note={loan.noteHistory}
              expanded={expandedNotes.has(loan.sourceLoanId)}
              onToggle={() => toggleNote(loan.sourceLoanId)}
            />
          </td>
        )}
      </tr>
    );
  }

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
                {showLoanOfficerColumn && <col style={{ width: '175px' }} />}
                {showChannelColumn && !hiddenColumns?.includes('channel') && <col style={{ width: '130px' }} />}
                {showLoanTypeColumn && <col style={{ width: '120px' }} />}
                {showLoanProgramColumn && <col style={{ width: '145px' }} />}
                {showPropertyStateColumn && <col style={{ width: '90px' }} />}
                {showStrategyColumn && <col style={{ width: '110px' }} />}
                {showBranchColumn && <col style={{ width: '80px' }} />}
                <col style={{ width: '95px' }} />
                {showMilestoneColumn && <col style={{ width: '150px' }} />}
                {showStatusColumn && <col style={{ width: '115px' }} />}
                {showNotesColumn && <col style={{ width: '240px' }} />}
              </colgroup>
            <thead>
              <tr className="mo-row">
                <th className="lbl">Loan #</th>
                <th style={{ textAlign: 'left' }}>Borrower</th>
                {showLoanOfficerColumn && <th style={{ textAlign: 'left' }}>Loan Officer</th>}
                {showChannelColumn && !hiddenColumns?.includes('channel') && <th style={{ textAlign: 'left' }}>Channel</th>}
                {showLoanTypeColumn && <th style={{ textAlign: 'left' }}>Loan Type</th>}
                {showLoanProgramColumn && <th style={{ textAlign: 'left' }}>Loan Program</th>}
                {showPropertyStateColumn && <th style={{ textAlign: 'left' }}>Property State</th>}
                {showStrategyColumn && <th style={{ textAlign: 'left' }}>Strategy</th>}
                {showBranchColumn && <th style={{ textAlign: 'left' }}>Branch</th>}
                <th>Amount</th>
                {showMilestoneColumn && <th style={{ textAlign: 'left' }}>Milestone</th>}
                {showStatusColumn && <th style={{ textAlign: 'left' }}>Status</th>}
                {showNotesColumn && <th style={{ textAlign: 'left' }}>Notes</th>}
              </tr>
            </thead>
            <tbody>
              {sections
                ? sections
                    .filter((section) => section.loans.length > 0)
                    .flatMap((section) => [
                      <tr className="modal-section-row" key={'section:' + section.label}>
                        <td colSpan={visibleColumnCount}>{section.label}:</td>
                      </tr>,
                      ...section.loans.map((loan) => renderLoanRow(loan)),
                    ])
                : loans.map((loan) => renderLoanRow(loan))}
              {!loans.length && (
                <tr>
                  <td
                    className="lbl"
                    style={{ color: 'var(--slate-500)', fontWeight: 500 }}
                    colSpan={visibleColumnCount}
                  >
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
