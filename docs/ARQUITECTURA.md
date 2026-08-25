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

### Exclusión global — HELOC Lien Position 2

Regla de negocio confirmada por Isabella (2026-08-18): los loans con
`HELOC LIEN POSITION = 2` no se cuentan en Commercial Activity — no dejan
utilidad para la empresa y confunden los reportes si se incluyen.

**Es una exclusión GLOBAL del universo de Activity**, no un filtro visual ni
solo del drill-down: ocurre durante la ingesta, en `app/page.tsx`
(`handleFileChange`), filtrando `RawLoanRow[]` con
`lib/domain/isHelocLien2.ts` **antes** de `classifyLoan()` — el loan nunca
llega a convertirse en `LoanRecord`, nunca entra al estado `records` y nunca
se guarda vía `saveUpload()`. Por eso queda fuera, sin excepción, de Branch,
Metric, Loan Officer, BD, filtros (Channel/B2B/Year/Branch), drill-down/modal
y export — todos derivan del mismo `records` filtrado una sola vez (ver
Etapa 2 arriba).

**Campo crudo**: `RawLoanRow.helocLienPosition` (`lib/parsing/types.ts`),
poblado desde la columna opcional `HELOC LIEN POSITION`
(`config/requiredColumns.ts`, `OPTIONAL_COLUMNS[5]`) — opcional a propósito,
mismo criterio que Disbursement Date: un archivo que no la traiga sigue
parseando igual, simplemente ningún loan de ese archivo queda excluido por
esta regla. Solo acepta el valor numérico real de la celda (`1`/`2`); una
celda vacía o de otro tipo da `null`, que NO excluye.

**Condición única e intencional**: `helocLienPosition === 2`. Sin
condiciones adicionales sobre Channel, Loan Program, Branch, B2B, Loan
Officer o milestone.

**Validado** contra el archivo real (`SLQUERY 08.14.AM.xlsx`, 4.609 filas):
distribución `1`=4.566, `2`=42, vacío=1 → 4.609 rawRows − 42 excluidos =
4.567 `LoanRecord` elegibles, cero fugas (ningún `loan_number` excluido
sobrevive en el resultado).

**Específica de Commercial Activity** — no debe interpretarse
automáticamente como una regla de Forecast/Pipeline: ese módulo ya excluye
SL/HELOC por alcance propio (ver "Módulo 2 — Forecast/Pipeline · Alcance"),
así que no existía lógica que reutilizar ni riesgo de conflicto.

**Pendiente conocido, no bloqueante**: el batch actualmente persistido en
Supabase (subido antes de esta regla) puede seguir teniendo loans HELOC=2
latentes hasta el próximo upload — no se tocó Supabase ni se corrió SQL para
limpiarlo retroactivamente (decisión explícita); se resuelve solo con el
próximo archivo subido.

### Drill-down de Activity (Fase 1 — sin persistencia Supabase)

Reemplaza progresivamente la expansión inline por un modal: click en una
celda de métrica con valor > 0 (`components/report/PivotRow.tsx`, clase CSS
`.drillable`) abre `components/report/LoanDetailModal.tsx` con los
`LoanRecord` individuales que forman esa celda. Funciona tanto en
`PivotTable` (Branch × Metric, incluida la fila Total y el desglose por Loan
Officer/BD) como en `LoanOfficerTable`.

**Cómo determina los loans** (`lib/aggregation/loansForCell.ts`, función
pura nueva): filtra sobre `filteredRecords` -- los mismos records que ya
alimentan `tree`/`loanOfficerTree` en `app/page.tsx`, con B2B/Channel ya
aplicados -- comparando `record[METRIC_MONTH_FIELD[metric]] === month` (mismo
mapeo que ya usa `computeMetricMaps`), más `branch`/`drillBy`+`drillName`
cuando corresponden. No se tocó `buildReportTree.ts` ni
`buildLoanOfficerTree.ts`: el drill-down solo *selecciona* sobre la misma
lista que la tabla ya usó para *sumar*, nunca recalcula.

**Closed usa `closingMonth` directamente** -- ya resuelto por `classifyLoan()`
(incluida la regla de Disbursement Date). El modal no vuelve a mirar
Funding/Completion/Disbursement por separado.

**Filtros que respeta:** Year/rango (acota `months`, ya aplicado antes de
llegar al drill-down), Branch (vía `context.branch`), B2B y Channel (ya
aplicados en `filteredRecords`), Loan Officer/BD (vía `context.drillBy`+
`drillName` cuando el click viene de una fila de desglose).

**Validado exhaustivamente** con el archivo real (`SLQUERY 08.13AM.xlsx`,
4.590 filas): para cada celda no-cero de `tree`/`loanOfficerTree`, bajo 6
combinaciones de filtros (All/Banked/Brokered/Empty/B2B only/B2B+Brokered),
`loansForCell().length` coincide exactamente con el valor de la celda (con
`measure='count'`) -- cero discrepancias. Caso puntual confirmado: Branch
747 → Closed → Julio 2026 incluye al loan `747002047932`
(`closingMonth=2026-07`, por Disbursement Date); Agosto 2026 no lo incluye.

**Fechas:** solo Mes/Año en el header (`"Closed · July 2026"`), sin día --
no hay columna de fecha en la tabla del modal porque todos los loans de una
celda comparten el mismo mes por definición.

**Columnas del modal:** Loan Number, Loan Officer, Branch, Channel, B2B,
Loan Program, Affinity -- literal de la tabla pedida en el brief de esta
etapa (BD y Loan Folder Name quedaron fuera de la tabla, aunque están
disponibles en `LoanRecord`, para no ensanchar la tabla).

**Limitación conocida, no resuelta acá:** la vista Loan Officer
(`buildLoanOfficerTree`) siempre agrupa por el campo `loanOfficer`, nunca por
`bd`, sin importar si `b2bOnly` está activo -- comportamiento preexistente
desde la Etapa 12, sin cambios. El drill-down de esa vista hereda la misma
limitación (`drillBy` fijo en `'loanOfficer'`).

**Con `measure==='amount'`**, el número de loans del modal (`N loans`) no
coincide con el valor en dólares de la celda -- son unidades distintas
(conteo de préstamos vs. suma de `totalLoanAmount`). El *conjunto* de loans
sigue siendo exactamente el correcto; solo el número que se muestra arriba
del modal es un conteo, no una suma.

**PENDIENTE — persistencia Supabase:** `loanNumber`, `loanProgram`,
`loanFolderName`, `affinity` y `loanInfoChannel` procesado NO sobreviven un
refresh que dispare `loadCurrentReport()` -- mismo gap ya documentado en
Etapa 2/Closed por Disbursement Date (`lib/supabase/loadCurrent.ts` los deja
en `''`). Esta fase deliberadamente no tocó `saveUpload.ts`/`loadCurrent.ts`
ni Supabase -- queda para una fase posterior, después de confirmar el schema
real con Isa (ver auditoría previa).

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
- `pipeline_snapshots` — un snapshot por carga; retención (S2): el día 15 se borra, de todo mes anterior al actual, lo que no sea uno de los tres anclajes (`is_month_open`, `is_first_day_close`, `is_month_close`), que se conservan siempre. `is_month_start`/`is_month_end` quedaron obsoletas
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

## Glosario rápido (para no repetir la investigación)

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

### 4. Los números de referencia: resuelto en BP6

En BP5 los seis promedios de referencia no se reproducían. La causa fue doble y
quedó cerrada:

- **Del lado del negocio**: la tabla esperada se había calculado contra el
  snapshot 28 y el activo era el 31 (hubo tres cargas el 13/8).
- **Del lado del código**: tres decisiones que el brief no explicitaba y que yo
  había resuelto de otra manera.

Las tres quedaron fijadas así, y con ellas el motor coincide **6/6**:

1. **Sólo entran los préstamos que cierran ESTE mes.** Un healthy con cierre
   estimado en septiembre no aporta a la proyección de agosto. Antes entraban
   todos los healthy, lo que adelantaba producción de meses siguientes.

2. **Brokered usa la misma cascada que Banked.** La tasa plana del 40% sigue en
   `business_plan.settings` porque pertenece al modelo de Forecast, pero **no se
   aplica** en la proyección del Loan Officer.

   ⚠ Vale la pena revisarlo con el negocio: para alguien con pipeline
   mayormente Brokered la diferencia casi duplica la proyección (Haydee
   Tito-Pace aporta 2,24 con cascada contra 1,20 con la plana). Hoy no cambia
   ningún veredicto, pero es una decisión de modelo, no de implementación.

3. **`cerradosALaFecha` sale de `pipeline_forecast.pipeline_resolved_loans`**
   (funded con disbursement en el mes), **no** de Commercial Activity.

   La proyección del mes es "lo que ya cerró + lo que sigue abierto", y las dos
   mitades tienen que venir del mismo sistema: cuando un préstamo cierra sale de
   `pipeline_loans` y entra en `pipeline_resolved_loans` en el mismo snapshot,
   mientras que Commercial Activity se carga aparte y puede ir atrasada. Con
   activity_report, un préstamo ya fundeado que el SLQuery todavía no trajo
   desaparece de las dos mitades. Pasa hoy: Gian Laino tiene 3 cerrados en
   agosto según el pipeline y 2 según Commercial Activity.

   **Contrapartida**: las barras de los meses anteriores del gráfico sí salen de
   Commercial Activity, que es la única fuente con la serie mensual completa. La
   barra del mes en curso y las demás no vienen del mismo lado. Es aceptable
   porque una es pronóstico y las otras hechos cerrados, pero si algún día los
   totales no cuadran mirando hacia atrás, la explicación está acá.

### 5. Fuera de alcance

El catálogo de funnels, la biblioteca de nodos y el portal del plan activo.
`/business-plan/lo/[key]/funnel` existe como placeholder honesto para que el
botón "Choose a funnel" no lleve a un 404.

### 6. Detalle de préstamos: qué campos hay según la fuente (etapa BP9)

Los modales de detalle del perfil leen de dos fuentes que **no tienen los
mismos campos**, y eso se nota en pantalla:

| | número | prestatario | monto | programa / folder | milestone |
|---|---|---|---|---|---|
| `pipeline_forecast.pipeline_loans` | sí | sí | sí | no | sí |
| `pipeline_forecast.pipeline_resolved_loans` | sí | sí | sí | folder sí | — |
| `activity_report.loan_records` | sí (desde BP11) | **no** | sí | sí (desde BP9) | no |

Por eso el modal de una barra de un mes pasado muestra menos columnas que el de
una tarjeta del pipeline: sale de Commercial Activity, y **ese archivo no trae
el nombre del prestatario**. No es un olvido de la implementación; el dato no
existe en el origen.

**Corrección de BP11**: en el reporte de BP9 se dijo que Commercial Activity
tampoco traía el número de préstamo. Era incorrecto — `loan_number` está en
`REQUIRED_COLUMNS`, así que el archivo lo trae siempre y el parser lo leía. Lo
que faltaba era persistirlo, igual que folder y programa; se agregó en BP11.

`pipeline_loans` tampoco trae el programa del préstamo, así que los modales del
pipeline muestran el canal en su lugar.

### 7. Las tres columnas de Commercial Activity, ahora persistidas

`loan_number`, `loan_program`, `loan_folder_name` y `affinity` ya las leía el
parser (la primera en `REQUIRED_COLUMNS`, las otras tres en `OPTIONAL_COLUMNS`)
pero no se guardaban: vivían en memoria y se perdían al
recargar. En BP9 se agregaron al insert de `lib/supabase/saveUpload.ts` y al
select de `lib/supabase/loadCurrent.ts`.

⚠ **Las filas cargadas antes de ese cambio las tienen en NULL.** El desglose por
folder de las Applications sólo tiene datos completos **desde la próxima carga
de Commercial Activity**; hasta entonces el modal lo dice explícitamente en vez
de mostrar un desglose vacío que se confunda con un cero.

Esos dos archivos son de Commercial Activity y estaban fuera del alcance del
módulo: fue una excepción acotada a agregar columnas al insert y al select, sin
tocar nada más.

### 8. Los modales deciden sus columnas con los datos (etapa BP11)

Las tablas de detalle que salen de Commercial Activity **no tienen un juego fijo
de columnas**: cada una se dibuja sólo si al menos una fila la tiene con dato.

El motivo es que hoy `loan_number`, `loan_program`, `loan_folder_name` y
`affinity` están en NULL en las 4.590 filas del lote activo — se guardaron antes
de que se persistieran. Con columnas fijas, cuatro de las cinco salían llenas de
guiones, y el lector no podía distinguir "este préstamo no tiene programa" de
"todavía no guardamos el programa".

Cuando una columna falta por eso, el modal lo dice en una línea en vez de
mostrarla vacía. Hoy los modales de actividad muestran **monto y canal**; las
otras aparecen desde la próxima carga del archivo.

### 9. Funnels: plantilla vs instancia (etapa BP12)

El módulo tiene **dos mitades que no se tocan**:

| | tablas | se edita | quién la ve |
|---|---|---|---|
| **Plantilla** | `funnel` · `node` · `funnel_node` · `node_milestone` · `node_owner` | libremente, con DELETE | la biblioteca |
| **Instancia** | `enrollment` · `enrollment_node` · `enrollment_milestone` | por persona | el portal del plan |

**Al enrolarse, el plan se COPIA.** Si apuntara a la plantilla, editar un funnel
en la biblioteca cambiaría retroactivamente el plan de todos los enrolados:
alguien con 11 de 19 milestones hechos pasaría de golpe a otro plan y su
progreso dejaría de significar nada. Es el mismo principio que ya rige el
histórico de forecast — lo que pasó no se recalcula cuando cambian las reglas.

Eso es también lo que permite **editar el plan de una persona sin afectar a
nadie más**, y por eso no hace falta una plantilla por cada variación: si cada
personalización fuera una plantilla nueva, en un año habría cuarenta funnels
casi idénticos y nadie sabría cuál usar.

**Lo que NO se guarda, a propósito:**

- Los **rangos de días** de cada nodo (`DAY 1-5`) se calculan de los SLA y de la
  posición. Guardados, reordenar la secuencia dejaría todas las fechas
  mintiendo.
- Los **conteos** de la tarjeta del catálogo (`N NODES`, `N SUB-MILESTONES`) se
  cuentan de las filas.
- El **equipo de soporte** de una tarjeta se deriva de los responsables de sus
  nodos y milestones. Guardado, seguiría mostrando a quien ya no participa.

**Lo que sí se copia al activar**: el nombre del funnel y las fechas límite
resueltas. Las dos son fotos del momento de la activación.

### 10. El constructor de secuencia no es un lienzo

La interacción es sobre una **lista ordenada**: arrastrar desde la biblioteca
agrega, arrastrar dentro reordena. No hay coordenadas, ni zoom, ni posiciones
libres.

Un lienzo tiene sentido cuando el flujo se ramifica. Estos funnels son lineales
—cinco nodos en fila— y un lienzo agregaría estado (x/y por nodo), migración y
complejidad sin cambiar nada de lo que el usuario puede expresar. Si más
adelante hacen falta bifurcaciones, se extiende sobre esto.

Por eso **no hay botones de zoom**, aunque el mockup los muestre: sin un lienzo
real no hay nada que acercar, y un zoom que sólo escala el texto promete una
manipulación espacial que no existe. En su lugar va la duración total calculada,
que es la pregunta que alguien se hace mirando esa pantalla.

El drag and drop usa la **API nativa de HTML5**, sin librerías. Como esa API no
es accesible por teclado, cada tarjeta lleva además botones de mover
arriba/abajo — sin eso, reordenar sería imposible sin mouse.

### 11. Activación: un funnel sin milestones no se puede activar (BP13)

Quedó un enrolamiento con 5 nodos copiados y **cero milestones**, guardado como
activo y sin advertencia: la persona tenía un plan que no le pedía hacer nada y
un anillo de progreso en 0 de 0. Hubo que borrarlo a mano.

`checkActivation()` valida **antes de escribir nada** que el funnel tenga al
menos un nodo y al menos un milestone. Se aplica en dos lugares: la tarjeta del
catálogo sale deshabilitada con el motivo, y la función de activar revalida —
entre que la pantalla cargó y alguien hizo clic, otro pudo haber vaciado el
funnel desde la biblioteca.

### 12. El borrado en cascada no evalúa RLS del hijo

Corrección del revisor sobre el SQL de BP12, y vale la pena entenderla porque
es un agujero fácil de repetir: la política que impedía borrar un
`enrollment_milestone` en `done` **sólo cubría el DELETE directo**. Borrar el
`enrollment_node` padre arrastraba sus milestones completados por cascada, sin
que la política del hijo se evaluara.

Ahora las políticas de borrado de `enrollment` y `enrollment_node` también
comprueban que no haya ningún milestone en `done`. Verificado contra la base:
las dos devuelven 0 filas cuando lo hay.

**Consecuencia para el código**: no se puede asumir que un nodo del plan siempre
se puede borrar. Con pasos ya completados falla, y eso es lo correcto.

Los grants quedaron además explícitos por tabla en vez de
`all tables in schema`: `settings` no acepta insert ni delete, e `intervention`
no acepta delete.

### 13. Editar el plan de una persona (etapa BP14)

El plan es una copia, así que agregar, quitar o reordenar nodos y milestones
toca **sólo** a esa persona. Es lo que reemplaza la idea de crear una plantilla
por cada variación.

**El SLA se copia a la instancia.** `enrollment_milestone.sla_days` es nuevo. Sin
él no se pueden recalcular las fechas al reordenar: `sla_days` vivía sólo en la
plantilla, y el plan está deliberadamente desconectado de ella. Se evaluó
derivarlo restando la fecha de activación a la `due_date`, pero eso funciona
sólo la primera vez — después del primer reordenamiento las fechas ya no
reflejan el orden original y el cálculo se desalinea sin avisar.

**Al reordenar se recalculan las fechas**, con la misma fórmula de la
activación pero sobre el orden nuevo. **Los milestones en `done` conservan la
suya**: decir que un paso completado el 3 de septiembre "vence" el 20 de agosto
porque alguien reordenó después sería reescribir el pasado. Y la base los
rechazaría igual, porque una fila en `done` es invisible para UPDATE.

**La activación es todo-o-nada.** PostgREST no da transacciones entre llamadas,
así que si el insert de los milestones falla después del de la cabecera queda un
enrolamiento con nodos y cero milestones — el estado roto que motivó
`checkActivation`. Pasó de verdad al probar: la columna `sla_days` no estaba
aplicada, el insert devolvió 400 y el enrolamiento quedó vivo. Ahora cada paso
deshace lo anterior si falla.

No es una transacción real: si se corta la red en medio del rollback puede
quedar residuo. Cubre el caso que ocurre de verdad, que es un rechazo de la base.

### 14. Explorar no es elegir (etapa BP15)

Hasta BP14 el clic en una tarjeta del catálogo la **seleccionaba**, y la tarjeta
sólo mostraba los nombres de los nodos. Nadie puede decidir entre dos funnels
sin saber qué le van a pedir, así que la única forma de enterarse era activar
uno — un compromiso de ocho semanas.

Ahora son dos actos: el clic **abre** el detalle (nodos, pasos, responsables y
día de vencimiento dentro del nodo) y elegir tiene su propio botón dentro.

Va en un modal y **no en una página**: se exploran varios seguidos para
compararlos, y una página obligaría a volver atrás entre uno y otro perdiendo
la lista.

### 15. Nunca "Choose a funnel" a quien ya tiene plan

`enrollment` tiene un índice único parcial sobre `employee_key where status =
'active'`, así que ofrecer elegir otro funnel llevaría derecho a un 409.
Verificado: intentar un segundo enrolamiento devuelve
`duplicate key value violates unique constraint "enrollment_one_active_idx"`.

Con plan activo, la barra de decisión muestra el resumen y **See progress**.
Cambiar de funnel sería cerrar el actual y activar otro — una acción distinta,
todavía no pedida.

El resumen del plan (`LoanOfficerRow.activePlan`) viaja con cada Loan Officer
desde `loadData`, así que el perfil, el directorio del branch y el portfolio lo
muestran sin una consulta por persona.

## Etapas BP20 y BP21 — BP Team, notas, fechas editables y el icono que no se dibujaba

### El bug del icono: estaba guardado y no había quién lo pintara

Se buscó en la lectura y en el guardado, y los dos estaban bien: los seis
funnels tienen `icon` cargado en la base (`message`, `building`, `grid`,
`target`, `building`, `users`) y `useFunnelLibrary` los trae con `select('*')`.

El problema era otro: `iconByName` vivía dentro de `library/IconPicker.tsx` y
**ninguna pantalla la importaba nunca**. Un grep del proyecto la encontraba en
un solo archivo, el mismo donde estaba definida. Se elegía el icono, se
guardaba, y después no había una sola línea que lo dibujara.

El arreglo es la mudanza: el registro pasó a
`app/business-plan/components/funnelIcons.tsx`, con un componente `FunnelGlyph`
que resuelve el caso de "sin icono" devolviendo `null` en vez de un cuadrado
vacío. El selector quedó como consumidor del registro, no como su dueño.

Se dibuja en las cinco pantallas: tarjeta del catálogo, modal de preview, banner
del plan activo en el perfil, portal del plan y las dos tablas de la biblioteca.

El enrolamiento **no copia el icono**, a diferencia del nombre. Es deliberado y
la asimetría tiene motivo: el nombre identifica con qué se activó el plan y por
eso es una foto; el icono es decoración de la estrategia, así que sigue al
funnel actual. `ActivePlanSummary.funnelIcon` y `ActivePlan.funnel_icon` lo leen
en vivo de la plantilla.

### Dos niveles de responsabilidad, y por qué uno no estaba

La tarjeta del nodo mostraba avatares arriba a la derecha sin rótulo, y cada
paso mostraba otro responsable en su fila. Parecían lo mismo mal sincronizado.
Son dos cosas distintas:

- **Responsable del nodo** — responde por que la etapa avance. Puede ser más de
  uno.
- **Responsable del paso** — ejecuta ese paso y es el único que puede darlo por
  hecho.

Peor: los avatares del nodo salían de los responsables de sus pasos, lo cual era
directamente falso. En Cold Calling el nodo lo llevan Juanjo Cabrera e Isabella
Cano, y los seis pasos se reparten entre los dos.

`enrollment_node` no copia los responsables del nodo, así que se resuelven en
vivo contra `node_owner` de la plantilla vía `source_node_key`. También
deliberado: quién responde por una etapa es un hecho de organización actual, no
una foto del día del enrolamiento. Si alguien deja de llevar una etapa, deja de
llevarla también en los planes en curso.

### Estado y fecha editables, sin aflojar la regla

El botón redondo de "marcar hecho" pasó a ser un desplegable de tres estados y
la fecha pasó a ser un `<input type="date">`. Las dos reglas de siempre siguen
en pie, y ahora viven en una función pura, `allowedStatuses`:

- **Sólo el responsable puede llevar un paso a Done.** Lo respalda la app y nada
  más: `done` no lleva restricción de autor en la base.
- **Un paso hecho no se reabre.** Esto sí lo respalda la base, con el `using
  (status <> 'done')` de la policy de UPDATE, que hace la fila invisible.

Lo nuevo es el estado intermedio. `in_progress` es planificación, no un hecho:
cualquiera del equipo lo mueve, igual que reprograma una fecha. Restringirlo al
responsable no protegería nada.

Verificado contra la base con una sesión `authenticated` real: `PATCH` de
`due_date` y de `status` devuelven 200, se releen cambiados y se restauraron al
valor original. **No se creó ningún paso en `done`**: esa transición es
irreversible desde la app por diseño, así que probarla habría dejado residuo
imborrable en un plan de producción.

### Notas: una FK por destino, no una tabla polimórfica

`docs/sql/2026-08-business-plan-note.sql`, **sin ejecutar**. Cuatro columnas FK
nulables — `funnel_key`, `enrollment_node_key`, `enrollment_milestone_key`,
`employee_key` — y un check de que exactamente una esté puesta.

El atajo habitual (`entity_type` + `entity_id`) se descartó porque `entity_id`
no puede tener FK: la base dejaría de saber si el objeto al que apunta una nota
existe, no habría cascada al borrarlo, y `entity_type` sería texto libre donde
'node', 'Node' y 'nodo' conviven sin que nada se queje.

Las notas del **nodo** y del **paso** cuelgan de la instancia
(`enrollment_node`, `enrollment_milestone`), no de la plantilla: "se habló con
la persona y quedó en reprogramar" es un hecho de SU plan. Pegarlas a `node`
las haría aparecer en el plan de todos los que usen esa plantilla.

Sólo INSERT y SELECT, por **ausencia** de política de UPDATE y DELETE, más un
grant que tampoco las incluye. Mismo criterio que `employee_benchmark`. Para
rectificar se escribe otra nota.

`useNotes` tolera que la tabla no exista: se confirmó que hoy PostgREST
responde `404 / PGRST205`, que es uno de los códigos que el hook reconoce, así
que el panel avisa qué SQL falta en vez de romper la pantalla.

### BP Team

Cuarta entrada del menú. Las otras tres organizan por Loan Officer; ésta lo da
vuelta y organiza por persona del equipo de soporte.

**Dos tablas, no una.** Arriba los pasos asignados, abajo las etapas de las que
se es responsable de nodo. Se puede responder por una etapa sin ejecutar ni uno
de sus pasos; juntarlas borraría la distinción que la tarjeta del nodo acaba de
hacer explícita.

Se identifica por el email de la sesión contra `org.dim_employee.email`, el
mismo criterio que decide quién puede cerrar un paso. Si el email no es de nadie
del equipo **no se muestra una tabla vacía**: una tabla vacía se lee como "no
tenés nada pendiente", que es una respuesta falsa a una pregunta que nadie hizo.

Se leen las tablas enteras y se filtra en memoria, para que el selector de
persona no dispare cinco consultas por cambio. Con dos planes activos son tres
viajes; cuando esto sean cientos de planes habrá que darlo vuelta con una vista
del lado de Postgres.

Verificado con datos reales: 28 pasos repartidos entre los ocho, de 2 a 6 cada
uno. Juanjo Cabrera es el que más tiene (6 pasos, 2 etapas).

### Al activar, caer en modo edición

El catálogo redirige a `…/plan?activated=1`, y ese parámetro abre el editor y
muestra un aviso. Es el único momento en que personalizar tiene sentido y no es
peligroso: el plan ya es una copia propia. Antes de activar no se puede editar
nada, porque lo único que existe es la plantilla y tocarla cambiaría el plan de
todos los enrolados.

### Color: la paleta que hay, no una nueva

El pedido cromático original nombraba `bg-indigo-100` y `bg-purple-100`. No
están en el Brand Book y meterlos habría roto la consistencia que costó varias
rondas alinear. Los seis tonos de avatar salen de escalas que ya existían:
navy/sky, emerald, amber, coral, slate y sky pleno.

**El tono es determinista a partir del nombre**, no de la posición en la lista.
Es la parte que importa: con el índice, la misma persona sería azul en una
pantalla y ámbar en otra según en qué orden viniera cada consulta, y un color
que cambia entre vistas es peor que todos iguales.

La normalización es la misma que la de `initialsOf`, con su mismo límite: dos
grafías distintas del mismo nombre darían tonos distintos, igual que ya dan
iniciales distintas. No ocurre porque todos los avatares se dibujan con
`dim_employee.full_name`, que es un valor por persona.

### La flecha que apuntaba a la nada

Cuando la secuencia de nodos envolvía a una segunda línea, el último de la
primera fila mostraba una flecha hacia el borde del modal.

No se puede resolver con `flex-wrap`: **no hay selector CSS que sepa cuál es el
último elemento de una fila**, porque el corte lo decide el navegador al medir.
El stepper pasó a ser una grilla de columnas fijas — 4 en escritorio, 2 abajo de
900px — y ahí `:nth-child(4n)` es exactamente el último de cada fila. El precio
es que la grilla ya no se adapta al contenido.

## Etapas BP22, BP23 y BP24 — impacto, revisión conjunta y selección por contorno

### BP22 — el "antes" se congela, el "después" es en vivo

`docs/sql/2026-08-enrollment-baseline.sql`, **sin ejecutar**. Una fila por
enrolamiento con el promedio mensual de los 3 meses completos previos, los meses
que se usaron, el mes de enrolamiento y si la foto fue capturada o reconstruida.

