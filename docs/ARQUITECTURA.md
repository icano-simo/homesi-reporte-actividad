# Homesí App — Arquitectura consolidada
Estado real al 30 de julio de 2026 — no es el plan original, es lo que existe hoy en el repo.

> Guárdalo también dentro del repo como `/docs/ARQUITECTURA.md` — así vive junto al código,
> no solo en este chat.

---

## Datos del proyecto

- **Repo**: `HeatherYelettni/homesi-reporte-actividad` (privado), Isa como colaboradora (`isa24cano99-sys`).
- **Carpeta local**: `C:\Projects\Informes Pipeline\homesi-app`
- **Carpeta scratch** (nunca se comitea): `C:\Projects\Informes Pipeline\_scratch\`
- **Node**: portátil (sin admin), `C:\Users\dataminer\node-portable`, v24.18.0 / npm 11.16.0
- **Terminal**: cmd.exe puro — PowerShell bloqueado por política corporativa, no usar sintaxis de Unix/Git Bash en comandos manuales (Claude Code internamente sí puede usar su propio shell tipo Git Bash, eso es aparte).
- **Vercel**: desplegado hoy bajo la cuenta personal de Heather ("HomeSI Digital", plan Hobby) — pendiente que Isa lo redespliegue desde la cuenta de equipo SimoLogic; cuando eso pase, se borra el deploy personal.
- **Supabase**: proyecto `simoOS-prod`, equipo SimoLogic. RLS abierta temporalmente (confirmado por Isa), pendiente de SSO.
- **Pendiente de higiene**: rotar el anon key de Supabase (quedó expuesto en una captura de pantalla en algún momento) — hacerlo como práctica rutinaria, sin necesidad de explicar el motivo original.

---

## Módulo 1 — Reporte de Actividad

### Alcance
File Creations, Credit Reports, Applications, Closings — por branch, loan officer y B2B. Migración de un HTML monolítico a Next.js. Prácticamente completo y en producción.

### Estructura de carpetas (plana — un solo dominio cuando se construyó)
```
/lib/parsing/     -- extracción técnica: RawLoanRow, excelValueToYearMonth (UTC en las 6 rutas de conversión)
/lib/domain/      -- reglas de negocio: classifyBranch, closingMonth (Banked-Retail->fundingMonth, Brokered->completionMonth)
/lib/aggregation/ -- computeMetricMaps, buildReportTree (measure como parámetro explícito, nunca global)
/lib/export/      -- exportación a Excel (reutiliza ReportTree, no recalcula; muestra los 20 branches siempre)
/lib/persistence/ -- cliente Supabase, fijo al schema `activity_report`
/config/          -- OFFICIAL_ROSTER (19 branches confirmados), METRICS, REQUIRED_COLUMNS (byte-idéntico al legado)
```

### Supabase — schema `activity_report`
- `upload_batches` — metadata de cada carga, con retención de 90 días vía flag `is_current`
- `loan_records` — un registro por préstamo
- `user_roles` — vacía hoy, preparada para cuando llegue SSO

### Decisiones de arquitectura clave
- TypeScript desde el inicio; Next.js App Router (no Vite) pensando en escalar.
- `RawLoanRow` (extracción técnica) y `LoanRecord` (clasificado) como tipos separados — capa de parsing nunca conoce reglas de negocio, y viceversa.
- `Branch` tipado como `string` (abierto), `MetricKey` como unión estricta (`'fc'|'cr'|'ap'|'cl'`).
- Un bug real del HTML legado se corrigió con aprobación explícita de Heather: el drill-down por Loan Officer ignoraba el toggle Cantidad/Monto (siempre mostraba cantidad); ya corregido.

### Pendiente
- Redeploy en Vercel desde la cuenta de equipo de Isa (SimoLogic), no la personal de Heather.
- Auto-registro de branch nuevo: el roster vive en `config/roster.ts` como archivo estático, **no** como tabla en Supabase — a diferencia de Forecast, este módulo nunca necesitó branches dinámicos.

---

## Módulo 2 — Forecast / Pipeline

### Alcance
Solo CL (First Lien) por ahora. Fuente única: el reporte que Alejandra/Isabella exportan de Salesforce y suben manualmente (sin integración directa a la API de Salesforce). SL/HELOC y Encompash como fuente alterna quedan fuera de este alcance.

### Estructura de carpetas (namespaced — dominio separado a propósito de Actividad)
```
/lib/pipeline/
  types.ts                 -- PipelineLoan, ResolvedLoan (contrato de datos)
  sources/salesforce-file.ts -- parser (detecta Formato A "agrupado" o B "plano")
  aggregate.ts              -- Healthy/Total split, buckets de milestone, cascada de pull-through
                               (NUNCA importa nada de sources/ — regla no negociable)
