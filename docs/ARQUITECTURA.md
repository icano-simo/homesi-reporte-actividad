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

### Etapa 2 — filtros de datos (B2B + Channel)

Reemplaza el `view: 'main'|'b2b'|'loanOfficer'` excluyente por dos conceptos
separados, en `app/page.tsx` (estado) y `components/report/Toolbar.tsx`
(tipos `GroupBy`/`ChannelFilter`):

- `groupBy` (`'branch' | 'loanOfficer'`) — modo de PRESENTACIÓN de la tabla,
  sigue siendo único a la vez (Branch × Metric o Loan Officer).
- `b2bOnly` (boolean) y `channelFilter` (`ChannelFilter`) — FILTROS DE DATOS,
  independientes entre sí y del `groupBy`, y **combinables** entre sí y con
  cualquier `groupBy` (antes B2B y "Por Loan Officer" eran excluyentes).

El filtrado se aplica en `app/page.tsx` (`filteredRecords`) antes de agregar;
`buildReportTree` y `buildLoanOfficerTree` ya no filtran nada internamente,
solo agregan lo que reciben.

**Opciones de Channel** (`CHANNEL_OPTIONS`, Toolbar.tsx):
- All channels
- Banked - Retail
- Brokered
- Unclassified / Empty

**Regla de negocio — Unclassified / Empty** (confirmada por Isabella): representa
loans cuyo `loanInfoChannel` viene vacío (`''`). No se reasignan a Banked ni a
Brokered, ni se normaliza el dato original — se muestran como categoría propia
únicamente para dar visibilidad al problema de calidad de datos.

**Hallazgo validado**: existen 7 loans con `loanInfoChannel` vacío, que explican
la diferencia observada en File Creations entre Banked + Brokered y All
channels. Ejemplo validado: Banked 2,911 + Brokered 173 + Empty 7 = All 3,091.

Etapa 2 y esta corrección de Channel vacío quedaron validadas funcionalmente
en localhost con datos reales.

### Closed por Disbursement Date

Regla de negocio confirmada por Isabella: para ser consistente con
Salesforce, el MES de Closed debe salir de la columna opcional
`CLOSING DOCS REGZ LOAN INFO DISBURSEMENT DATE` (agregada a
`OPTIONAL_COLUMNS`, `config/requiredColumns.ts`) cuando el archivo la trae,
en vez de Milestone Date - Funding/Completion. Implementado en
`lib/domain/classifyLoan.ts`; el nuevo campo crudo vive en
`RawLoanRow.disbursementMonth` (`lib/parsing/types.ts`/`workbookReader.ts`).
`LoanRecord.closingMonth` sigue siendo el único campo que consume el resto
del módulo — sin cambios en `lib/aggregation/` ni en los componentes.

**No cambia SI un loan cuenta como Closed** — eso lo sigue decidiendo el
milestone del canal (Banked-Retail necesita Funding, Brokered necesita
Completion; sin eso, `closingMonth` es `null` sin importar si hay
Disbursement Date, para no convertir en Closed a un loan que sigue en
Started).

**Sí cambia el MES**, una vez que el loan ya cumplió su milestone:
- Con Disbursement Date presente para esa fila → ese es el mes de Closed
  (ejemplo confirmado: Brokered 747002047932, Completion 2026-08,
  Disbursement 2026-07 → Closed 2026-07).
- Sin Disbursement Date para esa fila (columna ausente del archivo o celda
  vacía) → se conserva Funding/Completion, mismo comportamiento que antes de
  este cambio — alternativa conservadora, no se inventó una regla nueva para
  este caso.

Columna opcional a propósito (no `REQUIRED_COLUMNS`): un archivo que no la
traiga sigue parseando igual que antes, cayendo siempre al respaldo de
arriba.

`tsc`/`build`/`lint` pasaron limpios sobre este cambio. **Pendiente de
validación manual contra Salesforce/SL Query antes de commit** — no
documentado como cerrado hasta esa validación.

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

   **Criterio de F5h (histórico, ya no es el vigente)**: Adverse filtraba solo por `status='adverse'` Y Est. Closing Date dentro del rango activo — sin `Loan Status` ni `Loan Folder`. El filtro por `Loan Status='Application withdrawn'` fue el diseño original de F4i; se descartó en F5h porque excluía Adverse legítimos con otros motivos (Application denied, File Closed for incompleteness, y hasta casos con `Loan Status` desincronizado tipo "Active Loan" a pesar de `Stage=Closed Lost`).

   **Criterio actual (desde F5j/F5m, confirmado contra `adverseInRange` en `page.tsx` en la Etapa UX8 -- este párrafo estaba desactualizado y se corrige acá):**
   1. `status === 'adverse'`.
   2. La fecha efectiva es `firstSeenAsAdverse` (F5g, primera vez que ese préstamo se vio como adverse en algún snapshot) — o, si es `null` ("recién visto por primera vez"), la fecha del snapshot activo. Ya **no** es Est. Closing Date, y el rango ya **no** es Pipeline Range: es el **Forecast Month** elegido (mismo mes que usa Cerrados).
   3. Brokered: se excluyen los que están en Loan Folder = "Current Prospects" (F5m) — **esto SÍ vuelve a filtrar por Loan Folder**, al revés de lo que decía este párrafo antes de esta corrección.
   4. Banked - Retail: se excluyen los que no tienen Est. Closing Date (F5m).

   Con el criterio de F5h, un caso como el de arriba ya aparecería en Adverse sin necesidad de ninguna alerta extra; con el criterio actual también, salvo que caiga en alguna de las 2 exclusiones de F5m.
9. **`BranchForecastRow.bucketTotal`/`.bucketHealthy` son vestigiales para Brokered — riesgo activo para cualquier componente nuevo.** Ese tipo (definido en `PivotTable.tsx`) está tipado fijo a `BucketCounts`, el esquema de Banked (`Started`/`Processing`/`Underwriting`/`Closing`). `page.tsx` los calcula con `countByMilestoneBucket()` sin importar el canal, así que para una fila de canal Brokered esos 2 campos quedan con las keys y los valores de la clasificación de Banked — **no** los reales de Brokered (`FileCreation`/`AppDate`/`Processing`/`Submitted`). No es un bug nuevo (viene desde F5i, documentado ahí), pero cobra importancia recién ahora que `TabMilestoneMatrix.tsx` (F6) necesitó datos de bucket por branch: cualquier componente que lea `bucketTotal`/`bucketHealthy` directo de una fila Brokered va a mostrar datos incorrectos con etiquetas de Banked. **La forma correcta**: recalcular desde `row.loans` con `countByBrokeredMilestoneBucket()` (`aggregate.ts`, ya exportada) -- ver `bucketsForRow()` en `TabMilestoneMatrix.tsx` para el patrón ya implementado. Arreglarlo de raíz (que `BranchForecastRow` tenga un shape específico por canal) requeriría tocar `PivotTable.tsx`, fuera de alcance hasta ahora.
10. **`BANKED_MATRIX_COLUMNS` (`TabMilestoneMatrix.tsx`) está acoplado a mano con `MILESTONE_BUCKET` (`lib/pipeline/sources/salesforce-file.ts`) — sin ninguna referencia en código que los mantenga sincronizados.** Ajuste posterior a F6: la matriz Branch x Milestone desagrega el bucket `Underwriting` de Banked (que colapsa `Submittal`/`Initial Decision`/`Resubmittal`) en 3 columnas de vista, contando a mano sobre `rawMilestone` de cada préstamo (`bankedRawMilestoneCount()`) -- el cálculo de pull-through no cambió, sigue usando `bucketTotal.Underwriting`/`bucketHealthy.Underwriting` con la tasa combinada. El array `BANKED_MATRIX_COLUMNS = ['Started', 'Processing', 'Submittal', 'Initial Decision', 'Resubmittal', 'Closing']` está copiado a mano de `MILESTONE_BUCKET` -- si el parser agrega/quita un valor de `Current Milestone` dentro de Underwriting, `BANKED_MATRIX_COLUMNS` queda desactualizado en silencio (no rompe el build, solo deja de mostrar/cuenta mal una columna). No se resolvió leyendo dinámicamente de `MILESTONE_BUCKET` porque `sources/salesforce-file.ts` estaba fuera de la lista de archivos permitidos en esa etapa.
11. **`BROKERED_COLUMN_TO_RAW_MILESTONE` (`TabMilestoneMatrix.tsx`) es el mismo tipo de acoplamiento manual que el riesgo 10, pero contra `BROKERED_MILESTONE_BUCKET` (`lib/pipeline/aggregate.ts`, constante privada del módulo, no exportada).** Ajuste posterior: al hacerse clickeable cada celda de la matriz (para abrir `LoanDetailModal` con la lista real de préstamos de esa columna), hizo falta filtrar préstamos individuales de Brokered por `rawMilestone` -- `countByBrokeredMilestoneBucket()` (sí exportada) solo devuelve conteos agregados, no permite filtrar por préstamo. Como `aggregate.ts` estaba fuera de la lista de archivos permitidos en esa tarea (no se podía exportar `BROKERED_MILESTONE_BUCKET` ni agregar una función de filtro ahí), se copió el mapeo a mano en `TabMilestoneMatrix.tsx`, verificado línea por línea contra el código real antes de escribirlo: `Started->FileCreation`, `Processing->Processing`, `Submittal->Submitted` (`AppDate` no tiene ningún `rawMilestone` real que mapee ahí, columna siempre en 0). Mismo riesgo que el ítem 10: si `BROKERED_MILESTONE_BUCKET` cambia en `aggregate.ts`, esta copia queda desactualizada en silencio.

### Etapa F5j — pull-through plano del 40% para Brokered (Banked sin cambios)

El commit `ad86013` había desactivado la cascada propia de Brokered (F5i) dejando
`forecastTotal = healthy.length` -- un paso intermedio, no la regla final. F5j la reemplaza:
para Brokered, **Pull-through = 40% plano sobre el Total de préstamos abiertos** (no sobre
Healthy -- cambio de población además de tasa), en toda la app. `Forecast Brokered = round(Total
× 0.40) + Closed Brokered`. **Banked no se tocó**: misma cascada de siempre
(`calculateForecast` + `PULL_THROUGH_RATES` sobre Healthy), verificado que el valor calculado
(decimal) es idéntico antes/después -- ver "Redondeo" abajo para lo único que sí cambia en
Banked (el display).