El motivo de congelarla no es de diseño, es de datos: Commercial Activity se
recalcula entero con cada carga, y las reglas cambian. El cambio de Heather
—tomar la fecha de desembolso en vez del mes de Closed— movió préstamos de un
mes a otro. Una línea base recalculada cambiaría sola, sin que la persona
hiciera nada. Es el mismo principio que ya rige el plan copiado al enrolar.

La escritura va **dentro** del bloque de todo-o-nada de la activación, junto con
la copia del plan. Fuera de él, un fallo dejaría un plan activo sin foto del
antes, y esa foto no se puede reconstruir después sin mentir. La única excepción
tolerada es que la tabla todavía no exista: cualquier otro error aborta y
dispara el rollback que ya estaba.

**Los dos enrolamientos existentes** se rellenan desde el SQL, marcados
`reconstructed`. Calculados desde el lote activo con la misma resolución de
nombres del módulo:

| | cierres | apps | pre-appr | files |
|---|---|---|---|---|
| Ana Peña (crudo 7 / 14 / 79 / 89) | 2,3333 | 4,6667 | **26,3333** | 29,6667 |
| Kiana Smith (crudo 3 / 5 / 20 / 23) | 1,0000 | 1,6667 | 6,6667 | 7,6667 |

⚠ Siete de los ocho números coinciden con la tabla del brief. El octavo no: el
brief da 26,7 pre-approvals para Ana Peña y el dato da 26,3333, con 22 en mayo,
27 en junio y 30 en julio. Se dejó el valor que sale de los datos porque es el
único reproducible; si el 26,7 viene de otra regla de conteo, hay que decir cuál
y se recalculan los dos.

#### Cinco estados de mes, no dos

La tentación es partir la línea en antes y después. `phaseOf` distingue cinco, y
tres de ellos existen por errores concretos:

- `partial` — el mes del enrolamiento está PARTIDO. Ana Peña se enroló el 14 de
  agosto: contar agosto como "después" le atribuiría al plan lo que pasó antes
  de que existiera.
- `running` — el mes en curso no terminó. Compararlo contra un promedio de meses
  enteros da una caída garantizada el día 3 de cada mes.
- `future` — **apareció al probar, y era un −100% real**. El gráfico dibuja los
  doce meses del año y hoy es agosto: septiembre a diciembre entraban como
  `after` con cero cierres, y el promedio del después daba 0 sobre cuatro meses
  que no pasaron. Exactamente el número falso que esta pantalla existe para no
  mostrar.

Con los dos planes de hoy, `completeMonthsAfter` devuelve `[]` y la pantalla
muestra la línea base sola, con el primer mes medible nombrado: septiembre 2026.
Visto desde octubre, la misma función devuelve `['2026-09']`.

### BP23 — revisión conjunta

Ruta `/business-plan/group/1-25-44`, con las claves en el path. Página y no
modal: una revisión que no se puede mandar por link no sirve para discutirla.

**Sumar, no promediar promedios.** Verificado con los 3 Loan Officers del branch
703 (Ana Peña, Kiana Smith, Matthew Gomez Bruckner), ejecutando la agregación
real de `lib/business-plan/group.ts`:

```
cierres del grupo: may 4 · jun 2 · jul 4  = 10 en la ventana
  correcto    10 / 3 meses            = 3,33 por mes
  incorrecto  (2,33 + 1,00 + 0,00) / 3 = 1,11 por mes
```

El segundo número está exactamente 3 veces abajo, y ese factor es el tamaño del
grupo: no es "otra forma de verlo", responde una pregunta distinta (promedio por
persona por mes). La agregación arma el mapa de cierres sumado y lo pasa por el
MISMO `evaluateQualifier1` que usa una persona sola, así que no hay una segunda
implementación del cálculo que pueda divergir.

**Préstamos compartidos.** Verificado, no asumido:

- Forecast, snapshot activo: los 3 tienen 10 préstamos abiertos con 10
  `source_loan_id` distintos. Ninguno compartido. En el conjunto completo, 100
  préstamos y cero compartidos entre cualquier par de personas.
- Commercial Activity: **no se puede verificar hoy**. `loan_number` está en NULL
  en las 4.609 filas del lote activo — se empezó a persistir en BP9/BP11,
  después de esa carga. La deduplicación de cierres está implementada y probada
  con un caso sintético, pero contra los datos de hoy no encuentra claves. La
  pantalla lo dice con esas palabras: un cero ahí significa "sin clave para
  comparar", no "comprobado y limpio".

**Sin benchmark de alguien, el grupo no es evaluable.** No se rellena con cero:
un cero diría que a esa persona no se le pide nada y el GAP del grupo saldría
mejor de lo que es. Probado: con un miembro sin benchmark, `benchmark`, `gap` y
`state` quedan en `null` y el veredicto es `not_evaluable`, con el nombre a la
vista. Los 3 del 703 sí tienen (4,0 + 1,0 + 1,0 = 6,0).

Nota al margen: el branch 703 tiene una cuarta persona en `employee_branch`,
Fred Gomez, que **no** aparece en la revisión ni en el directorio porque su
`role_in_branch` no es LO — es BDR. Su falta de benchmark no contradice el "los
37 activos tienen benchmark": los 37 son Loan Officers.

**El veredicto del grupo es informativo y no dispara nada.** Está escrito arriba,
junto al badge, y no al pie: quien ve un "On Risk" idéntico al del perfil actúa
antes de llegar al final de la página. Los planes son de personas.

### BP24 — selección por contorno

⚠ El motivo no es estético. Pintar de navy la tarjeta seleccionada obligaba a
tener DOS versiones de todo lo que vive adentro: la píldora de días perdía su
tinte, el avatar se apagaba, el icono había que aclararlo. Cada componente nuevo
que entrara a una tarjeta iba a necesitar su propia excepción "cuando está
seleccionada" — el camino directo a que se desincronicen. Con el fondo igual en
los dos estados, cada pieza se dibuja una sola vez.

Las reglas viejas **se borraron en su origen** en vez de anularse desde abajo.
Anular una regla con otra deja las dos en el archivo y la siguiente persona no
sabe cuál manda; era el mismo problema en chico. Quedó una sola declaración por
selector.

Fondo idéntico entre estados, verificado en el archivo:

| | no seleccionado | seleccionado |
|---|---|---|
| `.bp-fstep__card` | `--slate-50` | `--slate-50` + borde 2px `--coral` |
| `.bp-step` | `--slate-50` | `--slate-50` + borde 2px `--coral` |
| `.bp-catalog__card` | `--canvas` | `--canvas` + borde 2px `--coral` |
| `.seg button` | transparente | transparente + anillo `--coral` |

Los avatares pasaron de círculo relleno a círculo de contorno: fondo `--canvas`,
borde e iniciales en el color de la persona. El hash por nombre no cambió, así
que cada quien conserva su color en todas las pantallas.

La excepción declarada es el menú lateral, donde el item activo en coral sólido
se queda: ahí el contraste es contra el fondo de la barra, no contra contenido
que viva adentro.

## Etapa BP25 — presentación, consistencia y una regresión propia

### "Stages", y el vocabulario que quedaba a medias

Los pasos de un nodo se llaman **Stages** en toda la interfaz. El rename tocó
sólo texto visible: tablas, columnas y variables siguen diciendo `milestone`,
que es como está en la base.

Lo que **no** se tocó: el `milestone` de un préstamo, que viene de Salesforce y
es otra cosa. Sigue llamándose milestone en el modal de detalle de préstamos, en
la nota de cálculo y en las tasas de Settings. Renombrarlo ahí habría fundido
dos conceptos que el módulo tiene separados desde BP5.

Además del rename pedido se unificó **"step" → "stage"** en las pantallas donde
convivían las dos palabras para lo mismo: la cabecera de la lista de pasos del
plan, el explorador de funnels, BP Team y el impacto. Dos nombres para un solo
objeto es la inconsistencia que el rename venía a sacar; dejar la mitad habría
sido peor que no empezar.

Un efecto colateral: en BP Team, "Stages owned" pasó a ser **"Nodes owned"**.
Con los pasos llamándose stages, esa sección decía que alguien "responde por
stages" cuando por lo que responde es por un NODO. La ambigüedad la creó el
rename, así que se arregla en el rename.

### Nombres de nodo duplicados

⚠ Nació de un duplicado real: convivieron "Cold Calling" y "Cold calling", y el
segundo se coló en tres funnels antes de que alguien lo notara.

`node.name` **es** único, y aun así pasó: en Postgres `text` distingue
mayúsculas, así que para la base son dos nombres distintos. Una mayúscula de más
alcanza, y un espacio doble también.

`findNodeNameClash` (función pura, en `funnels.ts`) normaliza como lo hace un
humano al leer -- trim, espacios colapsados, minúsculas -- y devuelve **el
nombre ya guardado**, no un booleano: decir "ya existe" sin decir cuál obliga a
ir a buscarlo, y el que existe casi nunca se escribe igual que el que se está
intentando crear.

Se aplica en los DOS caminos, no sólo al crear: el formulario de alta y el
renombre en línea de la tabla. Renombrar es la otra forma de fabricar el
duplicado, y taparle sólo una puerta al problema no lo cierra.

**TODO para el revisor**, fuera de alcance de esta etapa: lo correcto de verdad
es un índice único sobre `lower(btrim(name))`. Esto es una defensa de
aplicación; la base sigue aceptando el duplicado si algo escribe sin pasar por
la app.

### El editor del plan arranca cerrado

Abrirlo al activar (BP20) era pasarse de listo: lo primero que ve alguien recién
enrolado es su plan, no un formulario para reestructurarlo, y el editor empujaba
la lista de stages fuera de la pantalla justo cuando quiere ver qué le tocó. El
aviso de "podés ajustarlo antes de arrancar" se queda y ahora señala el botón.

### El avatar vuelve al navy

Se revierten BP21 (un tono por persona, elegido por hash del nombre) y BP24 (de
relleno a contorno). El motivo es de lectura: seis tonos repartidos por hash
llenaban una lista de pasos de colores que **no codifican nada** -- ni rol, ni
estado, ni urgencia -- y le ganaban la atención a las píldoras de estado y de
fecha, que sí la tienen.

Con el tono se fue `avatarToneOf`. Si alguna vez vuelve a hacer falta, la regla
que valía sigue valiendo: el color sale del NOMBRE y no de la posición en la
lista, o la misma persona cambia de color entre pantallas.

### El stepper del preview, en una sola fila

Un funnel es una SECUENCIA. Envuelta en tres filas deja de leerse como una: con
diez nodos, la forma del funnel desaparecía debajo de sí misma.

Esto reemplaza a la grilla de columnas fijas de BP21, que existía únicamente
para poder ocultar la flecha del último de cada fila con `:nth-child(4n)`. Sin
filas no hay último de fila: la única flecha que sobra es la del último nodo, y
para eso alcanza `:last-child`. **El problema de BP21 desapareció junto con su
causa** — la regla se borró en vez de quedar dando vueltas.

`flex-shrink: 0` en las tarjetas y en los huecos es lo que hace que aparezca el
scroll: sin él, flexbox las aprieta hasta que entren y con diez nodos quedan
ilegibles en vez de scrollear.

### Vista de flujo de los stages

Dos vistas del mismo nodo, con un conmutador que reusa `.seg`:

- **List** (por defecto) — la vista de TRABAJO: SLA, posición, editar y borrar.
- **Flow** — la vista de LECTURA: los stages en secuencia horizontal con su
  responsable al frente, que es lo que se quiere ver al explicarle el nodo a
  alguien. Un clic en una tarjeta abre su edición, para no obligar a volver a la
  lista para corregir algo que se acaba de ver mal.

La lista es la de por defecto porque es donde se hacen cosas; arrancar en la de
leer costaría un clic extra en el caso habitual.

### ⚠ Una regresión propia, encontrada al repasar

El primer intento de poner el nombre al lado del icono en la biblioteca puso
`display: flex` **en el `td`**. Eso saca a la celda del algoritmo de tabla: deja
de ser celda, y con `table-layout: fixed` -- que es lo que usan estas tablas
desde UX2 -- se lleva puestos los anchos de todas las columnas de la fila.

Se corrigió antes de commitear: el flex vive en un `<span>` de adentro y el `td`
sigue siendo un `td`. La causa real del problema era otra y más chica: el
`width: 100%` del input de edición en línea ocupaba la celda entera y empujaba
al icono a su propio renglón.

Queda anotado porque es un error fácil de repetir: cualquier `display` que no
sea de tabla sobre un `td` o un `tr` rompe el layout entero, y el síntoma
aparece en columnas que uno no tocó.

### El icono dentro de una tabla va en claro

`.bp-glyph--strong` es navy pleno y funciona junto a un título grande -- ahí es
una chapa. Repetido en cada fila armaba una columna de cuadrados oscuros que
pesaba más que los nombres, que es lo que la tabla existe para mostrar. Dentro
de una celda se dibuja el glifo solo.

## Etapas BP26, BP27 y BP28 — el recuadro del icono, el impacto arriba y el constructor

### ⚠ El recuadro del icono: qué regla lo pintaba, y por qué volvía

Se pidió sacarlo en BP24, BP25, BP26, BP27 y BP28. Estas son las dos
declaraciones que lo pintaban, las dos en `app/business-plan/styles/bp-visual.css`:

```css
.bp-glyph--soft   { background: var(--accent-soft); color: var(--slate-600); }
.bp-glyph--strong { background: var(--navy);        color: var(--sky); }
```

Existían desde BP21, cuando el icono se diseñó como una "chapa" -- un cuadrado
relleno con el glifo encima. `FunnelGlyph` recibía una prop `tone` que elegía
entre las dos, y casi todas las pantallas pasaban `tone="strong"`: de ahí el
cuadrado navy con el glifo claro.

**Por qué volvió tres veces.** En BP25 lo "arreglé" agregando una regla más
específica en vez de tocar la causa:

```css
table.piv td .bp-glyph--strong,
table.piv td .bp-glyph--soft { background: transparent; ... }
```

Eso sólo alcanzaba a las tablas. Las dos declaraciones de arriba seguían vivas,
así que en el catálogo, en la cabecera del preview, en el banner del perfil y en
el portal del plan el cuadrado seguía exactamente donde estaba. Anular una regla
desde abajo deja las dos en el archivo y la que gana depende de dónde se dibuje
el icono — es la mecánica que hizo falta repetir el pedido cuatro veces.

**El arreglo, ahora en el origen.** Se borraron las dos variantes, se borró la
anulación de BP25 (ya no hay nada que anular), y se borró la prop `tone` del
componente. `.bp-glyph` quedó sin `background`, sin `padding` y sin
`border-radius`: sólo `color: var(--navy)` y el `flex-shrink: 0` que impide que
el icono se aplaste cuando el nombre es largo.

Sacar la prop es la mitad que importa: mientras existiera, cualquier pantalla
nueva podía volver a pedir el cuadrado sin darse cuenta. Ahora no hay forma de
pedir otra cosa.

Alcanza a las nueve pantallas donde aparece: tarjeta del catálogo, cabecera del
preview, tarjetas de nodo del preview, tabla de funnels, tabla de nodos, banner
del plan en el perfil, cabecera del portal, tarjeta del nodo activo y —nuevo en
BP28— las tarjetas del Sequence builder.

### Los días del preview, con contexto

`Day 3` solo no dice de qué. No es una fecha ni el día 3 del plan: es el SLA
acumulado desde que arranca **ese nodo**, que es como está guardado.

Se le puso encabezado a las tres columnas (`Stage · Accountable · Due (day of
node)`) y una línea al pie que dice por qué son días y no fechas: en el preview
todavía no hay nada activado, y sin fecha de activación una fecha sería
inventada. En el plan activo esa misma columna ya son fechas reales, así que ahí
no cambió nada.

### El impacto sube a la cabecera del plan

Era un enlace subrayado al pie, menos visible que "Edit plan". Es la pregunta
que justifica el módulo -- si el plan sirvió -- y al pie quedaba como un detalle.

Ahora es un bloque propio junto al anillo de progreso, con la variación de
cierres contra la línea base congelada.

⚠ **El dato de la cabecera es el RESULTADO, no el avance.** El anillo ya dice
cuánto del plan se hizo; poner al lado otro número que también hable del avance
sería decir dos veces lo mismo. Se adelanta la variación de cierres, que es la
métrica que decide el veredicto; las otras tres están en la pantalla de impacto.

Si todavía no hay un mes completo posterior al enrolamiento, el botón se muestra
igual pero sin cifra: dice "no data yet" y explica qué falta. **No se rellena
con un cero ni con un −100%** -- es el mismo cuidado que tiene la pantalla de
impacto, y romperlo acá lo rompería igual.

El anillo y el bloque van dentro de un contenedor común: la cabecera es un flex
con `space-between`, y sueltos como dos hijos el del medio habría quedado
centrado entre el título y el borde.

### Los cuatro paneles de notas

Los cuatro están puestos, y cada uno escribe en su propia columna vía el mapa
`COLUMN` de `useNotes` -- no hay lógica repetida que pueda divergir:

| Nivel | Pantalla | Dónde exactamente | Columna |
|---|---|---|---|
| funnel | Catálogo | modal de preview, al pie | `funnel_key` |
| nodo | Portal del plan | tarjeta del nodo activo, bajo la lista | `enrollment_node_key` |
| stage | Portal del plan | dentro de la fila, tras el botón de notas | `enrollment_milestone_key` |
| loan officer | Perfil del LO | tras la barra de decisión | `employee_key` |

### El Sequence builder

Las tarjetas se veían chicas y apagadas al lado de las del catálogo. Se les dio
el mismo lenguaje que ya existe, con los mismos tokens: fondo `--canvas`, borde
de 1,5px, `--shadow-xs` y sombra al pasar, radio `--radius-lg`.

Jerarquía: el nombre pasó de 12px a 15px y es lo principal; el rango de días
dejó el coral y bajó a gris de apoyo; el conteo de stages quedó como etiqueta
chica en mayúsculas. Se sumó el icono del nodo al lado del nombre.

Subir, bajar y quitar quedan al 45% de opacidad y se aclaran al pasar por la
tarjeta o al recibir foco. Están siempre a la vista y son la acción secundaria:
lo primero que se hace en esta pantalla es leer la secuencia, no reordenarla.

La selección se marca por contorno, coherente con el resto del módulo desde
BP24 -- antes teñía el fondo de rose.

## Etapa BP29 — Progress to date, y el fin de "Qualifier 1 / Qualifier 2"

### Los nombres

`Qualifier 1` → **Current performance**: mide el pipeline del mes en curso.
`Qualifier 2` → **Future performance**: la actividad de hoy alimenta el pipeline
de los meses siguientes.

Sólo texto visible. En el código siguen llamándose `q1` y `q2`, y
`evaluateQualifier1` / `evaluateQualifier2` conservan su nombre: renombrar
funciones que aparecen en ocho archivos por un cambio de etiqueta habría
mezclado un rename mecánico con un cambio de lógica en el mismo commit.

### ⚠ Progress to date corrige un defecto real, no es un refinamiento

Hasta BP28, el acumulado del mes se comparaba contra la meta del MES ENTERO. El
día 2 de cada mes casi todo el mundo fallaba: se le exigía a alguien con dos
días de trabajo lo mismo que a fin de mes. **El veredicto del módulo dependía de
qué día se mirara la pantalla.**

Ahora se compara contra lo que corresponde llevar a hoy:

```
ritmo diario   = requerido del mes / 30
esperado a hoy = ritmo diario × día del mes
```

Verificado ejecutando el motor real con los datos de Ana Peña, benchmark 4, día
14 de agosto de 2026:

| métrica | tasa | requerido | ritmo/día | esperado a hoy | acumulado | % ritmo | banda |
|---|---|---|---|---|---|---|---|
| File Creations | 20,0% | 20 | 0,67 | 9,33 | 13 | 139% | on track |
| Credit Reports | 30,0% | 14 | 0,47 | 6,53 | 16 | 245% | on track |
| Applications | 66,7% | 6 | 0,20 | 2,80 | 6 | 214% | on track |

El efecto que se buscaba, con los mismos datos: llevando 2 file creations, el
día 2 da `on track` (esperado 1,33) y el día 30 da `at risk` (esperado 20). Con
la regla vieja los dos casos decían lo mismo, "short by 18".

### Las tres bandas, y por qué 85%

```
>= 100%   on track
85 – 99%  watch
 < 85%    at risk
```

Lo esperado es fraccionario (9,33) y lo real es entero. Sin margen, estar en 9
cuando toca 9,33 pintaría rojo a alguien que está a un tercio de unidad de la
meta — una distancia que ni siquiera se puede recorrer, porque no existe un
tercio de file creation. Los cortes, comprobados: 10 → 107% on track · 9 → 96%
watch · 8 → 86% watch · 7 → 75% at risk.

**Future performance falla con 2 o más en `at_risk`.** La regla de "2 de 3" no
cambió; lo que cambió es qué se cuenta.

### Tres decisiones cerradas, anotadas para que no se reinterpreten

1. **Treinta días fijos**, no los días reales del mes. Sesgo chico y constante
   —en febrero exige de menos, en los meses de 31 de más— aceptado a cambio de
   que la meta diaria sea la misma todo el año.
2. **Días corridos**, no hábiles. Un mes con más fines de semana pide lo mismo.
   Queda para revisar.
3. **El día sale del reloj del sistema**, y llega por parámetro: leerlo dentro
   del motor lo volvería impuro y no se podría probar sin viajar en el tiempo.

### Dos consecuencias que había que perseguir

**La barra de decisión explicaba la falla con la regla vieja.** Filtraba por
`meets` —contra la meta del mes entero— mientras el veredicto ya salía de las
bandas. Podía nombrar métricas que el veredicto no había contado, o callar las
que sí: alguien leería "short in 1 of 3" debajo de un veredicto que falló por
otras dos. Ahora filtra por `band === 'at_risk'` y muestra el esperado a hoy.

**El benchmark vigente necesitaba desempate.** La tabla dejó de tener PK
`(employee_key, effective_from)` — ahora la clave es sustituta y se puede
cambiar varias veces el mismo día. Con dos filas de la misma vigencia, ordenar
sólo por `effective_from` dejaba el ganador librado al orden en que PostgREST
devolviera las filas, que es indefinido. Se agregó `set_at` como segundo
criterio: gana la registrada después.

### Los colores

`--emerald-*` para on track, `--amber-*` para watch, `--rose-*` para at risk, en
los pasos 50/200/800 que ya visten las píldoras de estado. El relleno de la
barra **dejó de traer color propio**: antes era `--coral` a fondo pleno y
`--emerald-700` al llegar a la meta, los dos gritando más que los números. El
color se sacó en su origen y no se anuló desde abajo, para no repetir lo que
pasó con el fondo del icono.

La banda tiñe el BORDE de la tarjeta, nunca el fondo: teñir el fondo apagaría
las dos barras y las dos píldoras que viven adentro — el mismo error que costó
cuatro rondas con el icono.

## Etapa BP31 — la revisión conjunta deja de ser una copia

### El problema, y por qué era estructural

BP23 construyó la vista de grupo con su propio markup. Ninguno de los cambios
posteriores llegó ahí: en BP29 la regla de Future performance pasó al ritmo
prorrateado y sólo cambió en el perfil, así que el grupo se quedó mostrando el
acumulado contra la meta del mes entero — la lógica que ese cambio había
reemplazado.

No fue un descuido de nadie. **El diseño lo garantizaba**: con dos markups para
lo mismo, la única defensa era acordarse, y acordarse no es una defensa.

### ⚠ La decisión que hace posible compartir todo

`aggregateGroup` ahora devuelve un **`LoanOfficerRow` sintético**. El grupo tiene
exactamente la misma forma de dato que una persona, así que cada componente de
presentación recibe un `LoanOfficerRow` y no sabe —ni le importa— si detrás hay
una persona o tres.

La alternativa era pasarle a cada componente los campos sueltos, y con eso cada
uno tendría dos maneras de recibir sus datos: el mismo camino, un nivel más
abajo.

Los campos que no tienen sentido para un grupo van en su valor vacío y están
marcados en el código: `employeeKey: -1`, sin historial de benchmark, sin
intervención, sin plan activo. Falsearlos con datos de un miembro habría sido
peor que dejarlos vacíos.

Dentro de la fila, todo lo agregado está deduplicado: los préstamos abiertos por
`sourceLoanId`, los resueltos por lo mismo, y las filas de cierre por
`loan_number` — las mismas que abren los modales del gráfico.

### Qué se extrajo

`app/business-plan/components/performance.tsx`, ARCHIVO NUEVO. Nada de esto es
nuevo: salió del perfil del Loan Officer, donde vivía escrito a mano.

| Componente | Qué es |
|---|---|
| `ForensicCards` | las cinco tarjetas del mes, con sus modales y la marca de CTC |
| `ChannelBreakdown` | Banked / Brokered con el método de cada canal |
| `Q1Panel` | Avg 3M con actual, Avg 3M cerrados, Benchmark, GAP héroe, YTD |
| `FuturePerformanceCards` | las tres tarjetas con Progress to date y Month to date |
| `modalKindOfMetric` | qué modal abre cada métrica |

Y dos que ya existían y ahora también los monta el grupo: `MonthlyBarChart` (con
las barras clickeables y los tres segmentos del mes actual) y `LoanDetailModal`.

Las dos vistas montan los seis. Verificado por grep: cada uno aparece en
`lo/[employeeKey]/page.tsx` y en `group/[keys]/page.tsx`, en ningún otro lado, y
no hay copias.

Efecto colateral que confirma el diagnóstico: al extraer, aparecieron en el
perfil un `ForensicItem` local, siete imports y dos variables que ya no usaba
nadie. Todo eso era el markup que el grupo había duplicado.

### El grupo del branch 703, con los números reales

Benchmark del grupo 6 (4 + 1 + 1), acumulado de agosto sumado de los tres, día
14, ejecutando el mismo `evaluateQualifier2` que monta el perfil:

| métrica | requerido | ritmo/día | esperado a hoy | acumulado | % ritmo | banda |
|---|---|---|---|---|---|---|
| File Creations | 30 | 1,00 | 14,00 | 17 | 121% | on track |
| Credit Reports | 20 | 0,67 | 9,33 | 20 | 214% | on track |
| Applications | 9 | 0,30 | 4,20 | 6 | 143% | on track |

Cero en `at_risk` → Future performance pasa.

**Y acá se ve por qué esto importaba.** Con la lógica que el grupo tenía hasta
hoy —acumulado contra la meta del mes entero— Applications mostraba "6 of 9",
dos de las tres métricas quedaban por debajo, y Future performance **fallaba**.
El grupo estaba dando un veredicto distinto del que darían sus miembros con la
regla vigente.

### Lo que sí es propio del grupo, y se queda

El aviso de que el veredicto es informativo y no dispara ningún Business Plan;
la lista de miembros con su veredicto individual; el benchmark como suma con el
desglose visible en lugar del editor; y la nota sobre préstamos compartidos.

### ⚠ Sin panel de notas, y es deliberado

Coincido con la recomendación. Una nota necesita un destino con FK, y un grupo
NO es una entidad guardada: es una selección momentánea que vive en una URL.
`business_plan.note` tiene una columna por destino justamente para que la base
garantice que el objeto al que apunta existe (ver el SQL de BP20); un grupo no
tendría a qué apuntar, y la única forma de darle una sería inventar una tabla de
"grupos" que nadie pidió y que habría que mantener.

Si hace falta dejar constancia de una revisión conjunta, va como nota en el
perfil de cada miembro — que además es donde alguien la va a buscar después.

### Un rename que BP29 no había alcanzado

El título de Future performance en el perfil seguía diciendo "Qualifier 2":
BP29 buscó la cadena `'Qualifier 2 — '` y ahí el JSX está partido
(`Qualifier 2 —{' '}` con un botón dentro), así que no coincidió. Corregido.

## Etapa BP32 — la activación dejaba estado parcial

### Qué escritura fallaba, y por qué la pregunta tiene dos respuestas

