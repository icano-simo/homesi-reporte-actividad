import { pathToFileURL } from 'node:url';

/*
 * ============================================================================
 * LA CLAVE DE SERVICIO NO ENTRA A `business_plan`, `outlook` NI `review`
 * ============================================================================
 *
 * Se engancha como hook `PreToolUse` de `Write`/`Edit` y frena el archivo ANTES
 * de escribirlo, igual que `esperar-al-dato.mjs`.
 *
 * ---------------------------------------------------------------------------
 * QUÉ IMPIDE, Y POR QUÉ NO ES UNA FRONTERA DE SEGURIDAD
 * ---------------------------------------------------------------------------
 * `service_role` NO tiene `usage` sobre esos tres esquemas. No es un olvido:
 * es una decisión del usuario del 2026-09-09, y está en `AGENTS.md` con los
 * seis esquemas del proyecto medidos uno por uno.
 *
 * La base ya lo impide --contesta `42501`-- así que esto no protege nada que
 * no esté protegido. Lo que evita es el INTENTO: escribir una sonda que usa la
 * clave de servicio contra uno de los tres, correrla, leer el `42501`, y recién
 * ahí acordarse de que estaba escrito. Eso ya pasó, y el propio `AGENTS.md` lo
 * llama «el peor caso de esta sección entera»:
 *
 *   > Una nota que ya contesta la pregunta no sirve de nada si uno la escribe y
 *   > después no la consulta.
 *
 * No es un hueco de conocimiento, es un hueco de CONSULTA -- y eso no lo
 * arregla escribir mejor. Por eso esto frena la mano en vez de explicar de
 * nuevo.
 *
 * ⚠ Y ES PREVENCIÓN DE UN ERROR DEL QUE ESCRIBE SONDAS, no del equipo. La app
 * no usa la clave de servicio: vive en las sondas y en los scripts sueltos.
 *
 * ---------------------------------------------------------------------------
 * EL PREDICADO, Y POR QUÉ PIDE LAS DOS COSAS
 * ---------------------------------------------------------------------------
 *
 *   la clave de servicio  Y  un `Accept-Profile`/`Content-Profile` de los tres
 *
 * Cada mitad sola es legítima y común:
 *
 *   · `service_role` contra `org` o `activity_report` SÍ funciona --tienen
 *     `usage`-- y las sondas lo usan para crear el magiclink;
 *   · `Accept-Profile: review` con el token de una persona es exactamente la
 *     forma correcta, y es la que quedó en las sondas de esta serie.
 *
 * Pedir las dos juntas es lo que hace que casi no tenga falsos positivos. Y es
 * deliberadamente una regla sobre el SIGNIFICADO --qué clave, contra qué
 * esquema-- y no sobre la forma del texto.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LOS LÍMITES, DICHOS PARA QUE NADIE LOS SUPONGA
 * ---------------------------------------------------------------------------
 * 1. SÓLO VE LO QUE SE ESCRIBE A UN ARCHIVO. Un `curl` a mano con la clave en
 *    la línea no pasa por acá. Lo cubre en parte la guarda del shell --que
 *    bloquea el código como argumento-- pero no del todo, y queda dicho.
 *
 * 2. LA LISTA DE TRES ES UNA DECISIÓN, NO UN DATO DERIVADO. No se lee de la
 *    base: si se leyera, el día que alguien otorgue el `usage` por error la
 *    guarda se apagaría sola y en silencio. Escrita a mano, sacar un esquema
 *    es un cambio que alguien tiene que hacer y justificar.
 *
 *    **La regla que la mantiene viva: si mañana se otorga uno de los tres, se
 *    saca de esta lista EN EL MISMO COMMIT que aplica el grant.** Si no, la
 *    guarda empieza a frenar algo que el proyecto ya decidió permitir, y ésa es
 *    exactamente la guarda que alguien desengancha.
 *
 * 3. NO MIRA SI LA SONDA ADEMÁS ESCRIBE. Bloquea leer igual que escribir,
 *    porque `usage` sobre el esquema es lo que falta: las dos dan `42501`.
 */

/** Los tres esquemas sin `usage` para `service_role`. Ver el límite 2. */
export const SIN_USAGE = ['business_plan', 'outlook', 'review'];

/**
 * La clave de servicio, nombrada de las dos formas en que aparece: la variable
 * de entorno, y el `Authorization: Bearer <la variable>` que arman las sondas.
 */
const CLAVE_DE_SERVICIO = /SUPABASE_SERVICE_ROLE_KEY|\bservice_role_key\b/i;

