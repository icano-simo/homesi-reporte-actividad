<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verificar antes de reportar

> Esta sección va FUERA del bloque de arriba a propósito: ese lo regenera una
> herramienta y se lleva lo que tenga dentro.

## La regla

**No reportes un fallo sin haberlo reproducido por otra vía.**

Sale de siete casos reales de esta base de código, en una sola serie de
trabajo. Las siete veces la herramienta de verificación dio un falso negativo
que se parecía a un bug del código:

| lo que la prueba dijo | lo que pasaba de verdad |
|---|---|
| «el subtítulo del mes no se renderiza» | un `<input type="month">` no tiene `innerText` |
| «mover el benchmark liberó 118px» | la estimación era mía; medido, la tabla quedó **más ancha** |
| «el forecast de Brokered no coincide» | mi script de comparación leía la columna equivocada del Excel |
| «julio no muestra el aviso de integridad» | mi timeout era de 3,5s y la ruta tardaba más |
| «la ventana de 12 meses aceleró la ruta 3×» | la ventana no descartaba **ni un** snapshot; los 7,9s eran el compile en frío |
| «la fila anclada tiene fondo navy y texto blanco» | medí `td:first`; en cuatro de las doce celdas el texto quedaba ilegible |
| «doce empleados no están en la población del módulo» | leí el subtítulo antes de que llegaran los datos; once eran falsos y **uno era real** |

Los siete fallaron de modos **distintos**, así que no hay un chequeo general
que los cubra. Lo único que funcionó las siete veces fue medir de nuevo por un
camino que no compartiera el error con el primero.

**El quinto es el difícil**, y por eso está: los otros cuatro parecían bugs del
código, así que había ganas de mirarlos. Este parecía un éxito. El número era
bueno, el cambio era real y nadie lo habría cuestionado — una mentira plausible.
Lo que lo delató no fue el número sino que **no se explicaba por el mecanismo**:
una ventana que no descarta un solo snapshot no puede acelerar nada.

Que es el corolario de abajo en la dirección contraria, y vale igual:

> **Cuando el número no se explica por el mecanismo, tenía razón el mecanismo.**

Y una regla operativa que sale sólo de este caso: **medir una ruta de Next en
dev necesita una corrida de calentamiento antes de la primera que cuenta**, o el
compile se cobra en la primera medición y se lo atribuye al cambio.

**El sexto es de otra clase**, y por eso vale distinguirlo. Los cinco anteriores
son mediciones MAL ESCRITAS: el elemento equivocado, el contenedor en vez del
texto, la columna equivocada, el timeout corto, el compile en frío. Ésta estaba
bien escrita — `getComputedStyle` sobre una celda de la fila devolvió
exactamente lo que había que verificar, fondo `--navy` y texto blanco. El
problema es que **midió una muestra que no representaba al conjunto**: era
`td:first`, la celda del rótulo, y las otras once no tenían por qué comportarse
igual. Cuatro de ellas —las de pronóstico y presupuesto— conservaban el tinte
de su banda, que le ganaba en especificidad, y sus números quedaban en azul
pálido sobre azul pálido.

> **Una celda no dice nada de las otras once.**

La regla operativa: **cuando se verifica un estilo que aplica a varias celdas,
medir una no alcanza.** O se miden todas, o se mira la captura.

Y de nuevo lo encontró la captura y no el número — igual que los seis hallazgos
del módulo Outlook que salieron de ver una imagen. Un `getComputedStyle` verde
sobre una celda y una fila ilegible conviven sin contradecirse.

**El séptimo agrega un mecanismo que no estaba: medir antes de que el estado
esté listo.** Sondeé doce empleados para encontrar uno sin plan, leyendo el
nombre del subtítulo, y los doce dieron «no está en la población del módulo».
Doce de doce parecía el hallazgo del turno — un bug enorme. Era que la pantalla
renderiza `—` mientras los datos no llegaron: el catálogo lo dibuja la
biblioteca, y el nombre lo llena la población del módulo, que es **otra carga**.
Esperé a la primera y medí antes de la segunda.

> **Una pantalla que todavía no cargó dice exactamente lo mismo que una que no
> tiene el dato.**

La regla operativa: **esperar a que el dato llegue antes de afirmar que no
existe.** Y esperar al dato que se va a leer, no a cualquier señal de vida de la
página — la espera correcta era «el subtítulo trae un nombre», no «hay tarjetas
en pantalla».

Pero lo que hace que este caso valga la sección es la parte de después. Al
re-medir con la espera puesta, **uno de los doce siguió diciendo lo mismo a los
90 segundos**: el empleado 77 no está en la población, de verdad. Había un caso
real dentro de once falsos, y era el que hacía falta para explicar por qué el
botón de activar no hacía nada.

> **Un método de medición roto no vuelve falsos a todos sus resultados.**

