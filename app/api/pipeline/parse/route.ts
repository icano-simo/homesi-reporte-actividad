import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';
import { parseSalesforcePipelineFile } from '@/lib/pipeline/sources/salesforce-file';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';

/**
 * Extrae un mensaje legible tanto de un Error nativo como de un error de
 * Supabase/PostgREST (un objeto plano {code,message,details,hint}, no una
 * instancia de Error) -- String(err) sobre ese objeto da '[object Object]'.
 * Mismo helper (por nombre y forma) que ya existe en app/page.tsx y
 * app/pipeline/page.tsx -- se duplica acá porque este archivo corre
 * server-side y esos son client components; no hay un lib/ compartido para
 * esto todavía.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

// parseSalesforcePipelineFile() espera un Buffer (API de Node), no algo que
// exista en el navegador -- por eso el parseo corre acá, server-side, en
// vez de en el cliente. El cálculo de aggregate.ts (puro, sin I/O) sí corre
// en el cliente, sobre el JSON que devuelve este endpoint.
export const runtime = 'nodejs';

const INSERT_BATCH_SIZE = 500;

/**
 * Etapa F5a: cliente propio apuntando al schema 'pipeline_forecast' (mismo
 * patrón ya usado en app/pipeline/page.tsx para branch_managers/branches --
 * no se puede reusar lib/supabase/client.ts, fijo al schema 'activity_report'
 * de Actividad). Usa el mismo anon key que ya usa toda la app -- confirmado
 * con el negocio que NO se usa service_role key; los permisos de
 * lectura/escritura sobre estas 3 tablas ya están dados a nivel de Supabase.
 */
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

/**
 * branch === raw_org_id acá a propósito: confirmado (docs/ARQUITECTURA.md)
 * que el campo `branch` que ya usa el parser ES el True OrgID -- no hay un
 * valor distinto que guardar en raw_org_id, así que se duplica en vez de
 * dejarlo null (la columna existe en pipeline_loans, no hay motivo para
 * perder ese dato).
 */
function toPipelineLoanRow(loan: PipelineLoan, snapshotId: number) {
  return {
    snapshot_id: snapshotId,
    source_loan_id: loan.sourceLoanId,
    branch: loan.branch,
    raw_org_id: loan.branch,
    channel: loan.channel,
    milestone: loan.milestone,
    raw_milestone: loan.rawMilestone,
    healthy: loan.healthy,
    raw_healthiness: loan.rawHealthiness,
    close_month: loan.closeMonth,
    est_closing_date: loan.estClosingDate,
    amount: loan.amount,
    loan_officer: loan.loanOfficer,
    borrower_name: loan.borrowerName,
    milestone_date: loan.milestoneDate,
    branch_transferred: loan.branchTransferred,
    // Fase de persistencia (Loan Type/Loan Program): columnas ya creadas en
    // Supabase (text, nullable) -- mismo patrón que production_support_note_history
    // abajo: paso directo, sin transformar/truncar/normalizar.
    loan_type: loan.loanType,
    loan_program: loan.loanProgram,
    // Fase de persistencia (Notes): columna ya creada en Supabase
    // (text, nullable). Mismo patrón que raw_loan_folder/branch/etc. más
    // abajo en toResolvedLoanRow -- paso directo, sin coerción a null (esa
    // coerción solo aplica a disbursement_date, por ser columna `date`).
    // Valor real de loan.noteHistory, sin resumir/truncar/limpiar.
    production_support_note_history: loan.noteHistory,
  };
}

/**
 * Etapa F5a, hallazgo: pipeline_resolved_loans NO tiene columnas
 * milestone_date ni branch_transferred (confirmado columna por columna con
 * el anon key después de que se agregaron las demás) -- ambos campos son
 * solo informativos en ResolvedLoan (nunca entran a ningún cálculo de
 * Forecast), así que se omiten acá en vez de bloquear toda la etapa por
 * esto. Reportado explícito en la respuesta de esta etapa, no silenciado.
 */
