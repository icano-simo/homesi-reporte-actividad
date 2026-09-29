'use client';

import { useState } from 'react';
import type { YearMonth } from '@/lib/parsing/types';

export type MonthMode = 'current' | 'last3' | 'pick';

export interface YearMonthFilter {
  year: string;
  setYear: (y: string) => void;
  availableYears: string[];
  /** Meses del año efectivo que tienen dato, ascendente. */
  monthsForYear: YearMonth[];
  monthMode: MonthMode;
  setMonthMode: (m: MonthMode) => void;
  pickedMonth: YearMonth | null;
  setPickedMonth: (m: YearMonth) => void;
  /** Los meses a renderizar según el modo activo -- nunca más de 3. */
  monthsToShow: YearMonth[];
}

/**
 * ============================================================================
 * FILTRO Year + Month mode (Current/Last 3/Pick) — COMPARTIDO
 * ============================================================================
 *
 * Extraído del pivot de Days to Close (`app/analytics/page.tsx`) al agregar
 * la vista On Time/Delayed, que necesita EXACTAMENTE la misma decisión
 * (qué año, qué mes(es) de ese año mostrar) -- mismo criterio de este
 * proyecto: cuando aparece un segundo lugar que tiene que decidir lo mismo,
 * se extrae en vez de copiar la lógica.
 *
 * Recibe `allMonths` -- TODOS los meses presentes en los datos del caller,
 * sin filtrar por año -- y hace el resto: deriva los años disponibles,
 * el año efectivo (elegido, o el más reciente con datos si no eligió
 * ninguno), los meses de ese año, y --según el modo-- cuáles mostrar.
 *
 * Año efectivo: NUNCA hardcodeado, sale de `allMonths`. Modo por defecto:
 * 'current', y se resetea a 'current' cada vez que el año efectivo cambia
 * (incluida la primera vez que `allMonths` deja de estar vacío) --
 * "ajustar estado durante el render", no un `useEffect`, mismo patrón que
 * `prevRecords` en `DaysToCloseTrends.tsx`.
 *
 * 'current': el mes actual (UTC explícito, nunca Date local) si tiene
 * datos en el año efectivo; si el año no es el actual, o el mes actual
 * todavía no tiene datos, cae al ÚLTIMO mes con datos de ese año.
 * 'last3': ventana rodante de los últimos 3 meses CON DATOS, no un
 * trimestre calendario fijo. 'pick': el mes elegido, o el primero de la
 * lista si todavía no eligió ninguno.
 *
 * El caller sigue siendo dueño de filtrar SUS PROPIAS celdas por
 * `monthsToShow` (`cells.filter(c => monthsToShow.includes(c.month))`) --
 * este hook no conoce la forma de esas celdas, sólo decide qué meses.
 */
export function useYearMonthFilter(allMonths: YearMonth[]): YearMonthFilter {
  const [year, setYear] = useState('');
  const [monthMode, setMonthMode] = useState<MonthMode>('current');
  const [pickedMonth, setPickedMonth] = useState<YearMonth | null>(null);
  const [modeYear, setModeYear] = useState<string | null>(null);

  const availableYears = Array.from(new Set(allMonths.map((m) => m.split('-')[0]))).sort((a, b) => b.localeCompare(a));
  const effectiveYear = year || availableYears[0] || '';
  const monthsForYear = Array.from(new Set(allMonths.filter((m) => m.startsWith(effectiveYear)))).sort();

  if (modeYear !== effectiveYear) {
    setModeYear(effectiveYear);
    setMonthMode('current');
    setPickedMonth(null);
  }

  let monthsToShow: YearMonth[];
  if (monthMode === 'current') {
    const nowUtc = new Date();
    const currentYearUtc = String(nowUtc.getUTCFullYear());
    const currentMonthUtc = currentYearUtc + '-' + String(nowUtc.getUTCMonth() + 1).padStart(2, '0');
    monthsToShow =
      effectiveYear === currentYearUtc && monthsForYear.includes(currentMonthUtc)
        ? [currentMonthUtc]
        : monthsForYear.slice(-1);
  } else if (monthMode === 'last3') {
    monthsToShow = monthsForYear.slice(-3);
  } else {
    const picked = pickedMonth && monthsForYear.includes(pickedMonth) ? pickedMonth : monthsForYear[0];
    monthsToShow = picked ? [picked] : [];
  }

  return {
    year: effectiveYear,
    setYear,
    availableYears,
    monthsForYear,
    monthMode,
    setMonthMode,
    pickedMonth,
    setPickedMonth,
    monthsToShow,
  };
}