Lo cómodo, al descubrir que la medición estaba mal, es descartar la tanda
entera y volver a empezar. Habría funcionado igual acá, pero por suerte: el
diagnóstico correcto —un guardia que retornaba en silencio— salía justamente
del único resultado que era cierto. La regla que queda: **cuando se cae una
medición, hay que volver a mirar sus resultados uno por uno**, no tirarlos
juntos. La medición era común; los casos no.

## El corolario

**Cuando la captura y la medición no coinciden, la sospecha va sobre la
medición.** Las cuatro veces la medición era la equivocada.

El caso que lo fija: en el rediseño del encabezado del reporte, mi número final
—150px de exceso— casi coincidió con la estimación previa —158px—, y **por un
mecanismo completamente distinto**. Confiar en que el número cuadraba habría
escondido la causa real. La coincidencia de dos números no es evidencia de que
el razonamiento sea el mismo.

## Qué cuenta como «otra vía»

- Un `.xlsx` generado: abrirlo con **openpyxl en `data_only=True`**, no sólo con
  la librería que lo escribió. ExcelJS lee la fórmula y no le importa que le
  falte el valor en caché; Excel de escritorio recalcula y tapa el defecto. Los
  dos dan verde sobre un archivo roto.
- Un número de pantalla: además de medirlo, **mirar la captura**. Seis hallazgos
  de la serie del módulo Outlook salieron de ver una imagen, no de una medición
  —un lápiz que no hacía nada no rompe ningún invariante—.
- Un invariante: recordar que **verifica relaciones, no contenido**. Catorce
  filas que no deberían existir suman perfectamente.
- Una consulta a Supabase: **cero filas con `error: null` es una policy de RLS
  que no aplica**, no una tabla vacía. RLS filtra, no rechaza.

## Antes que todo lo anterior: que el arnés haya corrido

Las siete lecciones de arriba son sobre mediciones que midieron mal. Ésta es
sobre una que **no midió**, y va primero porque si el arnés puede dar verde sin
correr, ninguna de las siete sirve.

Un script de verificación imprimió **`SIN FALLAS`** sin haber ejecutado una sola
aserción. El resumen vivía en un `finally`:

```js
} finally {
  console.log(fails === 0 ? 'SIN FALLAS' : fails + ' FALLAS');
}
```

El `import` del módulo bajo prueba falló, el `catch` no existía, y el `finally`
corrió con `fails` todavía en `0`. **Cero fallas sobre cero pruebas se imprime
exactamente igual que cero fallas sobre diecisiete.**

> **Un contador de fallas no distingue «todo bien» de «no medí nada».**

La regla operativa: **el resumen tiene que contar las aserciones que corrieron y
compararlas contra las que se esperaban.** Un corte temprano dice `RESUMEN
INVALIDO`, no verde:

```js
const MINIMO = 17;              // cuántas tiene que haber
let corridas = 0;               // cuántas hubo
const ck = (c, m) => { corridas++; if (!c) fails++; ... };
...
} finally {
  if (corridas < MINIMO) console.log('** RESUMEN INVALIDO ** ' + corridas + ' de ' + MINIMO);
  else console.log(fails === 0 ? 'SIN FALLAS (' + corridas + ')' : fails + ' FALLAS');
}
```

Y el número va **escrito a mano**, no derivado del propio recorrido: derivarlo lo
haría siempre coincidir, que es justo el problema que viene a resolver.

Es el mismo mecanismo que el séptimo caso de la tabla —un resultado que no
distingue «no está» de «no llegó»— pero corrido un nivel: ahí lo confundía la
medición, acá lo confunde **el arnés que la reporta**.

## Y el caso peor: la medición que nunca se hizo

Las siete de la tabla son mediciones que fallaron. La de arriba es un arnés que
no corrió. Ésta es distinta de las dos: **nadie la escribió, porque nadie pensó
en escribirla.**

Durante semanas nadie pudo marcar un step como completado. Cuatro planes
activos, doce steps en curso, **cero completados en toda la historia del
módulo**. Estaba así desde BP20, cuando el estado pasó de botón a desplegable, y
no lo detectó **ninguna** prueba mía. Lo detectó Isabella usándolo.

La causa era que el desplegable sólo ofrecía «completado» al responsable
nominal del step, y con los 75 steps repartidos entre nueve personas, **69 de 75
no ofrecían la opción a quien estuviera mirando**.

Y la razón por la que ninguna prueba lo vio es incómoda: **todas verificaban que
la app hiciera lo que el código decía, y el código decía eso.** El test se
escribió leyendo la implementación, así que sólo podía confirmarla. Ninguno
preguntó lo que un usuario pregunta.

> **Una prueba escrita desde el código sólo puede confirmar el código.**

Las dos reglas operativas que salen de acá:

