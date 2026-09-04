/*
 * ============================================================================
 * SET DE ICONOS — Etapa UX1 (overhaul Service Hub)
 * ============================================================================
 *
 * El spec pide "Zero Emojis: usar iconos SVG de Lucide-React en #001A40 o
 * #FF4040". DECISIÓN: no se instaló `lucide-react` como dependencia — se
 * transcriben acá los paths de los iconos concretos que la app usa (Lucide es
 * ISC, permite reusar el path data). Motivos:
 *
 *  1. El repo ya venía evitando esa dependencia a propósito (ver etapa F4h en
 *     docs/ARQUITECTURA.md); agregarla ahora rompería esa decisión previa sin
 *     una necesidad real.
 *  2. Son 11 iconos. Un paquete completo en el bundle del cliente para eso no
 *     se justifica.
 *  3. Antes había SVG sueltos copiados dentro de 5 componentes distintos y
 *     caracteres tipográficos usados como iconos ("▸", "▾", "▲", "▼", "×").
 *     Este módulo los centraliza: un solo lugar donde cambiar trazo, tamaño o
 *     grilla.
 *
 * Todos heredan el color con `currentColor` — el color se decide en el sitio
 * de uso (clase CSS o `color`), nunca acá.
 */

import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Lado del cuadrado del icono en px. Por defecto 16 (grilla 24 escalada). */
  size?: number;
}

/**
 * Envoltorio común: fija viewBox/stroke/linecap de Lucide para que todos los
 * iconos se vean como un set coherente y no como SVG sueltos de orígenes
 * distintos.
 */
function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* --- Navegación / estructura --------------------------------------------- */

/** lucide: chevron-right. Rotado por CSS (.chev.open) cuando el nodo se abre. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

/** lucide: chevron-down. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/** lucide: bar-chart-3 — tab "Commercial Activity". */
export function BarChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </Icon>
  );
}

/** lucide: trending-up — tab "Forecast & Pipeline". */
export function TrendingUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 7h6v6" />
      <path d="m22 7-8.5 8.5-5-5L2 17" />
    </Icon>
  );
}

/** lucide: pie-chart — tab "Analytics" (Etapa ANALYTICS-TAB-1). Distinto de BarChartIcon (Commercial Activity) para que los 4 tabs de nivel superior se distingan entre sí. */
export function PieChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </Icon>
  );
}

/* --- Tendencia (badges del KPI strip) ------------------------------------ */

/** lucide: arrow-up. */
export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Icon>
  );
}

/** lucide: arrow-down. */
export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Icon>
  );
}

/** lucide: minus — variación nula entre dos meses. */
export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  );
}

/* --- Acciones ------------------------------------------------------------- */

/** lucide: upload. */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </Icon>
  );
}

/** lucide: download. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Icon>
  );
}

/** lucide: x — cerrar el flyout. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

/** lucide: file-spreadsheet — estado vacío / carga de archivo. */
export function FileSheetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </Icon>
  );
}

/** lucide: chevrons-up-down / chevrons-down-up — expandir y colapsar todo. */
export function ExpandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </Icon>
  );
}
export function CollapseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </Icon>
  );
}

/** lucide: alert-triangle — préstamos adversos / riesgo. */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

/** lucide: target — tab "Business Plan" (objetivos vs. producción real). */
export function TargetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Icon>
  );
}

/** lucide: users — directorio de personas. */
export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

/** lucide: log-out — cerrar sesión. */
export function LogOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

/** lucide: layout-grid — matriz Branch x Milestone. */
export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </Icon>
  );
}

/** lucide: building-2 — vista ejecutiva por branch. */
export function BuildingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
    </Icon>
  );
}

/* ===========================================================================
 * Iconos de canal y actividad comercial — etapa BP19
 * ===========================================================================
 *
 * Los agrega el módulo Business Plan para marcar funnels y nodos. El set que
 * había era de INTERFAZ -- subir, descargar, avisar -- y ninguno de esos
 * significa nada como marca de una estrategia comercial: un funnel de llamadas
 * en frío no se representa con una flecha de descarga.
 *
 * Mismo estilo que el resto del archivo: trazo simple sin relleno, viewBox de
 * 24, `currentColor` heredado del envoltorio `Icon`. Sin librerías nuevas ni
 * assets externos -- los paths son de Lucide (ISC), como los de arriba.
 */

/** lucide: phone — Cold Calling, Sales Call. */
export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
    </Icon>
  );
}

/** lucide: message-circle — AI WhatsApp, seguimiento por chat. */
export function MessageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Icon>
  );
}

/** lucide: megaphone — Social Media Setup, campañas. */
export function MegaphoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </Icon>
  );
}

/** lucide: mail — secuencias de contacto. */
export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Icon>
  );
}

