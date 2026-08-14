import type { ReactNode } from 'react';
import {
  AwardIcon,
  BarChartIcon,
  BuildingIcon,
  CalendarIcon,
  DatabaseIcon,
  DoorIcon,
  FileSheetIcon,
  FunnelIcon as FunnelShapeIcon,
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
 * REGISTRO DE ICONOS DE FUNNEL Y NODO
 * ============================================================================
 *
 * Etapa BP19 — el catálogo de iconos nació dentro de `library/IconPicker.tsx`.
 * Etapa BP21 — SE MUDÓ ACÁ, y ese traslado ES el arreglo del bug.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ EL ICONO NO SE VEÍA EN NINGUNA PANTALLA
 * ---------------------------------------------------------------------------
 * No era la lectura ni el guardado: los seis funnels tienen `icon` cargado en
 * la base y `useFunnelLibrary` los trae con `select('*')`. El bug era que
 * `iconByName` sólo existía dentro del SELECTOR, y ninguna pantalla la
 * importaba nunca -- un grep del proyecto la encontraba en un solo archivo, el
 * mismo donde estaba definida. Se elegía el icono, se guardaba, y después nadie
 * lo dibujaba.
 *
 * Al vivir en `components/` queda a la mano de las cinco pantallas que tienen
 * que mostrarlo, y el selector pasa a ser un consumidor más del registro en vez
 * de su dueño.
 *
 * ---------------------------------------------------------------------------
 * ⚠ RETIRAR DEL SELECTOR NO ES DEJAR SIN DIBUJO
 * ---------------------------------------------------------------------------
 * `RENDERABLE` es todo lo que se sabe dibujar; `OFFERED` es lo que se ofrece al
 * elegir. Un funnel guardado con un nombre que ya no se ofrece sigue mostrando
 * su icono: nunca hay que migrar registros para sacar una opción de la lista.
 */

export interface IconDef {
  name: string;
  label: string;
  render: (size: number) => ReactNode;
}

/** Todo lo que se sabe dibujar, se ofrezca o no. */
export const RENDERABLE: IconDef[] = [
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
  { name: 'funnel', label: 'Funnel', render: (s) => <FunnelShapeIcon size={s} /> },
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
 * retiraron en BP19 (upload, download, alert) no estaban en uso, así que se
 * sacaron de los dos. La distinción existe para cuando haya que retirar uno que
 * SÍ esté guardado -- basta sacarlo de acá y su dibujo sobrevive.
 */
export const OFFERED = RENDERABLE;

/**
 * Dibuja un icono por su nombre guardado.
 *
 * `null` si el nombre no está en el set -- por ejemplo algo escrito a mano en
 * el campo de texto que había antes del selector. Mejor nada que un placeholder
 * que parezca un icono roto.
 */
export function iconByName(name: string | null | undefined, size = 16): ReactNode {
  if (!name) return null;
  return RENDERABLE.find((i) => i.name === name)?.render(size) ?? null;
}

/**
 * El icono del funnel o del nodo, junto a su nombre.
 *
 * ⚠ Etapa BP28: SE FUE LA PROP `tone`, y no por limpieza. Sus dos valores eran
 * los que pintaban el recuadro de fondo -- `soft` un tinte celeste, `strong` un
 * cuadrado navy -- y mientras existieran, cada pantalla nueva podía volver a
 * pedir el cuadrado sin darse cuenta. El glifo va solo, en navy, y ahora no hay
 * forma de pedir otra cosa.
 *
 * Componente y no una llamada suelta a `iconByName` porque las nueve pantallas
 * que lo usan lo muestran igual. Sin icono guardado no se dibuja NADA -- ni un
 * cuadrado vacío, que se leería como una imagen rota.
 */
export function FunnelGlyph({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  const drawn = iconByName(icon, size);
  if (!drawn) return null;
  return (
    <span className="bp-glyph" aria-hidden="true">
      {drawn}
    </span>
  );
}