**Ninguna, en el caso que produjo estas dos huérfanas.** El diagnóstico que
importa es más simple y peor: `business_plan.intervention` **no tiene FK contra
`enrollment`** — referencia a `dim_employee` y a `funnel`, no al plan — así que
**borrar un enrolamiento nunca se lleva su intervención**. Cada plan borrado a
mano durante las pruebas dejó una intervención activa flotando. No hizo falta
que fallara nada.

**Y aparte existía el defecto real que describe el brief**, reproducido contra
la base para no afirmarlo de memoria: con `intervention` como cuarta de cinco
escrituras y fuera del rollback, basta que falle la línea base para que el
enrolamiento se borre y la intervención sobreviva. Reproducido forzando un
`avg_closings` negativo:

```
intervention insert            -> HTTP 201
enrollment_baseline invalida   -> HTTP 400  (check avg_closings >= 0)
rollback viejo (solo enrollment)
   -> queda 1 intervencion activa con 0 enrolamientos   ← el estado reportado
```

### ⚠ Lo que encontró la prueba del arreglo, y era peor que el arreglo

Al verificar el rollback nuevo, el borrado de la intervención **no borraba
nada**: PostgREST devuelve **403** y la fila queda.

`business_plan.intervention` tiene policies de `select`, `insert` y `update`
desde BP5, y **ninguna de `delete`**; el grant tampoco la incluye. O sea: el
rollback que este mismo brief pedía agregar habría sido código inerte, y las
huérfanas seguían necesitando limpieza a mano desde el editor de SQL — que es
exactamente como se limpiaron.

Se arregla en los dos lados: la migración agrega la policy que falta, y mientras
no esté aplicada el código cae a marcar la fila como `closed`, que es lo que la
sesión de la app sí puede hacer. Alcanza para el invariante que importa: una
intervención `closed` no cuenta como atendido, así que nadie queda marcado como
que tiene plan cuando no lo tiene.

### El orden nuevo

```
1 enrollment · 2 nodos · 3 stages · 4 línea base · 5 intervención
```

`intervention` pasó de cuarta a **última**, por dos razones distintas:

- es la fila menos importante y la más barata de reponer;
- yendo última, **cualquier fallo anterior ni siquiera la escribe**, así que el
  caso frecuente deja de depender de que el rollback funcione. Es el arreglo de
  verdad; el rollback es defensa en profundidad.

Y entra al rollback, que ahora cubre las cinco: la intervención explícitamente
—no cuelga de nada—, y nodos, stages y línea base por cascada al borrar el
enrolamiento. Cada borrado en su propio `try`: si el primero falla por red, el
segundo tiene que intentarse igual, o deshacer dejaría más residuo que el que
limpia.

### Los dos SQL, sin ejecutar

`2026-08-intervention-one-active.sql` — cierra duplicados, crea
`intervention_one_active_idx` (mismo patrón y mismo nombre que
`enrollment_one_active_idx`), agrega la policy de delete que falta, y repone las
dos intervenciones que les faltan a los enrolamientos 24 y 26 **desde la propia
fila del enrolamiento**: la fecha y el autor salen de ahí, porque inventar un
`now()` diría que se los atendió hoy.

No se agrega una FK a `enrollment`, y el motivo está en el diseño de BP5: el
estado `reviewed` —"alguien lo miró, todavía sin funnel"— existe sin
enrolamiento y es el que alimenta el "Revisado" del Status del branch. Una FK
obligatoria lo volvería imposible.

`2026-08-activate-funnel-rpc.sql` — la solución definitiva.

### Sobre la función: sí, vale hacerla ahora

Está escrita. El rollback manual cubre el rechazo de la base, que es el caso
frecuente, pero no es una transacción: si se corta la red entre escribir y
deshacer queda residuo, si el navegador se cierra no hay quien deshaga, y entre
una cosa y otra hay un instante en que otro usuario ve un estado que no debió
existir.

⚠ **La función no calcula nada: recibe el plan ya armado como `jsonb`.** Es la
decisión de diseño que importa y va contra el instinto. El plan lo arma
`buildEnrollmentPlan` —función pura, con su lógica de SLA acumulados, probada
sin base— y la línea base sale del lote activo de Commercial Activity, que la
función no puede leer sin duplicar toda la resolución de alias. Reescribirlo en
SQL sería tener la misma regla en dos lenguajes, y la que se olvide de
actualizar es la que decidiría las fechas de alguien: el mismo defecto que BP31
tuvo que arreglar en la vista de grupo. El trabajo de la función es la
atomicidad, no la lógica.

`security invoker`, no `definer`: con `definer` correría con los permisos de su
dueño y sería un agujero alrededor de RLS. `activated_by` sale del JWT y no de
un argumento, para que nadie pueda firmar una activación con el email de otro.

**El cambio en la app va en su propio paso, después de que la función esté
aplicada.** No se dejan los dos caminos conviviendo: dos formas de activar es
exactamente la duplicación que BP31 tuvo que deshacer.

---

## Auditoría — Unificación de branches/managers (pipeline_forecast vs org)

Auditoría de solo lectura, sin cambios de código ni de Supabase. Evalúa si conviene
unificar `pipeline_forecast.branches`/`branch_managers` (que consume Forecast) con
`org.dim_branch`/`employee_branch` (que consume Business Plan, vía `org.employee_alias`
para resolver nombres — ver Etapa BP1 más arriba). No decide nada: la decisión final
queda para quien apruebe infraestructura.

Los datos reales de `org` (bloqueados en el primer intento de esta auditoría por
permisos de la credencial usada) fueron confirmados aparte, corriendo las consultas
directamente en Supabase. Esta sección refleja esos datos ya verificados.

### Acceso a `org` / `business_plan`

Ambos schemas tienen RLS y solo permiten lectura a sesiones `authenticated` con el
claim `commercial_activity` — **por diseño, no es un bloqueo a resolver.** Ninguna key
pública (`anon` ni `service_role`) puede consultarlos directamente vía PostgREST; así
quedó confirmado también en el primer intento de esta auditoría (`permission denied
for schema org`, código `42501`, consistente en las cuatro tablas). Cualquier consulta
futura contra `org`/`business_plan` debe solicitarse a quien tiene acceso admin, o
ejecutarse desde el SQL Editor del dashboard de Supabase.

### 1. Estructura real (corrige el supuesto inicial de esta auditoría)

- `org.dim_branch` usa `branch_code` como clave; `pipeline_forecast.branches` usa
  `code`. No se llaman igual — cualquier join/comparación tiene que mapear un nombre de
  columna al otro explícitamente, no asumir que coinciden.
- `org.employee_branch` es una tabla **puente** (`employee_key`, `branch_key`,
  `role_in_branch`) — no contiene el nombre del manager directamente.
- El nombre completo vive en `org.dim_employee.full_name`. Comparar managers requiere
  el join `employee_branch → dim_employee` (por `employee_key`), no una lectura directa.
- `org.employee_alias` mapea `(source_system, name_raw) → employee_key`: **117 filas
  para 65 personas** — no es una fila por persona, es una fila por cada forma distinta
  en que una fuente nombra a esa persona (confirma el diseño ya descrito en la Etapa
  BP1: una persona puede tener varios alias, de varias fuentes).

**`pipeline_forecast.branches`**

| Columna | Tipo | Constraint |
|---|---|---|
| `code` | text | PK |
| `label` | text | NOT NULL |
| `sort_order` | integer | NOT NULL |
| `active` | boolean | default `true` |
| `created_at` | timestamptz | default `now()` |

**`pipeline_forecast.branch_managers`**

| Columna | Tipo | Constraint |
|---|---|---|
| `branch` | text | PK, FK → `branches.code` |
| `manager_name` | text | NOT NULL |

**`org.dim_branch`**

| Columna | Tipo | Constraint |
|---|---|---|
| `branch_key` | bigint | PK |
| `branch_code` | text | NOT NULL |
| `is_division_branch` | boolean | NOT NULL, default `false` |
| `is_active` | boolean | NOT NULL, default `true` |
| `notes` | text | — |

**`org.employee_branch`**

| Columna | Tipo | Constraint |
|---|---|---|
| `employee_key` | bigint | PK compuesta, FK → `dim_employee.employee_key` |
| `branch_key` | bigint | PK compuesta, FK → `dim_branch.branch_key` |
| `role_in_branch` | text | PK compuesta |

**`org.employee_alias`**

| Columna | Tipo | Constraint |
|---|---|---|
| `source_system` | text | PK compuesta |
| `name_raw` | text | PK compuesta |
| `employee_key` | integer | FK → `dim_employee.employee_key` |
| `match_method` | text | — |

**Diferencia estructural de fondo:** `pipeline_forecast` usa el código de branch
(texto) como clave directa en las dos tablas (`branches.code` es PK,
`branch_managers.branch` es FK a esa PK). `org` en cambio usa una clave subrogada
(`branch_key`, `employee_key`, ambos `bigint`) y resuelve el código de branch/nombre de
persona como un atributo aparte, con `employee_branch` como tabla puente
many-to-many-por-rol y `employee_alias` como capa adicional de resolución de nombres.
Son dos modelos de datos distintos, no solo dos copias de la misma tabla — unificar no
es un simple `UNION`, implica decidir cuál de los dos modelos sobrevive (ver Riesgos).

### 2. Comparación de branches

`org.dim_branch` tiene **22 branches**; `pipeline_forecast.branches` tiene **14**.

Los 8 de diferencia — **700, 701, 702, 718, 721, 741, 771, "Branch Out of Division"**
— tienen `is_division_branch = false` en `org`. **Forecast correctamente no los
incluye — no es un error ni una brecha a corregir**, es el comportamiento esperado: la
lista de `pipeline_forecast.branches` siempre fue, de hecho, la lista de branches de
división, aunque nunca tuvo una columna explícita `is_division_branch` que lo
declarara.

Los 14 branches de división coinciden en ambas fuentes.

### 3. Comparación de managers (de los 14 branches de división)

| Branch | pipeline_forecast | org | Clasificación |
|---|---|---|---|
| 703 | Ana Zegarra | **Ana Peña** | **Discrepancia real, sin resolver.** `org` tiene el nombre canónico corregido, coincide con el email registrado (`ana.pena@`). `pipeline_forecast` conserva el nombre anterior, sin actualizar — no es un caso ya resuelto por alias, es una desincronización pendiente. |
| 733 | Stephanie García | Stephanie Garcia | Diferencia solo de tilde — misma persona, sin ambigüedad. |
| 711 | Ana Manjarres | Ana Manjarres | Ya sincronizado en ambas fuentes. |
| 707 | Armando Tejeda | Armando Tejeda | Coincide |
| 710 | Pier Laino | Pier Laino | Coincide |
| 716 | Pier Laino | Pier Laino | Coincide |
| 724 | Mariano Claudio | Mariano Claudio | Coincide |
| 728 | Abel Berrocal | Abel Berrocal | Coincide |
| 747 | Galo Rizzo | Galo Rizzo | Coincide |
| 760 | Julymar Castro | Julymar Castro | Coincide |
| 770 | Steve Badovinac | Steve Badovinac | Coincide |
| 776 | Silvio Arteaga | Silvio Arteaga | Coincide |
| 777 | Jonathan Valenzuela | Jonathan Valenzuela | Coincide |

**La desincronización real es menor de lo que sugería el supuesto inicial: de 14
branches de división, solo 2 tienen un nombre de manager distinto entre fuentes** (703
real, 733 solo de formato) — los 11 restantes coinciden exactos.

### Caso Affinity

`pipeline_forecast.branch_managers` tiene manager asignado para Affinity (**Pier
Laino**). `org` no tiene manager asignado para Affinity, y Affinity está marcado como
**no de división por decisión de negocio** (no un branch de división sin cargar, sino
uno que se decidió que no lo es).

**Es una diferencia de criterio, no un error de datos** — se documenta así, sin
tratarla como una discrepancia a corregir junto con 703/733. Cualquier unificación
futura tiene que resolver primero ese criterio de negocio (¿Affinity debería tener
manager en el modelo unificado o no?) antes de tocar el dato.

### 4. Consumidores en código (grep estático, sin ejecutar la app)

| Tabla | Archivo | Función/componente | Uso |
|---|---|---|---|
| `pipeline_forecast.branches` | `app/pipeline/page.tsx` | efecto de carga inicial (`useEffect`, `getForecastDb().from('branches').select('code')`) | Construye `knownBranches: Set<string>` — whitelist para no ocultar una fila de branch en cero en `PivotTable.tsx` (ver auditoría anterior sobre Branch 711 en este mismo documento/sesión). |
| `pipeline_forecast.branch_managers` | `app/pipeline/page.tsx` | mismo efecto (`getForecastDb().from('branch_managers').select('branch, manager_name')`) | Construye `branchManagers: Map<string, string>`, pasado a `PivotTable.tsx` para mostrar el nombre del Branch Manager en la columna "Branch Manager" de las tablas Executive. |
| `org.dim_branch` | `lib/business-plan/loadData.ts` | `loadBusinessPlanData()` (o equivalente, carga inicial del módulo) | Roster canónico de branches para todo Business Plan — Branch Portfolio, páginas de branch/LO. |
| `org.employee_branch` | `lib/business-plan/loadData.ts` | misma función | Relación empleado↔branch↔rol (`role_in_branch='LO'`/`'BM'`) — arma las listas de Loan Officers y Branch Managers de cada branch. |
| `org.employee_alias` | `lib/business-plan/loadData.ts` | misma función, consumido por `lib/business-plan/aliasIndex.ts` (`buildAliasIndex`) | Resuelve el mismo empleado citado con nombres distintos entre `roster`/`salesforce`/`slquery` (ver Etapa BP1). Búsqueda por clave exacta, sin heurísticas de similitud — a propósito, para no fusionar personas distintas con nombres parecidos. |
| `org.dim_employee` | `lib/business-plan/loadData.ts` | misma función | Fuente de `full_name` y flags (`is_loan_officer`, `is_branch_manager`, `is_active`, etc.) para cada `employee_key`. |

**Confirmado explícitamente: `app/pipeline/page.tsx` (Forecast) NO importa ni consume
`org.employee_alias` en ningún punto** — ni directa ni indirectamente (no importa nada
de `lib/business-plan/**`). Esto ya está documentado como deuda deliberada en la Etapa
BP5 de este mismo documento ("Que Forecast consuma la tabla es una etapa aparte"),
aunque esa nota se refiere a `business_plan.settings` (tasas de pull-through) — el mismo
principio aplica acá: Forecast tiene su propia fuente de branches/managers, separada e
independiente de todo el mecanismo de resolución de alias que ya existe para Business
Plan.

### Recomendación (registrada, sin ejecutar — la decisión final es de quien apruebe infraestructura)

Con los datos ya confirmados, la desincronización real entre las dos fuentes es menor
de lo esperado: solo 2 nombres de manager distintos entre los 14 branches de división
(uno real sin resolver, uno solo de formato), más el caso de criterio de Affinity —
nada catastrófico.

**El problema estructural de fondo persiste de todos modos:** hay dos fuentes de
verdad, y cada cambio de manager requiere actualizarse en ambos lados por separado —
así fue como 703 quedó desactualizado en `pipeline_forecast` mientras `org` ya tenía el
nombre corregido.

`org` es la fuente más completa — tiene el roster completo de la organización, el
mecanismo de alias de nombre ya construido y en producción (Etapa BP1), y las
correcciones ya confirmadas (703). Por lo tanto, **a largo plazo Forecast debería leer
de `org` en vez de mantener su propia copia** en `pipeline_forecast.branches`/
`branch_managers`.

**Se decide NO implementar esto ahora:** es una etapa aparte, toca
`app/pipeline/page.tsx`, que ya tiene otros cambios en curso en esta misma rama
(persistencia de Loan Detail). Queda anotado para una etapa futura.

### Riesgos de unificar en una sola fuente

- **Modelos de datos incompatibles.** `pipeline_forecast` usa el código de branch como
  clave de texto directa (`code`); `org` usa claves subrogadas (`branch_key`/
  `employee_key`, `bigint`) y resuelve el código (`branch_code`) y el nombre
  (`dim_employee.full_name`) como atributos aparte. Migrar `app/pipeline/page.tsx` a
  leer de `org` implica cambiar de un `SELECT` simple por código a un join a través de
  `employee_branch` → `dim_branch`/`dim_employee`, no un cambio trivial de nombre de
  tabla.
- **Acceso.** `org` hoy solo se lee con sesión de usuario autenticado (RLS por el claim
  `commercial_activity`), nunca con `service_role` — confirmado, no es un supuesto. Si
  Forecast pasara a leer de `org`, tendría que adoptar el mismo patrón de autenticación
  que ya usa `getServerClient()`/`getForecastDb()` para `pipeline_forecast`, y confirmar
  que el usuario de Forecast realmente tenga ese claim, o la migración rompería la
  carga de branches/managers para quien no lo tenga.
- **`org.employee_branch` permite más de un manager por branch** (ya documentado en la
  Etapa BP1: "el 716 tiene Pier Laino + Nelson Calderón. Nunca se asume uno solo").
  `pipeline_forecast.branch_managers` asume exactamente un manager por branch (PK
  simple sobre `branch`). Unificar sin resolver esto rompería el caso de branches con
  más de un BM — Forecast tendría que decidir cuál mostrar, o rediseñar la columna
  "Branch Manager" para aceptar más de un nombre.
- **Affinity necesita una decisión de negocio explícita antes de unificar** (ver Caso
  Affinity arriba) — hoy tiene manager en `pipeline_forecast` pero no en `org` (que lo
  marca fuera de división por decisión de negocio, no por falta de datos). Un modelo
  unificado tiene que decidir si Affinity conserva su Branch Manager o no, antes de
  migrar el dato, no después.
- **117 filas de alias para 65 personas** en `org.employee_alias` — el mecanismo de
  resolución de nombres es más complejo que un simple `nombre viejo → nombre nuevo` por
  persona; cualquier consumo de esta tabla desde Forecast necesita el mismo criterio de
  coincidencia exacta por `(source_system, name_raw)` que ya usa
  `lib/business-plan/aliasIndex.ts`, no una heurística propia.

### Puntos de Verificación

- [ ] Confirmar que el branch 703 se actualice a "Ana Peña" en `pipeline_forecast.branch_managers` cuando se aborde la etapa de unificación — no ahora, no como parte de esta rama.
- [ ] Confirmar que el branch 733 se normalice el acento ("Stephanie García" → "Stephanie Garcia", o viceversa, según cuál fuente se declare canónica) cuando corresponda.
- [ ] Revisar el criterio de negocio de Affinity (branch con manager en Forecast pero fuera de división en `org`) antes de cualquier cambio futuro de unificación — no es un error de datos, es una decisión intencional que la unificación tiene que respetar o revisar explícitamente, no sobrescribir.

## Etapa S1 — escritura atómica de snapshot + `data_as_of`

Cimiento para el histórico diario del Executive Branch Forecast (S2/S3, no en esta etapa).
Arregla dos defectos verificados contra producción, no supuestos:

1. **Escritura no transaccional.** `app/api/pipeline/parse/route.ts` insertaba el snapshot y
   después los hijos en tandas de 500, sin transacción. El rol `authenticator` tiene
   `statement_timeout=8s`. El snapshot **13** en producción quedó con 80 filas en
   `pipeline_loans` y **0** en `pipeline_resolved_loans` (el resto trae 711-754) — y aun así
   `is_active=true`: alguien vio un pipeline sin cerrados sin ninguna advertencia.
2. **`snapshot_date` era la fecha de subida, no la del dato.** `new Date().toISOString().slice(0,10)`.
   Los snapshots **9 y 11** (subidos el 2026-08-03) son el mismo export
   `Forecast - Pipeline Report-2026-07-30-...` que el snapshot 6 — datos del 30 de julio
   archivados como si fueran del 3 de agosto.

### `lib/pipeline/dataAsOf.ts` — nuevo

`parseDataAsOf(fileName)` extrae de `file_name` el instante en que Salesforce generó el
export, en vez de usar la fecha de subida. Dos formatos, **cada uno en una zona horaria
distinta**:

- Formato A, `report<13 dígitos>.xls`: los dígitos son epoch **ms UTC** — directo.
- Formato B, `Forecast - Pipeline Report-YYYY-MM-DD-HH-MM-SS.xlsx` (con sufijo opcional
  ` (1)`, ` (2)`...): el sello es hora **local America/Chicago**, hay que convertirlo a UTC.
  Sin instalar una librería de zonas horarias (America/Chicago no tiene offset fijo: CDT=-5 en
  verano, CST=-6 en invierno) — se resuelve por búsqueda determinista: se prueban los 2
  offsets posibles y se usa el que, formateado de vuelta a hora de Chicago con
  `Intl.DateTimeFormat`, reproduce exactamente el sello local del nombre de archivo.

Regla dura: formato no reconocido, o fecha fuera de rango (anterior a 2020-01-01 o posterior a
`ahora + 24h`), devuelve `{ dataAsOf: null, source: 'unknown' }` — **nunca** cae a `new Date()`
como fallback silencioso, que es exactamente el bug que esta etapa arregla. `dataAsOf === null`
y `source === 'unknown'` van siempre juntos.

Verificado en `scripts/test-dataAsOf.ts` (mismo patrón que `test-aggregate.ts`/`test-parser.ts`,
no hay test runner en el proyecto — confirmado en `package.json` antes de asumirlo) contra los 8
casos reales de producción del brief S1 + 1 sintético de invierno (CST, sin archivo real todavía
para ese caso). Los 10 pasan.

### `app/api/pipeline/parse/route.ts` — reescrito

El bloque de persistencia (`update is_active=false` → `insert` en `pipeline_snapshots` →
`insertInBatches` ×2, sin transacción) se reemplaza por una sola llamada a la función SQL
`pipeline_forecast.save_pipeline_snapshot()` — ya aplicada y verificada en la base por fuera de
esta etapa (firma confirmada contra `pg_proc` antes de escribir el código: coincide exacto con
el contrato del brief, `SECURITY INVOKER`). Garantías que la función asume, y que por eso no se
replican en TS: todo en una transacción, `snapshot_date` derivado de `data_as_of` en
America/Chicago, `snapshot_id` asignado por la función (los mapeadores `toPipelineLoanRow`/
`toResolvedLoanRow` dejan de recibirlo).

**Compuerta de activación** — el arreglo puntual del snapshot 13:
`shouldActivate = openLoans.length > 0 && resolvedLoans.length > 0`. Si alguna mitad vino
vacía, el snapshot se guarda igual (`p_activate=false`, no se pierde el trabajo) pero no se
activa, con un warning explícito y `needsReview: true` en la respuesta — visible en vez de
silencioso. Un `dataAsOf` nulo también agrega warning, pero **no** bloquea la activación: es un
nombre de archivo no estándar, no un archivo roto. Un fallo de persistencia sigue sin romper la
respuesta (mismo comportamiento de antes): el usuario ya tiene el archivo parseado esta sesión,
el error va a `warnings` con `errorMessage(err)`.

### Verificación — qué se hizo y qué se delegó

`tsc`/`eslint` limpios. La tabla de los 9 casos reales (+1 sintético) de `parseDataAsOf` corrió
completa (ver arriba). La firma de la RPC se confirmó leyendo `pg_proc` en `simoOS-prod` — sin
escribir nada — antes de dar por buena la Tarea 2.

**No se hizo desde este entorno, a pedido explícito:** ninguna escritura de prueba contra
producción. La carga real contra la rama (punto 3 del brief) queda **delegada** — la corre
Isabella en localhost con datos reales. La prueba negativa (punto 4, `shouldActivate=false`)
también queda **delegada** — la corre el revisor por SQL directo, con limpieza posterior. Esta
etapa no cierra sin esos dos resultados; los reporta quien los corra.


### Cierre de S1 (2026-08-20) — merge de main y verificación end-to-end

**El merge chocó UN archivo, no dos.** `app/api/pipeline/parse/route.ts` no chocó:
`git log $(git merge-base main feat/s1-snapshots)..main -- app/api/pipeline/parse/route.ts`
sale vacío. Main no tocó ese archivo desde la base.

⚠ **`loan_type`, `loan_program` y `production_support_note_history` no están en
main.** `git grep` sobre todo el árbol de main da cero. Viven en
`feat/forecast-combined-drilldown`, que sigue sin mergear. Así que el requisito
"los dos cambios tienen que sobrevivir" es vacío para este merge: no hay nada de
main que preservar en ese archivo.

⚠ **Y la RPC NO persiste esos tres campos. Verificado.** Se la llamó con las tres
claves presentes en el jsonb y con un `data_as_of_source` válido; devolvió 200,
insertó las filas, y las tres columnas quedaron en **null**. Las columnas SÍ
existen en las dos tablas hijas — la base va adelante de main — pero la función
mapea una lista explícita que no las incluye, así que **descarta las claves en
silencio**.

Eso es peor que un parámetro faltante: si `feat/forecast-combined-drilldown` se
mergea encima de S1 sin ampliar la función, la app parece funcionar y deja de
persistir tres columnas sin un solo error. **Ampliar la función la hace el
revisor**; hasta entonces no se toca el mapper de esta rama, porque agregar
claves que la función tira sería escribir código que finge guardar algo.

**Los valores de `data_as_of_source` que la función acepta** son exactamente los
tres que produce `parseDataAsOf` — `filename_epoch`, `filename_label`,
`unknown` — más `null`. Cualquier otro string se rechaza con
`P0001 data_as_of_source invalido`. Comprobado uno por uno.

#### El lado de lectura, que faltaba

S1 guardaba `data_as_of` y **nadie lo leía**: `/api/pipeline/latest` devolvía
sólo `uploaded_at`, y `app/pipeline/page.tsx` lo mostraba como fecha del
snapshot. El arreglo estaba en la base y no llegaba a la pantalla — el mismo
paso que este proyecto ya se olvidó cuatro veces. Ahora el select trae
`data_as_of` y `data_as_of_source`, y la página usa la fecha del dato con
fallback a la de subida para los archivos de nombre no estándar.

También se dejó de descartar el retorno de la RPC: devuelve
`{ snapshot_id, snapshot_date, loans_inserted, resolved_inserted, is_active }` y
ahora viaja en la respuesta como `saved`. Con los conteos a la vista, un caso
como el del snapshot 13 se ve desde el cliente en vez de descubrirse semanas
después mirando la base.

#### ⚠ Un borrado accidental durante la verificación, y cómo se recuperó

Un script de prueba tenía un fallback: "si la respuesta no trae `snapshot_id`,
usá el último id de la tabla". La llamada falló por un `data_as_of_source`
inventado, el fallback resolvió al snapshot **activo de producción (57)**, y la
limpieza lo borró.

Se recuperó reactivando el snapshot **56**, que es el mismo export
(`Forecast - Pipeline Report-2026-08-20-09-47-31.xlsx`), con el mismo
`row_count` 880 y sus hijos intactos (106 abiertos + 774 resueltos). No se
perdió ningún dato; se perdió una fila duplicada.

La lección quedó en los scripts siguientes: **se borra únicamente el id que
devolvió la función, y si no lo devolvió no se borra nada.** Un fallback a
"el último" en un script de limpieza es una bomba con temporizador.

De paso quedó a la vista que `pipeline_snapshots` permite DELETE a
`authenticated` y que no hay índice de snapshot activo único — el snapshot 51,
por ejemplo, tiene 0 hijos, otra instancia del defecto que S1 arregla.

### S1b (2026-08-20) — los tres campos, y el merge a main

La función ampliada por el revisor ya acepta `loan_type`, `loan_program` y
`production_support_note_history`. Y el mapper **no hizo falta editarlo**: los
tres campos llegaron con la segunda pasada de main, que trae el merge de
`feat/forecast-combined-drilldown`. Git combinó bien las dos mitades — los
mappers de main con los tres campos, y la llamada RPC de S1 sin `snapshotId` —
pero se leyeron las dos funciones enteras antes de confiar en que no se quejara.

**Carga real con los tres campos poblados**, snapshot 62, archivo
`Forecast - Pipeline Report-2026-08-20-16-05-00.xlsx` con las tres columnas
agregadas al demo:

```
saved: {"is_active":true,"snapshot_id":62,"loans_inserted":47,"resolved_inserted":17}
data_as_of=2026-08-20T21:05:00+00:00  src=filename_label

pipeline_loans          47 filas · loan_type NULL=0 · loan_program NULL=0 · nota NULL=0
pipeline_resolved_loans 17 filas · loan_type NULL=0 · loan_program NULL=0 · nota NULL=0
```