/** lucide: handshake — Realtor Activation, Builder Partnership. */
export function HandshakeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </Icon>
  );
}

/** lucide: home — lo hipotecario en general. */
export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </Icon>
  );
}

/** lucide: file-signature — Application, documento firmado. */
export function SignedDocIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M8 18c1.5-2 3-2 4 0s2.5 2 4 0" />
      <path d="M8 13h4" />
    </Icon>
  );
}

/** lucide: database — Database Segmentation. */
export function DatabaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </Icon>
  );
}

/** lucide: door-open — Door Knocking. */
export function DoorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 4h3a2 2 0 0 1 2 2v14" />
      <path d="M2 20h20" />
      <path d="M13 2v20l-8-2V4Z" />
      <path d="M10 12v.01" />
    </Icon>
  );
}

/** lucide: calendar — Consultative Mtg, Event Hosting. */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </Icon>
  );
}

/**
 * lucide: clock — el `ends day N` de un funnel.
 *
 * ⚠ Y NO `CalendarIcon`, que ya estaba. Un calendario dice FECHA y `ends day
 * 207` no es una fecha: es un contador de días desde que la persona se enrola,
 * y la fecha real depende de cuándo se enroló. Los nueve funnels van de 8 a 207
 * días, así que el mismo `day 89` cae en un mes distinto para cada uno.
 */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Icon>
  );
}

/** lucide: map-pin — Community Presence, territorio. */
export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Icon>
  );
}

/** lucide: filter — el concepto de embudo. */
export function FunnelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54Z" />
    </Icon>
  );
}

/** lucide: award — logro, referidos. */
export function AwardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" />
      <circle cx="12" cy="8" r="6" />
    </Icon>
  );
}

/** lucide: star — destacado, referido. */
export function StarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.5 2.5a.6.6 0 0 1 1 0l2.4 5a.6.6 0 0 0 .45.33l5.4.8a.6.6 0 0 1 .34 1l-3.9 3.9a.6.6 0 0 0-.17.53l.92 5.4a.6.6 0 0 1-.87.63l-4.8-2.55a.6.6 0 0 0-.56 0l-4.8 2.55a.6.6 0 0 1-.87-.63l.92-5.4a.6.6 0 0 0-.17-.53l-3.9-3.9a.6.6 0 0 1 .34-1l5.4-.8a.6.6 0 0 0 .45-.33Z" />
    </Icon>
  );
}

/* ===========================================================================
 * Ícono de marca — engranaje de Settings (Brand Book HomeSí)
 * ===========================================================================
 *
 * A diferencia de todo lo de arriba (paths de Lucide, ISC, transcritos a
 * mano), esto es el vector OFICIAL provisto (`HOMESI_Icon_Line_205.svg`,
 * rojo de marca #FF4040). Fuente de verdad versionada en
 * `public/brand/settings-gear.svg` -- mismo criterio que
 * `public/brand/homesi-lockup.*`/`homesi-mark.*` (HomesiLogo.tsx): el archivo
 * en /public es lo que se entregó, esto de acá es cómo se renderiza.
 *
 * RECHAZADO EN REVISIÓN VISUAL, se mantiene sin usar (no se borra): a tamaño
 * real de botón (16-20px) los dientes redondeados del engranaje se leen como
 * pétalos de una flor, y la casa del centro deja de distinguirse por
 * completo. `HomesiGearWithHouseIcon`/`GearOnlyIcon` de acá abajo quedan
 * intactos por si sirven en otro contexto (un tamaño más grande, por
 * ejemplo) -- el botón de Settings de Topbar.tsx usa ahora el
 * `SettingsGearIcon` nuevo, más abajo en este archivo, que sí pasó revisión.
 *
 * No pasan por el envoltorio `Icon()` de arriba: ese wrapper fuerza
 * `viewBox="0 0 24 24"` + `stroke="currentColor"`, pensado para los paths de
 * Lucide -- estos son íconos rellenos (`fill`), con su propio viewBox
 * (0 0 816 816) y color de marca fijo, no heredado del sitio de uso.
 *
 * El archivo original trae 3 `<path>`: el contorno dentado del engranaje, el
 * círculo interior, y una casa en el centro. `HomesiGearWithHouseIcon` usa
 * los 3; `GearOnlyIcon` omite el tercero (la casa).
 */
