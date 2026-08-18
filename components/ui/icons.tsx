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
