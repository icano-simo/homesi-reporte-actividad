import { redirect } from 'next/navigation';

/**
 * ============================================================================
 * `/admin` MANDA AL PRIMER MÓDULO — etapa ADM3
 * ============================================================================
 *
 * Acá vivía el tablero del roster. ADM3 lo partió en dos --`/admin/roster` y
 * `/admin/margins`-- y esta ruta queda como la puerta: la pestaña de la barra
 * apunta a `/admin`, y los enlaces que alguien haya guardado también.
 *
 * ⚠ ES UN REDIRECT Y NO UNA TERCERA PANTALLA. Un índice con dos tarjetas sería
 * un clic de más todos los días para la única persona que entra acá, y una
 * pantalla más que mantener. La sub-navegación del layout ya dice cuáles son los
 * dos módulos y en cuál está parada.
 *
 * ⚠ Y NO SE TOCA EL GATE. `proxy.ts` compara por PREFIJO, así que `/admin` sigue
 * cubriendo `/admin/roster` y `/admin/margins` con el mismo claim. Si esta ruta
 * se borrara, el gate seguiría igual -- pero la pestaña quedaría apuntando a una
 * ruta que no existe.
 */
export default function AdminIndexPage() {
  redirect('/admin/roster');
}