const SETTINGS_GEAR_OUTLINE_PATH =
  'M3305 7965 c-109 -29 -125 -81 -125 -403 0 -378 -31 -432 -297 -518 -65 -20 -149 -51 -187 -67 -148 -62 -192 -42 -431 199 -294 295 -374 300 -635 36 -75 -75 -216 -215 -315 -311 -98 -96 -204 -204 -235 -241 -32 -36 -105 -113 -162 -170 -132 -132 -153 -172 -153 -290 0 -122 19 -156 175 -312 277 -275 291 -305 215 -472 -19 -42 -47 -118 -61 -168 -67 -240 -100 -258 -499 -268 -461 -11 -420 76 -420 -895 0 -983 -42 -895 430 -906 390 -8 418 -20 470 -196 14 -48 44 -137 65 -196 75 -202 53 -255 -204 -517 -143 -146 -169 -190 -174 -297 -7 -132 51 -208 513 -661 104 -103 255 -253 335 -334 298 -302 381 -294 704 65 178 199 252 213 506 97 58 -26 128 -55 157 -65 171 -54 203 -130 203 -477 0 -451 -70 -418 875 -418 955 0 885 -33 895 430 7 369 13 380 230 484 311 149 421 142 583 -37 384 -425 437 -416 1042 188 545 544 585 591 585 685 0 91 -42 147 -284 385 -214 210 -219 225 -132 454 151 396 160 403 561 411 359 7 403 24 435 175 20 96 9 1432 -13 1480 -55 123 -99 138 -422 146 -384 9 -415 31 -550 394 -81 215 -89 194 166 451 262 265 295 339 223 494 -33 73 -886 932 -1001 1010 -186 125 -301 92 -548 -156 -230 -231 -240 -234 -515 -144 -348 114 -352 119 -360 535 -7 351 -16 378 -141 404 -79 17 -1439 14 -1504 -4z m1217 -316 c119 -26 138 -80 138 -394 0 -352 5 -361 253 -454 177 -67 337 -136 481 -207 l139 -69 86 0 c108 0 143 16 225 104 352 377 335 379 784 -78 332 -337 336 -365 79 -623 -198 -198 -222 -297 -120 -508 28 -58 58 -130 68 -160 10 -30 33 -89 51 -130 18 -42 43 -112 55 -155 77 -285 137 -325 485 -325 429 0 414 20 414 -575 0 -599 23 -566 -415 -575 -362 -7 -384 -18 -465 -240 -17 -46 -45 -115 -61 -152 -16 -37 -41 -106 -54 -153 -14 -47 -48 -136 -76 -197 -111 -242 -90 -341 118 -546 218 -216 229 -292 61 -447 -40 -37 -106 -106 -147 -154 -40 -47 -115 -121 -165 -164 -50 -43 -108 -98 -129 -122 -118 -137 -152 -128 -392 108 -252 247 -296 254 -615 95 -134 -67 -229 -106 -303 -128 -117 -33 -269 -104 -304 -141 -42 -46 -46 -73 -53 -354 -9 -424 26 -400 -580 -400 -606 0 -571 -24 -580 400 -6 289 -11 315 -61 362 -37 34 -204 109 -307 138 -139 38 -207 66 -322 132 -277 156 -359 143 -610 -102 -256 -249 -245 -252 -627 128 -406 403 -405 395 -129 671 204 204 232 294 145 462 -158 303 -193 379 -235 512 -89 276 -103 285 -464 292 -410 9 -390 -19 -390 575 0 597 -22 566 405 575 365 7 354 1 444 256 69 198 139 363 212 499 120 226 103 302 -114 517 -278 276 -277 281 118 674 384 383 396 385 670 102 209 -216 299 -230 555 -87 110 61 352 164 455 194 235 67 255 102 255 450 0 307 17 361 125 390 66 18 817 21 897 4z';

const SETTINGS_GEAR_INNER_RING_PATH =
  'M3725 6600 c-99 -6 -139 -14 -225 -43 -58 -19 -175 -54 -260 -78 -683 -187 -1375 -874 -1554 -1544 -21 -77 -56 -196 -78 -264 -83 -253 -82 -944 1 -1181 23 -63 41 -123 41 -132 1 -132 243 -637 377 -784 37 -42 91 -108 119 -148 101 -142 312 -326 504 -441 36 -21 99 -62 140 -91 123 -84 152 -97 635 -261 l190 -65 190 -9 c385 -20 715 0 852 50 43 16 119 42 168 59 394 133 494 180 702 335 54 40 134 97 177 127 94 63 227 187 280 262 282 396 437 695 561 1078 l47 145 10 243 c7 163 7 315 0 465 l-10 222 -47 145 c-75 230 -239 632 -297 727 -135 222 -258 307 -368 251 -112 -58 -107 -185 13 -362 38 -57 229 -439 267 -537 10 -26 24 -83 30 -127 6 -44 24 -120 41 -169 67 -200 67 -556 -1 -757 -16 -49 -35 -116 -41 -150 -6 -33 -24 -95 -41 -136 -16 -41 -45 -121 -63 -177 -80 -244 -225 -465 -412 -629 -43 -38 -107 -100 -143 -139 -143 -154 -191 -195 -313 -267 -249 -147 -407 -216 -568 -246 -57 -11 -142 -35 -189 -54 l-85 -33 -320 0 -320 0 -105 37 c-58 21 -148 47 -200 58 -187 40 -278 74 -358 135 -39 30 -102 72 -140 92 -300 162 -559 426 -729 741 -20 37 -59 98 -86 136 -66 90 -147 294 -195 491 l-37 150 0 350 c0 376 8 450 77 675 32 106 300 579 377 664 35 39 90 108 122 153 46 63 76 93 131 130 40 26 108 80 153 120 48 45 111 89 160 115 44 22 125 67 180 98 180 103 319 169 375 179 30 6 87 15 125 21 39 6 99 18 135 26 350 82 871 -3 1305 -212 160 -77 238 -71 302 25 112 166 -95 339 -527 440 -47 11 -123 34 -170 51 -123 46 -517 63 -905 40z';

