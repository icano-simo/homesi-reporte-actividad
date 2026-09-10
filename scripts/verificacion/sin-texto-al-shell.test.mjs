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
  ['python -c "print(1)"', 'código como argumento'],
  ["bash -c 'ls -la'", 'código como argumento'],
  ['powershell -Command "Get-ChildItem"', 'código como argumento'],
  ['git commit -m "RV: el boton `disabled={busy}` y nada mas"', 'mensaje de commit en la línea'],
  ['git commit -am "algo"', 'mensaje de commit en la línea'],
  ['gh pr create --body "texto con `backticks`"', 'cuerpo de PR en la línea'],
  ["printf 'contenido' > archivo.txt", 'texto redirigido a un archivo'],
  ['echo "una nota" >> notas.md', 'texto redirigido a un archivo'],
  ["sed -i 's/CLAVES = \\[5, 29\\]/CLAVES = [5]/' sonda.mjs", 'sed -i con escapes'],
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
];

const a = crearArnes({ minimo: BLOQUEA.length + DEJA_PASAR.length + 1 });

for (const [cmd, esperada] of BLOQUEA) {
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
