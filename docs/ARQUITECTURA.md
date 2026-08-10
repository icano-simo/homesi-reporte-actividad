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
                               de Banked Y de Brokered (cada canal con su propio esquema de
                               buckets/tasas desde F5i, ver Riesgos) -- NUNCA importa nada de
                               sources/, regla no negociable
/app/pipeline/
  page.tsx                -- orquesta todo el cálculo derivado + el estado (filtros, tab activo)
  Topbar.tsx               (F6) -- upload + date range + forecast month + dropdown de branch global
  TabNavigation.tsx        (F6) -- shell de 3 tabs: Executive/Matrix/Adverse
  SummaryCards.tsx         -- banner de 4 tarjetas combinado (contrato de props cambió en F6, ver abajo)
  MilestoneCascade.tsx     -- tabla de cascada de pull-through, genérica desde F5i (ya no sabe
                              de Banked/Brokered, solo dibuja las rows que le pasen)
  PivotTable.tsx           -- Executive Branch Forecast (JSX reempaquetado en F6, lógica de
                              agregación intacta, ver abajo)
  TabMilestoneMatrix.tsx    (F6) -- Milestone Pipeline Matrix: matriz Branch x Milestone +
                              cascada + cuadro de Pull-Through Rates, todo filtrable por canal
  AdverseTable.tsx         -- tabla de Adverse & Risk Loans
  DateRangeInput.tsx, MonthSelector.tsx, UploadButton.tsx -- controles reusados dentro de Topbar
  styles/forecast-visual.css (F5d en adelante) -- CSS exclusivo de Forecast, ver sección propia abajo
/app/api/pipeline/
  parse/route.ts            -- parseo server-side (el parser usa Buffer de Node) + persistencia en Supabase
  latest/route.ts           -- restaura el último snapshot activo al abrir la página
  retention/route.ts        -- cron diario, retención de 90 días de snapshots
  adverse-history/route.ts  -- fecha de primera detección de cada préstamo como adverse
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

*(Etapas F5a-F5i: persistencia en Supabase, retención de 90 días, filtro de Adverse ampliado a cualquier motivo, y la cascada de pull-through propia de Brokered -- no documentadas en detalle en esta tabla, ver Riesgos abajo para lo que sigue abierto de esas etapas.)*

### Rediseño visual (Etapa F6)

Reorganización visual completa de la UI de Forecast -- **sin ningún cambio de cálculo**, `aggregate.ts` intacto en todo el proceso. Componentes nuevos:

- **`Topbar.tsx`** -- agrupa upload + date range + forecast month (controles que ya existían, reusados tal cual) + un dropdown de branch nuevo (`selectedBranch`), el filtro global de la página.
- **`TabNavigation.tsx`** -- shell de 3 tabs: Executive Branch Forecast / Milestone Pipeline Matrix / Adverse & Risk Loans. Antes todo vivía apilado en una sola pantalla.
- **`TabMilestoneMatrix.tsx`** -- matriz Branch x Milestone (toggle Total/Healthy) + la cascada de pull-through existente (`MilestoneCascade`, sin tocar) + el cuadro de Pull-Through Rates, todo filtrable por canal (Banked - Retail / Brokered, sin tercera opción combinada -- cada canal tiene su propio esquema de buckets).

**`SummaryCards.tsx` cambió de contrato de props**: antes recibía `blocks: SummaryBlock[]` (3 bloques repetidos -- Banked/Brokered/Combinado, cada uno con sus propias 4 tarjetas). Ahora recibe `combined`/`banked`/`brokered` por separado y renderiza UN solo banner de 4 tarjetas con los números combinados; Banked/Brokered solo aportan un desglose chico en el subtítulo de la tarjeta Forecast (`Banked: X | Brokered: Y`).

**`PivotTable.tsx` no cambió su lógica de agregación** (`buildBranchRows`, `buildChannelBlocks`, `addSubtotal`, `buildOrphanBranchRows` -- todas intactas) -- solo su JSX de retorno: antes eran 2 `<table>` lado a lado (una por canal) + una 3ra tabla aparte para Combined Total; ahora es una sola `<table>` con filas de sub-header por canal (`.grp.d1`) y las 3 filas de total (2 subtotales + Combined Total) como filas normales de esa misma tabla, bajo un único `<thead>`.

**Filtro de branch global**: `selectedBranch` (Topbar) ahora filtra las 4 secciones de la página -- banner, Executive, Matrix y Adverse -- no solo Executive como se pensó en un primer momento. La fuente única son `filteredBranchRows`/`filteredResolvedLoans` en `page.tsx` (derivadas de `branchRows`/`data.resolvedLoans` + `selectedBranch`); todo cálculo derivado de ahí para abajo (banner, `summarizeChannel`, las 2 cascadas de Matrix, `adverseInRange`, `resolvedSummary`) usa esas 2 variables, nunca los sets completos sin filtrar.