- **`BROKERED_FLAT_PULL_THROUGH_RATE = 0.4`** (`lib/pipeline/aggregate.ts`), constante nombrada,
  junto a `BROKERED_PULL_THROUGH_RATES`. `BROKERED_PULL_THROUGH_RATES` y
  `calculateBrokeredForecast()` quedan **código muerto** (marcado en comentario, no borrado --
  así lo pidió el brief, para no ampliar el radio del cambio). **`countByBrokeredMilestoneBucket()`
  NO es código muerto** -- pese a que el brief la mencionaba junto a las otras dos, sigue
  activa en dos lugares: `page.tsx` (conteos Total/Healthy que muestra la cascada) y
  `TabMilestoneMatrix.tsx` (`bucketsForRow()`, la matriz Branch × Milestone). Se dejó sin
  marcar, con esta nota en vez de la marca que pedía el brief literalmente.

- **Redondeo (Cambio 4, "en toda la app"):** se redondea por fila y se suma ya redondeado, no al
  revés -- así las columnas visibles siempre cuadran. Se implementó en un solo punto de
  `page.tsx` (donde se arma `forecastTotal` por branch, y donde se arma `brokeredForecastByBucket`
  por milestone-bucket para la cascada), sin tocar `PivotTable.tsx` ni `MilestoneCascade.tsx`
  (ninguno de los 2 está en el alcance de esta etapa): como el `closedCount` que suman esos 2
  componentes ya es entero, `round(closedCount + x) === closedCount + round(x)` para cualquier
  `x` -- adelantar el redondeo en `page.tsx` no cambia ninguna celda individual, solo hace que
  los subtotales/totales hereden "sumar filas ya enteras" sin tocar esos archivos. Confirmado
  con Isabella antes de aplicarlo a Banked: esto es redondeo de **display**, no de cálculo -- el
  valor calculado de Banked (con decimales) es idéntico antes y después, ver la tabla de
  verificación abajo.

- **Truco del `rate` en la cascada de Brokered (`MilestoneCascadeRow`, `page.tsx`):**
  `MilestoneCascade.tsx` (fuera de alcance) calcula la columna "% applied" como el producto de
  `rate` desde esa fila hasta el final -- un modelo de embudo secuencial que ya no aplica. Con
  las 4 filas en `0.4` literal, esa columna mostraría `40%×40%×40%×40%=2.56%` en File Creation
  en vez de 40%, un número activamente incorrecto. Se pone `rate=1` en las primeras 3 filas y
  `rate=0.4` solo en la última (Submitted) -- el producto acumulado desde cualquier fila da
  exactamente 0.4, así que las 4 muestran "40.0% applied" correctamente sin tocar
  `MilestoneCascade.tsx`. El cuadro de Pull-Through Rates al pie del tab (`brokeredRates`, prop
  de `TabMilestoneMatrix`) es un valor **distinto** y sí es 0.4 literal en las 4 -- ese cuadro
  muestra la tasa cruda, no un acumulado, y por eso repite "40.0%" cuatro veces (ver
  "Pendiente/propuesta" abajo).

- **Hallazgo de coherencia entre pestañas -- resuelto en F5j-b, ver esa sección abajo.**
  Executive Branch Forecast redondeaba por **branch**; Milestone Pipeline Matrix redondeaba por
  **milestone bucket** -- dos particiones distintas del mismo total, con arrastre de redondeo
  distinto. Verificado contra el snapshot activo del 2026-08-12 (id 28, 19 préstamos Brokered
  abiertos): el subtotal de PT de Executive daba **6**, el de Matrix **8** -- no coincidían. El
  Forecast final (con Closed) coincidía en ese snapshot puntual por coincidencia numérica, no
  por corresponder a la misma cuenta (Matrix nunca sumaba Closed). Reportado sin ajustar para
  que cerrara -- la corrección de fondo es F5j-b.

- **`SummaryCards.tsx` -- el texto que el brief F5j daba por existente
  (`Forecast = On Track Loans after PT + Closed`) no está en esta rama** (esa redacción
  pertenece a una etapa posterior de UX que corrió en paralelo, no fusionada acá todavía). Se
  aplicó el espíritu del pedido sobre el texto real de esta rama (`Banked: X | Brokered: Y`):
  se sacó el `.toFixed(1)` (enteros, Cambio 4) y se agregó una nota nueva y discreta
  (`.kpi-hero__note`, `forecast-visual.css`) aclarando el 40% plano de Brokered.

**Pendiente/propuesta, no decidida acá:** el cuadro de Pull-Through Rates de Brokered
(`TabMilestoneMatrix.tsx`) va a mostrar "40.0%" cuatro veces (File Creation/App Date/
Processing/Submitted) -- técnicamente correcto pero repetitivo, porque ese cuadro fue diseñado
para una tasa distinta por etapa. Una alternativa: para Brokered, reemplazar la grilla de 4
tarjetas por una sola línea ("Flat pull-through: 40% on open pipeline (Total)"). No implementado
-- el brief pide proponerlo, no decidirlo.

### Etapa F5j-b — una sola partición manda para el forecast de Brokered

F5j (arriba) redondeaba el forecast de Brokered en 2 lugares independientes -- por branch
(Executive) y por milestone-bucket (Matrix) -- y cada partición arrastra el redondeo distinto:
no es un bug de una fórmula puntual, es aritmética (redondear-y-sumar da resultados distintos
según cómo se agrupen las filas antes de sumar). Este ajuste elimina la posibilidad de que
diverjan, en vez de solo reportarlo.

**La regla:** el total por branch (`page.tsx`, ya redondeado por fila) es la **única fuente de
verdad** para el forecast de Brokered. Ninguna otra vista lo recalcula -- si necesita un
desglose, **reparte** ese total fijo, nunca lo vuelve a calcular multiplicando por 0.4.

- **`apportionByWeight(total, weights)`** (`lib/pipeline/aggregate.ts`, nueva) -- reparte un
  entero ya fijado entre N categorías en proporción a un peso, garantizando por construcción que
  la suma de las partes sea exactamente el total recibido. Método de mayor resto (Hamilton
  apportionment): piso de la porción proporcional exacta por categoría, y el resto entero que
  falta se reparte de a 1 empezando por las categorías con mayor parte fraccionaria descartada.
  Determinista. `page.tsx` la usa para repartir `brokeredSummary.forecastTotal` (el total por
  branch) entre los 4 buckets de milestone, en proporción a su conteo Total -- ya no se calcula
  `Math.round(bucketTotal.X * 0.4)` por bucket, que era la causa raíz de la divergencia.