- **Un control que depende de quién sos hay que probarlo como el OTRO.** Si la
  regla es «sólo el responsable puede», la prueba que importa es la de alguien
  que no lo es — y hay que mirar si le queda algún camino, no si el control
  respeta la regla.
- **Al menos una verificación por pantalla tiene que salir del OBJETIVO y no de
  la implementación.** No «el desplegable ofrece los estados permitidos» sino
  «¿alguien puede registrar que esto se hizo?». La primera se contesta leyendo
  el código; la segunda, sólo usándolo.

Y el corolario que duele: el número que lo delató —69 de 75— se podía haber
calculado en cualquier momento con una consulta de treinta segundos. No hacía
falta descubrirlo, hacía falta preguntarlo.

## Cinco de estas lecciones son código, no nota

`scripts/verificacion/guardas.mjs`. Se importan desde cualquier script de
verificación y no tocan la base — reciben el `page` o el `locator` por
argumento, así que la sonda que se autentica contra producción sigue viviendo
fuera del repo.

| Guarda | Qué impide | Veces que mordió |
|---|---|---|
| `leerTexto` | `innerText` con `text-transform`, y leer texto de un `<input>` | **4** |
| `esperarDato` | medir antes de que el dato llegue, y esperar a la señal equivocada | 1, con 11 falsos |
| `medirRuta` | atribuirle al cambio el compile en frío | 1, casi público |
| `crearArnes` | un resumen que dice verde sin haber corrido | 1 |
| `exigirSinChoques` | redefinir una clase de CSS que ya existía | 1 |

**Por qué están en el repo y no en el scratchpad de una sesión:** una guarda que
se muere con la sesión es *peor* que una nota acá, porque la nota al menos
sobrevive para que alguien la lea.

Y sus propias pruebas verifican que **atrapen**, no que pasen —
`guardas.test.mjs` y `guardas.browser.test.mjs` construyen el error que cada una
existe para detectar. Escribiendo esa prueba apareció una aserción mía que era
una **tautología**: `!a.includes(b) || a.length === 3`, cuyo segundo término
siempre era cierto. Una aserción que no puede fallar es peor que ninguna, porque
ocupa el lugar de una que sí mide.

**Las otras cuatro se quedan como nota, y por buenas razones.** El timeout corto
no tiene un número correcto general — depende de la ruta. La columna equivocada
del Excel se evita leyendo por nombre, que es una convención y no una función. Y
la estimación propia usada como medición es un error de criterio: ninguna guarda
impide que alguien confíe en su propio cálculo.

# Un caso nuevo activa bugs que nadie escribió hoy

> Sección aparte de la tabla de arriba a propósito. Los cinco casos de esa tabla
> son **verificaciones que dieron un falso negativo**: la prueba estaba mal. Este
> es otro mecanismo, y meterlo ahí lo haría parecer lo mismo: acá **el código no
> cambió, cambió el conjunto de entradas que lo alcanza**.

## La regla

**Cuando una etapa hace visible un caso que antes no se mostraba, recorrelo de
punta a punta.** Que aparezca no prueba que el camino que abre esté pisado.

## El caso que la fija

En OL21, la vista de la división pasó a contar los cierres de originadores de
fuera de la división. Eso le dio **fila propia a `Branch Out of Division`**, el
balde donde `classifyBranch` mete los cierres de un `OrgID` que no está en el
roster oficial. La fila salió bien: 2 cierres, abril y mayo, y el total de la
división cuadró con Commercial Activity mes por mes.

Pero esa fila es un link, y la página del branch **no decodificaba el segmento de
la URL**. Next lo entrega crudo, así que llegaba como
`Branch%20Out%20of%20Division` y no calzaba con ningún `branchCode`. Resultado:

> Branch **Branch%20Out%20of%20Division** has no production or roster this year.

Un branch con producción real diciendo que no tiene ninguna, y filtrando el
encoding en el texto de la pantalla.

**Las dos piezas eran viejas.** `classifyBranch` devuelve ese nombre desde
siempre, y el `decodeURIComponent` faltaba desde siempre. Lo único nuevo fue
darle una fila — y bastó, porque hasta ese momento ningún código de branch tenía
un espacio: `AFFINITY`, `Recruitment` y números. El bug estaba esperando que algo
lo alcanzara.

## Qué hacer, entonces

No alcanza con verificar que el caso nuevo **aparezca**. Hay que usarlo:

- si es una fila que linkea, **abrir el link**
- si es una opción de un desplegable, **elegirla y guardar**
- si es un branch, una estrategia o una persona nueva en una lista, **entrar a su
  pantalla** y mirar que no diga que no existe

El costo es un clic. Lo que evita es entregar una etapa correcta con una puerta
que da a una pared, y que la encuentre quien la use.

## Y el caso hermano: redefinir un nombre que ya existía