#### `forecast-visual.css` (`app/pipeline/styles/`)

CSS exclusivo de Forecast -- importado SOLO desde `app/pipeline/page.tsx`, nunca desde `globals.css`. `legacy-components.css` (compartido con Actividad) sigue **sin ninguna modificación** desde el inicio del proyecto -- confirmado en cada etapa de F6.

Clases agregadas en F6 (sobre las que ya existían desde F5d -- `.chev`, `.branch-transfer-chip`):
- `.tab-nav` / `.tab-btn` / `.tab-btn.active` -- shell de `TabNavigation.tsx`
- `.channel-segment` -- selector de canal y toggle Total/Healthy en `TabMilestoneMatrix.tsx`
- `.hero-banner` -- grid de 4 columnas del banner de `SummaryCards.tsx`
- `.adverse-header` -- header navy de `AdverseTable.tsx`, con `!important` -- necesario para ganarle a `table.piv thead .mo-row th` de `legacy-components.css` (el `background`/`color` de un `<th>` nunca hereda de un style inline en su `<tr>` padre, sin importar especificidad)
- `.grp.total-forecast` -- fondo claro + borde superior navy en filas de total (`MilestoneCascade`/`PivotTable`), también con `!important` por el mismo motivo (`tr.grp.total td{background:var(--navy)...}` de `legacy-components.css` gana si no se fuerza)

#### `tokens.css`

Agregadas `--canvas`, `--coral`, `--sky` (paleta de marca, fundaciones agregadas en F6a) -- ninguna variable existente se tocó (`--navy` intacto). Las 3 quedan **sin ningún consumidor todavía** -- ningún componente las usa; quedaron ahí como fundación para una etapa visual futura.

### Riesgos y pendientes abiertos

1. **`pipeline_forecast.branches`/`branch_managers` dan `permission denied` con la anon key** — falta correr `GRANT` en Supabase (SQL ya entregado, pendiente de ejecutar). Mientras tanto, Branch Manager muestra "(sin asignar)" en todos lados sin romperse.
2. **Total Pipeline/Healthy Pipeline no van a coincidir exacto contra el proceso manual de Alejandra** — investigado a fondo: el "36 real" de su Excel interno sale de un proceso curado de 15 pasos (Encompash → cruce de duplicados → Micro PT → Pipeline SL), no de un filtro simple. No hay columna que Salesforce pueda agregar para replicarlo 1:1; sería necesario automatizar ese proceso completo (Fase futura).
3. **Agrupación "Corp Branches"** que aparece en el Excel de Isabella — criterio desconocido, sin confirmar (¿es por Loan Officer? Heather no tiene certeza). No implementado.
4. **Filtro `Branch does not contain TPO`** — se quitó en el reporte nuevo de Isabella, sin confirmar si es intencional.
5. **Encompash como fuente alterna** (cuando Salesforce cae) — arquitectura lo permite en teoría (`sources/` es plug-in), pero requiere que Encompash tenga un campo `Healthiness`-equivalente o se defina qué hacer sin él; no hay archivo de Encompash con esa estructura todavía para probarlo.
6. **`Loan Status`** se probó como posible filtro para aislar el pipeline "real" — descartado, no aísla nada en el export de Salesforce (a diferencia de en el Excel interno, donde sí lo hace).
7. **`fixtures/pipeline-demo.ts`** sigue en el repo, ya no se usa desde `page.tsx` — candidato a limpieza, no autorizado a borrar todavía.
8. **[Histórico, F4i] Préstamo "invisible" entre Pipeline y Adverse — el motivo ya no aplica desde F5h.** Caso real encontrado (préstamo `776002059702`, agosto 2026): bajo el criterio original de F4i (`status='adverse'` Y `Loan Status='Application withdrawn'` Y Est. Closing Date en rango), un `Stage = Closed Lost` puesto por error/sin autorización en Salesforce (sin pasar por Encompash) caía en un hueco — no contaba como Pipeline (porque `Stage` no era `Negotiation`) ni aparecía en la tabla de Adverse, porque su `Loan Status` no era `Application withdrawn` (el préstamo en realidad seguía activo en Salesforce). Alejandra corrigió el caso puntual en Salesforce y restringió permisos para que no se repita.

   **Criterio actual (desde F5h)**: Adverse filtra solo por `status='adverse'` Y Est. Closing Date dentro del rango activo — ya no se filtra por `Loan Status` ni por `Loan Folder` (deliberadamente, confirmado por el negocio que ese campo puede estar desactualizado). El filtro por `Loan Status='Application withdrawn'` fue el diseño original de F4i; se descartó en F5h porque excluía Adverse legítimos con otros motivos (Application denied, File Closed for incompleteness, y hasta casos con `Loan Status` desincronizado tipo "Active Loan" a pesar de `Stage=Closed Lost`). Con el criterio de hoy, un caso como el de arriba ya aparecería en Adverse sin necesidad de ninguna alerta extra.
