import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * ============================================================================
 * ¿LLEGÓ TODO? — la comprobación cruzada de la carga (etapa RPT5)
 * ============================================================================
 *
 * Dos chequeos, y los dos tienen una población EXACTA. Eso es lo que los hace
 * accionables: un número distinto de cero es siempre un problema, nunca ruido.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ NO SE COMPARA CONTRA `loan_records_v2` "ABIERTOS"
 * ---------------------------------------------------------------------------
 *
 * Era la idea original y NO SE PUEDE. Medido, en este orden:
 *
 *   1. Comparar totales por canal da 266 Brokered abiertos contra 31 en el
 *      snapshot. No significa nada: `loan_records_v2` arrastra años.
 *
 *   2. Acotar por `app_date` de los últimos 12 meses deja 529 contra 445, un
 *      hueco de 84. Parecía razonable -- hasta que se mira QUIÉNES son los 13
 *      préstamos Brokered que sabemos que faltan: LOS TRECE TIENEN `app_date`
 *      EN NULL. El filtro excluía exactamente lo que había que detectar. El
 *      chequeo habría reportado cero y el agujero seguiría invisible.
 *
 *   3. Sin `app_date` quedan 3.815 abiertos, de los cuales 3.808 no están en
 *      ningún snapshot. Buscando qué separa a los 13 de esos 3.808 --fecha de
 *      creación del file, monto, programa, reporte de crédito, carpeta-- no hay
 *      ningún campo que los distinga.
 *
 *      ⚠ Y NO ES UNA ANOMALÍA, ES UNA POBLACIÓN ENTERA: `Current Prospects`
 *      tiene 3.480 abiertos y 3.467 nunca estuvieron en ningún snapshot. Los 13
 *      son la parte de esa población que además es Brokered y tenía cierre
 *      estimado en agosto. Cualquier filtro que los incluya arrastra miles.
 *
 * La razón es estructural y no se arregla eligiendo mejor el filtro: el
 * snapshot contiene lo que Salesforce tiene en `Stage = Negotiation`, y
 * `loan_records_v2` NO TRAE STAGE. `Current Prospects` son files que existen y
 * todavía no entraron al pipeline; el snapshot los excluye con razón. Las dos
 * fuentes no comparten el campo que define la población, así que compararlas
 * sólo puede dar mil falsos positivos o tapar los trece.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS CHEQUEOS QUE SÍ SIRVEN
 * ---------------------------------------------------------------------------
 *
 * 1. SE ESFUMARON. Préstamos abiertos en el snapshot anterior que en el actual
 *    no están ni abiertos ni resueltos. Población exacta: la del snapshot
 *    anterior, sin fuente externa ni criterio discutible. Detecta escrituras
 *    parciales y filas perdidas.
 *    Histórico: 9 una vez --el 3 de agosto, que es el defecto ya documentado
 *    del snapshot 13-- y 0 en los 22 snapshots siguientes.
 *
 * 2. CERRARON SIN HABER ESTADO. Préstamos que `loan_records_v2` da por cerrados
 *    en el mes y cuyo número no aparece en NINGÚN snapshot, ni abierto ni
 *    resuelto. Población exacta: un préstamo cerrado es cerrado en las dos
 *    fuentes, sin Stage de por medio. Mide directamente el punto ciego del
 *    forecast: negocio real que el pipeline nunca vio.
 *    Histórico: 0 en junio, 2 en julio, 0 en agosto, sobre 141 cierres.
 *
 * ⚠ LO QUE ESTOS DOS NO HACEN, dicho para que nadie confíe de más: NINGUNO
 * habría detectado los 13 el 6 de agosto. No se esfumaron --nunca estuvieron--
 * y no habían cerrado. El chequeo 2 los va a levantar el día que alguno cierre,
 * que es justo cuando empiezan a importar para el forecast. Detectarlos ANTES
 * requiere el Stage, y el Stage sólo está en el origen: es un chequeo del job
 * del sync, no de este repo.
 */

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface IntegrityReport {
  activeSnapshotId: number | null;
  activeSnapshotDate: string | null;
  /** El snapshot con el que se comparó. `null` si el activo es el primero. */
  previousSnapshotId: number | null;
  previousSnapshotDate: string | null;
  /** Abiertos en el anterior que en el activo no están en ninguna de las dos tablas. */
  vanished: string[];
  /** Cerrados según Commercial Activity que ningún snapshot tuvo nunca. */
  closedNeverInPipeline: { loanNumber: string; channel: string; branch: string; closingMonth: string }[];
  /**
   * El mes que se miró, 'YYYY-MM'.
   *
   * ⚠ EL CHEQUEO 2 RESPETA EL SELECTOR DE MES — corrección posterior a RPT5. La
   * primera versión miraba tres meses hacia atrás desde hoy, así que estando en
   * agosto mostraba dos préstamos que cerraron en JULIO. Un aviso que habla de
   * otro mes que el que la pantalla muestra se lee como si fuera de este, y
   * manda a buscar un problema donde no está.
   *
   * ⚠ El chequeo 1 NO depende del mes y no puede: compara el snapshot anterior
   * contra el activo, sin ninguna fecha de por medio. Su texto lo dice --habla
   * de la última carga-- en vez de dejar que se lea como si fuera del mes.
   */
  month: string;
  /** Avisos guardados de la carga del snapshot activo. `null` = la columna no existe todavía. */
  activeWarnings: string[] | null;
}

