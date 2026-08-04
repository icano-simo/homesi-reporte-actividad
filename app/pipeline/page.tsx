'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  splitHealthyTotal,
  countByMilestoneBucket,
  calculateForecast,
  calculateTotalForecastWithClosed,
  targetMonthRange,
  countByBrokeredMilestoneBucket,
  calculateBrokeredForecast,
  BROKERED_PULL_THROUGH_RATES,
  type BucketCounts,
  type PullThroughRates,
  type DateRange,
  type TargetMonth,
} from '@/lib/pipeline/aggregate';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import SummaryCards, { type SummaryBlock } from './SummaryCards';
import MilestoneCascade, { type MilestoneCascadeRow } from './MilestoneCascade';
import PivotTable, { type BranchForecastRow } from './PivotTable';
import UploadButton, { PIPELINE_FILE_INPUT_ID } from './UploadButton';
import DateRangeInput from './DateRangeInput';
import MonthSelector from './MonthSelector';
import AdverseTable from './AdverseTable';

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
 * Etapa F5e: este rango ahora es SOLO para Total/Healthy Pipeline y
 * Adverse -- Cerrados/Forecast usan forecastMonth (independiente, ver
 * abajo), ya no derivan nada de este rango.
 */
function getDefaultPipelineDateRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
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
  // Etapa F4g: mismo cliente/efecto, se agrega pipeline_forecast.branches
  // (roster de branches conocidos, columna `code`) -- se usa en PivotTable
  // para no mostrar filas fantasma de branches sin actividad real en el
  // rango. Ambas consultas van al mismo schema DISTINTO al de Actividad
  // ('activity_report') -- no se puede reusar el cliente de
  // lib/supabase/client.ts, que está fijo a ese schema; se arma acá un
  // cliente propio apuntando a 'pipeline_forecast'. Se cargan una sola vez
  // al montar, no dependen del archivo subido. Si cualquiera falla (env
  // vars ausentes, tabla no encontrada, RLS, etc.) se deja su estado vacío
  // -- PivotTable ya maneja ambos casos vacíos sin romper la página.
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const supabaseForecast = createClient(supabaseUrl, supabaseAnonKey, {
      db: { schema: 'pipeline_forecast' },
    });

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
    } catch (err) {
      setError(errorMessage(err));
      setData(null);
      setFileName(null);
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
      // Etapa F5i: Brokered ya no usa la fórmula/tasas de Banked -- tiene su
      // propia cascada de 4 etapas (ver aggregate.ts, confirmado con el
      // usuario en la respuesta de esta etapa). bucketTotal/bucketHealthy/
      // forecastByBucket de arriba quedan calculados con la fórmula de
      // Banked solo por compatibilidad de tipos con BranchForecastRow
      // (definido en PivotTable.tsx, fuera de la lista de archivos de F5i) --
      // nadie los lee para una fila Brokered, PivotTable.tsx solo usa
      // forecastTotal y loans de cada fila. El desglose real de Brokered
      // (para su propia cascada) se recalcula aparte más abajo, a partir de
      // `loans`, no de estos campos vestigiales.
      const forecastTotal =
        channel === 'Brokered'
          ? calculateBrokeredForecast(countByBrokeredMilestoneBucket(healthy), BROKERED_PULL_THROUGH_RATES).forecastTotal
          : bankedFormulaForecastTotal;
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

  const grandTotalCount = branchRows.reduce((sum, r) => sum + r.totalCount, 0);
  const grandHealthyCount = branchRows.reduce((sum, r) => sum + r.healthyCount, 0);
  // Ya correcto para los 2 canales: cada r.forecastTotal viene de la fórmula
  // que le toca (Banked o Brokered, ver el loop de arriba), así que sumarlos
  // acá sigue dando el total combinado real -- no hizo falta tocar esta
  // línea en F5i.
  const grandForecastTotal = branchRows.reduce((sum, r) => sum + r.forecastTotal, 0);

  // Etapa F5i: antes esto agregaba bucketTotal/bucketHealthy/forecastByBucket
  // de TODOS los branchRows (ambos canales) para alimentar una única cascada
  // combinada -- ya no tiene sentido, Brokered tiene su propio esquema de
  // buckets (FileCreation/AppDate/Processing/Submitted), incompatible con el
  // de Banked (Started/Processing/Underwriting/Closing). Se acota a
  // Banked-only acá; el desglose de Brokered se recalcula aparte, más abajo,
  // desde `loans` (no desde bucketTotal/bucketHealthy/forecastByBucket de
  // branchRows, que para una fila Brokered son vestigiales -- ver nota en el
  // loop de arriba).
  const bankedBranchRows = branchRows.filter((r) => r.channel === 'Banked - Retail');
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
  const brokeredBranchRows = branchRows.filter((r) => r.channel === 'Brokered');
  const brokeredLoans = brokeredBranchRows.flatMap((r) => r.loans);
  const brokeredHealthyLoans = brokeredLoans.filter((l) => l.healthy === true);
  const brokeredBucketTotal = countByBrokeredMilestoneBucket(brokeredLoans);
  const brokeredBucketHealthy = countByBrokeredMilestoneBucket(brokeredHealthyLoans);
  const { forecastByBucket: brokeredForecastByBucket } = calculateBrokeredForecast(
    brokeredBucketHealthy,
    BROKERED_PULL_THROUGH_RATES
  );

  // Etapa F4b: el Forecast del negocio real es Cerrados (Funded) + la
  // proyección de pull-through que ya calculaba aggregate.ts -- no la
  // proyección sola. calculateTotalForecastWithClosed() es la única función
  // nueva agregada a aggregate.ts en F4b; no toca ninguna de las 3 ya
  // aprobadas (splitHealthyTotal/countByMilestoneBucket/calculateForecast).
  const { closedCount, totalForecast } = data
    ? calculateTotalForecastWithClosed(data.resolvedLoans, grandForecastTotal, forecastRange)
    : { closedCount: 0, totalForecast: 0 };

  // Etapa F4f: mismo cálculo que el combinado de arriba, pero recortado por
  // canal -- branchRows y resolvedLoans ya vienen separados por channel, así
  // que solo hace falta filtrar antes de sumar/llamar
  // calculateTotalForecastWithClosed (misma función de F4b, sin tocarla).
  function summarizeChannel(channel: PipelineLoan['channel'], label: string): SummaryBlock {
    const channelRows = branchRows.filter((r) => r.channel === channel);
    const totalCount = channelRows.reduce((sum, r) => sum + r.totalCount, 0);
    const healthyCount = channelRows.reduce((sum, r) => sum + r.healthyCount, 0);
    const forecastTotal = channelRows.reduce((sum, r) => sum + r.forecastTotal, 0);
    const channelResolved = data ? data.resolvedLoans.filter((l) => l.channel === channel) : [];
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

  const summaryBlocks: SummaryBlock[] = [
    bankedSummary,
    brokeredSummary,
    {
      label: 'Combined',
      totalCount: grandTotalCount,
      healthyCount: grandHealthyCount,
      forecastTotal: grandForecastTotal,
      closedCount,
      totalForecast,
    },
  ];

  // Etapa F5i: filas para las 2 cascadas -- MilestoneCascade ya no sabe de
  // Banked/Brokered, solo dibuja lo que le pasen (ver MilestoneCascade.tsx).
  // `rate` es la tasa PROPIA de cada etapa (no acumulada); el componente
  // calcula la acumulada mostrada en "% applied" como producto de las tasas
  // desde esa fila en adelante -- mismo cálculo que antes, ahora genérico.
  const bankedCascadeRows: MilestoneCascadeRow[] = [
    {
      key: 'Started',
      label: 'Started',
      rate: PULL_THROUGH_RATES.Started,
      healthy: bankedBucketHealthy.Started,
      total: bankedBucketTotal.Started,
      forecast: bankedForecastByBucket.Started,
    },
    {
      key: 'Processing',
      label: 'Processing',
      rate: PULL_THROUGH_RATES.Processing,
      healthy: bankedBucketHealthy.Processing,
      total: bankedBucketTotal.Processing,
      forecast: bankedForecastByBucket.Processing,
    },
    {
      key: 'Underwriting',
      label: 'Underwriting',
      rate: PULL_THROUGH_RATES.Underwriting,
      healthy: bankedBucketHealthy.Underwriting,
      total: bankedBucketTotal.Underwriting,
      forecast: bankedForecastByBucket.Underwriting,
    },
    {
      key: 'Closing',
      label: 'Closing',
      rate: PULL_THROUGH_RATES.Closing,
      healthy: bankedBucketHealthy.Closing,
      total: bankedBucketTotal.Closing,
      forecast: bankedForecastByBucket.Closing,
    },
  ];

  const brokeredCascadeRows: MilestoneCascadeRow[] = [
    {
      key: 'FileCreation',
      label: 'File Creation',
      rate: BROKERED_PULL_THROUGH_RATES.FileCreation,
      healthy: brokeredBucketHealthy.FileCreation,
      total: brokeredBucketTotal.FileCreation,
      forecast: brokeredForecastByBucket.FileCreation,
    },
    {
      key: 'AppDate',
      label: 'App Date',
      rate: BROKERED_PULL_THROUGH_RATES.AppDate,
      healthy: brokeredBucketHealthy.AppDate,
      total: brokeredBucketTotal.AppDate,
      forecast: brokeredForecastByBucket.AppDate,
    },
    {
      key: 'Processing',
      label: 'Processing',
      rate: BROKERED_PULL_THROUGH_RATES.Processing,
      healthy: brokeredBucketHealthy.Processing,
      total: brokeredBucketTotal.Processing,
      forecast: brokeredForecastByBucket.Processing,
    },
    {
      key: 'Submitted',
      label: 'Submitted',
      rate: BROKERED_PULL_THROUGH_RATES.Submitted,
      healthy: brokeredBucketHealthy.Submitted,
      total: brokeredBucketTotal.Submitted,
      forecast: brokeredForecastByBucket.Submitted,
    },
  ];

  // Etapa F4i: filtro original -- status='adverse' Y Loan Status='Application
  // withdrawn' Y Est. Closing Date dentro del rango activo.
  // Etapa F5h: se confirmó con datos reales que ese filtro por Loan Status
  // excluía Adverse legítimos con otros motivos (Application denied, File
  // Closed for incompleteness, y hasta casos con Loan Status desincronizado
  // tipo "Active Loan" a pesar de Stage=Closed Lost) -- se quita esa
  // condición. El filtro queda solo status='adverse' Y Est. Closing Date
  // dentro del rango activo (mismo campo/rango que ya usa Total/Healthy
  // Pipeline desde F4f). Deliberadamente NO se filtra por Loan Folder --
  // confirmado por el negocio que ese campo puede estar desactualizado.
  const adverseInRange = data
    ? data.resolvedLoans.filter(
        (loan) =>
          loan.status === 'adverse' &&
          loan.estClosingDate !== null &&
          loan.estClosingDate >= pipelineDateRange.startDate &&
          loan.estClosingDate <= pipelineDateRange.endDate
      )
    : [];

  // resolvedLoans (Funded/Adverse) no entran a ningún OTRO cálculo -- los
  // 'adverse' nunca se suman a nada; solo una línea informativa, sin tabla
  // ni drill-down (eso es una etapa futura).
  let resolvedSummary: string | null = null;
  if (data && data.resolvedLoans.length > 0) {
    const funded = data.resolvedLoans.filter((l) => l.status === 'funded').length;
    const adverse = data.resolvedLoans.filter((l) => l.status === 'adverse').length;
    resolvedSummary =
      'Additionally, ' +
      data.resolvedLoans.length.toLocaleString('en-US') +
      ' loans already resolved (' +
      adverse.toLocaleString('en-US') +
      ' adverse, ' +
      funded.toLocaleString('en-US') +
      ' funded) in this file -- they do not count toward the Forecast.';
  }

  return (
    <div className="main">
      <div className="topbar">
        <div className="toolbar-row">
          <span className="label-chip">Data</span>
          <UploadButton onFileSelected={handleFileSelected} isLoading={isLoading} />
          <DateRangeInput value={pipelineDateRange} onChange={setPipelineDateRange} />
          <MonthSelector value={forecastMonth} onChange={setForecastMonth} />
        </div>
        <div className="loaded-row">
          {fileName && <span className="pill">File: {fileName}</span>}
          {data && data.formatDetected && <span className="pill">Format detected: {data.formatDetected}</span>}
          {data && <span className="pill">Open loans: {data.openLoans.length.toLocaleString('en-US')}</span>}
          {data && data.persisted === true && <span className="pill">Saved to Supabase</span>}
          {data && data.persisted === false && <span className="pill warn">Could not save to Supabase</span>}
          {error && <span className="pill warn">{error}</span>}
        </div>
      </div>

      <div className="content">
        <h1 className="title">Forecast — Pipeline</h1>

        {!data && isLoadingInitial && (
          <div className="empty">
            <h2>Loading…</h2>
            <p>Looking for the last saved report.</p>
          </div>
        )}

        {!data && !isLoading && !isLoadingInitial && (
          <div className="empty">
            <div className="drop-ic">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 3v5h5" />
                <path d="M14 3H6v18h12V8z" />
                <path d="M9 15h6M9 11h6" />
              </svg>
            </div>
            <h2>Load the pipeline report</h2>
            <p>Upload the Salesforce file (Excel). The app detects the format automatically.</p>
            <label className="btn primary" htmlFor={PIPELINE_FILE_INPUT_ID} style={{ display: 'inline-flex' }}>
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
            <SummaryCards blocks={summaryBlocks} targetMonthLabel={forecastMonthLabel} />

            {/* Etapa F5i: antes era UNA cascada combinada (ambos canales) --
                Brokered tiene su propio esquema de buckets, incompatible con
                el de Banked, así que se muestran 2 cascadas separadas. */}
            <div className="cards-head" style={{ marginTop: '24px' }}>
              Pull-through Cascade — Banked - Retail
            </div>
            <MilestoneCascade
              rows={bankedCascadeRows}
              forecastTotal={bankedSummary.forecastTotal}
              closedCount={bankedSummary.closedCount}
              totalForecast={bankedSummary.totalForecast}
            />

            <div className="cards-head" style={{ marginTop: '24px' }}>
              Pull-through Cascade — Brokered
            </div>
            <MilestoneCascade
              rows={brokeredCascadeRows}
              forecastTotal={brokeredSummary.forecastTotal}
              closedCount={brokeredSummary.closedCount}
              totalForecast={brokeredSummary.totalForecast}
            />

            <div className="cards-head" style={{ marginTop: '24px' }}>
              Branch Breakdown
            </div>
            {/* Etapa F5e: PivotTable no se modifica (fuera de la lista de esta etapa).
                Todo lo que hace internamente con su prop `dateRange` es filtrar
                Cerrados (disbursementDate) -- Total/Healthy Pipeline de cada branch
                le llegan ya calculados en `rows`. Por eso se le sigue pasando acá
                el rango del selector de mes (forecastRange), no pipelineDateRange:
                su columna "Closed" queda consistente con SummaryCards/
                MilestoneCascade sin tocar el código de PivotTable.tsx. */}
            <PivotTable
              rows={branchRows}
              resolvedLoans={data.resolvedLoans}
              rates={PULL_THROUGH_RATES}
              dateRange={forecastRange}
              branchManagers={branchManagers}
              knownBranches={knownBranches}
            />

            <div className="cards-head" style={{ marginTop: '24px' }}>
              Adverse
            </div>
            <AdverseTable
              resolvedLoans={adverseInRange}
              dateRangeLabel={pipelineDateRange.startDate + ' to ' + pipelineDateRange.endDate}
              firstSeenAsAdverse={firstSeenAsAdverse}
            />

            {resolvedSummary && <div className="foot-note">{resolvedSummary}</div>}

            {data.warnings.length > 0 && (
              <div className="foot-note">
                <strong>
                  Parser warnings ({data.warnings.length}):
                </strong>
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
    </div>
  );
}
