/*
 * LA PRUEBA DE LA GUARDA DEL SHELL.
 *
 * Como las otras: verifica que ATRAPE, no que pase. Los nueve casos de
 * «bloquea» son comandos que SE ESCRIBIERON DE VERDAD en esta serie --el
 * heredoc de la última vez incluido-- y los quince de «deja pasar» son
 * comandos que se corren todo el tiempo.
 *
 * ⚠ La segunda mitad no es relleno: una guarda que bloquea todo es la que
 * alguien desengancha, y ahí se pierde también lo que sí cubría. El costo de un
 * falso positivo lo paga la guarda entera.
 *
 *   node scripts/verificacion/sin-texto-al-shell.test.mjs
 */
import { decidir } from './sin-texto-al-shell.mjs';
import { crearArnes } from './guardas.mjs';

const BLOQUEA = [
  ["cat > ver-barra.mjs << 'XEOF'\nXEOF", 'heredoc'],
  ["python - <<'EOF'\nprint(1)\nEOF", 'heredoc'],
  ['cat archivo <<<"texto"', 'heredoc'],
  ['node -e "console.log(1)"', 'código como argumento'],
  /*
   * ⚠ EL CASO REAL, no inventado: este comando CORRIÓ sin rebotar mientras se
   * medía otra etapa. El patrón perseguía `-e` y `-c`, y `-p` es `--print`, o
   * sea lo mismo con un `console.log` puesto. Va con su forma larga al lado.
   */
  ["node -p \"Object.keys(require('./package.json').scripts).join('\\n')\"", 'código como argumento'],
  ['node --print "process.version"', 'código como argumento'],
  ['python -p "x"', 'código como argumento'],
  ['python -c "print(1)"', 'código como argumento'],
  ["bash -c 'ls -la'", 'código como argumento'],
  ['powershell -Command "Get-ChildItem"', 'código como argumento'],
  ['git commit -m "RV: el boton `disabled={busy}` y nada mas"', 'mensaje de commit en la línea'],
  ['git commit -am "algo"', 'mensaje de commit en la línea'],
  ['gh pr create --body "texto con `backticks`"', 'cuerpo de PR en la línea'],
  /* `-b` es el atajo de `--body` y faltaba en el patrón. */
  ['gh pr create -b "texto con `backticks`"', 'cuerpo de PR en la línea'],
  ['gh issue create --body "otro texto"', 'cuerpo de PR en la línea'],
  ["printf 'contenido' > archivo.txt", 'texto redirigido a un archivo'],
  ['echo "una nota" >> notas.md', 'texto redirigido a un archivo'],
  /*
   * ⚠ ACÁ ESTABA `sed -i 's/CLAVES = \[5, 29\]/CLAVES = [5]/' sonda.mjs`, Y SE
   * MOVIÓ A `DEJA_PASAR`. Es el único caso que esta etapa saca de la lista de
   * bloqueados, así que conviene decir por qué con la medición al lado.
   *
   * Sus backslashes van entre comillas SIMPLES: el shell no los toca y `sed`
   * los recibe tal cual. El motivo que la regla declara --«una sustitución con
   * backticks, `$` o backslashes llega distinta de como se escribió»-- no
   * aplica a ese comando. Lo frenaba por parecerse, no por serlo.
   *
   * ⚠ Y LA GUARDA NO PIERDE UNA PROTECCIÓN QUE TENÍA. Medido con la regla
   * VIEJA sobre el `sed` que de verdad hizo daño en esta serie --tocó tres
   * reglas de CSS cuando quería una--:
   *
   *     sed -i 's/^  margin-top: 16px;$/  margin-top: 12px;/' admin.css
   *
   * pasaba igual, porque el `[^|;&]*` del patrón no puede cruzar el `;` que
   * tiene adentro. O sea que el daño real de un `sed -i` --a cuántas líneas se
   * aplica-- nunca estuvo cubierto, y eso es un LÍMITE y no un hueco: depende
   * del archivo y no del comando. Queda escrito en AGENTS.md.
   */
];

