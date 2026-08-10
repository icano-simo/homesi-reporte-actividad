import type { Metadata } from 'next';
import { Inter, Barlow } from 'next/font/google';
import './globals.css';
import ServiceHubHeader from '@/components/layout/ServiceHubHeader';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable}`}>
      <body>
        <div className="app">
          <ServiceHubHeader />
          <main className="hub-canvas">{children}</main>
        </div>
      </body>
    </html>
  );
}
