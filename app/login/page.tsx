'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { hasAppAccess } from '@/lib/auth/appAccess';
import { DEFAULT_LANDING, NO_ACCESS_PATH } from '@/lib/auth/routes';
import '@/app/styles/auth.css';

/**
 * ============================================================================
 * LOGIN — Supabase Auth (email + contraseña)
 * ============================================================================
 *
 * Etapa AUTH1. Mismo proyecto de Supabase y mismos usuarios que el resto del
 * portal: no se crea ningún sistema de auth propio, sólo se inicia sesión
 * contra `simoOS-prod`.
 *
 * Se firma con `getSupabaseClient()` — el MISMO cliente que después usa la app
 * para leer datos. Eso es lo que hace que el JWT viaje solo en cada consulta:
 * `signInWithPassword` deja la sesión guardada en ese cliente (en cookies, ver
 * lib/supabase/client.ts), y supabase-js adjunta el access token en el header
 * `Authorization` de todo lo que salga después. Si el login se hiciera con una
 * instancia distinta, la app seguiría consultando como `anon` y RLS la
 * rechazaría igual.
 *
 * Estilo: port de `app/login/page.tsx` de homesi-pl (ver app/styles/auth.css
 * para la traducción de Tailwind a CSS y la verificación de que la paleta de
 * las dos apps es la misma).
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const supabase = getSupabaseClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        // Supabase devuelve el mismo mensaje para contraseña incorrecta y para
        // dirección inexistente, y está bien que así sea: distinguirlas
        // permitiría averiguar quién tiene cuenta probando direcciones.
        setError('Incorrect email or password.');
        return;
      }

      // Alguien sin acceso a esta app va a /no-access y no al reporte: el gate
      // lo rebotaría igual, y así ve el motivo real en vez de una pantalla que
      // parpadea.
      if (!hasAppAccess(data.user)) {
        router.replace(NO_ACCESS_PATH);
        router.refresh();
        return;
      }

      router.replace(DEFAULT_LANDING);
      // refresh() para que el gate vuelva a correr con la cookie ya escrita --
      // sin esto, la navegación puede resolverse con el árbol de rutas que el
      // cliente tenía cacheado de cuando no había sesión.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-panel">
        <Image
          className="auth-logo"
          src="/brand/homesi-lockup.png"
          alt="HOMESÍ — Powered by Supreme Lending"
          width={320}
          height={55}
          priority
        />

        <div className="auth-card">
          <form onSubmit={onSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="email" className="auth-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@supremelending.com"
                className="auth-input"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password" className="auth-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-input"
                required
              />
            </div>

            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>

            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
