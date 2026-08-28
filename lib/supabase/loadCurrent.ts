import { getSupabaseClient, isSupabaseConfigured } from './client';
import { classifyBranch } from '@/lib/domain/classifyBranch';
import type { LoanRecord } from '@/lib/domain/types';
import type { YearMonth } from '@/lib/parsing/types';

const PAGE_SIZE = 1000;

/** Nombre de la fuente, para el pill que antes mostraba el archivo cargado. */
const SOURCE_LABEL = 'lending_marts.fct_commercial_activity (BigQuery)';

/**
 * Una fila de `activity_report.loan_records_v2`.
 *
 * ⚠ Las cuatro fechas son `date` en Postgres, no texto 'YYYY-MM' como en la
 * tabla vieja. PostgREST las serializa como 'YYYY-MM-DD'; el `.slice(0, 7)` de
 * `monthOf()` las lleva al mes. Ver el comentario de esa función.
 */
interface LoanRecordV2Row {
  branch: string | null;
  loan_officer: string | null;
  bd: string | null;
  is_b2b: boolean;
  file_creation_date: string | null;
  credit_report_date: string | null;
  app_date: string | null;
  closing_month: string | null;
  total_loan_amount: number | string | null;
  loan_number: string | null;
  loan_program: string | null;
  loan_folder_name: string | null;
  is_affinity: boolean;
  loan_channel: string | null;
  counts_for_division: boolean;
  synced_at: string;
  /* Etapa V3. `nppm_realtor` llega siempre NULL hoy -- ver LoanRecord.nppmRealtor. */
  strategy: string | null;
  opportunity_owner: string | null;
  nppm_realtor: string | null;
  referred_by_realtor: string | null;
  nppm_recruited_by: string | null;
}

const COLUMNS =
  'branch, loan_officer, bd, is_b2b, file_creation_date, credit_report_date, app_date, ' +
  'closing_month, total_loan_amount, loan_number, loan_program, loan_folder_name, ' +
  'is_affinity, loan_channel, counts_for_division, synced_at, ' +
  // Etapa V3: estrategia y su contexto. Ver LoanRecord para el estado real de
  // cada una -- `nppm_realtor` existe pero hoy no trae ni un valor.
  'strategy, opportunity_owner, nppm_realtor, referred_by_realtor, nppm_recruited_by';

export interface CurrentReport {
  records: LoanRecord[];
  fileName: string;
  uploadedAt: string;
}

/**
 * ⚠ `date` -> `YearMonth`. Las columnas de v2 son fechas de día exacto
 * (`file_creation_date`, `credit_report_date`, `app_date`) o el primer día del
 * mes (`closing_month`); la app agrupa y compara por mes 'YYYY-MM' en todos
 * lados, así que el corte se hace UNA vez, acá, al entrar el dato.
 *
 * `slice(0, 7)` sobre el texto y no `new Date(...)`: construir un Date desde
 * 'YYYY-MM-DD' lo interpreta como UTC medianoche, y en cualquier huso al oeste
 * de Greenwich `getMonth()` devuelve el mes anterior para los días 1. Con
 * `closing_month` --que ES siempre día 1-- eso corrompería todos los cierres.
 * Es el mismo criterio que `closesInMonth()` en el Business Plan.
 */
function monthOf(date: string | null): YearMonth | null {
  return date ? date.slice(0, 7) : null;
}

/**
 * ============================================================================
 * LECTURA DE LA ACTIVIDAD COMERCIAL — etapa V2
 * ============================================================================
 *
 * Lee `activity_report.loan_records_v2`, que llega desde BigQuery
 * (`lending_marts.fct_commercial_activity`) vía simo-sync, ya conciliada
 * contra la tabla vieja en las cuatro métricas durante ocho meses.
 *
 * ---------------------------------------------------------------------------
 * ⚠ YA NO HAY LOTE: LA PANTALLA MUESTRA EL ESTADO ACTUAL, NO UNA FOTO
 * ---------------------------------------------------------------------------
 * El grano de v2 es UN PRÉSTAMO, no préstamo x carga: `loan_number` es único
 * en las 4.794 filas. No existe `upload_batch_id`, así que desaparecen la
 * consulta a `upload_batches` y el filtro por lote -- se lee la tabla entera.
 *
 * Es un cambio de comportamiento QUERIDO, decidido por la usuaria sabiendo lo
 * que cuesta: **se pierde la posibilidad de volver a un lote anterior.** Antes,
 * marcar otro batch como `is_current` devolvía la pantalla a un estado pasado;
 * ahora la pantalla siempre refleja lo último que sincronizó BigQuery. Un
 * archivo mal cargado se corrige volviéndolo a subir, no rebobinando.
 *
 * La paginación de 1000 se mantiene igual: es el límite de PostgREST, no algo
 * que tuviera que ver con los lotes. Sin ella, 4.794 filas llegarían truncadas
 * a 1.000 en silencio.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE SIGUE CALCULANDO ACÁ, Y POR QUÉ
 * ---------------------------------------------------------------------------
 * El branch de v2 ya viene resuelto en el sentido de NEGOCIO --Affinity,
 * reclasificaciones y Salesforce ya aplicados aguas arriba-- y por eso este
 * módulo ya no decide a qué sucursal pertenece un préstamo.
 *
 * Pero `classifyBranch` sigue corriendo, por una razón distinta: traduce el
 * valor a las claves que usa la TABLA. Medido sobre los datos reales:
 *
 *   * v2 dice `'Affinity'`; el roster dice `'AFFINITY'`. Sin normalizar, esos
 *     266 préstamos no coinciden con ninguna fila de BRANCH_ORDER.
 *   * 32 préstamos están en sucursales fuera de la división (203, 913, 150,
 *     199, 276), que `classifyBranch` agrupa en 'Branch Out of Division'.
 *
 * Y esto no sería un detalle cosmético: `buildReportTree` arma las filas
 * recorriendo BRANCH_ORDER, pero el nodo Total suma TODOS los records. Un
 * branch que no está en el orden desaparece de la tabla y sigue contando en el
 * Total -- 298 préstamos visibles sólo en el total, sin fila donde buscarlos.
 *
 * Lo mismo con la normalización de nombres: en v2, 4.573 de 4.794 loan
 * officers NO vienen en mayúscula y 221 vienen vacíos. La tabla vieja los
 * guardaba ya normalizados (lo hacía la carga manual antes de escribir), así
 * que el desglose por Loan Officer siempre agrupó por el nombre en mayúscula.
 * Sin repetirlo acá, el mismo officer se partiría en dos filas según cómo lo
 * escribió el origen.
 */
