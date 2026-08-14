'use client';

import type { ReactNode } from 'react';
import {
  BarChartIcon,
  BuildingIcon,
  FileSheetIcon,
  GridIcon,
  TargetIcon,
  TrendingUpIcon,
  UsersIcon,
  UploadIcon,
  DownloadIcon,
  AlertTriangleIcon,
} from '@/components/ui/icons';

/**
 * ============================================================================
 * SELECTOR DE ICONOS
 * ============================================================================
 *
 * Etapa BP17 — ARCHIVO NUEVO.
 *
 * Reemplaza a un `<input type="text">` en el que había que escribir `trending`
 * de memoria. Nadie puede acertar un nombre que no está listado en ningún lado,
 * y un icono mal escrito se guardaba igual: la columna es texto libre.
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALEN LOS ICONOS
 * ---------------------------------------------------------------------------
 * De `components/ui/icons.tsx`, el set que ya usa toda la app. NO del archivo
 * de assets de marca: ese trae los logos de HOMESÍ y las ilustraciones de
 * "drivers", que son piezas grandes para material impreso -- a 16px dentro de
 * una tabla se verían fuera de lugar y desalineadas con el resto de la interfaz.
 *
 * El set tiene 19 iconos, pero acá sólo se ofrecen los que tienen sentido como
 * marca de un funnel o de un nodo. Los de navegación (chevrons, flechas) y los
 * de estado (minus) quedan fuera: elegirlos no querría decir nada.
 *
 * Lo que se guarda es el NOMBRE (`grid`, `trending`, …), no el componente. Es
 * lo que ya había en la base -- los ejemplos sembrados usan esos nombres -- así
 * que el selector no obliga a migrar nada.
 */

/** Nombre guardado en la base -> cómo se dibuja. */
const ICONS: { name: string; label: string; render: (size: number) => ReactNode }[] = [
  { name: 'grid', label: 'Grid', render: (s) => <GridIcon size={s} /> },
  { name: 'trending', label: 'Trending', render: (s) => <TrendingUpIcon size={s} /> },
  { name: 'target', label: 'Target', render: (s) => <TargetIcon size={s} /> },
  { name: 'users', label: 'People', render: (s) => <UsersIcon size={s} /> },
  { name: 'building', label: 'Building', render: (s) => <BuildingIcon size={s} /> },
  { name: 'file', label: 'File', render: (s) => <FileSheetIcon size={s} /> },
  { name: 'chart', label: 'Chart', render: (s) => <BarChartIcon size={s} /> },
  { name: 'upload', label: 'Upload', render: (s) => <UploadIcon size={s} /> },
  { name: 'download', label: 'Download', render: (s) => <DownloadIcon size={s} /> },
  { name: 'alert', label: 'Alert', render: (s) => <AlertTriangleIcon size={s} /> },
];

/**
 * Dibuja un icono por su nombre guardado.
 *
 * Devuelve `null` si el nombre no está en el set -- por ejemplo si quedó algo
 * escrito a mano del campo de texto anterior. Mejor no dibujar nada que un
 * placeholder que parezca un icono roto.
 */
export function iconByName(name: string | null, size = 16): ReactNode {
  if (!name) return null;
  return ICONS.find((i) => i.name === name)?.render(size) ?? null;
}

export default function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className="bp-iconpick">
      {ICONS.map((i) => (
        <button
          key={i.name}
          type="button"
          className={'bp-iconpick__opt' + (value === i.name ? ' is-on' : '')}
          onClick={() => onChange(value === i.name ? '' : i.name)}
          title={i.label}
          aria-pressed={value === i.name}
          aria-label={i.label}
        >
          {i.render(18)}
          <span className="bp-iconpick__name">{i.label}</span>
        </button>
      ))}
    </div>
  );
}
