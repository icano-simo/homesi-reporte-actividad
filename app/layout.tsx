import type { Metadata } from 'next';
import { Inter, Barlow } from 'next/font/google';
import './globals.css';
import ServiceHubHeader from '@/components/layout/ServiceHubHeader';
import { getServerClient } from '@/lib/supabase/server';

/*
 * Etapa UX1 (overhaul Service Hub):
 *  - Se eliminó <Sidebar /> (rail vertical navy) y el layout dejó de ser un
 *    flex horizontal: ahora es header sticky arriba + canvas debajo.
 *  - Se agregó Barlow (Section Headers del Brand Book) junto a Inter (body y
 *    tablas de datos). Ambas se exponen como CSS custom properties para que
 *    las hojas de estilo las consuman vía --font-body / --font-display
 *    (tokens.css) en vez de nombrar la familia a mano en cada regla.
 *  - `Articulat CF` (la primera opción del spec para los KPI hero) no está en
 *    Google Fonts y no hay licencia/archivo en el repo — se usa la segunda
 *    opción que el propio spec autoriza: Inter en font-bold.
 */

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-barlow',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'HOMESÍ — Analytics Portal',
  description: 'Commercial Activity and Forecast & Pipeline reporting.',
};

/*
 * ⚠ Etapa OL1: el layout pasa a ser `async` para leer los claims de la sesión
 * en el SERVIDOR y pasárselos al header, que decide qué pestañas dibujar.
 *
 * Se lee acá y no en el header porque el cliente de navegador devuelve el
 * usuario sin `app_metadata.allowed_apps` -- verificado. Y porque así la
 * pestaña sale de la misma fuente que el gate de `proxy.ts`: si divergieran,
 * habría una pestaña que rebota o un módulo alcanzable sin pestaña.
 *
 * Un fallo leyendo la sesión no debe dejar la app sin header: se resuelve como
 * "ningún claim", que dibuja las tres pestañas públicas del portal y esconde
 * las que exigen permiso.
 */
async function readAllowedApps(): Promise<string[]> {
  try {
    const supabase = await getServerClient();
    if (!supabase) return [];
    const { data } = await supabase.auth.getUser();
    const claims = data.user?.app_metadata?.allowed_apps;
    return Array.isArray(claims) ? claims : [];
  } catch {
    return [];
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const allowedApps = await readAllowedApps();
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable}`}>
      <body>
        <div className="app">
          <ServiceHubHeader allowedApps={allowedApps} />
          <main className="hub-canvas">{children}</main>
        </div>
      </body>
    </html>
  );
}
