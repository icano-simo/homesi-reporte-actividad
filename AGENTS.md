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