9. **`BranchForecastRow.bucketTotal`/`.bucketHealthy` son vestigiales para Brokered — riesgo activo para cualquier componente nuevo.** Ese tipo (definido en `PivotTable.tsx`) está tipado fijo a `BucketCounts`, el esquema de Banked (`Started`/`Processing`/`Underwriting`/`Closing`). `page.tsx` los calcula con `countByMilestoneBucket()` sin importar el canal, así que para una fila de canal Brokered esos 2 campos quedan con las keys y los valores de la clasificación de Banked — **no** los reales de Brokered (`FileCreation`/`AppDate`/`Processing`/`Submitted`). No es un bug nuevo (viene desde F5i, documentado ahí), pero cobra importancia recién ahora que `TabMilestoneMatrix.tsx` (F6) necesitó datos de bucket por branch: cualquier componente que lea `bucketTotal`/`bucketHealthy` directo de una fila Brokered va a mostrar datos incorrectos con etiquetas de Banked. **La forma correcta**: recalcular desde `row.loans` con `countByBrokeredMilestoneBucket()` (`aggregate.ts`, ya exportada) -- ver `bucketsForRow()` en `TabMilestoneMatrix.tsx` para el patrón ya implementado. Arreglarlo de raíz (que `BranchForecastRow` tenga un shape específico por canal) requeriría tocar `PivotTable.tsx`, fuera de alcance hasta ahora.
10. **`BANKED_MATRIX_COLUMNS` (`TabMilestoneMatrix.tsx`) está acoplado a mano con `MILESTONE_BUCKET` (`lib/pipeline/sources/salesforce-file.ts`) — sin ninguna referencia en código que los mantenga sincronizados.** Ajuste posterior a F6: la matriz Branch x Milestone desagrega el bucket `Underwriting` de Banked (que colapsa `Submittal`/`Initial Decision`/`Resubmittal`) en 3 columnas de vista, contando a mano sobre `rawMilestone` de cada préstamo (`bankedRawMilestoneCount()`) -- el cálculo de pull-through no cambió, sigue usando `bucketTotal.Underwriting`/`bucketHealthy.Underwriting` con la tasa combinada. El array `BANKED_MATRIX_COLUMNS = ['Started', 'Processing', 'Submittal', 'Initial Decision', 'Resubmittal', 'Closing']` está copiado a mano de `MILESTONE_BUCKET` -- si el parser agrega/quita un valor de `Current Milestone` dentro de Underwriting, `BANKED_MATRIX_COLUMNS` queda desactualizado en silencio (no rompe el build, solo deja de mostrar/cuenta mal una columna). No se resolvió leyendo dinámicamente de `MILESTONE_BUCKET` porque `sources/salesforce-file.ts` estaba fuera de la lista de archivos permitidos en esa etapa.
11. **`BROKERED_COLUMN_TO_RAW_MILESTONE` (`TabMilestoneMatrix.tsx`) es el mismo tipo de acoplamiento manual que el riesgo 10, pero contra `BROKERED_MILESTONE_BUCKET` (`lib/pipeline/aggregate.ts`, constante privada del módulo, no exportada).** Ajuste posterior: al hacerse clickeable cada celda de la matriz (para abrir `LoanDetailModal` con la lista real de préstamos de esa columna), hizo falta filtrar préstamos individuales de Brokered por `rawMilestone` -- `countByBrokeredMilestoneBucket()` (sí exportada) solo devuelve conteos agregados, no permite filtrar por préstamo. Como `aggregate.ts` estaba fuera de la lista de archivos permitidos en esa tarea (no se podía exportar `BROKERED_MILESTONE_BUCKET` ni agregar una función de filtro ahí), se copió el mapeo a mano en `TabMilestoneMatrix.tsx`, verificado línea por línea contra el código real antes de escribirlo: `Started->FileCreation`, `Processing->Processing`, `Submittal->Submitted` (`AppDate` no tiene ningún `rawMilestone` real que mapee ahí, columna siempre en 0). Mismo riesgo que el ítem 10: si `BROKERED_MILESTONE_BUCKET` cambia en `aggregate.ts`, esta copia queda desactualizada en silencio.
---