- **`TabMilestoneMatrix.tsx`** ahora recibe `brokeredClosedCount`/`brokeredTotalForecast` (props
  nuevas, ambas obligatorias) y se las pasa a `MilestoneCascade` **solo cuando el canal activo es
  Brokered** -- ese componente ya traía el mecanismo (`closedCount`/`totalForecast` opcionales,
  agrega una fila "Closed (Funded)" y cambia el rótulo de la fila de total a "Total Forecast
  (Closed + Projection)") sin que hiciera falta tocarlo. Banked sigue sin pasarlos, sin cambios:
  su cascada sigue mostrando solo la proyección.
- El foot-note debajo de la cascada de Matrix ahora es distinto por canal: Banked conserva el
  texto de siempre ("does not include already-closed loans"); Brokered dice explícito que su
  total ya incluye Closed y coincide con Executive -- el texto viejo dejó de ser cierto para ese
  canal.

**Verificado, no asumido** (snapshot activo id 28, 2026-08-12, y un caso sintético adversarial
de 11 branches con 1 préstamo cada uno, todos en el mismo milestone-bucket -- el peor caso
posible para la divergencia vieja): en ambos, Executive y Matrix dan ahora el mismo número
(8 y 8; 0 y 0 en el caso adversarial, donde antes daba 0 contra 4). Banked verificado idéntico
antes/después, cálculo y display.

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

### Etapa UX6 — canvas más angosto y celdas más ajustadas

- **Canvas de 1440 → 1380px** con 32px de padding lateral (antes 24). `--container-max` lo
  consumen tanto `.hub-container` como `.hub-header__inner`, así que el logo del header sigue
  alineado con el contenido de la página.
- **Padding de celda de vuelta a `6px 10px`** (UX5 lo había subido a `8px 16px`). Con el canvas
  más angosto, 16px laterales se comían demasiado espacio de contenido — el padding va *dentro*
  del ancho de la columna con `table-layout: fixed`. El override propio del modal se eliminó:
  ahora hereda el mismo ritmo que el resto.
- **Alineación**: las 4 columnas de métrica centradas en encabezado, datos y fila de total;
  Branch y Branch Manager a la izquierda. Verificado sobre el HTML renderizado, celda por celda.

#### El `min-width` había que recalcularlo, no sólo copiarlo

Los dos pedidos de esta etapa interactúan y nadie lo había notado. Al angostar el canvas, cada
tabla de canal pasa a medir `(1380 − 64 − 20 de gap) / 2 = 648px`, y el `min-width: 650px` que
venía de UX5 **metía barra horizontal en un viewport de 1440 por 2 píxeles**. Se bajó a
**620px**.

A 648px reales la columna de métrica mide `648 × 0.14 = 90.7px`, así que el mínimo de 90px que
pedía el brief anterior se cumple igual sin forzarlo; el `min-width` sólo entra en juego en
viewports más chicos, donde el piso pasa a ser 87px por columna.

---

## Etapa AUTH1 — login con Supabase Auth

Se cerró la seguridad a nivel de base en `simoOS-prod`: permisos de `anon` revocados en
`activity_report` y `pipeline_forecast`, RLS activo en las 8 tablas, y políticas que exigen
**sesión autenticada + `"commercial_activity"` en `app_metadata.allowed_apps`**. La app usaba la
anon key sin sesión, así que toda lectura/escritura pasó a fallar.

Patrón tomado del repo hermano **homesi-pl** (rama `feature/user-authentication`): mismo
proyecto de Supabase, mismos usuarios, mismo criterio de permiso por app. No se creó ningún
sistema de auth propio.

### Decisión de dónde vive el gate

Se eligió **`proxy.ts`** (middleware) por encima de un guard en el layout raíz:

1. Toda ruta pasa por ahí, así que las páginas quedan protegidas **por existir**. Un guard en el
   layout sólo cubre lo que ese layout envuelve, y no cubre las API routes.
2. Corre **antes** de renderizar. Un guard de cliente pinta la página, corre el efecto y recién
   ahí redirige — un parpadeo de contenido para quien no debería verlo.
3. Es el único punto que puede **refrescar el token**, porque necesita escribir cookies en la
   respuesta.

Eso obliga a que la sesión viva en **cookies** y no en localStorage (el servidor no ve
localStorage), y por eso el cliente pasó de `createClient` a `createBrowserClient`
(`@supabase/ssr`, dependencia nueva — la misma que usa homesi-pl).

Se llama `proxy.ts` porque Next 16 renombró la convención; soporta las dos
(`PROXY_FILENAME`/`MIDDLEWARE_FILENAME`, verificado en `next@16.2.12`).

### Un solo cliente para los dos schemas

`app/pipeline/page.tsx` creaba su propio cliente para `pipeline_forecast`, porque
`lib/supabase/client.ts` está fijo a `activity_report`. Con autenticación eso pasó a ser un
problema real: dos instancias de GoTrue compitiendo por la misma sesión. Se resolvió con
`getForecastDb()`, que apunta el **mismo** cliente al otro schema vía `.schema()`.

El JWT viaja solo: `signInWithPassword` deja la sesión en ese cliente y supabase-js adjunta el
access token en cada request. Si el login se hiciera con otra instancia, la app seguiría
consultando como `anon`.

### API routes

Las 3 que llama el navegador (`/parse`, `/latest`, `/adverse-history`) pasaron a construir su
cliente desde las **cookies de la request** (`lib/supabase/server.ts`), o sea con la sesión de
quien llamó. Al ser same-origin la cookie llega sola: no hizo falta `service_role` ni pasar el
token a mano.

### El cron de retención se movió a `pg_cron` (resuelto)

`/api/pipeline/retention` era un cron de Vercel: corría sin navegador, sin cookies y sin
usuario, así que ningún cliente basado en sesión podía funcionar ahí. Con RLS activo sus
UPDATE/DELETE habrían fallado y la retención de 90 días habría dejado de ejecutarse en silencio.

De las tres salidas posibles se eligió **mover la tarea a `pg_cron` dentro de Supabase**: corre
en la base, no pasa por PostgREST, y por lo tanto RLS no interviene — sin meter ninguna
`service_role` key en las variables de entorno del proyecto.

**Se eliminaron del repo** `app/api/pipeline/retention/` y `vercel.json` (sólo contenía esa
entrada de cron), y `CRON_SECRET` dejó de usarse.

El SQL está versionado en **`docs/sql/2026-08-retention-pg-cron.sql`**, idempotente y listo para
ejecutar en el SQL Editor. Puntos que no son obvios y quedaron documentados ahí:

- **La función NO vive en `pipeline_forecast`.** Ese schema está expuesto a PostgREST, así que
  toda función que viva ahí queda publicada como endpoint RPC. Siendo `SECURITY DEFINER`, eso
  sería justo el agujero que se acaba de cerrar. Va en un schema `maintenance` que no se expone,
  y además se le revoca `EXECUTE` a `public`/`anon`/`authenticated` — Postgres lo otorga a
  PUBLIC por defecto en toda función nueva.
- **`set search_path = ''`** con todos los nombres calificados: sin eso, en una función
  `SECURITY DEFINER` quien la llame puede anteponer un schema propio y secuestrar un nombre.
- **Equivalencias exactas con el endpoint**: primero/último snapshot del mes por `min(id)`/
  `max(id)` (orden de inserción, no `snapshot_date`, porque puede haber varias cargas el mismo
  día); `is_month_end` nunca se marca para el mes en curso; fechas en UTC; se marca antes de
  borrar para que lo recién marcado quede protegido; el borrado exige `= false` estricto (una
  fila con NULL nunca se borra, igual que el `.eq(campo, false)` de PostgREST); y los hijos se
  borran antes que el padre, sin depender de `ON DELETE CASCADE`.
- **Mismo horario**: `0 9 * * *`. Vercel Cron y pg_cron en Supabase corren los dos en UTC.

### Fuera de alcance, deliberadamente

- **Permisos por rol dentro de la app** (fase 2).

*(`must_change_password` estaba acá como fuera de alcance; se implementó en AUTH2, abajo.)*

---

## Etapa AUTH2 — cambio obligatorio de contraseña

Mismo patrón que homesi-pl: quien entra con una contraseña temporal no puede usar la app hasta
elegir la suya. El flag es `app_metadata.must_change_password`.

### Por qué hizo falta romper una regla previa

`app_metadata` sólo lo escribe el `service_role` — que es exactamente por qué el flag vive ahí:
si estuviera en `user_metadata`, cualquiera se lo bajaría desde el navegador y se saltearía el
cambio. La contrapartida es que **liberarlo exige privilegios que el cliente no tiene**.

Hasta AUTH1 la app no usaba `service_role` en ningún lado, y `.env.example` decía explícitamente
"NUNCA en las variables de entorno de Vercel". **Eso cambió**: `SUPABASE_SERVICE_ROLE_KEY` ahora
es obligatoria en producción. Sin ella, quien tenga contraseña temporal la cambia pero no se
desbloquea, y queda girando en `/change-password`.

La excepción está acotada a un solo archivo (`lib/supabase/admin.ts`), importado por una sola
ruta. Verificado en 4 niveles antes de habilitarla en Vercel — el decisivo: el valor de la clave
aparece en **0 de 38** archivos de `.next/static`, que es lo que se sirve al navegador.

### Piezas

| Archivo | Rol |
|---|---|
| `app/change-password/page.tsx` | Formulario. Port visual de homesi-pl a `auth.css`. |
| `app/api/auth/complete-password-change/route.ts` | Baja el flag con `service_role`. |
| `lib/supabase/admin.ts` | **Único** punto de la app con `service_role`. |
| `lib/auth/session.ts` | Resuelve quién llama, desde la cookie y con la anon key. |

### Dos pasos, y el orden importa

1. La contraseña la cambia **la propia sesión** del usuario (`auth.updateUser`).
2. El flag lo baja **la API route**, con `service_role`.

Si el paso 2 falla, la contraseña ya quedó cambiada y la persona sigue bloqueada: puede
reintentar y el paso 1 vuelve a aplicarse. Es la dirección segura en la que fallar; lo inverso
—liberar el flag y que el cambio no se aplique— dejaría a alguien adentro con la temporal.

El usuario **siempre** se resuelve desde la cookie de sesión, nunca del body: si no, cualquiera
con sesión podría limpiarle el flag a otra cuenta. La ruta además relee tras escribir, para no
reportar éxito si el flag quedó puesto, y excluye `provider`/`providers` del `app_metadata` que
reenvía (mismo problema que se corrigió en `grant-app-access.mjs`).

### El gate

El chequeo va **después** de `allowed_apps`: obligar a alguien a elegir contraseña para una app
que después no va a poder abrir es trabajo inútil. `PASSWORD_CHANGE_ROUTES` exime a la página
**y a la API route** — sin esa segunda exención, la llamada que desbloquea nunca podría salir y
la persona quedaría encerrada de forma permanente.

Ajuste hecho durante la verificación: el chequeo estaba después de la regla "tenés acceso, andá
a la landing", así que `/no-access` daba 2 saltos. Se movió más arriba; ahora es 1.

### Detalle que conviene recordar

El gate usa `getUser()`, que **valida contra Supabase**, así que lee `app_metadata` fresco de la
base y no del token viejo. El `refreshSession()` de la página es para mantener consistente el
token del cliente, no un requisito para que el gate funcione.

### Estado del proyecto compartido al implementarlo

6 usuarios ya tenían `must_change_password: true` (heredado de cómo homesi-pl crea cuentas), y
**5 de ellos con `commercial_activity`**: son los que quedan forzados a cambiar contraseña al
desplegar. No es un efecto secundario del código, es el dato preexistente — pero conviene
avisarles antes, sobre todo si ya cambiaron su contraseña en Homesí y el flag quedó sin limpiar.

### Riesgo/pendiente que deja esta etapa

### Estilo de las pantallas de auth

Port visual de `app/login/page.tsx` y `app/no-access/page.tsx` de homesi-pl. El original usa
Tailwind y este repo no, así que cada utilidad se tradujo a su valor real en
`app/styles/auth.css` (la tabla de equivalencias está en la cabecera de ese archivo).

**No hay conflicto de paleta**: `--navy`, `--coral` y `--canvas` de `tokens.css` ya eran
exactamente `#001A40` / `#FF4040` / `#FCFCFA`, los mismos hex que usa homesi-pl. El logo sí
difiere a favor de esta app: acá es un PNG con transparencia real
(`public/brand/homesi-lockup.png`), mientras homesi-pl usa el JPG con fondo blanco.

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

## Etapa UX7 — desglose Banked/Brokered en el banner de KPIs

Cambio puramente de presentación en las 4 tarjetas del banner ejecutivo de Forecast &
Pipeline (`Total Pipeline` / `Healthy Pipeline` / `Closed` / `Total Forecast`). Ningún
cálculo nuevo: `SummaryCards.tsx` ya recibía `banked`/`brokered` como props (`SummaryBlock`
completo) desde F5i, pero solo consumía `totalForecast` de cada uno para el subtítulo de la
última tarjeta. Los otros seis valores (`totalCount`/`healthyCount`/`closedCount` de cada
canal) estaban disponibles y sin usar.

- Se agregó `ChannelSplit`, un subcomponente local a `SummaryCards.tsx` que renderiza
  "Banked | Brokered" debajo del número combinado de cada tarjeta.
- Clases nuevas en `app/pipeline/styles/forecast-visual.css`
  (`.kpi-hero__split*`): no se tocó `.mcard`/`.kpi-hero__*`/`components.css`, que siguen
  siendo compartidos con Commercial Activity.
- **Asimetría deliberada de redondeo**: las 3 primeras tarjetas son conteos enteros
  (`fmtInt`) y el desglose siempre suma exacto al combinado. `Total Forecast` es
  fraccionario y conserva 1 decimal en el desglose (`toFixed(1)`), aunque el número grande
  se muestre redondeado (`fmtRounded`) — por eso puede leerse `38.1 + 4.3 = 42.4` con un
  titular de `42`. Redondear cada canal a entero generaría casos donde las partes no sumen
  el total mostrado.
- `Total Forecast` además: desglose con tipografía más grande
  (`.kpi-hero__split--lg`, 19px vs. los 11px de `.kpi-hero__sub`) y subtítulo nuevo fijo:
  `Forecast = On Track Loans after PT + Closed`.
- Responsive: a 480px o menos el desglose pasa de lado-a-lado a apilado
  (`.kpi-hero__split` en columna, divisor oculto) — `.hero-banner` ya colapsaba a 2 columnas
  a los 900px definidos en `components.css`, sin cambios ahí.
- `page.tsx`, `lib/**` y `components.css` quedaron sin modificar; `summarizeChannel()` (F4f)
  sigue siendo la única fuente de estos números.

---

## Etapa AC1 — tarjetas de resumen por branch + etiquetas completas (Commercial Activity)

Dos bugs de Commercial Activity, sin tocar `lib/aggregation/buildReportTree.ts` ni
`lib/export/**`.

### Bug 1 — las tarjetas ("Monthly Totals") no reaccionaban al filtro de Branch

Causa: `SummaryCards.tsx` leía `tree.total.maps`, y ese nodo de `ReportTree` se calcula
sobre *todos* los records sin filtrar por `branchFilter` — a propósito, porque también
alimenta la fila Total del pivot y los totales del Excel exportado
(`lib/export/sheetBuilders.ts`). Cambiarle la semántica a `tree.total` era la trampa obvia
y quedó fuera de alcance a propósito.

Arreglo, todo en el lado de lectura:

- `SummaryCards` suma una prop opcional `branchFilter?: Branch | 'all'` y una función interna
  `resolveMaps(tree, branchFilter)` que, con un branch específico, arma el
  `Record<MetricKey, MetricMap>` a partir de `tree.branches[].metricGroups` (la misma fuente
  que ya usa `PivotTable` para sus filas) en vez de `tree.total.maps`. Sin cálculo nuevo: solo
  reindexa una estructura que `buildReportTree` ya entrega.
- Un branch sin actividad en el rango de meses visible no aparece en `tree.branches`
  (`buildReportTree` lo descarta cuando su total da cero) — `resolveMaps` devuelve mapas
  vacíos en ese caso, que renderizan como 0 en todas las métricas. Es el resultado correcto
  para "branch sin datos en este rango", no una caída silenciosa al total global.
- `app/page.tsx` pasa `branchFilter={view === 'loanOfficer' ? 'all' : branchFilter}`. La
  vista "Por Loan Officer" cruza todos los branches a propósito (el Toolbar oculta ahí el
  selector de Branch, ver comentario en `Toolbar.tsx`) pero el `branchFilter` en estado puede
  seguir apuntando a un branch elegido en una vista anterior — se neutraliza en el único
  call site en vez de enseñarle a `SummaryCards` sobre la vista activa.
- Los badges de `<Trend>` no se tocaron: ya recibían el mismo objeto `maps` que arma
  `resolveMaps`, así que las flechas de tendencia siguen automáticamente la serie del branch
  elegido en vez de la global.

Verificado con un dataset chico de 2 branches x 2 meses corrido contra `buildReportTree` real
(sin fixture de producción disponible en este entorno): con un branch específico, la tarjeta
coincide mes a mes con `branch.metricGroups[].total` (la misma fuente que alimenta la fila de
ese branch en el pivot); con `'all'` vuelve al combinado; un branch sin actividad da ceros; y
la vista Loan Officer ignora el `branchFilter` residual.

### Bug 2 — etiquetas de métrica cortadas ("File Creatio...", "Credit Rep...")

Causa: `.kpi-row__label` tenía `white-space: nowrap` + `overflow: hidden` +
`text-overflow: ellipsis`, y `.kpi-row__right` (valor + badge) tiene `flex-shrink: 0` — la
etiqueta era la única que podía encogerse, así que absorbía el recorte. Se notaba en todos
los meses salvo el primero, porque `<Trend>` no dibuja badge cuando no hay mes anterior con
el que comparar, y esos ~20px de más alcanzaban para no cortar.

Arreglo (`app/styles/components.css`, reglas `.kpi-row*` — confirmado por grep que sólo las
usa `components/report/SummaryCards.tsx`; Forecast usa sus propias `.kpi-hero__*`/
`.hero-banner`, sin relación):

- Se sacaron las 3 propiedades de recorte. Sin `overflow: hidden` ni `text-overflow`, el
  navegador no tiene forma de truncar aunque el texto no entre en una línea — se garantiza
  estructuralmente que el nombre completo siempre se ve, en vez de depender de que alcance el
  ancho justo en cada fuente/breakpoint.
- `.kpi-row` pasa de `align-items: center` a `flex-start`: con la etiqueta pudiendo ocupar 2
  líneas, centrar el valor+badge contra todo el bloque de texto los desalineaba hacia abajo.
  `.kpi-row__right` suma `padding-top: 1px` para calzar con la primera línea pese a la
  diferencia de `line-height` entre el label (11px) y el valor (12px).
- `.mcard` (compartida con Forecast) no se tocó. Confirmado visualmente que el banner de
  `/pipeline` no cambió: mismo screenshot de `.hero-banner` antes y después de este cambio.

Verificado con Playwright headless contra los 3 cortes de `.kpi-strip` (>1240px → 8
columnas, 1240px → 4, 680px → 2) y además forzando 12 columnas para ver el wrap en el caso
más apretado posible: en ningún ancho aparece texto cortado, y el valor+badge quedan alineados
con la primera línea de la etiqueta incluso cuando ésta ocupa dos.

### Pendiente explícito, no resuelto acá

Falta confirmar con el negocio si además hay que renombrar la métrica `App Date` a
`Applications` (afecta también los rótulos de fila del Excel exportado, `config/metrics.ts`
es fuente única). Fuera de alcance de esta etapa a propósito.

---

## Etapa UX8 — columnas de Forecast desglosadas, total por fila en Pipeline by Milestone, explicación de Adverse

Cuatro cambios de presentación en Forecast & Pipeline, sin tocar `lib/pipeline/aggregate.ts`.

### Parte 1 — Executive Branch Forecast: nuevo orden + desglose

Orden de columnas, antes `Branch | Branch Manager | Closed | Total Pipeline | Healthy Pipeline
| Forecast`, pasa a `Branch | Branch Manager | Total Pipeline | Healthy Pipeline | Closed |
Projected to Close | Forecast` — Closed se mueve adentro de un grupo "Forecast" (barra
agrupadora nueva, colSpan=3, `<thead>` con 2 filas) junto a una columna nueva, **Projected to
Close** (= `branchForecastRow.forecastTotal`, ya calculado — sin cálculo nuevo). El título
completo ("Open pipeline loans (Total) projected to close after applying pull-through --
before adding Closed.") va en el `title` de esa `<th>`.

`ExecColgroup`/`ExecHead`/`ExecTotalRow`/`BranchDataRow` son compartidas por los 3 bloques
(Banked, Brokered, Combined Total by Branch) — confirmado leyendo el archivo antes de asumirlo
(el 3er bloque, "Combined Total by Branch", arma sus filas con JSX inline, no con
`BranchDataRow`, pero usa el mismo `ExecColgroup`/`ExecHead`/`ExecTotalRow` compartido) — un
solo cambio alcanzó para los 3.

`BranchRow`/`BlockSubtotal`/`CombinedBranchRow` suman un campo nuevo, `projectedToClose` (=
`branchForecastRow.forecastTotal` de cada fila, reexpuesto, no recalculado). `col-closed` (el
grupo propio que tenía Closed) queda sin consumidores -- se retiró de `forecast-visual.css`.

**Hallazgo, corregido de paso:** el foot-note bajo la tabla decía *"the Combined Total is
calculated from the underlying decimal values before rounding, so it may differ by a small
margin from the sum of the rounded subtotals"* — cierto en F5j-a, pero ya no: desde F5j-b
`forecastTotal` se redondea por fila de branch en `page.tsx` antes de llegar acá, así que todo
subtotal (de canal o Combinado) es ya la suma exacta de filas enteras. Se reemplazó el texto en
vez de dejar una afirmación que esta misma etapa demuestra falsa.

Verificado con datos reales (snapshot activo, 2026-08-12): Closed + Projected to Close =
Forecast en cada fila, y los subtotales de las 2 columnas nuevas son la suma exacta de las
filas, en Banked, Brokered y Combinado — sin excepciones.

**Ancho de columnas** — con una columna más (7 en vez de 6), `.piv col.metric-col` baja de 14%
a 11.2% (Branch/Manager quedan igual, 12/32). Repetir el piso de 90px por métrica de UX5/UX6
pediría 804px de mínimo por tabla, muy por encima de los ~648px reales que le tocan a cada tabla
de canal en el layout de 2 columnas — forzaría scroll horizontal siempre, no solo en pantallas
chicas. Se relaja a 75px (670px de mínimo). Verificado con Playwright: sin scroll a ≤900px
(`.channel-grid` ya colapsó a 1 columna, cada tabla tiene ancho completo) y a ≥1440px; entre
~1150 y ~1350px cada tabla de canal SÍ necesita scroll horizontal propio (nunca del body) para
ver Projected to Close/Forecast completos -- es el trade-off real de agregar una columna, no un
bug; capturas del antes/después de scrollear en el reporte de esta etapa.

### Parte 2 — Renombre de pestaña

"Milestone Pipeline Matrix" → "Pipeline by Milestone". **El brief decía que el rótulo vivía en
`app/pipeline/page.tsx` — no es así:** el texto real está en `app/pipeline/TabNavigation.tsx`
(`TABS` array), un archivo que no estaba en la lista de "se puede tocar" de esta etapa. Se
corrigió ahí de todos modos porque es inequívocamente el mismo cambio que pedía el brief (el
texto visible del botón de esa pestaña), solo que en el archivo correcto -- confirmado
buscando el string viejo en todo el repo antes de dar por terminado (apareció también en un
comentario de `TabMilestoneMatrix.tsx` y en 3 lugares de este documento, todos actualizados).

### Parte 3 — Total por fila en Pipeline by Milestone

La matriz Branch × Milestone (`TabMilestoneMatrix.tsx`) suma una columna final "Total" (ancho
fijo 12%, el resto se reparte entre los milestones) con la clase `totcol` que ya usa
`PivotTable.tsx` para su columna de total -- mismo lenguaje visual, no un milestone más. El
total de cada fila es la **suma de lo que esa fila muestra** (los `milestoneKeys` visibles), no
`row.totalCount`/`row.healthyCount`: para Brokered esos 2 números pueden diferir si hay algún
préstamo con un `rawMilestone` que no mapea a ningún bucket conocido (riesgo ya documentado
arriba, `BROKERED_MILESTONE_BUCKET`) -- sumar lo mostrado es lo único que garantiza que el
total de la fila cuadre con las columnas de esa misma fila, siempre. No existía una fila de
totales por columna en esta tabla (se verificó antes de asumir que hacía falta cuadrar una
celda de esquina) -- no se agregó una, no la pedía el brief.

### Parte 4 — Texto introductorio en Adverse & Risk Loans

**Hallazgo:** el criterio documentado en este archivo (§"Criterio actual (desde F5h)", más
arriba) estaba desactualizado -- describía el filtro de F5h (`status='adverse'` + Est. Closing
Date en Pipeline Range, sin `Loan Folder`), pero el código real (`adverseInRange` en
`page.tsx`) hace tiempo que corre con el criterio de F5j/F5m: `firstSeenAsAdverse` dentro del
**Forecast Month** (no Est. Closing Date en Pipeline Range), más 2 exclusiones por canal
(Brokered: fuera `Loan Folder='Current Prospects'`; Banked: fuera si no tiene Est. Closing
Date) -- la afirmación *"ya no se filtra... por Loan Folder"* es exactamente lo contrario de lo
que hace el código hoy para Brokered. Se corrigió esa sección más arriba en vez de dejarla
como estaba.

El texto de `AdverseTable.tsx` se escribió a partir del código corregido, no de la
documentación vieja: explica que la tabla lista préstamos `status='adverse'` cuya primera
detección como tal cae dentro del Forecast Month elegido, y qué significa "New this period".
Las 2 exclusiones por canal (Current Prospects / Est. Closing Date) quedaron fuera del texto
de la UI por espacio (2-3 frases pedidas) -- documentadas acá en cambio.

---

## Etapa UX9 — ajustes de tablas y tarjetas en Forecast

Siete ajustes de presentación en Forecast & Pipeline, sin tocar `lib/pipeline/aggregate.ts` ni
`app/api/pipeline/**`. Datos reales del snapshot activo (id 28, Supabase
`eykplgdwlqpybzkzbpmu`, `pipeline_forecast.pipeline_loans`/`pipeline_resolved_loans`, leídos
read-only el 2026-08-12).

### Parte 1 — Tabla ejecutiva: entra sin scroll + se quita la barra "FORECAST"

`.piv col.manager-col` baja de 32% a 18%; los 14 puntos liberados se reparten entre las 5
columnas de métrica (11.2% → 14% cada una) — Branch queda igual (12%), la tabla sigue sumando
100% de ancho, no cambia el ancho total. La fila de agrupación `exec-group-row` ("FORECAST" con
colSpan=3, agregada en UX8) se elimina de `ExecHead` (`PivotTable.tsx`) y de
`forecast-visual.css` — el tinte `emerald-50` + las esquinas redondeadas de `col-forecast`
(ya existían) siguen identificando el grupo Forecast sin necesidad de una segunda fila de
`<thead>`.

`.piv--exec { min-width }` baja de 670px a 500px. UX8 solo había verificado sin-scroll a
≤900px y ≥1440px (con scroll propio de la tabla entre ~1150-1350px, documentado ahí como
trade-off). Este ajuste pide explícitamente sin scroll en 1150/1250/1350/1440px — el caso más
angosto (1150px) da (1150-64-20)/2 = 533px reales por tabla de canal, así que el mínimo tenía
que bajar de 670 a ≤533px.

**Verificado con Playwright** (harness con las 3 tablas ejecutivas reales — Banked, Brokered,
Combined — usando las hojas de estilo reales del repo vía `file://` y datos reales de las 12
branches de Banked + 8 de Brokered, snapshot 28):

| Viewport | Banked (`scrollWidth`/`clientWidth`) | Brokered | Combined |
|---|---|---|---|
| 1150px | 531 / 531 | 531 / 531 | 1084 / 1084 |
| 1250px | 581 / 581 | 581 / 581 | 1184 / 1184 |
| 1350px | 631 / 631 | 631 / 631 | 1284 / 1284 |
| 1440px | 676 / 676 | 676 / 676 | 1374 / 1374 |

Sin scroll horizontal en ningún caso (`scrollWidth === clientWidth` en las 3 tablas, en los 4
anchos). Trade-off real, no oculto: con Branch Manager en 18% (95px reales a 1150px en las
tablas de canal), algunos nombres largos (Armando Tejeda, Mariano Claudio, Stephanie García,
Steve Badovinac) activan el recorte con puntos suspensivos que ya existe en `table.piv td`
(`overflow:hidden;text-overflow:ellipsis`, HOTFIX UX2) — el nombre completo sigue disponible en
el `title` de la celda. En la tabla Combined (ancho completo, sin partir en 2 columnas) los 194px
reales de manager-col alcanzan para mostrar todos los nombres completos.

### Parte 2 — Subtotal sin recortar

`ExecTotalRow` (`PivotTable.tsx`) combina Branch + Branch Manager en un solo `<td className="lbl"
colSpan={2}>{label}</td>` — antes el label completo ("Subtotal Brokered", "Combined Total
(Banked - Retail + Brokered)") tenía que entrar en el ancho de la sola columna Branch (12%) y se
recortaba. Verificado en las capturas: los 3 labels de cierre se leen completos en los 4 anchos
probados.

### Parte 3 — "Clear to Close" + totales por columna en Pipeline by Milestone

`labelFromKey()` (`TabMilestoneMatrix.tsx`) agrega una excepción explícita: `'Closing' →
'Clear to Close'`, antes de la transformación genérica por regex. Solo cambia el texto (acá y en
el título del modal de celda, que reusa la misma función) — la key `Closing` de `BucketCounts`
(`aggregate.ts`) y toda la lógica de pull-through no se tocan.

El cálculo por fila (antes inline en el `.map()` del `<tbody>`) se saca a un array
`rowsWithValues` construido antes del JSX, para poder derivar `columnTotals`/`grandTotal` sin
recalcular. Se agrega una fila `<tr className="grp total">` al pie con el total de cada columna
más la celda esquina (`grandTotal`) — reusa el estilo genérico `tr.grp.total td` que ya existe
en `components.css`, sin CSS nuevo.

**Verificado con datos reales** (12 branches de Banked, 8 de Brokered, snapshot 28, metricView
Total):

| Canal | Columnas | Suma de totales por fila | Suma de totales por columna | Celda esquina |
|---|---|---|---|---|
| Banked - Retail | Started 14, Processing 14, Submittal 4, Initial Decision 29, Resubmittal 7, Clear to Close 6 | 74 | 74 | 74 |
| Brokered | File Creation 5, App Date 0, Processing 20, Submitted 0 | 25 | 25 | 25 |

Las 3 cifras coinciden en los 2 canales — reconciliado también programáticamente (no solo a
ojo) leyendo el DOM del harness de verificación.

### Parte 4 — Tarjeta "Closed": de mes a "Projected to close soon"

Se saca el subtítulo de mes (`targetMonthLabel`, "August 2026") y se reemplaza por el conteo de
préstamos del pipeline abierto en milestone Clear to Close/Closing — ya calculado
(`bucketTotal.Closing` de cada `BranchForecastRow`, sumado sobre todas las filas en `page.tsx`),
sin cálculo nuevo. Se suma sobre los 2 canales sin filtrar por channel porque `bucketTotal` es
vestigial para Brokered (usa el esquema de buckets de Banked, que Brokered no puebla) — verificado
contra el snapshot real: ninguna fila Brokered tiene `milestone='Closing'` (0 de 25 préstamos), así
que sumar sin filtrar da el mismo resultado que filtrar por Banked únicamente.

**Real, snapshot 28, `estClosingDate` en pipelineDateRange (2026-07-01 a 2026-09-30):**
`bucketTotal.Closing` = 6 (Banked) + 0 (Brokered) = **6 préstamos** → tarjeta Closed muestra
"6 Loans Projected to close soon".

### Parte 5 — Tarjeta "Total Forecast": subtítulo más chico + nota reubicada

Se agrega el modificador `.kpi-hero__sub--sm` (9.5px, contra 11px de `.kpi-hero__sub` base) al
subtítulo "Forecast = On Track Loans after PT + Closed" -- es lo único que queda como
sub-contenido de la tarjeta, tal como pide el brief. El desglose Banked/Brokered
(`ChannelSplit`) NO se quita -- el brief solo pedía achicar el subtítulo y reubicar la nota, no
quitar el desglose.

La nota "Brokered applies a flat 40% pull-through rate on its open pipeline (Total)." se saca de
`SummaryCards.tsx` (`.kpi-hero__note`, que queda sin consumidores y se borra de
`forecast-visual.css`) y se agrega como `<p className="foot-note">` debajo de la tabla Brokered
en `PivotTable.tsx` -- solo aplica a ese canal, no tenía sentido en una tarjeta que resume los 2.

### Parte 6 — Centrado de las 4 tarjetas del banner

3 reglas nuevas scopeadas a `.hero-banner` (`.mcard { text-align:center }`, `.m-name { justify-
content:center }` -- ya era flex --, `.kpi-hero__split { justify-content:center }`). Verificado
por grep antes de escribirlas: el `SummaryCards` de Commercial Activity no usa `.hero-banner` en
ningún lado, así que no hay riesgo de que se filtren ahí. Mismo orden/estructura de las 4
tarjetas, solo cambia la alineación horizontal del contenido.

### Parte 7 — Renombre de tab: "Executive Branch Forecast" → "Projected Forecast"

Mismo patrón que el renombre de UX8: `TabNavigation.tsx` (`TABS`, el `id` sigue siendo
`'executive'`), el subtítulo de `page.tsx` ("Executive branch forecast, milestone pipeline
matrix..." → "Projected forecast, milestone pipeline matrix..."), y los comentarios/JSDoc de
`PivotTable.tsx`/`TabMilestoneMatrix.tsx`/`forecast-visual.css` que lo mencionaban. Búsqueda del
string viejo en todo el repo antes de dar por terminado: los únicos 3 restantes son narración
histórica de etapas pasadas en este mismo documento (líneas de la sección "Estructura de
carpetas", Etapa F6, y Etapa F5j-b) y el propio encabezado "Parte 1" de la sección UX8 de arriba
-- se dejan como estaban, mismo criterio que UX8 usó para "Milestone Pipeline Matrix".

---

## Etapa UX10 — Pestaña Adverse: renombre, columna Loan Folder, sin resaltado por monto

Cuatro ajustes en `AdverseTable.tsx`/`TabNavigation.tsx`, sin tocar `page.tsx` ni la lógica de
filtro (`adverseInRange`, sin cambios).

### Renombre: "Adverse & Risk Loans" → "Adverse Loans"

**Motivo real:** la tabla filtra únicamente por `status === 'adverse'` -- no existe, ni existió,
ninguna noción de "préstamo en riesgo" en el código. El rótulo viejo prometía una categoría que
no está. Cambiado en `TabNavigation.tsx` (`TABS`, el `id` sigue siendo `'adverse'`) y en el
título de la tarjeta dentro de `AdverseTable.tsx` (antes decía solo "Adverse (N)", ahora
"Adverse Loans (N)"). Búsqueda del string viejo en todo el repo: los 3 restantes son narración
histórica de etapas pasadas en este documento (Estructura de carpetas, Etapa F6, y el propio
encabezado "Parte 4" de la sección UX8) -- se dejan como estaban, mismo criterio de todos los
renombres anteriores (UX8, UX9).

### Columna nueva: Loan Folder

`loan.rawLoanFolder`, ya existente en `ResolvedLoan` (Etapa F5m), se agrega como columna visible
para ambos canales. **Verificado con datos reales** (snapshot 28, `status='adverse'`, Supabase
`eykplgdwlqpybzkzbpmu`): el campo está poblado al 100% (0 filas vacías) en las 258 filas de
Banked - Retail y las 59 de Brokered. Banked muestra siempre "Adverse Loans" (258/258); Brokered
varía: Adverse Loans (46), Current Prospects (8), My Pipeline (4), Unplugged Clean Up (1) -- tal
como anticipaba el brief, confirmado y no asumido.

**Matiz que vale la pena dejar anotado:** el filtro `adverseInRange` de `page.tsx` (Etapa F5m) ya
excluye del set visible cualquier fila Brokered con `rawLoanFolder='Current Prospects'` -- así
que ese valor específico existe en el dato crudo (y la columna lo mostraría si apareciera) pero
en la práctica un usuario nunca lo va a ver en esta tabla para Brokered, porque esas filas se
descartan antes de llegar acá. No es una inconsistencia del ajuste, es el filtro de F5m operando
como ya estaba.

`<colgroup>` pasa de 7 a 8 columnas. Borrower Name/Loan Officer quedan en 18% sin cambios (el
`min-width` de `.piv--adverse` en `forecast-visual.css`, 1000px, está calculado sobre ese 18% --
no hacía falta tocarlo). El resto de las columnas se achicó proporcionalmente para hacerle lugar
a Loan Folder (13%): Loan Number 15%→12%, Branch 9%→7%, Amount 12%→10%, Last Finished Milestone
15%→12%, First Seen As Adverse 13%→10%. El `colSpan={7}` de la fila vacía ("No adverse loans...")
pasa a `colSpan={8}`.

### Sin resaltado por monto

Se elimina `HIGH_AMOUNT_THRESHOLD` (300.000) y el `<span className="badge badge--rose">`
condicional -- el monto se muestra siempre igual, sin destacado. **Hallazgo:** el brief pedía
"si `badge--rose` no lo usa nadie más, dejalo en el CSS pero marcalo como sin uso" -- no
aplica: `badge--rose` sigue en uso activo en `healthStatus.ts` (variante de badge de salud del
préstamo) y en `TabNavigation.tsx` (badge del contador de Adverse). No se tocó `components.css`.

### Texto explicativo

Reemplazado por el texto exacto del brief -- ya no menciona "risk loans" (esa categoría no
existe en el código, mismo motivo del renombre de la tab).

---

## Etapa F5k — la cascada de Banked reparte, no recalcula (rama `fix/banked-cascade-apportion`)

Mismo problema que F5j-b resolvió para Brokered, ahora en Banked: el panel Pull-Through Cascade
recalculaba el forecast de Banked aparte, redondeando **por milestone** (`Math.round()` de cada
uno de los 4 buckets, sumados), mientras la tabla ejecutiva lo calcula redondeando **por branch**
(`bankedSummary.forecastTotal`, suma de `forecastTotal` ya redondeado por fila en el loop de
`page.tsx`). Dos particiones distintas del mismo total decimal -- pueden divergir, exactamente
como divergía Brokered antes de F5j-b.

**La regla, ahora también para Banked:** el total por branch es la única fuente de verdad.
`bankedForecastByBucket` (la cascada real de `PULL_THROUGH_RATES` sobre Healthy, calculada en
`page.tsx` -- ninguna tasa, fórmula o población se tocó) deja de redondearse bucket por bucket;
se usa tal cual, con sus valores decimales, como **peso** para repartir
`bankedSummary.forecastTotal` con `apportionByWeight` (mismo mecanismo de F5j-b). A diferencia de
Brokered (que pesa por conteo Total, porque su tasa es plana 0.4 para los 4 buckets), Banked pesa
por el **forecast decimal** de cada bucket -- sus tasas no son planas (Started vale bastante
menos por préstamo que Closing, que ya casi terminó su cascada), así que pesar por conteo crudo
distorsionaría la proporción y la columna "% applied" dejaría de leerse coherente con la columna
Forecast.

### Hallazgo sobre los números esperados (corregido)

**Primera verificación de esta etapa, con un rango de fechas equivocado:** medí
`pipelineDateRange` a mano como 2026-07-01 a 2026-09-30 -- error de traducción de
`new Date(year, month+1, 0)` (ese `0` da el último día del mes ANTERIOR a `month+1`, o sea el
propio `month`, no el siguiente). Con esa fecha de corte mal calculada, Executive y la Cascade
vieja daban 34 y 34 (coincidencia) para "todas las branches" -- reporté esos números como
verificación real de esta etapa. **Isabella marcó la discrepancia** (había reproducido 30,60 /
32 / 31 por SQL directo contra el snapshot, con Pipeline Range 2026-07-01–2026-08-31 explícito) y
pidió reverificar con ese rango exacto.

**Reverificado con el rango correcto** (`getDefaultPipelineDateRange()`: 2026-07-01 a
2026-08-31, que es lo que la app realmente usa por defecto -- el error era solo mío, al
reproducirlo a mano, el código de la app nunca calculó mal la fecha): snapshot 28, Forecast
Month agosto 2026, All Branches:

| | Executive (Projected to Close) | Cascade ANTES del fix | Cascade DESPUÉS del fix |
|---|---|---|---|
| Banked, todas las branches | **32** | **31** (diverge) | **32** |

Total decimal exacto (suma de `forecastByBucket` sobre las 12 branches, sin redondear):
**30,5871** ≈ 30,60, igual al que había reproducido Isabella por SQL. Reparto real después del
fix (pesos: Started 2,6675, Processing 3,7368, Underwriting 18,4829, Closing 5,7 -- suman
30,5871): Started 3 + Processing 4 + Underwriting 19 + Closing 6 = **32**, exacto, igual que
Executive. Antes del fix: `Math.round(2,6675)=3 + Math.round(3,7368)=4 +
Math.round(18,4829)=18 + Math.round(5,7)=6 = 31` -- ahí está el 31 que veía Isabella.

Aislando una sola branch, la única de las 12 de Banked donde el redondeo por milestone (viejo) y
el redondeo por branch (Executive) daban números distintos con este rango es **Affinity**:
Executive = 5, Cascade vieja = 4 (`Math.round(0,6669)=1 + Math.round(1,4947)=1 +
Math.round(2,4108)=2 + Math.round(0)=0 = 4`); después del fix, la Cascade también da 5.

**Brokered no se tocó** -- confirmado revisando el diff línea por línea, ningún bloque de
Brokered cambia (su apportionment ya estaba correcto desde F5j-b).

### Cambio menor: rótulo de la tarjeta Closed

"Projected to close soon" → "Projected to close soon (CTC)" -- aclara que son los préstamos en
milestone Clear to Close, sin que el usuario tenga que inferir la sigla.

### Parte 3 — Marca "N in CTC" en la columna Projected to Close (`PivotTable.tsx`)

Cada celda de Projected to Close (fila de branch, fila de subtotal, y la fila de branch del
bloque Combinado) agrega una anotación chica debajo del número principal: "N in CTC", con N =
`branchForecastRow.bucketTotal.Closing` de esa fila -- el mismo dato que ya suma la tarjeta
Closed ("Projected to close soon (CTC)"), sin cálculo nuevo. Solo se muestra con N > 0 (con 12
branches, la mayoría da cero, y una columna llena de "0 in CTC" no aporta nada).

`BranchRow`/`BlockSubtotal`/`CombinedBranchRow` suman un campo nuevo, `closingCount`, con el
mismo patrón que `projectedToClose` (UX8): se expone como campo propio para poder sumarlo en
`addSubtotal`/`buildCombinedByBranch` igual que los demás.

**Por qué Brokered nunca lo muestra, por estructura y no por casualidad:** `bucketTotal` es
vestigial para Brokered (usa el esquema de buckets de Banked, que Brokered no puebla) -- hoy da 0
en la práctica, pero apoyarse en eso sería el mismo tipo de coincidencia frágil que ya causó el
bug de F5k. Por eso `buildBranchRows` fuerza `closingCount = 0` para cualquier fila que no sea
`channel === 'Banked - Retail'`, en vez de dejar que el valor vestigial "dé 0 por ahora" decida.
En el bloque Combinado, sumar Banked (real) + Brokered (siempre 0 por construcción) da
automáticamente solo la parte Banked -- sin necesidad de un caso especial ahí.

**Verificado con datos reales** (snapshot 28, Pipeline Range 2026-07-01–2026-08-31, Banked): de
las 12 branches, 6 muestran la marca -- 707 (1), 710 (1), 716 (1), 747 (1), 760 (1), 776 (1) --
las otras 6 no llevan marca (closingCount = 0). Suma = **6**, exactamente el 6 que muestra la
tarjeta Closed ("6 Loans Projected to close soon (CTC)") -- coincide, reportado tal cual salió,
no ajustado.

---

## Etapa UX10 — marca de CTC como puntos, con leyenda

Reemplaza la anotación de texto "N in CTC" (F5k, Parte 3) por un punto por préstamo en Clear to
Close -- sin número ni la palabra "CTC" en la celda mientras entre dentro del tope.

**Color -- `--ctc-dot`, variable nueva en `forecast-visual.css`.** Elegido **navy**
(`var(--navy)`, el mismo ink de marca). Verificado con la fórmula de contraste WCAG, no solo a
ojo:

| Comparación | Contraste |
|---|---|
| `--ctc-dot` (navy) contra `--emerald-50` (fondo teñido del header de esta columna) | **16.3:1** |
| `--ctc-dot` (navy) contra blanco (fondo real de las celdas de dato -- ver hallazgo abajo) | **17.2:1** |
| `--emerald-700` (punto verde de Healthy Pipeline) contra `--emerald-50` | 5.2:1 |

**Hallazgo, no ajustado para que el brief "cierre":** el brief describe la columna Projected to
Close como "ya teñida" de verde claro. Verificado leyendo `forecast-visual.css`: el tinte
`--emerald-50` existe SOLO en el `<thead>` (`.piv--exec thead .mo-row th.col-forecast`) -- las
celdas de DATO (`td.col-forecast`, donde vive el punto) no tienen ningún `background` propio,
heredan el blanco de `.tbl-card`. Confirmado también leyendo el color renderizado con Playwright
(`getComputedStyle`), no solo el CSS fuente. No cambia la decisión -- navy da más contraste
todavía contra blanco (17.2:1) que contra el emerald-50 del header -- pero el fondo real contra
el que hay que leer el punto en la práctica es blanco, no verde, y vale la pena que quede
anotado por si el diseño de esa columna cambia más adelante.

`--ctc-dot` se define en `:root` (no en `.piv--exec`) porque la leyenda (fuera de la tabla) y la
tarjeta Closed (`SummaryCards.tsx`, otro componente) tienen que leer la misma variable -- `:root`
acá es seguro porque `forecast-visual.css` se importa solo en `app/pipeline/page.tsx`, nunca en
Commercial Activity.

**Tope de puntos: 8** (`CTC_DOT_CAP`, `PivotTable.tsx`). Hoy el máximo real es 1 por branch y 6
en el subtotal -- muy por debajo del tope --, pero si algún branch o el subtotal llegaran a
superarlo, se dibujan 8 puntos y se agrega el número completo al lado (verificado con valores
sintéticos 0/1/6/8/9/12: en 8 salen 8 puntos sin número, en 9 y 12 salen 8 puntos + el número).

**Tarjeta Closed:** el subtítulo "N Loans Projected to close soon (CTC)" usa
`.kpi-hero__sub--ctc { color: var(--ctc-dot) }` -- mismo navy que los puntos, mismo origen (la
variable), no pueden desincronizarse.

**Leyenda:** un solo `<p className="foot-note ctc-legend">` al final de `PivotTable.tsx`, después
de las 3 tablas (Banked, Brokered, Combined) -- no repetida por bloque. Texto: "● Loan in Clear
to Close".

**Verificado con datos reales** (mismo dataset de F5k/Parte 3, snapshot 28, Pipeline Range
2026-07-01–2026-08-31): las 6 branches con marca (707, 710, 716, 747, 760, 776) muestran
exactamente 1 punto cada una; el subtotal de Banked muestra 6 puntos (dentro del tope de 8, sin
número al lado); la suma programática de los puntos por fila (leyendo el DOM, no a mano) da
**6**, igual que antes. Brokered no muestra ningún punto en ninguna fila ni en su subtotal --
confirmado visualmente y por la exclusión estructural ya existente en `buildBranchRows`.

---

## Etapa UX12 — limpiar los puntos

Simplifica lo que agregaron F5k/Parte 3 y UX10: menos decoración, un solo verde con un único
significado.

### Parte 1 — se quita el punto de Healthy Pipeline

**Grep antes de tocar nada** (pedido explícito del brief): `.dot-healthy` está definida en
`app/styles/components.css` (compartido con Commercial Activity), pero solo la **consumen**
`app/pipeline/PivotTable.tsx` (las 3 filas de la columna Healthy Pipeline: `BranchDataRow` vía
`CountCell`, `ExecTotalRow`, y el bloque Combinado) y `app/pipeline/SummaryCards.tsx` (el punto
junto al título de la tarjeta "Healthy Pipeline" del banner de KPIs). Commercial Activity **no
usa la clase en ningún lado** -- confirmado, no asumido.

Por eso no hizo falta anular nada por CSS ni tocar el archivo compartido: alcanzó con quitar el
`<span className="dot-healthy" />` de las 3 filas de `PivotTable.tsx` (y el prop
`withHealthyDot`, que quedaba sin ningún consumidor). El punto de la tarjeta "Healthy Pipeline"
del banner (`SummaryCards.tsx`) **no se tocó** -- el brief pide sacar el de "la columna", y ese
es un punto por tarjeta (uno solo, no por fila), no tiene el problema de "aparece en toda fila
así que no distingue nada" que sí tenía el de la tabla.

### Parte 2-3 — un solo punto verde, subtotal en texto

`CtcDots` (F5k/UX10, un punto por préstamo con tope) se reemplaza por dos componentes:

- `CtcDot` -- un punto único, sin número ni texto, cuando `closingCount > 0`. Envuelto en
  `.ctc-cell` (`display: inline-flex; align-items: center`) junto al número de Projected to
  Close, para que quede centrado verticalmente con él en vez de debajo (como F5k/UX10).
- `CtcSubtotalNote` -- en la fila de subtotal, sin punto: el número exacto ("6 CTC"), chico
  (10px), sin negrita, mismo verde, debajo del total.

`--ctc-dot` cambia de `var(--navy)` a `var(--emerald-700)` -- el MISMO verde que ya usaba
`.dot-healthy`. Ya no hace falta un tono distinto para no competir con Healthy: Healthy perdió su
punto en la Parte 1 de este mismo ajuste, así que no hay 2 puntos en la misma fila que
distinguir. El verde sigue significando "va bien" en toda la app, un solo significado en vez de
dos verdes distintos. `.kpi-hero__sub--ctc` (`SummaryCards.tsx`) no necesitó ningún cambio -- ya
leía `var(--ctc-dot)` desde UX10, así que el nuevo verde se propaga solo.

### Parte 4 — se quita la leyenda

La leyenda de UX10 ("● Loan in Clear to Close") se borra de `PivotTable.tsx`. Ya no hace falta:
un solo punto sin ambigüedad + el "N CTC" explícito en el subtotal se explican solos.

### Parte 5 — se quita el tope

`CTC_DOT_CAP` (8, de UX10) se borra junto con toda su lógica -- nunca se dibuja más de un punto
por fila, así que un tope de puntos ya no tiene sentido.

**Verificado con datos reales** (mismo dataset de F5k/UX10, snapshot 28, Pipeline Range
2026-07-01–2026-08-31): las 6 branches con punto siguen siendo las mismas -- 707, 710, 716, 747,
760, 776 -- el resto sin marca. Suma programática de `closingCount` de esas 6 filas = **6**,
igual que el subtotal ("32" con "6 CTC" debajo) y que la tarjeta Closed ("6 Loans Projected to
close soon (CTC)"). El punto de la tabla y el texto de la tarjeta se leen en el mismo verde
(`rgb(4, 120, 87)` en los 2, verificado con `getComputedStyle`, no solo el CSS fuente).
`git diff --name-only main` para esta etapa: solo `app/pipeline/PivotTable.tsx` y
`app/pipeline/styles/forecast-visual.css` -- `SummaryCards.tsx` no necesitó tocarse.

### Ajuste posterior — orden y alineación del punto

Dos correcciones sobre la Parte 2, mismas 12 branches y mismo dataset:

1. **Orden:** el punto pasa a ir ANTES del número ("● 1", no "1 ●") -- en `PivotTable.tsx`,
   `<CtcDot>` ahora es el primer hijo de `.ctc-cell`, no el último.
2. **Alineación:** `CtcDot` dejó de hacer `return null` cuando `count` es 0 -- ahora siempre
   renderiza el `<span>` (con la clase `ctc-dot--empty`, transparente, cuando no corresponde
   pintarlo). Antes, al faltar el elemento por completo en las filas sin CTC, esas filas medían
   menos que las filas con punto, y el centrado de la celda desplazaba el número entre unas y
   otras -- el 5 de Affinity no coincidía con el 1 de 707. El subtotal reserva el mismo espacio
   con un punto siempre vacío (`<CtcDot count={0} />`, no `subtotal.closingCount`), para que su
   número quede en la misma línea que las filas de arriba.

**Verificado con `getBoundingClientRect()` sobre la tabla real (no a ojo):** las 12 filas de
branch comparten exactamente el mismo borde izquierdo Y derecho del número (`left`/`right`
idénticos, con o sin punto pintado). El subtotal ("32", 2 dígitos) comparte el mismo borde
DERECHO que las 12 filas (borde izquierdo distinto, esperable por tener un dígito más) --
confirmado también con una fila sintética de 3 dígitos ("123"): comparte el mismo borde derecho
que el resto. Los números de la columna quedan en línea recta por su borde derecho, el criterio
pedido.

---

## Etapa BP1 — Módulo Business Plan OS (esqueleto navegable)

Tercer módulo: **Branch Portfolio → Branch → Loan Officer**. Esta etapa construye la navegación y
la resolución de identidades. El motor de triage **no** está implementado, a propósito.

### El problema real que resuelve: la misma persona con tres nombres

Cada fuente llama distinto a la misma persona, y `org.employee_alias` es la única autoridad:

| roster (canónico) | salesforce (Forecast) | slquery (Commercial Activity) |
|---|---|---|
| Ana Zegarra (Peña) | Ana Milena Zegarra | ANA ZEGARRA |
| Gian Laino | Giancarlo Laino | GIAN LAINO |
| July Castro | Julymar Castro | JULYMAR MAR CASTRO |

**Nunca se comparan nombres con `===` ni con heurísticas de similitud.** No es una regla teórica:
en los datos conviven **Juseth Castro** y **July Castro**, dos personas distintas que cualquier
"fuzzy match" fundiría en una. La tabla las mantiene separadas porque alguien lo decidió a mano;
verificado que sus métricas no se mezclan (July: avg 0.67 / 3 abiertos; Juseth: avg 1.33 / 14
funded).

`lib/business-plan/aliasIndex.ts` hace búsqueda por clave exacta contra esa tabla. La única
normalización que aplica (trim + mayúsculas) absorbe espaciado y capitalización entre el parser y
el alias cargado — **no** decide identidad. Si llegara a colapsar dos alias que apuntan a personas
distintas, el índice lo detecta y lo reporta en vez de elegir uno en silencio.

### Casos del roster que el código soporta explícitamente

- **Un branch con dos Branch Managers**: el 716 tiene Pier Laino + Nelson Calderón. Nunca se
  asume uno solo.
- **BM de varios branches y sin ser LO**: Pier Laino es BM de 710 y 716 y no aparece en ningún
  directorio de LOs — los LOs salen de `employee_branch` con `role_in_branch='LO'`, y él no tiene
  ninguna fila con ese rol.
- **Producing BM**: aparece en las dos listas, y es correcto.
- **LOs sin producción**: Rene Perez Jr (733), Sandro Villavicencio (760) y Shon Lamberty (724)
  aparecen con ceros. Sólo tienen alias `roster`, así que ninguna fuente les atribuye nada.

### Navegación: páginas, cero modales

Tres rutas reales, con breadcrumb de `<Link>`s funcionales:

```
/business-plan                      Branch Portfolio
/business-plan/branch/[code]        Branch Portfolio > 703 (Ana Zegarra (Peña))
/business-plan/lo/[employeeKey]     Branch Portfolio > 703 > Matthew Gomez Bruckner
```

`branch_code` **no siempre es numérico**: hay `Affinity` y `Branch Out of Division` (con
espacios). Se codifica y decodifica; las tres variantes responden 200.

**`isActive` del header** pasó de `pathname === tab.href` a comparación por sub-camino. No se
podía usar `startsWith` a secas: `/` es prefijo de todo y habría dejado Commercial Activity activo
en cualquier ruta. La raíz se compara exacta; el resto contra `href + '/'`, así un futuro
`/pipeline-x` no enciende el tab de `/pipeline`.

### Supuesto que hay que confirmar

**La ventana del promedio de cierres.** El brief pide "últimos 3 meses" sin decir si el mes en
curso entra. Se **excluye**: se usan los 3 meses calendario completos anteriores. Incluirlo haría
que el mismo LO pareciera peor evaluado un día 3 que un día 28, y ese promedio alimenta el GAP. La
ventana usada se muestra en el pie de cada pantalla.

### Lo que NO se decidió

`lib/business-plan/triage.ts` no implementa ninguna fórmula, y explica por qué: la banda del GAP
fraccionario no está definida, la condición de qualifiers es redundante como está escrita (falta
saber si era **O**), los multiplicadores no existen y el ejemplo del negocio se contradice.

Hoy **todos** los LOs son `not_evaluable`, y es correcto: `org.employee_benchmark` todavía no
existe. Sin benchmark no hay nada que comparar — **no hay default a 2.0**.

### Benchmark

`docs/sql/2026-08-org-employee-benchmark.sql`, **entregado sin ejecutar**. Versionado por
`(employee_key, effective_from)` para poder responder con qué número se evaluó a alguien en el
pasado. La app tolera que la tabla no exista: lo detecta y lo dice en el pie de pantalla.

### Hallazgos de datos para quien mantiene `org`

- **21 nombres de `salesforce` sin alias ni exclusión.** `source_name_excluded` tiene 35 de
  slquery y sólo 1 de salesforce. Entre los no mapeados hay LOs del roster (Aileen Perez, Claudia
  Velasco, Jose Zamora, Isabel Wagner, Ludwig Aguillon, Sergio Vermejo) y "Adriana Szczech", que
  sí está mapeada del lado slquery. La app los ignora sin romperse y los lista en el pie.
- **210 filas con loan officer vacío** (`'(blank)'`, centinela de nuestro propio parser). Se
  cuentan aparte para no enterrar los nombres que sí hay que clasificar.
- **`Affinity` no tiene LOs ni BM** en el roster, aunque es branch de división.

### Alcance respetado

No se tocó `app/page.tsx`, `app/pipeline/**`, `lib/pipeline/**`, `lib/aggregation/**`,
`lib/domain/**`, `lib/parsing/**`, `components/report/**`, `app/styles/components.css`, `proxy.ts`
ni `lib/auth/**`. El CSS del módulo vive en `app/business-plan/styles/bp-visual.css`, importado
sólo desde sus páginas.

De `app/styles/tokens.css` sólo se **completó la escala ámbar**: ya existían `--amber-50` y
`--amber-700` (de UX1, para el chip "Transferred"); se agregaron 100/200/500/800 para el estado
intermedio de triage, sin tocar los dos que ya estaban en uso.

---

- **CL / SL** en nombres de archivo = residuo histórico de cuando existían dos empresas (City Lending / Supreme Lending); hoy solo existe Supreme Lending, no hay distinción de marca activa.
- **Healthy / Delayed / Out of Scope / Never / Adverse** — estados de un préstamo en pipeline. Adverse = terminal (rechazado). Never = provisional, "ya sabemos que no va a cerrar pero Encompash no lo refleja aún" — se trata igual que Adverse para el forecast.
- **Loan Folder** ≠ milestone — es una carpeta operativa (Current Prospects, My Pipeline, Underwriting, Brokered, Funded, Adverse Loans), no la secuencia de avance del préstamo.
- **Org_ID vs True OrgID** — el campo `Branch` que ya usamos en el parser **es** el True OrgID (confirmado por Isabella); no hace falta distinguir los dos.

---

## Business Plan OS — deuda explícita y decisiones abiertas (etapa BP5)

### 1. Las tasas de pull-through están duplicadas, a propósito y por ahora

`business_plan.settings` es la tabla de tasas del módulo, editable desde
**Business Plan → Settings**. Pero **sólo Business Plan la lee**.
Forecast & Pipeline sigue con sus constantes en `app/pipeline/page.tsx`
(`PULL_THROUGH_RATES` y `BROKERED_FLAT_PULL_THROUGH_RATE`).

Consecuencia práctica: **editar una tasa marcada como "shared" en Settings
cambia lo que ve Business Plan y no cambia Forecast.** La pantalla de Settings
lo dice en un aviso permanente, porque si no, alguien que edite
"Milestone Processing" y no vea moverse el forecast va a reportarlo como bug.

Es deuda deliberada: `app/pipeline/**` quedó fuera del alcance de BP5 y había
otras ramas trabajando ahí. **Que Forecast consuma la tabla es una etapa
aparte**, y cuando pase hay que sacar el aviso de Settings y esta nota.

Ojo con una confusión fácil al hacerlo: las tasas de `app/pipeline` son **por
paso** (de un milestone al siguiente) y las de `business_plan.settings` son
**acumuladas** (de un milestone hasta el cierre). Salen unas de otras:

    Started       0.8923 × 0.93 × 0.8459 × 0.95 = 0.6668  ->  66.7 %
    Processing             0.93 × 0.8459 × 0.95 = 0.7473  ->  74.7 %
    Underwriting                  0.8459 × 0.95 = 0.8036  ->  80.4 %
    Closing                                0.95 = 0.9500  ->  95.0 %

No son intercambiables. Para proyectar cuántos préstamos abiertos de una
persona van a cerrar, la que sirve es la acumulada.

### 2. La suma por Loan Officer no cuadra con el forecast por branch

**No es un bug.** Son dos atribuciones distintas de los mismos préstamos:

- Forecast atribuye por el branch **del préstamo** (`pipeline_loans.branch`).
- Business Plan atribuye por **persona**, y hay gente con producción repartida
  en varios branches (Gian Laino tiene préstamos en 747, 716, 710 y 707).

Además la proyección de una persona es un **pronóstico, no un conteo**: puede
dar 2,4 y está bien. No se redondea ni se reparte proporcionalmente para que
cierre — redondear inventaría precisión y el reparto proporcional inventaría
una atribución que el negocio no pidió.

Está comentado en `lib/business-plan/loadData.ts`, arriba de todo.

### 3. El "actual" del Qualifier 2 es el mes en curso — supuesto a confirmar

El requerido de cada métrica sale de un benchmark **mensual**
(`ceil(benchmark / tasa)`), así que se compara contra el **mes en curso**.

Consecuencia conocida: a principio de mes casi nadie llega al requerido, porque
se compara un mes incompleto contra un objetivo de mes entero. Por eso la
pantalla muestra siempre, al lado, el promedio de los 3 meses cerrados.

Si el negocio prefiere evaluar sobre ese promedio en vez del mes en curso, se
cambia el argumento en `loadData.ts` (la llamada a `evaluateQualifier2`) y nada
más: el motor ya recibe los dos.

### 4. Los números de referencia del brief BP5 no se reproducen

El brief traía seis promedios "verificados por SQL". El promedio de **meses
cerrados** coincide en los 6 exactamente, o sea que la fuente de cierres y la
ventana son correctas. El promedio **con mes actual** no coincide en ninguno, y
no por un margen de redondeo:

| Loan Officer | esperado | calculado |
|---|---|---|
| Nathan Martinez | 7,21 | 7,42 |
| Ana Peña | 3,54 | 3,45 |
| Gian Laino | 4,07 | 3,70 |
| Haydee Tito-Pace | 1,80 | 1,53 |
| Luis Silva | 0,33 | 0,58 |
| Jose Arango | 0,00 | 0,54 |

Se descartó que fuera un error de implementación con dos pruebas:

- **Ningún snapshot reproduce el conjunto.** Luis Silva y Jose Arango sólo dan
  los valores esperados en los snapshots 29 y 30 (donde no tienen préstamos
  healthy); en el snapshot activo (31) Luis tiene 1 healthy en agosto, así que
  su proyección no puede ser 0 con ninguna tasa positiva.
- **Gian Laino es imposible en el snapshot 30**: necesitaría un aporte de 4,21
  a partir de 4 préstamos healthy, o sea una tasa media mayor que 1,0.

La hipótesis más probable es que los seis números se calcularon en momentos
distintos del día — hubo tres cargas de snapshot el 13/8 (13:49, 19:54, 20:53)
— y por eso no son consistentes entre sí.

**La fórmula quedó implementada tal como está especificada en el brief.** No se
ajustó para hacer coincidir los números, siguiendo la instrucción explícita de
parar y reportar la diferencia.

### 5. Fuera de alcance en BP5

El catálogo de funnels, la biblioteca de nodos y el portal del plan activo.
`/business-plan/lo/[key]/funnel` existe como placeholder honesto para que el
botón "Choose a funnel" no lleve a un 404.