/app/pipeline/
  page.tsx, SummaryCards.tsx, MilestoneCascade.tsx, PivotTable.tsx,
  DateRangeInput.tsx, UploadButton.tsx, AdverseTable.tsx (en curso)
/app/api/pipeline/upload/route.ts  -- parseo server-side (el parser usa Buffer de Node)
/components/Sidebar.tsx  -- compartido con Actividad, extraído del markup decorativo del HTML original
```

### Supabase — schema `pipeline_forecast` (separado de `activity_report`)
- `branches` — catálogo con auto-registro de branch nuevo (a diferencia de Actividad, aquí sí es tabla, porque Isabella lo pidió explícito para este módulo)
- `branch_managers` — mapeo fijo branch→manager (asignado a mano por Isabella, no calculado; **pendiente de permisos** — ver Riesgos)
- `pipeline_snapshots` — un snapshot por carga; retención: 90 días excepto `is_month_start`/`is_month_end`, que se conservan siempre
- `pipeline_loans` — un registro por préstamo por snapshot

### El contrato de datos (por qué importa)
`aggregate.ts` nunca debe conocer nombres de columnas de Salesforce — solo recibe `PipelineLoan[]`/`ResolvedLoan[]`. Esto es lo que permite agregar Encompash o BigQuery como fuente futura sin tocar el cálculo de negocio, solo agregando un archivo nuevo en `sources/`.

### Lógica de negocio, confirmada con datos reales (no supuesta)

**Milestone → bucket:**
| Milestone real | Bucket |
|---|---|
| Started | Started |
| Processing | Processing |
| Submittal, Initial Decision, Resubmittal | Underwriting |
| Clear To Close, Closing | Closing |

**Pull-through (micro-% estáticos, editables en UI):** Started 89.23%, Processing 93%, Underwriting 84.59%, Closing 95% — probabilidad acumulada según cuántas etapas le faltan al préstamo.

**Healthy vs Total Pipeline:** `Healthiness = 'On Track'` (o vacío) = Healthy. Cualquier otro valor (Delayed, Out of Scope, Never si aparece) = no-healthy, pero sigue contando en Total Pipeline. Adverse **nunca** cuenta en Total Pipeline — ya se cayó.

**Forecast final = Cerrados (Funded) + Proyección (cascada de pull-through sobre Healthy Pipeline).**

**Fechas — 3 campos distintos, cada uno para algo distinto, no intercambiables:**
- `Disbursement Date` → determina si un préstamo cuenta como "Cerrado" en el rango activo (confirmado exacto: 43 préstamos de julio calzan dígito por dígito contra el proceso manual).
- `Est. Closing Date` → determina si un préstamo (abierto) cuenta en Total Pipeline/Healthy Pipeline dentro del rango activo — un préstamo con cierre estimado fuera del mes no debe sumar al Forecast de ese mes.
- `Current Milestone Date` → **no sirve para ninguna de las dos cosas** (se mueve cuando el préstamo avanza de etapa; probado y descartado).

**Rango de fechas ("Rango del Forecast" en la UI):** aplica a ambas cosas (Cerrados y Total/Healthy Pipeline), no solo a Cerrados — corregido en F4f/F4g después de confirmarlo con datos reales.

### Historial de etapas (F0 → F4h)
| Etapa | Qué hizo |
|---|---|
| F0 | Sidebar compartido (extraído del HTML decorativo original), scaffold de tipos y rutas |
| F1 | Parser: detección automática de Formato A/B, forward-fill + descarte de subtotales, clasificación estricta por `Stage` (nunca por `Loan Folder`, que puede estar desactualizado) |
| F2 | `aggregate.ts`: cascada de pull-through, verificada contra `Summary SL` real |
| F3 | UI con datos de ejemplo (fixture) |
| F4 | Integración real: subir archivo → API route → parser → cálculo → UI |
| F4b | Forecast = Cerrados + Proyección (antes solo mostraba la proyección); tabla Branch+LO (versión inicial) |
| F4c | Rango de fechas ajustable para Cerrados |
| F4d | Rediseño: Branch colapsable → detalle de préstamo (Loan Number, Branch, Loan Officer, Borrower Name, Monto, Milestone, Fecha, Est. Closing Date); badge visual para préstamos con `Branch Transfer` |
| F4e | `Disbursement Date` reemplaza `Est. Closing Date` para Cerrados (con fallback si el archivo no la trae) |
| F4f | Rango de fechas también filtra Total/Healthy Pipeline (no solo Cerrados); resumen dividido Banked/Brokered/Combinado; columna Branch Manager |
| F4g | Branches sin actividad real y fuera del roster ya no generan fila fantasma; etiqueta "Rango del Forecast" |
| F4h | (en curso) tarjeta de Cerrados visible, tabla de Adverse filtrable por canal, Forecast redondeado a entero en tarjetas/tabla (la cascada de milestone conserva decimales, para auditoría), mejoras visuales con SVG inline (no se instaló `lucide-react` para no tocar `package.json` fuera de la lista de la etapa) |

### Riesgos y pendientes abiertos

1. **`pipeline_forecast.branches`/`branch_managers` dan `permission denied` con la anon key** — falta correr `GRANT` en Supabase (SQL ya entregado, pendiente de ejecutar). Mientras tanto, Branch Manager muestra "(sin asignar)" en todos lados sin romperse.
2. **Total Pipeline/Healthy Pipeline no van a coincidir exacto contra el proceso manual de Alejandra** — investigado a fondo: el "36 real" de su Excel interno sale de un proceso curado de 15 pasos (Encompash → cruce de duplicados → Micro PT → Pipeline SL), no de un filtro simple. No hay columna que Salesforce pueda agregar para replicarlo 1:1; sería necesario automatizar ese proceso completo (Fase futura).
3. **Agrupación "Corp Branches"** que aparece en el Excel de Isabella — criterio desconocido, sin confirmar (¿es por Loan Officer? Heather no tiene certeza). No implementado.
4. **Filtro `Branch does not contain TPO`** — se quitó en el reporte nuevo de Isabella, sin confirmar si es intencional.
5. **Encompash como fuente alterna** (cuando Salesforce cae) — arquitectura lo permite en teoría (`sources/` es plug-in), pero requiere que Encompash tenga un campo `Healthiness`-equivalente o se defina qué hacer sin él; no hay archivo de Encompash con esa estructura todavía para probarlo.
6. **`Loan Status`** se probó como posible filtro para aislar el pipeline "real" — descartado, no aísla nada en el export de Salesforce (a diferencia de en el Excel interno, donde sí lo hace).
7. **`fixtures/pipeline-demo.ts`** sigue en el repo, ya no se usa desde `page.tsx` — candidato a limpieza, no autorizado a borrar todavía.

---

## Glosario rápido (para no repetir la investigación)

- **CL / SL** en nombres de archivo = residuo histórico de cuando existían dos empresas (City Lending / Supreme Lending); hoy solo existe Supreme Lending, no hay distinción de marca activa.
- **Healthy / Delayed / Out of Scope / Never / Adverse** — estados de un préstamo en pipeline. Adverse = terminal (rechazado). Never = provisional, "ya sabemos que no va a cerrar pero Encompash no lo refleja aún" — se trata igual que Adverse para el forecast.
- **Loan Folder** ≠ milestone — es una carpeta operativa (Current Prospects, My Pipeline, Underwriting, Brokered, Funded, Adverse Loans), no la secuencia de avance del préstamo.
- **Org_ID vs True OrgID** — el campo `Branch` que ya usamos en el parser **es** el True OrgID (confirmado por Isabella); no hace falta distinguir los dos.
