import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';

export const runtime = 'nodejs';

const PAGE_SIZE = 1000;

/** Ver el mismo helper en app/api/pipeline/parse/route.ts -- duplicado por el mismo motivo (sin lib/ compartido server-side todavía). */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Etapa AUTH1: pasa a construirse desde las COOKIES de la request, o sea con
 * la sesión del usuario que hizo la llamada. Antes usaba la anon key sin
 * autenticar, y desde que se activó RLS en `pipeline_forecast` eso no lee ni
 * escribe nada. Como esta ruta la llama el navegador (same-origin), la cookie
 * de sesión llega sola -- no hace falta `service_role` ni pasar el token a
 * mano. Devuelve null si faltan las env vars, igual que antes.
 */
async function getSupabaseForecast() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  return getServerClient('pipeline_forecast');
}

interface PipelineLoanRow {
  source_loan_id: string;
  branch: string;
  channel: PipelineLoan['channel'];
  milestone: PipelineLoan['milestone'];
  raw_milestone: string;
  healthy: boolean | null;
  raw_healthiness: string;
  close_month: string;
  est_closing_date: string | null;
  amount: number | string | null;
  loan_officer: string;
  borrower_name: string;
  milestone_date: string | null;
  branch_transferred: boolean;
  loan_type: string | null;
  loan_program: string | null;
  production_support_note_history: string | null;
}

interface ResolvedLoanRow {
  source_loan_id: string;
  branch: string;
  channel: ResolvedLoan['channel'];
  status: ResolvedLoan['status'];
  disbursement_date: string;
  amount: number | string | null;
  loan_officer: string;
  borrower_name: string;
  loan_status: string;
  est_closing_date: string | null;
  raw_loan_folder: string;
  loan_type: string | null;
  loan_program: string | null;
  production_support_note_history: string | null;
}

/**
 * Etapa F5a: GET del último snapshot activo (is_active=true) con sus
 * préstamos, para restaurarlo al abrir la página sin haber subido nada en
 * esta sesión. `snapshot: null` (sin error) es la respuesta normal cuando
 * todavía no hay nada guardado -- no es una condición de error.
 */
