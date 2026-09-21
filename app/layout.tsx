import type { Metadata } from 'next';
import { Inter, Barlow } from 'next/font/google';
import './globals.css';
import ServiceHubHeader from '@/components/layout/ServiceHubHeader';
import { getServerClient } from '@/lib/supabase/server';
import { APP_NAME } from '@/lib/auth/appAccess';
/*
 * ⚠ Etapa RV1 — LA MÁSCARA Y SU CSS VIVEN ACÁ, y no en el layout del módulo.
 *
 * La revisión cruza de Business Plan a Outlook y vuelve. En el layout de un
 * módulo la barra se DESMONTARÍA al cruzar y la persona la vería desaparecer en
 * medio de una conversación con el Loan Officer. La documentación de Next lo
 * dice explícito -- «Layouts do not re-render on navigation»,
 * `03-api-reference/03-file-conventions/layout.md` -- así que éste es el único
 * lugar donde el requisito se cumple.
 *
 * Y por eso su hoja de estilos también se importa acá: tiene que estar cargada
 * en las cuatro pantallas del portal, no sólo en `/review`.
 */
import ReviewMaskHost from '@/components/review/ReviewMaskHost';
import ReviewProvider from '@/components/review/ReviewProvider';
import './review/styles/review.css';

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
        {/*
          ⚠ EL PROVEEDOR ENVUELVE AL ANFITRIÓN **Y** A LAS PÁGINAS, y ese orden
          es el arreglo de un defecto real: así comparten UNA lectura, y
          `recargar()` desde la pantalla que crea la sesión alcanza a la barra.

          Antes el anfitrión tenía su propio `useMyReviews`. El layout raíz no se
          desmonta al navegar --que era el punto de ponerlo acá-- así que
          consultaba una vez por carga completa y nunca más: una sesión creada
          después le era invisible, y la máscara no aparecía.
          Medido: cero consultas nuevas al navegar de cliente.

          `puedeRevisar` se resuelve en el SERVIDOR con el claim que ya se leyó
          para el header. Sin ese corte, cada carga de cualquier página del
          portal dispararía cinco consultas a `review` para las 97 personas que
          no son del BP Team -- y todas devolverían cero filas por RLS, que es la
          forma más cara de no hacer nada.

          Y el anfitrión no dibuja NADA sin sesión en curso: ni la barra, ni el
          borde, ni un contenedor vacío. La app normal queda idéntica.
        */}
        <ReviewProvider puedeRevisar={allowedApps.includes(APP_NAME)}>
          <ReviewMaskHost />
          <div className="app">
            <ServiceHubHeader allowedApps={allowedApps} />
            <main className="hub-canvas">{children}</main>
          </div>
        </ReviewProvider>
      </body>
    </html>
  );
}
