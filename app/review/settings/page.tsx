'use client';

/**
 * ============================================================================
 * CONFIGURACIÓN DE REVISIONES — sólo con el claim `review_admin`
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Asignar quién del BP Team revisa a qué Loan Officer, y para qué fecha.
 *
 * ⚠ EL ACCESO NO SE DECIDE ACÁ. Lo decide `proxy.ts` con `review_admin`, que
 * corre antes de renderizar; y lo garantiza `review.can_assign()` en las
 * policies, que es la que protege los datos. Esta pantalla no comprueba nada:
 * si alguien llegara sin el claim, sus escrituras fallarían en la base y sus
 * lecturas devolverían lo que RLS le deje.
 */

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Link from 'next/link';
import { ErrorState, LoadingState } from '../../business-plan/components/shared';
import { useReview } from '@/components/review/ReviewProvider';
import type { ReviewUnavailable } from '@/lib/review/useReviewData';
import { daysUntilDue } from '@/lib/review/progress';
import {
  SIN_FILTRO,
  agruparPorBranch,
  contarAgrupadas,
  estadoDe,
  filtrar,
  separarPracticas,
  type EstadoAsignacion,
  type FiltroDeLista,
  type GrupoDeBranch,
} from '@/lib/review/settings-modelo';
import type { RosterParaBranches } from '@/lib/admin/margins-modelo';
import type { MyReview } from '@/lib/review/types';

interface Persona {
  employee_key: number;
  full_name: string;
  job_title: string | null;
}

/** Los tres estados, con el rótulo que la pantalla muestra. */
const ESTADOS: { v: EstadoAsignacion; label: string }[] = [
  { v: 'in_progress', label: 'In progress' },
  { v: 'completed', label: 'Completed' },
  { v: 'not_started', label: 'Not started' },
];

const rv = () => getSupabaseClient().schema('review');