export async function GET() {
  const supabase = await getSupabaseForecast();
  if (!supabase) {
    return NextResponse.json({ snapshot: null });
  }

  // Función interna (no un helper top-level con `supabase` como parámetro
  // tipado a mano): mismo motivo que en /api/pipeline/parse -- el tipo de
  // `supabase` (angosto a "no null" acá) se captura por inferencia de
  // closure, evitando el mismatch de tipos entre versiones del generic de
  // supabase-js que rompía el build con una anotación explícita.
  const fetchAllPages = async <T,>(table: string, columns: string, snapshotId: number): Promise<T[]> => {
    const all: T[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .eq('snapshot_id', snapshotId)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as T[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  };

  try {
    const { data: snapshot, error: snapshotError } = await supabase
      .from('pipeline_snapshots')
      .select('id, file_name, uploaded_at')
      .eq('is_active', true)
      .maybeSingle();
    if (snapshotError) throw snapshotError;
    if (!snapshot) return NextResponse.json({ snapshot: null });

    const snapshotId = snapshot.id as number;

    const loanRows = await fetchAllPages<PipelineLoanRow>(
      'pipeline_loans',
      'source_loan_id, branch, channel, milestone, raw_milestone, healthy, raw_healthiness, close_month, est_closing_date, amount, loan_officer, borrower_name, milestone_date, branch_transferred, loan_type, loan_program, production_support_note_history',
      snapshotId
    );
    const resolvedRows = await fetchAllPages<ResolvedLoanRow>(
      'pipeline_resolved_loans',
      'source_loan_id, branch, channel, status, disbursement_date, amount, loan_officer, borrower_name, loan_status, est_closing_date, raw_loan_folder, loan_type, loan_program, production_support_note_history',
      snapshotId
    );

    const openLoans: PipelineLoan[] = loanRows.map((r) => ({
      sourceLoanId: r.source_loan_id,
      branch: r.branch,
      channel: r.channel,
      milestone: r.milestone,
      healthy: r.healthy,
      closeMonth: r.close_month,
      amount: Number(r.amount) || 0,
      loanOfficer: r.loan_officer,
      rawMilestone: r.raw_milestone,
      rawHealthiness: r.raw_healthiness,
      estClosingDate: r.est_closing_date,
      borrowerName: r.borrower_name,
      milestoneDate: r.milestone_date,
      branchTransferred: r.branch_transferred,
      // Bug fix (persistencia Loan Type/Loan Program): la columna ya existe
      // y ya se lee (ver el SELECT más arriba) -- `?? ''` cubre únicamente
      // el NULL real de Postgres, mismo criterio que noteHistory abajo. Ya
      // no queda hardcodeado en '' -- ese era exactamente el bug: el valor
      // llegaba bien recién subido el Excel, pero se perdía al recargar
      // porque acá nunca se leía la columna aunque el INSERT (una vez
      // corregido en /api/pipeline/parse) sí la escribe.
      loanType: r.loan_type ?? '',
      loanProgram: r.loan_program ?? '',
      // Fase de persistencia (Notes): la columna ya existe y ya se lee (ver
      // el SELECT más arriba) -- `?? ''` cubre únicamente el NULL real de
      // Postgres (nota vacía o filas guardadas antes de que existiera la
      // columna), mismo criterio que el resto de los campos opcionales de
      // este mapeo. Ya no queda hardcodeado.
      noteHistory: r.production_support_note_history ?? '',
    }));

    // milestoneDate/branchTransferred quedan en su default (null/false): la
    // tabla pipeline_resolved_loans no tiene esas 2 columnas (ver
    // toResolvedLoanRow en /api/pipeline/parse) -- no se puede restaurar lo
    // que nunca se guardó, y ninguno de los 2 afecta ningún cálculo.
    // Etapa F5g: rawMilestone se agregó a ResolvedLoan (fix mecánico de tipo,
    // fuera de la lista de archivos de F5g, ver reporte de esa etapa) -- por
    // el mismo motivo que milestoneDate/branchTransferred, pipeline_resolved_loans
    // tampoco tiene una columna raw_milestone todavía, así que queda en '' al
    // restaurar desde Supabase (Last Finished Milestone en AdverseTable
    // aparece vacío después de un reload, no en la carga recién subida).
    // Etapa F5n: raw_loan_folder ya se guarda y se lee de verdad (columna
    // agregada por SQL) -- ya NO queda hardcodeado en '', a diferencia de
    // rawMilestone (sigue sin columna raw_milestone, ver comentario arriba).
    // La regla de "excluir Brokered en Current Prospects" (F5m) ahora sí
    // funciona también para datos restaurados desde Supabase, no solo en la
    // carga recién subida.
    const resolvedLoans: ResolvedLoan[] = resolvedRows.map((r) => ({
      sourceLoanId: r.source_loan_id,
      branch: r.branch,
      channel: r.channel,
      status: r.status,
      disbursementDate: r.disbursement_date,
      amount: Number(r.amount) || 0,
      loanOfficer: r.loan_officer,
      borrowerName: r.borrower_name,
      milestoneDate: null,
      branchTransferred: false,
      loanStatus: r.loan_status,
      estClosingDate: r.est_closing_date,
      rawMilestone: '',
      rawLoanFolder: r.raw_loan_folder,
      // Bug fix (persistencia Loan Type/Loan Program): mismo motivo que en
      // openLoans arriba -- la columna ya existe y ya se lee.
      loanType: r.loan_type ?? '',
      loanProgram: r.loan_program ?? '',
      // Fase de persistencia (Notes): mismo motivo que en openLoans arriba --
      // la columna ya existe y ya se lee, `?? ''` solo cubre NULL real.
      noteHistory: r.production_support_note_history ?? '',
    }));

    return NextResponse.json({
      snapshot: { fileName: snapshot.file_name, uploadedAt: snapshot.uploaded_at },
      openLoans,
      resolvedLoans,
      warnings: [],
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
