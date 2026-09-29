/*
 * ============================================================================
 * CONTEOS INDEPENDIENTES DE daysToClosePivot — App→CTC vs CTC→Disbursement
 * ============================================================================
 *
 * `buildDaysToClosePivot` (lib/activity/daysToClosePivot.ts) no se puede
 * cargar acá: sus imports bajan, transitivamente, hasta
 * `@/lib/supabase/client`, que necesita un navegador real
 * (`document.cookie`). Lo que se prueba es `aggregateDaysToCloseCells`
 * (lib/activity/daysToClosePivotCells.ts) -- la agregación PURA que ese
 * archivo extrajo justamente para esto -- con un dato SINTÉTICO que fuerza
 * lo que nunca aparece en los 450 préstamos Banked-Retail cerrados de hoy:
 * un préstamo con un tramo resuelto y el otro en `null`.
 *
 * Medido contra esos 450 reales: `countAppToCtc === countCtcToDisbursement`
 * en las 136 celdas de hoy, sin una sola excepción. Eso NO es evidencia de
 * que la independencia ande bien -- es que ningún préstamo real de hoy tiene
 * un `null` asimétrico (`business_days_between` sólo da `null` con fechas
 * nulas o invertidas, y las 450 tienen sus 3 fechas en orden). Esta prueba
 * es la red para el día que sí aparezca uno.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { crearArnes } = await import(
  pathToFileURL(resolve(RAIZ, 'scripts/verificacion/guardas.mjs')).href);
const { aggregateDaysToCloseCells } = await import(
  pathToFileURL(resolve(RAIZ, 'lib/activity/daysToClosePivotCells.ts')).href);

const a = crearArnes({ minimo: 10 });

/* ── Caso base: sin nulls, los 2 conteos coinciden ──────────────────────── */
const base = aggregateDaysToCloseCells([
  { groupKey: '703', month: '2026-01', appToCtc: 10, ctcToDisb: 2 },
  { groupKey: '703', month: '2026-01', appToCtc: 20, ctcToDisb: 4 },
]);
a.ck(base.length === 1, 'un solo grupo/mes da una sola celda');
a.ck(base[0].countAppToCtc === 2 && base[0].countCtcToDisbursement === 2,
  'sin nulls, los 2 conteos coinciden (' + base[0].countAppToCtc + ', ' + base[0].countCtcToDisbursement + ')');
a.ck(base[0].avgAppToCtc === 15 && base[0].avgCtcToDisbursement === 3,
  'promedios simples correctos (' + base[0].avgAppToCtc + ', ' + base[0].avgCtcToDisbursement + ')');

/* ── El caso que este test existe para cubrir: un préstamo con App→CTC
   resuelto y CTC→Disbursement en null (p.ej. ctcDate > closingDate --
   fechas invertidas, la RPC real devuelve null en ese caso) -- junto a
   otro préstamo normal en la misma celda. ─────────────────────────────── */
const asimetrico = aggregateDaysToCloseCells([
  { groupKey: '703', month: '2026-02', appToCtc: 12, ctcToDisb: null },
  { groupKey: '703', month: '2026-02', appToCtc: 8, ctcToDisb: 3 },
]);
a.ck(asimetrico.length === 1, 'sigue siendo una sola celda');
a.ck(asimetrico[0].countAppToCtc === 2, 'App→CTC cuenta los 2 préstamos (' + asimetrico[0].countAppToCtc + ')');
a.ck(asimetrico[0].countCtcToDisbursement === 1,
  '⚠ CTC→Disb cuenta SÓLO 1 -- el null de un préstamo no le resta el otro tramo (' +
    asimetrico[0].countCtcToDisbursement + ')');
a.ck(asimetrico[0].countAppToCtc !== asimetrico[0].countCtcToDisbursement,
  'y por eso esta celda SÍ diverge -- es la que "0 celdas difieren" con datos reales nunca vio');
a.ck(asimetrico[0].avgAppToCtc === 10 && asimetrico[0].avgCtcToDisbursement === 3,
  'y cada promedio sale de su propio subconjunto, no del otro (' +
    asimetrico[0].avgAppToCtc + ', ' + asimetrico[0].avgCtcToDisbursement + ')');

/* ── El sentido inverso: CTC→Disb resuelve y App→CTC no (p.ej. appDate >
   ctcDate). ─────────────────────────────────────────────────────────── */
const inverso = aggregateDaysToCloseCells([
  { groupKey: '703', month: '2026-03', appToCtc: null, ctcToDisb: 5 },
]);
a.ck(inverso[0].countAppToCtc === 0 && inverso[0].avgAppToCtc === null,
  'App→CTC en 0/null cuando el único préstamo del grupo falló ahí');
a.ck(inverso[0].countCtcToDisbursement === 1 && inverso[0].avgCtcToDisbursement === 5,
  'y CTC→Disb sigue contando su propio préstamo (' + inverso[0].countCtcToDisbursement + ')');

process.exitCode = a.resumen();