const SETTINGS_GEAR_HOUSE_PATH =
  'M2977 5446 c-110 -31 -119 -57 -127 -381 -9 -360 -19 -380 -235 -513 -173 -106 -235 -178 -222 -259 15 -89 65 -115 230 -118 225 -4 226 -8 227 -725 0 -640 -32 -600 486 -600 519 0 496 -20 504 435 7 408 25 440 255 440 213 0 235 -36 245 -380 7 -263 14 -298 81 -398 58 -88 75 -92 437 -95 549 -5 505 -63 512 668 6 671 -1 648 205 635 298 -17 326 238 41 374 -60 29 -136 76 -188 117 -48 38 -137 96 -198 129 -131 71 -229 129 -575 340 -543 331 -594 342 -799 181 -117 -92 -187 -83 -284 37 -91 114 -112 121 -352 124 -137 2 -209 -1 -243 -11z m1362 -554 c119 -56 194 -98 270 -154 59 -42 153 -105 210 -140 243 -147 226 -92 226 -748 0 -592 0 -590 -63 -638 -49 -38 -150 -39 -201 -3 -61 44 -65 63 -71 401 -9 482 17 463 -617 458 -588 -4 -573 7 -583 -473 -5 -235 -9 -297 -22 -326 -51 -116 -244 -116 -297 0 -20 46 -30 1004 -11 1098 17 82 59 128 178 198 57 33 198 117 315 186 455 269 410 260 666 141z';

/**
 * Envoltorio compartido de los dos íconos de abajo: mismo viewBox/transform/
 * color que trae el SVG original, para no reescalar los paths a mano.
 */
function BrandGear({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 816 816" aria-hidden="true" focusable="false">
      <g transform="translate(0,816) scale(0.1,-0.1)" fill="#FF4040">
        {children}
      </g>
    </svg>
  );
}

/** Engranaje + casa, íntegro tal como lo trae el Brand Book. Rechazado en revisión visual (ver nota arriba) -- no usado hoy, se conserva sin borrar. */
export function HomesiGearWithHouseIcon({ size }: { size?: number }) {
  return (
    <BrandGear size={size}>
      <path d={SETTINGS_GEAR_OUTLINE_PATH} />
      <path d={SETTINGS_GEAR_INNER_RING_PATH} />
      <path d={SETTINGS_GEAR_HOUSE_PATH} />
    </BrandGear>
  );
}

/** Mismo engranaje, sin la casa. No usado hoy, se conserva sin borrar (ver nota arriba). */
export function GearOnlyIcon({ size }: { size?: number }) {
  return (
    <BrandGear size={size}>
      <path d={SETTINGS_GEAR_OUTLINE_PATH} />
      <path d={SETTINGS_GEAR_INNER_RING_PATH} />
    </BrandGear>
  );
}

/* ===========================================================================
 * Ícono de marca — Settings, reemplazo aprobado (sin casa, sin engranaje de flor)
 * ===========================================================================
 *
 * Reemplaza a `HomesiGearWithHouseIcon` como ícono real del botón Settings de
 * Topbar.tsx. Es el "settings" clásico de Lucide (mismos 2 `<path>` que
 * cualquier ícono de tuerca de 8 dientes cuadrados) -- geometría distinta a
 * la del Brand Book de arriba, sin el problema de "se ve como flor" a tamaño
 * chico. Igual que `HomesiGearWithHouseIcon`, no pasa por el envoltorio
 * `Icon()`: el stroke es el rojo de marca fijo (#FF4040), no `currentColor`
 * -- pedido explícito, no una omisión (un ícono de marca no debería heredar
 * cualquier color del sitio donde se use).
 */
export function SettingsGearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF4040"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
