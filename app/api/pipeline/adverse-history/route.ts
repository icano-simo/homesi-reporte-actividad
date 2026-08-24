import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const PAGE_SIZE = 1000;
/** Tamaño de chunk para .in() -- mismo motivo que INSERT_BATCH_SIZE en /api/pipeline/parse, pero para no armar un filtro .in() gigante en una sola query. */
const ID_BATCH_SIZE = 200;

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Etapa F5g: para cada préstamo actualmente adverse en el snapshot activo,
 * busca el snapshot MÁS VIEJO (menor id -- mismo criterio de orden que ya
 * usa /api/pipeline/retention: id ASC, no snapshot_date, porque puede haber
 * más de una carga el mismo día) donde ese mismo source_loan_id YA
 * aparecía en pipeline_resolved_loans con status='adverse'. Si ese snapshot
 * más viejo encontrado ES el snapshot activo mismo, quiere decir que no hay
 * ningún snapshot anterior con ese préstamo como adverse -- se devuelve
 * `null` para ese loan (el cliente lo muestra como "New this period").
 *
 * "Dado un snapshot activo" (brief) se interpretó igual que ya hacen
 * /api/pipeline/latest y /api/pipeline/retention: sin parámetro, este
 * endpoint siempre opera sobre is_active=true -- page.tsx nunca tiene datos
 * en pantalla que no sean los del snapshot activo (recién subido o
 * restaurado), así que no hace falta que el cliente lo pase.
 *
 * LIMITACIÓN CONOCIDA Y ACEPTADA (no se corrige acá, ver brief de F5g): la
 * retención borra snapshots viejos. Si el snapshot donde un préstamo apareció
 * como adverse por primera vez ya fue borrado, esta función devuelve la
 * fecha del snapshot más viejo que SÍ sobrevivió -- no la fecha real de
 * primera detección. No hay forma de distinguir ese caso de una primera
 * detección genuina sin guardar el historial completo indefinidamente.
 *
 * ⚠ La etapa S2 AGRAVA esta limitación, y conviene que quede dicho acá.
 * Antes la regla era "90 días, salvo is_month_start/is_month_end": un
 * snapshot de julio sobrevivía hasta fines de octubre. Ahora la purga corre
 * el día 15 y borra todo lo que no sea uno de los tres anclajes del mes, así
 * que los snapshots de julio se van el 15 de septiembre. La ventana en la que
 * se puede reconstruir la primera detección real pasa de ~3 meses a ~6
 * semanas.
 *
 * Es el precio deliberado de S2 --certeza sobre el primer y el último día
 * hábil, en lugar de un colchón de 90 días de todo-- y no se compensa acá:
 * la solución de fondo es guardar la primera detección cuando ocurre, no
 * inferirla del historial que haya sobrevivido.
 */
export async function GET() {
  const supabase = await getSupabaseForecast();
  if (!supabase) {
    return NextResponse.json({ firstSeen: {} });
  }

  try {
    const { data: activeSnapshot, error: activeError } = await supabase
      .from('pipeline_snapshots')
      .select('id')
      .eq('is_active', true)
      .maybeSingle();
    if (activeError) throw activeError;
    if (!activeSnapshot) return NextResponse.json({ firstSeen: {} });
    const activeId = activeSnapshot.id as number;

    // 1) source_loan_id de todos los préstamos adverse en el snapshot activo.
    const currentAdverseIds: string[] = [];
    {
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('pipeline_resolved_loans')
          .select('source_loan_id')
          .eq('snapshot_id', activeId)
          .eq('status', 'adverse')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data as { source_loan_id: string }[]) currentAdverseIds.push(row.source_loan_id);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }
    const uniqueIds = [...new Set(currentAdverseIds)];
    if (uniqueIds.length === 0) return NextResponse.json({ firstSeen: {} });

    // 2) TODAS las apariciones adverse (en cualquier snapshot, no solo el
    //    activo) de esos mismos préstamos -- para quedarse con el
    //    snapshot_id más chico (más viejo) por préstamo.
    const earliestSnapshotIdByLoan = new Map<string, number>();
    for (const idsChunk of chunk(uniqueIds, ID_BATCH_SIZE)) {
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('pipeline_resolved_loans')
          .select('source_loan_id, snapshot_id')
          .eq('status', 'adverse')
          .in('source_loan_id', idsChunk)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data as { source_loan_id: string; snapshot_id: number }[]) {
          const prev = earliestSnapshotIdByLoan.get(row.source_loan_id);
          if (prev === undefined || row.snapshot_id < prev) {
            earliestSnapshotIdByLoan.set(row.source_loan_id, row.snapshot_id);
          }
        }
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    // 3) snapshot_date de cada snapshot_id "más viejo" encontrado -- excepto
    //    el propio snapshot activo, que se resuelve como "New this period"
    //    sin necesidad de fecha.
    const earliestIds = [...new Set(earliestSnapshotIdByLoan.values())].filter((id) => id !== activeId);
    const snapshotDateById = new Map<number, string>();
    for (const idsChunk of chunk(earliestIds, ID_BATCH_SIZE)) {
      if (idsChunk.length === 0) continue;
      const { data, error } = await supabase.from('pipeline_snapshots').select('id, snapshot_date').in('id', idsChunk);
      if (error) throw error;
      for (const row of (data ?? []) as { id: number; snapshot_date: string }[]) {
        snapshotDateById.set(row.id, row.snapshot_date);
      }
    }

    const firstSeen: Record<string, string | null> = {};
    for (const sourceLoanId of uniqueIds) {
      const earliestId = earliestSnapshotIdByLoan.get(sourceLoanId);
      firstSeen[sourceLoanId] =
        earliestId === undefined || earliestId === activeId ? null : (snapshotDateById.get(earliestId) ?? null);
    }

    return NextResponse.json({ firstSeen });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
