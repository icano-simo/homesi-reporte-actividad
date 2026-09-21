/*
 * ============================================================================
 * LAS DOS FORMAS DE URL DE VIDEO, Y LA DURACION — etapa BP48
 * ============================================================================
 *
 * La decision de si una URL se reproduce con `<video>` o con `<iframe>` no es
 * cosmetica: elegir mal deja un recuadro en blanco. Y no se puede probar
 * mirando la pantalla mientras `docs/sql/2026-09-funnel-video.sql` no este
 * aplicado, asi que la parte que TIENE logica se prueba aparte.
 *
 * Node 24 importa `.ts` directo, asi que no hace falta compilar.
 *
 * Se corre con `node scripts/verificacion/video.test.mjs`.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { esArchivoDeVideo, duracionLegible } = await import(
  pathToFileURL(RAIZ + '/lib/business-plan/funnels.ts').href
);

/* Contador a mano contra un minimo escrito a mano: un contador de fallas no
   distingue «todo bien» de «no midio nada». */
const MINIMO = 20;
let corridas = 0;
let fallas = 0;
const ck = (cond, msg) => {
  corridas++;
  if (cond) console.log('  OK   ' + msg);
  else {
    fallas++;
    console.log('  ** FALLA ** ' + msg);
  }
};

console.log('=== A. archivo directo -> <video> ===');
ck(esArchivoDeVideo('https://cdn.example.com/videos/kickoff.mp4'), '.mp4');
ck(esArchivoDeVideo('https://cdn.example.com/videos/kickoff.webm'), '.webm');
ck(esArchivoDeVideo('https://cdn.example.com/a/b/c/KICKOFF.MP4'), 'mayusculas');
ck(
  esArchivoDeVideo('https://cdn.example.com/videos/kickoff.mp4?token=abc123&x=1'),
  'con query string: la extension esta en el pathname y el query no la tapa'
);

console.log('\n=== B. enlace de insercion -> <iframe> ===');
/*
 * ⚠ EL CASO QUE MOTIVA LA FUNCION: un embed de SharePoint puede traer `.mp4`
 * ADENTRO de un parametro. Mirando la cadena entera con `includes('.mp4')`
 * --que es lo obvio-- daria "archivo directo" y terminaria en un `<video>`
 * vacio. Por eso se mira el pathname y no la cadena.
 */
ck(
  !esArchivoDeVideo(
    'https://supremelending-my.sharepoint.com/personal/x/_layouts/15/embed.aspx' +
      '?UniqueId=abc&file=kickoff.mp4&embed=%7B%22ust%22%3Atrue%7D'
  ),
  'SharePoint con `.mp4` en un parametro NO es archivo directo'
);
ck(
  !esArchivoDeVideo('https://supremelending-my.sharepoint.com/:v:/g/personal/x/EaBcD?e=1'),
  'el link de la barra de direcciones de SharePoint tampoco'
);
ck(!esArchivoDeVideo('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'YouTube embed');
ck(!esArchivoDeVideo('https://player.vimeo.com/video/76979871'), 'Vimeo embed');
ck(!esArchivoDeVideo('https://onedrive.live.com/embed?resid=1&authkey=2'), 'OneDrive embed');

console.log('\n=== C. lo que no parsea cae del lado barato ===');
/*
 * Ante la duda, `iframe`: un embed dentro de un `<video>` no muestra NADA, y
 * un archivo directo dentro de un `<iframe>` igual se reproduce, porque el
 * navegador le pone su propio reproductor. Los dos errores no cuestan lo
 * mismo, asi que el default es el que se recupera solo.
 */
ck(!esArchivoDeVideo('no soy una url'), 'texto suelto');
ck(!esArchivoDeVideo(''), 'cadena vacia');
ck(!esArchivoDeVideo('kickoff.mp4'), 'un nombre de archivo sin esquema');

console.log('\n=== D. la duracion: `null` cuando no se sabe ===');
ck(duracionLegible(null) === null, '`null` no dibuja nada');
ck(duracionLegible(undefined) === null, '`undefined` tampoco');
/*
 * ⚠ Y EL CERO SE TRATA COMO «no se sabe», no como una duracion. Un video de
 * cero segundos no existe: si llega un 0 es que alguien no lo pudo leer. Un
 * «0:00» en la tarjeta seria una duracion inventada, que es justo lo que el
 * brief pedia evitar.
 */
ck(duracionLegible(0) === null, 'el cero NO es una duracion: se lee como «no se sabe»');
ck(duracionLegible(-5) === null, 'un negativo tampoco');
ck(duracionLegible(NaN) === null, 'NaN tampoco -- puede venir de un `<video>` que no cargo');

console.log('\n=== E. y cuando se sabe, se lee como duracion ===');
ck(duracionLegible(93) === '1:33', '93 -> 1:33');
ck(duracionLegible(9) === '0:09', '9 -> 0:09, con el cero adelante');
ck(duracionLegible(600) === '10:00', '600 -> 10:00');
ck(duracionLegible(3661) === '1:01:01', '3661 -> 1:01:01, con hora');
ck(duracionLegible(92.6) === '1:33', 'y redondea: el `<video>` devuelve decimales');

if (corridas < MINIMO) {
  console.log('\n** RESUMEN INVALIDO ** corrieron ' + corridas + ' de ' + MINIMO);
  process.exitCode = 1;
} else if (fallas > 0) {
  console.log('\n' + fallas + ' FALLAS de ' + corridas);
  process.exitCode = 1;
} else {
  console.log('\nSIN FALLAS (' + corridas + ' aserciones)');
}
