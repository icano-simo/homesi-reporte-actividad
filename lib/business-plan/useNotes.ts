'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * ============================================================================
 * NOTAS DE SEGUIMIENTO
 * ============================================================================
 *
 * Etapa BP20 — ARCHIVO NUEVO. Ver `docs/sql/2026-08-business-plan-note.sql`
 * para el modelo y el porqué de una FK por destino.
 *
 * ⚠ TOLERANTE A QUE LA TABLA NO EXISTA, y no por prolijidad: el SQL lo aplica
 * el revisor, así que entre que este código se despliega y alguien corre la
 * migración hay una ventana en la que `business_plan.note` no está. Sin esto,
 * cada pantalla con notas tiraría un 404 de PostgREST y se vería rota sin
 * explicar por qué. Con `available = false` el panel dice qué falta.
 */

/** Los cuatro destinos posibles. Uno y sólo uno por nota. */
export type NoteTarget =
  | { kind: 'funnel'; key: number }
  | { kind: 'node'; key: number }
  | { kind: 'milestone'; key: number }
  | { kind: 'employee'; key: number };

/** La columna que le corresponde a cada destino en la tabla. */
const COLUMN: Record<NoteTarget['kind'], string> = {
  funnel: 'funnel_key',
  node: 'enrollment_node_key',
  milestone: 'enrollment_milestone_key',
  employee: 'employee_key',
};

export interface Note {
  note_key: number;
  body: string;
  author_email: string;
  created_at: string;
}

export interface NotesState {
  notes: Note[];
  isLoading: boolean;
  /** false = la tabla todavía no está aplicada en la base. */
  available: boolean;
  error: string | null;
  /** Devuelve el error, o null si se guardó. */
  add: (body: string) => Promise<string | null>;
  reload: () => void;
}

export function useNotes(target: NoteTarget | null): NotesState {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const kind = target?.kind ?? null;
  const key = target?.key ?? null;

  useEffect(() => {
    let cancelled = false;
    /* Sin destino no hay nada que cargar, y tampoco hay estado que tocar: el
       valor vacío se deriva al devolver, más abajo. Llamar a `setState` acá
       dispararía un render en cascada por nada. */
    if (kind === null || key === null) return;
    (async () => {
      setLoading(true);
      const res = await getSupabaseClient()
        .schema('business_plan')
        .from('note')
        .select('note_key, body, author_email, created_at')
        .eq(COLUMN[kind], key)
        /* Cronológico ASCENDENTE: una conversación se lee de arriba abajo, y lo
           último dicho queda pegado al campo de escribir. */
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (res.error) {
        /* 42P01 = la tabla no existe. PostgREST también lo devuelve como PGRST205
           cuando el esquema está cacheado sin ella. Ninguno es culpa del usuario. */
        const missing = res.error.code === '42P01' || res.error.code === 'PGRST205' || res.error.code === 'PGRST106';
        setAvailable(!missing);
        setError(missing ? null : res.error.message);
        setNotes([]);
      } else {
        setAvailable(true);
        setError(null);
        setNotes((res.data ?? []) as Note[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, key, tick]);

  const add = useCallback(
    async (body: string): Promise<string | null> => {
      if (kind === null || key === null) return 'No target for this note.';
      const trimmed = body.trim();
      if (trimmed === '') return 'The note is empty.';
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      /*
       * El email de la SESIÓN, no uno elegido: la policy de insert lo compara
       * contra `auth.jwt() ->> 'email'` y rechaza cualquier otro. Mandarlo desde
       * acá es sólo para que el insert pase; quien decide es la base.
       */
      if (!email) return 'No authenticated session.';
      const { error: e } = await supabase
        .schema('business_plan')
        .from('note')
        .insert({ body: trimmed, author_email: email, [COLUMN[kind]]: key });
      if (e) return e.message;
      reload();
      return null;
    },
    [kind, key, reload]
  );

  /*
   * Sin destino, vacío y sin cargar. Se deriva en vez de guardarse: un estado
   * que se puede calcular a partir de otro no es estado, es una copia que se
   * puede desincronizar.
   */
  const noTarget = kind === null || key === null;
  return {
    notes: noTarget ? [] : notes,
    isLoading: noTarget ? false : isLoading,
    available,
    error,
    add,
    reload,
  };
}
