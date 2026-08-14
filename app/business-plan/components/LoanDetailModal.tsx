'use client';

import { formatYearMonth, shortMonth } from '@/lib/business-plan/months';
import type { ActivityLoan, LoanOfficerRow, MilestoneBucket, OpenLoan } from '@/lib/business-plan/types';
import Modal from './Modal';

/**
 * ============================================================================
 * MODALES DE DETALLE — qué préstamos hay detrás de cada número
 * ============================================================================
 *
 * Etapa BP9 — ARCHIVO NUEVO.
 *
 * Sigue rigiendo cero modales para NAVEGACIÓN: cada nivel de la jerarquía es
 * una página con URL. Esto es la excepción ya acordada, detalle complementario:
 * "quiero ver de qué está hecho este número y cerrar".
 *
 * ---------------------------------------------------------------------------
 * ⚠ QUÉ CAMPOS HAY, SEGÚN DE DÓNDE VENGA EL NÚMERO
 * ---------------------------------------------------------------------------
 * Los modales leen de dos fuentes distintas y NO tienen los mismos campos:
 *
 *   pipeline_forecast   número de préstamo, prestatario, monto, milestone y
 *                       fecha estimada de cierre. Todo disponible.
 *
 *   activity_report     NO tiene nombre de prestatario -- el export no lo trae.
 *                       El número de préstamo SÍ (está en REQUIRED_COLUMNS); en
 *                       BP9 se reportó lo contrario por error. Quedan número,
 *                       monto, canal, programa y folder.
 *
 * Por eso el modal de una barra de un mes pasado muestra menos columnas que el
 * de una tarjeta del pipeline. No es un olvido; está anotado en
 * docs/ARQUITECTURA.md.
 *
 * Número, programa y folder son NULL en los lotes cargados antes de que se
 * empezaran a persistir. Etapa BP11: en vez de mostrar una columna de guiones,
 * la columna no se dibuja y se explica en una línea por qué falta -- ver
 * `ActivityTable`.
 */

export type ModalKind =
  | 'closed'
  | 'pipeline'
  | 'healthy'
  | 'projected'
  | 'forecast'
  | 'activity'
  | 'files'
  | 'credit'
  | 'apps'
  | { month: string };

const MILESTONES: MilestoneBucket[] = ['Started', 'Processing', 'Underwriting', 'Closing'];

