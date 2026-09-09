'use client';

/**
 * ============================================================================
 * EL ANFITRIÓN DE LA MÁSCARA
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Separa DOS cosas que el layout raíz no puede hacer juntas:
 *
 *   · leer los datos de la revisión, que necesita hooks de cliente;
 *   · quedar montado al cruzar de módulo, que necesita el layout raíz.
 *
 * El layout raíz es un componente de SERVIDOR --lee los claims con
 * `getServerClient`-- así que no puede llamar hooks. Éste es el pedazo de
 * cliente que va adentro.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NO CONSULTA NADA SI LA PERSONA NO PUEDE TENER UNA REVISIÓN
 * ---------------------------------------------------------------------------
 * Está en el layout raíz, así que se monta en las CUATRO pantallas del portal y
 * para todo el mundo. Sin este corte, cada carga de cualquier página del portal
 * dispararía cuatro consultas a `review` para las 97 personas que no son del BP
 * Team — y las cuatro devolverían cero filas por RLS, que es la forma más caras
 * de no hacer nada.
 *
 * El corte lo decide el SERVIDOR y llega por prop: `puedeRevisar`. Se resuelve
 * con el claim, que es el mismo dato que ya se lee para el header.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cerrarSesion, guardarPaso, moverCursor } from '@/lib/review/actions';
import { useReview } from './ReviewProvider';
import ReviewMask from './ReviewMask';
import ReviewStepPanel from './ReviewStepPanel';

/*
 * ⚠ SIN PROPS. `puedeRevisar` se movió al proveedor, que es quién consulta:
 * dejarlo acá también habría sido la misma decisión en dos lugares.
 */