const DEJA_PASAR = [
  'cmd //c "rmdir C:\\Users\\x\\rv17\\node_modules"',
  'cmd /c mklink /J C:\\a\\node_modules C:\\b\\node_modules',
  'node scripts/commit.mjs C:/tmp/mensaje.txt',
  'git commit -F C:/tmp/mensaje.txt',
  'npx tsc --noEmit; echo "tsc: $?"',
  'npx eslint app/foo.tsx; echo "eslint: $?"',
  'grep -c "algo" archivo.md',
  'netstat -ano | grep ":3110 .*LISTENING"',
  'git log --oneline -3',
  'curl -s -o /dev/null -w "%{http_code}" http://localhost:3110/ ; echo " <- home"',
  'echo "local: $(git rev-parse HEAD)"',
  "sed -n '1,40p' archivo.ts",
  'taskkill //PID 123 //T //F',
  'git push origin HEAD:main 2>&1 | tail -2',
  'ls node_modules | wc -l',
  'echo "ruido" > /dev/null',
  'node scripts/verificacion/sin-texto-al-shell.test.mjs',
  /*
   * ⚠ `-p` ES UNA BANDERA COMUNÍSIMA, y por eso el patrón exige el intérprete
   * pegado adelante. Sin eso, la fila de «código como argumento» se llevaría
   * puesto medio shell -- y una guarda que bloquea lo permitido es la que
   * alguien desengancha, con lo que se pierde también lo que sí cubría.
   */
  /*
   * ⚠ EL FALSO POSITIVO QUE SE COMIÓ ESTA MISMA ETAPA: buscar la bandera COMO
   * TEXTO. El comando es prosa sobre la guarda, no código para un intérprete.
   */
  'grep -n "node -e`, `python -c" AGENTS.md',
  "grep -rn 'bash -c' scripts/",
  'mkdir -p scripts/verificacion/salida',
  'docker run -p 3000:3000 imagen',
  'npm run dev -p 3210',
  'grep -rn "algo" . | head -p 3',
  'npx next dev -p 3230',
  /*
   * ⚠ EL SEGUNDO FALSO POSITIVO: `--title` con el cuerpo en un archivo.
   *
   * El patrón era `--(body|title)` y bloqueaba esto, que está bien. El cuerpo
   * iba por archivo --no tocaba el shell-- y aun así el título disparaba la
   * regla. Un título es una línea de prosa sin backticks, y `gh pr create` no
   * tiene `--title-file`, así que bloquearlo no dejaba salida.
   */
  'gh pr create --base main --title "docs(outlook): el caso ya no tiene filas" --body-file C:/tmp/pr.md',
  'gh pr create --title "feat: algo" --body-file cuerpo.md',
  /* `--base` lleva un `-b` adentro y no debe matchear el atajo de `--body`. */
  'gh pr create --base main --head rama --body-file cuerpo.md',
  /*
   * ⚠ EL FALSO POSITIVO QUE LA GUARDA SE COMIÓ, y las variantes de la misma
   * forma. El `>` que matcheaba era el de `2>&1` dentro de una sustitución de
   * comando: no escribe ningún archivo. Ver la nota del patrón.
   */
  'echo "faltantes: $(npm ls --depth=0 2>&1 | grep -ciE \'UNMET|missing\')"',
  'echo "estado: $(curl -s -o /dev/null -w "%{http_code}" http://localhost:3125/ 2>&1)"',
  'printf "%s\\n" "$(git status --short 2>&1)"',
  'echo "aviso" >&2',
  /*
   * ⚠ LOS TRES FALSOS POSITIVOS DE LA SERIE DE MARGINS, que son el mismo
   * mecanismo: el patrón aparecía DENTRO DE UNA CADENA, donde el carácter es
   * texto y no un operador del shell.
   *
   * ⚠ Y el primero se habia reportado mal: dije que lo frenaba el `2>/dev/null`
   * de la misma línea, y medido, ese comando solo PASA --la regla ya excluye
   * `/dev/null` y los descriptores--. Lo que frenaba era la flecha del
   * `printf`. Por eso los dos están acá por separado.
   */
  'grep -rlo "mg-grid" .next/dev/static/chunks/*.css 2>/dev/null | head -3',
  'while read f; do printf "%s -> " "$f"; done',
  'echo "=== hay algun <a> o Link dentro de un .seg hoy?"',
  "grep -n 'sed -i con backtick' AGENTS.md",
  'grep -n "sed -i, el caso de la lista" AGENTS.md',
  /* Y la forma de la flecha en una sola comilla, que es la mas comun. */
  "printf '%s -> %s\\n' uno dos",
  /*
   * El que estaba en `BLOQUEA`. Ver la nota de allá: sus backslashes van entre
   * comillas simples, donde el shell no los toca.
   */
  "sed -i 's/CLAVES = \\[5, 29\\]/CLAVES = [5]/' sonda.mjs",
];