## Etapa UX1 — Overhaul UI/UX "Service Hub" (ambos módulos)

Rediseño transversal contra el **HOMESÍ Brand Book 2025**. Toca los dos módulos a la vez.
**Ningún cambio de cálculo**: `lib/aggregation/*`, `lib/pipeline/*`, `lib/domain/*`, `lib/parsing/*`
y `lib/export/*` quedaron intactos salvo los *labels* de `config/metrics.ts` (texto visible).

### Decisiones de fondo

1. **No se instaló Tailwind.** El brief estaba escrito en clases de Tailwind, pero el proyecto
   nunca lo tuvo. Se tradujo el spec a CSS con tokens — misma convención que ya seguía
   `forecast-visual.css` desde F5d. Alternativa descartada: instalar Tailwind v4 obligaba a
   migrar el CSS de los ~14 componentes y a convivir con dos sistemas durante la transición.
2. **No se instaló `lucide-react`.** Se transcribieron los ~14 paths de iconos que la app
   realmente usa a `components/ui/icons.tsx` (Lucide es ISC). Mantiene la decisión ya tomada
   en F4h y evita un paquete completo en el bundle por 14 iconos.
3. **`Articulat CF`** (primera opción del brief para los KPI hero) no está en Google Fonts ni
   hay licencia en el repo → se usa la segunda opción que el propio brief autoriza: Inter bold.
4. **Sin drill-down en Commercial Activity.** El brief pedía flyout de auditoría al click en
   *cualquier* celda numérica de las dos vistas, con columnas `Loan Number` / `Borrower Name` /
   `Amount`. `LoanRecord` (módulo Actividad) **no guarda** número de préstamo ni prestatario —
   solo branch, loan officer, BD, montos y meses. Confirmado con Isa: el flyout queda solo en
   Forecast, donde el dato de préstamo individual sí existe; Actividad mantiene su
   expand/collapse por Loan Officer.

### Arquitectura de estilos (nueva)

```
app/styles/tokens.css      -- paleta de marca + escala slate/emerald/rose + radios/sombras/fuentes
app/styles/base.css        -- reset, body, tabular-nums global
app/styles/shell.css       -- (NUEVO) header Service Hub + canvas + contenedor 1440px
app/styles/components.css  -- (ex legacy-components.css) botones, pills, tarjetas, tablas, drawer
app/pipeline/styles/forecast-visual.css -- solo lo exclusivo de Forecast
```

`globals.css` importa los 4 primeros en ese orden; `forecast-visual.css` se sigue importando
solo desde `app/pipeline/page.tsx`.

**`tokens.css` se limpió a fondo**: se eliminaron los alias genéricos del legado (`--bg`,
`--card`, `--text`, `--muted`, `--muted-2`, `--border`, `--border-soft`, `--accent`, `--green`,
`--green-tint`, `--red`, `--navy-row`, `--shadow`, `--sidebar`, `--sidebar-icon` y los cinco
`--tag-*`). Describían los mismos colores con dos nombres distintos que la escala nueva — la
receta para que la paleta se desincronice. Cada uso se migró al token concreto
(`--navy`, `--slate-*`, `--emerald-*`, `--rose-*`), verificado con un cruce
"tokens definidos vs. tokens usados" sobre todo el repo.

### Archivos borrados

| Archivo | Motivo |
|---|---|
| `components/Sidebar.tsx` | El rail vertical navy se elimina (spec §1.1). De sus 6 iconos, 4 eran decorativos sin destino. |
| `app/styles/legacy-components.css` | Renombrado a `components.css` y reescrito contra el Brand Book. |
| `app/pipeline/LoanDetailModal.tsx` | Reemplazado por `LoanDetailDrawer.tsx` (flyout lateral, spec §5). |
| `app/page.module.css` | Sobrante del template de Next: ningún archivo lo importaba. |

También se borró **código muerto**: `buildLoanDetailRows()` + `LoanDetailTable` de
`app/pipeline/PivotTable.tsx` (sin uso desde que el drill-down inline pasó a modal; están en el
historial de git de ese archivo si hicieran falta) y los 3 botones deshabilitados sin handler
de `app/page.tsx` ("Guardar", "Exportar JSON", "Importar JSON").

### Archivos nuevos

