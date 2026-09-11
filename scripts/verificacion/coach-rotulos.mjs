/*
 * ============================================================================
 * «COACH» ES UN RÓTULO, NUNCA UN IDENTIFICADOR
 * ============================================================================
 *
 * El modo se llama Coach mode desde RV9 y toda la interfaz pasó a coach /
 * coaching / coachee en RV13. Lo que NO cambió, y no tiene que cambiar, es el
 * nombre de las cosas: el esquema `review`, las rutas `/review`, las clases
 * `rv-*`, los atributos `data-review-*`, los tipos `ReviewStep`, `MyReview`.
 *
 * Son dos capas distintas y conviene que la separación no dependa de que
 * alguien se acuerde:
 *
 *   - Renombrar un identificador cuesta una migración de base, un cambio de
 *     URL y una tanda de imports, y no le mejora la vida a nadie.
 *   - Y al revés: si mañana el modo se llama de otra forma, tiene que poder
 *     cambiarse tocando SÓLO texto visible.
 *
 * Esta guarda mira el CÓDIGO sin comentarios --los comentarios nombran las dos
 * cosas a propósito, para explicar justamente esto-- y falla si «coach»
 * aparece donde vive un identificador.
 *
 * ⚠ Ojo con el sentido inverso: NO comprueba que no quede «Review» visible.
 * Eso no se puede leer del código, porque la palabra aparece 380 veces en
 * imports y tipos, y porque `preview` la contiene adentro. Lo visible se
 * verifica sobre el DOM renderizado, que es lo único que responde a «¿qué ve
 * Isabella?».
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearArnes } from './guardas.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * Dónde NO puede aparecer, y por qué se lo prohíbe.
 *
 * ⚠ CADA PATRÓN ENTRA A LAS COMILLAS DEL ATRIBUTO, no mira «lo que hay después
 * de className en la línea». La primera versión hacía eso y marcó dieciocho
 * falsos: `<h1 className="page-head__title">My coachees</h1>` tiene la palabra
 * en el TEXTO, no en la clase. Es exactamente la trampa de RV9 --la forma del
 * texto no es su significado-- cometida escribiendo la guarda contra ella.
 */
const PROHIBIDO = [
  { nombre: 'una clase de CSS', re: /className\s*=\s*(?:"[^"]*|'[^']*|\{\s*'[^']*|\{\s*"[^"]*)coach/i },
  { nombre: 'una ruta o un href', re: /href\s*=\s*(?:"[^"]*|'[^']*|\{\s*'[^']*|\{\s*"[^"]*)coach/i },
  { nombre: 'un import', re: /from\s+['"][^'"]*[Cc]oach/ },
  { nombre: 'un atributo data-', re: /data-[a-z-]*coach/i },
  { nombre: 'un esquema o una tabla', re: /(schema|from)\(\s*['"][^'"]*coach/i },
  { nombre: 'un selector de CSS', re: /^[^{}]*\.[a-z-]*coach[a-z-]*[^{}]*\{/im },
];

const archivos = [];
const caminar = (d) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === '.next' || n === '.git') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) caminar(p);
    else if (/\.(tsx?|css)$/.test(n)) archivos.push(p);
  }
};
for (const d of ['app', 'components', 'lib']) caminar(join(RAIZ, d));

/* Sin comentarios, y conservando los saltos para no mover los números. */
const sinComentarios = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

const a = crearArnes({ minimo: PROHIBIDO.length + 1 });
try {
  let conCoach = 0;
  const hallazgos = new Map();
  for (const p of archivos) {
    const texto = sinComentarios(readFileSync(p, 'utf8'));
    if (/[Cc]oach/.test(texto)) conCoach++;
    for (const linea of texto.split(/\r?\n/)) {
      for (const reg of PROHIBIDO) {
        if (reg.re.test(linea)) {
          if (!hallazgos.has(reg.nombre)) hallazgos.set(reg.nombre, []);
          hallazgos.get(reg.nombre).push(relative(RAIZ, p).replace(/\\/g, '/') +
            ': ' + linea.trim().slice(0, 110));
        }
      }
    }
  }

  for (const reg of PROHIBIDO) {
    const malos = hallazgos.get(reg.nombre) ?? [];
    a.ck(
      malos.length === 0,
      '«coach» no aparece en ' + reg.nombre +
        (malos.length === 0 ? '' : ' — ' + malos.length + ': ' + malos.slice(0, 3).join(' | '))
    );
  }

  /*
   * ⚠ Y QUE LA GUARDA TENGA ALGO QUE MIRAR.
   *
   * Seis prohibiciones sobre cero archivos con la palabra dan verde igual, y se
   * lee idéntico a seis prohibiciones respetadas. Es el mismo caso que el
   * resumen que imprimía SIN FALLAS sin correr una aserción.
   */
  a.ck(conCoach >= 8,
    'y hay código con la palabra para mirar: ' + conCoach + ' archivos');
} finally {
  process.exitCode = a.resumen();
}
