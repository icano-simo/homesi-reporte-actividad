import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';
import { parseSalesforcePipelineFile } from '@/lib/pipeline/sources/salesforce-file';
import { parseDataAsOf } from '@/lib/pipeline/dataAsOf';
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
function toPipelineLoanRow(loan: PipelineLoan) {
  return {
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
function toResolvedLoanRow(loan: ResolvedLoan) {
  return {
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
  };
}

/**
 * Lo que devuelve `pipeline_forecast.save_pipeline_snapshot`.
 *
 * Se declara acá y no se infiere: `supabase.rpc()` devuelve `any` para una
 * función que el cliente no conoce, y con `any` un error de tipeo en el nombre
 * de un campo no lo caza nadie.
 */
interface SaveResult {
  snapshot_id: number;
  snapshot_date: string;
  loans_inserted: number;
  resolved_inserted: number;
  is_active: boolean;
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

    // Etapa S1: cuándo generó Salesforce el export, no cuándo se subió (ver
    // lib/pipeline/dataAsOf.ts). `dataAsOf === null` es un resultado válido
    // (nombre de archivo no estándar) -- no bloquea nada, solo se avisa.
    const { dataAsOf, source: dataAsOfSource } = parseDataAsOf(file.name);
    if (!dataAsOf) {
      warnings.push(
        'No se pudo determinar la fecha real del export a partir del nombre de archivo ("' +
          file.name +
          '") -- el snapshot se guarda igual, pero sin fecha de referencia (data_as_of).'
      );
    }

    // Etapa S1: el arreglo del snapshot 13 (80 filas en pipeline_loans, 0 en
    // pipeline_resolved_loans, y aun así guardado como is_active=true -- lo
    // vio el negocio como un pipeline sin cerrados, sin ninguna advertencia).
    // Si cualquiera de las 2 mitades vino vacía, el snapshot se guarda igual
    // (no se pierde el trabajo) pero no se activa.
    const shouldActivate = result.openLoans.length > 0 && result.resolvedLoans.length > 0;
    const needsReview = !shouldActivate;
    if (needsReview) {
      const emptyHalf = result.openLoans.length === 0 ? 'openLoans (pipeline_loans)' : 'resolvedLoans (pipeline_resolved_loans)';
      warnings.push(
        'El archivo vino con ' + emptyHalf + ' vacío -- el snapshot se guardó, pero no se activó. Requiere revisión.'
      );
    }

    // Etapa F5a: persistir en Supabase después de parsear. Un fallo acá NO
    // debe romper la respuesta -- el usuario ya tiene el archivo parseado y
    // puede seguir usándolo esta sesión, solo no va a sobrevivir un reload.
    // El error se agrega a `warnings` (misma lista que ya renderiza la UI),
    // en vez de tragárselo en silencio.
    let persisted = false;
    let saved: SaveResult | null = null;
    const supabase = await getSupabaseForecast();
    if (!supabase) {
      warnings.push('No se pudo guardar en Supabase: faltan las variables de entorno de conexión.');
    } else {
      try {
        // Etapa S1: una sola llamada RPC transaccional, reemplaza el
        // update+insert+insertInBatches x2 sin transacción de antes -- ese
        // era el bug raíz del snapshot 13 (el `statement_timeout=8s` del rol
        // `authenticator` podía cortar a mitad de las tandas, dejando
        // snapshot y algunas filas hijas pero no todas). `snapshot_id` lo
        // asigna la función, no se manda desde acá. Contrato completo
        // (garantías de atomicidad, cálculo de `snapshot_date`, activación)
        // documentado en docs/ARQUITECTURA.md / brief S1 -- no se replica
        // acá para no tener 2 fuentes de verdad.
        const { data: rpcResult, error } = await supabase.rpc('save_pipeline_snapshot', {
          p_file_name: file.name,
          p_data_as_of: dataAsOf ? dataAsOf.toISOString() : null,
          p_data_as_of_source: dataAsOfSource,
          p_loans: result.openLoans.map(toPipelineLoanRow),
          p_resolved: result.resolvedLoans.map(toResolvedLoanRow),
          p_activate: shouldActivate,
        });
        if (error) throw error;

        /*
         * La función devuelve un jsonb con lo que efectivamente escribió:
         * `{ snapshot_id, snapshot_date, loans_inserted, resolved_inserted,
         * is_active }`. Antes se descartaba con `const { error } = ...`, y con
         * él se perdía la única forma de saber CUÁNTO se guardó.
         *
         * Importa justamente por el defecto que motivó esta etapa: el snapshot
         * 13 quedó con 80 abiertos y 0 cerrados. Con los conteos en la
         * respuesta, un caso así se puede ver desde el cliente en vez de
         * descubrirlo semanas después mirando la base.
         */
        saved = (rpcResult ?? null) as SaveResult | null;
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

    return NextResponse.json({ ...result, warnings, persisted, needsReview, saved });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