export async function loadCurrentReport(): Promise<CurrentReport | null> {
  // Etapa UX1b: sin Supabase configurado no hay nada que leer, y no es un
  // error que valga la pena mostrarle al usuario al abrir la página -- el
  // estado válido es "no hay datos" (null), igual que cuando la tabla está
  // vacía. Antes existía un camino ruidoso para el guardado manual, que sí era
  // una acción pedida explícitamente; ese camino se fue en V4.
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabaseClient();

  const allRows: LoanRecordV2Row[] = [];
  let from = 0;
  for (;;) {
    const { data: page, error: pageError } = await supabase
      .from('loan_records_v2')
      .select(COLUMNS)
      // Orden explícito: sin `order by`, PostgREST no garantiza que dos
      // páginas consecutivas no repitan ni salteen filas. `loan_number` es
      // único en esta tabla, así que alcanza solo para desempatar.
      .order('loan_number', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (pageError) throw pageError;
    if (!page || page.length === 0) break;
    allRows.push(...(page as unknown as LoanRecordV2Row[]));
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Tabla vacía = no hay nada que restaurar, mismo estado que "no hay lote
  // actual" antes de esta etapa.
  if (allRows.length === 0) return null;

  const records: LoanRecord[] = allRows.map((row) => ({
    // Ver el bloque "QUÉ SE SIGUE CALCULANDO ACÁ": esto no reasigna sucursales,
    // sólo traduce el valor ya resuelto a las claves de BRANCH_ORDER.
    branch: classifyBranch(row.branch ?? ''),
    // Misma normalización que aplicaba la carga manual antes de guardar, para
    // que el desglose siga agrupando por la misma clave.
    loanOfficer: row.loan_officer?.trim() ? row.loan_officer.trim().toUpperCase() : '(blank)',
    bd: row.bd?.trim() ? row.bd.trim() : '(blank)',
    isB2B: row.is_b2b,
    // `loan_channel` reemplaza a `loan_info_channel_raw` con los mismos
    // valores exactos ('Banked - Retail', 'Brokered'). Los 8 vacíos siguen
    // siendo su propia categoría, no se reclasifican -- decisión de negocio de
    // Isabella que sigue vigente (ver el filtro 'empty' en Toolbar.tsx).
    loanInfoChannel: row.loan_channel ?? '',
    fileCreationMonth: monthOf(row.file_creation_date),
    creditReportMonth: monthOf(row.credit_report_date),
    appDateMonth: monthOf(row.app_date),
    /*
     * `closing_month` y no `closing_date`: es el mes canónico que ya resolvió
     * BigQuery (incluida la regla de Disbursement Date sobre Funding/Completion
     * que antes vivía en la carga manual). Verificado: es no-nulo exactamente en
     * las 468 filas con `is_closed`, ni una de más ni una de menos.
     */
    closingMonth: monthOf(row.closing_month),
    // numeric/decimal en Postgres puede volver como string vía PostgREST;
    // Number(...) lo normaliza sin asumir cuál es el caso.
    totalLoanAmount: Number(row.total_loan_amount) || 0,
    loanNumber: row.loan_number ?? '',
    loanProgram: row.loan_program ?? '',
    loanFolderName: row.loan_folder_name ?? '',
    /*
     * `is_affinity` es booleano en v2; el campo del dominio es el texto crudo
     * que traía la columna 'Affinity' del Excel ('X' o ''). Se traduce para no
     * cambiar el tipo de LoanRecord por un dato que hoy ninguna pantalla
     * muestra (ver el comentario de LoanDetailModal.tsx). Si algún día se
     * muestra, conviene que pase a boolean en el dominio y no al revés.
     */
    affinity: row.is_affinity ? 'X' : '',
    countsForDivision: row.counts_for_division,
    /*
     * Etapa V3. Se pasan tal cual, sin normalizar ni mapear: la clasificación
     * ya la hizo BigQuery y esta capa no la reinterpreta. El `?? ''` es sólo
     * para no propagar NULL a un tipo que en el dominio es string.
     */
    strategy: row.strategy ?? '',
    opportunityOwner: row.opportunity_owner ?? '',
    nppmRealtor: row.nppm_realtor ?? '',
    referredByRealtor: row.referred_by_realtor ?? '',
    nppmRecruitedBy: row.nppm_recruited_by ?? '',
  }));

  /*
   * Ya no hay archivo ni fecha de carga: el pill de la pantalla pasa a nombrar
   * la FUENTE, y la fecha es la del último sync. `synced_at` es igual en todas
   * las filas de una corrida, pero se toma el máximo por si una sincronización
   * quedó a medias.
   */
  const lastSync = allRows.reduce((max, row) => (row.synced_at > max ? row.synced_at : max), allRows[0].synced_at);

  return {
    records,
    fileName: SOURCE_LABEL,
    uploadedAt: lastSync,
  };
}
