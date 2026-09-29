'use client';

// Next.js code-parte el CSS por ruta -- `TabAnalytics.tsx` depende de estas
// clases (.trend-chart, .pareto-bar, .avgticket-dot, .tbl-card, etc., ver
// app/pipeline/styles/forecast-visual.css) pero esa hoja solo se importaba
// en app/pipeline/page.tsx. Sin este import, esta ruta habría renderizado
// el mismo componente sin ningún estilo -- descubierto revisando qué
// clases usa TabAnalytics.tsx contra dónde están definidas, no asumido.
import '@/app/pipeline/styles/forecast-visual.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import type { LoanRecord } from '@/lib/domain/types';
import { loadCurrentReport } from '@/lib/supabase/loadCurrent';
import TabAnalytics from '@/app/pipeline/TabAnalytics';
import CommercialActivityTrends from '@/app/pipeline/CommercialActivityTrends';
import { useOrgRoster } from '@/app/pipeline/useOrgRoster';
import { resolveLoanOfficerName } from '@/lib/activity/resolveLoanOfficerName';
import {
  buildDaysToClosePivot,
  groupKeyOf,
  type DaysToCloseGroupBy,
  type DaysToCloseCell,
  type DaysToCloseLoanResult,
} from '@/lib/activity/daysToClosePivot';
import { aggregateDaysToCloseCells } from '@/lib/activity/daysToClosePivotCells';
import DaysToCloseDimensionSelector from '@/components/activity/DaysToCloseDimensionSelector';
import DaysToClosePivotTable from '@/components/activity/DaysToClosePivotTable';
import DaysToClosePivotDrillDown from '@/components/activity/DaysToClosePivotDrillDown';
import { useYearMonthFilter } from '@/components/activity/useYearMonthFilter';
import YearMonthFilterControls from '@/components/activity/YearMonthFilterControls';
import {
  computeOnTimeDelayedByMonthAndBranch,
  computeOnTimeDelayedByMonthAndGroup,
  computeOnTimeDelayedTotals,
  computeOnTimeDelayedLoanResults,
} from '@/lib/activity/onTimeDelayed';
import OnTimeDelayedTable from '@/components/activity/OnTimeDelayedTable';
import OnTimeDelayedDrillDown from '@/components/activity/OnTimeDelayedDrillDown';
import SectionScrollspyNav, { NAV_HEIGHT_PX } from '@/components/activity/SectionScrollspyNav';
import {
  computeComparablePeriod,
  comparableWindowLabel,
  summarizeDurationWindow,
  loansWithinWindow,
} from '@/lib/activity/activityComparablePeriod';
import DurationKpiCards from '@/components/activity/DurationKpiCards';
import OnTimeKpiCards from '@/components/activity/OnTimeKpiCards';
import MonthlyStackedChart, { type StackedMonthDatum } from '@/components/activity/MonthlyStackedChart';
import { MONTH_NAMES } from '@/config/metrics';
import type { YearMonth } from '@/lib/parsing/types';
import { FileSheetIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * ANALYTICS — pestaña de nivel superior — Etapa ANALYTICS-TAB-1
 * ============================================================================
 *
 * Antes era un sub-tab de Forecast & Pipeline (app/pipeline/page.tsx,
 * TabNavigation.tsx). Se independiza como ruta propia, siguiendo la Opción A
 * del diagnóstico previo (ver docs/ARQUITECTURA.md): fetch propio a
 * /api/pipeline/latest, mismo endpoint que ya usa Forecast, sin ningún
 * contexto/cache compartido -- cada ruta de nivel superior de esta app ya es
 * independiente (Commercial Activity, Business Plan), este módulo sigue el
 * mismo patrón en vez de inventar uno nuevo.
 *
 * `TabAnalytics.tsx` (app/pipeline/, sin mover -- ver decisión en
 * docs/ARQUITECTURA.md) ya era prácticamente standalone: un solo prop
 * (`resolvedLoans`), período propio, y ya llama a `useOrgRoster()`
 * INTERNAMENTE (línea ~1172 de ese archivo) -- esta página no necesita pedir
 * el roster de `org` por su cuenta, alcanza con pasarle los préstamos.
 *
 * Sin filtro de branch a nivel de esta página (a diferencia de Forecast, que
 * sí filtra `resolvedLoans` por `selectedBranch` antes de pasarlos) -- Opción
 * A del diagnóstico: mantenerlo simple, analiza el snapshot completo. Si
 * hiciera falta un filtro de branch acá más adelante, es una etapa aparte.
 *
 * Sin upload ni Topbar: esta página es de solo lectura sobre el snapshot ya
 * cargado (desde Forecast, o restaurado de Supabase) -- subir un archivo
 * nuevo sigue siendo exclusivo de /pipeline.
 */

interface LatestApiResponse {
  resolvedLoans: ResolvedLoan[];
  openLoans: PipelineLoan[];
  warnings: string[];
}

/**
 * Los 12 meses calendario de un año -- Etapa ACTIVITY-KPI-1, para el modo
 * 'current' de los 2 charts nuevos ("12 columnas fijas", mismo criterio
 * que `SimpleMonthlyChart`/`TypeBreakdownChart` de TabAnalytics.tsx: nunca
 * se omite un mes, un mes sin dato se dibuja en 0 explícito).
 */
function allMonthsOfYear(year: string): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/** Mismo helper que ya existe (duplicado) en app/pipeline/page.tsx y las rutas server-side -- sin lib/ compartido para esto todavía. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

export default function AnalyticsPage() {
  const [data, setData] = useState<LatestApiResponse | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Etapa ANALYTICS-CA-TRENDS-1 -- primera pieza que necesita distinguir
   * entre datos de Forecast (Closing, ya cargados arriba) y de Commercial
   * Activity (`LoanRecord[]`, ver comentario más abajo en el render: TODAVÍA
   * no se cargan en esta página). Selector local, sin persistir en URL --
   * mismo criterio que el resto de los toggles de esta pestaña.
   */
  const [analyticsView, setAnalyticsView] = useState<'closing' | 'commercialActivity' | 'daysToClose'>('closing');

  /*
   * Etapa ANALYTICS-CA-TRENDS-2 -- estado PROPIO de esta página para
   * Commercial Activity, independiente del de Forecast de arriba. Mismos
   * 3 estados que ya usa `app/page.tsx` (records/isLoadingInitial/error),
   * sin compartir ningún hook -- son dos fetches separados a propósito
   * (ver comentario de cabecera: "cada ruta de nivel superior es
   * independiente").
   */
  const [caRecords, setCaRecords] = useState<LoanRecord[] | null>(null);
  const [caLoadingInitial, setCaLoadingInitial] = useState(true);
  const [caError, setCaError] = useState<string | null>(null);

  /*
   * Etapa AVG-DAYS-TO-CLOSE-2 -- mismo patrón de 3 estados que Commercial
   * Activity, mismo `loadCurrentReport()` (misma tabla, `activity_report.
   * loan_records_v2` -- "Days to Close" y "Commercial Activity" comparten
   * fuente, sólo difiere qué hace cada vista con los records). A diferencia
   * de los otros dos fetches (que arrancan en el mount inicial), éste es
   * LAZY: recién se dispara la primera vez que se selecciona esta pestaña
   * -- ver el useEffect de abajo, guardado por `dtcFetchStarted` para no
   * repetirlo si se vuelve a esta pestaña después.
   */
  const [dtcRecords, setDtcRecords] = useState<LoanRecord[] | null>(null);
  const [dtcLoadingInitial, setDtcLoadingInitial] = useState(false);
  const [dtcError, setDtcError] = useState<string | null>(null);
  const dtcFetchStarted = useRef(false);

  /*
   * Etapa AVG-DAYS-TO-CLOSE (wiring de la tabla pivot) -- estado PROPIO,
   * independiente de cualquier otra vista de esta pestaña.
   */
  const [pivotGroupBy, setPivotGroupBy] = useState<DaysToCloseGroupBy>('branch');
  /**
   * Etapa ACTIVITY-GROUPBY-1 -- roster de `org` PROPIO de esta página:
   * Activity no consultaba `org` para nada hasta ahora (a diferencia de
   * TabAnalytics.tsx, que ya llama a `useOrgRoster()` internamente para sus
   * propios scorecards). Mismo hook, sin cambios -- se carga una sola vez
   * al montar, independiente de qué `analyticsView`/`pivotGroupBy` esté
   * activo (mismo criterio que ya sigue TabAnalytics.tsx).
   */
  const orgRoster = useOrgRoster();
  /**
   * Depende sólo de `pivotGroupBy`/`orgRoster` (ninguno de los 2 async
   * derivados de más abajo) -- definido temprano a propósito: tanto la
   * resolución del pivot de Duration (más abajo, sección "RESOLUCIÓN DE
   * LOAN OFFICER POR ALIAS") como `onTimeGroupKeyOf` (Etapa
   * ON-TIME-GROUPBY-1, unas líneas más abajo) lo necesitan, y el segundo se
   * calcula ANTES que la sección de Duration en este archivo.
   */
  const loanOfficerResolutionReady = pivotGroupBy === 'loanOfficer' && !orgRoster.loading && !orgRoster.error;
  const [pivotCells, setPivotCells] = useState<DaysToCloseCell[] | null>(null);
  /**
   * `loanResults` -- el array por préstamo que `buildDaysToClosePivot`
   * expone junto a `cells` (etapa previa). Se guarda al lado de `pivotCells`
   * porque los dos salen de la MISMA llamada -- nunca se calculan por
   * separado.
   */
  const [pivotLoanResults, setPivotLoanResults] = useState<DaysToCloseLoanResult[] | null>(null);
  /** Qué Count se clickeó -- `null` = modal cerrado. Ver `pivotDrillDownRows` más abajo. */
  const [pivotDrillDown, setPivotDrillDown] = useState<{
    month: string;
    groupKey: string;
    metric: 'appToCtc' | 'ctcToDisb';
  } | null>(null);
  /**
   * Etapa ON-TIME-1 (UI) -- vista SEPARADA del pivot de Days to Close,
   * reusa `dtcRecords` tal cual (misma fuente, sin fetch nuevo -- ver el
   * `useEffect` de más abajo). A diferencia del pivot de App→CTC/CTC→Disb,
   * `computeOnTimeDelayedByMonthAndBranch` es PURA y SÍNCRONA (no llama
   * ninguna RPC) -- alcanza con un `useMemo`, sin estado ni efecto propio
   * para el cálculo en sí.
   */
  const onTimeCells = useMemo(
    () => (dtcRecords ? computeOnTimeDelayedByMonthAndBranch(dtcRecords) : []),
    [dtcRecords]
  );
  /**
   * Etapa ON-TIME-GROUPBY-1 -- corrección de alcance de la etapa anterior:
   * `OnTimeDelayedTable` había quedado fija "by Month × Branch" sin importar
   * `pivotGroupBy`. Este closure reusa `groupKeyOf` (mismo import de arriba,
   * sin reimplementarlo) y, cuando `pivotGroupBy === 'loanOfficer'`, la MISMA
   * resolución por alias que ya usa el pivot de Duration
   * (`resolveLoanOfficerName`/`loanOfficerResolutionReady`/`orgRoster`,
   * definidos más abajo -- ver esa sección) -- no una copia nueva de esa
   * lógica. `'branch'`/`'processor'` pasan el nombre crudo tal cual, igual
   * que el pivot de Duration.
   *
   * Este closure NO alimenta `onTimeCells`/`onTimeByMonth` (el chart) ni
   * `onTimeCurrentTotals`/`onTimePreviousTotals` (los KPIs) -- pedido
   * explícito de esta etapa: esos 3 siguen agrupando por branch, sin tocar.
   * Sólo alimenta la tabla y su drill-down (`onTimeTableCells`/
   * `onTimeLoanResults` más abajo).
   */
  const onTimeGroupKeyOf = useCallback(
    (loan: LoanRecord): string => {
      const raw = groupKeyOf(loan, pivotGroupBy);
      if (pivotGroupBy !== 'loanOfficer' || !loanOfficerResolutionReady) return raw;
      return resolveLoanOfficerName(raw, orgRoster.aliasIndex, orgRoster.excludedIndex, orgRoster.employeeNameByKey).displayName;
    },
    [pivotGroupBy, loanOfficerResolutionReady, orgRoster.aliasIndex, orgRoster.excludedIndex, orgRoster.employeeNameByKey]
  );
  /**
   * Etapa ON-TIME-GROUPBY-1 -- versión de `onTimeCells` que SÍ sigue
   * `pivotGroupBy` (vía `onTimeGroupKeyOf`), para `OnTimeDelayedTable`.
   * Separada de `onTimeCells` a propósito: esta etapa pidió explícitamente
   * no tocar el chart/KPIs, que siguen leyendo `onTimeCells` (branch fijo).
   */
  const onTimeTableCells = useMemo(
    () => (dtcRecords ? computeOnTimeDelayedByMonthAndGroup(dtcRecords, onTimeGroupKeyOf) : []),
    [dtcRecords, onTimeGroupKeyOf]
  );
  /**
   * Etapa ON-TIME-DRILLDOWN-1 (ON-TIME-GROUPBY-1 la generalizó) -- detalle
   * por préstamo detrás de `onTimeTableCells`, para el drill-down de
   * `OnTimeDelayedTable`. Misma fuente (`dtcRecords`), misma clasificación
   * (`computeOnTimeDelayedLoanResults` reusa `classify()` sin cambios) --
   * se calcula aparte de `onTimeTableCells` porque el drill-down necesita
   * el préstamo individual, no el agregado por celda. Mismo
   * `onTimeGroupKeyOf` que la tabla, para que un click sobre una fila
   * encuentre sus préstamos por el MISMO `groupKey` con el que se dibujó
   * esa fila.
   */
  const onTimeLoanResults = useMemo(
    () => (dtcRecords ? computeOnTimeDelayedLoanResults(dtcRecords, onTimeGroupKeyOf) : []),
    [dtcRecords, onTimeGroupKeyOf]
  );
  /** Qué celda (groupKey × mes) se clickeó -- `null` = modal cerrado. Ver `onTimeDrillDownRows` más abajo. */
  const [onTimeDrillDown, setOnTimeDrillDown] = useState<{ month: YearMonth; groupKey: string } | null>(null);

  /**
   * Etapa ACTIVITY-COLLAPSE-1 -- filtro Year + Month mode ÚNICO para las 2
   * secciones (Duration/On Time & Delayed), pedido explícito de Heather:
   * "no dupliques el control". Antes eran 2 instancias independientes de
   * `useYearMonthFilter` (una por pestaña) -- ahora ambas secciones leen la
   * MISMA selección de año/mes.
   *
   * `dtcMonths` es la UNIÓN de los meses de `pivotCells` y `onTimeCells`,
   * no sólo uno de los dos: los dos salen de `dtcRecords`/`closingMonth`,
   * así que en la práctica coinciden, pero `buildDaysToClosePivot` filtra
   * por préstamo (RPC de días hábiles) mientras que
   * `computeOnTimeDelayedByMonthAndBranch` no -- si un mes existiera sólo
   * en una de las 2 fuentes, la unión evita que el filtro compartido lo
   * excluya para la otra.
   */
  const dtcMonths = useMemo(() => {
    const set = new Set<string>();
    if (pivotCells) for (const c of pivotCells) set.add(c.month);
    for (const c of onTimeCells) set.add(c.month);
    return [...set];
  }, [pivotCells, onTimeCells]);
  const dtcMonthFilter = useYearMonthFilter(dtcMonths);

  // Mismo patrón que el fetch inicial de app/pipeline/page.tsx -- un GET, sin
  // POST/upload acá (esta página no lo ofrece). {snapshot: null} (nadie subió
  // nada todavía) es un resultado válido, no un error -- se distingue de un
  // 500 real igual que en Forecast.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/pipeline/latest')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body && body.error) {
          setError(String(body.error));
          return;
        }
        if (!body || !body.snapshot) return;
        setData({ resolvedLoans: body.resolvedLoans, openLoans: body.openLoans, warnings: body.warnings ?? [] });
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
  }, []);

  /*
   * Etapa ANALYTICS-CA-TRENDS-2 -- segundo fetch independiente, mismo
   * `loadCurrentReport()` que ya usa `app/page.tsx` (lib/supabase/
   * loadCurrent.ts), con su propio try/catch -- no comparte estado ni
   * cache con el efecto de Forecast de arriba. `null` (nadie subió nada /
   * Supabase no configurado) es un resultado válido, no un error --
   * mismo criterio que ya documenta `loadCurrentReport()` en su propio
   * archivo.
   */
  useEffect(() => {
    let cancelled = false;
    loadCurrentReport()
      .then((current) => {
        if (cancelled) return;
        if (current) setCaRecords(current.records);
      })
      .catch((err) => {
        if (cancelled) return;
        setCaError(errorMessage(err));
      })
      .finally(() => {
        if (cancelled) return;
        setCaLoadingInitial(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Etapa AVG-DAYS-TO-CLOSE-2 -- fetch lazy: corre recién cuando
   * `analyticsView` pasa a `'daysToClose'` POR PRIMERA VEZ, no en el mount
   * (a diferencia de los dos efectos de arriba, que sí cargan eager). El
   * `ref` evita relanzarlo si el usuario vuelve a esta pestaña después de
   * haber estado en otra -- una vez cargado, `dtcRecords` ya no es `null` y
   * no hace falta pedirlo de nuevo.
   *
   * Etapa ON-TIME-1: alimenta tanto el pivot de Duration como la sección
   * On Time/Delayed -- Etapa ACTIVITY-COLLAPSE-1 las unificó en UNA sola
   * pestaña ("daysToClose"), así que este fetch ya no necesita distinguir
   * entre 2 valores de `analyticsView`.
   */
  useEffect(() => {
    if (analyticsView !== 'daysToClose' || dtcFetchStarted.current) return;
    dtcFetchStarted.current = true;
    let cancelled = false;
    setDtcLoadingInitial(true);
    loadCurrentReport()
      .then((current) => {
        if (cancelled) return;
        if (current) setDtcRecords(current.records);
      })
      .catch((err) => {
        if (cancelled) return;
        setDtcError(errorMessage(err));
      })
      .finally(() => {
        if (cancelled) return;
        setDtcLoadingInitial(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analyticsView]);

  /*
   * Etapa AVG-DAYS-TO-CLOSE (wiring de la tabla pivot) -- reusa `dtcRecords`
   * tal cual (sin ningún fetch nuevo). `buildDaysToClosePivot` es la que ya
   * hace las llamadas a la RPC por préstamo (lib/activity/daysToClosePivot.ts)
   * -- se re-ejecuta cada vez que cambia `pivotGroupBy`, porque hoy no hay
   * una versión cacheada (ver el reporte de esta etapa para la nota de
   * performance).
   */
  useEffect(() => {
    if (dtcRecords === null) return;
    let cancelled = false;
    buildDaysToClosePivot(dtcRecords, pivotGroupBy).then(({ cells, loanResults }) => {
      if (cancelled) return;
      setPivotCells(cells);
      setPivotLoanResults(loanResults);
    });
    return () => {
      cancelled = true;
    };
  }, [dtcRecords, pivotGroupBy]);

  /** Se calcula UNA vez por `dtcRecords` nuevo, no en cada click del drill-down. */
  const dtcRecordsByLoanNumber = useMemo(() => {
    const map = new Map<string, LoanRecord>();
    if (dtcRecords) for (const r of dtcRecords) map.set(r.loanNumber, r);
    return map;
  }, [dtcRecords]);

  /**
   * ============================================================================
   * RESOLUCIÓN DE LOAN OFFICER POR ALIAS — Etapa ACTIVITY-GROUPBY-1
   * ============================================================================
   *
   * `pivotLoanResults` trae, por préstamo, el `groupKey` que corresponde a
   * `pivotGroupBy` (branch/loanOfficer/processor -- ver `groupKeyOf()` en
   * `lib/activity/daysToClosePivot.ts`, SIN TOCAR ese archivo). Cuando el
   * modo es `'loanOfficer'`, ese `groupKey` es el nombre CRUDO
   * (`loan.loanOfficer`, mayúsculas, sin resolver) -- acá se resuelve por
   * alias, reemplazando el `groupKey` de cada resultado por el nombre
   * canónico cuando se puede.
   *
   * Se recalcula `aggregateDaysToCloseCells` sobre estos resultados YA
   * resueltos -- así 2 grafías distintas del mismo empleado (si existieran)
   * se FUSIONAN en una sola fila de la tabla, en vez de aparecer como 2
   * filas separadas.
   *
   * `'branch'`/`'processor'` no tocan nada acá -- `resolveLoanOfficerName`
   * ni se llama, `pivotCells`/`pivotLoanResults` originales pasan tal
   * cual. Sin roster cargado (`orgRoster.loading`) o con error, también se
   * usan los originales (crudos) -- "no bloquear el render de lo demás",
   * pedido explícito: la tabla/KPIs siguen mostrando datos, sólo con el
   * nombre sin resolver hasta que el roster esté listo.
   *
   * (`loanOfficerResolutionReady` se definió más arriba, junto a `orgRoster`
   * -- `onTimeGroupKeyOf`, Etapa ON-TIME-GROUPBY-1, también lo necesita y se
   * calcula antes que esta sección.)
   */
  const { resolvedPivotLoanResults, unresolvedLoanOfficerNames } = useMemo(() => {
    if (!pivotLoanResults || !loanOfficerResolutionReady) {
      return { resolvedPivotLoanResults: pivotLoanResults, unresolvedLoanOfficerNames: new Map<string, number>() };
    }
    const unresolved = new Map<string, number>();
    const resolved = pivotLoanResults.map((r) => {
      const { displayName, unresolved: isUnresolved } = resolveLoanOfficerName(
        r.groupKey,
        orgRoster.aliasIndex,
        orgRoster.excludedIndex,
        orgRoster.employeeNameByKey
      );
      if (isUnresolved) unresolved.set(r.groupKey, (unresolved.get(r.groupKey) ?? 0) + 1);
      return { ...r, groupKey: displayName };
    });
    return { resolvedPivotLoanResults: resolved, unresolvedLoanOfficerNames: unresolved };
  }, [pivotLoanResults, loanOfficerResolutionReady, orgRoster.aliasIndex, orgRoster.excludedIndex, orgRoster.employeeNameByKey]);

  const resolvedPivotCells = useMemo(() => {
    if (!loanOfficerResolutionReady || !resolvedPivotLoanResults) return pivotCells;
    return aggregateDaysToCloseCells(resolvedPivotLoanResults);
  }, [loanOfficerResolutionReady, resolvedPivotLoanResults, pivotCells]);

  /**
   * Filas del drill-down -- filtra `resolvedPivotLoanResults` (el mismo
   * array, ya resuelto, que alimenta `resolvedPivotCells`/la tabla -- si
   * filtrara el `pivotLoanResults` crudo, el `groupKey` de la fila
   * clickeada (resuelto) nunca matchearía contra el crudo, y el drill-down
   * se abriría siempre vacío) por (month, groupKey, métrica no-null) y
   * cruza cada `loanNumber` contra el Map de arriba para traer el
   * `LoanRecord` completo. Un `loanNumber` que no aparece en el Map se
   * descarta (no rompe) -- no debería pasar nunca (viene del mismo
   * `dtcRecords`), pero no se asume.
   */
  const pivotDrillDownRows = useMemo(() => {
    if (!pivotDrillDown || !resolvedPivotLoanResults) return [];
    const { month, groupKey, metric } = pivotDrillDown;
    return resolvedPivotLoanResults
      .filter((r) => r.month === month && r.groupKey === groupKey && r[metric] !== null)
      .map((r) => ({ loanNumber: r.loanNumber, days: r[metric] as number, loan: dtcRecordsByLoanNumber.get(r.loanNumber) }))
      .filter((row): row is { loanNumber: string; days: number; loan: LoanRecord } => row.loan !== undefined);
  }, [pivotDrillDown, resolvedPivotLoanResults, dtcRecordsByLoanNumber]);

  /**
   * Filas del drill-down de On Time/Delayed -- filtra `onTimeLoanResults`
   * por (month, groupKey) y cruza cada `loanNumber` contra el mismo Map de
   * arriba. Etapa ON-TIME-GROUPBY-1: `onTimeLoanResults` ya trae el
   * `groupKey` calculado con el mismo `onTimeGroupKeyOf` que la tabla, así
   * que un click sobre una fila (dibujada con ese `groupKey`) encuentra sus
   * préstamos sin importar qué dimensión esté activa. A diferencia de
   * `pivotDrillDownRows` (un metric específico por click), acá el click es
   * sobre la CELDA entera -- On Time y Delayed mezclados, cada fila lleva su
   * propio `bucket`/`daysLate`.
   */
  const onTimeDrillDownRows = useMemo(() => {
    if (!onTimeDrillDown) return [];
    const { month, groupKey } = onTimeDrillDown;
    return onTimeLoanResults
      .filter((r) => r.month === month && r.groupKey === groupKey)
      .map((r) => ({ loanNumber: r.loanNumber, bucket: r.bucket, daysLate: r.daysLate, loan: dtcRecordsByLoanNumber.get(r.loanNumber) }))
      .filter(
        (row): row is { loanNumber: string; bucket: 'onTime' | 'delayed'; daysLate: number | null; loan: LoanRecord } =>
          row.loan !== undefined
      );
  }, [onTimeDrillDown, onTimeLoanResults, dtcRecordsByLoanNumber]);

  /**
   * ============================================================================
   * KPIs Y CHARTS DE LAS 2 SECCIONES — Etapa ACTIVITY-KPI-1
   * ============================================================================
   *
   * "Período anterior comparable" para ESTE filtro (Year + Current/Last3/
   * Pick), adaptado del mecanismo de TabAnalytics.tsx -- ver el comentario
   * largo en `activityComparablePeriod.ts` para el porqué de la adaptación
   * (el filtro de acá es una LISTA de meses, no un rango de fechas).
   */
  const comparablePeriod = useMemo(
    () => computeComparablePeriod(dtcMonthFilter.monthsToShow),
    [dtcMonthFilter.monthsToShow]
  );
  const previousLabel = useMemo(
    () => comparableWindowLabel(comparablePeriod.previousWindow, MONTH_NAMES),
    [comparablePeriod.previousWindow]
  );
  const highlightMonths = useMemo(() => new Set(dtcMonthFilter.monthsToShow), [dtcMonthFilter.monthsToShow]);

  /**
   * Duration -- KPIs. `summarizeDurationWindow` reusa `pivotLoanResults`
   * (ya calculado por la RPC, sin volver a llamarla) y necesita el
   * `closingDate` de cada préstamo SOLO para el mes capado (si el período
   * está en curso) -- `dtcRecordsByLoanNumber` ya lo tiene, se deriva un
   * mapa liviano loanNumber -> closingDate en vez de pasar los
   * `LoanRecord` completos.
   */
  const closingDateByLoanNumber = useMemo(() => {
    const map = new Map<string, string | null>();
    dtcRecordsByLoanNumber.forEach((loan, loanNumber) => map.set(loanNumber, loan.closingDate));
    return map;
  }, [dtcRecordsByLoanNumber]);
  const durationCurrent = useMemo(
    () => summarizeDurationWindow(resolvedPivotLoanResults ?? [], closingDateByLoanNumber, comparablePeriod.currentWindow),
    [resolvedPivotLoanResults, closingDateByLoanNumber, comparablePeriod.currentWindow]
  );
  const durationPrevious = useMemo(
    () => summarizeDurationWindow(resolvedPivotLoanResults ?? [], closingDateByLoanNumber, comparablePeriod.previousWindow),
    [resolvedPivotLoanResults, closingDateByLoanNumber, comparablePeriod.previousWindow]
  );

  /**
   * Duration -- chart. Una celda por MES (`groupKey` forzado a una
   * constante, así `aggregateDaysToCloseCells` -- ya escrita y verificada
   * para el pivot -- colapsa branch/loan officer/processor y deja el
   * promedio ponderado + conteos independientes por tramo, por mes solo).
   *
   * Etapa ACTIVITY-GROUPBY-1: la fuente pasa a ser `resolvedPivotLoanResults`
   * (ya resuelto por alias cuando `pivotGroupBy==='loanOfficer'`) en vez de
   * `pivotLoanResults` crudo -- por consistencia con la tabla/KPIs de abajo,
   * ambos leen la misma fuente. El TOTAL no cambia con esto (resolver o
   * fusionar nombres no altera cuántos préstamos hay ni su suma -- nunca se
   * excluye ninguno, ver `resolveLoanOfficerName`), y `groupKey: 'ALL'`
   * sigue colapsando la dimensión a propósito: este chart/KPI son un
   * agregado ÚNICO, no un desglose por branch/LO/processor.
   */
  const durationByMonth = useMemo(() => {
    if (!resolvedPivotLoanResults) return new Map<YearMonth, DaysToCloseCell>();
    const cells = aggregateDaysToCloseCells(resolvedPivotLoanResults.map((r) => ({ ...r, groupKey: 'ALL' })));
    return new Map(cells.map((c) => [c.month, c]));
  }, [resolvedPivotLoanResults]);
  const durationChartMonths = dtcMonthFilter.monthMode === 'current' ? allMonthsOfYear(dtcMonthFilter.year) : dtcMonthFilter.monthsToShow;
  const durationChartData: StackedMonthDatum[] = durationChartMonths.map((month) => {
    const cell = durationByMonth.get(month);
    return { month, a: cell?.avgAppToCtc ?? 0, b: cell?.avgCtcToDisbursement ?? 0 };
  });

  /**
   * On Time/Delayed -- KPIs. `loansWithinWindow` filtra `dtcRecords` (con
   * el mismo capado día-a-día que Duration cuando aplica) y
   * `computeOnTimeDelayedTotals` -- SIN TOCAR, `lib/activity/
   * onTimeDelayed.ts` -- hace la clasificación On Time/Delayed/Unknown ya
   * validada.
   */
  const onTimeCurrentTotals = useMemo(
    () => computeOnTimeDelayedTotals(loansWithinWindow(dtcRecords ?? [], comparablePeriod.currentWindow)),
    [dtcRecords, comparablePeriod.currentWindow]
  );
  const onTimePreviousTotals = useMemo(
    () => computeOnTimeDelayedTotals(loansWithinWindow(dtcRecords ?? [], comparablePeriod.previousWindow)),
    [dtcRecords, comparablePeriod.previousWindow]
  );

  /** On Time/Delayed -- chart. Suma `onTimeCells` (ya agrupadas por mes × branch) por mes, ignorando branch -- Unknown queda afuera del chart (2 segmentos únicamente, mismo criterio que la tabla de abajo). */
  const onTimeByMonth = useMemo(() => {
    const map = new Map<YearMonth, { onTime: number; delayed: number }>();
    for (const c of onTimeCells) {
      const cur = map.get(c.month) ?? { onTime: 0, delayed: 0 };
      cur.onTime += c.countOnTime;
      cur.delayed += c.countDelayed;
      map.set(c.month, cur);
    }
    return map;
  }, [onTimeCells]);
  const onTimeChartMonths = dtcMonthFilter.monthMode === 'current' ? allMonthsOfYear(dtcMonthFilter.year) : dtcMonthFilter.monthsToShow;
  const onTimeChartData: StackedMonthDatum[] = onTimeChartMonths.map((month) => {
    const cell = onTimeByMonth.get(month);
    return { month, a: cell?.onTime ?? 0, b: cell?.delayed ?? 0 };
  });

  return (
    <div className="hub-container">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Analytics</h1>
        </div>
        <div className="seg">
          <button type="button" className={analyticsView === 'closing' ? 'on' : ''} onClick={() => setAnalyticsView('closing')}>
            Closing
          </button>
          <button
            type="button"
            className={analyticsView === 'commercialActivity' ? 'on' : ''}
            onClick={() => setAnalyticsView('commercialActivity')}
          >
            Commercial Activity
          </button>
          <button type="button" className={analyticsView === 'daysToClose' ? 'on' : ''} onClick={() => setAnalyticsView('daysToClose')}>
            Days to Close
          </button>
        </div>
      </div>

      {error && <span className="pill warn">{error}</span>}

      {!data && isLoadingInitial && (
        <div className="empty">
          <h2>Loading…</h2>
          <p>Looking for the last saved Forecast snapshot.</p>
        </div>
      )}

      {!data && !isLoadingInitial && !error && (
        <div className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>No Forecast data yet</h2>
          <p>Upload a pipeline report from Forecast &amp; Pipeline first -- Analytics reads the same saved snapshot.</p>
        </div>
      )}

      {data && analyticsView === 'closing' && <TabAnalytics resolvedLoans={data.resolvedLoans} />}

      {/*
       * Etapa ANALYTICS-CA-TRENDS-2 -- los 3 estados posibles de
       * `loadCurrentReport()`, mismo criterio que `app/page.tsx`: error real
       * (caError), "todavía no hay datos" (caRecords === null, después de
       * cargar), y datos reales (aunque sea un array vacío -- eso lo maneja
       * la tabla de CommercialActivityTrends con su propio "No records for
       * this strategy", no acá).
       */}
      {analyticsView === 'commercialActivity' && (
        <>
          {caError && <span className="pill warn">{caError}</span>}

          {caRecords === null && caLoadingInitial && !caError && (
            <div className="empty">
              <h2>Loading…</h2>
              <p>Looking for the last saved Commercial Activity report.</p>
            </div>
          )}

          {caRecords === null && !caLoadingInitial && !caError && (
            <div className="empty">
              <div className="drop-ic">
                <FileSheetIcon size={24} />
              </div>
              <h2>Todavía no hay datos de actividad</h2>
              <p>
                La actividad se sincroniza desde BigQuery cada vez que se sube Encompass por la app de cargas. Si esta
                pantalla sigue vacía después de una carga, avisá al equipo de datos: el que falló es el sync, no esta
                vista.
              </p>
            </div>
          )}

          {caRecords !== null && <CommercialActivityTrends records={caRecords} />}
        </>
      )}

      {/*
       * Etapa AVG-DAYS-TO-CLOSE-2 -- mismos 3 estados que Commercial
       * Activity de arriba, misma tabla de origen. `dtcLoadingInitial`
       * arranca en `false` (a diferencia de `caLoadingInitial`): antes del
       * primer click en "Days to Close" no hay ninguna carga en curso que
       * mostrar.
       *
       * Etapa ACTIVITY-COLLAPSE-1: "Days to Close" y "On Time / Delayed"
       * dejan de ser 2 pestañas -- pasan a ser 2 secciones apiladas de UNA
       * sola pestaña ("Duration" y "On Time / Delayed"), con el filtro
       * Year/Month único (`dtcMonthFilter`) arriba de las dos y un nav de
       * scrollspy para saltar entre ellas (mismo patrón que
       * `AnalyticsSectionNav` de TabAnalytics.tsx, replicado -- no
       * reusado -- en `SectionScrollspyNav`, ver ese archivo). Ningún
       * cálculo de negocio se tocó: `DaysToClosePivotTable`/
       * `OnTimeDelayedTable` siguen recibiendo exactamente los mismos
       * props que antes, sólo cambia de dónde sale `monthsToShow`.
       */}
      {analyticsView === 'daysToClose' && (
        <>
          {dtcError && <span className="pill warn">{dtcError}</span>}

          {dtcRecords === null && dtcLoadingInitial && !dtcError && (
            <div className="empty">
              <h2>Loading…</h2>
              <p>Looking for the last saved Commercial Activity report.</p>
            </div>
          )}

          {dtcRecords === null && !dtcLoadingInitial && !dtcError && (
            <div className="empty">
              <div className="drop-ic">
                <FileSheetIcon size={24} />
              </div>
              <h2>No activity data yet</h2>
              <p>
                Activity data syncs from BigQuery every time Encompass is uploaded through the upload app. If this
                screen is still empty after an upload, let the data team know: it&apos;s the sync that failed, not
                this view.
              </p>
            </div>
          )}

          {dtcRecords !== null && (
            <>
              <div className="control-bar__row" style={{ justifyContent: 'flex-start' }}>
                <YearMonthFilterControls filter={dtcMonthFilter} />
              </div>
              <SectionScrollspyNav
                sections={[
                  { id: 'activity-section-duration', label: 'Duration' },
                  { id: 'activity-section-ontime', label: 'On Time / Delayed' },
                ]}
              />

              <h3
                id="activity-section-duration"
                style={{ scrollMarginTop: `calc(var(--header-h) + ${NAV_HEIGHT_PX}px)`, margin: '24px 0 12px' }}
              >
                Duration
              </h3>
              <DurationKpiCards current={durationCurrent} previous={durationPrevious} previousLabel={previousLabel} />
              <div className="tbl-card" style={{ padding: '16px', marginBottom: '20px' }}>
                <div className="tbl-card__head">
                  <span className="tbl-card__title">Avg Days by Month</span>
                </div>
                <MonthlyStackedChart
                  data={durationChartData}
                  highlightMonths={highlightMonths}
                  colorA="var(--days-close-app-ctc)"
                  colorB="var(--days-close-ctc-disb)"
                  textColorA="var(--days-close-app-ctc-text)"
                  textColorB="var(--days-close-ctc-disb-text)"
                  labelA="App→CTC"
                  labelB="CTC→Disb"
                  formatValue={(n) => n.toFixed(1) + ' days'}
                />
              </div>
              {/*
                Etapa AVG-DAYS-TO-CLOSE (wiring de la tabla pivot) -- el
                cálculo de qué año/meses mostrar vive en `dtcMonthFilter`
                (compartido); acá sólo queda filtrar `resolvedPivotCells`
                por `monthsToShow`.

                Etapa ACTIVITY-GROUPBY-1: mientras el roster de `org` está
                cargando Y el modo es 'loanOfficer', se muestra el mismo
                loading state que ya usa el resto de la página para datos
                async -- SIN bloquear nada más (KPIs/chart de Duration ya
                están arriba, con datos crudos hasta que el roster llegue
                -- el total no cambia, ver el comentario de
                `durationByMonth`). Un error de `org` se avisa igual que
                cualquier otro (`.pill.warn`), sin ocultar la tabla -- se
                sigue mostrando con nombres SIN resolver en ese caso.
              */}
              {pivotCells !== null && (
                <>
                  <div className="control-bar__row" style={{ justifyContent: 'flex-start' }}>
                    <DaysToCloseDimensionSelector value={pivotGroupBy} onChange={setPivotGroupBy} />
                  </div>
                  {orgRoster.error && pivotGroupBy === 'loanOfficer' && (
                    <p className="pill warn" style={{ display: 'inline-flex', marginBottom: '12px' }}>
                      Could not load org roster, showing unresolved Loan Officer names: {orgRoster.error}
                    </p>
                  )}
                  {pivotGroupBy === 'loanOfficer' && orgRoster.loading ? (
                    <div className="empty">
                      <h2>Loading…</h2>
                      <p>Resolving Loan Officer names against the company roster.</p>
                    </div>
                  ) : (
                    <>
                      <DaysToClosePivotTable
                        cells={(resolvedPivotCells ?? []).filter((c) => dtcMonthFilter.monthsToShow.includes(c.month))}
                        groupBy={pivotGroupBy}
                        months={dtcMonthFilter.monthsToShow}
                        onCountClick={(month, groupKey, metric) => setPivotDrillDown({ month, groupKey, metric })}
                      />
                      {/*
                        Etapa ACTIVITY-GROUPBY-1 -- diagnóstico de nombres
                        sin resolver, mismo criterio que
                        `personDiagnosticsNote`/`branchScorecard.unresolvedBranches`
                        en TabAnalytics.tsx: un dato que sólo viviera en el
                        código (o en este reporte) y no en pantalla se
                        pierde apenas termina la sesión -- acá queda visible
                        para quien mire esta pantalla después.
                      */}
                      {unresolvedLoanOfficerNames.size > 0 && (
                        <p className="foot-note" style={{ marginTop: '10px' }}>
                          {unresolvedLoanOfficerNames.size} Loan Officer name{unresolvedLoanOfficerNames.size === 1 ? '' : 's'}{' '}
                          not recognized (still counted, shown under their raw name):{' '}
                          {[...unresolvedLoanOfficerNames.entries()]
                            .map(([name, count]) => `${name} (${count})`)
                            .join(', ')}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              <DaysToClosePivotDrillDown
                isOpen={pivotDrillDown !== null}
                onClose={() => setPivotDrillDown(null)}
                month={pivotDrillDown?.month ?? null}
                groupKey={pivotDrillDown?.groupKey ?? null}
                groupBy={pivotGroupBy}
                metric={pivotDrillDown?.metric ?? null}
                rows={pivotDrillDownRows}
              />

              <h3
                id="activity-section-ontime"
                style={{ scrollMarginTop: `calc(var(--header-h) + ${NAV_HEIGHT_PX}px)`, margin: '24px 0 12px' }}
              >
                On Time / Delayed
              </h3>
              <OnTimeKpiCards current={onTimeCurrentTotals} previous={onTimePreviousTotals} previousLabel={previousLabel} />
              <div className="tbl-card" style={{ padding: '16px', marginBottom: '20px' }}>
                <div className="tbl-card__head">
                  <span className="tbl-card__title">On Time vs. Delayed by Month</span>
                </div>
                {/*
                  Etapa ACTIVITY-GROUPBY-1: "On Time" pasa de --emerald-700
                  a los mismos tokens que ya usa el segmento superior de
                  Duration (--days-close-app-ctc/-text, sky/navy) -- pedido
                  explícito, reusar tal cual en vez de un color nuevo.
                  "Delayed" se queda en --rose-700, sin cambios. Es SOLO el
                  color del chart -- DeltaBadge (OnTimeKpiCards) sigue con
                  su propia convención (`badge--up`/`badge--down`), sin
                  tocar.
                */}
                <MonthlyStackedChart
                  data={onTimeChartData}
                  highlightMonths={highlightMonths}
                  colorA="var(--days-close-app-ctc)"
                  colorB="var(--rose-700)"
                  textColorA="var(--days-close-app-ctc-text)"
                  textColorB="var(--white)"
                  labelA="On Time"
                  labelB="Delayed"
                  formatValue={(n) => n.toLocaleString('en-US')}
                />
              </div>
              {/*
                Etapa ON-TIME-GROUPBY-1 -- mismo loading gate que
                `DaysToClosePivotTable` más arriba (mismo `orgRoster.loading`),
                para no mostrar nombres crudos sin resolver por un instante
                mientras el roster carga en modo Loan Officer.
              */}
              {pivotGroupBy === 'loanOfficer' && orgRoster.loading ? (
                <div className="empty">
                  <h2>Loading…</h2>
                  <p>Resolving Loan Officer names against the company roster.</p>
                </div>
              ) : (
                <OnTimeDelayedTable
                  cells={onTimeTableCells.filter((c) => dtcMonthFilter.monthsToShow.includes(c.month))}
                  groupBy={pivotGroupBy}
                  months={dtcMonthFilter.monthsToShow}
                  onCellClick={(month, groupKey) => setOnTimeDrillDown({ month, groupKey })}
                />
              )}
              <OnTimeDelayedDrillDown
                isOpen={onTimeDrillDown !== null}
                onClose={() => setOnTimeDrillDown(null)}
                month={onTimeDrillDown?.month ?? null}
                groupKey={onTimeDrillDown?.groupKey ?? null}
                groupBy={pivotGroupBy}
                rows={onTimeDrillDownRows}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