| Archivo | Rol |
|---|---|
| `components/layout/ServiceHubHeader.tsx` | Top bar sticky con los 2 tabs de módulo. Se monta una sola vez en `app/layout.tsx`; el tab activo se deriva de `usePathname()`. |
| `components/layout/HomesiLogo.tsx` | Renderiza el lockup oficial de marca (ver "Assets de marca" abajo). |
| `components/ui/icons.tsx` | Set de iconos compartido (ver decisión 2). |
| `app/styles/shell.css` | Layout global del Service Hub. |
| `app/pipeline/healthStatus.ts` | `healthStatusLabel()` + `healthStatusVariant()`. **Cierra el import circular** `PivotTable ⇄ LoanDetailModal` que estaba documentado como pendiente en el propio código. `healthStatusColor()` (devolvía `{background,color}` para estilo inline) pasó a `healthStatusVariant()`, que devuelve el nombre de la clase de badge: el color vive en CSS, no en el JSX. |
| `app/pipeline/LoanDetailDrawer.tsx` | Flyout de auditoría (spec §5). Agrega la columna `Loan Officer` que pedía el spec y recupera el chip "Transferred", que había quedado sin renderizar en ningún lado. |

### Cambios por vista

**Commercial Activity** — KPI strip de 8 tarjetas en grilla (antes: fila con scroll horizontal,
justo lo que prohíbe el spec §6); tendencias como badge SVG emerald/rose en vez de "▲/▼"
coloreados; toolbar consolidado en una tarjeta blanca con pills + selects redondeados
(el filtro de Año pasó de fila de botones a `<select>`); tabla con header claro, primera
columna congelada, zebra y hover 'Light Sky'. Todo el texto a inglés.

**Forecast & Pipeline** — banner de 4 tarjetas ejecutivas con variantes emerald/sky;
`Topbar` dejó de ser franja a todo el ancho y es ahora la tarjeta de control; matriz
Branch × Milestone dentro de tarjeta, con ceros apagados y no clickeables; Pull-Through Rates
en su propia tarjeta al pie del Tab 2; header navy de `AdverseTable` reemplazado por el header
claro estándar; el modal centrado pasó a flyout lateral.

**Iconografía**: se eliminaron todos los caracteres usados como icono
("▸", "▾", "▲", "▼", "–", "×") en favor de SVG (spec §2, "Zero Emojis").

### Assets de marca (`public/brand/`)

Entregados por Isa y usados **tal cual, sin recortar ni redibujar**:

| Archivo en repo | Original | Tamaño | Uso |
|---|---|---|---|
| `public/brand/homesi-lockup.jpg` | `HOMESI_Logo1_Color.jpg` | 1089×187 | Lockup del header. Ya incluye ícono + logotipo "HOMESÍ" + "Powered By" + logo de Supreme Lending. |
| `public/brand/homesi-mark.jpg` | `We are HOMESI - Brand Book (1).jpg` | 1920×1080 | Mark suelto (círculo coral + casa). Fuente del favicon. |

Detalles a tener en cuenta:

- Se renderiza con `next/image` + `priority` (está en el viewport inicial de todas las rutas).
- Los dos JPG tienen **fondo blanco sólido**; el header es blanco al 95% con blur. Para que el
  logo no se recorte como un rectángulo visible se aplica `mix-blend-mode: multiply` en
  `.hub-brand__logo` — el blanco desaparece y solo quedan el coral y el navy. Si algún día
  llega el logo en SVG o PNG con transparencia, esa regla se puede borrar.
- El CSS responsive ajusta **ancho y alto juntos** (151×26 bajo 900px), respetando la
  proporción real 1089×187: `next/image` avisa en dev si el CSS modifica solo una de las dos.
- `app/icon.png` (256×256) es el **único derivado**: se generó con `sharp` recortando el margen
  blanco de `homesi-mark.jpg` (queda 1038×1039, prácticamente cuadrado) y escalando. Reemplaza
  al `app/favicon.ico` por defecto del template de Next, que se borró.
- Como el lockup oficial ya trae el "Powered By Supreme Lending", se eliminaron
  `hub-brand__wordmark` y el bloque `hub-brand__powered*` del header: recreaban en texto algo
  que la imagen ya contiene, y mantener las dos versiones garantizaba que dejaran de coincidir.

### Configuración: la app ya no muere sin `.env.local`

Encontrado al probar el rediseño en local. `lib/supabase/client.ts` creaba el cliente en el
top-level del módulo y hacía `throw` ahí mismo si faltaban las env vars. Como `app/page.tsx`
importa ese archivo (vía `saveUpload`), el throw ocurría durante la **evaluación del módulo**:
sin `.env.local`, Commercial Activity devolvía un **500 con pantalla en blanco** antes de
renderizar una línea de UI. Forecast no tenía el problema porque su cliente
(schema `pipeline_forecast`) ya se construía con guarda dentro de un `useEffect` — una asimetría
entre los dos módulos que nadie había notado.

