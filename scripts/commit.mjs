/*
 * ============================================================================
 * COMMITEAR SIN QUE EL SHELL TOQUE EL MENSAJE, Y COMPROBARLO
 * ============================================================================
 *
 * Uso:  node scripts/commit.mjs <archivo-con-el-mensaje> [--amend]
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 * ---------------------------------------------------------------------------
 *
 * Tres veces en una sola serie de trabajo el shell se comio parte de un
 * mensaje de commit, siempre en comandos que parecian cortos. La ultima vez
 * fue asi:
 *
 *     git commit -m "... `disabled={busy}` y nada mas ..."
 *
 * Los backticks son sustitucion de comandos: bash ejecuto `disabled={busy}`,
 * el resultado fue vacio, y el mensaje quedo con cinco huecos donde iban los
 * identificadores. NO FALLA -- reemplaza. El unico rastro fue un
 * `command not found` en la salida, que se lee como ruido.
 *
 * La regla ya estaba escrita --pasar el texto por un archivo, nunca por el
 * shell-- y no alcanzo. Una regla que hay que acordarse se usa igual que una
 * nota; asi que esto la vuelve mecanica.
 *
 * ---------------------------------------------------------------------------
 * COMO LO GARANTIZA, Y POR QUE NO ES UNA HEURISTICA
 * ---------------------------------------------------------------------------
 *
 * Dos cosas, y la segunda es la que importa:
 *
 *   1. El mensaje NO PASA POR UN SHELL. Se usa `execFile`, que le entrega los
 *      argumentos al proceso directamente: no hay expansion, ni backticks, ni
 *      comillas que balancear. Y ni siquiera va como argumento: va como
 *      `-F archivo`.
 *
 *   2. DESPUES DEL COMMIT SE LEE EL MENSAJE DE VUELTA y se compara con el
 *      archivo. Si no son iguales, falla y dice en que linea difieren.
 *
 * Lo segundo es lo que lo hace una comprobacion y no una precaucion. Detectar
 * el sintoma --un hueco donde iba un identificador-- por la FORMA del texto
 * seria una regla sobre como se ve la linea, que es justo el error que este
 * repo lleva documentado cuatro veces. Comparar contra la fuente no depende de
 * reconocer el dano: cualquier diferencia salta, venga de backticks, de una
 * codificacion, de un truncado o de algo que no vimos todavia.
 *
 * ⚠ `git` normaliza el mensaje: recorta los espacios del final de cada linea y
 * colapsa las lineas vacias del final. Eso no es dano, asi que la comparacion
 * normaliza las dos puntas igual. Lo que NO se tolera es una diferencia dentro
 * de una linea.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const correr = promisify(execFile);

const [archivo, ...resto] = process.argv.slice(2);
if (!archivo) {
  console.error('uso: node scripts/commit.mjs <archivo-con-el-mensaje> [--amend]');
  process.exit(2);
}
const amend = resto.includes('--amend');

/** La normalizacion que hace git, para no confundirla con dano. */
const normalizar = (s) =>
  s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');

const esperado = normalizar(readFileSync(archivo, 'utf8'));
if (esperado.trim() === '') {
  console.error('el archivo del mensaje esta vacio: ' + archivo);
  process.exit(2);
}

try {
  const args = ['commit', '-F', archivo];
  if (amend) args.push('--amend');
  const { stdout } = await correr('git', args);
  console.log(stdout.trim().split('\n').slice(0, 2).join('\n'));
} catch (e) {
  console.error('git commit fallo:\n' + (e.stdout ?? '') + (e.stderr ?? ''));
  process.exit(1);
}

const { stdout: puesto } = await correr('git', ['log', '-1', '--format=%B']);
const real = normalizar(puesto);

if (real === esperado) {
  console.log('mensaje verificado: ' + esperado.split('\n').length + ' lineas, identicas al archivo');
  process.exit(0);
}

/* Si difieren, se dice DONDE. Un «no coinciden» a secas obliga a comparar a
   mano justo cuando uno ya se equivoco una vez. */
const a = esperado.split('\n');
const b = real.split('\n');
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i++;
console.error('');
console.error('⚠ EL MENSAJE QUE QUEDO NO ES EL DEL ARCHIVO.');
console.error('  lineas: archivo ' + a.length + ', commit ' + b.length);
console.error('  primera diferencia, linea ' + (i + 1) + ':');
console.error('    archivo: ' + JSON.stringify(a[i] ?? '(no hay)'));
console.error('    commit : ' + JSON.stringify(b[i] ?? '(no hay)'));
console.error('');
console.error('  El commit ESTA hecho. Corregilo con:');
console.error('    node scripts/commit.mjs ' + archivo + ' --amend');
process.exit(1);