function toResolvedLoanRow(loan: ResolvedLoan, snapshotId: number) {
  return {
    snapshot_id: snapshotId,
    source_loan_id: loan.sourceLoanId,
    branch: loan.branch,
    channel: loan.channel,
    status: loan.status,
    // ResolvedLoan.disbursementDate está tipado 'string' (no nullable) y cae
    // a '' cuando el parser no logra derivar ninguna fecha -- Postgres
    // rechaza '' para una columna `date` (pide NULL). Se convierte acá, en
    // el mapeo de inserción, sin tocar el tipo ni el parser.
    disbursement_date: loan.disbursementDate || null,
    amount: loan.amount,
    loan_officer: loan.loanOfficer,
    borrower_name: loan.borrowerName,
    loan_status: loan.loanStatus,
    est_closing_date: loan.estClosingDate,
    // Etapa F5n: raw_loan_folder ya existe en pipeline_resolved_loans (columna
    // agregada por SQL fuera de esta etapa) -- a diferencia de raw_milestone,
    // milestone_date y branch_transferred (ver comentario arriba), esta sí
    // se puede guardar.
    raw_loan_folder: loan.rawLoanFolder,
    // Fase de persistencia (Loan Type/Loan Program): mismo motivo/patrón que
    // raw_loan_folder arriba -- columnas ya creadas, paso directo.
    loan_type: loan.loanType,
    loan_program: loan.loanProgram,
    // Fase de persistencia (Notes): mismo motivo/patrón que raw_loan_folder
    // arriba -- columna text/nullable ya creada, paso directo del valor real.
    production_support_note_history: loan.noteHistory,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = parseSalesforcePipelineFile(buffer);
    const warnings = [...result.warnings];

    // Etapa F5a: persistir en Supabase después de parsear. Un fallo acá NO
    // debe romper la respuesta -- el usuario ya tiene el archivo parseado y
    // puede seguir usándolo esta sesión, solo no va a sobrevivir un reload.
    // El error se agrega a `warnings` (misma lista que ya renderiza la UI),
    // en vez de tragárselo en silencio.
    let persisted = false;
    const supabase = await getSupabaseForecast();
    if (!supabase) {
      warnings.push('No se pudo guardar en Supabase: faltan las variables de entorno de conexión.');
    } else {
      // Función interna (no un helper top-level): así el tipo de `supabase`
      // (ya angosto a "no null" acá adentro) se captura por inferencia de
      // closure, sin tener que escribir a mano el tipo genérico completo de
      // SupabaseClient<...> con schema fijo -- eso es lo que rompía el build
      // (mismatch de tipos entre versiones del generic de supabase-js).
      const insertInBatches = async (table: string, rows: Record<string, unknown>[]): Promise<void> => {
        for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
          const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
          const { error } = await supabase.from(table).insert(chunk);
          if (error) throw error;
        }
      };

      try {
        // Solo puede haber UN snapshot con is_active=true a la vez.
        const { error: clearActiveError } = await supabase
          .from('pipeline_snapshots')
          .update({ is_active: false })
          .eq('is_active', true);
        if (clearActiveError) throw clearActiveError;

        const { data: snapshot, error: snapshotError } = await supabase
          .from('pipeline_snapshots')
          .insert({
            file_name: file.name,
            row_count: result.openLoans.length + result.resolvedLoans.length,
            uploaded_at: new Date().toISOString(),
            snapshot_date: new Date().toISOString().slice(0, 10),
            is_active: true,
          })
          .select('id')
          .single();
        if (snapshotError) throw snapshotError;
        if (!snapshot) throw new Error('No se pudo crear el snapshot (sin id de retorno).');

        await insertInBatches(
          'pipeline_loans',
          result.openLoans.map((loan) => toPipelineLoanRow(loan, snapshot.id as number))
        );
        await insertInBatches(
          'pipeline_resolved_loans',
          result.resolvedLoans.map((loan) => toResolvedLoanRow(loan, snapshot.id as number))
        );

        persisted = true;
      } catch (persistErr) {
        const msg = errorMessage(persistErr);
        warnings.push(
          'No se pudo guardar en Supabase: ' +
            msg +
            ' -- los datos se muestran igual esta sesión, pero no vas a poder recuperarlos al recargar la página.'
        );
      }
    }

    return NextResponse.json({ ...result, warnings, persisted });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