`/api/pipeline/latest` los devuelve en las dos mitades
(`loanType`, `loanProgram`, `noteHistory`).

⚠ Un detalle que conviene saber: el parser cae a `''` -- cadena vacía, no
`null` -- cuando el archivo no trae esas columnas, porque son opcionales. Así
que "no vino la columna" y "vino vacía" se guardan igual. No se cambió: tocar
esa coerción es del lado del parser y afecta a otras etapas.

#### La anomalía de zona horaria: sigue siendo un solo caso

De los 46 snapshots, **uno** tiene `data_as_of` posterior a `uploaded_at`: el
**56**, por 50 minutos. El dato dice 09:47:31 CT y la subida fue 08:57:41 CT.
Si ese export vino con hora del **Este**, el dato serían las 08:47:31 CT — diez
minutos antes de la subida, que es coherente.

El reparto por formato apoya la hipótesis: los 22 de formato `filename_epoch`
no tienen ni un caso (epoch es UTC sin ambigüedad) y la anomalía aparece sólo
en uno de los 24 de `filename_label`. No hay casos nuevos.

#### Cinco snapshots menos, y no fue esta rama

La tabla pasó de 51 a 46 filas entre el cierre de S1 y S1b. Los cinco que
faltan son **47, 48, 49, 50 y 51**: exactamente los cinco que tenían **cero
hijos**, el defecto de la clase del snapshot 13. No quedaron filas huérfanas en
ninguna de las dos tablas hijas, no se perdió ningún snapshot con datos, y los
46 restantes tienen `data_as_of` derivado.

No lo hizo esta rama -- su única escritura fue el snapshot 62, borrado al
terminar. Queda anotado como observación para que quien aplicó las migraciones
lo confirme.

## Etapas BP33 y BP34 — el pipeline del perfil no filtraba por mes, y se quita el Status

### ⚠ BP33 — dónde estaba el filtro, y por qué unas vistas lo tenían y otras no

El filtro del mes existía **sólo en el camino de la proyección**, y escrito por
separado en dos lugares:

1. `projectCurrentMonth` (qualifiers.ts): contaba `totalPipeline` y
   `healthyPipeline` sobre **todos** los préstamos abiertos y recién entonces
   hacía `if (loan.closeMonth !== currentMonth) continue;` para el tramo del
   forecast. O sea: dos poblaciones distintas dentro de la misma función.
2. `LoanDetailModal`: los modales de `projected` y `forecast` repetían la
   condición a mano; los de `pipeline` y `healthy` no filtraban nada.

Y no era un descuido: había un comentario declarándolo intencional —"cuentan
TODO el pipeline abierto, cierre cuando cierre"—. La decisión del negocio
cambió, porque la proyección se compara contra un benchmark **mensual**: contar
pipeline que cierra en octubre contra un objetivo de agosto sobreevalúa a la
persona.

Medido contra el snapshot activo (66): de **110** préstamos abiertos sólo **65**
cierran en agosto. **45 eran de meses futuros — el 41%.**

#### El arreglo: una sola definición, en el punto donde se arma la lista

`closesInMonth(loan, yearMonth)`, exportada de `qualifiers.ts`, y aplicada en
`loadData` justo donde se construye `openLoansByEmployee`. Ese es el único punto
por el que pasan todas las vistas del módulo, así que ninguna puede quedarse
afuera: las cinco tarjetas, el desglose Banked/Brokered, los modales, el
directorio del branch, el Branch Portfolio y la revisión conjunta.

Con eso desaparecieron las dos copias de la regla: el `continue` a mitad del
bucle de `projectCurrentMonth` y las condiciones del modal. Y como la función ya
no mira meses, **se le quitó el parámetro `currentMonth`** — un parámetro que
nadie lee es una mentira sobre lo que hace la función, y habría dejado la puerta
abierta a que alguien volviera a filtrar adentro.

#### `estClosingDate` y no `closeMonth`

`closeMonth` lo **deriva** el parser y queda en `''` cuando la derivación falla:
un préstamo así desaparece de todos los meses, en silencio. `estClosingDate` es
el dato crudo, y es además el criterio que ya usa Forecast en `splitHealthyTotal`
— así los dos módulos definen "el pipeline del mes" igual.

Verificado: sobre las 110 filas del snapshot los dos criterios **coinciden**,
cero discrepancias. El cambio de campo no mueve ningún número por sí solo; sólo
cierra el agujero y elimina el modo de fallo silencioso.

#### Los veredictos que cambian: 3

Corrido con el motor real sobre el snapshot activo: **Aimmee buendia**, **Julymar
Castro** y **Nathan Martinez**, los tres `on_track → watch`. Ninguno llega a
`on_risk`.

Estaban sobreevaluados porque se les contaba pipeline que no cierra este mes.
Ejemplo: Nathan pasa de 16 préstamos a 9, y su GAP de +0,2 a −0,1 — cruzaba el
cero por préstamos de septiembre.

### BP34 — se quita el Status de intervención

Aparecía **dos veces en la misma pantalla** (cabecera del branch y tarjeta
STATUS) y el texto no decía de qué era pendiente. Se quitaron los tres lugares:
esos dos más la columna Status del Branch Portfolio. La tarjeta de KPIs pasa de
cuatro a tres.

⚠ **Se quitó de la interfaz, no del modelo.** `business_plan.intervention` se
sigue leyendo y escribiendo igual — la barra de decisión sigue registrando
"revisado" y la activación de un funnel sigue creando su intervención.
`branchStatus`, `branchStatusLabel` y `branchStatusClass` siguen existiendo y
calculándose, con un comentario en `intervention.ts` que explica por qué no son
código muerto: el indicador vuelve, en otra forma, en un módulo aparte.

---

## Aprendizajes de sesión — CTC/Closing (punto vs. modal), columna Channel, SL Query sin DELETE

Consolida tres piezas de contexto que quedaron repartidas en comentarios de
código y briefs de tareas, para que no haya que reconstruirlas leyendo el
historial de commits la próxima vez.

### CTC/Closing — el punto, el modal y el contador de texto son 3 poblaciones distintas, a propósito

Las tres piezas leen el mismo bucket combinado "Closing" (fusiona los
milestones crudos "Clear To Close" y "Closing"), pero cada una con una
población distinta:

- **El punto (`CtcDot`, `PivotTable.tsx`)** -- indicador de PRESENCIA. Usa
  `closingCount` = `bucketTotal.Closing`, SIN filtrar por healthy. Un loan
  Delayed en Closing SÍ prende el punto. Esto es intencional y preexistente
  (ver Etapas F5k/UX10/UX12 arriba) -- el punto contesta "¿hay algo en
  Closing en esta fila?", no "¿cuánto se proyecta que cierre?".
- **El modal que abre el punto al hacer click** -- SÍ filtra
  `healthy === true` antes de mostrar nada (`ctcClosingEligibleLoans()` +
  `buildCtcClosingSections()`, `PivotTable.tsx`). Agrupa los loans elegibles
  por milestone real, con un header de sección ("Clear to Close:"/
  "Closing:") por cada uno que tenga al menos un loan -- una sección con
  cero loans no se muestra. El tooltip del punto (`title`) usa la MISMA
  población que el modal (mismas 2 funciones) -- si alguna vez el tooltip
  vuelve a decir un número o milestone que no coincide con lo que el modal
  muestra, la causa más probable es que alguien reintrodujo un cálculo
  separado en vez de reusar esas 2 funciones.
- **El contador de texto ("X CTC + X Closing", subtotal/tarjeta Closed)**
  -- también healthy-only (`splitCtcAndClosing`, `lib/pipeline/aggregate.ts`),
  misma población que el modal, pero es un cálculo independiente -- no
  comparte código con `ctcClosingEligibleLoans`/`buildCtcClosingSections`,
  así que si se toca uno hay que verificar el otro a mano contra datos
  reales.

**ADVERTENCIA:** no "corregir" el punto (`closingCount`, sin filtrar) para
que coincida con el modal o el contador (healthy-only) sin una decisión de
negocio explícita. Son métricas con propósitos distintos -- presencia vs.
proyección real -- y ya hubo confusión real sobre esto en sesión (el punto
encendido por un loan Delayed que no aparecía en el desglose de texto,
tratado al principio como si fuera un bug, cuando es el comportamiento
esperado).

### Channel column en LoanDetailModal — aditivo, no exclusivo con `sections`

- `showChannelColumn?: boolean` (default `true`) en `LoanDetailModalProps`
  controla si la columna "Channel" se renderiza -- se OMITE del DOM entera
  (`<col>`/`<th>`/`<td>` condicionales), no se oculta con CSS.
- Se muestra (`showChannelColumn` en `true`, explícito o por default) en:
  Total Pipeline, Healthy Pipeline, Closed, y sus 3 variantes de Combined
  Total by Branch -- todos los openers de `PivotTable.tsx`.
- NO se muestra en Milestone Matrix (`TabMilestoneMatrix.tsx` pasa
  `showChannelColumn={false}` explícito) -- esa vista ya filtra por un solo
  canal vía su propio toggle banked/brokered, así que la columna sería
  redundante ahí.
- `sections?: { label: string; loans: LoanDetailModalLoan[] }[]` (usado por
  el modal de CTC/Closing, arriba) agrupa las filas del modal por milestone
  -- coexiste con `showChannelColumn` sin conflicto, son props
  independientes y aditivos. El modal de CTC/Closing en el punto Combined
  pasa `showChannelColumn={true}` (mezcla Banked + Brokered); en el punto de
  una sola tabla de canal pasa `showChannelColumn={false}` (todos los loans
  ya son del mismo canal, la columna no aportaría nada).
- El campo `channel` en `LoanDetailModalLoan` es opcional (`channel?:`)
  porque Milestone Matrix nunca lo provee -- si algún día se agrega un
  caller nuevo que tampoco tenga el dato, el modal ya sabe mostrar `'—'` en
  su lugar (mismo criterio que `rawHealthiness`).

### SL Query — DELETE removido permanentemente del lado de la app

- `activity_report` (schema de Supabase) solo tiene políticas de
  `select`/`insert`/`update` -- nunca `delete`. Es una decisión de
  infraestructura ya tomada, no un permiso pendiente de otorgar ni un 403 a
  resolver pidiendo el grant.
- La limpieza de batches viejos corre por un `pg_cron` externo, administrado
  aparte de la app (`maintenance.run_activity_batch_retention(days,
  dry_run)` -- ver `.claude/skills/activity-sl-query/SKILL.md` para las 2
  salvaguardas de esa función: el batch vigente nunca se borra, y siempre se
  conservan los N batches más recientes).
- No reintroducir ningún `.delete()` contra `loan_records`/`upload_batches`
  desde código de la app -- si aparece un 403/42501 en un intento de DELETE
  contra esas tablas, la solución es remover el DELETE del código, no pedir
  el permiso.

## Etapa F6 — estrategia comercial como dimensión de corte en Projected Forecast

Una segunda forma de cortar los mismos datos. **Ninguna regla de cálculo cambia:**
pipeline, healthy, pull-through por canal, CTC/Closing, forecast y adverse quedan
idénticos. La estrategia es una dimensión, no una fórmula.

Alcance: sólo la pestaña Projected Forecast.

### ⚠ El orden de evaluación ES la regla

`lib/pipeline/strategy.ts`, función pura. Se para en la primera que coincide:

| # | Estrategia | Regla |
|---|---|---|
| 1 | NPPM | `Strategy` = `NPPM` |
| 2 | Affinity | `Branch` = `Affinity` |
| 3 | Recruitment | `Branch` ∈ {710, 711, 777} |
| 4 | B2B | `Opportunity Owner: Title` = `Business Developer` |
| 5 | Own production | ninguna de las anteriores |

Cada prioridad existe por un choque REAL, verificado contra el export del
2026-08-20 (883 filas):

- Los **24 NPPM tienen todos** `title = Business Developer`. Sin la prioridad
  caerían en B2B y NPPM quedaría en cero.
- **20 préstamos de las branches de recruitment dicen `B2B Strategy`** en la
  columna. Recruitment va antes, así que quedan como Recruitment.

⚠ **La columna `Strategy` se usa SÓLO para detectar NPPM.** Los 171 que dicen
`B2B Strategy` no determinan B2B — eso lo define el title. Son poblaciones
distintas: 171 con `B2B Strategy`, 205 con `Business Developer`, **77 en las
dos**.

Comparación por igualdad exacta, sin `trim` ni normalización, igual que el canal.
**Riesgo conocido y anotado en el código:** un `business developer` en minúscula
en un export futuro no coincidiría y caería en `Own production` sin aviso.
Normalizar es una decisión de negocio — define qué valores son el mismo — y este
módulo no la puede tomar solo.

### ⚠ El forecast no se recalcula por estrategia: se aporciona

Es la decisión que hace que los subtotales cuadren SIEMPRE, no por suerte.

`projectedToClose` de un branch **ya viene redondeado** desde `page.tsx`
(`Math.round`, etapa F5j). Redondear-y-sumar no es asociativo: recalcular el
forecast de cada estrategia y redondear cada uno NO daría el entero del branch.
Es el mismo problema que F5j-b ya había encontrado entre Executive y Matrix.

Así que se usa el mismo remedio: `apportionByWeight` reparte el entero del
branch usando como pesos los forecasts EXACTOS de cada estrategia, con las
MISMAS fórmulas por canal (cascada de milestone para Banked, 40% plano sobre el
total para Brokered). La suma de las partes ES el entero, por construcción.

Todo lo demás — total, healthy, closed, CTC, Closing — son conteos enteros, y
esos son aditivos solos.

Hay además una red de seguridad en desarrollo: si un subtotal por estrategia no
da la fila del branch, `console.warn`. Un desglose que no cuadra significa un
préstamo contado dos veces o ninguna.

### ⚠ Un bug propio, encontrado al verificar el Caso B

La primera versión decidía qué estrategias mostrar mirando **todos** los
cerrados del branch, sin el filtro de mes. Resultado: aparecía `NPPM 0 0 0 0` en
703/Banked, una fila entera en cero, porque su único cerrado caía fuera del mes
de forecast.

La regla es que las estrategias en cero no se muestran, así que el criterio para
decidir si la fila EXISTE tiene que ser el mismo que produce los números que la
fila MUESTRA — status funded y disbursement dentro del mes. Si no, la condición
de existir y el contenido discrepan, que es exactamente lo que se veía.

`Own production` es la única excepción: va siempre, incluso en cero. Es el 63%
de los préstamos, y esconderla dejaría un subtotal sin explicar.

### Persistencia: la cadena de cinco pasos, y en qué paso quedó

`docs/sql/2026-08-pipeline-strategy-columns.sql`, **sin ejecutar**: las cinco
columnas en las dos tablas hijas. Se guardan los CRUDOS, no la estrategia
calculada — si cambia una regla, con los crudos se recalcula el histórico
completo; con la conclusión guardada habría que recargar archivos que ya no
existen. Mismo criterio que `data_as_of` frente a `snapshot_date` en S1.

Estado de la cadena hoy:

| paso | estado |
|---|---|
| columna en la tabla | SQL entregado, sin aplicar |
| mapper del insert | **NO tocado, a propósito** |
| RPC `save_pipeline_snapshot` | pendiente del revisor |
| select de `/api/pipeline/latest` | los cinco en `''`, con el motivo escrito |
| mapeo al dominio | hecho |

El mapper NO manda las cinco claves todavía: la RPC descarta en silencio lo que
no está en su lista — devuelve 200 y deja NULL, verificado en S1 con
`loan_type`. Agregarlas antes de ampliar la función sería escribir código que
finge guardar.

Consecuencia visible, y por eso existe `hasStrategyData()`: un snapshot
restaurado tras un refresh no trae los crudos, y clasificar daría `Own
production` para los 883. La pantalla dice que no hay datos de estrategia en vez
de mostrar una distribución inventada.

### El realtor del NPPM

En el modal de detalle, no en la tabla: son 24 de 883, y una columna estaría
vacía en el 97% de las filas robándole ancho a las ocho que sí tienen dato
siempre. Va debajo del prestatario.

`nppmRealtors()` resuelve los cuatro casos y devuelve una lista ya lista: los
dos con el mismo valor dan una sola línea, distintos dan dos, uno solo da ese, y
ninguno da lista vacía — sin placeholder, porque un guion ocuparía una línea
para decir que no hay nada.

### F6b — la cadena de cinco pasos, cerrada

Las columnas y la RPC ya están aplicadas, así que el mapper del insert manda las
cinco claves. **El orden importó:** primero se comprobó contra la base que la
función las acepta —llamándola con los cinco y releyendo las filas— y sólo
después se tocó el mapper. Verificar con un 200 no alcanza: la RPC responde 200
igual cuando descarta claves.

Estado final de la cadena, con una carga real del export del 2026-08-20:

| paso | resultado |
|---|---|
| columna en la tabla | las 5 en las dos tablas hijas |
| mapper del insert | manda las 5 |
| RPC | las guarda; `loan_type`/`loan_program`/`note_history` intactos |
| select de `/api/pipeline/latest` | trae las 5 |
| mapeo al dominio | 107 de 107 abiertos con datos de estrategia |

`NULL = 0` en las cinco columnas, en las dos tablas. La distribución leída **de
la base** da 560 / 173 / 71 / 55 / 24 = 883, idéntica a la del archivo.

#### ⚠ `''` contra NULL, y por qué se documenta

    ''    el export no traía la columna, o la celda venía vacía
    NULL  la RPC descartó la clave

El parser cae a `''` y la función preserva el `''` tal cual —comprobado—, así que
una columna en NULL **después de una carga real** significa que la cadena se
rompió, y se ve con un `count(*) filter (where ... is null)`. Si el parser cayera
a NULL, los dos fallos serían indistinguibles.

#### ⚠ `Affinity Program` es una CASILLA, no texto

Encontrado en la primera carga real: la columna llegó como la cadena `"false"`
en 815 de 883 filas. En el export es un checkbox — 815 `false` y 68 `true` — y
`String(false)` produce `"false"`, que se lee como si cada préstamo tuviera un
programa de afinidad. Un `count(*) where affinity_program <> ''` daba 883.

Se guarda `'true'` o `''`, nunca `'false'`: en una casilla, `false` ES el estado
negativo, o sea lo mismo que dice `''` en los otros cuatro crudos. Se reusa
`parseBranchTransfer`, que ya resolvía casilla/número/texto para "Branch
Transfer" — el mismo problema, un año antes. Tras el arreglo: 11 + 57 = **68 con
valor**, exactamente los 68 marcados.

Nota de datos: 68 préstamos tienen la casilla marcada y 71 están en el branch
`Affinity`. **No son la misma población**, que es otra razón para que esta
columna no decida nada — la estrategia Affinity la da el branch.

#### Sin ejercitar: 711 y 777

De las tres branches de Recruitment, en este export sólo existe el **710** (55
préstamos). El 711 y el 777 no tienen préstamos hoy, así que esa parte de la
regla está escrita y probada por código pero no ejercitada con datos reales. Si
algún día aparecen y no se clasifican, el motivo está acá.

---

## Etapa S2 — anclajes de mes, calendario hábil y retención del día 15

Etapa de base de datos. **Ninguna pantalla cambia.** El SQL está en
`docs/sql/2026-08-snapshot-month-anchors.sql`, sin aplicar — lo corre el revisor.

Objetivo: poder responder en enero "cómo estaba el pipeline el último día hábil
de agosto" con certeza, y "cómo arrancó el mes".

### Qué significaban `is_month_start` / `is_month_end`

`min(id)` y `max(id)` del mes: el primer y el último snapshot **que tenemos**, no
el del primer y el último día hábil. Con los datos reales, el snapshot marcado
como inicio de julio es del **30 de julio** — el penúltimo día del mes.

Las dos columnas quedan **obsoletas y congeladas** (nadie las escribe más). No se
borran en esta migración: son el único registro de lo que marcó el job viejo. El
`drop` está escrito al final del archivo SQL, para más adelante.

### Los tres anclajes, y por qué son tres booleanos

| Anclaje | Qué es |
|---|---|
| `is_month_open` | primer snapshot del primer día hábil del mes |
| `is_first_day_close` | último snapshot de ese mismo primer día hábil |
| `is_month_close` | último snapshot del último día hábil del mes (nunca en el mes en curso) |

Más `is_day_close` (último snapshot de cada día, informativo — **no** protege del
borrado), `anchor_fallback` y `anchor_note`.

**No es una columna `anchor_type`** porque un snapshot puede ser dos anclajes a la
vez: si el primer día hábil tuvo una sola carga, esa fila es `month_open` **y**
`first_day_close`. No es hipotético — 3 de los 18 días con datos tienen
exactamente un snapshot. Un enum obligaría a inventar valores compuestos.

### `data_as_of` en `America/Chicago`, nunca `uploaded_at` ni UTC

`data_as_of` es cuándo Salesforce generó el export; `uploaded_at`, cuándo alguien
lo subió. Los snapshots 9 y 11 tienen datos del 30 de julio y se cargaron el 3 de
agosto: por `uploaded_at` caerían en agosto.

Y la zona no es una precaución teórica: el snapshot activo (id 71) tiene
`data_as_of` = 2026-08-23 20:05 CST, que en UTC es 2026-08-24. **Ya hay una fila
que cambia de día según la zona.**

### El desempate `(data_as_of, id)`

Dentro de un mismo día hay `data_as_of` repetidos, porque el mismo export se sube
varias veces: `2026-08-18 17:19` lo comparten cinco snapshots (43, 44, 45, 46,
52). Ordenar sólo por `data_as_of` deja el anclaje no determinista. `id` desempata
y gana la carga más reciente del mismo export.

### La regla vive en una función aparte

`maintenance.pipeline_snapshot_anchor_targets()` devuelve, sin escribir nada, qué
anclajes le tocan a cada snapshot. El job la usa **dos veces** —para marcar y para
decidir el borrado— así que las dos mitades no pueden separarse. Tres
consecuencias:

- **"Marcar antes de borrar" es estructural**, no depende del orden de las
  sentencias como en la función vieja.
- **El `p_dry_run` es exacto**: mira el mismo conjunto que la corrida real, sin
  escribir una fila.
- Es **inspeccionable sola**, antes de aplicar la migración.

### Recalcula, no acumula

El marcado asigna el estado completo de las 6 columnas en cada corrida. La
función vieja sólo ponía flags en `true` y nunca los quitaba, así que una carga
atrasada (como los ids 9 y 11) dejaba el anclaje pegado en el snapshot anterior
para siempre.

Eso abre una pregunta: después de la purga sólo sobreviven 3 filas por mes —
¿recalcular sobre esas 3 devuelve las mismas 3? Sí. El conjunto de anclajes es un
**punto fijo** del recálculo, verificado contra los datos de julio. Sin esa
propiedad cada purga desplazaría los anclajes del mes anterior.

### Retención: el día 15, y por qué reemplaza al job viejo

Todos los días se marcan anclajes y cierres diarios. El día 15 se borra, de todo
mes **anterior al actual**, lo que no sea anclaje. "Anterior al actual" y no "el
mes pasado": si el job no corre un día 15, el siguiente limpia el atraso solo.

`run_pipeline_snapshot_retention` **se desprograma y se borra**, no convive. Borra
por 90 días mirando las columnas viejas, así que el 29 de octubre —cuando los
snapshots del 30 de julio cumplan 90 días— se llevaría los tres anclajes de julio.

Tres salvaguardas en el borrado: el snapshot **activo** nunca se borra (con el
antecedente de S1, donde se borró el activo de producción); un snapshot **sin
`data_as_of`** nunca se borra (no se puede ubicar, así que no puede ser anclaje y
se perdería en silencio); y `= false` estricto, para que un NULL proteja la fila.

### El calendario es una tabla

`maintenance.us_holidays`, sembrada con los 11 feriados federales de 2026 y 2027.
Tabla y no reglas en código porque los prestamistas cierran días que no son
feriado federal. **Viernes Santo no se observa** — confirmado con el negocio.

Se guarda la fecha **observada**, no la nominal: si el feriado cae fin de semana,
ese día ya es no hábil, y la fila que sirve es la del día que la oficina cierra.
Tres corrimientos en este período (2026-07-03, 2027-06-18, 2027-07-05, más
2027-12-24).

`extract(isodow)` y no `dow`: con `dow` el domingo es 0 y `< 6` lo dejaría entrar
como día hábil.

### Consecuencia en Adverse & Risk

`/api/pipeline/adverse-history` infiere la primera detección de un préstamo del
snapshot más viejo que sobrevivió. S2 **agrava** esa limitación ya documentada: la
ventana pasa de ~3 meses (90 días) a ~6 semanas (hasta el día 15 del mes
siguiente). Es el precio deliberado de tener certeza sobre los días hábiles; la
solución de fondo es registrar la primera detección cuando ocurre. Queda anotado
en el comentario de ese endpoint.

### Sin índices, a propósito

52 filas: cualquier consulta de anclajes recorre la tabla en microsegundos y un
índice parcial sólo agrega costo de escritura en cada carga.

Lo que **no se puede** hacer, y quedó escrito: un índice único parcial que
garantice "un solo `month_open` por mes". La clave sería el mes derivado de
`data_as_of at time zone 'America/Chicago'`, y esa conversión es `STABLE`, no
`IMMUTABLE` — Postgres no la indexa. La invariante se comprueba con una consulta
de verificación en lugar de imponerse con un índice.

---

## Etapa F7, Parte 1 — 4ta pestaña Analytics: selector de período + rankings de Programa y Tipo

Nueva pestaña "Analytics" en Forecast & Pipeline, junto a Projected Forecast,
Pipeline by Milestone y Adverse Loans. Solo lectura sobre
`pipeline_forecast.pipeline_resolved_loans` (snapshot activo), `status =
'funded'`. No toca ninguna regla de cálculo existente -- pull-through,
Healthy, Adverse y las estrategias comerciales quedan idénticos.

### Sin consulta nueva a Supabase

`resolvedLoans` ya vive en el estado del cliente (`/api/pipeline/latest`,
mismo array que ya consumen `PivotTable`/`AdverseTable`) -- la pestaña nueva
reutiliza `filteredResolvedLoans` (ya acotado por el branch seleccionado) y
filtra por `status === 'funded'` + `disbursementDate` en el cliente. Ningún
archivo nuevo habla con Supabase.

### Selector de período (`lib/pipeline/period.ts`)

Tres modos -- Mes / Quarter / Año a la fecha (`PeriodMode`) -- diseñado para
reusarse en las etapas F7 siguientes (scorecards, tendencias), no solo en
esta pestaña. Default: mes en curso, derivado con `getUTCFullYear`/
`getUTCMonth`/`getUTCDate` -- nunca los métodos locales (`getFullYear`/
`getMonth`), a propósito: el equipo opera en UTC-5 y un cálculo en hora local
puede desplazar el mes cerca de medianoche (misma regla ya aplicada en el
parser, `lib/pipeline/sources/salesforce-file.ts`).

"Año a la fecha" corta siempre en el día de hoy (UTC) cuando el año elegido
es el año en curso -- es lo que significa "a la fecha", no el año completo.

### Historial real -- verificado contra el snapshot activo

Consulta de solo lectura (`service_role`, mismo criterio que auditorías
anteriores) contra el snapshot activo (id 72 al momento de esta etapa,
`data_as_of` 2026-08-24):

- **450** préstamos funded en total (de 781 filas en `pipeline_resolved_loans`).
- `disbursementDate` más antigua: **2025-09-04**. Más reciente: **2026-08-21**.

Si el período pedido empieza antes de esa fecha más antigua, la pantalla
muestra un mensaje explícito (`.pill.warn`) aclarando que el total no cubre
el período completo pedido -- nunca un total incompleto disfrazado de
completo. Con el default (mes en curso, agosto 2026) esto no se dispara,
porque agosto 2026 es posterior a la fecha más antigua disponible.

### Rankings -- números reales del snapshot activo, no los de referencia del brief

El brief citaba cifras de un archivo de referencia distinto (F30EEP 167, C30
142, F30 122, B30ACC 65; Conventional 512, FHA 361, VA 7,
FarmersHomeAdministration 2, HELOC 1) -- **no coinciden con el snapshot
activo real**, tal como el propio brief anticipaba que podía pasar. Contra
los 450 funded de todo el historial disponible en este snapshot:

**Loan Program** (top 4, mismo orden relativo que el brief):
F30EEP 100 · C30 90 · F30 73 · B30ACC 25 (51 programas distintos en total,
ninguno vacío en este snapshot).

**Loan Type**: Conventional 228 · FHA 215 · VA 6 · FarmersHomeAdministration 1
(sin HELOC en este snapshot -- 0, no un error, simplemente no hay ninguno
cargado hoy).

Los dos rankings suman exactamente 450 en ambos casos -- coincide con el
total de funded del período, verificado explícitamente (y con un
`console.warn` de red de seguridad en desarrollo si alguna vez no coincidiera,
mismo criterio que el desglose CTC/Closing).

### `loanProgram`/`loanType` vacío -> agrupado, nunca descartado

El brief solo pedía el placeholder `"Sin programa"` para `loan_program`
vacío; se aplicó el mismo criterio a `loan_type` (`"Sin tipo"`) por simetría
y para no descartar en silencio un loan sin ese dato -- decisión propia de
esta etapa, no un pedido explícito del brief. En el snapshot verificado
ninguno de los dos campos vino vacío, así que esta rama de código no se
ejercitó con datos reales todavía.

### Diseño

Cero hexadecimales nuevos, cero `font-mono` -- reusa `table.piv`/`.tbl-card`/
`.seg`/`.field`/`.pill`/`.label-chip` ya existentes en `components.css`
(compartido, no se tocó ese archivo). Inter + `tabular-nums` ya son globales
desde `base.css`, no hizo falta CSS nuevo para eso.

### Archivos

Solo dentro del alcance declarado: `lib/pipeline/period.ts` y
`lib/pipeline/analytics.ts` (nuevos, puros, sin UI ni Supabase),
`app/pipeline/PeriodSelector.tsx` y `app/pipeline/TabAnalytics.tsx` (nuevos),
`app/pipeline/TabNavigation.tsx` y `app/pipeline/page.tsx` (editados -- un
tab más en la lista existente, sin tocar los otros tres). Nada fuera de
`app/pipeline/**`/`lib/pipeline/**`.

---

## F7 — decisión de acceso a `org` desde Forecast (pendiente de confirmación de quien administra infraestructura)

