import { supabase } from './client';
import type { LoanRecord } from '@/lib/domain/types';

const PAGE_SIZE = 1000;

interface LoanRecordRow {
  branch: string;
  loan_officer: string;
  bd: string;
  is_b2b: boolean;
  file_creation_month: string | null;
  credit_report_month: string | null;
  app_date_month: string | null;
  closing_month: string | null;
  total_loan_amount: number | string | null;
}

export interface CurrentReport {
  records: LoanRecord[];
  fileName: string;
  uploadedAt: string;
}

/**
 * Busca el upload_batch con is_current=true (debe haber a lo sumo uno) y
 * reconstruye sus LoanRecord a partir de las columnas YA PROCESADAS de
 * loan_records -- no las _raw -- sin volver a interpretar nada acá; esa
 * interpretación ya la hizo classifyLoan() al momento de guardarlas
 * (saveUpload.ts). Retorna null si no hay ningún batch marcado como actual.
 *
 * Pagina la lectura de loan_records en bloques de 1000 -- PostgREST limita
 * las respuestas a 1000 filas por defecto, y un archivo real como el usado
 * en pruebas (~4300 filas) se vería truncado silenciosamente sin esto.
 */
export async function loadCurrentReport(): Promise<CurrentReport | null> {
  const { data: batch, error: batchError } = await supabase
    .from('upload_batches')
    .select('id, source_file_name, uploaded_at')
    .eq('is_current', true)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) return null;

  const allRows: LoanRecordRow[] = [];
  let from = 0;
  for (;;) {
    const { data: page, error: pageError } = await supabase
      .from('loan_records')
      .select(
        'branch, loan_officer, bd, is_b2b, file_creation_month, credit_report_month, app_date_month, closing_month, total_loan_amount'
      )
      .eq('upload_batch_id', batch.id)
      .range(from, from + PAGE_SIZE - 1);
    if (pageError) throw pageError;
    if (!page || page.length === 0) break;
    allRows.push(...(page as LoanRecordRow[]));
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const records: LoanRecord[] = allRows.map((row) => ({
    branch: row.branch,
    loanOfficer: row.loan_officer,
    bd: row.bd,
    isB2B: row.is_b2b,
    fileCreationMonth: row.file_creation_month,
    creditReportMonth: row.credit_report_month,
    appDateMonth: row.app_date_month,
    closingMonth: row.closing_month,
    // numeric/decimal en Postgres puede volver como string vía PostgREST;
    // Number(...) lo normaliza sin asumir cuál es el caso.
    totalLoanAmount: Number(row.total_loan_amount) || 0,
  }));

  return {
    records,
    fileName: batch.source_file_name,
    uploadedAt: batch.uploaded_at,
  };
}