Antes de definir una clase de CSS, **verificar que el nombre no exista**. Un
`git grep` cuesta segundos.

`.bp-pill` estaba definida desde antes, con `--radius-sm`, padding `2px 7px`,
10px y peso 700, y la usaba `FunnelExplorer` con sus variantes `--sky`, `--day`
y `--late`. La redefiní para las tarjetas de nodo, y como la mía venía después
en el archivo, **le ganó**: las píldoras del explorador cambiaron de forma,
padding, tamaño y peso sin que nadie lo pidiera.

Lo que lo hizo invisible: las variantes sobreescriben **color y borde**, que es
lo que se mira primero, así que seguían viéndose bien. Y ninguna medición de esa
etapa tocaba el explorador — se estaba verificando la pantalla nueva.

> **Una clase redefinida no rompe donde la escribís, rompe donde ya estaba.**

Y una vuelta de tuerca que lo empeora en vez de mejorarlo: el contexto ajeno era
**mío**, de dos etapas antes. Dos etapas propias también colisionan, así que la
familiaridad con el archivo no sustituye al grep.

La regla operativa: **al agregar CSS, `git grep` del selector primero.** Si ya
existe, elegir otro nombre — no "mejorar" el existente de paso, porque quien lo
usa no está en la pantalla que se está mirando. Y al medir un cambio de estilo,
medir **la cascada** y no sólo el elemento nuevo: un elemento inyectado con la
clase ajena dice si le pegaste, sin tener que navegar hasta ahí.

# Lo que compensa una ausencia hace que la ausencia no se note

> Tercera sección aparte, y sale de haberlo visto **tres veces**. Un patrón se
> reconoce por repetición, no por descripción: por eso van los tres casos con
> nombre y no una definición general.

## La regla

**Cuando algo cae a un valor de respaldo, deja de haber señal de que el original
falta.** El respaldo no es el bug — es lo que hace que el bug espere.

Y de ahí lo que hay que mirar: **un respaldo que nunca se ejerció es sospechoso**.
O el original siempre estuvo, y el respaldo sobra; o el original nunca estuvo, y
lo que se está usando es el respaldo sin saberlo.

## Los tres casos

**1. `--white`, con su fallback.** El token no estaba definido en ninguna parte, y
los cuatro usos del módulo Outlook lo pedían como `var(--white, #fff)` o
`var(--white, transparent)`. Nunca rompió: el fallback tapaba la ausencia. Se
descubrió al escribir el primer uso **sin** fallback — `color: var(--white)`
sobre `--navy` habría salido oscuro sobre oscuro. Se definió en `tokens.css`, y
los cuatro fallbacks se borraron: un respaldo muerto es una compensación
esperando ocultar la próxima.

**2. `--ol-text`, fuera de su alcance.** Está definido en `.ol-page, .ol-editor`,
y la barra del módulo vive en el `layout.tsx`, que está fuera de las dos. Así que
`font-size: var(--ol-text)` era una variable indefinida, la declaración se
ignoraba, y **toda la barra vino en los 14px del documento en vez de los 12 del
módulo, desde OL22 y sin que nadie lo notara**. Acá el respaldo ni siquiera está
escrito: es la herencia del CSS, que siempre tiene algo que dar.

**3. El `''` del parser.** Cuando el export no trae las columnas opcionales, el
parser cae a cadena vacía y no a `null`, así que **«no vino la columna» y «vino
vacía» se guardan igual** y no se pueden distinguir después. Está documentado en
`docs/ARQUITECTURA.md` y no se cambió, porque tocar esa coerción afecta a otras
etapas — pero saberlo es lo que evita leer un `''` como una decisión.

## El contraejemplo, que es el que enseña

`outlook.snapshot.warnings` hace lo contrario **a propósito**, y su SQL lo dice:

> `NULL` = la carga no reportó nada (o es anterior a esta columna, que no es lo
> mismo y no se puede distinguir). **Array vacío** = la carga corrió y no
> encontró nada.

Ahí no hay respaldo: los dos estados son distinguibles porque **nadie los
compensó**. Es la misma distinción que sostiene todo el módulo Outlook — un cero
es una decisión, vacío es que nadie decidió — y la razón por la que un benchmark
sin fijar se guarda como `null` y no como `0`.

## Qué hacer

- Al escribir un uso nuevo de algo que en otros lados tiene respaldo, **escribirlo
  sin respaldo primero** y ver si funciona. Si no funciona, el original no existe.
- Al ver un `var(--x, algo)`, un `?? valorPorDefecto` o un `catch` que devuelve un
  neutro, preguntarse **cuándo fue la última vez que esa rama se ejerció**.
- Y cuando dos estados significan cosas distintas —no vino contra vino vacío, no
  se decidió contra se decidió cero— **no darles el mismo valor**, aunque cueste
  una columna nullable más.
