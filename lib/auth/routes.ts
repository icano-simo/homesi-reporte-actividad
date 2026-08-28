/**
 * ============================================================================
 * RUTAS DE AUTENTICACIÓN — fuente única
 * ============================================================================
 *
 * Etapa AUTH1 — ARCHIVO NUEVO.
 *
 * Estas constantes las consumen estos lugares, que tienen que estar de acuerdo:
 *   - `proxy.ts`                             decide a dónde redirigir
 *   - `app/login/page.tsx`                   decide a dónde entrar
 *   - `app/change-password/page.tsx`         decide a dónde entrar tras cambiarla
 *   - `components/layout/ServiceHubHeader`   decide si dibujarse o no
 *
 * Si vivieran duplicadas, cambiar una ruta y olvidar otra produce justo el bug
 * que este patrón busca evitar: un bucle de redirecciones.
 */

export const LOGIN_PATH = '/login';
export const NO_ACCESS_PATH = '/no-access';
export const CHANGE_PASSWORD_PATH = '/change-password';
/** La ruta que libera el flag `must_change_password` (necesita service_role). */
export const COMPLETE_PASSWORD_CHANGE_PATH = '/api/auth/complete-password-change';

/**
 * Etapa UX11: a dónde va una sesión válida y con acceso -- Forecast & Pipeline,
 * no Commercial Activity. Solo cambia el destino de entrada; Commercial
 * Activity sigue viviendo en `/` y sigue siendo alcanzable desde su botón en
 * `ServiceHubHeader` (que apunta a `/` de forma literal, no a esta constante).
 */
export const DEFAULT_LANDING = '/pipeline';

/**
 * Etapa OL1: el módulo Outlook, que exige el claim `outlook` además del gate de
 * la app. La constante vive acá porque la consumen `proxy.ts` (para el gate) y
 * `ServiceHubHeader` (para no dibujar la pestaña), y duplicarla es cómo se
 * desincronizan.
 */
export const OUTLOOK_PATH = '/outlook';

/**
 * Rutas del flujo de autenticación. No forman parte de la app en sí, así que
 * no llevan el shell del Service Hub (header con tabs de módulo): mostrar la
 * navegación a alguien que todavía no entró no tiene sentido, y en /no-access
 * sería un botón a una vista que no puede abrir.
 */
export const AUTH_ROUTES: string[] = [LOGIN_PATH, NO_ACCESS_PATH, CHANGE_PASSWORD_PATH];

/**
 * Alcanzables por alguien que TIENE sesión y acceso, pero todavía debe cambiar
 * su contraseña temporal. Exentas del redirect a /change-password, porque si no
 * esa página se redirigiría a sí misma en bucle -- y la API route que libera el
 * flag tampoco podría llamarse nunca, dejando al usuario encerrado para siempre.
 */
export const PASSWORD_CHANGE_ROUTES: string[] = [CHANGE_PASSWORD_PATH, COMPLETE_PASSWORD_CHANGE_PATH];

/** Coincidencia exacta o de sub-ruta ('/login' también cubre '/login/algo'). */
export function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

export function isAuthRoute(pathname: string): boolean {
  return matchesRoute(pathname, AUTH_ROUTES);
}
