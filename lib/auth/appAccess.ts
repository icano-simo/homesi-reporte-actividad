import type { User } from '@supabase/supabase-js';

/**
 * ============================================================================
 * ACCESO A ESTA APP DENTRO DEL PROYECTO COMPARTIDO
 * ============================================================================
 *
 * Etapa AUTH1 — ARCHIVO NUEVO.
 *
 * El proyecto de Supabase (`simoOS-prod`) es compartido con las otras apps del
 * portal, así que una sesión válida sólo prueba que la persona trabaja acá —
 * no que pueda abrir ESTA app. El permiso se otorga por aplicación.
 *
 * Vive en `app_metadata` y no en `user_metadata` a propósito: `user_metadata`
 * es escribible desde el navegador por el propio usuario, así que cualquiera
 * podría agregarse el permiso solo. `app_metadata` sólo lo escribe el
 * service_role. Mismo criterio que usa el repo hermano homesi-pl.
 *
 * NOTA: esto es la comprobación de la UI, para poder mandar a la persona a
 * /no-access en vez de a una pantalla rota. La comprobación que de verdad
 * protege los datos es la política de RLS en la base, que aplica el mismo
 * criterio y no depende de que el cliente se porte bien.
 */

/**
 * La entrada de esta app en `app_metadata.allowed_apps`.
 * Debe coincidir exactamente con lo que revisan las políticas de RLS.
 */
export const APP_NAME = 'commercial_activity';

/** Forma mínima de usuario que necesita el chequeo -- así sirve igual con el `User` del navegador y con el del servidor. */
type UserLike = Pick<User, 'app_metadata'> | null | undefined;

/**
 * true si el usuario tiene esta app entre las autorizadas.
 *
 * Se valida que `allowed_apps` sea un array antes de usarlo: si el claim no
 * existe todavía (usuario al que aún no le otorgaron nada) llega `undefined`,
 * y un `.includes` sobre eso rompería la página en vez de negar el acceso.
 */
export function hasAppAccess(user: UserLike): boolean {
  return hasClaim(user, APP_NAME);
}

/**
 * ============================================================================
 * ⚠ CLAIMS POR MÓDULO — etapa OL1
 * ============================================================================
 *
 * `hasAppAccess` responde "¿puede abrir esta app?". Hasta OL1 esa era la única
 * pregunta: quien tenía `commercial_activity` veía los cuatro módulos.
 *
 * Outlook es el primero con su propio permiso. Los cuatro que lo tienen
 * (Jorge Campodónico, Pier Laino, Fernando Orduz, Isabella Cano) tienen TAMBIÉN
 * `commercial_activity`, así que el gate de la app entera sigue siendo el
 * primero en aplicarse y este claim se suma; no lo reemplaza. Verificado contra
 * `auth.users` antes de escribir esto.
 *
 * El nombre tiene que coincidir exactamente con lo que revisa
 * `outlook.has_access()` en la base. Si divergen, la UI y RLS dirían cosas
 * distintas -- y la que protege los datos es la de la base.
 */
export const OUTLOOK_CLAIM = 'outlook';

/**
 * Etapa ANALYTICS-GATE: el módulo Analytics.
 *
 * ⚠ Antes no estaba apagado por permiso sino por CÓDIGO: su entrada del menú
 * estaba comentada (etapa `fix/hide-analytics-nav-tab`) mientras se terminaba
 * el rediseño. Eso lo dejaba invisible para todos --incluido quien tenía que
 * verlo-- y encendido para cualquiera que supiera escribir `/analytics` en la
 * barra de direcciones: lo peor de las dos cosas.
 *
 * Con un claim, quién lo ve es un dato y no una línea comentada: se otorga y
 * se quita sin desplegar, y la ruta queda cerrada para el resto.
 */
export const ANALYTICS_CLAIM = 'analytics';

/** true si el usuario tiene ese claim entre sus `allowed_apps`. */
export function hasClaim(user: UserLike, claim: string): boolean {
  const allowedApps = user?.app_metadata?.allowed_apps;
  return Array.isArray(allowedApps) && allowedApps.includes(claim);
}