F7 es el primer consumidor de `org.dim_branch`/`org.employee_alias` dentro
de `app/pipeline/**`. La auditoría anterior ("Auditoría — Unificación de
branches/managers", más arriba en este documento) había pausado la
migración de las tres pestañas YA EXISTENTES (Projected Forecast, Milestone,
Adverse) hacia `org`, dejándola como etapa aparte. **Esta decisión no
cambia eso** -- las tres pestañas existentes siguen leyendo
`pipeline_forecast.branches`/`branch_managers` exactamente igual, sin
tocarse. Lo que decide es, específicamente, cómo debe leer `org` la
pestaña NUEVA (Analytics/F7), que no reemplaza ni comparte código con esa
lectura existente.

**Decidido, sujeto a revisión:**

- **Patrón client-side existente**, no uno nuevo: `getSupabaseClient().schema('org')`
  -- el mismo mecanismo que ya usa `getForecastDb()` para leer
  `pipeline_forecast` (`lib/supabase/client.ts`, sin editar). Confirmado en
  la auditoría complementaria: el cliente devuelto por `getSupabaseClient()`
  ya expone `.schema(string)` sin restricción de tipo, así que `'org'`
  funciona hoy sin tocar ese archivo.
- **No se toca `lib/supabase/server.ts` ni `app/api/pipeline/**`** -- la
  variante server-side (`getServerClient`) tiene el `schema` restringido a
  `'activity_report' | 'pipeline_forecast'`, y ampliarla quedaría fuera del
  alcance de archivos de F7. Se evita ese camino en vez de ampliarlo.
- **Reusar `buildAliasIndex`/`buildExcludedIndex`** de
  `lib/business-plan/aliasIndex.ts` vía import directo -- es lógica pura
  (sin Supabase, sin acoplamiento a Business Plan más allá de sus propios
  tipos), y no se modifica ese archivo. Es una dependencia cruzada entre
  módulos (`lib/pipeline/**` importando de `lib/business-plan/**`) que hoy
  no existe en el repo -- nueva, pero no requiere tocar ningún archivo fuera
  del alcance declarado de F7.

**Lo que esta decisión explícitamente NO resuelve:** si las tres pestañas
existentes deberían migrar de `pipeline_forecast.branches`/`branch_managers`
a `org` -- eso sigue siendo la recomendación ya registrada en la auditoría
anterior ("a largo plazo Forecast debería leer de `org`"), y sigue
pendiente de una decisión de negocio explícita antes de tocar esas tres
pestañas, y antes de mergear cualquier cambio de F7 a `main`.

---

## Etapa F7, Parte 2 — Scorecards por Branch, Loan Officer y Business Developer

Implementa el patrón decidido en la Parte 1 de arriba. `lib/pipeline/scorecards.ts`
(nuevo, puro) agrupa `resolvedLoans` ya filtrado a `status='funded'` +
período por `key` resuelto -- `branch_code` para Branch, `employee_key`
para Loan Officer/Business Developer -- nunca por el nombre crudo, y nunca
comparando nombres con `===`. `app/pipeline/useOrgRoster.ts` (nuevo, `'use
client'`) hace el único fetch a `org` (dim_branch, dim_employee,
employee_alias, source_name_excluded) una sola vez por sesión de la
pestaña, vía `getSupabaseClient().schema('org')` -- mismo mecanismo que
`getForecastDb()`, sin tocar `lib/supabase/client.ts`.

### No hay columna "Opportunity Owner" separada -- es la misma `loan_officer`

Verificado contra el parser (`lib/pipeline/sources/salesforce-file.ts`) y
contra el esquema real de `pipeline_resolved_loans` (columnas completas de
una fila real, snapshot activo): no existe ningún campo de nombre de
"Opportunity Owner" distinto de `loan_officer` -- la columna cruda del
export se llama literalmente "Loan Officers" (plural), y es el mismo dato
que ya usa Business Plan para resolver alias. Por eso los scorecards de
Loan Officer y Business Developer resuelven el mismo campo
(`resolvedLoans.loanOfficer`) contra `org.employee_alias` con
`source_system = 'salesforce'` -- Business Developer además filtra por
`opportunityOwnerTitle === 'Business Developer'` (comparación exacta,
mismo criterio que ya usa `lib/pipeline/strategy.ts` para B2B, sin
reinterpretar esa regla).

### "sf integrations" -- no aparece en el snapshot activo real

El brief pedía confirmar cuántos de los 450 funded tienen Opportunity Owner
= "sf integrations". Verificado con SELECT de solo lectura
(`service_role`) contra `pipeline_resolved_loans` del snapshot activo (id
72): **0 filas** -- ni entre los funded, ni entre los abiertos, ni entre
los resueltos de cualquier status, con o sin distinción de mayúsculas. No
es un error del código: hoy no hay ningún préstamo cargado con ese valor.
El mecanismo de exclusión (`buildExcludedIndex`, vía `org.source_name_excluded`)
queda implementado igual y correctamente para cuando SÍ aparezca -- mismo
caso que F6b documentó para las branches 711/777 ("la regla está escrita y
probada por código pero no ejercitada con datos reales").

⚠ **Límite real de esta verificación (desde este entorno, fuera del
navegador):** el schema `org` devuelve `42501 permission denied` incluso
con `service_role` (RLS exige sesión `authenticated` con el claim
`commercial_activity`, confirmado ya en la auditoría de unificación de
branches/managers) -- no se pudo ejecutar `buildAliasIndex`/
`buildExcludedIndex` contra datos reales de `org` por esa vía. El código sí
corre correctamente en el navegador con la sesión real de un usuario
(mismo mecanismo que ya usa Business Plan en producción hoy) -- y quedó
**confirmado en pantalla real**, ver abajo.

### Verificación real en navegador (Heather, agosto 2026, 22 loans)

- **Período:** August 2026, 22 loans funded -- coincide exacto con el
  default del selector y con la query directa contra
  `pipeline_resolved_loans` (snapshot activo id 72) hecha desde este
  entorno.
- **Caso Ana Peña -- confirmado visualmente, no solo por coincidencia de
  nombre:** el nombre crudo "Ana Milena Zegarra" (branch 703) aparece
  **resuelto como "Ana Peña"** en el scorecard real de Loan Officer. Es la
  confirmación en pantalla de que `org.employee_alias` resuelve
  correctamente el caso ya documentado en BP1 y en la auditoría de
  unificación de branches/managers -- ya no es solo la coincidencia
  circunstancial del nombre crudo, es la resolución real ejecutándose.
- **"1 excluded as known non-person entries" -- identificado por
  eliminación, NO por consulta directa a `org.source_name_excluded`
  (sigue bloqueada fuera del navegador):** de los 22 loans de agosto, 21
  aparecen resueltos en el scorecard; comparando esa lista contra los 14
  nombres crudos distintos que trae la query directa de este mismo
  documento (arriba), el nombre que falta es **"Anthony Ditoma"** (branch
  733, `opportunity_owner_title` crudo = "Salesforce Developer").
- **Anthony Ditoma es un Loan Officer real, confirmado por revisión
  manual del reporte de Salesforce** -- tiene préstamos reales en branch
  733 Y en branch 150 (incluido `150002070914`, funded, disbursement date
  2026-08-18, ya visible en la query de este documento). No tiene
  apariencia de cuenta de sistema ni de dato mal capturado, a diferencia
  del ejemplo "sf integrations" del brief original.
- **Sin confirmar, a propósito -- pregunta abierta:** el motivo por el que
  "Anthony Ditoma" está registrado en `org.source_name_excluded` no se
  verificó (acceso bloqueado fuera del navegador para esa tabla
  específica). Como es un Loan Officer real y no una cuenta de sistema,
  **esto puede ser un error de configuración en esa tabla** -- no se
  documenta ningún motivo porque ninguno fue verificado, y no se asume que
  excluirlo sea el comportamiento correcto. Queda pendiente de quien
  administra el schema `org` antes de tratar esta exclusión como
  intencional.

### Caso real de nombre distinto entre fuentes: "Ana Milena Zegarra" (branch 703)

28 filas reales en el snapshot activo tienen `loan_officer = 'Ana Milena
Zegarra'` (branch 703, canal mixto) -- 9 de ellas con
`opportunity_owner_title = 'Business Developer'`. Esta es la MISMA persona
que la auditoría de unificación de branches/managers (arriba en este
documento) ya identificó como el manager de 703: `pipeline_forecast`
guarda "Ana Zegarra", `org` tiene el nombre canónico corregido "Ana Peña",
y la Etapa BP1 documentó exactamente esta persona como el ejemplo de
alias multi-fuente ("roster: Ana Zegarra (Peña) / salesforce: Ana Milena
Zegarra / slquery: ANA ZEGARRA"). **Confirmado en pantalla real** (ver
arriba) que `org.employee_alias` la resuelve como "Ana Peña" en el
scorecard de Loan Officer.

### Números reales (SIN resolver contra alias -- ver limitación de arriba)

Contra los 450 funded del período por defecto (todo el historial
disponible en este snapshot, id 72):

**Branch** (22 branches, sin excepciones -- todo loan tiene branch):
716 (59) · 747 (52) · 760 (48) · 733 (44) · Affinity (37) · 703 (34) ·
724 (33) · 770 (22) · 913 (20) · 710 (19) · 707 (18) · 203 (16) · 728 (13)
· 718 (10) · 741 (9) · 701 (6) · 776 (4) · 150 (2) · 225/276/771/700 (1 c/u).
Suma = **450**, coincide exacto.

**Loan Officer** (nombre CRUDO, antes de fusionar por alias -- 45 valores
distintos + 1 vacío): Nathan Martinez (62) · Cristhian A Ramirez (44) ·
Aimmee Buendia (34) · Ana Milena Zegarra (28) · Galo Rizzo Hinojosa (28) ·
Mariano Claudio (27) · ... (41 más) · 1 con `loan_officer` vacío. Suma =
**450**, coincide exacto. Una vez resuelto contra `org.employee_alias`
(no ejecutable acá), algunos de estos 46 grupos crudos podrían fusionarse
en una sola fila por persona -- ese es justo el propósito del scorecard.

**Business Developer** (`opportunity_owner_title === 'Business
Developer'`): 112 de 450 funded. Nombre crudo: Aimmee Buendia (23) ·
Nathan Martinez (14) · Giancarlo Laino (13) · Ana Milena Zegarra (9) ·
Mariano Claudio (8) · ... (18 más), 0 vacíos. Suma = **112**, coincide
exacto con el total BD-titled.

### Reconciliación

Branch: suma de filas = 450 = total funded del período, sin excepción (el
branch nunca es opcional). Loan Officer/Business Developer: la
reconciliación real es `resolved + blank + excluded + unmapped =
totalInput` (implementada en `PersonScorecardDiagnostics`, con
`console.warn` de red de seguridad en dev si no cuadra) -- no
`rows.length === totalInput`, porque un loan sin Loan Officer o con un
nombre excluido/no mapeado no tiene fila propia a propósito. Con los
números crudos de arriba (sin poder ejecutar la resolución real): 449
tendrían nombre no vacío + 1 vacío = 450 para Loan Officer; 112 + 0 vacíos
= 112 para Business Developer -- ambos cuadran ya en esta etapa previa a
la resolución.

### Archivos

`lib/pipeline/scorecards.ts` (nuevo, puro) y `app/pipeline/useOrgRoster.ts`
(nuevo, `'use client'`, único punto de acceso a `org` en todo
`app/pipeline/**`). `app/pipeline/TabAnalytics.tsx` editado (scorecards
agregados debajo de los rankings de la Parte 1). Ningún archivo de
`lib/business-plan/**` se modificó -- `buildAliasIndex`/`buildExcludedIndex`/
los tipos de `org` se importan tal cual.

## Etapa F7, Parte 3 -- tendencias mensuales del año en curso

Debajo de rankings y scorecards, en la misma pestaña Analytics: tres series
mensuales del año en curso (2026 al momento de escribir esto) sobre
`pipeline_resolved_loans` -- cierres por mes, monto cerrado por mes, y
distribución por Loan Type mes a mes. A diferencia de la Parte 2, no
depende de `org` ni de resolución de alias -- se puede construir y
verificar completa desde este entorno.

### Por qué mensual, nunca semanal, y por qué no hace falta un objeto `Date`

`disbursement_date` en `ResolvedLoan.disbursementDate` ya es un string
`'YYYY-MM-DD'`, nunca un objeto `Date`. Agrupar por mes es `slice(0, 7)`
directo sobre ese string -- no existe conversión de huso horario posible
porque el valor nunca pasa por `new Date(...)` ni por ningún método
local/UTC de lectura de componentes. Esto es justo lo que la regla
"siempre UTC" del proyecto busca evitar (desplazar un cierre de fin de mes
al mes siguiente): acá el riesgo ni siquiera existe, por construcción. Lo
único que sí necesita UTC explícito es saber cuál es "el año en curso" --
`currentYear()` (en `lib/pipeline/trends.ts`) delega en `utcToday()`, la
misma función ya usada en la Parte 1, nunca `new Date().getFullYear()`
local.

### Meses sin datos -- explícitos, nunca omitidos

`buildMonthlyTotals`/`buildMonthlyTypeBreakdown` siempre devuelven las 12
filas del año (`monthsOfYear(year)`), con `count: 0, amount: 0` explícito
(o `byType: []`) para cualquier mes sin loans -- nunca un array más corto
que 12. El componente de UI (`SimpleMonthlyChart`/`TypeBreakdownChart`)
dibuja igual las 12 columnas del eje; una columna en 0 muestra una barra
mínima de 1px, sin etiqueta de valor encima, y su tooltip agrega
explícitamente `"(no data yet)"` -- nunca desaparece del eje ni se
confunde visualmente con un mes que sí tiene datos pero es chico.

⚠ **Aclaración de alcance frente al brief:** el brief usa "septiembre 2025"
como ejemplo del borde del historial del snapshot activo (id 72, datos
desde 2025-09 hacia atrás). Esa fecha es real, pero **no es parte de la
serie de esta etapa**: la Parte 3 muestra únicamente el año en curso
(2026), por regla explícita del propio brief ("año en curso"). Dentro de
2026, el borde real de rango incompleto son los **meses futuros aún no
ocurridos** (2026-09 a 2026-12, respecto al reloj del sistema al momento
de esta verificación, 2026-08-24) -- esos son los que se renderizan en 0
explícito, no septiembre 2025. Se documenta esta distinción para no dar a
entender que se verificó un caso que en realidad no aplica a esta serie.

### Resaltado del período seleccionado dentro de la serie completa

`periodMonths()` (nuevo, en `lib/pipeline/period.ts`, junto al resto de la
Parte 1) devuelve los meses `'YYYY-MM'` que cubre la selección activa del
selector -- un mes para modo Month, tres para Quarter, y de enero al mes
en curso (UTC) o hasta diciembre si el año ya cerró, para YTD (mismo
criterio de corte que `periodDateRange`). `TabAnalytics` cruza esos meses
contra el año de la serie (`trendsYear`) y les aplica una clase CSS
(`.trend-chart__col--highlight`, color `var(--coral)`) sin quitar ni
reemplazar ninguna de las 12 columnas -- el resaltado es un overlay visual
sobre la serie completa, nunca un filtro que la reduzca.

### Componente de charting -- no existía ninguno reusable en Forecast

Se revisó `app/pipeline/**` completo (incluida `MilestoneCascade.tsx`,
donde el único elemento gráfico es un ícono SVG de stage y una barra de
progreso puramente CSS, no un componente de chart) y no existe ningún
componente de series/barras reusable dentro de Forecast. El único
precedente real en toda la app es `app/business-plan/components/
MonthlyBarChart.tsx` (Business Plan) -- confirmado no reusable tal cual
porque (a) su CSS (`.bp-chart*`) vive en `bp-visual.css`, que por
convención del proyecto solo se importa desde `app/business-plan/
layout.tsx` (mismo patrón de scoping que ya usa `forecast-visual.css` para
Forecast, documentado en el propio comentario de cabecera de ese archivo),
y (b) su lógica está acoplada a conceptos exclusivos de Business Plan
(`CurrentMonthProjection`, apportionment en 3 segmentos). Se usó como
**precedente arquitectónico**, no como componente importado: mismo
criterio de "SVG/CSS a mano, sin librería de charts" (Recharts/Chart.js/D3
nunca se agregaron al proyecto), aplicado en dos componentes nuevos y
propios de Forecast (`SimpleMonthlyChart`, `TypeBreakdownChart`, dentro de
`app/pipeline/TabAnalytics.tsx`), con su CSS en la sección nueva de
`forecast-visual.css` (clases `.trend-chart*`, `.trend-seg`,
`.trend-legend*`) -- mismo scoping, tokens de `app/styles/tokens.css`
(`--navy`, `--coral`, `--emerald-700`, `--amber-500`, `--rose-700`,
`--sky`, `--slate-400`), cero hexadecimales.

### Números reales (snapshot activo id 72, verificado por SELECT de solo lectura)

Funded total del snapshot (todo el historial, 2025-09 a 2026-08): **450**.
Funded de 2026 (la serie de esta etapa): **332** -- suma de los 8 meses con
datos (enero a agosto), los 4 restantes (septiembre a diciembre) en 0
explícito por ser futuros.

| Mes | Cierres | Monto |
|---|---|---|
| 2026-01 | 38 | 14,243,978 |
| 2026-02 | 32 | 10,985,871 |
| 2026-03 | 39 | 12,829,298 |
| 2026-04 | 56 | 18,896,194 |
| 2026-05 | 42 | 15,559,781 |
| 2026-06 | 46 | 15,503,200 |
| 2026-07 | 57 | 19,487,582 |
| 2026-08 | 22 | 7,854,591 |
| 2026-09 a 2026-12 | 0 c/u | 0 c/u |

Fuera de la serie de esta etapa, para contexto (no forma parte del año en
curso): 2025-09 (15) · 2025-10 (31) · 2025-11 (27) · 2025-12 (45) -- estos
4 meses SÍ son datos reales del snapshot, simplemente no son 2026.

### Reconciliación -- 332, no 450

⚠ **El brief original pide reconciliar contra "el total de funded del
snapshot completo (450)"**, pero esa misma instrucción escopa la Parte 3
explícitamente a "año en curso" -- 450 es el total de TODO el historial
(2025-09 a 2026-08), no del año en curso. El número correcto contra el que
reconcilian los 12 meses de esta serie es **332** (suma real de enero a
agosto 2026; septiembre-diciembre aportan 0 cada uno). Se documenta esta
distinción en vez de forzar la serie a sumar 450, que habría requerido
incluir meses de 2025 dentro de un gráfico rotulado "año en curso" --
mezclando dos años bajo una sola etiqueta de forma engañosa. La suma de
`buildMonthlyTotals(loans, 2026)` (12 filas) es exactamente 332,
verificado tanto por query directa como por lectura del código.

### Archivos

`lib/pipeline/trends.ts` (nuevo, puro -- `buildMonthlyTotals`,
`buildMonthlyTypeBreakdown`, `monthsOfYear`, `currentYear`).
`lib/pipeline/period.ts` editado (agregado `periodMonths`, sin tocar nada
existente de la Parte 1). `app/pipeline/TabAnalytics.tsx` editado (dos
componentes de chart nuevos + sección de render debajo de scorecards).
`app/pipeline/styles/forecast-visual.css` editado (sección nueva
`.trend-chart*`/`.trend-seg`/`.trend-legend*`, con comentario de cabecera
explicando por qué se justifica un componente nuevo en vez de reusar
`MonthlyBarChart.tsx`). No requirió tocar `org`, `useOrgRoster.ts` ni
`scorecards.ts`.

## Etapa F7, Parte 4 -- Owner en el modal de detalle, extendiendo el patrón NPPM

`LoanDetailModal.tsx` (`renderLoanRow`) ya mostraba, desde la Etapa F6, un
sub-label debajo del prestatario con el realtor del NPPM (`NPPM Realtor`/
`Referred by`, vía `nppmRealtors()`), condicionado a
`classifyStrategy(loan) === 'NPPM'`. Esta parte extiende el mismo patrón
visual a las demás estrategias, sin tocar el caso NPPM ni la lógica de
`classifyStrategy`/`nppmRealtors` (`lib/pipeline/strategy.ts`, sin cambios).

### Qué se agrega

Un segundo bloque condicional, al lado del bloque NPPM ya existente (mismo
`<td>`, mismo patrón `{condición && <span className="nppm-realtor">...}`,
sin envolver ambos en una función compartida a propósito -- así el diff dejó
las líneas del caso NPPM completamente intactas, byte a byte):

```tsx
{classifyStrategy(loan) === 'NPPM' &&
  nppmRealtors(loan).map((r) => ( /* ... sin cambios ... */ ))}
{classifyStrategy(loan) !== 'NPPM' &&
  loan.opportunityOwnerTitle.trim() !== '' &&
  loan.opportunityOwnerTitle.trim() !== loan.loanOfficer.trim() && (
    <span className="nppm-realtor" title={'Owner: ' + loan.opportunityOwnerTitle.trim()}>
      <span className="nppm-realtor__label">Owner</span>
      {loan.opportunityOwnerTitle.trim()}
    </span>
  )}
```

Muestra `opportunityOwnerTitle` (el "Opportunity Owner: Title" crudo del
export de Salesforce -- ej. "Business Developer" para B2B, o cualquier
otro valor para Affinity/Recruitment/Own production) para cualquier
préstamo que NO sea NPPM, con dos condiciones de guarda:

1. **Vacío -> nada.** Mismo criterio que el bloque NPPM de arriba: sin
   placeholder, sin celda "—" extra.
2. **Igual a `loanOfficer` -> nada.** Evita mostrar el mismo valor dos
   veces (la columna de Loan Officer ya está visible en la misma fila,
   unas columnas más a la derecha). Verificado contra los 152 préstamos
   reales de B2B del snapshot activo (id 72): **ningún caso** tiene
   `opportunity_owner_title === loan_officer` hoy -- la guarda está
   implementada pero no ejercitada por los datos actuales, mismo patrón
   ya documentado para otras reglas de esta etapa (F6, branches
   711/777; F7 Parte 2, "sf integrations").

No se filtra ningún valor de owner por parecer "de sistema" -- se muestra
tal cual viene, mismo criterio ya aplicado al caso "Anthony Ditoma" de la
Parte 2 (mostrar el dato real, no asumir y ocultar).

### Verificación con un préstamo real de B2B (snapshot activo id 72)

```
source_loan_id: 733002017035
borrower_name: Bikiana Reyes Martinez
loan_officer: Aimmee Buendia
branch: 733 (no Affinity, no recruitment)
strategy_raw: '' (no NPPM)
opportunity_owner_title: Business Developer
```

`classifyStrategy` da `'B2B'` (branch no es Affinity/recruitment,
`strategyRaw` no es 'NPPM', `opportunityOwnerTitle === 'Business
Developer'`). El nuevo sub-label muestra `OWNER: Business Developer`
debajo de "Bikiana Reyes Martinez" -- distinto del valor "Aimmee Buendia"
que ya aparece en la columna de Loan Officer de esa misma fila, sin
duplicación.

### Reusó la clase CSS existente, sin variante nueva

`.nppm-realtor`/`.nppm-realtor__label` (`forecast-visual.css`) se
reutilizan sin cambios de regla -- solo se actualizó el comentario de
cabecera para reflejar que ya no es exclusiva del realtor NPPM. Mismo
tamaño, color y posición para el "Owner" que para "NPPM Realtor"/"Referred
by".

### Archivos

`app/pipeline/LoanDetailModal.tsx` editado (bloque nuevo en
`renderLoanRow`, caso NPPM sin tocar). `app/pipeline/styles/forecast-visual.css`
editado (solo comentario, sin regla nueva). No se tocó
`lib/pipeline/strategy.ts` (`classifyStrategy`/`nppmRealtors` sin cambios,
como pedía el alcance).

## Etapa F7, Parte 5 -- drill-down de rankings/scorecards hacia LoanDetailModal

Cada fila de los 5 cortes de Analytics (Loan Program, Loan Type, Branch,
Loan Officer, Business Developer) abre el mismo `LoanDetailModal` que ya
usa `PivotTable.tsx`, con la lista real de préstamos detrás de esa fila.

### Ningún cálculo se tocó -- solo se re-filtra la entrada que esas funciones ya reciben

`buildRanking`/`toRows`/`buildPersonScorecard` (`lib/pipeline/analytics.ts`,
`lib/pipeline/scorecards.ts`) siguen exactamente iguales -- ninguna
devuelve la lista de loans detrás de cada fila, y no hacía falta que lo
hicieran: `TabAnalytics.tsx` ya tiene `fundedInRange` (el mismo array que
se les pasa) disponible en el momento del click, así que el drill-down
re-filtra ese array con la misma clave que agrupó la fila, en vez de pedir
que las funciones de agregación devuelvan el detalle.

- **Programa/Tipo:** `(loan.loanProgram.trim() || 'Sin programa') === row.label`
  (mismo para Tipo con `loanType`/`'Sin tipo'`) -- mismo criterio EXACTO de
  `buildRanking` (`getRaw(loan).trim() || emptyLabel`). Los placeholders
  `'Sin programa'`/`'Sin tipo'` están duplicados como constantes locales en
  `TabAnalytics.tsx` (`DRILLDOWN_NO_PROGRAM_LABEL`/`DRILLDOWN_NO_TYPE_LABEL`)
  porque `lib/pipeline/analytics.ts` no los exporta y ese archivo queda
  fuera del alcance de archivos de esta etapa -- **riesgo anotado
  explícito**: si el texto del placeholder cambia algún día en
  `analytics.ts`, hay que actualizar esta copia a mano, no se detecta solo.
- **Branch:** `loan.branch === row.key` -- directo, `ScorecardRow.key` de
  `buildBranchScorecard` YA es el código crudo de branch (`byKey.set(code,
  ...)`), sin alias de por medio.
- **Loan Officer/Business Developer:** `row.key` es `String(employeeKey)`
  RESUELTO (nunca el nombre crudo) -- el drill-down repite la misma
  resolución que `buildPersonScorecard` (`aliasIndex.lookup('salesforce',
  loan.loanOfficer.trim())`, comparando el `employeeKey` resultante contra
  `row.key`) en vez de comparar nombres con `===`, cumpliendo la misma
  regla dura ya documentada en la Parte 2. Business Developer aplica
  además el mismo pre-filtro exacto de `buildBusinessDeveloperScorecard`
  (`opportunityOwnerTitle === 'Business Developer'`) antes de resolver.

### El período seleccionado se hereda gratis -- verificado, no asumido

Los 5 cortes ya parten de `fundedInRange = fundedLoansInRange(resolvedLoans,
periodDateRange(period))` (confirmado leyendo el código final, no solo
citado del diagnóstico previo) -- el drill-down filtra ese mismo array, así
que un clic en "F30EEP" con agosto seleccionado sólo puede traer loans de
F30EEP en agosto. No hace falta ningún filtro de fecha adicional en el
handler del click.

### Mapeo a `LoanDetailModalLoan`: se exportó, no se reimplementó

Único cambio a un archivo fuera de lo tocado hasta ahora en F7:
`closedLoanToModalLoan()` en `PivotTable.tsx` pasó de función privada a
`export function closedLoanToModalLoan(...)` -- ninguna otra línea de ese
archivo cambió. `TabAnalytics.tsx` la importa tal cual, evitando duplicar
el mapeo campo a campo `ResolvedLoan -> LoanDetailModalLoan` que ya existía
y estaba verificado.

### `context`/`metric` pasados al modal

`metric` = nombre del corte de origen ("Loan Program", "Loan Type",
"Branch", "Loan Officer", "Business Developer"). `context` = `row.label`
tal cual (el texto ya visible en esa fila) -- para Branch esto es
únicamente el código crudo (ej. "716"), sin nombre de sucursal enriquecido
(ej. "Coral Gables"): ese enriquecimiento requeriría traer
`branch_name`/ciudad desde `org.dim_branch`, y `useOrgRoster.ts` (que hoy
sólo trae `branch_code` a un `Set`) queda fuera del alcance de archivos de
esta etapa. Documentado acá en vez de expandir el alcance sin que se
pidiera.

### Verificación real (snapshot activo)

⚠ El snapshot activo cambió de id 72 (etapas anteriores) a **id 73**
(`data_as_of` 2026-08-24T18:44:05Z) entre la Parte 4 y esta verificación --
se usan los números reales de 73, como corresponde cuando el snapshot
activo cambia.

Agosto 2026 (período por defecto del selector), 23 funded:
- Loan Program: C30 (7) · F30EEP (6) · B30FNBA (2) · F30 (2) · 6 programas
  más con 1 c/u. Suma = 23.
- Loan Type: Conventional (13) · FHA (10). Suma = 23.
- Branch: 716 (5) · Affinity (4) · 776 (3) · 733/707/710/747/760 (2 c/u) ·
  703 (1). Suma = 23.
- Business Developer (`opportunity_owner_title`, crudo antes de alias): 8
  de los 23 -- Giancarlo Laino (3) · Silvio Arteaga (3) · Aimmee Buendia
  (1) · Adriana Szczech (1).

Para probar el caso de lista LARGA (el brief original citaba 152, número
de TODO el historial de la Parte 4 -- con el período por defecto mensual
esa escala no se alcanza, agosto sólo tiene 8 BD-titled), se releyó con
YTD 2026 (2026-01-01 a hoy): 333 funded, **102 BD-titled** (crudo, antes de
fusionar por alias) -- del mismo orden de magnitud que el número original,
suficiente para ejercitar la lista larga real.

⚠ **Límite de esta verificación:** la resolución real por
`org.employee_alias` (qué `employeeKey` exacto agrupa cada fila de Loan
Officer/Business Developer) no se pudo ejecutar desde este entorno de
script -- mismo bloqueo `42501 permission denied for schema org` ya
documentado en la Parte 2. Los conteos de arriba son PRE-alias (por nombre
crudo); el conteo POST-alias real (el que efectivamente ve cada fila del
scorecard) sólo se puede confirmar en pantalla, con sesión de navegador.

### Lista larga en el modal -- confirmado por código, no por render real

`LoanDetailModal.tsx` no tiene ningún `.slice()`/límite de filas -- itera
el array completo con `.map(renderLoanRow)` sin importar su longitud, y
`.modal-box { max-height: 85vh }` + `.modal-body { overflow-y: auto }`
(`components.css`) ya scrollean cualquier tabla más alta que el modal, sin
cambios para esta etapa. No se pudo confirmar visualmente en un navegador
real que 100+ filas rendericen sin cortarse -- mismo límite de entorno que
el resto de esta verificación.

### Archivos

`app/pipeline/TabAnalytics.tsx` editado (`onRowClick` opcional en
`RankingTable`/`ScorecardTable`, estado `drillDown`, 5 handlers, render de
`LoanDetailModal`). `app/pipeline/PivotTable.tsx`: un solo cambio, `export`
agregado a `closedLoanToModalLoan` (cero líneas de lógica tocadas).
`app/pipeline/styles/forecast-visual.css`: una regla nueva, `.metric--drill
{ cursor: pointer; }` (el hover de fondo ya existía global en
`components.css`).

## Etapa F7, Parte 6 -- `hiddenColumns` en LoanDetailModal, solo para Analytics

Analytics abre el mismo `LoanDetailModal` que `PivotTable.tsx` (Parte 5),
pero cada uno de sus 5 cortes ya muestra en su propia fila el dato que una
columna del modal repetiría (ej. Loan Program), y dos columnas (Milestone,
Status) hoy siempre vienen vacías en este contexto específico. `hiddenColumns
?: LoanDetailModalColumn[]` generaliza el mismo patrón que ya usaba
`showChannelColumn` (una columna condicional) a cualquier columna, sin
duplicar esa lógica.

### Por qué Milestone/Status se ocultan -- y por qué esto NO es permanente

⚠ **Status** se oculta porque `closedLoanToModalLoan()` (`PivotTable.tsx`)
omite `rawHealthiness` a propósito -- un préstamo cerrado no tiene un
estado de salud de pipeline vigente. Esto es una decisión de diseño
estable: mientras Analytics siga abriendo solo `ResolvedLoan` (funded),
Status seguirá vacío.

⚠ **Milestone** se oculta por un motivo DISTINTO y más fragil: hoy siempre
muestra el fallback `'Closed (Funded)'` porque `pipeline_resolved_loans`
**no tiene columna `raw_milestone`** (`app/api/pipeline/latest/route.ts`,
confirmado con una query real: `column pipeline_resolved_loans.raw_milestone
does not exist`) -- así que `loan.rawMilestone` llega vacío y cae al
fallback. Esto **no es una garantía de schema**, es un hueco: si algún día
se agrega esa columna a `pipeline_resolved_loans` (ya existe el precedente
de guardar `row.currentMilestone` real para adverse en
`lib/pipeline/sources/salesforce-file.ts`, usado para "Last Finished
Milestone" en AdverseTable), Milestone dejaría de estar vacío para funded
también, y esta ocultación en `TabAnalytics.tsx` habría que revisarla --
**no asumir que es correcta para siempre, revisar si esa columna aparece**.

### Mecanismo

`LoanDetailModal.tsx` -- nuevo tipo exportado `LoanDetailModalColumn =
'loanOfficer' | 'loanType' | 'loanProgram' | 'milestone' | 'status' |
'channel'` y prop `hiddenColumns?: LoanDetailModalColumn[]`. Cinco banderas
derivadas (`showLoanOfficerColumn`, etc.) gobiernan `<col>`/`<th>`/`<td>`
condicionales, mismo patrón que ya usaba `showChannelColumn` (que sigue
intacto, ahora combinado con `!hiddenColumns?.includes('channel')`).
`visibleColumnCount` reemplaza los `10`/`9` hardcodeados de los
`colSpan` de fila de sección y "No loans." -- se recalcula sumando 4
columnas siempre visibles (Loan #, Borrower, Amount, Notes) más cada
columna condicional que esté activa.

### Los 3 consumidores existentes -- confirmado sin cambio de comportamiento

`PivotTable.tsx`, `TabMilestoneMatrix.tsx`, `AdverseTable.tsx`: ninguno
pasa `hiddenColumns` (`grep hiddenColumns` en los 3 -- cero resultados),
así que siguen viendo exactamente las mismas columnas que antes de esta
etapa. `AdverseTable.tsx`/`TabMilestoneMatrix.tsx` no se tocaron en
absoluto (diff vacío contra el último commit).

### Columnas visibles por corte (`TabAnalytics.tsx`)

| Corte | `hiddenColumns` | Columnas visibles |
|---|---|---|
| Loan Program | `['loanProgram', 'milestone', 'status']` | Loan #, Borrower, Loan Officer, Channel, Loan Type, Amount, Notes (7) |
| Loan Type | `['loanType', 'milestone', 'status']` | Loan #, Borrower, Loan Officer, Channel, Loan Program, Amount, Notes (7) |
| Branch | `['milestone', 'status']` | Loan #, Borrower, Loan Officer, Channel, Loan Type, Loan Program, Amount, Notes (8) |
| Loan Officer | `['loanOfficer', 'milestone', 'status']` | Loan #, Borrower, Channel, Loan Type, Loan Program, Amount, Notes (7) |
| Business Developer | `['loanOfficer', 'milestone', 'status']` | Loan #, Borrower, Channel, Loan Type, Loan Program, Amount, Notes (7) |

Ninguno de los 5 oculta Channel -- no se pidió, y `showChannelColumn` sigue
en su default `true`.

### Archivos

`app/pipeline/LoanDetailModal.tsx` editado (`LoanDetailModalColumn`,
`hiddenColumns`, `visibleColumnCount`, columnas condicionales).
`app/pipeline/TabAnalytics.tsx` editado (tipo del estado `drillDown`
extendido con `hiddenColumns`, un array por cada uno de los 5 handlers).
`PivotTable.tsx`/`TabMilestoneMatrix.tsx`/`AdverseTable.tsx` sin tocar.

## Etapa F7, Parte 7 -- silencio cuando todo resuelve, lenguaje simple cuando no

El texto de diagnóstico de los 3 scorecards (Branch, Loan Officer,
Business Developer) se mostraba SIEMPRE, incluso cuando el 100% de los
loans resolvía sin problema -- y mencionaba nombres de tabla
(`org.employee_alias`, `org.source_name_excluded`, `org.dim_branch`) como
texto plano permanente en pantalla. Nueva regla, un solo componente
(`DiagnosticsNote`) para los 3:

1. **Silencio si no hay ningún problema** (`count === 0`) -- reemplaza a
   `PersonDiagnostics` (que solo chequeaba `totalInput === 0`, así que
   mostraba el párrafo completo incluso con 100% resuelto).
2. **Resumen corto en lenguaje simple** cuando sí hay algo -- sin nombres
   de tabla en el texto visible. Ej.: `"3 of 46 loans could not be
   matched to a person (2 unrecognized names, 1 known non-person
   entry)"`.
3. **Detalle técnico completo solo en `title`** (tooltip nativo del
   navegador, al pasar el mouse) -- nombres de tabla, desglose exacto de
   `unmappedNames`, lista de branch codes. `DiagnosticsNote` se ve con
   `cursor: help` y un subrayado punteado (`border-bottom: 1px dotted`)
   como affordance de que hay más detalle al pasar el mouse -- inline,
   sin agregar clase nueva a `forecast-visual.css` (fuera del alcance de
   archivos de esta etapa).

`personDiagnosticsNote()` (nueva función, reemplaza al componente
`PersonDiagnostics`) arma `summary`/`detail` a partir de
`PersonScorecardDiagnostics` -- el `console.warn` de reconciliación
(`resolved+blank+excluded+unmapped === totalInput`) sigue exactamente
igual, solo cambió el texto visible. El diagnóstico de Branch
(`unresolvedBranches`) se migró al mismo componente con su propio
`summary`/`detail` -- ya se ocultaba solo con `unresolvedBranches.length
=== 0` antes de esta etapa, pero mencionaba `org.dim_branch` en texto
plano; ahora ese nombre de tabla va solo en el tooltip.

### Verificación real -- con la limitación ya conocida de acceso a `org`

⚠ `blankCount` (Loan Officer/Owner vacío) es el único de los 3 motivos
que NO depende de `org` -- se puede verificar por SELECT directo contra
`pipeline_resolved_loans`. `unmappedCount`/`excludedCount` sí dependen de
`org.employee_alias`/`org.source_name_excluded`, bloqueados `42501` fuera
del navegador (misma limitación ya documentada en la Parte 2).

- **Agosto 2026 (período por defecto, snapshot activo id 73):** `blankCount
  = 0` para Loan Officer (23 loans) y para Business Developer (8 loans) --
  verificado por SELECT real. No se puede confirmar si `unmappedCount`/
  `excludedCount` también son 0 sin sesión de navegador -- así que no se
  puede afirmar con certeza total que el aviso esté en silencio para este
  período exacto, solo que el componente SÍ estaría en silencio si esos
  dos también son 0 (verificado leyendo `DiagnosticsNote`: `count === 0`
  -> `return null`).
- **YTD 2026 (2026-01-01 a hoy, mismo snapshot):** `blankCount = 1` de
  333 loans (Loan Officer) -- confirmado real, SELECT directo. Esto por
  sí solo garantiza que el aviso se muestra (`problemCount >= 1`), sin
  importar cuánto valgan `unmappedCount`/`excludedCount`. Si esos dos
  fueran 0 (no confirmado), el texto exacto sería:
  `"1 of 333 loans could not be matched to a person (1 with no name
  recorded)"`. El texto real final (si además hay excluidos/no-mapeados
  ese período) requiere confirmación en pantalla.

### Archivos

`app/pipeline/TabAnalytics.tsx` editado: `PersonDiagnostics` reemplazado
por `DiagnosticsNote` (genérico, los 3 scorecards) + `personDiagnosticsNote()`
(arma el texto para LO/BD) + el diagnóstico de Branch migrado al mismo
componente. Ningún archivo de `lib/pipeline/scorecards.ts` se tocó --
`PersonScorecardDiagnostics` (la forma de datos) sigue igual, solo cambió
cómo se traduce a texto visible.

## Etapa F7, Parte 8 -- 3 notas de implementación que se filtraron a la UI, movidas al mismo patrón de tooltip

Ninguna de las 3 notas de abajo fue pedida por el brief F7 original --
eran comentarios de implementación (garantías de "no afecta otros
cálculos", nombres de schema/tabla) que quedaron como texto plano
permanente en pantalla. Se les aplicó el mismo tratamiento que ya usa
`DiagnosticsNote` (Parte 7): lo genuinamente útil para quien mira la
pantalla queda breve y visible; el resto (jerga de schema/`read-only`/
"no depende de") va solo al tooltip.

`DiagnosticsNote` se **reusó tal cual** (cero lógica nueva) en las 3 --
se le pasa `count={1}` a propósito: esa nota nunca es condicional (siempre
hay algo breve que mostrar en Rankings/Scorecards/Monthly Trends), y
`count` en el componente solo existe para el chequeo `=== 0` de los
scorecards -- cualquier valor no-cero cumple exactamente lo mismo, sin
agregar una rama nueva al componente.

### 1. Rankings (Loan Program / Loan Type)

**Antes** (texto plano permanente):
> Funded loans (Disbursement Date) grouped by Loan Program and Loan Type, for the selected period. Read-only —
> doesn't affect pull-through, Healthy, Adverse, or strategy calculations elsewhere in Forecast.

**Visible ahora** (`summary`):
> Funded loans (Disbursement Date), grouped by Loan Program and Loan Type, for the selected period.

**Solo en tooltip** (`detail`):
> Read-only — doesn't affect pull-through, Healthy, Adverse, or strategy calculations elsewhere in Forecast.

Se conservó "(Disbursement Date)" en el texto visible -- no es jerga
interna, es el mismo campo de negocio que ya usa el selector de período
(distingue de Est. Closing Date, ambigüedad real en otras partes del
módulo). La garantía de "no afecta otros cálculos" es información
irrelevante para quien lee la pantalla (es una nota-a-mí-mismo contra
regresiones, no algo que el usuario necesite para interpretar el
ranking) -- se movió entera al tooltip.

### 2. Scorecards (Branch / Loan Officer / Business Developer)

**Antes:**
> Resolved against org.dim_branch/org.employee_alias (schema org, read-only, same session as the rest of the app) —
> names are never compared with string equality, only via the alias table.

**Visible ahora:**
> Branch, Loan Officer, and Business Developer are matched against the company roster, so name variants are combined.

**Solo en tooltip:**
> Resolved against org.dim_branch/org.employee_alias (schema org, read-only, same session as the rest of the app) — names are never compared with string equality, only via the alias table.

Lo genuinamente útil acá era explicar POR QUÉ nombres distintos del
export terminan en la misma fila (ej. el caso ya documentado "Ana Milena
Zegarra"/"Ana Peña") -- reformulado sin nombrar `org.dim_branch`/
`org.employee_alias` ni "string equality". El resto (nombres de schema,
detalle de sesión/mecanismo de comparación) es implementación pura --
al tooltip completo.

### 3. Monthly Trends

**Antes:**
> All 12 months of {año}, funded loans by Disbursement Date -- months with no data yet (e.g. future months this
> year) show 0 explicitly, never omitted. The month(s) matching the period selected above are highlighted in
> coral, without replacing the full-year series. Read-only, no dependency on org -- entirely from
> pipeline_resolved_loans.

**Visible ahora:**
> All 12 months of {año} — months with no data yet show 0 explicitly, never omitted. The month(s) matching the period selected above are highlighted in coral.

**Solo en tooltip:**
> Read-only, no dependency on org -- entirely from pipeline_resolved_loans.

Esta es la que el propio brief ya señalaba como ejemplo de "sí es útil"
(el caso de meses futuros en 0 explícito) -- se conservó tal cual, igual
que la mención del resaltado en coral (explica una señal visual real de
la pantalla). Se recortó "without replacing the full-year series" (ya
lo explica el propio resaltado visual, no hace falta el texto) y la
garantía de "read-only / no depende de org" completa, que fue a tooltip.

### Archivos

Solo `app/pipeline/TabAnalytics.tsx` (los 3 `<p className="foot-note">`
reemplazados por `<DiagnosticsNote count={1} summary=... detail=... />`,
comentario de `DiagnosticsNote` actualizado para documentar el reuso con
`count={1}`). `docs/ARQUITECTURA.md` con el detalle completo que salió de
la UI, sin recortar, tal como se pidió.

## Etapa F7, Parte 9 -- diagnóstico de matching (Branch/LO/BD) como ícono, no como línea de texto

Distinto de las 3 notas generales de "cómo funciona" (Parte 8, que se
quedan como texto breve siempre visible): el diagnóstico de coincidencias
de Branch/Loan Officer/Business Developer (Parte 7, `DiagnosticsNote`
vía `personDiagnosticsNote()`/el objeto inline de Branch) todavía
mostraba una línea de texto propia cuando `count > 0` -- ahora es
un ícono de advertencia junto al título del scorecard, sin ninguna línea
de texto al lado.

### Mecanismo

Nuevo prop `diagnostic?: { count: number; summary: string; detail: string }`
en `ScorecardTable` (mismo shape que ya devolvía `personDiagnosticsNote()`
y el objeto inline de Branch -- cero cambio en cómo se arma ese dato,
solo en dónde se renderiza). Dentro de `.tbl-card__head`, junto a
`.tbl-card__title`:

```tsx
{diagnostic && diagnostic.count > 0 && (
  <span title={`${diagnostic.summary}\n${diagnostic.detail}`} style={{ ... cursor: 'help' ... }}>
    <AlertTriangleIcon size={14} />
  </span>
)}
```

`count === 0` -> nada (mismo silencio que ya existía). `count > 0` ->
solo el ícono (`AlertTriangleIcon`, `components/ui/icons.tsx`, ya usado
en el resto de la app -- tab "Adverse Loans" en `TabNavigation.tsx`,
mismo `size={14}`, mismo criterio de no traer una librería de iconos
nueva). El resumen simple Y el detalle técnico completo van JUNTOS en el
`title` del ícono (tooltip nativo, separados por salto de línea) -- ya no
hay ninguna línea de texto plano en la pantalla por defecto para estos 3,
ni siquiera el resumen breve.

Las 3 notas generales (Rankings/Scorecards/Monthly Trends, Parte 8) NO se
tocaron -- siguen siendo `<DiagnosticsNote count={1} .../>` con su texto
breve siempre visible, porque no son advertencias condicionales, son
explicación fija de cómo leer la pantalla.

### Archivos

Solo `app/pipeline/TabAnalytics.tsx`: nuevo prop `diagnostic` en
`ScorecardTable`, import de `AlertTriangleIcon`, los 3 call-sites de
Branch/Loan Officer/Business Developer pasan `diagnostic={...}` en vez de
renderizar `<DiagnosticsNote>` como hermano. `personDiagnosticsNote()` no
cambió su firma ni su lógica -- sigue devolviendo `{count, summary,
detail}`, solo cambió quién lo consume.

## Etapa F7, Parte 10 -- mezcla de estrategia comercial (dona)

Nueva sección "Strategy Mix" en Analytics.

⚠ **Ubicación corregida tras revisión:** se colocó primero debajo de
Scorecards y antes de Monthly Trends -- un ajuste posterior movió Strategy
Mix a DESPUÉS de Monthly Trends, para que el orden final de la pestaña
sea: todo lo pedido explícitamente por el brief F7 original (Rankings,
Scorecards, Monthly Trends, drill-down al modal), en su orden original y
sin nada intercalado entre esas secciones -- y los gráficos adicionales
que NO pedía el brief (Strategy Mix, Parte 10, y los que se agreguen
después) van todos juntos al final, en un bloque propio marcado con un
comentario explícito en el JSX.

### `classifyStrategy()` reusado tal cual, sin adaptador

`lib/pipeline/strategyMix.ts` (nuevo archivo, separado de
`analytics.ts` como sugería el brief) llama `classifyStrategy(loan)`
directo sobre cada `ResolvedLoan` de `fundedInRange` -- confirmado en el
diagnóstico previo que `ResolvedLoan` ya trae los 3 campos que
`StrategyInput` necesita (`branch`, `strategyRaw`, `opportunityOwnerTitle`),
así que no hizo falta ningún adaptador ni cambio a `lib/pipeline/strategy.ts`.
`buildStrategyMix()` siempre devuelve las 5 filas de `STRATEGY_ORDER` --
una estrategia sin loans en el período queda en `count: 0` explícito,
nunca ausente (mismo criterio que `monthsOfYear` en `trends.ts`).

### Números reales (snapshot activo)

⚠ El snapshot activo cambió de id 73 (verificación de la etapa anterior)
a **id 74** (`data_as_of` 2026-08-24T21:28:53Z) entre el diagnóstico y
esta implementación -- se usan los números reales de 74.

Agosto 2026 (período por defecto), 24 funded:

| Estrategia | Conteo | % |
|---|---|---|
| Own production | 11 | 45.8% |
| B2B | 4 | 16.7% |
| Affinity | 4 | 16.7% |
| Recruitment | 2 | 8.3% |
| NPPM | 3 | 12.5% |
| **Suma** | **24** | **100.0%** |

### Paleta de colores -- nueva, no existía ninguna previa

Se buscó explícito un color ya asignado a estas 5 categorías en algún
otro lado de Forecast (la vista "By strategy" de `PivotTable.tsx`,
`.strat-pill`/`StrategyRowsGroup`) -- no existe ninguno: esa vista solo
muestra el nombre de la estrategia como texto plano, con un pill de
filtro neutro (slate/coral solo para el estado "seleccionado", sin color
por estrategia). Se define una paleta nueva, `STRATEGY_COLORS` (tokens
existentes, cero hex nuevo), con una decisión distinta a la de Loan Type
(Parte 3): como `Strategy` es un enum CERRADO de 5 valores (no una
columna abierta como `loan_type`), el color se asigna por NOMBRE fijo en
vez de por orden de aparición -- más robusto, no depende de qué
estrategia trae más volumen en un período dado.

| Estrategia | Token |
|---|---|
| Own production | `--navy` |
| B2B | `--emerald-700` |
| Affinity | `--sky` |
| Recruitment | `--amber-500` |
| NPPM | `--rose-700` |

### Componente -- SVG a mano, mismo criterio ya establecido

`StrategyDonutChart` (`TabAnalytics.tsx`): un `<path>` de arco por
estrategia (ver ajuste de técnica más abajo -- la versión inicial usaba
`<circle>` + `stroke-dasharray`/`stroke-dashoffset`, reemplazada después
por resultar ambigua), sin librería de charts -- mismo criterio que
`MonthlyBarChart.tsx` (Business Plan) y los charts de tendencias de la
Parte 3. Centro con el total en texto grande (`<text>` SVG), leyenda al
lado con label + conteo + %. Un segmento con `count: 0` no dibuja arco,
pero sigue apareciendo en la leyenda, atenuado (`--slate-400`).

⚠ **Ajuste de legibilidad (revisión post-implementación):** conteo y %
en la leyenda pesaban visualmente igual -- fácil de confundir cuál era
cuál a simple vista. El conteo quedó en `font-weight: 600` (peso normal
del texto de la fila) y el % en un `<span>` aparte, `font-size: 11px` +
`opacity: 0.65` -- opacidad relativa, no un color fijo, para que una fila
en `count: 0` (ya atenuada por completo) no vuelva a verse más oscura por
culpa de un gris fijo en el %.

⚠ **Segundo ajuste: paréntesis quitados del %.** El ajuste anterior
diferenció el estilo pero dejó los paréntesis literales ("10 (43.5%)") --
se quitaron, queda "10 43.5%" con el mismo tamaño/opacidad ya logrados.

⚠ **Tercer ajuste, más de fondo: el orden visual de los arcos no
coincidía con el de la leyenda.** La primera versión usaba `<circle>` +
`stroke-dasharray`/`stroke-dashoffset` por segmento (técnica estándar de
donut sin librería) -- pero esa técnica depende de una convención de
punto de inicio/dirección de recorrido de `<circle>` que resultó
ambigua en la práctica: NPPM (última estrategia en `STRATEGY_ORDER`)
aparecía como el segundo arco visual en vez del último. Se reemplazó por
`<path>` con comando de arco (`M`/`A`) y ángulo calculado directo por
trigonometría -- `x = cx + r·sin(θ), y = cy − r·cos(θ)`, con θ=0 en las 12
y creciendo en sentido horario -- una fórmula verificable a mano, sin
depender de ninguna convención implícita del navegador. Verificado con
los números reales del período (ver más abajo): los 5 segmentos caen
exactamente en el rango angular esperado, en el mismo orden que la
leyenda. Sigue siendo SVG a mano, sin librería de charts -- el cambio es
de técnica de arco (`path` vs `circle`+dasharray), no de criterio.

### Reacciona al período -- gratis, mismo patrón

`buildStrategyMix(fundedInRange)` -- el mismo array ya filtrado por
período que usan los otros 4 cortes, sin filtro de fecha adicional.

### Drill-down -- incluido, no se dejó para después

Se agregó porque fue simple de reusar el mismo patrón de la Etapa 5: un
`onSegmentClick` opcional en `StrategyDonutChart` (tanto el arco del
donut como la fila de leyenda son clickeables) que abre el mismo
`LoanDetailModal`, filtrando `fundedInRange` por
`classifyStrategy(l) === row.strategy` y mapeando con
`closedLoanToModalLoan` -- mismo mecanismo exacto que Branch/Programa/Tipo.
`hiddenColumns: ['milestone', 'status']` (mismas dos columnas siempre
vacías en este contexto, ver Parte 6) -- no hay una columna "Strategy" en
el modal que quede redundante, así que no se ocultó ninguna columna
adicional por ese motivo.

### Archivos

`lib/pipeline/strategyMix.ts` (nuevo, puro -- `buildStrategyMix`).
`app/pipeline/TabAnalytics.tsx` editado (`STRATEGY_COLORS`,
`StrategyDonutChart`, cómputo de `strategyMix`, sección "Strategy Mix" +
drill-down). `app/pipeline/styles/forecast-visual.css` **sin tocar** --
el donut usa estilos inline, consistente con el resto de layout ad-hoc ya
existente en `TabAnalytics.tsx` (grids, spacing); las clases CSS dedicadas
de Parte 3 solo hacían falta por `:hover`/`@keyframes`, que acá no aplica.

## Etapa F7, Parte 11 -- Pareto por Branch / Loan Officer

Sección al final de la pestaña (después de Strategy Mix, mismo orden ya
establecido: brief original primero, gráficos adicionales al final).
Barras (conteo) + línea de % acumulado, con línea de referencia en 80% --
primera vez en el proyecto combinando dos tipos de marca en un mismo SVG
a mano.

### Reuso real de los scorecards -- verificado, no solo asumido

`buildParetoRows()` (`lib/pipeline/paretoMix.ts`, nuevo) recibe
directamente `branchScorecard.rows`/`loanOfficerScorecard.rows` (los
mismos objetos que ya renderizan las tablas de Scorecards, Parte 2) y
solo acumula `closedCount` -- confirmado leyendo `toRows()`
(`lib/pipeline/scorecards.ts:33-44`) que esas filas YA vienen
`.sort((a, b) => b.closedCount - a.closedCount)`. Ninguna agrupación
nueva: `buildBranchScorecard`/`buildLoanOfficerScorecard` (mismas
funciones de la Parte 2) se llaman de nuevo para YTD, pero con
`ytdFunded` como entrada en vez de `fundedInRange` -- no hay una tercera
forma de agrupar loans en el proyecto.

### Resolución de alias en Loan Officer -- heredada, confirmado

`loanOfficerScorecard.rows`/`ytdLoanOfficerScorecard.rows` vienen de
`buildLoanOfficerScorecard`, que agrupa por `employeeKey` RESUELTO (nunca
por nombre crudo, `lib/pipeline/scorecards.ts:102-140`, misma regla dura
documentada desde la Parte 2) -- el Pareto de Loan Officer hereda esa
resolución automáticamente, por construcción: reusa el `ScorecardRow[]`
ya resuelto, no vuelve a leer `loan_officer` crudo en ningún momento.
Mismos nombres que ya muestra la tabla de Scorecards de Loan Officer,
sin excepción.

### Toggle interno -- estado local, sin efectos sobre el resto de la pestaña

`ParetoChart` calcula sus propios `useState` (`mode`: Selected period/
YTD; `cut`: Branch/Loan Officer) -- las 4 combinaciones
(branch/LO × período/YTD) se precomputan UNA VEZ en `TabAnalytics`
(`paretoData`), antes de renderizar el chart; el toggle solo elige cuál
de las 4 mostrar. Cambiar cualquiera de los dos toggles re-renderiza
solo `ParetoChart` -- no dispara ningún fetch nuevo (`useOrgRoster`
carga una sola vez, `useEffect` con deps `[]`, ver Parte 2) ni toca el
selector de período principal (`period`/`setPeriod`) ni ningún otro de
los 8 gráficos de la pestaña.

YTD se calcula con el mismo patrón que ya usa el selector principal para
su propio modo YTD (`getDefaultYtdSelection()` + `periodDateRange()`,
`lib/pipeline/period.ts`, sin tocar ese archivo) -- pero completamente
aparte del estado `period`: el selector de arriba sigue mostrando lo que
el usuario eligió, sin cambiar, mientras el Pareto puede estar en modo
YTD.

### Números reales (snapshot activo id 74) -- agosto plano, YTD con cola real

**Selected period (agosto 2026, 24 funded) -- confirmado plano, como
anticipaba el diagnóstico:** 80% acumulado recién en 7 de 9 branches
(78% de todos los branches) y 10 de 14 loan officers de nombre CRUDO
(71% de los nombres) -- sin org disponible desde este script, el
conteo real POST-alias de LO no se pudo verificar acá, pero el mismo
patrón de "distribución pareja, sin concentración fuerte" se sostiene
sea cual sea el número final de personas resueltas (nunca puede haber
*más* de 14 barras, solo igual o menos tras fusionar alias).

**Year to date (2026-01-01 a 2026-08-24, 334 funded) -- cola clara,
confirmada real:**

| Corte | 80% acumulado en | de un total de | % de categorías |
|---|---|---|---|
| Branch | 8 branches | 20 | 40% |
| Loan Officer (nombre crudo) | 12 nombres | 37 | 32% |

Top 3 branches YTD: 716 (51, 15.3%) · 747 (46, 13.8%) · 733 (36, 10.8%).
Top 3 loan officers YTD (crudo): Nathan Martinez (55, 16.5%) · Aimmee
Buendia (30, 9.0%) · Cristhian A Ramirez (27, 8.1%).

Confirma la hipótesis del diagnóstico: la concentración tipo Pareto SÍ es
real, pero solo se ve con suficiente volumen (YTD) -- el período por
defecto (un solo mes) es demasiado chico para mostrarla, y mostrar el
chart únicamente con esa vista habría dado la impresión equivocada de
que no hay concentración.

### Técnica -- combo bar + línea, documentada por ser la primera vez

`ParetoChart` (`TabAnalytics.tsx`): `<rect>` por categoría (altura
proporcional a `count`, escala 0→`maxCount` sobre `plotHeight`) +
`<polyline>` de % acumulado (escala 0→100% SUPERPUESTA sobre el mismo
`plotHeight` -- dos ejes distintos comparten la misma altura de plot en
px, técnica estándar de combo chart) + línea de referencia punteada en
80%. Con más de 15 categorías (Loan Officer en YTD trae 37) se omiten las
etiquetas rotadas del eje -- se vuelven ilegibles superpuestas -- y el
detalle queda solo en el `<title>` (tooltip) de cada barra/punto; ninguna
categoría se omite del chart en sí, solo su etiqueta visible. Toggle
Selected period/YTD y Branch/Loan Officer reusan `.seg`
(`components.css`, ya usado por `PeriodSelector`/`PivotTable`/
`TabMilestoneMatrix`) -- cero CSS nuevo. Línea en `--rose-700` (no
`--coral`, reservado en esta pestaña para el resaltado de mes
seleccionado en Monthly Trends -- evita que el mismo color signifique
dos cosas distintas en la misma pantalla).

### Sin drill-down -- no se pidió para este chart

A diferencia de Strategy Mix/Rankings/Scorecards/Branch, este chart no
abre `LoanDetailModal` -- no estaba en el pedido y no se agregó por
cuenta propia.

### Archivos

`lib/pipeline/paretoMix.ts` (nuevo, puro -- `buildParetoRows`).
`app/pipeline/TabAnalytics.tsx` editado (`ParetoChart`, cómputo de
`ytdFunded`/`ytdBranchScorecard`/`ytdLoanOfficerScorecard`/`paretoData`,
sección "Pareto — Branch / Loan Officer"). `app/pipeline/styles/
forecast-visual.css` sin tocar en esta etapa (mismo motivo que Parte 10 --
estilos inline + `.seg` ya existente, nada nuevo que no pudiera
expresarse así) -- **sí se tocó después, ver Parte 12** (hover).

## Etapa F7, Parte 12 -- Pareto: etiquetas graduales, cruce de 80% marcado, hover, tooltip enriquecido

Cuatro mejoras sobre `ParetoChart` (Parte 11), sin tocar `paretoMix.ts`
(el cálculo de `count`/`percent`/`cumulativePercent` no cambió, solo cómo
se presenta).

### 1. Etiquetas del eje X -- gradual, no todo-o-nada

`PARETO_ALWAYS_LABELED = 8` (siempre las primeras 8) + `PARETO_LABEL_INTERVAL
= 4` (de ahí en más, una cada 4) vía `paretoShouldLabel(i)`. Reemplaza el
umbral binario anterior (`rows.length <= 15`, todo o nada). Con 37
categorías (Loan Officer, YTD) esto deja **16 etiquetas visibles**:
posiciones #1-9 (las primeras 8 + la #9, que cae justo en el primer
múltiplo de 4 después del corte) y luego #13, #17, #21, #25, #29, #33,
#37 -- nunca todas, nunca ninguna.

### 2. Cruce real de 80% -- marcado, no adivinado

`crossIndex = rows.findIndex(r => r.cumulativePercent >= 80)` -- la
primera categoría cuyo acumulado ya llega a 80%, no una posición
aproximada. Ese punto se dibuja más grande (`r={5.5}` vs `r={3}` de los
puntos normales) con contorno (`stroke="var(--canvas)"`, `strokeWidth=2`)
y una etiqueta corta arriba (ej. `"8 branches → 80%"`, pluralizado según
corresponda) -- generada del mismo `cut` que ya elige el toggle, sin
texto hardcodeado por corte.

### 3. Números sobre las barras -- solo donde hay espacio real

Mismas `PARETO_ALWAYS_LABELED` posiciones que las etiquetas del eje
(mismo umbral, no dos números mágicos distintos) llevan el conteo
encima de la barra -- mismo patrón visual que `SimpleMonthlyChart`
(Closings by Month, Parte 3). Se agregó `topReserve = 16px` (mismo tipo
de fix que `CHART_LABEL_RESERVE` de la Parte 3 -- overflow ya resuelto
antes en Monthly Trends) para que el número de la barra más alta no se
salga por arriba del `<svg>`.

### 4. Hover -- opacidad, mismo patrón que el resto de los charts

Nuevas clases `.pareto-bar`/`.pareto-dot` en `forecast-visual.css`
(`transition: opacity 0.15s ease`, `:hover { opacity: 0.82 }`) --
idéntico al hover ya usado en Closings/Amount/Loan Type. Agregadas
también al bloque `@media (prefers-reduced-motion: reduce)` ya existente
(`transition: none`), mismo criterio de accesibilidad no opcional.

### 5. Tooltip enriquecido -- mismo patrón `title` nativo, más contenido

Se revisó si existe algún componente real de hover-card/popover en el
resto de la app -- no existe ninguno (`formatCtcClosingTooltip` en
`PivotTable.tsx` y el `detail` de `DiagnosticsNote` son el único
precedente real, `title` nativo con `\n`). `paretoTooltip()` sigue ese
mismo criterio, con 4 líneas: nombre completo, conteo + % individual, %
acumulado, y posición en el ranking (`#N of M`). Mismo tooltip para la
barra y para el punto de la línea (antes eran dos textos distintos y más
pobres).

### Verificación real (snapshot activo id 74)

**YTD, Loan Officer (37 categorías):** 16 etiquetas visibles (posiciones
#1-9, 13, 17, 21, 25, 29, 33, 37) -- ni las 37, ni ninguna.

**Tooltip real, YTD/Branch, primera fila (716):**
```
716
51 loans (15.3% of total)
15.3% cumulative
#1 of 20
```

**Cruce de 80%, YTD/Branch (8 de 20):** cae en la 8ª barra (branch 770,
20 loans, 6.0% individual, 80.8% acumulado) -- punto marcado más grande
con contorno + etiqueta `"8 branches → 80%"` sobre ese punto exacto.

### Archivos

`app/pipeline/TabAnalytics.tsx` editado (`PARETO_ALWAYS_LABELED`,
`PARETO_LABEL_INTERVAL`, `paretoShouldLabel`, `paretoTooltip`,
`ParetoChart` con marca de cruce + números condicionales + `topReserve`).
`app/pipeline/styles/forecast-visual.css` editado (`.pareto-bar`/
`.pareto-dot`, agregadas al bloque `prefers-reduced-motion` existente).
`lib/pipeline/paretoMix.ts` sin tocar.

## Etapa F7, Parte 13 -- Pareto: color, etiqueta cortada (fix real de captura), resto sin cambios

Dos correcciones reales sobre la Parte 12, detectadas con una captura de
pantalla real (no solo lectura de código) -- las mejoras 3/5/6/7 de la
Parte 12 (etiquetas graduales, números condicionales, hover, tooltip
enriquecido) se revisaron y quedan **sin cambios**, siguen correctas.

### 1. Color -- rojo/`--rose-700` fuera de la línea acumulada

`--rose-700` ya significa "atención/advertencia" en el resto de la app
(`AlertTriangleIcon` de los scorecards, Parte 9) -- reusarlo acá para una
línea de tendencia neutra era una colisión de significado. Nueva
paleta, dentro de la familia azul de marca (sin color nuevo):

- Línea + puntos normales: `--sky` (distingue de las barras, `--navy`,
  sin salir del azul).
- Línea punteada de referencia del 80%: **sin cambios** -- ya estaba en
  `--slate-300` (neutro), no rojo.
- Marca del cruce de 80%: `--navy` (mismo tono que las barras, más
  oscuro que `--sky` de la línea -- "un tono distinto dentro de la misma
  paleta", no un color nuevo), con el mismo contorno claro (`--canvas`)
  de antes para que siga resaltando sobre los puntos normales.

### 2. Fix real: primera etiqueta cortada contra el borde izquierdo

⚠ **Encontrado con una captura de pantalla real, no solo con lectura de
código** -- con `leftPad = 6` (valor original), la etiqueta rotada -45°
de la primera barra (`textAnchor="end"`, ancla en `xCenter(0)`) se
extiende hacia la izquierda del ancla y se corta contra `x=0` del
`<svg>`. Se calculó el caso más exigente esperado ("Jose L Moreyra
Barco", ~20 caracteres) -- a fuente 9px rotada -45°, la extensión
horizontal estimada es ~71px. `leftPad` subió de 6 a **75px** (margen
real de ~17px sobre ese peor caso, no un número arbitrario).

⚠ **Sobre el tooltip superpuesto -- límite real, no resuelto del todo:**
el tooltip es el `title` nativo del navegador (mismo mecanismo que el
resto de la app, sin componente de hover-card propio, ver Parte 12) --
su posición la decide el navegador, no hay manera de forzarlo hacia la
derecha/arriba desde el SVG. El margen izquierdo más ancho (arriba)
reduce la probabilidad de choque visual porque le da más aire a la
primera barra/etiqueta, pero no es un control directo de dónde aparece
el tooltip nativo -- se documenta la diferencia entre "mitigado
indirectamente" y "resuelto", en vez de afirmar que quedó controlado.

### Archivos

Solo `app/pipeline/TabAnalytics.tsx`: `leftPad` (6 → 75), colores de
`polyline`/`circle` de la línea (`--rose-700` → `--sky`) y de la marca de
cruce de 80% (`--rose-700` → `--navy`). `lib/pipeline/paretoMix.ts` y
`forecast-visual.css` sin tocar en esta etapa.

## Etapa F7, Parte 14 -- Pareto: solo primeras 8 con nombre, sin intervalo cada 4

Ajuste a `paretoShouldLabel` (Parte 12): se quitó la parte "una etiqueta
cada 4 más allá de las primeras 8" -- ahora es estrictamente `i <
PARETO_ALWAYS_LABELED` (8). `PARETO_LABEL_INTERVAL` se eliminó del todo
(ya no hay una segunda constante que explicar). El tooltip sigue
disponible en cualquier barra, con o sin nombre en el eje. La etiqueta
del cruce de 80% (`"N loan officers → 80%"`) es independiente de esta
lógica -- no se tocó, sigue apareciendo siempre que haya un cruce real.

**Sin huecos visuales:** el espacio reservado debajo de las barras
(`labelSpace`) es el mismo para las 37 columnas de YTD/Loan Officer,
labeladas o no -- las barras 9+ simplemente no dibujan ningún `<text>`
ahí (ni tick, ni placeholder, ni línea vacía), así que el área se ve
como aire en blanco consistente, no como un elemento roto o faltante.
El alto reservado sigue siendo necesario igual: lo determinan las
primeras 8 barras, que sí llevan nombre rotado completo.

### Archivos

Solo `app/pipeline/TabAnalytics.tsx`: `paretoShouldLabel` simplificado,
`PARETO_LABEL_INTERVAL` eliminado.

## Etapa F7, Parte 15 -- Avg Ticket by Month

Nuevo chart dentro de Monthly Trends, en la posición #3 exacta pedida:
Closings by Month → Amount Closed by Month → **Avg Ticket by Month** →
Loan Type Distribution by Month.

### `avgTicketByMonth()` -- reusa `MonthlyTotal[]` ya calculado, no recalcula nada

`lib/pipeline/trends.ts`, nueva función, recibe el `MonthlyTotal[]` que
`buildMonthlyTotals` ya devuelve (el mismo array que ya consumen Closings/
Amount by Month en `TabAnalytics.tsx`) -- no vuelve a leer `loans` ni
recorre `resolvedLoans` una segunda vez:
```ts
export function avgTicketByMonth(totals: MonthlyTotal[]): MonthlyAvgTicket[] {
  return totals.map((m) => ({
    month: m.month,
    avgAmount: m.count > 0 ? m.amount / m.count : 0,
  }));
}
```
Misma guarda contra división por cero que `ScorecardRow.avgAmount`
(`lib/pipeline/scorecards.ts`) -- un mes sin loans (sep-dic 2026) queda en
`avgAmount: 0` explícito, nunca `NaN`.

### Línea, no barras -- mismo criterio ya usado para la curva del Pareto

`AvgTicketChart` (nuevo, `TabAnalytics.tsx`): SVG a mano con `<polyline>`
+ puntos -- es una sola serie continua, no un conteo/monto discreto por
mes como Closings/Amount, así que una línea comunica la evolución sin
inventar una segunda marca redundante (mismo razonamiento del
diagnóstico previo a esta etapa). Sigue las mismas convenciones visuales
que el resto de Monthly Trends: mismo `shortMonth()`, mismo criterio de
tooltip `"(no data yet)"` para meses en 0, mismo resaltado de mes
seleccionado.

### Resaltado del mes seleccionado -- coral, mismo patrón

El punto del mes que cae dentro del período elegido en el selector se
dibuja más grande y en `--coral` (en vez de `--navy`); su tick del eje
usa la nueva clase `.trend-chart__tick--highlight` -- mismo tratamiento
visual que ya usa `.trend-chart__col--highlight .trend-chart__tick` en
los charts de barra, pero declarada standalone porque acá los ticks no
están envueltos en `.trend-chart__col` (no hay una barra propia por mes
en un chart de línea).

### Línea de referencia -- promedio PONDERADO, no el promedio simple de los promedios

⚠ Decisión explícita: el promedio general de referencia se calcula como
`suma(amount de meses con datos) / suma(count de esos mismos meses)` --
NO como el promedio simple de los 8 promedios mensuales. La diferencia es
real con los datos actuales: promedio ponderado = **$347,943**, promedio
simple de los 8 promedios = $349,589 -- distinto porque un mes de 24
loans (agosto) no debe pesar igual que uno de 57 (julio) al calcular "el
ticket promedio del año". Color `--slate-500`/línea punteada -- neutro,
no compite con `--coral` (mes resaltado) ni `--navy` (la línea de datos).

### Formato de etiquetas -- corto (K), confirmado el más legible para el rango real

Con el rango real (~$329K-$375K), `fmtAmountShort` (ya usado en Amount
Closed by Month) da etiquetas como "$375K" en vez de "$374,842" -- mismo
criterio ya validado en esa etapa, reusado tal cual, sin una función de
formato nueva.

### Hover -- opacidad, mismo patrón

Nueva clase `.avgticket-dot` (`forecast-visual.css`) -- `transition:
opacity 0.15s ease`, `:hover { opacity: 0.82 }`, agregada también al
bloque `prefers-reduced-motion` existente.

### Números reales (snapshot activo id 74)

| Mes | Cierres | Monto | Ticket promedio |
|---|---|---|---|
| Enero | 38 | $14,243,978 | $374,842 |
| Febrero | 32 | $10,985,871 | $343,308 |
| Marzo | 39 | $12,829,298 | $328,956 |
| Abril | 56 | $18,896,194 | $337,432 |
| Mayo | 42 | $15,559,781 | $370,471 |
| Junio | 46 | $15,503,200 | $337,026 |
| Julio | 57 | $19,487,582 | $341,887 |
| Agosto | 24 | $8,706,991 | $362,791 |
| Sep-Dic | 0 | $0 | $0 (sin error, sin `NaN`) |

**Promedio general de referencia (ponderado): $347,943.**

### Archivos

`lib/pipeline/trends.ts` editado (`MonthlyAvgTicket`, `avgTicketByMonth`).
`app/pipeline/TabAnalytics.tsx` editado (`AvgTicketChart`, cómputo de
`avgTicketData`/`overallAvgTicket`, card en la posición #3 de Monthly
Trends). `app/pipeline/styles/forecast-visual.css` editado
(`.trend-chart__tick--highlight`, `.avgticket-dot`, agregada al bloque
`prefers-reduced-motion`).

## Etapa F7, Parte 16 -- Avg Ticket by Month: fix real de escala, no un bug de datos

Reportado con una captura real: mayo/junio se veían en 0 en el chart.

### Diagnóstico -- auditoría completa, sin encontrar un bug de índice/datos

Se verificaron los 3 puntos pedidos:
1. `avgTicketByMonth()` es un `.map()` 1 a 1 sobre `MonthlyTotal[]` --
   sin reordenar, sin filtrar, sin lógica condicional por mes. No hay
   forma estructural de que zere específicamente mayo/junio.
2. `AvgTicketChart` usa `avgTicketData = avgTicketByMonth(monthlyTotals)`
   -- el MISMO `monthlyTotals` que ya consumen Closings/Amount by Month
   (una sola variable en el componente, sin duplicado ni shadow).
3. Se simuló la fórmula real con los 8 valores reales conocidos
   (Ene-Ago) -- los 8 `y()` calculados dieron todos dentro de rango
   válido (0-110px), ninguno en un valor erróneo o fuera de los límites
   del `<svg>`.

**No se encontró ningún bug de índice, de datos, ni de rango.** Los
valores que el chart dibujaba SÍ eran los correctos.

### Causa real -- compresión visual por escala 0-based, no un bug de valores

Los 8 meses reales están todos en una banda angosta (~$329K-$375K, un
rango del 14%). Con la escala anterior (0-based, igual que Closings/
Amount), esa banda entera ocupaba solo el **12% superior** de los 110px
del plot -- una diferencia de 1 a 13px entre meses, indistinguible a
simple vista en una captura. Eso es consistente con lo reportado: no es
que mayo/junio valieran 0, es que TODOS los meses reales estaban
amontonados casi en el mismo pixel, y esa compresión se leyó como "cae a
0". A diferencia de Closings/Amount (donde 0 es un valor real y
significativo -- cero cierres, cero monto), acá $0 es un CENTINELA de
"sin datos" -- un mes real nunca vale $0 de verdad, así que forzar la
escala a arrancar en $0 no aporta legibilidad, solo la destruye.

### Fix -- escala acotada al rango real, meses sin datos aparte

Los meses CON datos ahora usan una escala acotada a su propio rango
(`domainMin`/`domainMax`, con 15% de margen a cada lado) -- usan el alto
completo del plot en vez de un 12%. Los meses SIN datos (`avgAmount ===
0`) quedan fijos en el fondo (`y = plotHeight`), fuera de esa escala fina
-- y la línea (`<polyline>`) conecta SOLO los meses con datos reales,
nunca un mes sin datos, para no dibujar una caída visual falsa entre un
valor real y el "aparcado abajo" de un mes futuro (son datos de
naturaleza distinta, no una caída real).

### Verificación real -- posiciones antes/después

| Mes | y() ANTES (0-based, px) | y() AHORA (escala acotada, px) |
|---|---|---|
| Enero | 0.0 | 12.7 |
| Febrero | 9.3 | 70.8 |
| Marzo | 13.5 | 97.3 |
| Abril | 11.0 | 81.7 |
| Mayo | 1.3 | 20.8 |
| Junio | 11.1 | 82.4 |
| Julio | 9.7 | 73.5 |
| Agosto | 3.5 | 34.9 |
| Sep-Dic | 110.0 (igual) | 110.0 (igual, sin cambios) |

Antes: los 8 meses reales caían todos entre 0.0 y 13.5px (13.5px de
rango total). Ahora: entre 12.7 y 97.3px (84.6px de rango, prácticamente
el alto completo del plot) -- mayo (20.8px) y junio (82.4px) quedan
claramente separados y distinguibles, ya no indistinguibles de un pixel
al otro.

### Archivos

Solo `app/pipeline/TabAnalytics.tsx`: `AvgTicketChart` -- nueva lógica de
dominio acotado (`realValues`/`minReal`/`maxReal`/`domainMin`/
`domainMax`), `y()` redefinida, `linePoints` filtrado a meses con datos.
`lib/pipeline/trends.ts` y `forecast-visual.css` sin tocar en esta
etapa.

## Etapa F7, Parte 17 -- Avg Ticket by Month: fix real del wrapper CSS, no de los datos

Reportado con una segunda captura real: tras el fix de escala (Parte 16),
la línea solo conectaba enero-abril; mayo-agosto quedaban como puntos
sueltos.

### Diagnóstico -- se probó matemáticamente que los 8 puntos SÍ estaban completos

Se construyó a mano, con los 8 valores reales, el string exacto que arma
`linePoints` (mismo código, mismos números) para descartar cualquier duda
sin depender de un navegador:

```
8,12.69 59.64,70.84 111.27,97.31 162.91,81.68 214.55,20.75 266.18,82.43 317.82,73.46 369.45,34.91
```

**8 pares de coordenadas, los 8 meses (Ene-Ago), en orden, todos números
válidos (sin `NaN`, sin token malformado).** El array `realPoints`
(`rows.map((r,i) => ({r,i})).filter(({r}) => r.avgAmount > 0)`) SÍ
conservaba los 8 -- confirmado con prueba, no solo lectura de código. La
lógica de datos/índices de la Parte 16 estaba bien; el problema reportado
era real, pero la causa era otra.

### Causa real -- clase CSS equivocada para el wrapper del SVG

El `<svg>` estaba envuelto en `.trend-chart__plot`
(`display: flex; align-items: flex-end`, `forecast-visual.css`) -- una
clase diseñada para las COLUMNAS FLEX de los charts de barra
(`SimpleMonthlyChart`), no para un `<svg>` de ancho fijo (640px). Un
`<svg>` como único hijo de un contenedor flex puede angostarse
(`flex-shrink` default del navegador) si el contenedor real es más
angosto que esos 640px, distorsionando el render de forma dependiente
del navegador/viewport -- consistente con "la línea se corta" sin que
los datos en sí estuvieran mal. `ParetoChart` (Parte 11), el otro chart
SVG-a-mano de esta pestaña, ya resolvía esto correctamente con un
wrapper simple (`<div style={{ overflowX: 'auto' }}>`), sin usar
`.trend-chart__plot` -- `AvgTicketChart` reusó por error la clase
equivocada (pensada para bloques flex de barras) en vez de seguir el
precedente correcto del propio chart hermano.

### Fix

Se reemplazó el wrapper por el mismo patrón de `ParetoChart`:
`<div style={{ overflowX: 'auto' }}>` envolviendo el `<svg>` -- sin
`display: flex`, sin `flex-shrink` implícito, el SVG conserva su ancho
real de 640px y hace scroll horizontal si el contenedor es más angosto,
en vez de comprimirse de forma impredecible.

### Archivos

Solo `app/pipeline/TabAnalytics.tsx`: wrapper del `<svg>` de
`AvgTicketChart` cambiado de `className="trend-chart__plot"` a un `div`
con `overflowX: 'auto'` inline (mismo patrón que `ParetoChart`). Ningún
cambio en la lógica de `x()`/`y()`/`linePoints` (ya verificados correctos
en el diagnóstico de esta etapa).

## Etapa F7, Parte 18 -- Avg Ticket by Month: fix real de la desalineación con el eje

Reportado con una tercera captura real: la línea ya conectaba los 8
puntos (Parte 17), pero quedaban desalineados horizontalmente contra las
etiquetas "Jan"-"Dec" -- agosto (coral) flotaba entre "Apr" y "May" en
vez de debajo de "Aug".

### Causa real -- dos sistemas de coordenadas horizontales distintos, no un bug de índice

`x(i)` ya usaba el índice real (0-11, agosto=7) sobre un `step` calculado
con `rows.length` = 12 -- confirmado, no era un bug de "8 en vez de 12"
como se sospechaba inicialmente. El problema real: esa posición vive
DENTRO del ancho fijo del `<svg width={640}>`, mientras que las
etiquetas de mes vivían en un `<div className="trend-chart__axis">`
APARTE, layouteado por flexbox (`.trend-chart__tick { flex: 1 1 0 }`) --
un sistema de coordenadas totalmente independiente. El ancho real que el
navegador le da a esa fila flex no tiene ninguna relación garantizada
con los 640px internos del SVG, así que por más correcto que estuviera
`x(i)`, los puntos y las etiquetas quedaban en dos escalas horizontales
distintas por construcción -- ningún valor de `x(i)` podía arreglar eso,
porque el problema no estaba en la fórmula.

`ParetoChart` (Parte 11) nunca tuvo este problema por el mismo motivo al
revés: sus etiquetas de categoría ya viven DENTRO del mismo `<svg>`, como
`<text>` posicionados con la misma función que ya usan las barras/puntos.

### Fix -- etiquetas de mes movidas dentro del mismo SVG

Se eliminó el `<div className="trend-chart__axis">` separado; las 12
etiquetas de mes ahora son `<text>` dentro del mismo `<g>` que la línea y
los puntos, posicionadas con la MISMA función `x(i)` -- mismo patrón que
`ParetoChart`. Esto garantiza alineación exacta por construcción (mismo
sistema de coordenadas), sin depender de que el ancho real del
contenedor coincida con ningún valor fijo. Nuevo `bottomReserve = 18`
(px) para el espacio de esas etiquetas dentro del `viewBox`.

### Verificación real -- x() de los 12 meses

| Mes | Índice | x() |
|---|---|---|
| Jan | 0 | 8.00 |
| Feb | 1 | 59.64 |
| Mar | 2 | 111.27 |
| Apr | 3 | 162.91 |
| May | 4 | 214.55 |
| Jun | 5 | 266.18 |
| Jul | 6 | 317.82 |
| **Aug** | **7** | **369.45** |
| Sep | 8 | 421.09 |
| Oct | 9 | 472.73 |
| Nov | 10 | 524.36 |
| Dec | 11 | 576.00 |

Confirmado: agosto (punto de datos Y etiqueta "Aug") caen ambos en
**x=369.45** -- la misma coordenada exacta, porque ahora los calcula la
misma función sobre el mismo sistema de coordenadas. Antes de este fix
no había forma de garantizar esa igualdad, sin importar qué tan
"correcto" pareciera `x(i)` en aislamiento.

### Archivos

`app/pipeline/TabAnalytics.tsx`: `AvgTicketChart` -- etiquetas de mes
movidas de `.trend-chart__axis` (div flex externo) a `<text>` dentro del
`<svg>`, `bottomReserve` nuevo. `app/pipeline/styles/forecast-visual.css`:
`.trend-chart__tick--highlight` (agregada en la Parte 15, sin ningún otro
uso en el proyecto) se eliminó -- código muerto tras este cambio, no
código dejado "por si acaso". `lib/pipeline/trends.ts` sin tocar.

## Etapa F7, Parte 19 -- diagnóstico "excluded": significado, no mecanismo

El texto anterior ("known non-person entry/entries", "excluded via
org.source_name_excluded") describía el MECANISMO técnico, no el
significado real -- y de hecho sugería la causa equivocada. La propia
documentación de `buildExcludedIndex()` (`lib/business-plan/aliasIndex.ts:100-111`)
dice explícito: de los 36 nombres excluidos, la razón típica es "no son
LOs de la división", no "no es una persona" -- el caso real ya
confirmado, Anthony Ditoma (Loan Officer real, con préstamos reales en
branch 733 y 150), es exactamente eso, no una cuenta de sistema ni un
dato mal capturado.

### Redacción nueva -- genérica a propósito, sin asumir el motivo

`"outside this scorecard's roster"` cubre tanto el motivo de hoy (otra
división) como uno futuro sin ejercitar todavía (cuenta de sistema, ej.
"sf integrations", buscado y no encontrado en el snapshot activo desde
la Etapa F7.2) -- sin necesitar distinguirlos en el texto visible, y sin
nombrar `org.source_name_excluded` en ningún lado.

**Resumen (icono/summary)** -- caso puro (solo excluidos, sin
no-reconocidos ni vacíos): frase dedicada, mismo tono del ejemplo
pedido. Para una mezcla de categorías, la frase general de siempre, con
la parte "excluded" reformulada dentro de la lista entre paréntesis
(`"N outside this scorecard's roster"` en vez de `"N known non-person
entries"`).

**Detalle (tooltip completo)** -- reescrito completo, sin nombres de
tabla en ninguna línea: "N loans resolved to a person via the company
roster." + una línea por categoría con problema, en lenguaje simple. La
lista de nombres no reconocidos (`unmappedNames`) se conserva -- es dato
accionable real, no jerga técnica.

### Motivo/`reason` en el tooltip -- no traído, no está modelado en ningún lado del código hoy

Se evaluó explícito, como pedía la tarea. `org.from('source_name_excluded').select('source_system, name_raw')`
(`useOrgRoster.ts`) solo trae esos dos campos -- ningún `reason` ni
similar. `buildExcludedIndex(rows: { source_system, name_raw }[])`
(`lib/business-plan/aliasIndex.ts`) tampoco lo recibe ni lo expone.
Traerlo requeriría tocar los dos archivos -- el segundo, compartido con
Business Plan, deliberadamente sin cambios desde la Etapa 2 de esta
misma serie. **No se implementó** (era "opcional, no bloqueante") --
queda anotado como mejora futura real, no descartada por falta de
interés sino por alcance de archivos de esta etapa puntual.

### Texto real esperado -- caso Anthony Ditoma (agosto 2026)

⚠ Con los números ya conocidos de esta sesión (24 loans, 0 con
`loan_officer` vacío -- verificado por script -- y Anthony Ditoma
identificado como el único caso "excluded" en agosto, sin confirmación
en pantalla de que `unmappedCount` sea 0): si `resolvedCount=23,
excludedCount=1, unmappedCount=0, blankCount=0` (la combinación más
probable, no verificada con sesión de navegador real), el texto sería:

**Summary:**
```
1 loan's owner is outside this scorecard's roster
```

**Detail:**
```
23 loans resolved to a person via the company roster.
1 loan belongs to someone not part of this division's roster -- their production is included in the totals above, but they don't get their own row in this breakdown.
```

### Archivos

Solo `app/pipeline/TabAnalytics.tsx`: `personDiagnosticsNote()`
reescrita (mismo shape de retorno `{count, summary, detail}`, mismo
`console.warn` de reconciliación sin cambios). `docs/ARQUITECTURA.md`.
Ningún archivo de `lib/business-plan/**` ni `useOrgRoster.ts` tocado.

## Etapa F7.20 -- columna "Opportunity Owner", de punta a punta

Autorizado por Isa: `opportunity_owner` ya existe en `pipeline_loans`/
`pipeline_resolved_loans`, y `save_pipeline_snapshot()` ya está ampliada
(verificado por ella, conserva los 8 campos anteriores). Implementación
en el orden confirmado: parser → tipo → mapper de subida → mapper de
lectura → scorecard.

### Las 4 capas de código

1. **Parser** (`lib/pipeline/sources/salesforce-file.ts`): nuevo
   `idx['Opportunity Owner']`, campo `opportunityOwner` en `RawRow`, leído
   en los 2 formatos (A y B), pasado a `PipelineLoan`/`ResolvedLoan` en
   `classifyRow()` -- mismo patrón exacto que los 5 crudos de F6.
2. **Tipo** (`lib/pipeline/types.ts`): `opportunityOwner: string` en
   `PipelineLoan` y `ResolvedLoan`.
3. **Mapper de subida** (`app/api/pipeline/parse/route.ts`):
   `opportunity_owner: loan.opportunityOwner` en los 2 inserts (open y
   resolved) -- mismo criterio `''` vs `NULL` ya documentado para F6.
4. **Mapper de lectura** (`app/api/pipeline/latest/route.ts`): columna
   agregada a los 2 `select(...)`, `opportunityOwner: r.opportunity_owner
   ?? ''` en los 2 mapeos -- el `?? ''` importa de verdad: confirmado con
   datos reales que la base guarda `NULL` (no `''`) para snapshots
   viejos, ver más abajo.

### Fix necesario, no pedido explícito: el drill-down de Business Developer resolvía el campo equivocado

`loanResolvesToEmployeeKey()` (usada por el click de fila en Loan
Officer y Business Developer para abrir `LoanDetailModal`) tenía
`loan.loanOfficer` hardcodeado -- si el scorecard de BD pasa a agrupar
por `opportunityOwner` pero el drill-down seguía resolviendo
`loanOfficer`, el click en una fila de BD habría abierto los préstamos
de la persona equivocada (mismo tipo de bug que motivó esta etapa, pero
en el modal en vez del scorecard). Se parametrizó con un
`getRawName: (loan) => string`, igual que ya hace `buildPersonScorecard`
en `scorecards.ts` -- Loan Officer sigue pasando `(loan) =>
loan.loanOfficer`, Business Developer ahora pasa `(loan) =>
loan.opportunityOwner`.

### Scorecard (`lib/pipeline/scorecards.ts`)

`buildBusinessDeveloperScorecard`: una línea, `buildPersonScorecard(bdLoans,
(loan) => loan.opportunityOwner, ...)` en vez de `(loan) =>
loan.loanOfficer`. El filtro de quién ES Business Developer
(`opportunityOwnerTitle === 'Business Developer'`) no cambió. "sf
integrations" se excluye por el mismo `excludedIndex` ya usado para Loan
Officer -- ningún chequeo nuevo, mismo mecanismo aplicado a una columna
distinta.

### Mensaje "sin datos de owner" -- verificado con datos reales, no solo por código

`bdOwnerDataMissing` (`TabAnalytics.tsx`): `true` cuando
`diagnostics.totalInput > 0 && diagnostics.blankCount ===
diagnostics.totalInput` -- todos los BD-titled del período vinieron sin
`opportunityOwner`, a diferencia de "0 Business Developers reales"
(`totalInput === 0`, un resultado distinto y legítimo). Cuando es
`true`, la tarjeta de Business Developer muestra el mensaje explícito en
vez de `ScorecardTable` (que de otro modo mostraría "No funded loans in
this period", engañoso acá).

**Verificado contra el snapshot activo real (id 74, antes de cualquier
carga nueva):** 113 loans BD-titled, **los 113 con
`opportunity_owner` = `NULL` en la base** (no `''`) -- confirma que el
`?? ''` del mapper de lectura es necesario de verdad, y que
`bdOwnerDataMissing` evalúa `true` para este snapshot con datos reales,
no solo en teoría.

### ⚠ Verificación de carga real -- NO SE PUDO EJECUTAR desde este entorno

Isa pidió explícito "verificar CONTRA LA BASE, no solo que la respuesta
del upload fue 200" -- se intentó, pero `/api/pipeline/parse`
(`app/api/pipeline/parse/route.ts`) usa `getServerClient('pipeline_forecast')`
(`lib/supabase/server.ts`), que arma el cliente de Supabase con la
**sesión del usuario que hizo la request** (cookies del navegador) --
sin `service_role`, por diseño (RLS exige un usuario autenticado, ver
comentario de Etapa AUTH1 en ese archivo). Sin una sesión de navegador
real, esta ruta no escribe nada -- mismo tipo de bloqueo que ya viene
limitando el acceso a `org` durante toda esta sesión, ahora confirmado
también para escrituras a `pipeline_forecast` vía esta ruta específica.

**No se hizo la carga de prueba.** Queda pendiente que Heather la haga
desde el navegador real -- con el archivo de referencia más reciente
disponible (`Forecast_Pipeline_2026-08-24 (1).xlsx`, en Descargas al
momento de este reporte, o el que corresponda). Después de esa carga,
sí se puede verificar contra la base con `service_role` de solo lectura
(mismo mecanismo ya usado en toda la sesión) -- la query de verificación
ya queda preparada en `docs/sql/2026-08-25-opportunity-owner-column.sql`.

### Archivos

`lib/pipeline/sources/salesforce-file.ts`, `lib/pipeline/types.ts`,
`app/api/pipeline/parse/route.ts`, `app/api/pipeline/latest/route.ts`,
`lib/pipeline/scorecards.ts`, `app/pipeline/TabAnalytics.tsx` (mensaje +
fix del drill-down). Además, dos archivos fuera del alcance original de
5+docs pero necesarios para que `tsc` compile (ambos construyen un
`PipelineLoan` literal a mano): `fixtures/pipeline-demo.ts` y
`scripts/test-aggregate.ts` -- una línea cada uno (`opportunityOwner:
''`), mismo patrón que los cinco crudos de F6 en esos mismos archivos.

## Etapa F7.21 -- nota descriptiva en Avg Ticket by Month

Avg Ticket by Month era el único chart de Monthly Trends sin ninguna
`DiagnosticsNote` propia -- los otros cuatro (Rankings, Scorecards,
Monthly Trends, Strategy Mix, Pareto) ya tenían una. Se agregó una,
mismo componente y mismo patrón de colocación ya usado para Strategy
Mix/Pareto (justo encima del `tbl-card` del chart, `count={1}` porque
no es un diagnóstico condicional):

- `summary` (siempre visible): "Average loan amount per closing, by
  month (total amount ÷ closings -- not a margin or division earnings
  figure)."
- `detail` (tooltip nativo al pasar el mouse): referencia explícita a
  `avgTicketByMonth()` (`lib/pipeline/trends.ts`), aclarando que divide
  el mismo `monthlyTotals` que ya usan los charts de Closings/Amount de
  arriba -- no es un campo separado del export ni una fuente de datos
  distinta.

Motivo: sin esta nota, el número podía leerse como una cifra de
ganancia/comisión de la división en vez de lo que realmente es --
tamaño promedio del préstamo (monto ÷ conteo, derivado, no un dato
directo del archivo de Salesforce). Redacción que evita esa confusión
sin introducir mecanismo nuevo: mismo componente `DiagnosticsNote`, sin
cambios de lógica ni de datos.

Archivos: `app/pipeline/TabAnalytics.tsx` (una `DiagnosticsNote` nueva,
sin tocar `AvgTicketChart` ni `avgTicketByMonth()`).

## Etapa F7.22 -- nombres con U+FFFD ("�") en el tooltip de diagnóstico

Se reportó que "Javier Peñaloza" se veía como "Javier Pe�aloza" en el
tooltip de nombres no reconocidos del scorecard de Business Developer.
Investigado a fondo -- **no es un bug de este parser ni de
`opportunityOwner` en particular**:

- Leyendo los BYTES crudos (sin ningún parseo propio, `fs.readFileSync`
  directo) de exports CSV reales de Salesforce, se confirmó que el
  carácter ya viene roto en el archivo de origen: los bytes UTF-8 de
  U+FFFD (`EF BF BD`) ya están en el lugar de la ñ, antes de que
  cualquier código de esta app lo lea. Confirmado en dos archivos CSV
  reales distintos ("Javier Pe[FFFD]aloza", "Eduardo Nu[FFFD]ez Mr
  Flip").
- Confirmado que es específico del formato CSV: un export XLSX real de
  la misma fecha, con nombres igual de acentuados (ej. "Norfael
  Rodríguez Jaimes"), se lee perfectamente limpio -- XLSX guarda texto
  como XML UTF-8 internamente, más robusto que el CSV que genera
  Salesforce en este caso.
- Confirmado que el problema YA existía antes de `opportunityOwner`:
  datos reales ya cargados (snapshot 75) tenían el mismo patrón en
  `referred_by` ("Eduardo Nu�ez Mr Flip") -- pasó desapercibido porque
  `loan_officer`/`referred_by` casi siempre se muestran resueltos vía
  `org.employee_alias` (nombre limpio de `dim_employee.full_name`, no el
  crudo del archivo). `opportunityOwner`, con muchos nombres aún sin
  mapear, es el primer lugar donde se expone un nombre CRUDO
  directamente al usuario -- ahí es donde se hizo visible, no donde se
  originó.

U+FFFD significa "byte no decodificable" -- el carácter original ya se
perdió de forma irrecuperable en el momento en que Salesforce generó el
CSV. No hay ningún fix de causa raíz posible en el código: reemplazar
"�" por una letra específica sería adivinar, no corregir.

Decisión (consultada explícitamente): en vez de dejar el "�" sin
contexto o intentar "arreglarlo", se agregó una advertencia visible
junto al nombre dañado en el mismo tooltip donde ya aparecía --
`hasDamagedEncoding()` (`app/pipeline/TabAnalytics.tsx`) detecta
U+FFFD en `nameRaw` y `personDiagnosticsNote()` le agrega
`[damaged in Salesforce export -- character lost at the source, not a
parsing error]` junto al nombre. Aplica automáticamente a los tres
scorecards de persona (Loan Officer, Business Developer, y cualquier
otro que use `personDiagnosticsNote()` en el futuro), no solo a
`opportunityOwner`. Verificado que no genera falsos positivos contra
nombres acentuados limpios ("Ana Peña", "Norfael Rodríguez Jaimes").

Archivos: `app/pipeline/TabAnalytics.tsx` (`hasDamagedEncoding()` +
un cambio en `personDiagnosticsNote()`). Sin cambios en el parser,
tipos, ni mappers de subida/lectura -- no había nada que corregir ahí.

## Etapa F7.23 -- Strategy Mix respeta el mismo aviso de "sin datos" que Business Developer

Pedido explícito: un snapshot anterior al 23 de agosto (sin los cinco
crudos de estrategia -- Etapa F6) hace que `classifyStrategy()` caiga en
`'Own production'` para el 100% de los loans, porque es el valor por
default de esa función cuando `strategyRaw`/`opportunityOwnerTitle`
vienen vacíos. Sin este aviso, Strategy Mix mostraría un donut con una
única porción de "Own production" al 100% -- se lee como un resultado
real de negocio y no lo es.

- **Strategy Mix:** `hasStrategyData()` (`lib/pipeline/strategy.ts`) ya
  existía desde la Etapa F6 exactamente para este caso (`loans.some((l)
  => l.strategyRaw !== '' || l.opportunityOwnerTitle !== '')`), pero
  nunca se había conectado a esta vista. Se agregó `strategyDataMissing`
  en `TabAnalytics.tsx` (`fundedInRange.length > 0 &&
  !hasStrategyData(fundedInRange)`, mismo criterio de `totalInput > 0`
  que ya usa `bdOwnerDataMissing` para no disparar el aviso con un
  período sin ningún loan) y se envolvió el donut en la misma condición
  que ya usa el scorecard de Business Developer (F7.20): si falta el
  dato, `"No strategy data in this snapshot -- re-upload required to
  populate this view."` en vez del gráfico.
- **Pareto:** revisado `buildParetoRows()` (`lib/pipeline/paretoMix.ts`)
  y su uso en `TabAnalytics.tsx` -- confirmado que solo consume
  `ScorecardRow.closedCount` de `branchScorecard`/`loanOfficerScorecard`
  (`buildBranchScorecard`/`buildLoanOfficerScorecard`,
  `lib/pipeline/scorecards.ts`), que agrupan por `branch`/`loanOfficer`
  -- ninguno de los cinco crudos de estrategia. Un snapshot viejo sin
  esas columnas no afecta a Pareto de ninguna forma; no hace falta
  ningún aviso ahí hoy. Queda anotado (no implementado, no aplica
  todavía) que si en el futuro Pareto se agrupara por Strategy u otro
  campo dependiente de F6, tendría que replicar el mismo criterio.

Archivos: `app/pipeline/TabAnalytics.tsx` (import de `hasStrategyData`,
`strategyDataMissing`, ternario alrededor de `StrategyDonutChart`). Sin
cambios en `lib/pipeline/strategy.ts` (el helper ya existía tal cual se
necesitaba) ni en `paretoMix.ts`.

## Hallazgo pendiente -- "Branch Transfer" no se persiste para préstamos Funded/Adverse

Reportado por Heather: préstamos marcados como "Branch Transfer" en el
reporte de Salesforce no aparecían marcados en la columna nueva "Branch
Transfer" del Excel (Etapa EXCEL-2). Investigado con datos reales
(archivo de referencia "Forecast - Pipeline Report-2026-08-21-17-00-11.csv",
formato Salesforce real, 16 filas con `Branch Transfer = 1`):

- El parser (`lib/pipeline/sources/salesforce-file.ts`,
  `parseBranchTransfer()`) lee la columna correctamente -- confirmado
  corriendo el parser real contra el archivo: 16 de 16 filas marcadas
  llegaron con `branchTransferred: true` (5 en `openLoans`, 11 en
  `resolvedLoans`).
- La causa está en la persistencia, ya documentada desde la Etapa F5a en
  `app/api/pipeline/latest/route.ts` (~línea 203): `pipeline_resolved_loans`
  (préstamos Funded/Adverse) **nunca tuvo columna `branch_transferred`**
  -- a diferencia de `pipeline_loans` (préstamos abiertos), que sí la
  tiene y sí la guarda/lee bien. En F5a se decidió no bloquear esa etapa
  por esto porque el campo no entraba en ningún cálculo del Forecast --
  seguía siendo cierto entonces. La columna nueva del Excel es el primer
  consumidor que lo hace visible: 11 de los 16 casos reales del archivo
  de referencia caen justo en el grupo Funded/Adverse, así que la mayoría
  de los "Branch Transfer" que se esperaría ver en el Excel no aparecen.

**No corregido todavía** -- pendiente de una migración (`ALTER TABLE
pipeline_forecast.pipeline_resolved_loans ADD COLUMN branch_transferred
boolean`) + la ampliación correspondiente de
`pipeline_forecast.save_pipeline_snapshot()` (mismo patrón ya aplicado
dos veces en esta rama para `strategy_raw`/... y `opportunity_owner` --
sin la RPC ampliada, la columna nueva se descartaría en silencio igual
que pasó con esas dos). Se decidió explícitamente dejar solo esta
constancia por ahora, sin preparar el SQL ni tocar código, hasta que se
priorice.

## Nota -- EXCEL-4 (fix de la carrera del botón Download Excel) sin verificación real todavía

El fix de la Etapa EXCEL-4 (`isAdverseHistoryLoading`, botón Download
Excel deshabilitado hasta que `/api/pipeline/adverse-history` termina)
quedó **implementado y con `tsc` limpio, pero sin confirmarse contra un
caso real en el navegador** -- no se forzó una carga de prueba solo para
validar esto puntual. Pendiente de confirmarse en el próximo uso normal
de la app: al cargar un snapshot, el botón debería mostrarse
deshabilitado con "Preparing…" por un instante y habilitarse recién
cuando el Excel resultante va a traer las filas Adverse completas.

## Etapa EXCEL-6 -- hoja de portada + resumen por estrategia (siempre completo) + Channel en Adverse

El Excel de Forecast pasó de 1 hoja a 3: **Cover** (portada, nueva),
**Strategy Summary** (resumen por estrategia, nueva) y **Pipeline** (el
detalle de siempre, mismo comportamiento, con un filtro nuevo).

**Cover (primera hoja).** Puro key/value, sin cálculo -- todo ya
resuelto en `page.tsx` (`coverSheetData`): id y fecha del snapshot
activo, rango de Pipeline (Total/Healthy) y Forecast Month
(Closed/Forecast/Adverse) por separado -- **son dos rangos distintos
en esta app** (`pipelineDateRange` vs. `forecastRange`, F5j), mostrar
solo uno habría sido impreciso, no una simplificación razonable.
Branch/Strategy/Channel filtrados (o "All ..." si no aplica), y la nota
pedida explícita por Isa: *"Summary sheet totals reflect the full
period, regardless of any strategy/channel filter applied. Detail
sheet reflects only what was filtered."*

Nota de alcance: "Strategy filter" en la portada describe el EFECTO
sobre el export (`activeStrategyFilter` -- una estrategia puntual, o
"All strategies"), no distingue la vista cruda de PivotTable ("By
branch" vs. "By strategy" con píldora en "All") -- esa distinción no
está expuesta hoy fuera de PivotTable.tsx, y el alcance de esta etapa
en ese archivo se limitó explícitamente a agregar `export` a
funciones/tipos ya existentes, no a agregar un callback nuevo. Las dos
vistas producen el mismo efecto sobre el export ("sin filtro"), así
que la portada describe eso, no el estado interno del conmutador.

**Strategy Summary (segunda hoja).** `buildBranchRows()`/`buildStrategyRows()`
(`PivotTable.tsx`) se exportaron tal cual (decisión ya tomada: sin
mover a `lib/pipeline/`) -- `page.tsx` las llama una segunda vez, con
los MISMOS argumentos que ya recibe `<PivotTable>`
(`filteredBranchRows`/`filteredResolvedLoans`/`forecastRange`/`knownBranches`/`PULL_THROUGH_RATES`),
junta el `strategyRows` de cada `BranchRow` resultante y suma por
estrategia, pre-sembrando las 5 (`STRATEGY_ORDER`) en cero antes de
acumular -- mismo patrón que `buildStrategyMix()`
(`lib/pipeline/strategyMix.ts`). **Ignora `activeStrategyFilter` a
propósito** (confirmado por Isa): `filteredBranchRows`/`filteredResolvedLoans`
nunca pasan por ese filtro, así que el resumen es siempre el período
completo (con branch aplicado, sin estrategia). La fila "Total" es la
suma de las 5 filas -- cuadra por construcción, porque
`buildStrategyRows()` reparte el entero ya redondeado de cada branch
entre sus estrategias (`apportionByWeight`) y esa misma función ya
trae su propio chequeo de desarrollo si alguna vez no cuadrara.
Verificado con la lógica real de construcción del workbook (extraída y
corrida standalone, sin pasar por Next.js/auth): las 5 filas + Total
aparecen siempre, y la suma manual de las 5 coincide exacto con la fila
Total. Si `hasStrategyData()` da `false` (mismo criterio que
`strategyDataMissingForExport`, ya usado en el detalle desde EXCEL-1),
la hoja muestra `"No strategy data in this snapshot"` en vez de una
tabla con números falsos -- verificado también contra la lógica real.

**Channel en Adverse (detalle, hoja Pipeline).** `AdverseTable.tsx`
expone su `channelFilter` hacia `page.tsx` vía
`onChannelFilterChange` -- mismo patrón que
`onActiveStrategyFilterChange` de PivotTable (EXCEL-1), incluido el
`useEffect` de limpieza al desmontar (mismo motivo: `page.tsx` solo
renderiza `AdverseTable` en el tab `adverse`, y el botón Download Excel
es global). El detalle de Adverse en el Excel ahora se filtra por
canal cuando corresponde (`channelFilteredAdverse`, aplicado DESPUÉS
del filtro de estrategia, sobre el mismo subconjunto -- son dos
recortes independientes). **No se construyó ningún Channel global** --
Isa lo descartó explícito; los dos "Channel" que existen en Forecast
(`TabMilestoneMatrix`, view-switch; `AdverseTable`, filtro real) siguen
siendo locales a su propio tab, confirmado en el diagnóstico previo de
esta misma rama.

**Fuera del alcance declarado, pero necesario:**
`app/api/pipeline/latest/route.ts` -- la portada necesita el `id` del
snapshot activo, y la query de ese archivo ya lo seleccionaba
(`select('id, file_name, ...')`) pero no lo devolvía en la respuesta;
se agregó `id: snapshot.id` al objeto `snapshot` de la respuesta, sin
tocar la query ni ningún otro campo.

Archivos: `app/pipeline/PivotTable.tsx` (solo `export` en
`buildBranchRows`/`buildStrategyRows`/`BranchRow`/`StrategyRow`, sin
tocar su lógica interna), `app/pipeline/AdverseTable.tsx`
(`onChannelFilterChange` + cleanup, `ChannelFilter` exportado),
`app/pipeline/page.tsx` (`channelFilter`/`activeSnapshotId`, resumen
por estrategia, portada, `channelFilteredAdverse`),
`app/api/pipeline/export/route.ts` (hojas Cover y Strategy Summary
nuevas, hoja Pipeline sin cambios de comportamiento),
`app/api/pipeline/latest/route.ts` (un campo, ver arriba).

⚠ Pendiente, no de esta etapa: la Etapa EXCEL-5 (`branch_transferred`
NULL vs. `false` de punta a punta, ya implementada y verificada contra
la base en una tarea anterior de esta misma rama) todavía no tiene su
propia sección acá -- documentarla antes de mergear esta rama.
