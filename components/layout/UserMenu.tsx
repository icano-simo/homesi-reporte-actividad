'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { LOGIN_PATH } from '@/lib/auth/routes';
import { LogOutIcon } from '@/components/ui/icons';

/**
 * Identidad de la sesión activa + cerrar sesión, en la barra del Service Hub.
 *
 * Etapa AUTH1. No estaba en la lista de lo pedido, pero sin esto no hay forma
 * de salir ni de cambiar de usuario una vez adentro — ni siquiera para probar
 * el flujo con distintas cuentas, que es el paso siguiente. Es la contraparte
 * mínima del login.
 *
 * Cerrar sesión afecta a TODAS las apps del portal: la sesión es del proyecto
 * de Supabase compartido, no de esta app. Se avisa en el `title` del botón en
 * vez de con un diálogo de confirmación, que sería ruido para una acción que
 * se deshace volviendo a entrar.
 */
export default function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Sin sesión resuelta todavía no se dibuja nada: mostrar un botón de cerrar
  // sesión antes de saber si hay una produce un parpadeo en cada carga.
  if (!email) return null;

  async function signOut() {
    setBusy(true);
    await getSupabaseClient().auth.signOut();
    // replace + refresh: el gate tiene que volver a correr con la cookie ya
    // borrada, o la navegación se resuelve con el árbol de rutas cacheado.
    router.replace(LOGIN_PATH);
    router.refresh();
  }

  return (
    <div className="hub-user">
      <span className="hub-user__email" title={email}>
        {email}
      </span>
      <button
        type="button"
        className="hub-user__signout"
        onClick={signOut}
        disabled={busy}
        title="Sign out of the Homesí portal (affects every app in it)"
        aria-label="Sign out"
      >
        <LogOutIcon size={14} />
      </button>
    </div>
  );
}
