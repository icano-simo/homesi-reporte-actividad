import Image from 'next/image';

/*
 * ============================================================================
 * LOGO HOMESÍ — asset oficial del Brand Book
 * ============================================================================
 *
 * Etapa UX1b: este componente dibujaba el logo en SVG a mano, porque en
 * /public no había ningún asset de marca. Se reemplazó por el archivo oficial.
 *
 * El lockup oficial YA incluye el ícono, el logotipo "HOMESÍ", el "Powered By"
 * y el logo de Supreme Lending — por eso no existen `hub-brand__wordmark` ni
 * el bloque `hub-brand__powered`: eran una recreación en texto de algo que la
 * imagen oficial ya trae, y mantener las dos versiones garantizaba que tarde o
 * temprano dejaran de coincidir.
 *
 * ---------------------------------------------------------------------------
 * HOTFIX UX2 — POR QUÉ SE CONSUME EL .PNG Y NO EL .JPG ORIGINAL
 * ---------------------------------------------------------------------------
 * El JPG entregado tiene fondo BLANCO SÓLIDO (JPEG no soporta canal alpha).
 * La primera versión lo disimulaba con `mix-blend-mode: multiply`, y no
 * funcionó: `.hub-header` usa `backdrop-filter: blur()`, que crea un stacking
 * context aislado — el blend se resuelve DENTRO de ese grupo y nunca contra el
 * fondo real, así que el rectángulo blanco quedaba visible igual.
 *
 * Se generó entonces un PNG con transparencia real (script en el scratchpad,
 * documentado en docs/ARQUITECTURA.md): flood fill desde el borde para el
 * fondo exterior, y clasificación de los blancos encerrados según el color que
 * los rodea — los rodeados de coral (la "S" de Supreme Lending, los chevrons
 * del mark) se CONSERVAN en blanco; el resto (contraformas de letras) se abren.
 * Un knockout global de blanco habría borrado también esos blancos de diseño.
 *
 * Los .jpg originales quedan en public/brand/ como fuente de verdad; los .png
 * son los derivados que consume la app.
 *
 * `app/icon.png` (favicon, 256x256) sale del mark transparente recortado.
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
      src="/brand/homesi-lockup.png"
      alt="HOMESÍ — Powered by Supreme Lending"
      width={LOCKUP_WIDTH}
      height={LOCKUP_HEIGHT}
      priority
    />
  );
}
