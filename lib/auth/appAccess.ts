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
 * Outlook es el primero con su propio permiso. Los DOS que lo tienen
 * (Fernando Orduz, Isabella Cano) tienen TAMBIÉN `commercial_activity`, así que
 * el gate de la app entera sigue siendo el primero en aplicarse y este claim se
 * suma; no lo reemplaza.
 *
 * ⚠ NO SE LISTAN LOS NOMBRES DE NUEVO SIN LA FECHA. Este comentario decía
 * cuatro --Jorge Campodónico y Pier Laino incluidos-- y era verdad en OL1;
 * después se les quitó y el comentario siguió afirmándolo. Un comentario que
 * enumera un dato que vive en `auth.users` envejece sin que nada falle, y en el
 * medio se usa para decidir. Verificado en `auth.users` el 2026-09-08: son dos.
 *
 * Si hace falta saberlo con certeza, la respuesta está en la base y no acá:
 *
 *     select u.email from auth.users u
 *     where u.raw_app_meta_data -> 'allowed_apps' ? 'outlook';
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

/**
 * Etapa ADMIN-1: la sección Admin, que muestra el roster de RRHH y los cambios
 * detectados entre cargas. Hoy la tiene una sola persona.
 *
 * ⚠ Este claim NO es "administrador del portal": no da poderes sobre nadie ni
 * sobre ninguna otra pantalla. Es el permiso para VER datos de personal --
 * nombres, cargos, supervisores, correos-- que el resto de los módulos no
 * muestra. Si algún día aparece un permiso de administración de verdad, va a
 * necesitar otro nombre, porque este ya está tomado por una lectura.
 */
export const ADMIN_CLAIM = 'admin';

/**
 * Etapa RV1: quién puede ASIGNAR revisiones. Hoy tres personas — Isabella,
 * Fernando y Ricardo.
 *
 * ⚠ NO ES el permiso para participar de una revisión. El BP Team entero ve
 * `Mis revisiones` con `commercial_activity` y nada más: este claim sólo abre
 * la pantalla de configuración, que decide quién revisa a quién.
 *
 * ⚠ Y NO SE REUSÓ `admin`. Ese claim está documentado arriba como el permiso
 * para VER datos de personal, con la advertencia de que un permiso de
 * administración de verdad necesitaría otro nombre. Éste es ese caso.
 *
 * Tiene que coincidir exactamente con lo que revisa `review.can_assign()` en la
 * base. Si divergen, la UI y RLS dirían cosas distintas — y la que protege los
 * datos es la de la base.
 */
export const REVIEW_ADMIN_CLAIM = 'review_admin';

/** true si el usuario tiene ese claim entre sus `allowed_apps`. */
export function hasClaim(user: UserLike, claim: string): boolean {
  const allowedApps = user?.app_metadata?.allowed_apps;
  return Array.isArray(allowedApps) && allowedApps.includes(claim);
}