Cambios:

- `client.ts` pasa de `export const supabase` a `getSupabaseClient()` (cliente cacheado, chequeo
  al primer uso) + `isSupabaseConfigured()`. El tipo se deriva con `ReturnType<typeof ...>`
  porque `SupabaseClient` a secas asume el schema `'public'`.
- `saveUpload()` resuelve el cliente adentro: si faltan las vars, la promesa rechaza y el
  `.catch` que **ya existía** en `app/page.tsx` lo muestra como pill roja. El error sigue siendo
  igual de ruidoso, pero por el canal correcto.
- `loadCurrentReport()` devuelve `null` si no hay configuración: al abrir la página, "no hay
  nada guardado" es el estado correcto, no un error que valga la pena mostrar.
- Se agregó **`.env.example`** versionado (con una excepción `!.env.example` en `.gitignore`,
  que ignora `.env*`) y se reescribió el `README.md`, que hasta ahora era el boilerplate intacto
  de `create-next-app` — incluso afirmaba que el proyecto usa la fuente Geist. Ese vacío de
  documentación es la razón por la que el requisito de `.env.local` no estaba en ningún lado.

Resultado: `/` responde **200 sin ninguna variable de entorno**, con la UI completa; lo único que
queda inactivo es la persistencia en la nube.

### Hotfix UX2 — regresiones de layout de UX1

Cuatro problemas reportados sobre la versión desplegada. **El diagnóstico del brief no
coincidía con el código en dos de los cuatro casos**; se corrigió la causa real, no la
descrita.

**1. Rectángulo blanco alrededor del logo.** El brief proponía `mix-blend-mode: multiply` —
que era exactamente lo que ya estaba puesto y no funcionaba. Causa real: `.hub-header` usa
`backdrop-filter: blur()`, que **crea un stacking context aislado**, así que el blend se
resuelve dentro de ese grupo y nunca contra el fondo real. Ningún ajuste de blend lo iba a
arreglar. Solución: PNG con transparencia real, generado desde el JPG oficial con `sharp`
(script en el scratchpad, reproducible):

- Flood fill 4-conexo desde el borde para el fondo exterior.
- Los blancos **encerrados** se clasifican por el color que los rodea: rodeados de coral →
  blanco de diseño (la "S" de Supreme Lending, los chevrons del mark) → **se conservan**;
  el resto → contraformas de letra → se abren. Un knockout global de blanco habría borrado
  también los blancos de diseño.
- Los `.jpg` originales quedan en `public/brand/` como fuente de verdad; los `.png` son los
  derivados que consume la app. `app/icon.png` se regeneró desde el mark transparente.

**2. Header de tabla solapando las filas.** El brief culpaba a `position: absolute` y a
transforms en los `th` — **no existía ninguno de los dos** (verificado con grep). Causa real:
`position: sticky; top: var(--header-h)` en el `th`, donde `--header-h` era un valor fijo
adivinado (60px), y el `th` quedaba pegado dentro de `.tbl-scroll` (`overflow-x:auto`) y
`.tbl-card` (`overflow:hidden`) en vez de respecto del viewport — así que flotaba sobre el
`tbody` de su propia tarjeta. El fondo `rgba(...,0.8)` translúcido dejaba ver las filas por
debajo, que es el síntoma exacto reportado. Se quitó el sticky del `thead` y el fondo pasó a
opaco. El `position: sticky` de la primera columna (`.lbl`, congelado horizontal) **se
conserva**: ese sí funciona y sigue haciendo falta en las tablas de árbol.

**3. Scrollbars horizontales / densidad.** Tres causas acumuladas:

- Padding de celda `7px 14px` → `6px 10px`.
- `min-width: 220px` en la primera columna: en las 2 tablas de canal, que ocupan media
  pantalla cada una, 220px para mostrar "707" dejaban sin espacio a las otras 5 columnas.
  Bajó a 110px; las tablas de árbol de Commercial Activity, que sí necesitan ancho, lo piden
  con la clase nueva `.piv--tree`.
- Anchos de columna en px → **porcentajes**, más `table-layout: fixed`. Ahora la tabla mide
  exactamente el 100% de su contenedor por construcción y el texto que no entra se recorta
  con ellipsis (con el valor completo en el `title`), en vez de ensanchar la tabla. Los 5
  `colgroup` suman 100% exacto, verificado.