export default function ReviewMaskHost() {
  const { script, reviews, recargar, habilitado } = useReview();
  const pathname = usePathname();
  const router = useRouter();

  /*
   * ═══════════════════════════════════════════════════════════════
   * ⚠ LA BARRA NO AVISA QUE UN MÓDULO ESTÁ CARGANDO, Y ES DELIBERADO
   * ═══════════════════════════════════════════════════════════════
   *
   * Acá había un aviso, y se sacó: el módulo ya muestra su propio `Loading...`,
   * así que un segundo aviso es UNA SEGUNDA FUENTE PARA EL MISMO HECHO. Y ya
   * sabemos cómo termina eso -- las dos discrepan, y la de la barra miente
   * porque mide otra cosa.
   *
   * Medído: el que estaba se encendía al cambiar la ruta y se apagaba en el
   * cuadro siguiente, pero el módulo tarda SEGUNDOS en traer sus datos. En la
   * captura el perfil decía `Loading...` y la barra no decía nada. Medía el
   * pintado de la ruta, no la llegada de los datos.
   *
   * Y las dos formas de arreglarlo eran peores que no tenerlo: una duración
   * mínima inventa un tiempo, y mirar el indicador propio de cada módulo acopla
   * la máscara a los tres.
   *
   * Si la espera molesta, la respuesta no es avisarla mejor: es que Outlook no
   * traiga 4.800 préstamos al entrar. Eso es una etapa aparte y ya está en la
   * lista.
   */

  /*
   * El funnel activo del Loan Officer revisado, para la fase 3.
   *
   * Se lee ACA y no en el panel porque el panel se remonta al cambiar de paso y
   * volveria a consultar; y se lee solo cuando hay una sesion, que es cuando la
   * pregunta existe. `null` = no tiene funnel, que es uno de los dos casos que
   * la fase 3 tiene que distinguir.
   */
  const [funnelActual, setFunnelActual] = useState<string | null>(null);
  const loEnCurso =
    (reviews ?? []).find((r) => r.session?.status === 'in_progress')?.session
      ?.lo_employee_key ?? null;

  useEffect(() => {
    let cancelado = false;
    (async () => {
      /*
       * ⚠ EL `setState` VA ADENTRO DEL ASYNC, no en el cuerpo del efecto.
       *
       * Lo tenía arriba, en el camino de "no hay sesión", y eslint lo marcó con
       * `react-hooks/set-state-in-effect`: un setState sincrónico en un efecto
       * puede disparar renders en cascada. Este componente vive en el layout
       * raíz y se monta en las cuatro pantallas del portal, así que ese costo lo
       * pagaría todo el mundo.
       */
      if (loEnCurso === null) {
        if (!cancelado) setFunnelActual(null);
        return;
      }
      const { data } = await getSupabaseClient()
        .schema('business_plan')
        .from('enrollment')
        .select('funnel_name')
        .eq('employee_key', loEnCurso)
        .eq('status', 'active')
        /* Con `order` y no solo `limit(1)`: hoy el indice unico garantiza uno,
           y la consulta no tiene por que depender de una garantia que vive en
           otro archivo. Es el defecto que `useEnrollment` todavia tiene. */
        .order('activated_at', { ascending: false })
        .limit(1);
      if (!cancelado) setFunnelActual((data ?? [])[0]?.funnel_name ?? null);
    })();
    return () => {
      cancelado = true;
    };
  }, [loEnCurso]);

  const onSaveAndExit = useCallback(() => {
    /*
     * No escribe nada: cada paso ya se guardó al completarse, así que salir no
     * tiene que confirmar nada. Sólo hace falta releer, y ahora el proveedor es
     * uno solo -- así que esto también actualiza la lista de la otra pantalla.
     */
    recargar();
  }, [recargar]);

  if (!habilitado) return null;

  const activo = (reviews ?? []).find((r) => r.session?.status === 'in_progress') ?? null;

  return (
    <>
      <ReviewMask script={script} activo={activo} onSaveAndExit={onSaveAndExit} />
      {/*
        El panel del paso va JUNTO A LA BARRA y no en cada pantalla, por el
        mismo motivo: es lo unico que tiene la sesion en curso y sobrevive al
        cruce de modulo. Y no se dibuja sin sesion -- ni el, ni su campo de
        comentario, que es el unico del portal.
      */}
      {script && activo?.session && (
        <ReviewStepPanel
          /*
           * ⚠ EL `key` ES EL PASO, y no es cosmetico: hace que React remonte el
           * panel al cambiar de paso, y con eso el borrador se rehace sin un
           * efecto que llame setState. Ver la nota del panel.
           */
          key={activo.session.current_phase + ':' + activo.session.current_step_in_phase}
          script={script}
          session={activo.session}
          responses={activo.responses}
          loName={activo.loName}
          funnelActual={funnelActual}
          onGuardar={async (paso, revision, comment, gate) => {
            const r = await guardarPaso(activo.session!.session_key, paso, revision, comment, gate);
            if (!r.ok) return r.error;
            recargar();
            return null;
          }}
          onContinuar={async (destino) => {
            const r = await moverCursor(activo.session!.session_key, destino);
            if (!r.ok) return r.error;
            recargar();
            /* La fase puede cambiar de modulo: se navega al del destino. */
            const fase = script!.phases.find((f) => f.phase_no === destino.phase_no);
            if (fase && fase.module !== moduloActual(pathname)) {
              router.push(rutaDelModulo(fase.module, activo.session!.lo_employee_key));
            }
            return null;
          }}
          onCerrar={async () => {
            const r = await cerrarSesion(activo.session!.session_key);
            if (!r.ok) return r.error;
            recargar();
            router.push('/review');
            return null;
          }}
        />
      )}
    </>
  );
}

/** El segmento de modulo de una ruta: `/business-plan/lo/5` -> `business-plan`. */
function moduloActual(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

/**
 * A donde manda cada modulo. Duplicado a proposito con la pagina de arranque:
 * son dos momentos distintos --entrar y avanzar-- y compartirlo obligaria a un
 * archivo mas para tres lineas. Si aparece un tercer llamador, se extrae.
 */
function rutaDelModulo(modulo: string, loEmployeeKey: number): string {
  if (modulo === 'business-plan') return '/business-plan/lo/' + loEmployeeKey;
  if (modulo === 'outlook') return '/outlook';
  return '/review';
}
