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
  const allowedApps = user?.app_metadata?.allowed_apps;
  return Array.isArray(allowedApps) && allowedApps.includes(APP_NAME);
}