**4. Modal de auditoría.** El flyout lateral de 520px introducido en UX1 dejaba las 6
columnas apretadas y con scroll horizontal propio. Vuelve a ser un **modal centrado**
(`max-width: 768px`, `max-height: 85vh`), con las 6 columnas dimensionadas en % para que
entren sin scroll. `LoanDetailDrawer.tsx` → `LoanDetailModal.tsx`; las clases `.drawer*` se
reemplazaron por `.modal*` y no queda ninguna referencia al flyout en el código.

### Etapa UX3 — jerarquía visual por grupo de métrica (Tab 1)

Las 3 tablas ejecutivas (Banked - Retail / Brokered / Combined Total by Branch) mezclaban en
una grilla plana métricas de naturaleza distinta: lo **ya logrado** (Closed), lo **en curso**
(Total y Healthy Pipeline) y la **proyección** (Forecast). Sin señal visual había que volver al
encabezado en cada fila.

**Markup.** El `<colgroup>` y el `<thead>` estaban duplicados literalmente en los dos bloques de
JSX; con 3 clases nuevas por celda esa duplicación se volvía cara, así que se extrajeron
`ExecColgroup`, `ExecHead` y `ExecTotalRow` — un solo lugar donde cambiar anchos, rótulos o
agrupación. Cada columna lleva su clase de grupo (`col-closed` / `col-pipeline` /
`col-forecast`) y `group-start` marca dónde va el divisor vertical. Todo cuelga de `.piv--exec`
para no afectar la matriz, la cascada ni Adverse.

**Tratamiento visual.** Encabezado navy sólido; Closed en badge navy sobre gris (y apagado en
cero, que no es un logro que destacar); las dos columnas de pipeline con un tinte de fondo que
las agrupa; Forecast siempre en píldora verde. La fila de total cierra en navy repitiendo el
tratamiento de cada columna, para que se lea como resumen de lo de arriba.

Anchos: 12 / 32 / 14 × 4 = **100%**. Branch cede 1 punto y Branch Manager gana 5 — es la
columna que de verdad los necesita.

#### Dos contradicciones del brief, resueltas a propósito

1. **Encabezado navy sólido vs. fondos claros por columna.** El brief pedía las dos cosas para
   las mismas celdas: barra navy con texto blanco (§3) y, a la vez, fondo navy al 5% en Closed
   y verde al 60% en Forecast (§2). No pueden convivir. Se priorizó §3 (regla global del
   encabezado) y la distinción por columna se resolvió con el **color del texto**, que sí
   funciona sobre navy: Forecast en verde claro, Closed en blanco puro, pipeline en blanco
   atenuado.
2. **"Una sola línea" con columnas de 14%.** En las tablas de canal (media pantalla) 14% son
   ~90px; "HEALTHY PIPELINE" en mayúsculas necesitaría ~7px de tipografía para entrar en una
   línea. El objetivo real era que **no se recorten**, así que el encabezado envuelve a dos
   líneas (`white-space: normal`, sin ellipsis en el `thead`). Verificado: los 6 rótulos
   aparecen completos en el HTML de las 3 tablas.

#### Inconsistencia que dejó abierta — resuelta en UX4

El encabezado navy aplicaba sólo a esas 3 tablas, que era el alcance del brief, y dejaba dos
estilos de encabezado conviviendo dentro de Forecast. Se señaló como decisión de diseño
pendiente y se resolvió en la etapa siguiente.

### Etapa UX4 — tema claro unificado en todas las tablas

Decisión del negocio: **ningún fondo oscuro en encabezados de tabla**. Revierte la barra navy
de UX3 y unifica el criterio en toda la app.

- **Una sola regla base** (`table.piv thead .mo-row th`, en `components.css`) para las 7 tablas:
  Commercial Activity (árbol y Loan Officer), las 3 ejecutivas, la matriz, la cascada y Adverse.
  `slate-100/80`, borde inferior de 2px, texto navy en mayúsculas.
- **La agrupación por métrica ya no usa bloques de color**, sino tintes pastel y bordes
  sutiles: Closed en texto navy con divisor a la derecha, las dos de Pipeline con fondo
  `slate-50/60`, Forecast con tinte `emerald-50` y esquinas superiores redondeadas.
- **El envolver-antes-que-truncar pasó a la regla base**: `white-space: normal` en el `thead`,
  con el `overflow:hidden` de las celdas de datos revertido. Ninguna cabecera queda cortada en
  ninguna tabla, no sólo en las ejecutivas.
- **La fila de total también pasó a claro.** El brief hablaba sólo de encabezados, pero dejar un
  pie navy sólido debajo de un encabezado claro contradecía el criterio declarado y hacía que la
  fila de cierre pesara más que los datos. Se distingue por peso tipográfico y borde superior,
  no por fondo oscuro.

