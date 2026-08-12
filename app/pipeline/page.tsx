'use client';

import './styles/forecast-visual.css';
import { useEffect, useState } from 'react';
import {
  splitHealthyTotal,
  countByMilestoneBucket,
  calculateForecast,
  calculateTotalForecastWithClosed,
  targetMonthRange,
  countByBrokeredMilestoneBucket,
  BROKERED_FLAT_PULL_THROUGH_RATE,
  apportionByWeight,
  type BucketCounts,
  type PullThroughRates,
  type BrokeredPullThroughRates,
  type BrokeredForecastByBucket,
  type DateRange,
  type TargetMonth,
} from '@/lib/pipeline/aggregate';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import SummaryCards, { type SummaryBlock } from './SummaryCards';
import type { MilestoneCascadeRow } from './MilestoneCascade';
import PivotTable, { type BranchForecastRow } from './PivotTable';
import { PIPELINE_FILE_INPUT_ID } from './UploadButton';
import AdverseTable from './AdverseTable';
import Topbar from './Topbar';
import TabNavigation, { type TabType } from './TabNavigation';
import TabMilestoneMatrix from './TabMilestoneMatrix';
import { getForecastDb, isSupabaseConfigured } from '@/lib/supabase/client';
import { DownloadIcon, FileSheetIcon, UploadIcon } from '@/components/ui/icons';

/**
 * Etapa F4: mismos valores que DEMO_RATES (F3). El input editable en la UI
 * para estos 4 micro-% es una etapa futura, no aprobada todavía -- se
 * duplican acá en vez de importar fixtures/pipeline-demo.ts porque esta
 * página ya no depende del módulo de fixture (ver Decisiones en la
 * respuesta de F4).
 */
