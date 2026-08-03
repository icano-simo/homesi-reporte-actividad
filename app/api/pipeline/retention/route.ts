import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const RETENTION_DAYS = 90;

function getSupabaseForecast() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, { db: { schema: 'pipeline_forecast' } });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Etapa F5b: tarea diaria (Vercel Cron, ver vercel.json) que marca
 * is_month_start/is_month_end y borra snapshots de >90 días que no tengan
 * ninguno de los dos flags. Protegida con el header Authorization que
 * Vercel Cron ya inyecta automáticamente cuando existe CRON_SECRET en las
 * variables de entorno del proyecto -- si CRON_SECRET no está configurado,
 * el endpoint rechaza TODO (fail closed), no queda abierto por default.
 */
export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!expectedSecret || authHeader !== 'Bearer ' + expectedSecret) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const supabase = getSupabaseForecast();
  if (!supabase) {
    return NextResponse.json({ error: 'Faltan variables de entorno de conexión a Supabase.' }, { status: 500 });
  }

  try {
    const { data: snapshots, error: fetchError } = await supabase
      .from('pipeline_snapshots')
      .select('id, snapshot_date, is_month_start, is_month_end')
      .order('id', { ascending: true });
    if (fetchError) throw fetchError;

    const monthStartsMarked: number[] = [];
    const monthEndsMarked: number[] = [];

    if (snapshots && snapshots.length) {
      const currentMonth = monthKey(new Date().toISOString().slice(0, 10));

      // "Primer"/"último" snapshot de un mes se decide por orden de
      // inserción (id ASC, ya viene ordenado así de la query), no solo por
      // snapshot_date -- puede haber más de una carga el mismo día.
      const firstIdByMonth = new Map<string, number>();
      const lastIdByMonth = new Map<string, number>();
      for (const s of snapshots) {
        const mk = monthKey(s.snapshot_date);
        if (!firstIdByMonth.has(mk)) firstIdByMonth.set(mk, s.id);
        lastIdByMonth.set(mk, s.id);
      }

      const monthStartIds = new Set(firstIdByMonth.values());
      // Un mes "cerrado" es cualquier mes distinto al actual -- su snapshot
      // más reciente (el último visto en el loop de arriba) es su cierre.
      const monthEndIds = new Set(
        [...lastIdByMonth.entries()].filter(([mk]) => mk !== currentMonth).map(([, id]) => id)
      );

      for (const s of snapshots) {
        if (monthStartIds.has(s.id) && !s.is_month_start) {
          const { error } = await supabase.from('pipeline_snapshots').update({ is_month_start: true }).eq('id', s.id);
          if (error) throw error;
          monthStartsMarked.push(s.id);
        }
        if (monthEndIds.has(s.id) && !s.is_month_end) {
          const { error } = await supabase.from('pipeline_snapshots').update({ is_month_end: true }).eq('id', s.id);
          if (error) throw error;
          monthEndsMarked.push(s.id);
        }
      }
    }

    // Borrado: snapshot_date < hoy-90días Y is_month_start=false Y is_month_end=false.
    // Se borra explícito pipeline_loans/pipeline_resolved_loans primero, sin
    // asumir ON DELETE CASCADE a nivel de esquema (no confirmado).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    const { data: toDelete, error: toDeleteError } = await supabase
      .from('pipeline_snapshots')
      .select('id')
      .lt('snapshot_date', cutoffISO)
      .eq('is_month_start', false)
      .eq('is_month_end', false);
    if (toDeleteError) throw toDeleteError;

    const deletedSnapshots: number[] = [];
    let deletedLoanRows = 0;
    let deletedResolvedRows = 0;

    for (const row of toDelete ?? []) {
      const { error: delLoansError, count: loansCount } = await supabase
        .from('pipeline_loans')
        .delete({ count: 'exact' })
        .eq('snapshot_id', row.id);
      if (delLoansError) throw delLoansError;
      deletedLoanRows += loansCount ?? 0;

      const { error: delResolvedError, count: resolvedCount } = await supabase
        .from('pipeline_resolved_loans')
        .delete({ count: 'exact' })
        .eq('snapshot_id', row.id);
      if (delResolvedError) throw delResolvedError;
      deletedResolvedRows += resolvedCount ?? 0;

      const { error: delSnapshotError } = await supabase.from('pipeline_snapshots').delete().eq('id', row.id);
      if (delSnapshotError) throw delSnapshotError;
      deletedSnapshots.push(row.id);
    }

    return NextResponse.json({
      monthStartsMarked,
      monthEndsMarked,
      cutoffDate: cutoffISO,
      deletedSnapshots,
      deletedLoanRows,
      deletedResolvedRows,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