/** Hoy en `YYYY-MM-DD`, en la zona de quien mira. Para el mínimo del campo. */
function hoyLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export default function ReviewSettingsPage() {
  /* Del proveedor: `recargar()` tras asignar actualiza tambien la lista de la
     otra pantalla y la barra, si hubiera una sesion en curso. */
  const { reviews: filasCrudas, isLoading, reviewsError, reviewsUnavailable,
    myEmployeeKey, recargar } = useReview();

  const [gente, setGente] = useState<{ soporte: Persona[]; los: Persona[] } | null>(null);
  const [cargandoGente, setCargandoGente] = useState(true);
  const [errGente, setErrGente] = useState<string | null>(null);

  const [revisor, setRevisor] = useState('');
  const [lo, setLo] = useState('');
  const [vence, setVence] = useState('');
  const [esPractica, setEsPractica] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [errOp, setErrOp] = useState<string | null>(null);

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * LOS TRES FILTROS, Y LA EDICIÓN — etapa RV35
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Con 42 asignaciones de 11 revisores la lista dejó de poder leerse de
   * corrido. Los filtros se COMBINAN --ver `filtrar`-- y el conteo del
   * encabezado sale de lo que queda, no de la lista entera.
   */
  const [filtro, setFiltro] = useState<FiltroDeLista>(SIN_FILTRO);
  /** Qué asignación se está editando, y con qué valores. `null` = ninguna. */
  const [editando, setEditando] = useState<
    { key: number; revisor: string; vence: string } | null
  >(null);

  /*
   * El branch de cada coachee y el roster, para agrupar y ordenar las secciones.
   *
   * ⚠ SE LEEN ACÁ Y NO SE DERIVAN DE `useBusinessPlanData`: ese loader trae el
   * módulo entero --cierres, pipeline, benchmarks-- para una pantalla que sólo
   * necesita a qué branch pertenece cada persona. Tres consultas chicas contra
   * un loader de segundos.
   */
  const [branches, setBranches] = useState<{
    deEmpleado: Map<number, string>;
    roster: RosterParaBranches[];
  } | null>(null);

  /*
   * El roster, una sola vez. Se leen los DOS grupos en una consulta y se
   * separan acá: son dos filtros sobre la misma tabla, y pedirla dos veces
   * serían dos viajes para 45 filas.
   *
   * ⚠ `is_support` e `is_loan_officer` son datos que RRHH reescribe en cada
   * carga, así que se filtran en la pantalla y NO con una constraint en la
   * asignación: una constraint sobre ellos volvería la próxima carga del roster
   * un fallo de integridad. La asignación guarda la clave y nada más.
   */
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { data, error } = await getSupabaseClient()
          .schema('org')
          .from('dim_employee')
          .select('employee_key, full_name, job_title, is_support, is_loan_officer')
          .eq('is_active', true)
          .order('full_name');
        if (cancelado) return;
        if (error) throw new Error(error.message);
        const filas = (data ?? []) as (Persona & { is_support: boolean; is_loan_officer: boolean })[];
        setGente({
          soporte: filas.filter((p) => p.is_support),
          los: filas.filter((p) => p.is_loan_officer),
        });
      } catch (err) {
        if (!cancelado) setErrGente(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelado) setCargandoGente(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    /*
     * Una sola vez: el roster no cambia mientras la pantalla está abierta.
     *
     * ⚠ Y VA EN `useEffect`, NO EN `useMemo`. Lo escribí con `useMemo` y estaba
     * mal por dos razones: React puede descartar y recalcular un memo, y la
     * función de limpieza que devuelve NO SE EJECUTA NUNCA porque `useMemo` no
     * la mira. O sea que el guardia `cancelado` era decorativo -- desmontar la
     * pantalla a mitad de la consulta habría llamado `setGente` igual.
     */
  }, []);

  /*
   * El branch de cada persona y el roster. Una sola vez, como el de arriba.
   *
   * ⚠ SI FALLA, LA PANTALLA SIGUE: sin branches la lista se dibuja sin agrupar
   * y lo dice. Agrupar es una ayuda de lectura, no el dato -- tirar la pantalla
   * entera porque no se pudo leer `employee_branch` sería perder las 42
   * asignaciones por no poder ordenarlas.
   */
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const org = getSupabaseClient().schema('org');
      const [eb, db, ros] = await Promise.all([
        org.from('employee_branch').select('employee_key, branch_key, role_in_branch'),
        org.from('dim_branch').select('branch_key, branch_code'),
        org.from('roster_current').select('branch_code, is_producer, is_active'),
      ]);
      if (cancelado) return;
      if (eb.error || db.error || ros.error) {
        /* No se tira: se deja `null` y la lista se dibuja sin secciones. El
           motivo va a la consola, que es donde lo ve quien lo puede arreglar. */
        console.error('[coach-settings] no se pudo leer el branch de los coachees', {
          employee_branch: eb.error?.message ?? null,
          dim_branch: db.error?.message ?? null,
          roster_current: ros.error?.message ?? null,
        });
        return;
      }
      const codigoDe = new Map<number, string>();
      for (const b of (db.data ?? []) as { branch_key: number; branch_code: string }[]) {
        codigoDe.set(b.branch_key, b.branch_code);
      }
      const deEmpleado = new Map<number, string>();
      for (const r of (eb.data ?? []) as {
        employee_key: number;
        branch_key: number;
        role_in_branch: string | null;
      }[]) {
        const code = codigoDe.get(r.branch_key);
        /* El PRIMERO que aparece, igual que el «branch primario» del resto del
           portal: una persona puede estar en varios y la lista necesita uno. */
        if (code !== undefined && !deEmpleado.has(r.employee_key)) deEmpleado.set(r.employee_key, code);
      }
      setBranches({ deEmpleado, roster: (ros.data ?? []) as RosterParaBranches[] });
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  /*
   * ⚠ UNA PRÁCTICA TAMBIÉN NECESITA UNA FECHA, y no porque signifique algo.
   *
   * `due_on` es `not null` en la tabla --medido, no recordado-- y el SLA de una
   * práctica no quiere decir nada: la lista de `/review` ni lo muestra, porque
   * un vencimiento sobre algo que no cuenta es un número sin significado.
   *
   * Así que se guarda HOY y el campo lo dice en pantalla, deshabilitado. La
   * alternativa --rellenarlo por debajo-- sería escribir una fecha que nadie
   * eligió y que después alguien va a leer como una decisión.
   */
  const venceEfectivo = esPractica ? hoyLocal() : vence;
  const listo = revisor !== '' && lo !== '' && venceEfectivo !== '';

  async function asignar() {
    if (!listo) return;
    setOcupado(true);
    setErrOp(null);
    try {
      const { data: sesion } = await getSupabaseClient().auth.getUser();
      const email = sesion.user?.email ?? '';
      /*
       * ⚠ `created_by` va con el email de la SESIÓN y no con un campo del
       * formulario, y la policy lo exige igual: su `with check` compara contra
       * `auth.jwt() ->> 'email'`. Mandar otro valor no falla en silencio -- la
       * fila se rechaza.
       */
      const { error } = await rv()
        .from('assignment')
        .insert({
          reviewer_employee_key: Number(revisor),
          lo_employee_key: Number(lo),
          due_on: venceEfectivo,
          created_by: email,
          /*
           * ⚠ SE MANDA SIEMPRE, también en `false`. La columna tiene default,
           * así que omitirla funcionaría -- y entonces qué se guarda dependería
           * del default y no de lo que esta pantalla decidió. Es la misma razón
           * por la que `arrancarOSeguir` pide la marca obligatoria.
           */
          is_practice: esPractica,
        });
      if (error) throw new Error(error.message);
      setRevisor('');
      setLo('');
      setVence('');
      setEsPractica(false);
      recargar();
    } catch (err) {
      setErrOp(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * EDITAR EL REVISOR Y LA FECHA — etapa RV35
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Hasta acá sólo se creaba y se desactivaba: cambiar de coach obligaba a
   * desactivar y crear otra, y eso pierde la sesión que colgaba de la vieja.
   *
   * ⚠ Y LOS DOS RECHAZOS DE LA BASE NO SIGNIFICAN LO MISMO, medido en
   * `pg_policy`: el `using` de `assignment_update` es `can_assign()` y su
   * `with check` es `can_assign() AND updated_by = auth.jwt()->>'email'`.
   *
   *     sin el claim        el `using` filtra  ->  CERO FILAS con `error: null`
   *     sin `updated_by`    el `with check`    ->  42501, «violates row-level
   *                                                security policy»
   *
   * El mensaje genérico que ya existía --«puede que no tengas el claim»-- es
   * FALSO para el segundo, y el segundo es el que produce un error de código.
   * Así que se distinguen: los dos son RLS y la causa es distinta, que es la
   * misma pareja que `42501` contra «cero filas» de AGENTS.md.
   */
  async function guardarEdicion() {
    if (editando === null) return;
    const { key, revisor: nuevoRevisor, vence: nuevoVence } = editando;
    if (nuevoRevisor === '' || nuevoVence === '') return;
    setOcupado(true);
    setErrOp(null);
    try {
      const { data: sesion } = await getSupabaseClient().auth.getUser();
      const email = sesion.user?.email ?? '';
      const { data, error } = await rv()
        .from('assignment')
        .update({
          reviewer_employee_key: Number(nuevoRevisor),
          due_on: nuevoVence,
          /*
           * ⚠ OBLIGATORIO, y la policy lo compara contra el email del JWT.
           *
           * Y CUÁNDO rechaza es más fino de lo que parece, medido sobre dos
           * prácticas: el `with check` se evalúa sobre la FILA RESULTANTE, no
           * sobre el `SET`. Omitirlo rechaza con `42501` sólo si lo que la fila
           * YA TENÍA no es el email de quien edita --la 96, con `updated_by` en
           * `null`, rechazó--; sobre una fila que esa misma persona editó antes
           * el check PASA, porque la fila nueva conserva su email. Medido: la
           * 97 guardó sin `updated_by` y dejó `updated_at` viejo.
           *
           * O sea que omitirlo no falla siempre: falla la primera vez y después
           * se vuelve silencioso. Por eso va escrito en el `update` y no
           * confiado a que la base avise.
           */
          updated_by: email,
          updated_at: new Date().toISOString(),
        })
        .eq('assignment_key', key)
        .select('assignment_key');
      if (error) {
        throw new Error(
          /violates row-level security|42501/i.test(error.message)
            ? 'The database rejected the change: the row has to carry your own email in ' +
              '`updated_by`, and it did not. Nothing was saved — this is a wiring error, not ' +
              'a permission one.'
            : error.message
        );
      }
      if ((data ?? []).length === 0) {
        throw new Error(
          'Nothing was saved. The database did not accept the change — you may not have the review_admin claim.'
        );
      }
      setEditando(null);
      recargar();
    } catch (err) {
      setErrOp(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  /** Desactivar una asignación. No hay borrado: no hay policy de DELETE. */
  async function desactivar(assignmentKey: number) {
    setOcupado(true);
    setErrOp(null);
    try {
      const { data: sesion } = await getSupabaseClient().auth.getUser();
      /*
       * ⚠ CON `.select()`, y esto no es opcional. Sin policy de DELETE y con la
       * de UPDATE exigiendo `review_admin`, un intento sin permiso no da error:
       * RLS filtra y devuelve CERO FILAS con `error: null`. Sin mirar las filas
       * afectadas, la pantalla diría "listo" sobre algo que no pasó -- es
       * exactamente el silencio que BP42 documentó.
       */
      const { data, error } = await rv()
        .from('assignment')
        .update({ is_active: false, updated_by: sesion.user?.email ?? '', updated_at: new Date().toISOString() })
        .eq('assignment_key', assignmentKey)
        .select('assignment_key');
      if (error) throw new Error(error.message);
      if ((data ?? []).length === 0) {
        throw new Error(
          'Nothing was saved. The database did not accept the change — you may not have the review_admin claim.'
        );
      }
      recargar();
    } catch (err) {
      setErrOp(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  const pendiente: ReviewUnavailable = reviewsUnavailable;
  const filas = filasCrudas ?? [];

  /*
   * La lista que se dibuja, en el orden en que se decide: filtrar, separar las
   * prácticas, y recién después agrupar. El orden importa -- agrupar primero
   * obligaría a filtrar dentro de cada grupo y a recalcular los conteos.
   */
  const filtradas = filtrar(filas, filtro);
  const { reales, practicas } = separarPracticas(filtradas);
  const branchDe = (k: number) => branches?.deEmpleado.get(k) ?? null;
  const agrupadas = agruparPorBranch(reales, branchDe, branches?.roster ?? []);
  /* Los coaches que ofrece el filtro salen de las asignaciones que HAY, no del
     equipo de soporte entero: un coach sin asignaciones daría una lista vacía. */
  const coachesConFilas = [...new Set(filas.map((f) => f.assignment.reviewer_employee_key))];
  const nombreDeCoach = (k: number) =>
    gente?.soporte.find((p) => p.employee_key === k)?.full_name ?? 'not on the support team';
  const hayFiltro = filtro.estado !== null || filtro.coach !== null || filtro.busqueda.trim() !== '';

  /*
   * Una fila de la lista. Vive acá --y no en un archivo aparte-- porque usa
   * media docena de cosas del estado de esta pantalla y sacarla obligaría a
   * pasarlas todas por props; lo que sí salió es la DECISIÓN, que está en
   * `settings-modelo.ts` y tiene su prueba.
   */
  /*
   * ⚠ LOS ATRIBUTOS DICEN `revisor`, NO `coach`. «Coach» es un RÓTULO --lo que
   * se lee en pantalla-- y los identificadores se llaman como el esquema:
   * `reviewer_employee_key`. Escribí `data-rv-coach` en tres lugares y lo
   * atrapó `verificar:coach`, que existe exactamente para eso.
   */
  const filaDeAsignacion = (f: MyReview) => {
    const dias = daysUntilDue(f.assignment.due_on, new Date());
    const estado = estadoDe(f);
    const enEdicion = editando?.key === f.assignment.assignment_key;
    return (
      <article
        key={f.assignment.assignment_key}
        className="rv-row"
        data-rv-asignacion={f.assignment.assignment_key}
        data-rv-estado={estado}
        data-rv-revisor={f.assignment.reviewer_employee_key}
      >
        <div className="rv-row__main">
          <h3 className="rv-row__who">
            {f.loName}
            {f.assignment.is_practice && <span className="rv-tag-practica">practice</span>}
          </h3>
          <div className="rv-row__meta">
            {/*
              ⚠ UNA COMPLETADA NO VENCE — RV35. Decía `due <fecha>` en las
              cuatro que ya están cerradas, y un vencimiento sobre algo cerrado
              es una fecha que no significa nada: la que importa es cuándo se
              completó, y `session.completed_at` la tiene.

              Y las prácticas siguen sin mostrar fecha: su `due_on` se guarda
              porque la columna es `not null`, no porque quiera decir algo.
            */}
            {estado === 'completed' && f.session?.completed_at ? (
              <span className="rv-done" data-rv-completada="">
                completed {f.session.completed_at.slice(0, 10)}
              </span>
            ) : (
              !f.assignment.is_practice && (
                <span className={'rv-due' + (dias < 0 ? ' rv-due--late' : dias <= 2 ? ' rv-due--soon' : '')}>
                  due {f.assignment.due_on}
                </span>
              )
            )}
            {/*
              ⚠ SIN EL NÚMERO DE LA ASIGNACIÓN — RV35. Decía `coach 59`, que es
              la clave de `review.assignment` y no le sirve a nadie que mire la
              pantalla. Queda el nombre, que es por lo que se busca.
            */}
            <span>{nombreDeCoach(f.assignment.reviewer_employee_key)}</span>
            <span className={'rv-state ' + (f.session ? 'rv-state--progress' : 'rv-state--none')}>
              {f.session ? f.session.status.replace('_', ' ') : 'not started'}
            </span>
          </div>

          {enEdicion && (
            <div className="rv-edit" data-rv-editor="">
              <label className="bp-form__field">
                <span className="bp-form__label">Coach</span>
                <select
                  className="field"
                  data-rv-edit-revisor=""
                  value={editando.revisor}
                  disabled={ocupado}
                  onChange={(e) => setEditando({ ...editando, revisor: e.target.value })}
                >
                  {(gente?.soporte ?? []).map((p) => (
                    <option key={p.employee_key} value={p.employee_key}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bp-form__field">
                <span className="bp-form__label">Due</span>
                <input
                  type="date"
                  className="field"
                  data-rv-edit-vence=""
                  value={editando.vence}
                  disabled={ocupado}
                  onChange={(e) => setEditando({ ...editando, vence: e.target.value })}
                />
              </label>
              <div className="bp-form__actions">
                <button
                  type="button"
                  className="bp-btn bp-btn--primary bp-btn--small"
                  data-rv-edit-guardar=""
                  disabled={ocupado || editando.revisor === '' || editando.vence === ''}
                  onClick={guardarEdicion}
                >
                  {ocupado ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="bp-linkish"
                  disabled={ocupado}
                  onClick={() => setEditando(null)}
                >
                  cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="rv-row__actions">
          <button
            type="button"
            className="bp-btn bp-btn--small"
            data-rv-editar=""
            disabled={ocupado}
            onClick={() =>
              setEditando(
                enEdicion
                  ? null
                  : {
                      key: f.assignment.assignment_key,
                      revisor: String(f.assignment.reviewer_employee_key),
                      vence: f.assignment.due_on,
                    }
              )
            }
          >
            {enEdicion ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            className="bp-btn bp-btn--small"
            disabled={ocupado || f.session?.status === 'in_progress'}
            title={
              f.session?.status === 'in_progress'
                ? 'This coaching session is in progress — it has to finish or be left unfinished first.'
                : undefined
            }
            onClick={() => desactivar(f.assignment.assignment_key)}
          >
            Deactivate
          </button>
        </div>
      </article>
    );
  };

  const seccionDeBranch = (g: GrupoDeBranch) => (
    <div key={g.branch ?? '—'} className="rv-branchgroup" data-rv-branch={g.branch ?? 'sin-branch'}>
      <h3 className="rv-branchgroup__head">
        {g.branch === null ? 'No branch assigned' : 'Branch ' + g.branch}
        <span className="rv-branchgroup__n">{g.filas.length}</span>
      </h3>
      <div className="rv-list">{g.filas.map(filaDeAsignacion)}</div>
    </div>
  );

  return (
    <>
      {/* Ver la nota de `/review/page.tsx`: `Breadcrumbs` no pinta fuera del
          shell de Business Plan. */}
      <nav className="rv-crumbs" aria-label="Breadcrumb">
        <Link href="/business-plan">Branch Portfolio</Link>
        <span aria-hidden="true">›</span>
        <Link href="/review">My coachees</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Coach settings</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-head__title">Coach settings</h1>
          <p className="page-head__subtitle">
            Who on the Business Plan team coaches which Loan Officer, and by when.
          </p>
        </div>
      </div>

      {pendiente && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            {pendiente === 'schema-not-exposed' ? (
              <>
                The review tables exist but PostgREST is not serving them yet — apply{' '}
                <code>docs/sql/2026-09-review-expose-schema.sql</code>.
              </>
            ) : (
              <>
                The review tables are not in the database yet — apply{' '}
                <code>docs/sql/2026-09-review-mode.sql</code>.
              </>
            )}
          </span>
        </div>
      )}

      {errGente && <ErrorState message={errGente} />}
      {reviewsError && <ErrorState message={reviewsError} />}
      {errOp && (
        <div className="bp-pending" role="alert">
          <AlertTriangleIcon size={14} />
          <span>{errOp}</span>
        </div>
      )}

      {(cargandoGente || isLoading) && <LoadingState />}

      {/*
        Acá el vacío tiene una tercera causa: `review_admin` abre la pantalla
        --lo decide `proxy.ts`-- pero `assignment_select` deja ver todas SOLO a
        quien tiene el claim. Si alguien llegara con el claim en el JWT y sin
        empleado en el roster, vería el formulario y ninguna asignación. Se dice,
        porque asignar y no ver lo asignado se lee como que no se guardó.
      */}
      {myEmployeeKey === null && !pendiente && (
        <p className="rv-hint rv-hint--warn">
          Your sign-in email is not on the active roster. You can still assign coaching, but you will
          not appear as a coach in any of them.
        </p>
      )}

      {/*
        Las clases del formulario son las del módulo y no unas nuevas:
        `bp-form__field`, `bp-form__label` y `field`, leídas de
        `LibraryForms.tsx`. Había escrito cuatro inventadas y las cuatro habrían
        salido sin estilo -- el mismo error que el aviso de trabado de BP46, que
        pasó 36 aserciones en verde como texto corrido.

        Y `bp-form` ya es una columna con gap, así que no hace falta una fila.

        ⚠ Y EL COMENTARIO VA ACÁ ARRIBA, NO adentro del `&& (`. Un comentario
        JSX dentro de una expresión condicional es un SEGUNDO hijo y no compila;
        el error que da no menciona comentarios --dice `')' expected` y señala la
        línea de abajo--, y es la segunda vez que me lo hago.

        Y el primer arreglo tampoco compiló: escribí la forma del comentario
        DENTRO del comentario, y el cierre que lleva adentro lo terminó antes de
        tiempo. Es la misma trampa que el backtick decorativo dentro de un
        template literal — un delimitador escrito de adorno sigue siendo
        sintaxis activa.
      */}
      {gente && !pendiente && (
        <div className="bp-form">
          <label className="bp-form__field">
            <span className="bp-form__label">Coach</span>
            <select className="field" value={revisor} onChange={(e) => setRevisor(e.target.value)}>
              <option value="">Choose someone…</option>
              {gente.soporte.map((p) => (
                <option key={p.employee_key} value={p.employee_key}>
                  {p.full_name}
                  {p.job_title ? ' · ' + p.job_title : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="bp-form__field">
            <span className="bp-form__label">Loan Officer</span>
            <select className="field" value={lo} onChange={(e) => setLo(e.target.value)}>
              <option value="">Choose someone…</option>
              {gente.los.map((p) => (
                <option key={p.employee_key} value={p.employee_key}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="bp-form__field">
            <span className="bp-form__label">Due</span>
            {/*
              `min` en hoy: una revisión con SLA en el pasado nace vencida, y eso
              casi siempre es un dedazo en el año. No lo IMPIDE en la base --una
              fecha vieja puede ser legítima al cargar historia-- pero el campo
              no lo ofrece.
            */}
            <input
              className="field"
              type="date"
              min={hoyLocal()}
              value={venceEfectivo}
              disabled={esPractica}
              onChange={(e) => setVence(e.target.value)}
            />
          </label>

          {/*
            ⚠ LA CASILLA VA DESPUÉS DE LA FECHA Y NO ANTES, y el orden importa:
            marcarla CAMBIA el campo de arriba --lo fija en hoy y lo apaga--, y
            un control que modifica algo que todavía no se leyó se lee como que
            el formulario se rompió. Puesta debajo, el cambio pasa a la vista.

            Y es una casilla y no dos botones ni un `select` de dos valores: lo
            normal es la asignación real, y la práctica es la excepción que se
            pide. Un `select` obligaría a elegir siempre entre dos, que es
            exactamente la forma que hace que alguien elija mal la que ya era
            la de siempre.
          */}
          <label className="bp-form__field rv-form__check">
            <input
              type="checkbox"
              checked={esPractica}
              onChange={(e) => setEsPractica(e.target.checked)}
            />
            <span className="bp-form__label">This is a practice run</span>
          </label>

          {esPractica ? (
            <p className="rv-hint rv-hint--warn">
              A practice session is walked with real data and <strong>writes nothing outward</strong>:
              the benchmark, the budget and the funnel it touches stay where they are. It shows up in
              its own group at the bottom of that coach&apos;s <strong>My coachees</strong> list, never
              among the real ones, and they can reset it there as many times as they need. The date
              above is stored as today because the table needs one — the practice has no due date and
              the list does not show it.
            </p>
          ) : (
            <p className="rv-hint">
              The coach sees this Loan Officer in their own <strong>My coachees</strong> list. A Loan
              Officer can only have one coaching session in progress at a time — the database refuses a second
              one, so the worst that can happen is that this says so.
            </p>
          )}

          <div className="bp-form__actions">
            <button
              type="button"
              className="bp-btn bp-btn--primary"
              disabled={!listo || ocupado}
              onClick={asignar}
            >
              {esPractica ? 'Assign practice' : 'Assign'}
            </button>
          </div>
        </div>
      )}

      {filas.length > 0 && (
        <>
          {/*
            ══════════════════════════════════════════════════════════════════
            LOS TRES FILTROS — etapa RV35
            ══════════════════════════════════════════════════════════════════

            Se combinan con Y, y el conteo del encabezado sale de lo que QUEDA.
            Un conteo sobre la lista entera al lado de una lista filtrada es un
            numero correcto describiendo otra cosa.

            ⚠ Y LA LISTA DE COACHES SALE DE LAS ASIGNACIONES QUE HAY, no del
            equipo de soporte entero: ofrecer a alguien sin asignaciones lleva a
            una lista vacia que parece un error de la pantalla.
          */}
          <div className="rv-filtros" data-rv-filtros="">
            <label className="rv-filtros__campo">
              <span className="bp-form__label">Search</span>
              <input
                type="search"
                className="field"
                data-rv-filtro-busqueda=""
                placeholder="Coachee name"
                value={filtro.busqueda}
                onChange={(e) => setFiltro({ ...filtro, busqueda: e.target.value })}
              />
            </label>
            <label className="rv-filtros__campo">
              <span className="bp-form__label">Status</span>
              <select
                className="field"
                data-rv-filtro-estado=""
                value={filtro.estado ?? ''}
                onChange={(e) =>
                  setFiltro({ ...filtro, estado: e.target.value === '' ? null : (e.target.value as EstadoAsignacion) })
                }
              >
                <option value="">All</option>
                {ESTADOS.map((x) => (
                  <option key={x.v} value={x.v}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="rv-filtros__campo">
              <span className="bp-form__label">Coach</span>
              <select
                className="field"
                data-rv-filtro-revisor=""
                value={filtro.coach ?? ''}
                onChange={(e) =>
                  setFiltro({ ...filtro, coach: e.target.value === '' ? null : Number(e.target.value) })
                }
              >
                <option value="">All coaches</option>
                {coachesConFilas.map((k) => (
                  <option key={k} value={k}>
                    {nombreDeCoach(k)}
                  </option>
                ))}
              </select>
            </label>
            {hayFiltro && (
              <button
                type="button"
                className="bp-linkish"
                data-rv-filtro-limpiar=""
                onClick={() => setFiltro(SIN_FILTRO)}
              >
                clear filters
              </button>
            )}
          </div>

          {/*
            ⚠ «ACTIVE» VOLVIÓ, Y LO ENCONTRÓ LA SONDA. Al reescribir el
            encabezado lo dejé en «Assignments», y la lista NO son todas: el
            proveedor trae sólo las activas --42 en la base, 36 activas, 25
            reales activas-- así que el título prometía un conjunto que el
            número no describe. Un rótulo que nombra de más es la misma falla
            que uno que interpreta de más.
          */}
          <h2 className="rv-sectionhead">
            <span className="rv-sectionhead__name">Active assignments</span>
            {/*
              ⚠ EL CONTEO SALE DE LO AGRUPADO, no de `reales.length`: si un
              branch se perdiera al agrupar, el numero lo diria en vez de
              taparlo. Ver `contarAgrupadas`.
            */}
            <span className="rv-sectionhead__n" data-rv-conteo-reales="">
              {contarAgrupadas(agrupadas)}
            </span>
          </h2>

          {contarAgrupadas(agrupadas) === 0 && (
            <p className="rv-vacio" data-rv-vacio="">
              No assignments match these filters.
            </p>
          )}

          {agrupadas.activos.map(seccionDeBranch)}

          {/*
            Los branches sin un productor activo en el roster, despues. La regla
            es la del portal --`seccionesDeBranch`, la misma de Margins-- y no
            una nueva: ver la nota de `agruparPorBranch`.

            ⚠ Medido el 2026-10-02, los 12 branches con coachees tienen
            productor activo, asi que hoy esta seccion NO SE DIBUJA. Su rama se
            ejerce en `coach-settings.test.mjs`, que la construye.
          */}
          {agrupadas.inactivos.length > 0 && (
            <>
              <h2 className="rv-sectionhead rv-sectionhead--tenue">
                <span className="rv-sectionhead__name">Branches with no active producer</span>
                <span className="rv-sectionhead__n">
                  {agrupadas.inactivos.reduce((a, g) => a + g.filas.length, 0)}
                </span>
              </h2>
              {agrupadas.inactivos.map(seccionDeBranch)}
            </>
          )}

          {agrupadas.sinBranch && seccionDeBranch(agrupadas.sinBranch)}

          {/*
            ══════════════════════════════════════════════════════════════════
            LAS PRACTICAS, ABAJO Y APARTE — etapa RV35
            ══════════════════════════════════════════════════════════════════

            Mismo tratamiento que la lista de `/review`: borde punteado, titulo
            propio y la frase que dice que no cuentan. No se extrae una seccion
            comun con aquella porque las dos contestan preguntas distintas --alla
            «con quien puedo practicar», aca «que practicas hay configuradas»--
            y lo que se comparte es la DECISION de separarlas, no el markup.

            ⚠ Y SU CONTEO ES EL SUYO: las once practicas no entran en el numero
            de arriba, que es lo que hoy hace que la pantalla diga 42.
          */}
          {practicas.length > 0 && (
            <section className="rv-practica" data-rv-practicas-config="">
              <h2 className="rv-practica__head">
                Practice — {practicas.length} {practicas.length === 1 ? 'assignment' : 'assignments'}
              </h2>
              <p className="rv-practica__hint">
                These do not count for anyone&apos;s record and are not part of the count above.
              </p>
              <div className="rv-list">{practicas.map(filaDeAsignacion)}</div>
            </section>
          )}
        </>
      )}
    </>
  );
}
