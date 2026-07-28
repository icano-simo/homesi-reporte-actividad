import { supabase } from './client';
import type { LoanRecord } from '@/lib/domain/types';
import type { RawLoanRow } from '@/lib/parsing/types';

const INSERT_BATCH_SIZE = 500;

/**
 * Guarda un upload_batch + sus loan_records en Supabase. No recalcula nada:
 * records/rawRows ya vienen de readWorkbook()+classifyLoan(), este módulo
 * solo los transforma a filas de las tablas de activity_report.
 *
 * Esta función deja que los errores de Supabase se propaguen (throw) en vez
 * de tragárselos acá adentro: quien la llama (app/page.tsx) la dispara sin
 * esperarla para no bloquear el render, y es ahí donde un try/catch alrededor
 * del llamado evita que un fallo de red rompa la UI, mostrando el error en
 * un indicador en vez de silenciarlo por completo.
 */
export async function saveUpload(records: LoanRecord[], rawRows: RawLoanRow[], fileName: string): Promise<void> {
  // 1. Solo puede haber UN batch con is_current=true a la vez.
  const { error: clearCurrentError } = await supabase
    .from('upload_batches')
    .update({ is_current: false })
    .eq('is_current', true);
  if (clearCurrentError) throw clearCurrentError;

  // 2. Insertar el nuevo batch como el current.
  const { data: batch, error: insertBatchError } = await supabase
    .from('upload_batches')
    .insert({
      source_file_name: fileName,
      row_count: records.length,
      is_current: true,
    })
    .select('id')
    .single();
  if (insertBatchError) throw insertBatchError;
  if (!batch) throw new Error('No se pudo crear el upload_batch (sin id de retorno).');

  // 3. Insertar los loan_records en lotes, para no exceder límites de tamaño
  //    de request cuando records.length es grande (miles de filas).
  const rows = records.map((record, i) => {
    const raw = rawRows[i];
    return {
      upload_batch_id: batch.id,
      // Columnas crudas: valores de RawLoanRow, tal cual salieron del parsing.
      true_org_id_raw: raw.trueOrgId,
      loan_officer_raw: raw.loanOfficer,
      bd_raw: raw.bd,
      b2b_loans_raw: raw.b2bLoans,
      loan_info_channel_raw: raw.loanInfoChannel,
      file_creation_raw: raw.fileCreationMonth,
      credit_report_raw: raw.creditReportMonth,
      app_date_raw: raw.appDateMonth,
      milestone_funding_raw: raw.fundingMonth,
      milestone_completion_raw: raw.completionMonth,
      total_loan_amount: raw.totalLoanAmount,
      // Columnas procesadas: valores de LoanRecord, ya interpretados por classifyLoan().
      branch: record.branch,
      loan_officer: record.loanOfficer,
      bd: record.bd,
      is_b2b: record.isB2B,
      file_creation_month: record.fileCreationMonth,
      credit_report_month: record.creditReportMonth,
      app_date_month: record.appDateMonth,
      closing_month: record.closingMonth,
    };
  });

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error: insertRowsError } = await supabase.from('loan_records').insert(chunk);
    if (insertRowsError) throw insertRowsError;
  }
}