/*
 * ⚠ Y EL CONTROL DE LA OTRA RAMA: lo que el arreglo NO puede haber aflojado.
 *
 * Ignorar lo que va entre comillas podría haber dejado ciega a la guarda para
 * una redirección o un `sed` de verdad. Estos son los mismos casos de
 * `BLOQUEA`, escritos con comillas al lado, y tienen que seguir frenando.
 *
 * Sin esta lista, «los tres falsos positivos pasan» sería compatible con una
 * guarda que no bloquea nada.
 */
const SIGUE_BLOQUEANDO = [
  ['echo "hola mundo" > salida.txt', 'texto redirigido a un archivo'],
  ["echo 'una linea' >> registro.log", 'texto redirigido a un archivo'],
  ['printf "%s\\n" "$x" > datos.txt', 'texto redirigido a un archivo'],
  /* ⚠ COMILLAS DOBLES: ahí el `$` y el backtick SIGUEN expandiendo. */
  ['sed -i "s/$viejo/nuevo/" archivo.ts', 'sed -i con escapes'],
  ['sed -i "s/x/`date`/" archivo.ts', 'sed -i con escapes'],
  ["sed -i 's/a/b/' archivo.ts && echo `pwd` > x.txt", 'texto redirigido a un archivo'],
  /*
   * ⚠ EL CONTROL DEL `sobre: 'ambas'` DE «código como argumento»: en un `-e` de
   * verdad la bandera va FUERA de las comillas, así que ignorar lo entrecomillado
   * no puede perderla. Sin estas tres, «el grep de prosa pasa» seria compatible
   * con una regla que dejo de mirar la bandera.
   */
  ['node -e "console.log(`hola`)"', 'código como argumento'],
  ["python -c 'print(\"x\")'", 'código como argumento'],
  ['node -p "require(\'./package.json\').version"', 'código como argumento'],
];

/*
 * El mínimo sale de las tres listas, que es lo que el script TIENE que correr.
 * Derivarlo de las listas y no escribirlo a mano es lo correcto acá --y es la
 * excepción a la regla del mínimo escrito a mano--: lo que la guarda vigila es
 * un corte temprano, y si una lista se vacía por accidente el `minimo` baja con
 * ella. Por eso además se afirma abajo que ninguna está vacía.
 */
const a = crearArnes({
  minimo: BLOQUEA.length + DEJA_PASAR.length + SIGUE_BLOQUEANDO.length + 2,
});

a.ck(BLOQUEA.length > 10 && DEJA_PASAR.length > 15 && SIGUE_BLOQUEANDO.length > 3,
  'ancla: las tres listas tienen casos (' + BLOQUEA.length + ' / ' + DEJA_PASAR.length +
  ' / ' + SIGUE_BLOQUEANDO.length + ')');

for (const [cmd, esperada] of [...BLOQUEA, ...SIGUE_BLOQUEANDO]) {
  const r = decidir(cmd);
  a.ck(
    r !== null && r.nombre === esperada,
    'BLOQUEA ' + JSON.stringify(cmd.slice(0, 46)) + ' por «' + esperada + '»' +
      (r === null ? ' -- PASO DE LARGO' : r.nombre !== esperada ? ' -- dijo «' + r.nombre + '»' : '')
  );
}

for (const cmd of DEJA_PASAR) {
  const r = decidir(cmd);
  a.ck(
    r === null,
    'DEJA PASAR ' + JSON.stringify(cmd.slice(0, 46)) + (r === null ? '' : ' -- BLOQUEO por «' + r.nombre + '»')
  );
}

/* Y el caso de la entrada vacía: sin comando no hay nada que bloquear. */
a.ck(decidir('') === null && decidir(undefined) === null, 'sin comando no bloquea nada');

process.exitCode = a.resumen();
