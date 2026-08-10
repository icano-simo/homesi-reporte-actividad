import Image from 'next/image';

/*
 * ============================================================================
 * LOGO HOMESÍ — asset oficial del Brand Book
 * ============================================================================
 *
 * Etapa UX1b: este componente dibujaba el logo en SVG a mano (círculo coral +
 * silueta de casa + el texto "HOMESÍ" y "Powered by Supreme Lending" como
 * <span>), porque en /public no había ningún asset de marca. Ya no: se
 * reemplazó por el archivo oficial, usado TAL CUAL, sin recortar ni redibujar.
 *
 *   public/brand/homesi-lockup.jpg  (1089x187) -- HOMESI_Logo1_Color.jpg
 *   public/brand/homesi-mark.jpg    (1920x1080) -- el mark suelto del Brand Book
 *
 * El lockup oficial YA incluye el ícono, el logotipo "HOMESÍ", el "Powered By"
 * y el logo de Supreme Lending — por eso desaparecieron `hub-brand__wordmark`
 * y el bloque `hub-brand__powered` del header: eran una recreación en texto de
 * algo que la imagen oficial ya trae, y mantener las dos versiones garantizaba
 * que tarde o temprano dejaran de coincidir.
 *
 * `app/icon.png` (favicon) se generó a partir de `homesi-mark.jpg` recortando
 * su margen blanco a un cuadrado de 256x256 — es el ÚNICO derivado; el archivo
 * original queda intacto en public/brand/.
 */

/** Proporción real del archivo: 1089x187 (≈5.82:1). Alto de render en el header. */
const LOCKUP_HEIGHT = 32;
const LOCKUP_WIDTH = Math.round((1089 / 187) * LOCKUP_HEIGHT);

/**
 * Lockup de marca del header. `priority` porque está en el viewport inicial de
 * todas las rutas: sin eso Next lo carga en diferido y el header parpadea.
 */
export default function BrandLockup() {
  return (
    <Image
      className="hub-brand__logo"
      src="/brand/homesi-lockup.jpg"
      alt="HOMESÍ — Powered by Supreme Lending"
      width={LOCKUP_WIDTH}
      height={LOCKUP_HEIGHT}
      priority
    />
  );
}
