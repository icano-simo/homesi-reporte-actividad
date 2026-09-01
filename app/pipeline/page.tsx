'use client';

import './styles/forecast-visual.css';
import { useEffect, useState } from 'react';
import {
  calculateTotalForecastWithClosed,
  targetMonthRange,
  countByBrokeredMilestoneBucket,
  BROKERED_FLAT_PULL_THROUGH_RATE,
  apportionByWeight,
  splitCtcAndClosing,
  type BucketCounts,
  type BrokeredPullThroughRates,
  type BrokeredForecastByBucket,
  type DateRange,
  type TargetMonth,
} from '@/lib/pipeline/aggregate';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import { classifyStrategy, hasStrategyData, STRATEGY_ORDER, type Strategy } from '@/lib/pipeline/strategy';
import SummaryCards, { type SummaryBlock } from './SummaryCards';
import type { MilestoneCascadeRow } from './MilestoneCascade';
import PivotTable, { buildBranchRows, type BranchRow, type StrategyRow } from './PivotTable';
import {
  PULL_THROUGH_RATES,
  buildBranchForecastRows,
  type BranchForecastRow,
} from '@/lib/pipeline/branchForecast';
import AdverseTable, { type ChannelFilter } from './AdverseTable';
import Topbar from './Topbar';
import TabNavigation, { type TabType } from './TabNavigation';
import TabMilestoneMatrix from './TabMilestoneMatrix';
import { getForecastDb, isSupabaseConfigured } from '@/lib/supabase/client';
import { DownloadIcon, FileSheetIcon } from '@/components/ui/icons';

/**
 * ⚠ Cuándo se actualizó el snapshot, en la zona de quien mira.
 *
 * Gemelo de `formatLastSync` en app/page.tsx (Actividad), y por el mismo
 * motivo: `uploaded_at` es un `timestamptz` -- un INSTANTE con offset -- así
 * que convertirlo a hora local es exactamente lo que se quiere. Distinto de
 * `activeSnapshotDate`, que es un día de calendario y NO se pasa por `new
 * Date()` (ver el comentario de S1 más abajo).
 *
 * El texto va en inglés y no en español como el de Actividad: esta pantalla
 * está en inglés entera, por una decisión anterior (rama
 * fix/forecast-messages-in-english). Misma información y mismo formato de
 * fecha; sólo cambia el idioma del rótulo.
 */
