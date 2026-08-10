# HOMESÍ — Analytics Portal

Portal de reportería con dos módulos, bajo una misma barra de navegación (Service Hub):

- **Commercial Activity** (`/`) — File Creations, Credit Reports, App Date y Closings por branch,
  loan officer y estrategia B2B.
- **Forecast & Pipeline** (`/pipeline`) — forecast ejecutivo por branch, matriz Branch × Milestone
  y préstamos adversos.

La arquitectura completa (módulos, reglas de negocio, historial de etapas, riesgos abiertos) está
en **[`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md)** — leer eso antes de tocar código.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # cmd.exe: copy .env.example .env.local
npm run dev
```

Abrir <http://localhost:3000>.

### Variables de entorno

Las dos variables de [`.env.example`](.env.example) salen de Supabase → proyecto `simoOS-prod`
(equipo SimoLogic) → **Settings → API**:

| Variable | Dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | "Project URL" |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | "Project API keys" → `anon public` |

`.env.local` está en `.gitignore` y **nunca** se comitea.

**Sin credenciales la app igual levanta y se puede ver completa**: lo único que no funciona es la
persistencia en la nube (restaurar el último reporte al abrir, y guardar un archivo recién subido).
Al intentar guardar aparece un aviso explícito en pantalla; no se rompe nada más. Para trabajar en
la UI alcanza con subir un `.xlsx` a mano — todo el cálculo corre en el navegador.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Sirve el build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Chequeo de tipos (no está en `package.json`, pero conviene correrlo antes de un commit) |

---

## Mapa del repo

```
app/
  page.tsx                -- vista Commercial Activity
  pipeline/               -- vista Forecast & Pipeline (componentes + estilos propios)
  api/pipeline/           -- parseo server-side, snapshots, retención, export
  layout.tsx              -- shell: header Service Hub + canvas
  styles/                 -- tokens -> base -> shell -> components (ver abajo)
components/
  layout/                 -- header y logo de marca
  report/                 -- tablas y controles de Commercial Activity
  ui/icons.tsx            -- set de iconos SVG compartido
lib/
  parsing/   domain/   aggregation/   export/   -- Commercial Activity
  pipeline/                                     -- Forecast (contrato de datos + cálculo)
  supabase/                                     -- persistencia (schema activity_report)
config/                   -- roster de branches, métricas, columnas requeridas
public/brand/             -- assets oficiales de marca
docs/ARQUITECTURA.md      -- documento vivo del proyecto
```

### Estilos

CSS plano con custom properties, **sin Tailwind** (decisión documentada en `docs/ARQUITECTURA.md`,
etapa UX1). El orden de import está en `app/globals.css` y no es arbitrario:

1. `styles/tokens.css` — paleta del Brand Book 2025 + escalas + radios/sombras/fuentes
2. `styles/base.css` — reset y tipografía base
3. `styles/shell.css` — header Service Hub, canvas y contenedor de 1440px
4. `styles/components.css` — botones, pills, tarjetas, tablas, flyout

`app/pipeline/styles/forecast-visual.css` es exclusivo de Forecast y se importa **solo** desde
`app/pipeline/page.tsx`.

Regla práctica: si un color no está en `tokens.css`, no se usa. Nada de hex sueltos en el JSX.