const PULL_THROUGH_RATES: PullThroughRates = {
  Started: 0.8923,
  Processing: 0.93,
  Underwriting: 0.8459,
  Closing: 0.95,
};

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
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  // Etapa F5k: true mientras se genera/descarga el Excel -- evita doble
  // click y le da feedback visual al botón (mismo patrón que isLoading del
  // upload).
  const [isExporting, setIsExporting] = useState(false);

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
        if (!body || !body.snapshot) return;
        setData({ openLoans: body.openLoans, resolvedLoans: body.resolvedLoans, warnings: body.warnings ?? [] });
        setFileName(body.snapshot.fileName);
        setActiveSnapshotDate(typeof body.snapshot.uploadedAt === 'string' ? body.snapshot.uploadedAt.slice(0, 10) : null);
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
    fetch('/api/pipeline/adverse-history')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setFirstSeenAsAdverse(body?.firstSeen ?? {});
      })
      .catch(() => {
        if (cancelled) return;
        setFirstSeenAsAdverse({});
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  async function handleFileSelected(file: File) {
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/pipeline/parse', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not process the file.');
      }
      setData(body as ParseApiResponse);
      setFileName(file.name);
      // Etapa F5j: el snapshot se crea en este mismo request, del lado del
      // servidor, con new Date().toISOString().slice(0,10) -- usar "ahora"
      // acá es la fecha real, no una aproximación (parse/route.ts no está
      // en la lista de archivos de esta etapa, así que no devuelve la fecha
      // de vuelta; no hace falta, ya la sabemos).
      setActiveSnapshotDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      setError(errorMessage(err));
      setData(null);
      setFileName(null);
      setActiveSnapshotDate(null);
    } finally {
      setIsLoading(false);
    }
  }

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
  const branchRows: BranchForecastRow[] = [];
  if (data) {
    const groups = new Map<string, { branch: string; channel: PipelineLoan['channel'] }>();
    for (const loan of data.openLoans) {
      groups.set(loan.branch + '::' + loan.channel, { branch: loan.branch, channel: loan.channel });
    }
    for (const { branch, channel } of groups.values()) {
      const { total, healthy } = splitHealthyTotal(data.openLoans, branch, channel, pipelineDateRange);
      const bucketTotal = countByMilestoneBucket(total);
      const bucketHealthy = countByMilestoneBucket(healthy);
      const { forecastByBucket, forecastTotal: bankedFormulaForecastTotal } = calculateForecast(bucketHealthy, PULL_THROUGH_RATES);
      // Etapa F5j: Brokered ya no usa Healthy ni una cascada por etapa --
      // pull-through PLANO del 40% (BROKERED_FLAT_PULL_THROUGH_RATE,
      // aggregate.ts) sobre el TOTAL de préstamos abiertos de esa branch
      // (no sobre Healthy: cambio de población, no solo de tasa). Banked
      // sigue exactamente igual: bankedFormulaForecastTotal es la cascada de
      // siempre (calculateForecast + PULL_THROUGH_RATES) sobre Healthy, sin
      // tocar. bucketTotal/bucketHealthy/forecastByBucket de arriba quedan
      // calculados con la fórmula de Banked solo por compatibilidad de tipos
      // con BranchForecastRow (PivotTable.tsx) -- nadie los lee para una
      // fila Brokered; el desglose real de Brokered para su propia cascada
      // se recalcula aparte más abajo, a partir de `loans`.
      //
      // Redondeo (Cambio 4 del brief F5j): se redondea ACÁ, por fila de
      // branch, para los 2 canales -- no al mostrar. `forecastTotal` de acá
      // en más solo se usa para sumar/mostrar (grandForecastTotal,
      // summarizeChannel, y el `forecastTotal` que recibe PivotTable.tsx por
      // fila) -- nunca para otra decisión de negocio -- así que adelantar el
      // redondeo acá hace que todo lo que sume esto herede "sumar filas ya
      // enteras" sin tocar esos archivos. Como closedCount siempre es entero,
      // round(closedCount + x) === closedCount + round(x) para cualquier x:
      // el valor que ve cada fila individual (PivotTable) quedó IDÉNTICO a
      // antes; lo único que cambia es que el subtotal/total ya no arrastra
      // decimales antes de redondear una sola vez al final. El valor
      // CALCULADO de Banked (bankedFormulaForecastTotal, con decimales) no
      // se toca en absoluto -- Math.round() acá es solo el punto de display,
      // no una nueva fórmula.
      const forecastTotal =
        channel === 'Brokered'
          ? Math.round(total.length * BROKERED_FLAT_PULL_THROUGH_RATE)
          : Math.round(bankedFormulaForecastTotal);
      branchRows.push({
        branch,
        channel,
        totalCount: total.length,
        healthyCount: healthy.length,
        bucketTotal,
        bucketHealthy,
        forecastByBucket,
        forecastTotal,
        loans: total,
      });
    }
  }

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
  // Etapa F5j, Cambio 4 (Banked): `forecast` de cada fila se redondea acá,
  // en el punto de armado -- MilestoneCascade.tsx no está en el alcance de
  // este ajuste, así que no se le puede pedir que redondee al mostrar. El
  // valor CALCULADO (bankedForecastByBucket.*, con decimales, cascada de
  // PULL_THROUGH_RATES sobre Healthy) no cambia ni un decimal -- Math.round()
  // acá es puramente de display, igual que el de `forecastTotal` más arriba.
  // Confirmado con Isabella antes de tocar esto (ver reporte de F5j): "no
  // tocar Banked" es sobre la lógica (tasas/fórmula/población/cascada), no
  // sobre el redondeo de display, y dejarlo sin redondear acá haría que
  // Banked mostrara decimales en esta pestaña mientras Executive (y
  // Brokered en esta misma tabla) muestran enteros.
  const bankedCascadeRows: MilestoneCascadeRow[] = [
    {
      key: 'Started',
      label: 'Started',
      rate: PULL_THROUGH_RATES.Started,
      healthy: bankedBucketHealthy.Started,
      total: bankedBucketTotal.Started,
      forecast: Math.round(bankedForecastByBucket.Started),
    },
    {
      key: 'Processing',
      label: 'Processing',
      rate: PULL_THROUGH_RATES.Processing,
      healthy: bankedBucketHealthy.Processing,
      total: bankedBucketTotal.Processing,
      forecast: Math.round(bankedForecastByBucket.Processing),
    },
    {
      key: 'Underwriting',
      label: 'Underwriting',
      rate: PULL_THROUGH_RATES.Underwriting,
      healthy: bankedBucketHealthy.Underwriting,
      total: bankedBucketTotal.Underwriting,
      forecast: Math.round(bankedForecastByBucket.Underwriting),
    },
    {
      key: 'Closing',
      label: 'Closing',
      rate: PULL_THROUGH_RATES.Closing,
      healthy: bankedBucketHealthy.Closing,
      total: bankedBucketTotal.Closing,
      forecast: Math.round(bankedForecastByBucket.Closing),
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
   * solo array para el export a Excel -- "Last Meeting" según el tipo de
   * préstamo: rawHealthiness tal cual para abiertos (SIN pasar por
   * healthStatusLabel -- acá se quiere el valor crudo, no "Healthy"
   * normalizado), "Funded"/"Adverse" literal para los otros 2 grupos.
   */
  const exportRows = [
    ...openLoansInRange.map((loan) => ({
      loanChannel: loan.channel,
      loanNumber: loan.sourceLoanId,
      borrowerName: loan.borrowerName,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      lastMeeting: loan.rawHealthiness,
    })),
    ...closedInRange.map((loan) => ({
      loanChannel: loan.channel,
      loanNumber: loan.sourceLoanId,
      borrowerName: loan.borrowerName,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      lastMeeting: 'Funded',
    })),
    ...adverseInRange.map((loan) => ({
      loanChannel: loan.channel,
      loanNumber: loan.sourceLoanId,
      borrowerName: loan.borrowerName,
      branch: loan.branch,
      loanOfficer: loan.loanOfficer,
      lastMeeting: 'Adverse',
    })),
  ];

  async function handleExport() {
    setIsExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: exportRows }),
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
  // 'adverse' nunca se suman a nada; solo una línea informativa, sin tabla
  // ni drill-down (eso es una etapa futura).
  let resolvedSummary: string | null = null;
  if (data && filteredResolvedLoans.length > 0) {
    const funded = filteredResolvedLoans.filter((l) => l.status === 'funded').length;
    const adverse = filteredResolvedLoans.filter((l) => l.status === 'adverse').length;
    resolvedSummary =
      'Additionally, ' +
      filteredResolvedLoans.length.toLocaleString('en-US') +
      ' loans already resolved (' +
      adverse.toLocaleString('en-US') +
      ' adverse, ' +
      funded.toLocaleString('en-US') +
      ' funded) in this file -- they do not count toward the Forecast.';
  }

  return (
    <div className="hub-container">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Forecast &amp; Pipeline</h1>
          <p className="page-head__subtitle">
            Executive branch forecast, milestone pipeline matrix and adverse loans — {forecastMonthLabel}
          </p>
        </div>
        {data && (
          <button type="button" className="btn primary" onClick={handleExport} disabled={isExporting}>
            <DownloadIcon />
            {isExporting ? 'Generating…' : 'Download Excel'}
          </button>
        )}
      </div>

      {/* Etapa UX1: el Topbar dejó de ser una franja a todo el ancho por encima
          del contenido -- ahora es la tarjeta de control (spec §3B) dentro del
          mismo contenedor de 1440px que el resto de la vista. */}
      <Topbar
        onFileSelected={handleFileSelected}
        isLoading={isLoading}
        fileName={fileName}
        pipelineDateRange={pipelineDateRange}
        onPipelineDateRangeChange={setPipelineDateRange}
        forecastMonth={forecastMonth}
        onForecastMonthChange={setForecastMonth}
        availableBranches={[...new Set(branchRows.map((r) => r.branch))].sort()}
        selectedBranch={selectedBranch}
        onSelectBranch={setSelectedBranch}
        error={error}
        formatDetected={data?.formatDetected}
        saveStatus={data?.persisted === true ? 'saved' : data?.persisted === false ? 'error' : 'idle'}
      />

      {!data && isLoadingInitial && (
        <div className="empty">
          <h2>Loading…</h2>
          <p>Looking for the last saved report.</p>
        </div>
      )}

      {!data && !isLoading && !isLoadingInitial && (
        <div className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>Load the pipeline report</h2>
          <p>Upload the Salesforce file (Excel). The app detects the format automatically.</p>
          <label className="btn cta" htmlFor={PIPELINE_FILE_INPUT_ID} style={{ display: 'inline-flex' }}>
            <UploadIcon />
            Select file
          </label>
        </div>
      )}

      {isLoading && (
        <div className="empty">
          <h2>Processing file…</h2>
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
            targetMonthLabel={forecastMonthLabel}
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
            />
          )}

          {resolvedSummary && <div className="foot-note">{resolvedSummary}</div>}

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