function formatLastUpload(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const fecha = at.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = at.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Updated on ${fecha} at ${hora}`;
}

/*
 * Etapa RPT1: `PULL_THROUGH_RATES` se mudó a `lib/pipeline/branchForecast.ts`,
 * junto a la cascada que las aplica. Se re-importa acá porque el panel de
 * Pull-Through Cascade las muestra tasa por tasa.
 */

const EMPTY_BUCKETS: BucketCounts = { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 };

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Etapa F5c, sigue igual en F5e: "August 2026" -- para la etiqueta visible del mes de Cerrados/Forecast en SummaryCards. Etapa F5d: nombres de mes traducidos a ingles (texto visible). */
function formatForecastMonthLabel(target: TargetMonth): string {
  const name = MONTH_NAMES[target.month - 1];
  return name + ' ' + target.year;
}

/** Etapa F5e: 'YYYY-MM' (formato nativo de <input type="month">) -> {year, month} que espera targetMonthRange(). */
function parseMonthInputValue(value: string): TargetMonth {
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

/** Etapa F5e: mes actual como 'YYYY-MM', default del nuevo MonthSelector (Cerrados/Forecast). */
function getDefaultForecastMonth(): string {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Etapa F4c: default = día 1 del mes actual hasta el último día del mes
 * actual (usa la fecha real del sistema, no un valor fijo). Ej. hoy=29
 * julio 2026 -> 1 julio 2026 a 31 julio 2026.
 *
 * Etapa F5a: antes arrancaba en el mes ANTERIOR (2 meses de rango) -- se
 * acota a solo el mes actual.
 *
 * Etapa F5e: este rango ahora es SOLO para Total/Healthy Pipeline --
 * Cerrados/Forecast usan forecastMonth (independiente, ver abajo), ya no
 * derivan nada de este rango. Etapa F5j: Adverse tampoco usa más este
 * rango (pasó a forecastMonth también, ver adverseInRange).
 *
 * Etapa F5j: vuelve a ser un rango de 2 meses -- [1er día del mes
 * ANTERIOR, último día del mes actual], confirmado explícito en el brief
 * de esta etapa (no es un revert accidental de F5a). Ej. hoy=5 agosto
 * 2026 -> 1 julio 2026 a 31 agosto 2026.
 */
function getDefaultPipelineDateRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: formatDateLocal(start), endDate: formatDateLocal(end) };
}

function sumBuckets(a: BucketCounts, b: BucketCounts): BucketCounts {
  return {
    Started: a.Started + b.Started,
    Processing: a.Processing + b.Processing,
    Underwriting: a.Underwriting + b.Underwriting,
    Closing: a.Closing + b.Closing,
  };
}

interface ParseApiResponse {
  openLoans: PipelineLoan[];
  resolvedLoans: ResolvedLoan[];
  warnings: string[];
  /** Ausente cuando los datos vienen restaurados de Supabase (F5a) en vez de recién parseados -- no se guarda el formato detectado en la BD. */
  formatDetected?: 'A' | 'B';
  /** F5a: si el archivo recién subido se pudo guardar en Supabase. Ausente cuando los datos vienen restaurados (ya estaban guardados). */
  persisted?: boolean;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Etapa EXCEL-6, fix: `typeof x === 'number'` a secas descartaba el id
 * siempre que llegara como string -- posible en cualquiera de las 2
 * fuentes: `body.snapshot.id` (columna `bigint` de Postgres, que
 * PostgREST puede devolver como string para no perder precisión) y
 * `body.saved.snapshot_id` (el valor sale de un `jsonb` que arma la RPC
 * `save_pipeline_snapshot()`, sin visibilidad desde acá de si castea a
 * texto en algún punto). Acepta las dos formas -- number tal cual, o un
 * string que sea puramente dígitos (`Number()` de cualquier otra cosa,
 * incluida `''`, no es lo que se quiere validar acá).
 */
function parseSnapshotId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Página de Forecast (Etapa F4, ampliada en F4b): integración real, sin
 * Supabase todavía (eso es F5). El usuario sube el Excel -> se parsea
 * server-side en /api/pipeline/parse (usa el parser de F1 sin tocarlo) ->
 * el cálculo de aggregate.ts (F2, puro, sin I/O) corre acá en el cliente
 * sobre el JSON ya recibido -> se renderiza con los componentes de F3
 * (ampliados en F4b para el desglose Cerrados+Proyección y por Loan
 * Officer). Los datos viven solo en memoria del navegador mientras dure la
 * sesión.
 */
export default function PipelinePage() {
  const [data, setData] = useState<ParseApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * `uploaded_at` del snapshot activo, completo -- con hora, no recortado a
   * los 10 caracteres como `activeSnapshotDate`.
   *
   * Arranca en null y se llena dentro del efecto de montaje, nunca en el
   * render del servidor: `toLocaleDateString` da resultados distintos según la
   * zona del proceso, así que formatearlo durante el SSR pintaría la fecha del
   * servidor y después la del navegador -- un mismatch de hidratación. Es la
   * misma precaución que toma app/page.tsx con `lastSync`.
   */
  const [lastUploadedAt, setLastUploadedAt] = useState<string | null>(null);
  // Etapa F5e: dos controles independientes en vez de uno -- ver Decisiones
  // en la respuesta de esta etapa. pipelineDateRange sigue siendo el mismo
  // DateRange de siempre (Total/Healthy Pipeline + Adverse); forecastMonth
  // es nuevo, un solo mes, solo para Cerrados/Forecast.
  const [pipelineDateRange, setPipelineDateRange] = useState<DateRange>(getDefaultPipelineDateRange);
  const [forecastMonth, setForecastMonth] = useState<string>(getDefaultForecastMonth);
  const [branchManagers, setBranchManagers] = useState<Map<string, string>>(new Map());
  const [knownBranches, setKnownBranches] = useState<Set<string>>(new Set());
  // Etapa F5g: source_loan_id -> fecha de primera detección como adverse
  // (o null = "New this period"), desde /api/pipeline/adverse-history.
  // Empieza vacío -- mientras un source_loan_id no tenga entrada, AdverseTable
  // lo trata como "todavía no llegó la respuesta" (undefined en el lookup),
  // no como "sin historial" (eso es el null explícito para cada préstamo).
  const [firstSeenAsAdverse, setFirstSeenAsAdverse] = useState<Record<string, string | null>>({});
  /**
   * Etapa EXCEL-4: true mientras /api/pipeline/adverse-history está en
   * vuelo (arranca en `true`, mismo motivo que `isLoadingInitial`: hay una
   * ventana real entre que `data` llega -- habilita el botón Download
   * Excel -- y que este segundo fetch resuelve, mientras la cual
   * `adverseInRange` da 0 de forma legítima, no un bug de datos: ver
   * `firstSeen === undefined` en su filtro más abajo). `handleExport` no
   * debe poder correr en esa ventana -- el Excel saldría sin Adverse
   * aunque sí existan.
   */
  const [isAdverseHistoryLoading, setIsAdverseHistoryLoading] = useState(true);
  // Etapa F5a: true mientras se consulta /api/pipeline/latest al montar --
  // evita mostrar el emptyState de "sube tu archivo" antes de saber si hay
  // un snapshot guardado (mismo patrón que isLoadingInitial en app/page.tsx
  // de Actividad).
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  // Etapa F6h: estado nuevo del rediseño -- qué tab está activo (Executive/
  // Matrix/Adverse, TabNavigation.tsx) y qué branch está seleccionado en el
  // dropdown de Topbar.tsx ('ALL' = todos, sin filtrar).
  const [activeTab, setActiveTab] = useState<TabType>('executive');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  /**
   * Etapa EXCEL-1: espejo del conmutador `By branch`/`By strategy` de
   * PivotTable (Executive tab) -- PivotTable sigue siendo dueño de su
   * propio estado interno (`view`/`pill`, sin cambios), esto solo
   * refleja el resultado ya resuelto vía `onActiveStrategyFilterChange`
   * para que `handleExport()` sepa si debe acotar el Excel a una sola
   * estrategia. `null` = sin filtro (incluye el caso "PivotTable no está
   * montado", ej. otro tab activo -- PivotTable resetea esto a `null` al
   * desmontarse, ver su propio `useEffect`).
   */
  const [activeStrategyFilter, setActiveStrategyFilter] = useState<Strategy | null>(null);
  /**
   * Etapa EXCEL-6: mismo patrón que `activeStrategyFilter`, arriba, pero
   * para el `<select>` de canal de AdverseTable -- `'all'` = sin filtro.
   * Solo tiene efecto sobre el detalle de `adverseInRange` en el Excel
   * (ver exportRows más abajo); no toca abiertos ni cerrados/funded.
   */
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  /**
   * Etapa EXCEL-6: id del snapshot activo, para la hoja de portada del
   * Excel. Se lee de `body.snapshot.id` (ya seleccionado en la query de
   * /api/pipeline/latest, ahora también devuelto -- ver ese archivo).
   */
  const [activeSnapshotId, setActiveSnapshotId] = useState<number | null>(null);
  // Etapa F5j: fecha del snapshot ACTIVO ('YYYY-MM-DD', UTC -- mismo criterio
  // que pipeline_snapshots.snapshot_date en el backend: new Date().toISOString().slice(0,10)).
  // Hace falta para resolver los préstamos "New this period"
  // (firstSeenAsAdverse=null) dentro del filtro de Adverse -- ver
  // adverseInRange. Ninguna de las 2 rutas (/api/pipeline/parse,
  // /api/pipeline/latest) está en la lista de archivos de esta etapa, así
  // que no se les agregó un campo nuevo: para una carga recién subida, la
  // fecha del snapshot ES "ahora" (se crea en el mismo request, con
  // new Date() del lado del servidor); para una restaurada,
  // /api/pipeline/latest YA devuelve `uploadedAt` -- antes se descartaba,
  // ahora se usa.
  const [activeSnapshotDate, setActiveSnapshotDate] = useState<string | null>(null);
  // Etapa F5k: true mientras se genera/descarga el Excel -- evita doble click
  // y le da feedback visual al botón. Es el único estado de "trabajando" que
  // queda en la pantalla: el de la carga se fue con ella.
  const [isExporting, setIsExporting] = useState(false);
  /* Etapa RPT1: estado propio, no compartido con `isExporting` -- son dos descargas distintas. */
  const [isBuildingMonthly, setIsBuildingMonthly] = useState(false);

  // Etapa F5a: si nadie subió un archivo en esta sesión (data===null),
  // restaura el último snapshot activo desde Supabase -- para no perder el
  // dato al recargar la página. No dispara una nueva inserción: esos datos
  // ya están guardados.
  useEffect(() => {
    if (data !== null) return;
    let cancelled = false;
    fetch('/api/pipeline/latest')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        // Manejo explícito de errores del restore de Forecast: un 500 real
        // de /api/pipeline/latest ({error: "..."}) es un caso distinto de
        // {snapshot: null} ("todavía no se subió nada") -- fetch() no
        // rechaza en un status de error, así que el .catch() de abajo
        // (fallos de red) nunca se entera de esto. Se separa acá para
        // mostrar el mensaje real con el mecanismo de error ya existente
        // (setError), en vez de que un error real se muestre como si no
        // hubiera Forecast guardado. No toca la rama de éxito ni la de
        // snapshot:null, ninguna query, ninguna columna.
        if (body && body.error) {
          setError(String(body.error));
          return;
        }
        if (!body || !body.snapshot) return;
        setData({ openLoans: body.openLoans, resolvedLoans: body.resolvedLoans, warnings: body.warnings ?? [] });
        // `body.snapshot.fileName` ya no se guarda: no lo consume nadie desde
        // que el pill "File:" se fue. /api/pipeline/latest lo sigue devolviendo.
        // Etapa EXCEL-6: id del snapshot restaurado, para la portada del Excel.
        setActiveSnapshotId(parseSnapshotId(body.snapshot.id));
        /*
         * ⚠ Etapa S1: la fecha del DATO manda sobre la de subida.
         *
         * `data_as_of` es cuándo Salesforce generó el export; `uploaded_at` es
         * cuándo alguien lo subió. Los snapshots 9 y 11 se subieron el 3 de
         * agosto con el export del 30 de julio: mostrar la fecha de subida los
         * archivaba como datos de otra semana.
         *
         * El fallback a `uploadedAt` es para los archivos con nombre no
         * estándar, donde `data_as_of` viene en null y no hay nada mejor.
         */
        const stamp =
          typeof body.snapshot.dataAsOf === 'string'
            ? body.snapshot.dataAsOf
            : typeof body.snapshot.uploadedAt === 'string'
              ? body.snapshot.uploadedAt
              : null;
        setActiveSnapshotDate(stamp ? stamp.slice(0, 10) : null);
        /*
         * Para el rótulo del header va `uploaded_at` y NO `data_as_of`, que es
         * lo que usa la línea de arriba. Son dos preguntas distintas: a qué
         * día pertenece el dato (data_as_of, lo que decide el período) y
         * cuándo se refrescó por última vez (uploaded_at, lo que la usuaria
         * mira para saber si vale la pena volver a cargar la página).
         */
        setLastUploadedAt(
          typeof body.snapshot.uploadedAt === 'string' ? body.snapshot.uploadedAt : null,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingInitial(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Etapa F4f: branch -> Branch Manager, desde pipeline_forecast.branch_managers.
  // Etapa F4g: mismo efecto, se agrega pipeline_forecast.branches (roster de
  // branches conocidos, columna `code`) -- se usa en PivotTable para no
  // mostrar filas fantasma de branches sin actividad real en el rango. Se
  // cargan una sola vez al montar, no dependen del archivo subido. Si
  // cualquiera falla (env vars ausentes, tabla no encontrada, RLS, etc.) se
  // deja su estado vacío -- PivotTable ya maneja ambos casos sin romper la
  // página.
  //
  // Etapa AUTH1: antes se creaba acá un cliente de Supabase propio, porque el
  // de lib/supabase/client.ts está fijo al schema 'activity_report'. Con
  // autenticación eso pasó a ser un problema: dos instancias compitiendo por
  // la misma sesión, y el riesgo de que ésta quedara sin token y RLS la
  // rechazara. `getForecastDb()` apunta el MISMO cliente (con sesión) al otro
  // schema.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabaseForecast = getForecastDb();

    supabaseForecast
      .from('branch_managers')
      .select('branch, manager_name')
      .then(({ data, error }) => {
        if (error || !data) return;
        const map = new Map<string, string>();
        for (const row of data as { branch: string; manager_name: string }[]) {
          map.set(row.branch, row.manager_name);
        }
        setBranchManagers(map);
      });

    supabaseForecast
      .from('branches')
      .select('code')
      .then(({ data, error }) => {
        if (error || !data) return;
        const codes = new Set<string>();
        for (const row of data as { code: string }[]) {
          codes.add(row.code);
        }
        setKnownBranches(codes);
      });
  }, []);

  // Etapa F5g: se pide cada vez que `data` cambia (archivo recién subido o
  // snapshot restaurado) -- el endpoint siempre responde sobre el snapshot
  // activo, que es exactamente lo que hay en pantalla en cualquiera de los
  // dos casos. Un fallo (Supabase caído, sin snapshot activo, etc.) deja el
  // mapa vacío -- AdverseTable ya maneja ese estado mostrando '—' en vez de
  // romper la página.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    // Etapa EXCEL-4: `true` al ARRANCAR el fetch, no solo al terminar --
    // este efecto se re-dispara con cada `data` nuevo (re-subida), y sin
    // esto el botón quedaría habilitado con el `firstSeenAsAdverse` del
    // snapshot ANTERIOR mientras el del nuevo snapshot todavía está en
    // vuelo, misma ventana de carrera que este fix busca cerrar.
    setIsAdverseHistoryLoading(true);
    fetch('/api/pipeline/adverse-history')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setFirstSeenAsAdverse(body?.firstSeen ?? {});
      })
      .catch(() => {
        if (cancelled) return;
        setFirstSeenAsAdverse({});
      })
      .finally(() => {
        if (cancelled) return;
        setIsAdverseHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  /*
   * Acá vivía `handleFileSelected`, que subía el archivo a /api/pipeline/parse.
   *
   * Se retira el ACCESO desde esta pantalla, no el endpoint: el archivo ahora
   * se sube por la app de cargas, que lo deja en BigQuery, y el job del sync
   * arma el snapshot. Los dos caminos escribían en `pipeline_snapshots` con la
   * misma regla de un snapshot por día, así que el segundo en correr pisaba al
   * primero -- producían lo mismo, pero era duplicidad esperando a que alguien
   * cambiara uno solo.
   *
   * Con esto se va también el `setActiveSnapshotDate(new Date()...)` que había
   * acá: la fecha del snapshot ahora sale SIEMPRE de la base, del efecto de
   * restauración de arriba. Mientras existía la carga era correcto -- el
   * snapshot se creaba en ese mismo request -- pero sin ella "ahora" sería la
   * hora de mirar la pantalla, no la del dato.
   */

  // Etapa F5e: forecastMonth ('YYYY-MM' del MonthSelector nuevo) es
  // completamente independiente de pipelineDateRange -- ya no se deriva de
  // él (eso era F5c, revertido). targetMonthRange() se reutiliza tal cual
  // (aggregate.ts, sin tocar) para convertir el mes elegido en {startDate,
  // endDate}.
  const forecastMonthParsed = parseMonthInputValue(forecastMonth);
  const forecastRange = targetMonthRange(forecastMonthParsed);
  const forecastMonthLabel = formatForecastMonthLabel(forecastMonthParsed);

  // Cálculo derivado -- igual que en F3, pero sobre data.openLoans (real) en
  // vez de DEMO_LOANS. aggregate.ts (F2) no se modificó: se llaman sus
  // mismas funciones exportadas.
  /*
   * Etapa RPT1: este bucle --con sus tasas, su población por canal y su
   * redondeo por fila-- se mudó tal cual a `lib/pipeline/branchForecast.ts`.
   * No cambió nada del cálculo; cambió dónde vive, porque el reporte mensual
   * necesita la misma cascada sobre el snapshot del corte y copiarla habría
   * dejado dos definiciones del forecast. Ver la nota de ese archivo.
   */
  const branchRows: BranchForecastRow[] = data ? buildBranchForecastRows(data.openLoans, pipelineDateRange) : [];

  // Etapa F6h, extendido en ajuste posterior: filtro de branch para TODA la
  // página (banner, Executive, Matrix, Adverse) -- no solo Executive como se
  // había interpretado en F6h. filteredBranchRows/filteredResolvedLoans son
  // la única fuente que usa el resto de los cálculos de acá para abajo.
  const filteredBranchRows = selectedBranch === 'ALL' ? branchRows : branchRows.filter((r) => r.branch === selectedBranch);
  const filteredResolvedLoans =
    selectedBranch === 'ALL' ? (data?.resolvedLoans ?? []) : (data?.resolvedLoans ?? []).filter((l) => l.branch === selectedBranch);

  const grandTotalCount = filteredBranchRows.reduce((sum, r) => sum + r.totalCount, 0);
  const grandHealthyCount = filteredBranchRows.reduce((sum, r) => sum + r.healthyCount, 0);
  // Ya correcto para los 2 canales: cada r.forecastTotal viene de la fórmula
  // que le toca (Banked o Brokered, ver el loop de arriba), así que sumarlos
  // acá sigue dando el total combinado real -- no hizo falta tocar esta
  // línea en F5i.
  const grandForecastTotal = filteredBranchRows.reduce((sum, r) => sum + r.forecastTotal, 0);
  // Etapa UX9: "Projected to close soon" en la tarjeta Closed -- suma de
  // bucketTotal.Closing de cada branchRow, ya existente (countByMilestoneBucket,
  // ver el loop de arriba), sin cálculo nuevo. Para Brokered, bucketTotal es
  // vestigial (formula de Banked sobre milestones que Brokered no usa), pero
  // eso significa que su Closing da 0 en la práctica -- verificado: ningún
  // rawMilestone real de Brokered mapea al bucket Closing de Banked -- así
  // que sumar sobre los 2 canales sin filtrar por channel es seguro.
  const projectedToCloseSoon = filteredBranchRows.reduce((sum, r) => sum + r.bucketTotal.Closing, 0);

  // Bug fix (desglose CTC/Closing mostraba Delayed, mismo bug ya corregido
  // en PivotTable.tsx/buildBranchRows): la tarjeta Closed ("Projected to
  // close soon") vive junto al Forecast Estimated de Banked, que usa
  // ÚNICAMENTE bucketHealthy -- nunca bucketTotal/Delayed. El desglose tiene
  // que explicar esa población healthy, no `projectedToCloseSoon` (que sigue
  // sin tocarse: sigue siendo bucketTotal, y sigue siendo lo que se le pasa
  // a SummaryCards sin cambios -- sólo el desglose de abajo cambia de
  // fuente). MISMA fuente cruda de siempre (`r.loans` de cada branchRow),
  // filtrada por `healthy === true` ANTES de separar por rawMilestone.
  const healthyClosingBucketTotal = filteredBranchRows.reduce((sum, r) => sum + r.bucketHealthy.Closing, 0);
  const ctcClosingSplit = splitCtcAndClosing(filteredBranchRows.flatMap((r) => r.loans).filter((loan) => loan.healthy === true));
  if (process.env.NODE_ENV !== 'production' && ctcClosingSplit.ctcCount + ctcClosingSplit.closingCount !== healthyClosingBucketTotal) {
    console.warn('CTC+Closing (healthy) no coincide con bucketHealthy.Closing', {
      ctcCount: ctcClosingSplit.ctcCount,
      closingCount: ctcClosingSplit.closingCount,
      bucketHealthyClosingTotal: healthyClosingBucketTotal,
    });
  }

  // Etapa F5i: antes esto agregaba bucketTotal/bucketHealthy/forecastByBucket
  // de TODOS los branchRows (ambos canales) para alimentar una única cascada
  // combinada -- ya no tiene sentido, Brokered tiene su propio esquema de
  // buckets (FileCreation/AppDate/Processing/Submitted), incompatible con el
  // de Banked (Started/Processing/Underwriting/Closing). Se acota a
  // Banked-only acá; el desglose de Brokered se recalcula aparte, más abajo,
  // desde `loans` (no desde bucketTotal/bucketHealthy/forecastByBucket de
  // branchRows, que para una fila Brokered son vestigiales -- ver nota en el
  // loop de arriba).
  const bankedBranchRows = filteredBranchRows.filter((r) => r.channel === 'Banked - Retail');
  const bankedBucketTotal = bankedBranchRows.reduce((acc, r) => sumBuckets(acc, r.bucketTotal), EMPTY_BUCKETS);
  const bankedBucketHealthy = bankedBranchRows.reduce((acc, r) => sumBuckets(acc, r.bucketHealthy), EMPTY_BUCKETS);
  const bankedForecastByBucket = bankedBranchRows.reduce(
    (acc, r) => ({
      Started: acc.Started + r.forecastByBucket.Started,
      Processing: acc.Processing + r.forecastByBucket.Processing,
      Underwriting: acc.Underwriting + r.forecastByBucket.Underwriting,
      Closing: acc.Closing + r.forecastByBucket.Closing,
    }),
    { Started: 0, Processing: 0, Underwriting: 0, Closing: 0 }
  );

  // Etapa F5i: cascada propia de Brokered. `loans` de cada branchRow ya es
  // `total` (openLoans de esa branch+channel, filtrado por
  // pipelineDateRange, igual que usa Banked) -- se filtra healthy acá con el
  // mismo criterio que splitHealthyTotal (healthy === true).
  const brokeredBranchRows = filteredBranchRows.filter((r) => r.channel === 'Brokered');
  const brokeredLoans = brokeredBranchRows.flatMap((r) => r.loans);
  const brokeredHealthyLoans = brokeredLoans.filter((l) => l.healthy === true);
  const brokeredBucketTotal = countByBrokeredMilestoneBucket(brokeredLoans);
  const brokeredBucketHealthy = countByBrokeredMilestoneBucket(brokeredHealthyLoans);
  // brokeredBucketHealthy se sigue calculando arriba porque la cascada de
  // Matrix igual muestra esa columna (Healthy, informativa) -- no porque
  // siga siendo la base de ningún cálculo de forecast.
  //
  // Etapa F5j-b: `brokeredForecastByBucket` YA NO se calcula acá (era
  // Math.round(bucketTotal.X * 0.4) por bucket, independiente del cálculo
  // por branch de más abajo) -- eso es justo lo que hacía que Executive y
  // Matrix mostraran 2 números distintos para el mismo Brokered (6 vs 8 con
  // el snapshot activo del 2026-08-12, mismos 19 préstamos, solo cambiaba
  // cómo se agrupaban antes de redondear). Se recalcula más abajo, DESPUÉS
  // de `brokeredSummary`, repartiendo (no recalculando) su
  // `forecastTotal` -- ver esa nota para el detalle.

  // Etapa F4b: el Forecast del negocio real es Cerrados (Funded) + la
  // proyección de pull-through que ya calculaba aggregate.ts -- no la
  // proyección sola. calculateTotalForecastWithClosed() es la única función
  // nueva agregada a aggregate.ts en F4b; no toca ninguna de las 3 ya
  // aprobadas (splitHealthyTotal/countByMilestoneBucket/calculateForecast).
  const { closedCount, totalForecast } = data
    ? calculateTotalForecastWithClosed(filteredResolvedLoans, grandForecastTotal, forecastRange)
    : { closedCount: 0, totalForecast: 0 };

  // Etapa F4f: mismo cálculo que el combinado de arriba, pero recortado por
  // canal -- branchRows y resolvedLoans ya vienen separados por channel, así
  // que solo hace falta filtrar antes de sumar/llamar
  // calculateTotalForecastWithClosed (misma función de F4b, sin tocarla).
  function summarizeChannel(channel: PipelineLoan['channel'], label: string): SummaryBlock {
    const channelRows = filteredBranchRows.filter((r) => r.channel === channel);
    const totalCount = channelRows.reduce((sum, r) => sum + r.totalCount, 0);
    const healthyCount = channelRows.reduce((sum, r) => sum + r.healthyCount, 0);
    const forecastTotal = channelRows.reduce((sum, r) => sum + r.forecastTotal, 0);
    const channelResolved = filteredResolvedLoans.filter((l) => l.channel === channel);
    const { closedCount: channelClosedCount, totalForecast: channelTotalForecast } = data
      ? calculateTotalForecastWithClosed(channelResolved, forecastTotal, forecastRange)
      : { closedCount: 0, totalForecast: 0 };
    return {
      label,
      totalCount,
      healthyCount,
      forecastTotal,
      closedCount: channelClosedCount,
      totalForecast: channelTotalForecast,
    };
  }

  // Etapa F5i: se capturan en variables (antes se llamaba inline dentro del
  // array) para reusar closedCount/totalForecast/forecastTotal de cada canal
  // en su propia cascada más abajo, sin volver a llamar
  // calculateTotalForecastWithClosed una tercera vez.
  const bankedSummary = summarizeChannel('Banked - Retail', 'Banked - Retail');
  const brokeredSummary = summarizeChannel('Brokered', 'Brokered');

  // Etapa F5k: mismo problema que F5j-b resolvió para Brokered, ahora en
  // Banked -- `bankedSummary.forecastTotal` (suma de `forecastTotal`
  // redondeado POR BRANCH, calculado en el loop de arriba) es la ÚNICA
  // fuente de verdad del forecast de Banked, en cualquier vista. Antes, el
  // panel Pull-Through Cascade lo recalculaba aparte sumando
  // `bankedForecastByBucket` (la cascada real de PULL_THROUGH_RATES sobre
  // Healthy, sin cambios) y redondeando POR MILESTONE -- una partición
  // distinta del mismo total decimal (~30,6), que puede divergir del
  // redondeo por branch. Verificado con datos reales, snapshot activo,
  // Pipeline Range 2026-07-01/2026-08-31 (pipelineDateRange por defecto),
  // Forecast Month agosto 2026, All Branches: Executive=32, Cascade
  // vieja=31 -- reproducido también aislando una sola branch (Affinity: 5 en
  // Executive contra 4 en la Cascade vieja) -- ver reporte de esta etapa.
  // `bankedForecastByBucket` NO se toca (ninguna tasa, ninguna fórmula,
  // ninguna población cambia): se usa
  // tal cual, con sus valores decimales, como PESO para repartir el total ya
  // fijado (apportionByWeight, mismo mecanismo que Brokered) -- nunca más se
  // redondea bucket por bucket de forma independiente. El peso es el
  // forecast decimal de cada bucket (no el conteo crudo, a diferencia de
  // Brokered) porque las tasas de Banked NO son planas -- Started vale menos
  // por préstamo que Closing, y el reparto tiene que reflejar eso para que
  // la columna "% applied" siga siendo coherente con la columna Forecast.
  // Por construcción, la suma de las 4 partes es EXACTAMENTE
  // bankedSummary.forecastTotal, siempre.
  const [bankedStartedForecast, bankedProcessingForecast, bankedUnderwritingForecast, bankedClosingForecast] =
    apportionByWeight(bankedSummary.forecastTotal, [
      bankedForecastByBucket.Started,
      bankedForecastByBucket.Processing,
      bankedForecastByBucket.Underwriting,
      bankedForecastByBucket.Closing,
    ]);

  // Etapa F5j-b: `brokeredSummary.forecastTotal` (arriba) ya es la suma de
  // `forecastTotal` redondeado POR BRANCH de cada fila de Brokered -- la
  // única fuente de verdad para su forecast, en cualquier vista. Acá se
  // REPARTE ese total fijo entre los 4 buckets de milestone, en proporción
  // a su conteo Total (apportionByWeight, aggregate.ts) -- nunca se lo
  // vuelve a calcular multiplicando por 0.4. Por construcción, la suma de
  // las 4 partes es EXACTAMENTE brokeredSummary.forecastTotal, siempre, con
  // cualquier dato -- ya no puede volver a divergir de Executive porque no
  // hay 2 cálculos independientes, hay 1 cálculo y 1 reparto de su
  // resultado.
  const [brokeredFileCreationForecast, brokeredAppDateForecast, brokeredProcessingForecast, brokeredSubmittedForecast] =
    apportionByWeight(brokeredSummary.forecastTotal, [
      brokeredBucketTotal.FileCreation,
      brokeredBucketTotal.AppDate,
      brokeredBucketTotal.Processing,
      brokeredBucketTotal.Submitted,
    ]);
  const brokeredForecastByBucket: BrokeredForecastByBucket = {
    FileCreation: brokeredFileCreationForecast,
    AppDate: brokeredAppDateForecast,
    Processing: brokeredProcessingForecast,
    Submitted: brokeredSubmittedForecast,
  };

  // Etapa F5i: filas para las 2 cascadas -- MilestoneCascade ya no sabe de
  // Banked/Brokered, solo dibuja lo que le pasen (ver MilestoneCascade.tsx).
  // `rate` es la tasa PROPIA de cada etapa (no acumulada); el componente
  // calcula la acumulada mostrada en "% applied" como producto de las tasas
  // desde esa fila en adelante -- mismo cálculo que antes, ahora genérico.
  //
  // Etapa F5k: `forecast` de cada fila ya no es un redondeo independiente de
  // `bankedForecastByBucket.*` (ver el reparto más arriba) -- es la parte
  // entera que le tocó a ese bucket del reparto de `bankedSummary.forecastTotal`.
  // Las 4 suman exacto ese total, siempre.
  const bankedCascadeRows: MilestoneCascadeRow[] = [
    {
      key: 'Started',
      label: 'Started',
      rate: PULL_THROUGH_RATES.Started,
      healthy: bankedBucketHealthy.Started,
      total: bankedBucketTotal.Started,
      forecast: bankedStartedForecast,
    },
    {
      key: 'Processing',
      label: 'Processing',
      rate: PULL_THROUGH_RATES.Processing,
      healthy: bankedBucketHealthy.Processing,
      total: bankedBucketTotal.Processing,
      forecast: bankedProcessingForecast,
    },
    {
      key: 'Underwriting',
      label: 'Underwriting',
      rate: PULL_THROUGH_RATES.Underwriting,
      healthy: bankedBucketHealthy.Underwriting,
      total: bankedBucketTotal.Underwriting,
      forecast: bankedUnderwritingForecast,
    },
    {
      key: 'Closing',
      label: 'Closing',
      rate: PULL_THROUGH_RATES.Closing,
      healthy: bankedBucketHealthy.Closing,
      total: bankedBucketTotal.Closing,
      forecast: bankedClosingForecast,
    },
  ];

  // Etapa F5j, Cambio 3: las 4 filas de Brokered usan el mismo 40% plano, no
  // una tasa distinta por milestone -- BROKERED_FLAT_PULL_THROUGH_RATE
  // (aggregate.ts), no BROKERED_PULL_THROUGH_RATES (código muerto, ver ahí).
  // `forecast` ya viene redondeado por bucket desde brokeredForecastByBucket
  // (arriba), coherente con Banked en esta misma tabla (Cambio 4).
  //
  // `rate` de cada fila NO es 0.4 en las 4 -- es 1 en las primeras 3 y 0.4
  // solo en la última (Submitted). Motivo: MilestoneCascade.tsx (fuera del
  // alcance de este ajuste) calcula la columna "% applied" como el PRODUCTO
  // de `rate` desde esa fila hasta el final (rows.slice(i).reduce(...)) --
  // ese cálculo asume un embudo secuencial (cada etapa tiene que pasar por
  // las siguientes), que es exactamente el modelo que dejamos de usar. Con
  // las 4 filas en 0.4 literal, esa columna mostraría 40%×40%×40%×40%=2.56%
  // para File Creation en vez de 40% -- un número activamente incorrecto
  // para un modelo de tasa plana, no una simplificación aceptable. Poniendo
  // 1 en las primeras 3 y 0.4 solo en la última, el producto acumulado desde
  // CUALQUIER fila da exactamente 0.4 (1×1×1×0.4 = 1×1×0.4 = 1×0.4 = 0.4):
  // las 4 filas muestran correctamente "40.0% applied" sin tocar la fórmula
  // de MilestoneCascade.tsx. Ver el reporte de F5j para el detalle numérico.
  // El cuadro de Pull-Through Rates al pie del tab (brokeredRates, más abajo)
  // es un valor DISTINTO y sí muestra 0.4 literal en las 4 -- ver esa
  // variable para el motivo.
  const brokeredCascadeRows: MilestoneCascadeRow[] = [
    {
      key: 'FileCreation',
      label: 'File Creation',
      rate: 1,
      healthy: brokeredBucketHealthy.FileCreation,
      total: brokeredBucketTotal.FileCreation,
      forecast: brokeredForecastByBucket.FileCreation,
    },
    {
      key: 'AppDate',
      label: 'App Date',
      rate: 1,
      healthy: brokeredBucketHealthy.AppDate,
      total: brokeredBucketTotal.AppDate,
      forecast: brokeredForecastByBucket.AppDate,
    },
    {
      key: 'Processing',
      label: 'Processing',
      rate: 1,
      healthy: brokeredBucketHealthy.Processing,
      total: brokeredBucketTotal.Processing,
      forecast: brokeredForecastByBucket.Processing,
    },
    {
      key: 'Submitted',
      label: 'Submitted',
      rate: BROKERED_FLAT_PULL_THROUGH_RATE,
      healthy: brokeredBucketHealthy.Submitted,
      total: brokeredBucketTotal.Submitted,
      forecast: brokeredForecastByBucket.Submitted,
    },
  ];

  // Etapa F5j: rates que ve el cuadro "Pull-Through Rates" al pie del tab
  // (TabMilestoneMatrix.tsx, Object.entries(rates) -- una fila por key). A
  // diferencia de `rate` en brokeredCascadeRows (arriba, con el truco 1/1/1/
  // 0.4 para que "% applied" se muestre bien), acá el valor SÍ es 0.4
  // literal en las 4 -- este cuadro muestra la tasa cruda de cada etapa, no
  // un acumulado, así que no hay nada que compensar. Se repite 40% cuatro
  // veces a propósito (ver el reporte de F5j: se propone ahí una
  // presentación alternativa para cuando Brokered es el canal activo, sin
  // decidirla acá).
  const brokeredFlatRatesDisplay: BrokeredPullThroughRates = {
    FileCreation: BROKERED_FLAT_PULL_THROUGH_RATE,
    AppDate: BROKERED_FLAT_PULL_THROUGH_RATE,
    Processing: BROKERED_FLAT_PULL_THROUGH_RATE,
    Submitted: BROKERED_FLAT_PULL_THROUGH_RATE,
  };

  // Etapa F4i: filtro original -- status='adverse' Y Loan Status='Application
  // withdrawn' Y Est. Closing Date dentro del rango activo (Pipeline Range).
  // Etapa F5h: se confirmó con datos reales que ese filtro por Loan Status
  // excluía Adverse legítimos con otros motivos (Application denied, File
  // Closed for incompleteness, y hasta casos con Loan Status desincronizado
  // tipo "Active Loan" a pesar de Stage=Closed Lost) -- se quita esa
  // condición. El filtro queda solo status='adverse' Y Est. Closing Date
  // dentro del rango activo.
  //
  // Etapa F5j: se reemplaza también el campo/rango de fecha -- deja de ser
  // Est. Closing Date dentro de Pipeline Range, pasa a ser
  // firstSeenAsAdverse (F5g, /api/pipeline/adverse-history) dentro de
  // forecastMonth -- mismo patrón narrativo que Cerrados ("lo que pasó este
  // mes"). Cambiar Pipeline Range ya NO mueve el conteo de Adverse; cambiar
  // Forecast Month sí. Un préstamo con firstSeenAsAdverse=null ("New this
  // period") se incluye si el snapshot ACTIVO (activeSnapshotDate, ver
  // arriba) cae dentro de forecastMonth -- por definición, "nuevo en este
  // período" se detectó recién en la carga actual, así que su fecha de
  // detección real es la fecha de esa carga. firstSeenAsAdverse=undefined
  // (todavía no respondió el endpoint) se excluye -- no hay forma de saber
  // si cae en el mes elegido, mismo criterio conservador que ya usa
  // AdverseTable para no mostrar datos a medio cargar.
  // Etapa F5m: 2 condiciones adicionales, por canal, ENCIMA del filtro de
  // arriba (no lo reemplazan). Brokered: se excluyen los que quedaron en
  // Loan Folder="Current Prospects" (típicamente prospectos que nunca
  // llegaron a originarse de verdad, no "adverse" en el sentido de la
  // tabla). Banked - Retail: solo se cuentan los que SÍ tienen Est. Closing
  // Date -- se excluyen los que están vacíos/null.
  const adverseInRange = data
    ? filteredResolvedLoans.filter((loan) => {
        if (loan.status !== 'adverse') return false;
        const firstSeen = firstSeenAsAdverse[loan.sourceLoanId];
        if (firstSeen === undefined) return false;
        const effectiveDate = firstSeen ?? activeSnapshotDate;
        if (effectiveDate === null || effectiveDate < forecastRange.startDate || effectiveDate > forecastRange.endDate) return false;
        if (loan.channel === 'Brokered' && loan.rawLoanFolder === 'Current Prospects') return false;
        if (loan.channel === 'Banked - Retail' && !loan.estClosingDate) return false;
        return true;
      })
    : [];

  // Etapa F5k: mismo filtro que calculateTotalForecastWithClosed() aplica
  // internamente para closedCount (aggregate.ts, sin tocar) -- se repite
  // acá para tener la LISTA de préstamos, no solo el número (closedCount
  // ya lo consumía SummaryCards/PivotTable, pero ningún lugar guardaba los
  // objetos). No es un criterio nuevo, es el mismo ya aprobado en F4b/F5j.
  const closedInRange = filteredResolvedLoans.filter(
    (loan) =>
      loan.status === 'funded' &&
      loan.disbursementDate >= forecastRange.startDate &&
      loan.disbursementDate <= forecastRange.endDate
  );

  // Etapa F5k: "Total Pipeline" en pantalla es la suma de totalCount de
  // cada branchRow -- acá se junta la lista real de préstamos detrás de
  // ese número (mismos objetos que ya usa PivotTable.tsx vía
  // branchForecastRow.loans, ya filtrados por Pipeline Range).
  const openLoansInRange = filteredBranchRows.flatMap((r) => r.loans);

  /**
   * Etapa F5k: los 3 grupos (abiertos/cerrados/adverse) mezclados en un
   * solo array para el export a Excel -- "Healthiness" (Etapa EXCEL-2,
   * antes "Last Meeting") según el tipo de préstamo: rawHealthiness tal
   * cual para abiertos (SIN pasar por healthStatusLabel -- acá se quiere
   * el valor crudo, no "Healthy" normalizado), "Funded"/"Adverse" literal
   * para los otros 2 grupos.
   */
  /**
   * Etapa EXCEL-1: mismo criterio que `strategyDataMissing` en
   * TabAnalytics (F7.23) -- si NINGÚN loan de las 3 mitades trae datos de
   * estrategia (snapshot restaurado antes de que existieran esas
   * columnas), `classifyStrategy()` caería en `'Own production'` para el
   * 100% de las filas: una respuesta bien formada y falsa. Se calcula
   * sobre la población COMPLETA (antes de aplicar `activeStrategyFilter`)
   * -- es una pregunta sobre el snapshot, no sobre el recorte elegido.
   */
  const allLoansForExport = [...openLoansInRange, ...closedInRange, ...adverseInRange];
  const strategyDataMissingForExport = allLoansForExport.length > 0 && !hasStrategyData(allLoansForExport);

  function strategyColumnValue(loan: { branch: string; strategyRaw: string; opportunityOwnerTitle: string }): string {
    return strategyDataMissingForExport ? 'No strategy data in this snapshot' : classifyStrategy(loan);
  }

  /**
   * Etapa EXCEL-5: `pipeline_resolved_loans` (Funded/Adverse) ya tiene
   * columna `branch_transferred` (Isa, NULLABLE sin default -- ver
   * lib/pipeline/types.ts) -- el hueco de la Etapa EXCEL-3 (documentado
   * en docs/ARQUITECTURA.md, "Hallazgo pendiente") quedó cerrado. Ahora
   * hay 3 estados reales, no 2: `true`/`false` son un dato confirmado
   * (columna existía cuando se guardó esa fila), `null`/`undefined` es
   * "nunca se guardó" (fila de un snapshot anterior a esta migración) --
   * mismo texto que ya usaba EXCEL-3 para ese tercer caso, pero ahora
   * reflejando el estado REAL de la base, no un parche por falta de
   * columna. `pipeline_loans` (abiertos) sigue con su propia función --
   * ese campo es siempre `boolean` ahí, nunca tuvo el problema de NULL.
   */
  const BRANCH_TRANSFER_NOT_TRACKED = 'Not tracked for closed loans';
  function openLoanBranchTransferValue(loan: { branchTransferred: boolean }): string {
    return loan.branchTransferred ? 'Yes' : '';
  }
  function resolvedLoanBranchTransferValue(loan: { branchTransferred: boolean | null | undefined }): string {
    if (loan.branchTransferred === true) return 'Yes';
    if (loan.branchTransferred === false) return '';
    return BRANCH_TRANSFER_NOT_TRACKED;
  }

  /**
   * Etapa EXCEL-1: si el conmutador de PivotTable tiene una píldora de
   * estrategia activa (`activeStrategyFilter`, ver
   * `onActiveStrategyFilterChange`), el Excel se acota a esa estrategia
   * -- mismas 3 mitades, mismo `classifyStrategy()` que ya se usa para la
   * columna Strategy de abajo, sin reclasificar con otro criterio. Con
   * `activeStrategyFilter === null` (vista `branch`, o `strategy` con
   * píldora en `All`) no se filtra nada, igual que antes.
   */
  const strategyFilteredOpenLoans = activeStrategyFilter
    ? openLoansInRange.filter((loan) => classifyStrategy(loan) === activeStrategyFilter)
    : openLoansInRange;
  const strategyFilteredClosed = activeStrategyFilter
    ? closedInRange.filter((loan) => classifyStrategy(loan) === activeStrategyFilter)
    : closedInRange;
  const strategyFilteredAdverse = activeStrategyFilter
    ? adverseInRange.filter((loan) => classifyStrategy(loan) === activeStrategyFilter)
    : adverseInRange;

  /**
   * Etapa EXCEL-6: filtro de Channel del `<select>` de AdverseTable
   * (`channelFilter`, ver `onChannelFilterChange`) -- solo toca el
   * detalle de Adverse en el Excel; abiertos y Funded no tienen este
   * control, así que no se les aplica. Se filtra DESPUÉS del filtro de
   * estrategia (mismo array `strategyFilteredAdverse` de arriba, sin
   * reemplazarlo) -- son dos recortes independientes sobre la misma
   * mitad, no dos criterios que compitan.
   */
  const channelFilteredAdverse =
    channelFilter === 'all' ? strategyFilteredAdverse : strategyFilteredAdverse.filter((loan) => loan.channel === channelFilter);

  /**
   * Etapa EXCEL-6: hoja de resumen por estrategia -- SIEMPRE las 5
   * (`STRATEGY_ORDER`), sin importar `activeStrategyFilter` (confirmado
   * por Isa: el resumen ignora el filtro de estrategia a propósito, es
   * una vista distinta del detalle, no un subconjunto de él). Se arma
   * llamando `buildBranchRows()` (PivotTable.tsx, ya exportada) con los
   * MISMOS argumentos que ya recibe `<PivotTable>` más abajo -- mismo
   * cálculo exacto del pivot, sin reimplementar nada. `filteredBranchRows`/
   * `filteredResolvedLoans` ya están filtrados por branch (Topbar) pero
   * NUNCA por estrategia -- por eso el resumen no hereda `activeStrategyFilter`
   * ni `channelFilter` (ninguno de los dos aplica acá).
   */
  const branchRowsForSummary: BranchRow[] = buildBranchRows(
    filteredBranchRows,
    filteredResolvedLoans,
    forecastRange,
    knownBranches,
    PULL_THROUGH_RATES
  );

  const EMPTY_STRATEGY_TOTALS = { totalCount: 0, healthyCount: 0, closedCount: 0, projectedToClose: 0, totalForecast: 0 };

  const strategySummaryTotals = new Map<Strategy, typeof EMPTY_STRATEGY_TOTALS>(
    STRATEGY_ORDER.map((s) => [s, { ...EMPTY_STRATEGY_TOTALS }])
  );
  for (const branchRow of branchRowsForSummary) {
    for (const sr of branchRow.strategyRows) {
      const acc = strategySummaryTotals.get(sr.strategy) ?? { ...EMPTY_STRATEGY_TOTALS };
      acc.totalCount += sr.totalCount;
      acc.healthyCount += sr.healthyCount;
      acc.closedCount += sr.closedCount;
      acc.projectedToClose += sr.projectedToClose;
      acc.totalForecast += sr.totalForecast;
      strategySummaryTotals.set(sr.strategy, acc);
    }
  }

  const strategySummaryRows = STRATEGY_ORDER.map((strategy) => ({
    strategy,
    ...(strategySummaryTotals.get(strategy) ?? EMPTY_STRATEGY_TOTALS),
  }));

  /**
   * Fila "Total" -- suma de las 5 estrategias. Por construcción tiene que
   * cuadrar contra el agregado completo del snapshot filtrado (branch
   * aplicado, sin filtro de estrategia): `buildStrategyRows()` reparte el
   * entero YA REDONDEADO de cada branch entre sus estrategias
   * (`apportionByWeight`), así que la suma de las partes es EXACTA -- ese
   * mismo archivo trae su propio chequeo de desarrollo
   * (`console.warn('F6: el desglose por estrategia no cuadra', ...)`).
   */
  const strategySummaryTotal = strategySummaryRows.reduce(
    (acc, r) => ({
      totalCount: acc.totalCount + r.totalCount,
      healthyCount: acc.healthyCount + r.healthyCount,
      closedCount: acc.closedCount + r.closedCount,
      projectedToClose: acc.projectedToClose + r.projectedToClose,
      totalForecast: acc.totalForecast + r.totalForecast,
    }),
    { ...EMPTY_STRATEGY_TOTALS }
  );

  /**
   * Etapa EXCEL-6: hoja de portada -- todo dato ya calculado/disponible
   * en este componente, ningún cálculo nuevo. `activeStrategyFilter`
   * solo distingue "hay una estrategia elegida" de "no hay filtro" -- no
   * se puede distinguir acá "vista By branch" de "vista By strategy con
   * píldora All" (el alcance de esta etapa en PivotTable.tsx fue
   * agregar `export`, no un callback nuevo -- ver EXCEL-1, que ya
   * resuelve esa distinción del lado de PivotTable antes de exponerla).
   * Por eso la portada describe el EFECTO real sobre el export
   * ("Strategy filter: ..."), no el estado crudo del conmutador.
   */
  const coverSheetData = {
    snapshotId: activeSnapshotId,
    snapshotDataAsOf: activeSnapshotDate,
    pipelineDateRange: pipelineDateRange.startDate + ' to ' + pipelineDateRange.endDate,
    forecastMonth: forecastMonthLabel,
    branchFilter: selectedBranch === 'ALL' ? 'All branches' : selectedBranch,
    strategyFilter: activeStrategyFilter ?? 'All strategies',
    channelFilter: channelFilter === 'all' ? 'All channels' : channelFilter,
  };

  const exportRows = [
    ...strategyFilteredOpenLoans.map((loan) => ({
      loanChannel: loan.channel,
      loanNumber: loan.sourceLoanId,
      borrowerName: loan.borrowerName,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      healthiness: loan.rawHealthiness,
      branchTransferred: openLoanBranchTransferValue(loan),
      strategyRaw: loan.strategyRaw,
      opportunityOwnerTitle: loan.opportunityOwnerTitle,
      nppmRealtor: loan.nppmRealtor,
      referredBy: loan.referredBy,
      opportunityOwner: loan.opportunityOwner,
      strategy: strategyColumnValue(loan),
    })),
    ...strategyFilteredClosed.map((loan) => ({
      loanChannel: loan.channel,
      loanNumber: loan.sourceLoanId,
      borrowerName: loan.borrowerName,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      healthiness: 'Funded',
      branchTransferred: resolvedLoanBranchTransferValue(loan),
      strategyRaw: loan.strategyRaw,
      opportunityOwnerTitle: loan.opportunityOwnerTitle,
      nppmRealtor: loan.nppmRealtor,
      referredBy: loan.referredBy,
      opportunityOwner: loan.opportunityOwner,
      strategy: strategyColumnValue(loan),
    })),
    ...channelFilteredAdverse.map((loan) => ({
      loanChannel: loan.channel,
      loanNumber: loan.sourceLoanId,
      borrowerName: loan.borrowerName,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      healthiness: 'Adverse',
      branchTransferred: resolvedLoanBranchTransferValue(loan),
      strategyRaw: loan.strategyRaw,
      opportunityOwnerTitle: loan.opportunityOwnerTitle,
      nppmRealtor: loan.nppmRealtor,
      referredBy: loan.referredBy,
      opportunityOwner: loan.opportunityOwner,
      strategy: strategyColumnValue(loan),
    })),
  ];

  /*
   * Etapa RPT1. Manda sólo el mes: la ruta resuelve sola la fecha de corte --el
   * primer jueves-- y qué snapshot le corresponde. Deliberadamente NO le pasa
   * los filtros de la pantalla: el reporte mensual describe el mes entero, y
   * mandarlo filtrado por branch daría un archivo que dice "agosto" y muestra
   * un pedazo de agosto.
   */
  async function handleMonthlyReport() {
    setIsBuildingMonthly(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/monthly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: forecastMonth }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not build the monthly report.');
      }
      const blob = await res.blob();
      const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : `Pipeline_Monthly_Report_${forecastMonth}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBuildingMonthly(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: exportRows,
          cover: coverSheetData,
          strategySummary: {
            missing: strategyDataMissingForExport,
            rows: strategySummaryRows,
            total: strategySummaryTotal,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not generate the Excel file.');
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') ?? '';
      const match = contentDisposition.match(/filename="([^"]+)"/);
      const downloadName = match ? match[1] : 'Forecast_Pipeline.xlsx';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  }

  // resolvedLoans (Funded/Adverse) no entran a ningún OTRO cálculo -- los
  // 'adverse' nunca se suman a nada. Antes había una variable local
  // (`resolvedSummary`) que armaba un texto informativo con este mismo
  // dato ("Additionally, N loans already resolved...") -- Fase urgente:
  // Isabella pidió sacar ese texto de la UI, y sin ningún otro consumidor
  // (nunca alimentó ningún cálculo, ver comentario de arriba) la variable
  // quedó muerta -- se borra en vez de dejarla asignada sin uso.
  // `filteredResolvedLoans` en sí SIGUE usándose (Closed/Adverse/AdverseTable
  // más abajo, sin tocar).

  return (
    <div className="hub-container">
      {/*
        Etapa BP16. El subtítulo decía "Projected forecast, milestone pipeline
        matrix and adverse loans — August 2026": una descripción de las tres
        pestañas que ya están ahí abajo, con el único dato útil -- de qué mes es
        el forecast -- escondido al final. Queda sólo el mes, en grande.

        Y las dos acciones de archivo van juntas arriba a la derecha. Subir
        tenía su propia franja abajo, lejos de descargar, que es su par.
      */}
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Forecast &amp; Pipeline</h1>
          <input
            type="month"
            className="fc-month"
            value={forecastMonth}
            onChange={(e) => setForecastMonth(e.target.value)}
            aria-label="Forecast Month"
            title="Cambiar el mes de forecast"
          />
        </div>
        <div className="fc-actions">
          {/*
            Acá estaba "Upload file", al lado de "Download Excel". Se fue: desde
            esta pantalla ya no se sube nada. Queda sólo descargar, que es la
            única acción de archivo que la usuaria todavía inicia desde acá.
            Cuándo se actualizó el dato pasó a la barra de control, junto a los
            demás indicadores de estado (ver Topbar).
          */}
          {data && (
            /*
             * Etapa EXCEL-4: además de `isExporting`, deshabilitado mientras
             * `isAdverseHistoryLoading` -- sin esto, un click apenas carga el
             * snapshot corre `handleExport()` con `adverseInRange` todavía en
             * 0 de forma legítima (firstSeenAsAdverse no llegó), y el Excel
             * sale sin ninguna fila Adverse aunque sí existan. Mismo botón,
             * un estado de carga más -- no un botón nuevo.
             */
            <button
              type="button"
              className="btn primary"
              onClick={handleExport}
              disabled={isExporting || isAdverseHistoryLoading}
            >
              <DownloadIcon />
              {isExporting ? 'Generating…' : isAdverseHistoryLoading ? 'Preparing…' : 'Download Excel'}
            </button>
          )}
          {/*
            Etapa RPT1 — el reporte mensual, al lado de la descarga de siempre.
            Son dos cosas distintas y por eso son dos botones: "Download Excel"
            baja lo que hay en pantalla AHORA, con los filtros puestos; esto baja
            la comparación de un MES CERRADO contra su fecha de corte, y no
            depende de ningún filtro de la pantalla. Usa el mes del selector de
            Forecast, que es el único mes que la usuaria ya eligió.
          */}
          {data && (
            <button
              type="button"
              className="btn"
              onClick={handleMonthlyReport}
              disabled={isBuildingMonthly}
              title={`Compare the pipeline at the cut-off against how ${forecastMonthLabel} actually closed`}
            >
              <FileSheetIcon />
              {isBuildingMonthly ? 'Building…' : `Monthly report (${forecastMonthLabel})`}
            </button>
          )}
        </div>
      </div>

      {/* Etapa UX1: el Topbar dejó de ser una franja a todo el ancho por encima
          del contenido -- ahora es la tarjeta de control (spec §3B) dentro del
          mismo contenedor de 1440px que el resto de la vista. */}
      <Topbar
        pipelineDateRange={pipelineDateRange}
        onPipelineDateRangeChange={setPipelineDateRange}
        availableBranches={[...new Set(branchRows.map((r) => r.branch))].sort()}
        selectedBranch={selectedBranch}
        onSelectBranch={setSelectedBranch}
        error={error}
        /*
         * Se van `formatDetected` y `saveStatus`. Los dos salían de la
         * respuesta de /api/pipeline/parse, que ya no se llama desde acá: la
         * restauración desde Supabase nunca trajo esos campos, así que sin la
         * carga quedaban permanentemente en undefined/'idle'. Y "Saving to
         * Supabase…" en una pantalla que no puede guardar es peor que no decir
         * nada.
         */
        lastUpdatedLabel={lastUploadedAt ? formatLastUpload(lastUploadedAt) : null}
      />

      {!data && isLoadingInitial && (
        <div className="empty">
          <h2>Loading…</h2>
          <p>Looking for the last saved report.</p>
        </div>
      )}

      {!data && !isLoadingInitial && (
        /*
         * El estado vacío ya no ofrece subir el archivo, así que tiene que
         * decir dónde se sube. Sin eso queda una pantalla que informa que no
         * hay nada y no da ninguna salida -- el peor final posible para quien
         * entró justamente a mirar el pipeline.
         */
        <div className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>No pipeline snapshot yet</h2>
          <p>
            The Salesforce file is now uploaded from the Data Uploads app. Once it is loaded, the
            snapshot appears here on its own — there is nothing to upload from this screen.
          </p>
        </div>
      )}

      {data && (
        <>
          <SummaryCards
            combined={{
              label: 'Combined',
              totalCount: grandTotalCount,
              healthyCount: grandHealthyCount,
              forecastTotal: grandForecastTotal,
              closedCount,
              totalForecast,
            }}
            banked={bankedSummary}
            brokered={brokeredSummary}
            projectedToCloseSoon={projectedToCloseSoon}
            ctcCount={ctcClosingSplit.ctcCount}
            closingCount={ctcClosingSplit.closingCount}
          />

          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} adverseCount={adverseInRange.length} />

          {/* Etapa F5e: todo lo que PivotTable hace internamente con su prop
              `dateRange` es filtrar Cerrados (disbursementDate) -- Total/Healthy
              Pipeline de cada branch le llegan ya calculados en `rows`. Por eso
              se le pasa el rango del selector de mes (forecastRange), no
              pipelineDateRange: su columna "Closed" queda consistente con
              SummaryCards/MilestoneCascade. */}
          {activeTab === 'executive' && (
            <PivotTable
              rows={filteredBranchRows}
              resolvedLoans={filteredResolvedLoans}
              rates={PULL_THROUGH_RATES}
              dateRange={forecastRange}
              branchManagers={branchManagers}
              knownBranches={knownBranches}
              selectedBranch={selectedBranch}
              onActiveStrategyFilterChange={setActiveStrategyFilter}
            />
          )}

          {activeTab === 'matrix' && (
            <TabMilestoneMatrix
              bankedRows={bankedCascadeRows}
              brokeredRows={brokeredCascadeRows}
              bankedRates={PULL_THROUGH_RATES}
              brokeredRates={brokeredFlatRatesDisplay}
              rows={filteredBranchRows}
              brokeredClosedCount={brokeredSummary.closedCount}
              brokeredTotalForecast={brokeredSummary.totalForecast}
            />
          )}

          {activeTab === 'adverse' && (
            <AdverseTable
              resolvedLoans={adverseInRange}
              forecastMonthLabel={forecastMonthLabel}
              firstSeenAsAdverse={firstSeenAsAdverse}
              onChannelFilterChange={setChannelFilter}
            />
          )}

          {/*
           * Fase urgente, punto 5: Isabella pidió explícitamente sacar de la
           * UI el texto "Additionally, N loans already resolved (...) --
           * they do not count toward the Forecast." Ese texto vivía en una
           * variable local (`resolvedSummary`) que ya no existe -- se borró
           * junto con el render, al no quedar ningún otro consumidor (ver
           * el comentario donde se calculaba `filteredResolvedLoans`, más
           * arriba). No afecta ningún cálculo de Forecast/Closed/Funded/
           * Adverse -- `filteredResolvedLoans` sigue alimentando Closed y
           * Adverse exactamente igual que antes.
           */}

          {data.warnings.length > 0 && (
            <div className="foot-note">
              <strong>Parser warnings ({data.warnings.length}):</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
