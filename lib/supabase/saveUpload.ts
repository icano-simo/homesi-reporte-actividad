import { getSupabaseClient } from './client';
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
  // Etapa UX1b: el cliente se resuelve acá adentro, no al importar el módulo
  // (ver la nota larga en client.ts). Si faltan las env vars, esto lanza y el
  // rechazo llega al `.catch` de app/page.tsx como cualquier otro fallo.
  const supabase = getSupabaseClient();

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
      /*
       * Etapa BP9. El parser ya leía estas tres del archivo (están en
       * OPTIONAL_COLUMNS) pero no se guardaban: vivían en memoria y se perdían
       * al recargar. Las columnas ya existen en `activity_report.loan_records`.
       *
       * Sin esto, el detalle de Applications de Business Plan no puede
       * desagregar por folder -- que es exactamente lo que se pidió.
       *
       * ⚠ Las filas ya cargadas quedan en NULL: se guardaron antes. El desglose
       * por folder recién tiene datos completos desde la próxima carga.
       */
      /*
       * Etapa BP11. `loan_number` está en REQUIRED_COLUMNS -- el archivo lo trae
       * SIEMPRE y el parser lo leía; lo que faltaba era guardarlo, igual que las
       * otras tres. (En BP9 se reportó por error que Commercial Activity no
       * traía el número de préstamo: sí lo trae. Lo que no trae es el nombre del
       * prestatario, y eso sigue siendo cierto.)
       */
      loan_number: record.loanNumber || null,
      loan_program: record.loanProgram || null,
      loan_folder_name: record.loanFolderName || null,
      affinity: record.affinity || null,
    };
  });

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error: insertRowsError } = await supabase.from('loan_records').insert(chunk);
    if (insertRowsError) throw insertRowsError;
  }
}
