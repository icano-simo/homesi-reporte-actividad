'use client';

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import FunnelCatalog from '../components/FunnelCatalog';

/*
 * ══════════════════════════════════════════════════════════════════════════
 * EL MARKETPLACE — etapa BP55
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El catalogo de funnels como modulo propio, sin entrar por una persona. Lo
 * unico que esta pagina agrega es ELEGIR A QUIEN: el catalogo entero es el
 * mismo componente que usa el perfil, con `employeeKey` como entrada.
 *
 * ⚠ LA PERSONA VIVE EN LA URL y no en un `useState`. Tres razones medidas, y
 * ninguna es preferencia:
 *
 *   - el enlace se puede compartir y sobrevive a un F5;
 *   - el modo cambio ya viaja por la URL --`?change=<enrollment_key>`-- y
 *     mezclar un estado de React con un parametro para la misma pantalla deja
 *     dos fuentes para una sola decision;
 *   - al activar, el catalogo navega al plan; volver atras tiene que devolver
 *     la pantalla con la persona puesta.
 */
function MarketplaceBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isLoading } = useBusinessPlanData();

  /*
   * `null` = nadie elegido todavia. No es `0` ni `NaN`: `Number('')` da 0 y
   * `Number('x')` da NaN, y los dos se colarian como una clave de empleado.
   */
  const raw = searchParams.get('person');
  const employeeKey = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

  const gente = useMemo(() => data?.loanOfficers ?? [], [data]);
  const elegida = useMemo(
    () => (employeeKey === null ? null : (gente.find((p) => p.employeeKey === employeeKey) ?? null)),
    [gente, employeeKey]
  );

  function elegirPersona(key: number | null) {
    /*
     * Cambiar de persona LIMPIA `?change=`: esa clave es de un enrolamiento de
     * la persona anterior, y dejarla puesta pondria al catalogo en modo cambio
     * sobre un plan que no es el de quien se esta mirando. El catalogo tiene su
     * propia guarda --`staleLink`-- y ésta evita llegar ahi.
     */
    router.replace(key === null ? '/business-plan/marketplace' : '/business-plan/marketplace?person=' + key);
  }

  const selector = (
    <div className="bp-market-bar">
      <div className="bp-team-picker">
        <label className="bp-form__label" htmlFor="bp-market-person">
          Activate for
        </label>
        <select
          id="bp-market-person"
          className="field"
          value={employeeKey ?? ''}
          disabled={isLoading || gente.length === 0}
          onChange={(e) => elegirPersona(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">— nobody yet, just browsing —</option>
          {gente.map((p) => (
            <option key={p.employeeKey} value={p.employeeKey}>
              {p.fullName}
              {p.branchCodes.length > 0 ? ' · ' + p.branchCodes[0] : ''}
              {p.activePlan ? ' · on ' + p.activePlan.funnelName : ''}
            </option>
          ))}
        </select>
      </div>

      {/*
        ⚠ LA PERSONA YA TIENE PLAN, Y ELEGIR OTRO FALLA.
        `activate_funnel` INSERTA, y `enrollment_one_active_idx` --unico sobre
        `employee_key` donde `status = 'active'`-- lo rechaza. O sea que sin este
        aviso el unico modo de enterarse seria apretar y leer un 23505.

        El enlace manda al MISMO componente con `?change=`, que es donde vive la
        confirmacion que dice cuantos steps hechos se pierden. No se reescribe
        acá: seria la segunda copia de una decision destructiva.
      */}
      {elegida?.activePlan && (
        <p className="bp-hint">
          {elegida.fullName} is already on <strong>{elegida.activePlan.funnelName}</strong> (
          {elegida.activePlan.doneMilestones} of {elegida.activePlan.totalMilestones} steps done). Picking
          another funnel here would be refused —{' '}
          <a
            href={
              '/business-plan/marketplace?person=' +
              elegida.employeeKey +
              '&change=' +
              elegida.activePlan.enrollmentKey
            }
          >
            change the funnel instead
          </a>
          .
        </p>
      )}
    </div>
  );

  return <FunnelCatalog employeeKey={employeeKey} selector={selector} />;
}

export default function MarketplacePage() {
  /*
   * `useSearchParams` obliga a un limite de Suspense: sin el, el prerender de
   * esta ruta --que no tiene segmento dinamico, a diferencia de la del perfil--
   * falla al construir.
   */
  return (
    <Suspense fallback={null}>
      <MarketplaceBody />
    </Suspense>
  );
}