const money = (n: number | null) =>
  n === null || n === 0 ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export default function LoanDetailModal({
  kind,
  lo,
  thisMonth,
  year,
  yearMonths,
  onClose,
}: {
  kind: ModalKind;
  lo: LoanOfficerRow;
  thisMonth: string;
  year: number;
  yearMonths: string[];
  onClose: () => void;
}) {
  const name = lo.fullName;

  /* ── Barra de un mes del gráfico ──────────────────────────────────────── */
  if (typeof kind === 'object') {
    const month = kind.month;
    const isCurrent = month === thisMonth;
    /*
     * Cada barra abre la MISMA fuente de la que salió. La del mes en curso sale
     * de `pipeline_resolved_loans` (decisión de BP6) y las anteriores de
     * Commercial Activity, que es la única con la serie mensual completa. Por
     * eso las columnas cambian entre una y otra.
     */
    if (isCurrent) {
      const openThisMonth = lo.openLoanDetail.filter((l) => l.closeMonth === month);
      return (
        <Modal title={`${name} — ${formatYearMonth(month)}`} onClose={onClose}>
          <p className="bp-modal__lead">
            Closed so far <strong>{lo.resolvedLoanDetail.length}</strong> · still open and due this month{' '}
            <strong>{openThisMonth.length}</strong> · projected total{' '}
            <strong>{lo.projection.projectedTotal.toFixed(2)}</strong>
          </p>
          <ResolvedTable loans={lo.resolvedLoanDetail} />
          <h3 className="bp-modal__subtitle">Still open, due to close this month</h3>
          <OpenTable loans={openThisMonth} />
        </Modal>
      );
    }
    const rows = lo.activity.closingsRowsByMonth[month] ?? [];
    return (
      <Modal title={`${name} — closings in ${formatYearMonth(month)}`} onClose={onClose}>
        <ActivityTable loans={rows} empty="No closings recorded that month." />
      </Modal>
    );
  }

  /* ── Tarjetas del Qualifier 1 ─────────────────────────────────────────── */
  if (kind === 'closed') {
    return (
      <Modal title={`${name} — closed in ${shortMonth(thisMonth)} so far`} onClose={onClose}>
        <ResolvedTable loans={lo.resolvedLoanDetail} />
      </Modal>
    );
  }
  if (kind === 'pipeline' || kind === 'healthy' || kind === 'projected') {
    const loans =
      kind === 'pipeline'
        ? lo.openLoanDetail
        : kind === 'healthy'
          ? lo.openLoanDetail.filter((l) => l.healthy)
          : /*
             * "Projected to close after PT" cuenta los que cierran ESTE mes:
             * Banked healthy, y Brokered healthy o no (la tasa plana va sobre
             * el total). Es exactamente el conjunto que alimenta el número.
             */
            lo.openLoanDetail.filter(
              (l) => l.closeMonth === thisMonth && (l.channel === 'Brokered' || l.healthy)
            );
    const title =
      kind === 'pipeline' ? 'total pipeline' : kind === 'healthy' ? 'healthy pipeline' : 'loans behind the projection';
    return (
      <Modal title={`${name} — ${title}`} onClose={onClose}>
        {kind === 'projected' && (
          <p className="bp-modal__lead">
            Banked {lo.projection.banked.loans} healthy → {lo.projection.banked.projected.toFixed(2)} · Brokered{' '}
            {lo.projection.brokered.loans} loans → {lo.projection.brokered.projected.toFixed(2)}
          </p>
        )}
        <OpenTable loans={[...loans].sort((a, b) => MILESTONES.indexOf(a.milestone) - MILESTONES.indexOf(b.milestone))} />
      </Modal>
    );
  }
  if (kind === 'forecast') {
    const openThisMonth = lo.openLoanDetail.filter(
      (l) => l.closeMonth === thisMonth && (l.channel === 'Brokered' || l.healthy)
    );
    return (
      <Modal title={`${name} — forecast total for ${shortMonth(thisMonth)}`} onClose={onClose}>
        <p className="bp-modal__lead">
          {lo.resolvedLoanDetail.length} already closed + {openThisMonth.length} still open ={' '}
          <strong>{lo.projection.projectedTotal.toFixed(2)}</strong> projected
        </p>
        <h3 className="bp-modal__subtitle">Already closed</h3>
        <ResolvedTable loans={lo.resolvedLoanDetail} />
        <h3 className="bp-modal__subtitle">Still open</h3>
        <OpenTable loans={openThisMonth} />
      </Modal>
    );
  }

  /* ── Qualifier 2 ──────────────────────────────────────────────────────── */
  if (kind === 'activity') {
    /*
     * Los meses en horizontal, como las tarjetas mensuales del módulo de
     * Actividad: la comparación que importa es mes contra mes.
     */
    return (
      <Modal title={`${name} — commercial activity ${year}`} onClose={onClose}>
        <div className="bp-year-grid">
          {yearMonths.map((m) => (
            <div key={m} className={'bp-year-card' + (m === thisMonth ? ' is-current' : '')}>
              <div className="bp-year-card__month">{shortMonth(m)}</div>
              <YearRow label="Files" value={lo.activity.filesByMonth[m] ?? 0} />
              <YearRow label="Credit" value={lo.activity.creditReportsByMonth[m] ?? 0} />
              <YearRow label="Apps" value={lo.activity.applicationsByMonth[m] ?? 0} />
              <YearRow label="Closed" value={lo.activity.closingsByMonth[m] ?? 0} strong />
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  const metric =
    kind === 'files'
      ? { label: 'File Creations', rows: lo.activity.currentMonthFiles }
      : kind === 'credit'
        ? { label: 'Credit Reports', rows: lo.activity.currentMonthCreditReports }
        : { label: 'Applications', rows: lo.activity.currentMonthApplications };

  return (
    <Modal title={`${name} — ${metric.label} in ${shortMonth(thisMonth)}`} onClose={onClose}>
      {kind === 'apps' && <FolderBreakdown rows={metric.rows} />}
      <ActivityTable loans={metric.rows} empty={`No ${metric.label.toLowerCase()} recorded this month.`} />
    </Modal>
  );
}

/**
 * Desglose por folder de las applications.
 *
 * ⚠ Sólo tiene datos desde la carga de BP9 en adelante: las filas guardadas
 * antes tienen `loan_folder_name` en NULL porque la columna no se persistía.
 * Se dice en pantalla en vez de mostrar un desglose vacío que parezca un cero.
 */
function FolderBreakdown({ rows }: { rows: ActivityLoan[] }) {
  const withFolder = rows.filter((r) => r.loanFolderName);
  if (rows.length === 0) return null;
  if (withFolder.length === 0) {
    return (
      <p className="bp-modal__lead bp-modal__lead--warn">
        Folder breakdown is not available for this batch: the column started being stored in this release, so rows
        loaded earlier have it empty. It will fill in from the next upload.
      </p>
    );
  }
  const byFolder = new Map<string, number>();
  for (const r of withFolder) byFolder.set(r.loanFolderName!, (byFolder.get(r.loanFolderName!) ?? 0) + 1);
  return (
    <p className="bp-modal__lead">
      {[...byFolder.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${n} ${f}`)
        .join(' · ')}
      {withFolder.length < rows.length && ` · ${rows.length - withFolder.length} with no folder recorded`}
    </p>
  );
}

function YearRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={'bp-year-card__row' + (strong ? ' is-strong' : '')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function OpenTable({ loans }: { loans: OpenLoan[] }) {
  if (loans.length === 0) return <p className="bp-modal__lead">No loans in this group.</p>;
  return (
    <table className="piv">
      <thead>
        <tr className="mo-row">
          <th className="lbl">Loan</th>
          <th className="bp-left">Borrower</th>
          <th className="bp-center">Amount</th>
          <th className="bp-center">Channel</th>
          <th className="bp-center">Milestone</th>
          <th className="bp-center">Healthy</th>
          <th className="bp-center">Est. closing</th>
        </tr>
      </thead>
      <tbody>
        {loans.map((l, i) => (
          <tr key={(l.sourceLoanId ?? '') + i} className="metric">
            <td className="lbl">{l.sourceLoanId ?? '—'}</td>
            <td className="bp-left bp-ellipsis">{l.borrowerName ?? '—'}</td>
            <td className="bp-center">{money(l.amount)}</td>
            <td className="bp-center">{l.channel ?? '—'}</td>
            <td className="bp-center">
              {l.milestone}
              {l.rawMilestone && l.rawMilestone !== l.milestone && <span className="bp-chip">{l.rawMilestone}</span>}
            </td>
            <td className="bp-center">{l.healthy ? 'Yes' : 'No'}</td>
            <td className="bp-center">{l.estClosingDate ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResolvedTable({ loans }: { loans: LoanOfficerRow['resolvedLoanDetail'] }) {
  if (loans.length === 0) return <p className="bp-modal__lead">Nothing closed yet this month.</p>;
  return (
    <table className="piv">
      <thead>
        <tr className="mo-row">
          <th className="lbl">Loan</th>
          <th className="bp-left">Borrower</th>
          <th className="bp-center">Amount</th>
          <th className="bp-center">Folder</th>
          <th className="bp-center">Disbursed</th>
        </tr>
      </thead>
      <tbody>
        {loans.map((l, i) => (
          <tr key={(l.sourceLoanId ?? '') + i} className="metric">
            <td className="lbl">
              {l.sourceLoanId ?? '—'}
              {/* El mismo punto verde que Forecast usa para CTC: ya cerró. */}
              <span className="bp-ctc-mark">
                <i className="ctc-dot" />
                closed
              </span>
            </td>
            <td className="bp-left bp-ellipsis">{l.borrowerName ?? '—'}</td>
            <td className="bp-center">{money(l.amount)}</td>
            <td className="bp-center">{l.loanFolder ?? '—'}</td>
            <td className="bp-center">{l.disbursementDate ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Detalle desde Commercial Activity.
 *
 * ---------------------------------------------------------------------------
 * COLUMNAS QUE SE MUESTRAN — se deciden con los datos, no de antemano
 * ---------------------------------------------------------------------------
 * Etapa BP11. Antes había cinco columnas fijas y en la práctica salían tres de
 * guiones: `loan_program` y `loan_folder_name` son NULL en todos los lotes
 * cargados antes de que se persistieran, y `total_loan_amount` viene en 0 en
 * bastantes filas.
 *
 * Mostrar cuatro columnas de guiones es peor que mostrar dos con datos: el
 * lector no puede distinguir "este préstamo no tiene programa" de "todavía no
 * guardamos el programa". Así que cada columna opcional se dibuja SÓLO si al
 * menos una fila la tiene, y si falta se explica en una línea por qué.
 *
 * `Branch` se quitó del todo: estamos dentro del perfil de una persona de un
 * branch conocido, repetirlo en cada fila no aporta nada.
 */
function ActivityTable({ loans, empty }: { loans: ActivityLoan[]; empty: string }) {
  if (loans.length === 0) return <p className="bp-modal__lead">{empty}</p>;

  const has = {
    number: loans.some((l) => l.loanNumber),
    amount: loans.some((l) => l.amount > 0),
    channel: loans.some((l) => l.channel),
    program: loans.some((l) => l.loanProgram),
    folder: loans.some((l) => l.loanFolderName),
  };
  const total = loans.reduce((s, l) => s + l.amount, 0);
  /* Sólo las que están vacías POR FALTA DE CARGA, para el aviso. */
  const pending = [
    !has.number && 'loan number',
    !has.program && 'program',
    !has.folder && 'folder',
  ].filter(Boolean) as string[];

  return (
    <>
      <p className="bp-modal__lead">
        {loans.length} loans
        {has.amount && <> · {money(total)} total</>}
      </p>
      {pending.length > 0 && (
        <p className="bp-modal__lead bp-modal__lead--warn">
          {pending.join(', ')} {pending.length === 1 ? 'is' : 'are'} empty for every row in this batch — those columns
          started being stored in this release and fill in from the next Commercial Activity upload.
        </p>
      )}
      <table className="piv">
        <thead>
          <tr className="mo-row">
            {has.number && <th className="lbl">Loan</th>}
            {has.amount && <th className="bp-center">Amount</th>}
            {has.channel && <th className="bp-center">Channel</th>}
            {has.program && <th className="bp-center">Program</th>}
            {has.folder && <th className="bp-center">Folder</th>}
            {/* Si no quedara ninguna columna, la tabla no tendría sentido. */}
            {!has.number && !has.amount && !has.channel && <th className="lbl">Loans</th>}
          </tr>
        </thead>
        <tbody>
          {loans.map((l, i) => (
            <tr key={(l.loanNumber ?? '') + i} className="metric">
              {has.number && <td className="lbl">{l.loanNumber ?? '—'}</td>}
              {has.amount && <td className="bp-center">{money(l.amount)}</td>}
              {has.channel && <td className="bp-center">{l.channel ?? '—'}</td>}
              {has.program && <td className="bp-center">{l.loanProgram ?? '—'}</td>}
              {has.folder && <td className="bp-center">{l.loanFolderName ?? '—'}</td>}
              {!has.number && !has.amount && !has.channel && <td className="lbl">Loan {i + 1}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
