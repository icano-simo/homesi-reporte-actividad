'use client';

/**
 * ============================================================================
 * ESCRIBIR UN BENCHMARK: UN SOLO LUGAR
 * ============================================================================
 *
 * Etapa RV3 — ARCHIVO NUEVO, y existe por una razón concreta.
 *
 * Hasta acá el único escritor era `BenchmarkEditor`, en el perfil. El paso 2 de
 * la revisión pide fijar el benchmark, así que ahora hay DOS pantallas que
 * escriben la misma tabla append-only — y dos `insert` con su propio criterio de
 * autor, de nota y de error es exactamente la forma en que se separan.
 *
 * Es el mismo motivo por el que el avance de la revisión se DERIVA en vez de
 * guardarse en dos lados: dos cálculos del mismo número quedan libres de
 * discrepar. Acá son dos escrituras del mismo hecho.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SIEMPRE INSERTA, NUNCA ACTUALIZA
 * ---------------------------------------------------------------------------
 * Y no es sólo una convención del código: la policy de RLS concede INSERT y no
 * UPDATE ni DELETE, así que la historia la protege la base aunque alguien llame
 * a la API directamente.
 *
 * `set_by` sale del usuario autenticado y NO de un parámetro: si viniera de
 * afuera, quien llame podría firmar con el nombre de otro. La policy además lo
 * verifica del lado del servidor.
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y LO QUE APRENDIMOS MIRANDO LA TABLA: DOS FILAS EL MISMO DÍA SE PUEDEN
 * ---------------------------------------------------------------------------
 * `BenchmarkEditor` trae un mensaje que dice «This officer already has a
 * benchmark set today», para el código `23505`. Eso era cierto cuando la clave
 * primaria era `(employee_key, effective_from)`. En BP29 pasó a ser
 * `benchmark_key`, sustituta — comprobado hoy contra `pg_constraint`: las únicas
 * restricciones son la PK sustituta, la FK del empleado y el check de no
 * negativo.
 *
 * Así que ese camino ya no se ejerce, y es la clase de respaldo que la nota de
 * `AGENTS.md` marca como sospechoso: o el original siempre estuvo, o lo que se
 * está usando es el respaldo sin saberlo. Se conserva el manejo porque un
 * `23505` de cualquier otra restricción futura seguiría siendo eso, pero el
 * mensaje ya no promete lo que no puede saber.
 */

import { getSupabaseClient } from '@/lib/supabase/client';

export interface ResultadoBenchmark {
  ok: boolean;
  /** El texto para mostrar. `null` si salió bien. */
  error: string | null;
}

/**
 * Fija el benchmark mensual de una persona.
 *
 * @param employeeKey a quién
 * @param valor       el número. `0` es válido: un benchmark de cero cierres es
 *                    una decisión, y es distinto de no tener ninguno.
 * @param nota        por qué ese número. Opcional, y es lo único que lo explica.
 */
export async function fijarBenchmark(
  employeeKey: number,
  valor: number,
  nota?: string | null
): Promise<ResultadoBenchmark> {
  if (!Number.isFinite(valor) || valor < 0) {
    return { ok: false, error: 'The benchmark has to be a number of 0 or more.' };
  }
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) return { ok: false, error: 'No authenticated session.' };

  const limpia = (nota ?? '').trim();
  const { data, error } = await supabase
    .schema('org')
    .from('employee_benchmark')
    .insert({
      employee_key: employeeKey,
      monthly_benchmark: valor,
      /* `effective_from` queda en el default de la base: hoy. */
      set_by: email,
      note: limpia === '' ? null : limpia,
    })
    /*
     * ⚠ `.select()` Y MIRAR LAS FILAS. Un `insert` que RLS filtra devuelve cero
     * filas con `error: null` -- el silencio que BP42 documentó. Sin esto, un
     * benchmark que no se guardó se vería igual que uno que sí.
     */
    .select('benchmark_key');

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? 'The database refused this benchmark as a duplicate. Nothing was saved.'
          : error.message,
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'The benchmark was not saved: you may not have permission to set it.',
    };
  }
  return { ok: true, error: null };
}
