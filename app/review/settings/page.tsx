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

interface Persona {
  employee_key: number;
  full_name: string;
  job_title: string | null;
}

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
  const [ocupado, setOcupado] = useState(false);
  const [errOp, setErrOp] = useState<string | null>(null);

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

  const listo = revisor !== '' && lo !== '' && vence !== '';

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
          due_on: vence,
          created_by: email,
        });
      if (error) throw new Error(error.message);
      setRevisor('');
      setLo('');
      setVence('');
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
              value={vence}
              onChange={(e) => setVence(e.target.value)}
            />
          </label>

          <p className="rv-hint">
            The coach sees this Loan Officer in their own <strong>My coachees</strong> list. A Loan
            Officer can only have one coaching session in progress at a time — the database refuses a second
            one, so the worst that can happen is that this says so.
          </p>

          <div className="bp-form__actions">
            <button
              type="button"
              className="bp-btn bp-btn--primary"
              disabled={!listo || ocupado}
              onClick={asignar}
            >
              Assign
            </button>
          </div>
        </div>
      )}

      {filas.length > 0 && (
        <>
          {/*
            ⚠ ESTAS TRES CLASES NO EXISTÍAN. Se llamaban `bp-areahead*`, estaban
            escritas desde RV1 y definidas en ninguna hoja -- el encabezado
            salía con el texto del documento y nadie lo notó, porque un `<h2>`
            sin regla se lee igual.

            Y eran un casi-duplicado inventado de `.bp-area-group__head`, que
            existe desde BP47. Ahora tienen nombre propio de la revisión y
            regla en `review.css`. Lo encontró `clases-definidas.mjs` en su
            primera corrida sobre la app entera.
          */}
          <h2 className="rv-sectionhead">
            <span className="rv-sectionhead__name">Active assignments</span>
            <span className="rv-sectionhead__n">{filas.length}</span>
          </h2>
          <div className="rv-list">
            {filas.map((f) => {
              const dias = daysUntilDue(f.assignment.due_on, new Date());
              return (
                <article key={f.assignment.assignment_key} className="rv-row">
                  <div className="rv-row__main">
                    <h3 className="rv-row__who">{f.loName}</h3>
                    <div className="rv-row__meta">
                      <span className={'rv-due' + (dias < 0 ? ' rv-due--late' : dias <= 2 ? ' rv-due--soon' : '')}>
                        due {f.assignment.due_on}
                      </span>
                      <span>
                        coach {f.assignment.reviewer_employee_key}
                        {gente
                          ? ' · ' +
                            (gente.soporte.find((p) => p.employee_key === f.assignment.reviewer_employee_key)
                              ?.full_name ?? 'not on the support team')
                          : ''}
                      </span>
                      <span className={'rv-state ' + (f.session ? 'rv-state--progress' : 'rv-state--none')}>
                        {f.session ? f.session.status.replace('_', ' ') : 'not started'}
                      </span>
                    </div>
                  </div>
                  <div className="rv-row__actions">
                    {/*
                      Desactivar, no borrar: la sesión que ya empezó tiene que
                      poder seguir existiendo. Y con una sesión en curso ni se
                      ofrece -- desactivar la asignación debajo de una revisión
                      abierta la dejaría sin dónde volver.
                    */}
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
            })}
          </div>
        </>
      )}
    </>
  );
}
