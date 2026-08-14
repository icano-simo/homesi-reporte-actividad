'use client';

import type { ReactNode } from 'react';
import {
  AwardIcon,
  BarChartIcon,
  BuildingIcon,
  CalendarIcon,
  DatabaseIcon,
  DoorIcon,
  FileSheetIcon,
  FunnelIcon,
  GridIcon,
  HandshakeIcon,
  HomeIcon,
  MailIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessageIcon,
  PhoneIcon,
  SignedDocIcon,
  StarIcon,
  TargetIcon,
  TrendingUpIcon,
  UsersIcon,
} from '@/components/ui/icons';

/**
 * ============================================================================
 * SELECTOR DE ICONOS
 * ============================================================================
 *
 * Etapa BP17 — ARCHIVO NUEVO. Etapa BP19 — iconos de negocio.
 *
 * Reemplaza a un `<input type="text">` en el que había que escribir `trending`
 * de memoria. Nadie puede acertar un nombre que no está listado en ningún lado,
 * y uno mal escrito se guardaba igual: la columna es texto libre.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE OFRECE Y QUÉ NO
 * ---------------------------------------------------------------------------
 * La primera versión ofrecía `upload`, `download` y `alert`. Vienen del set de
 * INTERFAZ de la app -- subir archivo, descargar, avisar -- y ninguno significa
 * nada como marca de una estrategia comercial: un funnel de llamadas en frío no
 * se representa con una flecha de descarga. Se retiraron.
 *
 * En su lugar hay iconos de canal y actividad, dibujados en
 * `components/ui/icons.tsx` con el mismo trazo que el resto.
 *
 * ---------------------------------------------------------------------------
 * ⚠ RETIRAR DEL SELECTOR NO ES DEJAR SIN DIBUJO
 * ---------------------------------------------------------------------------
 * `RENDERABLE` incluye TODO lo que se sabe dibujar; `OFFERED` es sólo lo que se
 * ofrece al elegir. Un funnel guardado con un nombre que ya no se ofrece sigue
 * mostrando su icono -- no se queda en blanco ni hay que migrar registros.
 *
 * Hoy los 7 nombres en uso (building, chart, file, grid, target, trending,
 * users) siguen los siete ofrecidos, así que no cambió ninguno.
 */

interface IconDef {
  name: string;
  label: string;
  render: (size: number) => ReactNode;
}

/** Todo lo que se sabe dibujar, se ofrezca o no. */
const RENDERABLE: IconDef[] = [
  /* ── Canal y actividad comercial (etapa BP19) ── */
  { name: 'phone', label: 'Phone call', render: (s) => <PhoneIcon size={s} /> },
  { name: 'message', label: 'Message / chat', render: (s) => <MessageIcon size={s} /> },
  { name: 'megaphone', label: 'Social / campaign', render: (s) => <MegaphoneIcon size={s} /> },
  { name: 'mail', label: 'Email sequence', render: (s) => <MailIcon size={s} /> },
  { name: 'handshake', label: 'Partnership', render: (s) => <HandshakeIcon size={s} /> },
  { name: 'home', label: 'Mortgage', render: (s) => <HomeIcon size={s} /> },
  { name: 'signed', label: 'Signed document', render: (s) => <SignedDocIcon size={s} /> },
  { name: 'database', label: 'Database', render: (s) => <DatabaseIcon size={s} /> },
  { name: 'door', label: 'Door knocking', render: (s) => <DoorIcon size={s} /> },
  { name: 'calendar', label: 'Meeting / event', render: (s) => <CalendarIcon size={s} /> },
  { name: 'pin', label: 'Territory', render: (s) => <MapPinIcon size={s} /> },
  { name: 'funnel', label: 'Funnel', render: (s) => <FunnelIcon size={s} /> },
  { name: 'award', label: 'Achievement', render: (s) => <AwardIcon size={s} /> },
  { name: 'star', label: 'Referral', render: (s) => <StarIcon size={s} /> },
  /* ── Los 7 que ya estaban en uso ── */
  { name: 'building', label: 'Branch / builder', render: (s) => <BuildingIcon size={s} /> },
  { name: 'users', label: 'People', render: (s) => <UsersIcon size={s} /> },
  { name: 'target', label: 'Target', render: (s) => <TargetIcon size={s} /> },
  { name: 'trending', label: 'Growth', render: (s) => <TrendingUpIcon size={s} /> },
  { name: 'chart', label: 'Metrics', render: (s) => <BarChartIcon size={s} /> },
  { name: 'grid', label: 'Setup', render: (s) => <GridIcon size={s} /> },
  { name: 'file', label: 'File', render: (s) => <FileSheetIcon size={s} /> },
];

/**
 * Lo que se ofrece al elegir. Hoy coincide con `RENDERABLE`: los que se
 * retiraron (upload, download, alert) no estaban en uso, así que se sacaron de
 * los dos. La distinción existe para cuando haya que retirar uno que SÍ esté
 * guardado -- basta sacarlo de acá y su dibujo sobrevive.
 */
const OFFERED = RENDERABLE;

/**
 * Dibuja un icono por su nombre guardado.
 *
 * `null` si el nombre no está en el set -- por ejemplo algo escrito a mano en
 * el campo de texto anterior. Mejor nada que un placeholder que parezca un
 * icono roto.
 */
export function iconByName(name: string | null, size = 16): ReactNode {
  if (!name) return null;
  return RENDERABLE.find((i) => i.name === name)?.render(size) ?? null;
}

export default function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div className="bp-iconpick">
      {OFFERED.map((i) => (
        <button
          key={i.name}
          type="button"
          className={'bp-iconpick__opt' + (value === i.name ? ' is-on' : '')}
          onClick={() => onChange(value === i.name ? '' : i.name)}
          /* Sin etiqueta debajo: con el dibujo y el `title` alcanza, y así
             entran el doble de opciones en el mismo alto. */
          title={i.label}
          aria-pressed={value === i.name}
          aria-label={i.label}
        >
          {i.render(17)}
        </button>
      ))}
    </div>
  );
}