/** El primer y el último día de un mes 'YYYY-MM'. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export async function GET(request: Request) {
  try {
    /*
     * El mes que muestra la pantalla. Sin él no hay chequeo posible: 400 y no un
     * default, porque un default silencioso es lo que produjo el aviso de julio
     * apareciendo en agosto.
     */
    const month = new URL(request.url).searchParams.get('month') ?? '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
    }
    const pf = await getServerClient('pipeline_forecast');
    const ar = await getServerClient('activity_report');

    const { data: snaps, error: e1 } = await pf
      .from('pipeline_snapshots')
      .select('id, snapshot_date, is_active')
      .order('snapshot_date', { ascending: true });
    if (e1) throw e1;
    const all = (snaps ?? []) as { id: number; snapshot_date: string; is_active: boolean }[];
    const iActive = all.findIndex((s) => s.is_active);
    if (iActive < 0) {
      return NextResponse.json({ error: 'There is no active snapshot.' }, { status: 409 });
    }
    const active = all[iActive];
    const previous = iActive > 0 ? all[iActive - 1] : null;

    const ids = async (table: string, snapshotId: number): Promise<Set<string>> => {
      const out = new Set<string>();
      let from = 0;
      for (;;) {
        const { data, error } = await pf
          .from(table)
          .select('source_loan_id')
          .eq('snapshot_id', snapshotId)
          .range(from, from + 999);
        if (error) throw error;
        const rows = (data ?? []) as { source_loan_id: string }[];
        for (const r of rows) out.add(r.source_loan_id);
        if (rows.length < 1000) break;
        from += 1000;
      }
      return out;
    };

    /* ── 1. Se esfumaron ────────────────────────────────────────────────── */
    let vanished: string[] = [];
    if (previous) {
      const antes = await ids('pipeline_loans', previous.id);
      const ahoraAbiertos = await ids('pipeline_loans', active.id);
      const ahoraResueltos = await ids('pipeline_resolved_loans', active.id);
      vanished = [...antes].filter((x) => !ahoraAbiertos.has(x) && !ahoraResueltos.has(x)).sort();
    }

    /*
     * ── 2. Cerraron sin haber estado ────────────────────────────────────
     *
     * El universo de "estuvo alguna vez" se arma sobre TODOS los snapshots, no
     * sólo el activo: un préstamo que estuvo abierto en junio y cerró en julio
     * sí fue visto por el pipeline, y no es un hallazgo.
     */
    const vistos = new Set<string>();
    for (const tabla of ['pipeline_loans', 'pipeline_resolved_loans']) {
      let from = 0;
      for (;;) {
        const { data, error } = await pf.from(tabla).select('source_loan_id').range(from, from + 999);
        if (error) throw error;
        const rows = (data ?? []) as { source_loan_id: string }[];
        for (const r of rows) vistos.add(r.source_loan_id);
        if (rows.length < 1000) break;
        from += 1000;
      }
    }

    const { from: desde, to: hasta } = monthBounds(month);
    const cerrados: { loan_number: string; loan_channel: string; branch: string; closing_month: string }[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await ar
        .from('loan_records_v2')
        .select('loan_number, loan_channel, branch, closing_month')
        .eq('is_closed', true)
        .gte('closing_month', desde)
        .lte('closing_month', hasta)
        .order('loan_number', { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      const rows = (data ?? []) as typeof cerrados;
      cerrados.push(...rows);
      if (rows.length < 1000) break;
      from += 1000;
    }
    const closedNeverInPipeline = cerrados
      .filter((r) => !vistos.has(r.loan_number))
      .map((r) => ({
        loanNumber: r.loan_number,
        channel: r.loan_channel,
        branch: r.branch,
        closingMonth: String(r.closing_month).slice(0, 7),
      }));

    /*
     * Los avisos guardados del snapshot activo. Si la columna todavía no existe
     * --el SQL lo aplica quien administra la base-- se devuelve `null`, que es
     * distinto de "no hubo avisos".
     */
    let activeWarnings: string[] | null = null;
    const { data: wRow, error: wErr } = await pf
      .from('pipeline_snapshots')
      .select('warnings')
      .eq('id', active.id)
      .maybeSingle();
    if (!wErr && wRow) {
      const w = (wRow as { warnings: unknown }).warnings;
      activeWarnings = Array.isArray(w) ? w.map((x) => String(x)) : null;
    }

    const report: IntegrityReport = {
      activeSnapshotId: active.id,
      activeSnapshotDate: active.snapshot_date,
      previousSnapshotId: previous?.id ?? null,
      previousSnapshotDate: previous?.snapshot_date ?? null,
      vanished,
      closedNeverInPipeline,
      month,
      activeWarnings,
    };
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