Navy sigue usándose donde sí corresponde y no se tocó: estados activos de botones y tabs
(`.btn.primary`, `.seg button.on`, `.tab-btn.active` — el spec de marca los fija así) y el
relleno de las barras de pull-through de la cascada, que necesita contraste contra su track
celeste.

### Etapa UX5 — densidad 2D balanceada

El alto de fila había bajado bien, pero el espaciado horizontal quedó corto: los números
tocaban el borde de la celda y la columna vecina.

- **Padding de celda `8px 16px`** (venía de `6px 10px`), encabezados a `9px 16px` para que la
  columna se lea como una franja continua. El modal de auditoría conserva `8px 10px`: su caja
  mide 768px y 16px por lado en 6 columnas se comerían 192px.
- **`font-variant-numeric: tabular-nums` explícito en `table.piv`**, además del global de
  `base.css` — es un requisito duro de estas tablas, no una preferencia heredada que alguien
  pueda quitar sin notarlo.
- **Métricas centradas** en las 3 tablas ejecutivas: las 4 columnas renderizan badges,
  píldoras y botones, no números pelados, así que centrar la forma se lee mejor que pegarla al
  borde. Commercial Activity y la cascada conservan alineación a la derecha, que es lo correcto
  para comparar números crudos de distinta cantidad de dígitos.

#### El `min-width` del brief no funcionaba donde lo pedía

Pedía `min-w-[180px]` en Branch Manager y `min-w-[90px]` en las métricas, puestos en la celda.
Con `table-layout: fixed` **el navegador ignora los mínimos de celda**: reparte según el
`<colgroup>` y nada más. Se tradujo al único lugar donde sí tiene efecto, el ancho mínimo de la
**tabla**, despejando desde el porcentaje de cada columna:

| Columna | % | mínimo pedido | ancho de tabla implicado |
|---|---|---|---|
| Branch Manager | 32% | 180px | 562px |
| cada métrica | 14% | 90px | **643px** ← manda |

`min-width: 650px` en `.piv--exec` y `.piv--matrix`; `1000px` en `.piv--adverse` (sus columnas
de texto están al 18%, y es una tabla a todo el ancho del canvas).

**Consecuencia deliberada**: las 2 tablas de canal ocupan media pantalla cada una — con canvas
de 1440px miden ~686px y entran holgadas, pero **por debajo de ~1366px de viewport aparece
barra horizontal**. Es exactamente el intercambio que el brief acepta al pedir `overflow-x-auto`
(§3): se prioriza que nombres y números respiren por sobre "cero scrollbars", que era el
criterio del hotfix UX2. Si en algún momento se prefiere lo contrario, se baja el `min-width`.

### Riesgo/pendiente que deja esta etapa

12. **`config/metrics.ts` es fuente única de labels para UI *y* export a Excel.** Al cambiar
    `'Credit_Report'` → `'Credit Reports'` y `'App date'` → `'App Date'` también cambian los
    rótulos de fila del `.xlsx` generado. Fue deliberado (un solo juego de nombres), pero si
    algún consumidor aguas abajo parsea esos textos, hay que avisarle.
13. **`next build` no se ejecutó en esta etapa.** Verificación hecha: `tsc --noEmit` limpio,
    `eslint` limpio, y smoke test real con `next dev` — `/` y `/pipeline` devuelven 200, las
    dos fuentes (Inter + Barlow) se inyectan en `<html>`, no queda ninguna referencia al
    sidebar en el HTML renderizado, y el lockup se sirve OK a través del optimizador de
    imágenes (`/_next/image?url=/brand/homesi-lockup.jpg`).

---

## Glosario rápido (para no repetir la investigación)

- **CL / SL** en nombres de archivo = residuo histórico de cuando existían dos empresas (City Lending / Supreme Lending); hoy solo existe Supreme Lending, no hay distinción de marca activa.
- **Healthy / Delayed / Out of Scope / Never / Adverse** — estados de un préstamo en pipeline. Adverse = terminal (rechazado). Never = provisional, "ya sabemos que no va a cerrar pero Encompash no lo refleja aún" — se trata igual que Adverse para el forecast.
- **Loan Folder** ≠ milestone — es una carpeta operativa (Current Prospects, My Pipeline, Underwriting, Brokered, Funded, Adverse Loans), no la secuencia de avance del préstamo.
- **Org_ID vs True OrgID** — el campo `Branch` que ya usamos en el parser **es** el True OrgID (confirmado por Isabella); no hace falta distinguir los dos.
