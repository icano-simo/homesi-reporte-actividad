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