/** Un header de esquema apuntando a uno de los tres. */
const PERFIL_PROHIBIDO = new RegExp(
  "['\"](?:Accept|Content)-Profile['\"]\\s*:\\s*['\"](" + SIN_USAGE.join('|') + ")['\"]",
  'i'
);

/*
 * ============================================================================
 * ⚠ Y LAS DOS MITADES TIENEN QUE ESTAR EN EL MISMO OBJETO, no en el mismo
 *   ARCHIVO — el falso positivo que dio en su primera prueba en vivo
 * ============================================================================
 *
 * La primera versión pedía las dos cosas en el archivo y bloqueó LA VÍA
 * CORRECTA: toda sonda de esta serie arranca con la clave de servicio para
 * pedir el magiclink --que no lleva esquema y es legítimo-- y después lee con
 * el token de la persona y `Accept-Profile: review`. Las dos mitades en el
 * mismo archivo, sin relación entre ellas.
 *
 * Y mi propia prueba no lo vio porque las puse en archivos SEPARADOS. El caso
 * real las tiene juntas: probé las mitades y no el conjunto, que es la misma
 * forma que «una celda no dice nada de las otras once».
 *
 * Lo que decide es si el header prohibido está en el MISMO objeto de headers
 * que la clave de servicio. Eso se puede contestar sin parsear JS: se busca el
 * bloque de llaves que contiene al header y se mira si adentro aparece alguno
 * de los nombres atados a la clave.
 */

/** Los identificadores que quedan atados a la clave de servicio. */
function nombresDeServicio(codigo) {
  const nombres = new Set();
  for (const m of codigo.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*SUPABASE_SERVICE_ROLE_KEY/g
  )) {
    nombres.add(m[1]);
  }
  /* Y los objetos de headers armados CON esos: `const svc = { apikey: SVC, … }`.
     Dos vueltas alcanzan: `svc` sale de `SVC`, y nadie encadena más. */
  for (const base of [...nombres]) {
    const re = new RegExp(
      '(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\{[^}]*\\b' + base + '\\b[^}]*\\}',
      'g'
    );
    for (const m of codigo.matchAll(re)) nombres.add(m[1]);
  }
  return nombres;
}

/** El bloque de llaves que contiene esta posición. */
function bloqueQueContiene(codigo, pos) {
  let d = 0;
  let inicio = -1;
  for (let i = pos; i >= 0; i--) {
    if (codigo[i] === '}') d++;
    else if (codigo[i] === '{') {
      if (d === 0) {
        inicio = i;
        break;
      }
      d--;
    }
  }
  if (inicio === -1) return codigo;
  let n = 0;
  for (let i = inicio; i < codigo.length; i++) {
    if (codigo[i] === '{') n++;
    else if (codigo[i] === '}') {
      n--;
      if (n === 0) return codigo.slice(inicio, i + 1);
    }
  }
  return codigo.slice(inicio);
}

/**
 * ⚠ SIN COMENTARIOS NI CADENAS DE FIXTURE, por lo mismo que `esperar-al-dato`:
 * el archivo que aparece a propósito con el patrón prohibido es justamente el
 * que lo explica o el que lo prueba.
 *
 * Es `exigirAusente` aplicado a un hook -- la guarda que este repo tiene
 * documentada mordiendo SIETE veces por comprobar una ausencia sobre el archivo
 * y no sobre el código.
 */
