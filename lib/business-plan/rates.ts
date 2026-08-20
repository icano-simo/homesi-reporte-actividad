/**
 * ============================================================================
 * TASAS DE PULL-THROUGH DEL MÓDULO
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALEN LOS VALORES POR DEFECTO
 * ---------------------------------------------------------------------------
 * Son las tasas ACUMULADAS: la probabilidad de que un préstamo que hoy está en
 * cierto milestone termine cerrando. Se obtienen multiplicando hacia adelante
 * la cascada que Forecast tiene en `app/pipeline/page.tsx`:
 *
 *     Started       0.8923 × 0.93 × 0.8459 × 0.95 = 0.6668  ->  66.7 %
 *     Processing             0.93 × 0.8459 × 0.95 = 0.7473  ->  74.7 %
 *     Underwriting                  0.8459 × 0.95 = 0.8036  ->  80.4 %
 *     Closing                                0.95 = 0.9500  ->  95.0 %
 *
 * Ojo con esto, porque es una confusión fácil: las de `app/pipeline` son tasas
 * POR PASO (de un milestone al siguiente) y las de acá son ACUMULADAS (de un
 * milestone hasta el cierre). Los números son distintos y ninguno de los dos
 * está mal -- responden preguntas distintas. Para proyectar cuántos de los
 * préstamos abiertos de una persona van a cerrar, la que sirve es la acumulada.
 *
 * Eso explica también por qué "Applications hereda de Started": son la misma
 * probabilidad mirada desde los dos módulos.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ALCANCE — LEER ANTES DE EDITAR UNA TASA EN SETTINGS
 * ---------------------------------------------------------------------------
 * Hoy sólo Business Plan lee `business_plan.settings`. Forecast & Pipeline
 * sigue con sus constantes en `app/pipeline/page.tsx`.
 *
 * O sea: cambiar una tasa marcada como "compartida" desde Settings cambia lo
 * que ve Business Plan y NO cambia Forecast. Es deuda deliberada -- ver
 * docs/ARQUITECTURA.md -- porque `app/pipeline/**` está fuera del alcance de
 * esta etapa. La pantalla de Settings lo dice explícitamente para que nadie lo
 * descubra por sorpresa.
 */

import type { MilestoneBucket } from './types';

export interface RateSettings {
  /** Tasa acumulada hasta el cierre, por milestone del préstamo. */
  milestone: Record<MilestoneBucket, number>;
  /** Brokered no usa la cascada: tasa plana sobre el total, acordada aparte. */
  brokeredFlat: number;
  /** Conversiones del Qualifier 2: cuánto rinde cada unidad hacia un cierre. */
  q2: { applications: number; creditReports: number; fileCreations: number };
}

/** Clave en `business_plan.settings` -> dónde vive dentro de `RateSettings`. */
export const RATE_KEYS = {
  pt_milestone_started: 'Milestone Started',
  pt_milestone_processing: 'Milestone Processing',
  pt_milestone_underwriting: 'Milestone Underwriting',
  pt_milestone_closing: 'Milestone Closing',
  pt_brokered_flat: 'Brokered flat',
  q2_applications: 'Applications (Q2)',
  q2_credit_reports: 'Credit Reports (Q2)',
  q2_file_creations: 'File Creations (Q2)',
} as const;

export type RateKey = keyof typeof RATE_KEYS;

/**
 * Qué tasas son conceptualmente compartidas con Forecast. Se usa sólo para
 * marcarlas en la pantalla de Settings junto con la advertencia de alcance.
 */
export const SHARED_KEYS: ReadonlySet<RateKey> = new Set<RateKey>([
  'pt_milestone_started',
  'pt_milestone_processing',
  'pt_milestone_underwriting',
  'pt_milestone_closing',
  'pt_brokered_flat',
  'q2_applications',
]);

/**
 * Valores por defecto. Se usan si la tabla todavía no existe o no se expuso a
 * PostgREST, para que el módulo no quede inutilizable esperando una migración.
 * Que se estén usando los defaults se avisa en el pie de la pantalla.
 */
export const DEFAULT_RATES: Record<RateKey, number> = {
  pt_milestone_started: 0.6668,
  pt_milestone_processing: 0.7473,
  pt_milestone_underwriting: 0.8036,
  pt_milestone_closing: 0.95,
  pt_brokered_flat: 0.4,
  q2_applications: 0.6668,
  q2_credit_reports: 0.3,
  q2_file_creations: 0.2,
};

/** Arma el objeto que consume el cálculo a partir del mapa clave -> valor. */
export function toRateSettings(byKey: Record<RateKey, number>): RateSettings {
  return {
    milestone: {
      Started: byKey.pt_milestone_started,
      Processing: byKey.pt_milestone_processing,
      Underwriting: byKey.pt_milestone_underwriting,
      Closing: byKey.pt_milestone_closing,
    },
    brokeredFlat: byKey.pt_brokered_flat,
    q2: {
      applications: byKey.q2_applications,
      creditReports: byKey.q2_credit_reports,
      fileCreations: byKey.q2_file_creations,
    },
  };
}

export const DEFAULT_RATE_SETTINGS: RateSettings = toRateSettings(DEFAULT_RATES);

/** "0.6668" -> "66.7%". Un decimal: más precisión no la tiene el dato. */
export function formatRate(v: number): string {
  return (v * 100).toFixed(1) + '%';
}