function soloCodigo(texto) {
  return texto
    .split(/\r?\n/)
    .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
    .filter((l) => !/^\s*['"`]/.test(l))
    .join('\n');
}

/** Este mismo archivo y su prueba nombran los tres esquemas a propósito. */
const ES_LA_IMPLEMENTACION = /sin-service-role(?:\.test)?\.mjs$/;

/**
 * ¿Este contenido manda la clave de servicio contra un esquema que no la acepta?
 *
 * @param {string} ruta      dónde se va a escribir
 * @param {string} contenido qué se va a escribir
 * @returns {{ nombre: string, porque: string, hacer: string } | null}
 */
export function decidir(ruta, contenido) {
  if (typeof contenido !== 'string' || contenido === '') return null;
  if (typeof ruta === 'string' && ES_LA_IMPLEMENTACION.test(ruta.replace(/\\/g, '/'))) return null;
  const codigo = soloCodigo(contenido);
  if (!CLAVE_DE_SERVICIO.test(codigo)) return null;
  const nombres = nombresDeServicio(codigo);
  if (nombres.size === 0) return null;

  /*
   * Cada header prohibido, y si el objeto que lo contiene usa la clave. El
   * valor puede ser una VARIABLE --`'Accept-Profile': esquema`, que es como lo
   * escribí en RV28-- así que se aceptan las dos formas, y la del literal
   * manda para poder nombrar el esquema en el mensaje.
   */
  const CUALQUIER_PERFIL = /['"](?:Accept|Content)-Profile['"]\s*:\s*([^,}\n]+)/g;
  let esquema = null;
  for (const m of codigo.matchAll(CUALQUIER_PERFIL)) {
    const bloque = bloqueQueContiene(codigo, m.index);
    if (![...nombres].some((n) => new RegExp('\\b' + n + '\\b').test(bloque))) continue;
    const literal = /^\s*['"]([\w-]+)['"]/.exec(m[1]);
    if (literal !== null) {
      if (SIN_USAGE.includes(literal[1].toLowerCase())) {
        esquema = literal[1];
        break;
      }
      /* Un literal de OTRO esquema --`org`, `activity_report`-- es legítimo. */
      continue;
    }
    /*
     * ⚠ EL VALOR ES UNA VARIABLE Y NO SE SABE CUÁL ES. Se bloquea sólo si uno
     * de los tres aparece como literal en el archivo --que es de donde sale el
     * argumento-- y si no, se deja pasar. El límite: una sonda que arme el
     * nombre del esquema de otra forma se escapa, y queda dicho.
     */
    const suelto = SIN_USAGE.find((s) => new RegExp("['\"]" + s + "['\"]").test(codigo));
    if (suelto !== undefined) {
      esquema = suelto;
      break;
    }
  }
  if (esquema === null) return null;
  return {
    nombre: 'la clave de servicio contra `' + esquema + '`',
    porque:
      '`service_role` NO tiene `usage` sobre `' + esquema + '` -- decision del usuario del\n' +
      '2026-09-09, con los seis esquemas medidos en AGENTS.md. La base contesta `42501 permission\n' +
      'denied for schema`, asi que esto no falla raro: falla entero, despues de escribir la sonda\n' +
      'y correrla. Ya paso, y la nota que lo contestaba estaba escrita.',
    hacer:
      'lee con el TOKEN DE UNA PERSONA: `Authorization: Bearer <access_token>` mas\n' +
      "`'Accept-Profile': '" + esquema + "'`. Es lo que hacen las sondas de la serie de la practica, y\n" +
      'ademas mide lo que esa persona ve de verdad. Si hace falta saltarse RLS, va por el editor de\n' +
      'SQL, que es la unica via que puede y la unica que no deja rastro -- con `returning` y el\n' +
      'numero en el reporte.',
  };
}

export { CLAVE_DE_SERVICIO, PERFIL_PROHIBIDO };

/* ── El hook ────────────────────────────────────────────────────────────────
   Corre sólo como entrypoint, así que la prueba puede importar `decidir` sin
   que esto lea stdin ni termine el proceso. */
const comoEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (comoEntrypoint) {
  let crudo = '';
  process.stdin.setEncoding('utf8');
  for await (const trozo of process.stdin) crudo += trozo;

  let entrada = {};
  try {
    entrada = JSON.parse(crudo || '{}');
  } catch {
    /* ⚠ SI NO ENTIENDE LA ENTRADA, NO BLOQUEA. Igual que las otras dos: una
       guarda que rompe toda escritura cuando cambia el formato del hook es peor
       que la falla que viene a evitar. */
    process.exit(0);
  }

  const ti = entrada?.tool_input ?? {};
  /* `Write` trae `content`; `Edit` trae `new_string`. Los dos escriben. */
  const contenido = typeof ti.content === 'string' ? ti.content : (ti.new_string ?? '');
  const regla = decidir(ti.file_path ?? '', contenido);
  if (regla === null) process.exit(0);

  process.stderr.write(
    'BLOQUEADO por scripts/verificacion/sin-service-role.mjs -- ' + regla.nombre + '.\n\n' +
      'POR QUE: ' + regla.porque + '\n\n' +
      'QUE HACER: ' + regla.hacer + '\n\n' +
      'Los limites estan en su cabecera: solo ve lo que se escribe a un archivo, y la lista de tres\n' +
      'es una decision escrita a mano. Si manana se otorga uno, se saca de la lista EN EL MISMO\n' +
      'commit que aplica el grant.\n'
  );
  process.exit(2);
}
