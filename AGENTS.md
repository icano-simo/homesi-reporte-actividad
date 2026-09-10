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

## Cuando la medición falla y no se entiende por qué: volcar, no reintentar

Las secciones de arriba son sobre mediciones que dieron un resultado falso.
Ésta es sobre qué hacer cuando la medición **no da ningún resultado** y no se
sabe por qué — el caso en que la tentación es probar otro selector.

> **Cuando una medición falla y no se entiende por qué, volcar lo que hay antes
> de intentar un quinto selector. El DOM dice qué pasó; el selector sólo dice
> si encontró lo que buscabas.**

El caso que la fija costó cuatro intentos. Una espera por el aviso de una
pantalla vencía a los 120s, y el mismo aviso apareciía perfecto en un script
suelto. Pasé por cuatro hipótesis —el predicado, el `arg`, la cookie, el
claim— y ninguna era. Al volcar el DOM, el `body` decía:

    Email
    Password
    Sign In

La sesión de la sonda no valía. **La pantalla decía la respuesta y la medición
no preguntaba eso**: ningún selector mío miraba el formulario de login, así que
todos daban «no está».

Y la causa tenía una asimetría que la hacía peor que un fallo: dos sondas del
mismo repo comparten email —el sufijo es un hash de la ruta— así que la segunda
borra y recrea al usuario de la primera. Y los dos caminos respondieron distinto:

| | qué verifica | qué dijo |
|---|---|---|
| `rest()` | sólo la **firma** del JWT | 200 |
| el navegador | `getUser()` pregunta al servidor de auth | `/login` |

**La sonda «funcionaba» por el camino que no comprueba**, y el 200 daba
confianza. Es la novena de la familia: la respuesta estaba a la vista y la
pregunta era otra.

## Una herramienta puede contestar de menos sin decir que contestó de menos

Los casos de arriba son mediciones que midieron mal, un arnés que no midió, y
una conclusión construida a partir de verdades. Éste es otro mecanismo: la
herramienta **contestó**, contestó bien lo que contestó, y contestó **menos de
lo que hay** — sin ninguna señal de que la respuesta estaba recortada.

Busqué si este repo tenía un despliegue en Vercel, por tres vías:

| vía | qué dijo |
|---|---|
| `.vercel/project.json` en el repo | no existe |
| `list_projects` del conector MCP | **un** proyecto del equipo, y no es éste |
| una URL `.vercel.app` en el código | ninguna |

Y reporté que el repo no estaba conectado a Vercel. Era falso: el proyecto se
llama `homesi-performance` —otro nombre que el repo— y la app está publicada en
internet desde hace semanas. `npx vercel project ls` lista **cinco** proyectos
del mismo equipo; el MCP listó uno.

> **Cuando una búsqueda por varias vías da un negativo, eso puede significar que
> ninguna de las vías podía verlo. La herramienta no falló — devolvió menos de
> lo que hay, que es peor.**

Peor porque un fallo se ve. Tres vías coincidiendo en «no» se siente como
evidencia, y era una sola fuente incompleta y dos que nunca podían responder
— no hay `.vercel/` en este repo y la URL no está en el código, así que esas dos
dan «no» también cuando la respuesta es «sí».

Las dos reglas operativas:

- **Un negativo sobre la existencia de algo externo vale menos que un negativo
  sobre su contenido.** «No hay proyecto» hay que confirmarlo con la
  herramienta que ENUMERA, no con las que consultan por clave.
- Y cuando dos de las tres vías sólo pueden decir «no», **no son vías**: son la
  misma vía contada tres veces. Es el problema de la celda que no dice nada de
  las otras once, en la dirección contraria.

## Un comentario correcto para su caso puede engañar en el siguiente

Cinco archivos de `docs/sql/` dicen alguna versión de:

> `business_plan` ya está expuesto en PostgREST desde BP6. Esta migración **no
> necesita** tocar `pgrst.db_schemas`.

Los cinco dicen la verdad — los cinco agregan tablas a un esquema que ya estaba
expuesto. Pero leídos juntos construyen una conclusión que ninguno afirma: que
nunca hace falta tocar esa lista. Y el sexto archivo fue el primero que **crea**
un esquema, así que la frase repetida es lo que hizo que no me lo preguntara.
Resultado: el modelo aplicado, las policies correctas, y la app viendo un 406.

> **Una nota que dice «esto no hace falta acá» envejece distinto que una que
> dice «esto no hace falta nunca», y se leen igual.**

La regla operativa: al escribir una nota de la forma «no hace falta X», decir
**por qué** no hace falta en este caso. `business_plan ya está expuesto, así que
esta migración no toca la lista` se sigue leyendo bien desde un archivo que crea
un esquema nuevo; `esta migración no necesita tocar la lista` no.

Es primo del caso del claim `outlook` —un comentario que enumeraba cuatro
personas cuando eran dos— pero el mecanismo es otro: ahí la nota se volvió
falsa, acá las cinco siguen siendo ciertas.

## El rol que no estaba en la cabeza al escribir la migración

Tercer caso del mismo mecanismo, y el que lo nombra. Los otros dos son la lista
`pgrst.db_schemas` de la sección de arriba y el GRANT de `business_plan.area`.
Seis esquemas en este proyecto, y `service_role` tiene `usage` sobre exactamente
la mitad:

| esquema | quién lo creó | `service_role` tiene `usage` |
|---|---|---|
| `activity_report` | anterior a esta serie | sí |
| `org` | anterior a esta serie | sí |
| `pipeline_forecast` | anterior a esta serie | sí |
| `business_plan` | esta serie | **no** |
| `outlook` | esta serie | **no** |
| `review` | esta serie | **no** |

El corte no es por antigüedad ni por casualidad: **son los tres que creamos
nosotros los que no lo tienen.** Y el diagnóstico, en las palabras del usuario:

> al crear un esquema nuevo doy `usage` a `authenticated` y no a
> `service_role`, porque `authenticated` es el que estoy pensando.

Y se comprueba en los archivos, sin mirar la base: `docs/sql/` tiene **siete**
`grant usage on schema … to …`, y los siete van a `authenticated`. Cero a
`service_role`. Las únicas tres veces que ese rol aparece en todo `docs/sql/` es
para decir que **no** se usa.

> **Lo que uno tiene en la cabeza al escribir la migración se cubre, y lo demás
> no.** El GRANT de `business_plan.area` y la lista `pgrst.db_schemas` son el
> mismo hueco, y en los tres no se olvidó nada — nunca entró en la frase.

### ⚠ Y ESTO ESTÁ ANOTADO, NO APLICADO

Decisión del usuario, 2026-09-09: **no se otorga.** Nada usa `service_role`
contra esos tres esquemas hoy, y el único archivo autorizado a tocar ese rol es
el del cambio de contraseña. Cuando algo lo necesite, se otorga **con la razón
escrita en la migración** — no «para que esté».

### Y la vez que lo redescubrí por las malas, con la tabla ya escrita

La predicción de arriba se cumplió, y el que la pagó fui yo. Al borrar unas
filas de prueba mandé un `DELETE` con `service_role` a `review` y a `outlook`,
y las dos contestaron `42501 permission denied for schema`. Reporté al usuario
que **la brecha era «más ancha de lo que decía la nota, que sólo hablaba de
`business_plan`»**.

La nota decía los tres. Están en la tabla de arriba, medidos, cada uno con su
«no». No estaba incompleta: **no la leí.**

> **Una nota que ya contesta la pregunta no sirve de nada si uno la escribe y
> después no la consulta.**

Es el peor caso de esta sección entera, porque no es un hueco de conocimiento:
es un hueco de consulta, y no lo arregla escribir mejor. Lo único que lo
arregla es el reflejo de mirar la nota ANTES de gastar un intento -- y en este
repo eso cuesta un `grep service_role AGENTS.md`.

Y hay un agravante que conviene ver: reporté una conclusión falsa **sobre mi
propio registro**, y el usuario la aceptó y me pidió que la anotara. Si no
hubiera ido a buscar dónde escribirla, la corrección habría quedado
contradiciendo a la tabla en el mismo archivo. La forma de la nota fue lo que
salvó el reporte: la tabla estaba ahí para desmentirme.

Y la razón por la que un hueco conocido se puede dejar abierto, que es lo que
distingue este caso de «Lo que compensa una ausencia hace que la ausencia no se
note»: **esta ausencia no está
compensada.** El día que algo pida `service_role` sobre uno de los tres, la base
contesta `42501` y lo dice fuerte. Un `grant` de más, en cambio, es permiso
permanente que nadie vuelve a revisar. Un respaldo silencioso sería el problema;
un error ruidoso es la señal.

Los tres síntomas no se parecen entre sí, y por eso conviene tenerlos juntos:

| lo que contesta | qué falta |
|---|---|
| `403` / `42501` | el GRANT — el rol no tiene `usage` o `select` |
| `406` / `PGRST106` | el esquema no está en `pgrst.db_schemas` |
| cero filas con `error: null` | nada: es una policy de RLS que no aplica |

### Y el corolario operativo: el editor SQL es la única vía y no deja rastro

De ese cierre sale algo que hay que tener escrito, porque **ya costó una
pregunta**. Un día las tres tablas transaccionales de `review` --`session`,
`assignment`, `response`-- aparecieron en **cero**, con una sesión completa de
Isabella entre lo que faltaba. Reconstruirlo llevó cinco consultas:

| lo que se preguntó | lo que contestó |
|---|---|
| ¿un `cascade` o un trigger? | los siete FK son planos y `review` no tiene ni un trigger |
| ¿pasó por la API? | `edge_logs`: 4.543 filas en la ventana, **cero** con método `DELETE` |
| ¿quién lo corrió? | `postgres_logs`: 38 filas en 90 minutos, sólo errores — **no hay log de sentencias** |
| ¿se perdió algo más? | sólo esas tres: `step` 8, `growth_rule` 190, enrollments 5, empleados 127 |

Era un borrado deliberado del usuario desde el **editor SQL**, después de que
Isabella cerrara la revisión de prueba. Y ésa es justamente la conclusión que
conviene dejar por escrito:

> **El editor SQL es la única vía que puede borrar de `review` --no hay policy
> de DELETE y `service_role` no tiene `usage`-- y es la única que no deja
> rastro.**

Las dos mitades importan. La primera es una buena noticia: un borrado ahí
**no puede** venir de la app ni de un script con la clave de servicio, así que
la lista de sospechosos es corta. La segunda es la que hay que recordar: no se
enciende el log de sentencias --decisión del usuario, 2026-09-10-- así que
**preguntar es más rápido que investigar**, y es el mismo movimiento que la
regla de «cuando un reporte no coincide con lo que uno hizo, pedir que se
confirme antes de actuar».

Y una regla operativa para el que borra: **dejar el rastro en el repo si no lo
deja la base.** Un `returning` en el `delete` y el número en el mensaje de
commit o en el reporte cuesta un segundo; reconstruirlo después costó cinco
consultas y una pregunta.

## El doceavo: una medición correcta sobre un momento equivocado

Los anteriores son mediciones **mal escritas** —el elemento equivocado, la
columna equivocada, el timeout corto— o un arnés que no corrió. Éste es un
mecanismo que no estaba, y por eso va aparte: la medición estaba **bien
escrita, sobre el elemento correcto, leyendo la propiedad correcta**. Lo que
estaba mal era el instante.

`.rv-target` declara `transition: outline-color 160ms, box-shadow 160ms`.
Poniendo la clase y leyendo `getComputedStyle` en el mismo tick, el navegador
devuelve el valor **en curso** de la transición, que al arrancar es el viejo.
Así que reportaba `outlineColor` navy —que es `currentColor`, el color del
texto— y la sombra que la tarjeta ya tenía, mientras el CSS decía coral.

> **Una medición correcta sobre un momento equivocado.**

Costó cuatro sondas persiguiendo a un culpable que no existía: busqué qué regla
pisaba a `.rv-target`, si los tokens estaban definidos, qué decía el CSS
servido, y llegué a inyectar `!important` — que tampoco «ganaba», porque no
había ninguna pelea que ganar.

**Y la firma que lo identifica es lo que vale**, porque es lo que habría
ahorrado las cuatro:

> **Dos propiedades «perdidas» y el resto puestas es una transición, no una
> cascada.**

Una cascada perdida se lleva la declaración entera: si otra regla gana, gana con
todo lo que declara. Cuando `outline-width`, `outline-style`, `outline-offset` y
`border-radius` ya muestran los valores nuevos y sólo `outline-color` y
`box-shadow` muestran los viejos, la lista de las dos «perdidas» es exactamente
la lista del `transition`. Eso la especificidad no lo puede producir.

Y hay una señal de segundo orden que apunta al mismo lado: **`!important` que no
cambia nada no es una cascada difícil, es que no hay cascada.** Si la
declaración más fuerte del lenguaje no mueve el valor, el valor no lo está
decidiendo el cascade.

Las reglas operativas: **al medir un estilo que se anima, esperar más que la
duración de la transición antes de leer**; y si aparece la firma —un
subconjunto de propiedades que no cambia— **mirar el `transition` de la regla
antes de buscar quién la pisa**.
## Dos estados que hoy dan el mismo número

El doceavo es una medición correcta sobre el instante equivocado. Éste es sobre
el **momento del que se lee la consecuencia**, y es más difícil de ver porque la
medición puede estar perfecta y el número ser el correcto.

En RV15 había que hacer que «Confirm as reviewed» escribiera una fila. Lo obvio
—y lo que el pedido decía— era repetir los números que ya estaban: *una fila
igual*. Medido, no había ninguno: `outlook.person_budget_total` estaba en **cero
filas** y `growth_rule` tenía **190**, así que toda persona proyectaba por
regla. El único número disponible era el que proyecta la regla, y fijarlo
transfiere el gobierno de la proyección —«`person_budget_total` manda cuando
existe, la regla cuando no»— con un botón que dice «lo revisé».

Y acá está la trampa: **fijar hoy el número que proyecta la regla no cambia el
número de hoy.** Los dos gobiernos dan exactamente el mismo valor en el
instante en que se escribe. Difieren después, cuando el benchmark se mueva y uno
lo siga y el otro no.

> **Dos estados que hoy dan el mismo número no se distinguen midiendo el número
> de hoy.**

Así que la sonda que comparaba la proyección antes y después habría dado
**verde sobre un gobierno transferido**, y con toda razón: el número no cambió.

Lo que sí los distingue es de **dónde sale** el número, y eso la pantalla lo
dice: el aviso de gobierno se calcula con lo que el lector considera vigente
(`person.budgetTotal[m] === undefined`). Comparar ese texto antes y después
mide el estado, no su valor de hoy.

Las dos reglas operativas:

- **Cuando dos estados difieren en el futuro, medir el estado y no su
  consecuencia de hoy.** Casi siempre hay algo en la pantalla que ya nombra el
  estado, porque a alguien le hizo falta explicárselo al usuario.
- **Y un control que ejerza la otra rama**, o «no cambió» no dice nada: con una
  fila que sí gobierna, el aviso pasó de «Every month» a «Nov, Dec». Sin eso,
  «el aviso no cambió» no distingue «la confirmación no gobierna» de «este
  aviso nunca cambia». Es la misma sospecha que la sección del respaldo que
  nunca se ejerció, aplicada a una aserción.

### La tercera de la familia: un rectángulo que se cruza no es un botón tapado

Misma forma, otro número. En RV17 reporté que el panel de la revisión tapaba el
botón de guardar del modal de `Set budget`, y lo medí como **cruce de los
rectángulos** del panel y del botón: 1680px².

Estaba arreglado desde antes. La corrección urgente de OL26g había subido
`.bp-modal-backdrop` a `z-index: 130` para que el modal quede arriba de la
máscara mientras está abierto, y ese arreglo **no mueve nada de lugar**: cambia
el apilado. Así que el cruce de rectángulos es **1680px² antes y 1680px²
después**.

> **Un rectángulo que se cruza no es un botón tapado.**

Es la tercera de la familia, y la que la nombra mejor: un número que no cambia
entre el defecto y el arreglo **no puede distinguirlos**, y leerlo como
confirmación del defecto es afirmar lo contrario de la verdad.

Lo que contesta la pregunta es **quién pinta en ese punto**:

```js
const b = btn.getBoundingClientRect();
const en = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
en === btn || btn.contains(en)   // true = está arriba y se puede clickear
```

Cuarta vez que «está en el DOM y no se puede usar» se resuelve preguntando quién
pinta ahí --antes en OL23 y en el panel del catálogo--. Y algo que explica por
qué se redescubre: **`elementFromPoint` no aparece ni una vez en el repo**; las
tres veces anteriores vivió en una sonda de scratchpad, que se muere con la
sesión. Por eso está acá.

Y el corolario que vale para cualquier defecto de apilado: **la geometría no
distingue el z-index.** Si la pregunta es «¿se ve?» o «¿se puede clickear?», la
medición es el punto, no el rectángulo — y la captura, que fue la que mostró el
botón entero con el panel atenuado detrás.

## Y en la misma sonda: una comparación entre dos ausencias da verde

La primera versión de esa sonda comparaba la fila de la persona en la tabla del
branch, leída con `[data-rv-lo="16"]`. La fila **no estaba en el DOM**: hay una
asignación de coaching activa sobre otra persona y el foco filtra el roster, así
que el grupo se abre con una sola fila explicativa y ninguna de LO.

Las dos lecturas devolvieron `null`, y la comparación —`JSON.stringify(antes)
=== JSON.stringify(después)`— dio **OK**. Segunda vez en la serie que una
comparación entre dos ausencias sale verde.

Lo que hace este caso peor que la tautología del `||` es que el arnés **ya
tenía la aserción del ancla, y estaba en rojo**. El resumen dijo `1 FALLAS de
11`, que se lee como «diez bien y una rota». Pero la que estaba rota era el
ancla de otra, así que:

> **Una aserción en rojo invalida a todas las que dependen de su ancla, no sólo
> a sí misma.**

Las reglas operativas:

- **Comparar dos lecturas exige afirmar primero que cada una encontró algo.** No
  `a === b`, sino `a !== null && a === b`.
- Y al leer un resumen con fallas, **mirar de qué depende cada aserción antes de
  creerle a las verdes**. Un contador no sabe que dos aserciones estaban
  encadenadas.

## El peor de la familia: la medición que concluyó lo contrario de la verdad

Los otros casos terminan en «no medí» o en «medí mal y no vi el bug». Éste
terminó en **«medí y está roto»**, sobre algo que estaba bien. Es peor porque
una conclusión falsa se actúa, y una duda no.

Al comprobar tres `check` recién aplicados, probé con `where funnel_key = 1`.
Las claves reales de esa tabla son 13..21. Los seis `UPDATE` tocaron **cero
filas**, PostgREST contestó `204` sin error, y los `check` **nunca se
evaluaron**. Reporté que ninguna de las tres restricciones rechazaba nada.
Existían las tres, validadas, y funcionaban.

> **Un `UPDATE` que no matchea nada se parece a uno que funcionó.**

Es «cero filas con `error: null` es una policy de RLS que no aplica» corrido a
la escritura, y por eso conviene tener las dos juntas: en la lectura la
ausencia se disfraza de tabla vacía; en la escritura, de éxito.

Y hay una vuelta que lo cierra: **el mismo error estaba en el SQL que ya se
había aplicado**, en su propia sección de «cómo comprobarlo», con la misma
clave inventada. Lo escribí yo y lo leyó el usuario, y ninguno de los dos lo
vio. Una clave escrita a mano en una prueba es indistinguible de una correcta
hasta que se cuenta lo que tocó.

### Las dos reglas operativas

- **Un `update` de verificación sin `returning` no verifica.** El `returning`
  convierte «no pasó nada» en una lista vacía, que sí se ve. Lo mismo del lado
  del cliente: `Prefer: return=representation` y contar las filas.
- **No inventar la clave.** `where funnel_key = (select min(funnel_key) from …)`
  o leerla antes. Una constante escrita a mano en una prueba es una suposición
  sobre los datos disfrazada de dato.

Y la guarda barata, que es la que faltaba: antes de las aserciones, **una sonda
que confirme que la escritura de prueba alcanza una fila**. Si esa no pasa,
todo lo de abajo mide el vacío.

## La familia entera: la operación tuvo éxito sobre el objeto equivocado

El caso de arriba no está solo. Ya van **seis**, y conviene tenerlos juntos
porque de lejos parecen seis errores distintos y son uno:

| la operación | el objeto equivocado | cómo se leyó el resultado |
|---|---|---|
| `update` sin `returning` | `where funnel_key = 1`, y las claves eran 13..21 | «los tres `check` no rechazan nada» |
| `cmd /c rmdir` | dijo que sí y no borró el enlace | «la junction ya no está» |
| `git diff` | contra la punta de la rama, no contra el `merge-base` | «ese cambio no está en la rama» |
| lectura de un roster | una clave de persona que no existe | «el editor no abre» |
| `git merge <rama>` | la ref **local**, vieja desde el rebase | «el rebase no sirvió» |
| `npx tsc` después de un `checkout` | la ref **local**, vieja desde el push propio | «el merge quedó limpio» |

En los seis el comando **salió bien**. Nada falló, nada avisó. Lo que estaba
mal era a qué se le aplicó, y el resultado siempre se pudo leer como un
diagnóstico sobre el código.

**Y el sexto cierra la vuelta del quinto**, porque es la misma ref local vieja
por la causa contraria. En el quinto la envejeció **un rebase ajeno**; en el
sexto, **un push propio**:

```
git push origin HEAD:main     # mueve la rama en el REMOTO
git rev-parse --short main    # 13752e7   <- la local no se movió
git checkout main             # deja el árbol en el código anterior
npx tsc --noEmit              # 0 errores... sobre lo que había antes del merge
```

Un `push HEAD:<rama>` mueve la rama del remoto y **deja la ref local atrás**,
así que cualquier verificación posterior a ese push --un `tsc`, una sonda, una
lectura de archivo-- corre sobre el código anterior. Y da verde, porque ese
código también estaba bien.

> **Después de un `push HEAD:<rama>`, la ref local es la vieja. Adelantarla
> antes de verificar: `git merge --ff-only origin/<rama>`.**

Lo que lo delató fue el hash impreso al lado del nombre de la rama, y no el
resultado: `git rev-parse --short HEAD` decía `13752e7` cuando lo mergeado era
`270e20d`. **Imprimir el hash junto a cada verificación** es lo que hace que
esto se vea sin buscarlo.

> **Una operación exitosa sobre el objeto equivocado no se distingue de una
> fallida sobre el correcto — salvo por el mecanismo.**

Y el quinto es el más caro de los cinco, no por el tiempo sino por a quién
manda a trabajar: «el rebase no sirvió» habría mandado a otra persona a rehacer
un rebase que estaba perfecto. Un diagnóstico falso sobre trabajo ajeno cuesta
el doble.

### El diagnóstico falso sobre trabajo ajeno, que ya casi pasó dos veces

Y es la parte que no es sobre medir. En una sola serie de trabajo estuvo a
punto de salir dos veces, **desde los dos lados**, y los dos casos son
distintos — y una tercera vez SALIÓ, la de RV17: reporté como pendiente un
defecto que OL26g ya había arreglado, midiendo sobre una base anterior a su
merge. La regla que sale de ésa está arriba, en las operativas: antes de
reportar algo de otra rama, traer `main`.

| | de dónde salió | qué decía |
|---|---|---|
| el del rebase | **desde el código** — una medición sobre el objeto equivocado | «el rebase no sirvió» |
| el de B | **desde afuera** — un reporte que le llegó y no era suyo | que había borrado un plan que no borró |
| el del modal | **desde una base vieja** — la medición era correcta sobre un árbol que no tenía el arreglo | «el panel tapa el botón de guardar» |

Los dos **viajan igual**, y ahí está el problema: del otro lado no se
distinguen de un reporte real. Quien lo recibe no tiene el objeto que se midió
ni la sesión donde se midió; tiene una frase que suena a hallazgo.

Pero el segundo agrega algo que el primero no tiene, y es lo que hay que
copiar. **B lo resolvió pidiendo que se confirmara antes de actuar.** Si
hubiera aceptado la acusación habría hecho las dos cosas peores a la vez:
«arreglar» algo que estaba bien, y perder tiempo defendiéndose de algo que no
hizo.

> **Cuando un reporte de un problema no coincide con lo que uno hizo, pedir que
> se confirme antes de actuar es más rápido que investigar el problema.**

No es desconfianza y no es demorar: es el mismo movimiento que el resto de esta
nota, del lado de quien recibe. El emisor contrasta el resultado con el
mecanismo; el receptor contrasta el reporte con lo que efectivamente tocó. Si
no coinciden, uno de los dos está midiendo otra cosa, y averiguar cuál cuesta
una pregunta.

Y del lado del que reporta, la obligación es la simétrica: **decir sobre qué
objeto se midió** --qué rama, qué clave, qué archivo, qué sesión-- para que la
pregunta se pueda contestar sin repetir el trabajo.

Lo que lo delató, las cinco veces, fue lo mismo — y es la regla de la sección
del `3×`, en la dirección contraria:

> **Cuando el resultado no se explica por el mecanismo, tenía razón el
> mecanismo.**

Una rama que ya contiene `main` **no puede** conflictuar con `main`. Tres
conflictos y 58 errores de `tsc` no eran un dato sobre el rebase: eran la
prueba de que eso no era la rama rebasada.

### Las reglas operativas, una por caso

- **Nombrar el objeto leyéndolo, no recordándolo.** Claves, ids y códigos de
  branch salen de una consulta.
- **Después de un `rebase --force-with-lease` hecho en otra máquina, la ref
  local está vieja por definición.** Se mergea `origin/<rama>`, nunca
  `<rama>` — y si hay duda, `git log --oneline -1` de las dos antes de tocar.
- **Y después de un `push HEAD:<rama>` propio, también.** `git merge --ff-only
  origin/<rama>` antes de verificar, y el hash impreso al lado de cada
  medición: una ref local vieja no se distingue de una al día, salvo por el
  hash.
- **Comparar contra el `merge-base`**, no contra la punta.
- **Y pedirle a la operación que diga cuánto tocó**: `returning`, `Prefer:
  return=representation`, `Test-Path` después del `rmdir`. Un cero explícito se
  ve; un éxito silencioso no.
- **Y la verificación va en OTRA sentencia.** Pedí los conteos junto al `delete`
  en una sentencia con CTE --`with r as (delete … returning …) select (select
  count(*) from review.session) …`-- y me dio `1` sobre una tabla que quedaba en
  `0`: los `select` de la misma sentencia ven el snapshot **anterior**, porque
  los efectos de un CTE que modifica no son visibles al resto de su propia
  sentencia. Es la misma familia que el `UPDATE` sin `returning`: la operación
  salió bien y el número que la acompaña habla de otro momento.
- **Antes de reportar algo de otra rama, traer `main`.** Reporté como pendiente
  un defecto que OL26g ya había arreglado, porque la medición corrió sobre una
  base anterior a ese merge. Lo que se mide sobre una base vieja se reporta como
  abierto aunque esté resuelto — y es la mitad de la sección de abajo que
  faltaba escrita: no alcanza con no acusar, hay que medir sobre lo que la otra
  persona ya entregó.

## Un párrafo roto en columnas dice lo mismo que uno bien armado

Segunda vez con el mismo defecto, y las dos veces con las aserciones de texto
en verde.

Un contenedor `display: flex` con prosa como hijo directo convierte **cada nodo
de texto y cada `<strong>` en un ítem flex**. La frase sale partida en columnas
con huecos, ilegible. Pasó en `.rv-panel__gate` --un `<strong>` en dos
columnas-- y volvió a pasar en `.bp-video-hint--warn`, donde la frase quedó en
cinco.

Lo que lo hace repetible es que **`innerText` no cambia**: una frase partida en
cinco columnas devuelve exactamente el mismo texto que una bien armada. Ninguna
aserción sobre el contenido lo puede ver.

> **Medirlo por geometría es lo único que lo distingue.**

En concreto: contar los **hijos directos** del contenedor flex --tienen que ser
los que uno puso a propósito, no los que quedaron sueltos-- y comprobar que los
`<strong>` caen **dentro del ancho** del envoltorio y no al lado.

La regla al escribir: **un contenedor flex no lleva prosa como hijo directo.**
O la prosa va envuelta en un `<span>`, o el contenedor no es flex. Y las dos
veces lo encontró la captura, no la medición.

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
- Y su complemento, que apunta a otro lado: **un `403 permission denied for
  table X` no es RLS, es un `GRANT` que falta.** Las policies deciden QUÉ FILAS;
  el grant decide si se puede tocar la tabla. Los dos fallos son distinguibles,
  y conviene: cero filas manda a mirar las policies, un 403 manda a mirar los
  grants.

  Un `create table` nuevo **no hereda** el grant del esquema. Y es fácil
  escribir las políticas y olvidarlo, porque las políticas son lo que uno está
  pensando: `business_plan.area` quedó como la única de nueve tablas sin grant,
  y eso rompió una pantalla que ni la menciona — un trigger `security invoker`
  la leía, así que asignar un área devolvía 403.

## Una ausencia medida en el árbol equivocado, reportada como hallazgo

Reporté dos cosas en RV15, las dos con la forma de un hallazgo y las dos
**falsas**:

| lo que reporté | lo que era |
|---|---|
| «`sqlFile` apunta a `docs/sql/2026-09-outlook-budget-composition.sql`, que no está en el repo» | está en `main`, con las dos tablas, sus policies y sus índices |
| «no hay ningún índice único, dos escrituras concurrentes pueden compartir `revision`» | hay uno: `unique (employee_key, revision, target_month) where employee_key is not null` |

**La primera: `ls` y `grep` corrieron en el worktree equivocado.** El directorio
principal de la sesión está en `feat/outlook-realtor-code`, una rama anterior a
los ocho merges, y ahí `docs/sql/` tiene 30 archivos. En `main` tiene 43, y el
que buscaba es uno de los 13 que faltan. La rama del checkout contestó por el
repo.

Es la misma lección que «una clase es huérfana en un árbol y no en otro», en la
dirección de la ausencia — y por eso duele: ya estaba escrita, con dos worktrees
vivos, en esta misma serie.

> **Un `ls` contesta sobre el checkout, no sobre el repo.**

**La segunda: `pg_constraint` no ve un `create unique index`.** Pedí los
`constraint` de la tabla, vi seis y ninguno único, y concluí que no había
unicidad. Los índices únicos que no nacen de un `constraint` viven en
`pg_indexes`, y estaban los cuatro.

> **Un catálogo que no lista algo no dice que no exista: dice que eso no vive
> ahí.**

**Y la señal que no leí, que estaba en la salida.** Antes del `ls` corrí
`grep -rln "person_budget_total" --include=*.sql .` y no devolvió **nada**, en
un repo cuyas tablas se crean con archivos de SQL versionados. Cero menciones no
se explica por el mecanismo, y esa regla ya está arriba: cuando el resultado no
se explica por el mecanismo, tenía razón el mecanismo. Lo leí como «no está
versionado» en vez de «estoy mirando donde no está».

Las reglas operativas:

- **Un hecho sobre el repo se mide contra una rama, nombrándola**:
  `git cat-file -e main:<ruta>`, `git grep <patrón> main`, `git ls-tree`. Con
  dos worktrees en ramas distintas, el `cwd` del shell no puede decidir la
  respuesta.
- **Para el catálogo de Postgres, `pg_constraint` y `pg_indexes` contestan cosas
  distintas.** Un `check` y un `not null` están en el primero; un `create unique
  index` sólo en el segundo.
- Y la que salvó el reporte, que vale más que las dos: **verificar los números
  propios antes de escribirlos**. Esto se cayó al comprobar un «31 archivos» que
  yo mismo había puesto en la nota — el número obligó a medir de nuevo, y la
  medición trajo el archivo que supuestamente no existía. Un número escrito es
  una aserción que se puede correr; una afirmación en prosa, no.

⚠ Y el costo: el usuario aceptó el hallazgo falso y pidió anotarlo. Es la misma
forma que la nota del `service_role` del turno anterior --una conclusión falsa
sobre nuestro propio registro, aceptada-- y van dos turnos seguidos. Un
diagnóstico falso sobre trabajo ajeno cuesta el doble; uno sobre el propio
registro cuesta la confianza en el registro.

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
- **Y después de arreglarlo, como el PROPIO.** Es la mitad que falta y se olvida
  porque el hallazgo ya se siente cerrado. La máscara de la revisión se prendía
  con la sesión en curso de otra persona; el arreglo fue filtrar por «soy el
  revisor», y **un filtro de más le apaga la barra justo a quien sí la
  necesita** — que era la persona a punto de recorrer el flujo. Las nueve
  aserciones del caso ajeno daban verde con la pantalla del propio en blanco:
  «ya no la ve el que no debe» y «no la ve nadie» se miden igual.
- **Al menos una verificación por pantalla tiene que salir del OBJETIVO y no de
  la implementación.** No «el desplegable ofrece los estados permitidos» sino
  «¿alguien puede registrar que esto se hizo?». La primera se contesta leyendo
  el código; la segunda, sólo usándolo.

Y el corolario que duele: el número que lo delató —69 de 75— se podía haber
calculado en cualquier momento con una consulta de treinta segundos. No hacía
falta descubrirlo, hacía falta preguntarlo.

## Ocho de estas lecciones son código, no nota

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
| `exigirAusente` | comprobar una ausencia sobre el archivo y no sobre el código | **6** |
| `exigirDefinidos` | probar una mitad de un contrato cuya otra mitad no existe | **3** |
| `estados-ambiguos` | reescribir el valor «no lo sé» de un estado de tres | **1**, con 3 personas trabadas |

**Por qué están en el repo y no en el scratchpad de una sesión:** una guarda que
se muere con la sesión es *peor* que una nota acá, porque la nota al menos
sobrevive para que alguien la lea.

Y sus propias pruebas verifican que **atrapen**, no que pasen —
`guardas.test.mjs` y `guardas.browser.test.mjs` construyen el error que cada una
existe para detectar. Escribiendo esa prueba apareció una aserción mía que era
una **tautología**: `!a.includes(b) || a.length === 3`, cuyo segundo término
siempre era cierto. Una aserción que no puede fallar es peor que ninguna, porque
ocupa el lugar de una que sí mide.

Pasó **dos veces**, y las dos escribiendo la prueba de otra cosa. La segunda fue
`/is-current/.test(...) || st.some((x) => x.punto !== null && !/is-current|is-done/.test(x.clases))`,
para verificar que un punto de “trabado” convive con el contorno de estado del
botón: el segundo término se cumplía solo, porque un nodo trabado y sin estado
siempre hay. Las dos veces la forma fue la misma, y es buscable:

> **Un OR en una aserción es una pregunta sin contestar; se contesta armando el
> estado, no ampliando la condición.**

Un `||` se escribe cuando no se sabe cuál de los dos casos va a venir — y esa
incertidumbre es justo la señal de que hay que **construir** el caso. La versión
válida eligió el nodo trabado para que quedara en curso y completó su step con
el antecesor sin terminar: el botón quedó `is-done is-current` con el punto
puesto, que es lo que un cuarto estado no podría representar. Así la prueba
justifica la decisión de diseño además de verificarla.

### Y el mínimo de aserciones cazó el caso que más importa: la segunda corrida

> **El estado que deja una medición es entrada de la siguiente.**
>
> Una sonda que corre dos veces no mide lo mismo la segunda vez: la primera
> dejó una respuesta, un cursor movido, una fila. Y el resultado distinto se
> lee como que el código cambió entre las dos corridas.

El caso: en RV16 la misma sonda corrió dos veces sobre el paso 2.1 --con las
flechas y sin ellas-- y lo único que tenía que cambiar era el dato. La corrida
`sin` **no encontró el campo de comentario**, porque la corrida `con` ya había
contestado el paso y el panel salió en modo «contestado», que no dibuja el
campo.

Lo cortó el mínimo de `crearArnes`: dijo **`RESUMEN INVALIDO, 4 de 6`** en vez
de verde. Sin esa guarda las cuatro primeras aserciones --las que miran que no
haya flecha, texto ni OK-- habrían dado verde midiendo un panel en un modo que
no era el de la prueba, y el informe habría dicho «sin `arrows` no queda nada»
con la mitad de la evidencia.

Y es el caso que la guarda del mínimo vino a cubrir, no un caso raro: **una
segunda corrida sobre un estado que dejó la primera.**

La regla operativa, y las dos mitades sirven:

- **o la sonda limpia lo que escribe antes de terminar**, y entonces empieza
  igual siempre;
- **o declara qué estado necesita encontrar** y falla ruidosamente si no está.

Lo que no sirve es suponer que empieza limpia.

## Y la sexta, que es sobre por qué no basta con saberlo

`exigirAusente` mordió **seis veces en una sola serie**, y las seis del mismo
modo: una guarda mía buscaba un nombre prohibido sobre el ARCHIVO y lo
encontraba **en el comentario que explica por qué está prohibido**. Las seis
veces el archivo estaba bien y la guarda dijo que no.

> **Una guarda que comprueba una AUSENCIA tiene que mirar el código, no el
> archivo: los comentarios son justamente donde el nombre prohibido aparece a
> propósito.**

Pero la parte que la hace distinta de las nueve lecciones anteriores es otra:
**el helper existía escrito desde la tercera vez**, en el scratchpad, y no lo
agarré hasta la sexta. No faltó saber algo. Saberlo no bastó.

> **Una herramienta que hay que recordar que existe se usa igual que una nota.**

De ahí que esté en `guardas.mjs` y no en un scratchpad: al lado de las otras
cinco, que es donde se la va a agarrar. Y si el patrón se repite igual, la
respuesta no es otra nota tampoco -- es que la comprobación corra sola, en el
lint o en un `pretest`, sin que nadie tenga que acordarse.

Y hay un primo más chico del mismo error, que apareció cuatro veces en el mismo
turno: **retipear de memoria la cadena que se va a buscar**, en vez de leerla
del archivo. El import de un test, un `MINIMO` que era 14 y no 17, un `.message`
sobre algo que ya era una cadena, y un `**negrita**` que en el archivo era un
`##`. Las cuatro las atrapó el `assert` --que para eso está-- pero las cuatro
eran evitables leyendo tres líneas.

## Y la séptima: probar una mitad de un contrato

Las siete de la tabla grande son mediciones que midieron mal. La del arnés es
una que no midió. La del desplegable es una que **nadie escribió**. Ésta es de
otra familia: la prueba **estaba, era correcta, y no podía ver el problema.**

El paso 4 de la revisión no se podía cerrar. Pedía abrir dos números de la
pantalla, y el panel los contaba escuchando los clics sobre cualquier elemento
con `data-review-click`. **Ese atributo no estaba escrito en ningún elemento de
la app** — cero en todo el árbol. El paso era insatisfacible POR CONSTRUCCIÓN:
no existía forma de cerrarlo, nunca, para nadie.

Y las 38 aserciones de las compuertas estaban en verde. No estaban mal: probában
**la lógica** — que con los dos clics abre, que con uno pide el que falta, que un
`gate_kind` desconocido cae en el caso seguro. Ninguna preguntaba si existía algo
capaz de disparar el primer clic.

> **Un contrato tiene dos mitades. Cada mitad puede estar bien y no conocerse.**
> Probar una no dice nada de que la otra exista.

El mismo mecanismo, en chico, dio otros dos: `bp-hint` con siete usos y ninguna
regla de CSS, y `rv-intake__body` — que lo encontró este chequeo en su primera
corrida. En los tres casos las dos mitades eran correctas por separado y nadie
comprobaba que se conocieran.

Y es primo de la tautología y del OR sin contestar, pero **un nivel más arriba**:
ahí la aserción no podía fallar; acá la aserción sí podía fallar, y medía una
mitad sola.

Las dos reglas operativas:

- **La quinta guarda pregunta «esto que defino, ¿pisa algo?»; la séptima pregunta
  lo contrario, «esto que pido, ¿existe?».** Hacen falta las dos, y la segunda
  se corre al revés de como se escribió: los nombres se leen del código que los
  usa y se buscan donde deberían estar definidos.
- **Y cuando el contrato cruza a otro módulo, que el producto lo diga.** El panel
  ahora avisa en pantalla si un paso pide un clic cuya marca no está, con los
  identificadores y aclarando que es un error de cableado y no algo que la
  persona hizo. Sin eso, el próximo paso mal cableado vuelve a parecer que
  alguien no abrió el número.

**Las otras cuatro se quedan como nota, y por buenas razones.** El timeout corto
no tiene un número correcto general — depende de la ruta. La columna equivocada
del Excel se evita leyendo por nombre, que es una convención y no una función. Y
la estimación propia usada como medición es un error de criterio: ninguna guarda
impide que alguien confíe en su propio cálculo.

## Y cómo se escribe el predicado: la forma del texto no es su significado

Las guardas de arriba dicen QUÉ preguntar. Esta sección es sobre CÓMO se escribe
la pregunta, y sale de cuatro intentos fallidos en una sola tarea — un renombre
de rótulo que parecía mecánico.

Cada vez que hubo que separar «texto que alguien lee» de «identificador», escribí
una regla sobre cómo se ve la línea, y cada vez falló:

| la regla que escribí | lo que se llevó puesto |
|---|---|
| «es texto si la línea tiene una cadena» | contó los `import` como texto visible |
| «no es texto si la línea tiene `className=`» | descartó **la línea del rótulo**, que es la única que había que cambiar |
| «es texto si está entre `>` y `<`» | no vio `Coach progress`, que va en su propia línea porque la etiqueta abre arriba |
| «es identificador si `Coach` toca otra letra» | marcó `Coaching`, que es el nombre de un área del Business Plan |

Las cuatro son la misma forma, y el usuario la nombró:

> **Una regla sobre la FORMA del texto en vez de sobre su SIGNIFICADO.**

«Está entre estos caracteres», «la línea contiene esta otra cosa», «empieza
así»: todas describen cómo se ve, y ninguna dice qué ES. La pregunta que hay
que contestar no es dónde está la cadena, es **qué papel cumple**: ¿es un
rótulo que alguien lee, o un nombre que el programa resuelve?

⚠ Y no es la primera vez: el usuario cuenta al menos una anterior de la misma
familia — el caso del `current_step` con la coma — que no está en este archivo.
Se anota la procedencia para que quien la busque sepa que existe y dónde
preguntar.

### Qué hacer en su lugar

- **Buscar la FRASE EXACTA, no el patrón.** El inventario del rótulo por
  heurística daba 374 líneas para clasificar; buscar `review mode` sobre el
  código sin comentarios dio **dos**, y una sola en código. Un inventario de dos
  líneas se decide a mano y no se equivoca; uno de 374 necesita una heurística, y
  la heurística es el problema.
- **Cuando haga falta una regla de forma igual, que sea sobre el TOKEN y no
  sobre la posición.** «`Coach` pegado a otro carácter de palabra» sobrevive a
  que la etiqueta abra en otra línea; «entre `>` y `<`» no.
- **Y la excepción se escribe como palabra exacta, nunca como prefijo.**
  `Coaching` se exime porque es esa palabra; `Coach` pegado a cualquier otra cosa
  — `CoachMode`, `coachKey`, `rv-coach` — sigue prohibido. Un prefijo exento
  habría dejado pasar justo lo que la guarda existe para atrapar.
- **Y una exención se justifica con evidencia, no con molestia.** `Coaching` se
  excluyó después de confirmar con `git show` que ya estaba dos commits antes del
  renombre. Eso es lo que distingue eximir algo de silenciarlo.

### Y la guarda también se escribe mal — dos formas nuevas, las dos en la etapa que las cazaba

La sección de arriba es sobre escribir el predicado. Estas dos son sobre
escribir **la guarda que lo comprueba**, y salen de haberla roto de dos maneras
distintas en la misma tarde, escribiéndola justamente contra estos errores.

**1. La misma trampa de la forma, cometida en la guarda contra la trampa de la
forma.** `verificar:coach` prohíbe que «coach» aparezca en una clase, y el
primer patrón fue `/className\s*=\s*[^\n]{0,200}?[Cc]oach/`: «lo que hay
después de `className` en la línea». Dio **dieciocho falsos**, todos de la
misma forma:

```
<h1 className="page-head__title">My coachees</h1>
```

La palabra está en el TEXTO, no en la clase. El patrón que sirve entra a las
comillas del atributo —`className\s*=\s*"[^"]*coach`— porque pregunta por el
valor y no por la vecindad. Es exactamente la lección de arriba, y no alcanzó
con haberla escrito: **una regla de posición se cuela también cuando uno está
escribiendo la regla contra las reglas de posición.**

**2. La guarda que marca el código ya arreglado.** `verificar:estados` prohíbe
el valor ambiguo de `lo`, y la primera versión prohibía el fragmento
`loanOfficers.find(...) ?? null`. Falló sobre el código **ya corregido**,
porque el arreglo contiene ese mismo fragmento: lo que colapsaba los dos
estados no era el `?? null` sino el `bpData?.` de adelante — con la población
en viaje devuelve `undefined`, y el `??` lo pasa a `null` como si se hubiera
leído. Sin la cadena opcional, ese `?? null` significa «se leyó y no está», que
es justo lo que se quiere.

> **Una guarda que no distingue el arreglo del defecto no sirve.**

Y de ahí la comprobación que corresponde, que es barata y no la hacía:
**probar la guarda con una violación inyectada.** Un archivo desechable con
`className="coach-panel" href="/coaching/1" data-coach-step="1"`, correrla, ver
que falla las tres, borrarlo. Una guarda que sólo se vio dar verde no está
probada — es el mismo agujero que el arnés que imprimía `SIN FALLAS` sin
ejecutar una aserción, un nivel más arriba.

### Y el inventario de lo visible sale del DOM, no del grep

La pregunta de un renombre de rótulos no es «¿dónde aparece la palabra?» sino
**«¿qué ve la persona que usa esto?»**, y el código no la contesta: `review`
aparece **381 veces** en el código sin comentarios de este repo, y casi todo es
`import`, tipos como `ReviewStep`, rutas, clases `rv-*`… y `preview`, que la
contiene adentro.

Lo que la contesta es levantar la app, recorrer las pantallas y recoger los
nodos de texto y los atributos que se leen —`title`, `aria-label`,
`placeholder`, `alt`—. Eso dio **diez cadenas** en cuatro pantallas, cada una
con su etiqueta y su clase para poder ir al código por la frase exacta. Diez se
deciden a mano; 381 piden una heurística, y la heurística es el problema.

Y sirve dos veces, porque el mismo volcado es la verificación del final:
después del cambio, cero texto visible con la palabra vieja salvo el que se
declaró que se quedaba.

⚠ Con una limitación que hay que decir: **el DOM sólo muestra lo que está en
pantalla en ese momento**. Los rótulos de la máscara en curso —`Finish
coaching`, `Close coaching`— no salieron en el volcado porque no había sesión
abierta, y se verificaron por conteo exacto sobre el código. Un inventario del
DOM no exime de recorrer los estados que el DOM todavía no dibujó.

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

> **Recorrerlo ES la prueba. Verificar que el caso nuevo aparezca no prueba
> nada del camino que abre.**

Y ya van **tres veces**, las tres con la misma forma — el código no cambió,
cambió el conjunto de entradas que lo alcanza:

| el caso nuevo | el camino que abrió |
|---|---|
| `Branch Out of Division` ganó fila | su link llevaba a `Branch%20Out%20of%20Division has no production` — faltaba `decodeURIComponent` desde siempre |
| dos nodos declararon el mismo antecesor | el cuarto nodo arrancaba encima del segundo, que todavía corría |
| `Review` entró al sidebar de Business Plan | la entrada **SALE** del módulo, y el sidebar lo monta el layout del módulo: `/review` quedó con cero `.bp-nav-item`, o sea sin menú para volver |

Las tres se veían bien en la lista, y las tres rompían una línea después. En la
tercera la fila del menú existía, decía `Review`, apuntaba a la ruta correcta y
quedaba resaltada — cuatro cosas ciertas, y al hacer clic el menú desaparecía.

La regla operativa afinada: la prueba de una entrada nueva **no es que esté**,
es **usarla y mirar dónde quedás**. Y si lo nuevo saca a alguien del contexto
donde vive el control, mirar también **cómo vuelve**.

## El hermano mayor: dos copias de la misma decisión

**Una copia no se extrae por cantidad de llamadores. Se extrae porque las dos
son la misma decisión.**

`rutaDelModulo` --a dónde manda cada módulo de una revisión-- estaba escrita dos
veces, con esta nota puesta a propósito:

> Duplicado a propósito: son dos momentos distintos --entrar y avanzar-- y
> compartirlo obligaría a un archivo más para tres líneas. **Si aparece un tercer
> llamador, se extrae.**

No apareció un tercer llamador. **Apareció un cambio.** Una etapa le enseñó a una
de las copias que Outlook tiene una pantalla por branch, y a la otra no. Desde
ahí, AVANZAR a la fase 2 llevaba al branch de la persona y RETOMAR la misma
revisión llevaba a la lista de los trece branches -- con el panel diciendo que
esa no era la pantalla del paso.

> **Las dos copias eran correctas cuando se escribieron. Lo que las separó fue
> editar una.**

Y por eso la condición de la nota vieja mira lo que no importa: **dos copias con
un solo llamador cada una divergen igual.** El disparador no es el tercer
llamador, es el primer `edit`.

Van **ocho** de esta familia en el proyecto, y la lista deja ver que el número de
llamadores nunca fue el problema:

| las dos copias | qué las separó |
|---|---|
| `rutaDelModulo` en el anfitrión y en la pantalla de arranque | una aprendió del branch de Outlook |
| el `insert` del benchmark en el perfil y en el paso 2 | el paso 2 necesitaba su propio manejo de error |
| tres `find` de «la sesión en curso» en el mismo componente | uno pasó a `myReviews` y los otros no |
| el conteo del avance guardado y derivado | se decidió derivarlo antes de que divergiera |
| `enrollmentsByFunnel` contado dos veces | BP40, misma decisión en dos lugares |
| `endsDay` sumado aparte de `nodeDayRanges` | idem |
| el branch de la persona, leído en el efecto y en la navegación | la navegación tenía que esperarlo |
| `.bp-pill` definida dos veces en el CSS | la segunda le ganó a la primera |
| el `z-index` del modal (`bp-visual.css`) y el de la máscara de la revisión (`review.css`) | RV4 subió la máscara sin saber que el modal dependía de estar por encima de ella |

La regla operativa: **al escribir la segunda copia de algo, la pregunta no es
cuántos la llaman, es si las dos tienen que decidir lo mismo.** Si la respuesta
es sí, se extrae ahora -- cuesta un archivo. Si es no, la nota tiene que decir
**qué las hace distintas**, no cuántos llamadores hay: así la próxima persona
puede comprobar si esa diferencia sigue siendo cierta.

Y el corolario, que es el que hace falta cuando ya hay dos: **al editar una
copia, la pregunta es si la otra necesita el mismo cambio.** Es la misma forma
que la clase de CSS redefinida --el daño no aparece donde escribiste, aparece
donde ya estaba-- y por eso este caso va justo antes.

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

### Y el reverso, que sólo aparece con dos ramas vivas

Lo de arriba dice cuándo un nombre YA está tomado. Esto es lo contrario:
cuándo un nombre dejó de estar usado — y la respuesta no está en el código.

El caso: resolviendo un merge, dos clases quedaron sin ningún consumidor,
porque la rama que se traía había borrado el único archivo que las usaba. La
conclusión parecía obvia --sin usos, se borran, es el caso `.bp-pill`-- y era
falsa. En `main` ese archivo seguía vivo y las usaba en dos líneas. Borrarlas
ahí habría deshecho un arreglo de dos etapas antes: el botón «Save» volvía a
caer en la fila del comentario de al lado, que es exactamente el bug que había
motivado ese arreglo.

> **Una clase es huérfana en un árbol y no en otro, y la respuesta depende de
> cuál se está mirando.**

Todo lo demás de esta nota supone UN árbol. Con dos ramas vivas, «no tiene
consumidores» deja de ser una propiedad del código y pasa a ser una propiedad
de la rama, y hay tres respuestas en vez de dos: sin usos en las dos --se
borra--, con usos en las dos --se queda--, y **sin usos en una y con usos en la
otra**, que es la que engaña.

La regla operativa: **antes de borrar algo por no tener usos, decir en qué
árbol se contó.** Y si el conteo salió de un árbol de merge --uno que todavía
no existe en ningún lado--, la baja no va en la rama de hoy: va **en el mismo
commit que borra al consumidor**, para que las dos cosas lleguen juntas o no
lleguen.

Vale para clases de CSS y para todo lo que se dé de baja por desuso: una
función exportada, un token, una columna. `git grep` contesta sobre el árbol
que está en el disco, y con varias ramas en vuelo ése es uno de varios.

# Lo que compensa una ausencia hace que la ausencia no se note

> Tercera sección aparte, y sale de haberlo visto **siete veces**. Un patrón se
> reconoce por repetición, no por descripción: por eso van los casos con nombre
> y no una definición general.

## La regla

**Cuando algo cae a un valor de respaldo, deja de haber señal de que el original
falta.** El respaldo no es el bug — es lo que hace que el bug espere.

Y de ahí lo que hay que mirar: **un respaldo que nunca se ejerció es sospechoso**.
O el original siempre estuvo, y el respaldo sobra; o el original nunca estuvo, y
lo que se está usando es el respaldo sin saberlo.

## Los siete casos

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

**4. `bp-hint`, una clase que no existía.** Siete usos en cuatro archivos, y la
regla no estaba definida en **ninguna** hoja del árbol. Nunca se vio: un párrafo
sin regla no queda invisible, hereda los 14px del documento y se lee igual — sin
el tamaño, el color ni el interlineado que le tocaban. Es el mecanismo del caso
2 con otro disfraz, y por eso va acá y no en una sección propia.

Lo que lo hizo durar: el comentario del layout **afirmaba** que la hoja del
Business Plan la traía. Una nota correcta sobre las otras tres clases de la
misma lista, falsa sobre la cuarta, y nadie vuelve a verificar una nota.

Y la vuelta operativa que sale de este caso, porque el `git grep` de la sección
anterior no lo agarra: ese grep pregunta **«esta clase ya existe?»** para no
pisarla, y éste pregunta lo contrario, **«las clases que escribo existen?»**. Se
leen del JSX y se buscan en las hojas — al revés de como se escribieron. Son dos
chequeos distintos sobre el mismo `grep`, y el segundo encontró un
`rv-intake__body` sin regla en la primera corrida.

**5. El estado inicial capturado antes de que el dato llegue.** El campo del
benchmark arrancaba en `''` porque el valor vivía en un `useState` que se
evaluaba antes de que el anfitrión lo leyera de la base -- y `''` es
exactamente lo que se ve cuando nadie fijó ninguno. Adriana tenía 1 desde el 21
de agosto y el campo decía que no había. Mismo mecanismo en el aviso LEJOS del
panel: mientras la sección del paso no había aparecido, `enSitio` era `false`,
o sea «esto se contesta en otra pantalla» dicho EN la pantalla correcta.

**6. `funnelActual` arrancando en `null`.** Y `null` es lo que significa «no
tiene funnel activo». Al atar el LUGAR del paso a ese estado --sin funnel el
paso se hace en el catálogo, con funnel se confirma en el perfil-- la primera
lectura mandaba al catálogo a quien ya tenía uno. Se arregló con el tercer
estado: `undefined` = todavía no se leyó.

**7. Y el mismo `funnelActual`, otra vez -- por un camino que lo REESCRIBE.** El
caso 6 arregló el valor inicial, y quedó esta línea en el efecto que lo lee:

```ts
if (loEnCurso === null) {
  setFunnelActual(null);   // «todavía no sé a quién se revisa»
  return;
}
```

`loEnCurso === null` significa que la lista de revisiones no llegó, y se
escribía con el mismo `null` que significa «no tiene funnel». Así que en CADA
carga la secuencia real era `undefined → null → valor`, y otro efecto leía ese
`null → valor` como «el funnel se acaba de activar»: en el catálogo sacaba a la
persona de la pantalla donde tenía que elegir, y en el perfil navegaba a la
pantalla donde ya estaba -- remontando el árbol y reiniciando la búsqueda en
bucle. Tres personas se trabaron en el mismo paso antes de que se viera.

## La línea que une a los siete

Los cuatro primeros se leen como problemas de RESPALDO: un fallback, una
herencia de CSS, una coerción a `''`. El quinto y el sexto no tienen respaldo
ninguno. Lo que comparten es otra cosa, y es la forma buscable:

> **Un valor que significa «no lo sé» indistinguible de uno que significa «no
> hay».**

De ahí que la respuesta sea siempre la misma y siempre cueste un estado más:
`undefined` contra `null`, `null` contra `0`, `NULL` contra array vacío,
`buscando` contra `enSitio === false`. Y de ahí también por qué duelen tanto:
el valor de «no lo sé» es el que está durante el primer cuadro de CADA carga,
así que el error aparece siempre y se ve una sola vez -- justo antes de que el
dato llegue y lo tape.

### Y lo que agrega el séptimo: no alcanza con el valor inicial

El caso 6 y el 7 son el MISMO estado, arreglado dos veces. La primera se le
cambió el valor inicial --`undefined` en vez de `null`-- y el defecto siguió
vivo, porque otro camino seguía escribiendo el `null` ambiguo. Un tercer estado
que se introduce en la declaración y no en las asignaciones no existe: cualquier
`set` que use el valor viejo lo reintroduce entero.

> **Un estado que significa «no lo sé» no se arregla en su valor inicial. Se
> arregla eliminando TODOS los lugares que pueden escribirlo.**

La regla operativa, y es un `grep` de treinta segundos: al darle un tercer
estado a algo, **buscar cada llamada a su `set` y decidir qué significa cada
una**. `git grep 'setFunnelActual('` daba tres sitios; dos eran lecturas reales
y el tercero era «todavía no sé» disfrazado de «no hay». Y después dejarlo
comprobable: una aserción sobre el código --sin comentarios-- de que el valor
ambiguo no se escribe en ninguna parte vale más que acordarse.

Es primo del caso de la clase de CSS redefinida, en la otra dirección: aquel
dice que el daño no aparece donde escribís, y éste que el arreglo no alcanza
donde escribís.

### El octavo y el noveno no están escritos acá: viven como guardas

El título dice siete porque siete se contaron a mano. Los dos siguientes se
arreglaron y se dejaron **comprobables** en vez de narrados, que es lo que esta
sección venía pidiendo:

- **el octavo** — `funnelActual` y `pasosDelPlan` publicados en momentos
  distintos desde una misma lectura, que dejó una evidencia con el nombre nuevo
  y la clave de un enrolamiento ya borrado;
- **el noveno** — `lo`, la persona de la población del módulo, con
  `bpData?.…find(…) ?? null`: la pantalla contestaba «This person is not in the
  Business Plan population… They need a branch assignment first» mientras la
  población todavía viajaba. Una afirmación sobre el roster, con instrucción
  accionable, dicha sin haber leído el roster.

Los dos están en `scripts/verificacion/estados-ambiguos.mjs`, con su motivo
escrito en la fila. Si hace falta la historia, está ahí; y si alguien la
reintroduce, no hace falta que alguien se acuerde.

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

# Ningún texto pasa por el shell, y ahora hay una guarda

> La regla vive en la nota global del usuario. Esto es su versión mecánica y el
> registro de por qué hizo falta: **cuatro veces en una sola serie de trabajo**,
> y las cuatro en comandos que parecían demasiado cortos para merecer un
> archivo.

## Lo que pasó las cuatro veces

Un backtick es sustitución de comandos. No falla: **reemplaza por vacío**. Un
mensaje de commit con cinco identificadores entre backticks quedó con cinco
huecos, y el único rastro fue un `command not found` que se lee como ruido.

Y no es sólo el heredoc: pasó con `git commit -m`, con `python - <<'X'` --dos
veces, las dos colgando el comando-- y con un `node -e "…"`. El común no es la
herramienta: es **texto viajando como argumento**.

## La guarda, y qué garantiza

    node scripts/commit.mjs <archivo-con-el-mensaje> [--amend]
    npm run commit -- <archivo>

Dos mecanismos:

1. el mensaje **no pasa por un shell** -- `execFile` con `-F archivo`, sin
   expansión, sin backticks, sin comillas que balancear;
2. después del commit **se lee el mensaje de vuelta** y se compara con el
   archivo, diciendo en qué línea difieren.

Detectar el daño por la FORMA del texto --un hueco donde iba un
identificador-- sería una regla sobre cómo se ve la línea, que es el error que
este archivo lleva documentado cuatro veces. Comparar contra la fuente no
depende de reconocer el daño.

⚠ **Y la comparación es sospechosa, dicho por su autor:** el mismo script
escribe y lee, así que no puede detectar el caso que le importa -- si el
mecanismo 1 funciona, nunca hay nada que comparar. Lo que previene el defecto
es el 1. El 2 es una guarda redundante para una causa que todavía no conocemos,
y su rama de fallo **nunca se ejerció**. Queda dicho así, porque por la regla
de este repo un respaldo que nunca se ejerció es exactamente lo que hay que
mirar con desconfianza.

## Y lo que ESA guarda no cubre: sólo mensajes de commit

`scripts/commit.mjs` cubre un caso, y lo cubre DESPUÉS de escribir. La regla
general es ésta:

> **Nada de `-e` ni de `-c` con texto. Nunca un heredoc. Si el texto tiene un
> backtick, un `$`, una comilla o un salto de línea, va a un archivo con la
> herramienta de escritura y se ejecuta el archivo.**

El umbral no es la longitud. Las cuatro veces el texto era corto -- por eso
pareció que no hacía falta.

## La QUINTA vez, y la guarda que frena la mano

Pasó una quinta vez: un `cat > archivo.mjs << 'XEOF'` en el mismo turno en que
se estaba escribiendo esta sección. No rompió nada --creó un archivo vacío que
después se reescribió con la herramienta-- pero el veredicto cierra el asunto:
**«ya no es que falte saberlo».**

Una regla que hay que acordarse funciona igual que una nota que nadie consulta.
Así que ahora hay una guarda que **bloquea el comando antes de que corra**:

    scripts/verificacion/sin-texto-al-shell.mjs        la lógica y el porqué
    scripts/verificacion/sin-texto-al-shell.test.mjs   31 aserciones
    npm run verificar:shell     corre la prueba
    npm run guarda:instalar     la engancha, y dice si la copia estaba vieja

Se engancha como hook `PreToolUse` de Bash: lee el comando por stdin y sale con
código 2 --que el agente lee como «no se ejecutó, y por qué»-- con el motivo y
qué hacer en su lugar. Verificado en vivo, no sólo con su prueba: un `node -e`
**rebotó antes de correr**.

| bloquea | por el caso que ya costó |
|---|---|
| heredoc y here-string | los backslashes, el segundo heredoc, los backticks que se ejecutan |
| `node -e`, `python -c`, `bash -c`, `powershell -Command` | el código como argumento, que es el mismo mecanismo con otra cara |
| `git commit -m` / `-am` | los cinco identificadores que se comió un mensaje |
| `gh pr create --body` | igual, y un cuerpo de PR casi siempre tiene backticks |
| `echo`/`printf` redirigido a un archivo | escribir un archivo con el shell de intermediario |
| `sed -i` con backtick, `$` o `\` | una sustitución que llega distinta, y que al no matchear **no falla** |

Y deja pasar lo que hay que dejar pasar, que es la mitad que decide si la guarda
sobrevive: `cmd //c` --la única vía para borrar una junction--, `git commit -F`,
`echo` sin redirección, `sed -n`, `grep -c`, los pipes y las sustituciones de
comandos. **Una guarda que bloquea todo es la que alguien desengancha**, y ahí
se pierde también lo que sí cubría; por eso su prueba tiene 17 casos de «esto
tiene que pasar» y no sólo los 14 de «esto tiene que frenar».

### ⚠ Vive en dos lugares, y eso es a propósito

`.gitignore` ignora `.claude/` --«config local del agente»-- y el hook lo lee el
agente desde `~/.claude`. Así que:

    el repo      es la fuente: la lógica, su prueba y el porqué
    ~/.claude    es la copia que corre, enganchada en `settings.json`

`npm run guarda:instalar` es lo que las mantiene de acuerdo, y **avisa si la
copia estaba distinta**: una copia vieja enganchada es peor que ninguna, porque
frena con reglas que ya no son las de la fuente. Es «dos copias de la misma
decisión» resuelto con un script en vez de con memoria.

Dos cosas más antes de tocarla:

- **Un cambio de hooks se toma al arrancar la sesión**, no en el momento --
  salvo el primer enganche, que fue lo que permitió medirla en la misma sesión.
- **Si no entiende su propia entrada, no bloquea**: el `catch` del JSON sale con
  0. Una guarda que rompe todos los comandos cuando cambia el formato del hook
  es peor que la falla que viene a evitar, porque la primera reacción de
  cualquiera sería desengancharla.

# Worktrees en Windows: la junction de `node_modules`

> Sección aparte porque no es sobre el código de este repo sino sobre el entorno
> donde se lo edita, y porque cualquiera que abra un worktree acá se va a topar
> con lo mismo.

## Por qué existe la junction

Un worktree de este repo no puede correr nada sin `node_modules`, y volver a
instalarlo por worktree cuesta minutos y gigas. La salida es un **enlace de
directorio** (junction) que apunta al `node_modules` del checkout principal:

```
C:\Users\...\rv9\node_modules  ->  C:\Users\...\homesi-reporte-actividad\node_modules
```

Y hay una segunda restricción del entorno, no del repo: **el worktree tiene que
vivir en una ruta corta** —`C:\Users\<usuario>\rv9` y no dentro del repo— o
Turbopack falla por largo de ruta.

## La regla

**Un `node_modules` que es junction se borra con `cmd /c rmdir`, nunca con
`rm -rf` ni con `Remove-Item -Recurse`.**

`rmdir` borra el enlace. Las otras dos **entran por el enlace** y borran el
`node_modules` del checkout principal, que es el entorno de trabajo de todos los
worktrees y del checkout real.

Y al desarmar un worktree, el orden es: sacar la junction, **confirmar que se
fue**, y sólo entonces borrar el directorio.

## El caso que la fija, y no es el que parece

Al desarmar el worktree de RV12, el `cmd /c rmdir` **salió con éxito y no borró
nada**. El `&& echo` de la línea imprimió su mensaje, así que la salida decía
que había funcionado.

Es la regla de siempre —que un comando salga con 0 no prueba que se aplicó— pero
lo que la hace grave acá es lo de después: el paso siguiente era borrar el
directorio, y **un `Remove-Item -Recurse` con la junction todavía puesta habría
entrado al `node_modules` del repo real**. El falso éxito no era el daño; era el
permiso para el daño.

Lo que lo delató no fue un error sino una forma: `git worktree remove --force`
dejó el directorio con **exactamente un hijo**, y ese hijo era la junction.

> **Git no atraviesa un reparse point.** Así que un worktree que queda con un
> solo hijo después de un `remove` está diciendo cuál es: el que git no pudo
> tocar.

Es el tipo de señal que sólo se lee si uno está mirando, y por eso no alcanza
con recordarla. Lo que corresponde es la verificación explícita:

```powershell
$p = "C:\Users\<usuario>\rv9\node_modules"
if (Test-Path $p) { cmd /c rmdir $p }
Test-Path $p            # tiene que dar False ANTES de borrar el directorio
```

Y después de borrar, confirmar el destino y no el origen: que el
`node_modules` del checkout principal sigue teniendo sus ~393 entradas. Es
redundante a propósito, igual que la guarda de las columnas sensibles: cuando un
paso puede destruir el entorno de trabajo, la comprobación va aunque «no haga
falta».

## El desarme completo, en orden

1. `git status` en el worktree y `git log` contra el remoto: que **nada viva sólo
   ahí**. Si hay commits sin subir, subirlos primero.
2. `cmd /c rmdir <worktree>\node_modules`, y `Test-Path` en falso.
3. `git worktree remove --force <worktree>` y `git worktree prune`.
4. Borrar lo que haya quedado del directorio, **después** de verificar que no
   queda ningún reparse point adentro.
5. `git worktree list` para confirmar que sólo está el checkout del usuario, y
   que su rama y su árbol quedaron sin tocar.

# `apportionByWeight` reparte una diferencia que no le pertenece

> Cuarta variante de un modo de falla que ya tenía tres casos en el código,
> todos de la misma familia pero con la forma invertida. OL11 (B2B sin
> presupuesto propio), OL12 (NPPM sin proyectar desde sus realtors) y OL22
> (reclutas sin peso) son los tres de "una fuente que FALTA en los pesos": un
> peso que falta se redistribuye en silencio entre los que sí están, y el
> síntoma es un residuo que crece sin que nada lo explique. Ésta es la
> inversa, y es más difícil de ver porque no falta nada en los pesos —sobra
> algo en el TOTAL que ningún peso explica.

## La regla

**Un total que cambia por una razón que el peso no conoce se reparte igual
que si todos los pesos hubieran cambiado.**

`apportionByWeight` no distingue "esta plata de más es de una persona
puntual" de "esta plata de más es genérica, repártanla entre todos" — un
total más grande siempre se ve como lo segundo.

## El caso que la fija

OL26e agregó una precedencia a Outlook: si una persona fija un presupuesto
para un mes, ese número gobierna en vez de su regla de crecimiento
(`projectBranch`, en `lib/outlook/loadData.ts`). El total del branch pasó a
incluir ese presupuesto fijo.

Pero `strategyRowsOf` (`lib/outlook/strategyRows.ts`) usa ESE MISMO total
como el número a repartir entre las estrategias del branch —
`apportionByWeight(branchYear.byMonth[m], exactoDe_de_cada_estrategia)`— y de
ahí en cascada cada estrategia reparte su parte entre sus personas
(`personBudgetsOf`). Los pesos de ese reparto son puro `growth_rule`, sin
tocar: no tenían por qué cambiar, porque nadie les fijó nada.

Verificado con un branch sintético (Gian fija 15 en vez de su regla —10—;
Galo no toca nada, regla 8, sin presupuesto propio; B2B es una estrategia sin
ninguna persona con presupuesto fijo):

| | antes del fix | después |
|---|---|---|
| fila de Galo | **10** | 8 |
| estrategia B2B | **7** | 6 |

La torta entera creció 5 —la diferencia entre el presupuesto de Gian y su
regla— y `apportionByWeight` la repartió proporcionalmente entre TODOS los
pesos, incluidos dos que no cambiaron nada: Galo y B2B.

> **El override es del total, no del peso.**

## Qué hacer

- Cuando un total que alimenta un `apportionByWeight` puede moverse por una
  razón que ALGUNOS de los pesos no reflejan —un override, un ajuste manual,
  una excepción puntual—, separar las dos cosas: un total para lo que se
  MUESTRA y un total distinto, sin ese override, para lo que se REPARTE.
  Nunca el mismo número para las dos si pueden divergir (acá,
  `projectBranch(branch, months, { applyBudgetOverrides })`).
- Verificarlo con un caso donde alguien SÍ cambia algo y otro que NO. Si el
  que no tocó nada se mueve, el total y el peso se están confundiendo.
- Y las aserciones que prueban el NÚMERO EXACTO de la fuga —no sólo que el
  fix "da bien" hoy— son las que evitan que alguien deshaga el parámetro
  después sin saber por qué estaba ahí. Sin ellas, el bug vuelve en silencio
  la próxima vez que alguien lo toque.

# Un agregado que cancela esconde que las partes están mal

> Familia reconocida por repetición, con nombre puesto por Isabella: el
> progreso promediado de dos planes, el forecast redondeado por branch, y
> ahora OL26f. Los tres tienen la misma forma: un número que resume varios
> se ve bien aunque las partes que lo componen NO estén bien, porque los
> errores tienen signo opuesto y se cancelan antes de llegar a la pantalla.

## La regla

**Un promedio, una suma neta o un redondeo por conjunto puede dar bien
aunque cada parte esté mal.** El agregado no es prueba de que las partes
estén bien -- sólo prueba que, sumadas con signo, dan un número chico.

## El caso que lo fija (OL26f)

`Set budget` mostraba una fila `Difference` por mes, pero el botón resumía
todos los meses en un solo número antes de decidir si avisar. La primera
versión sumó el NETO: enero +5 (falta) y febrero −5 (sobra) daban 0, y el
botón decía `Save budget`, sin avisar, con los dos meses mal.

> **El neto esconde exactamente el caso que hay que ver.**

La corrección: sumar el valor ABSOLUTO de cada mes, no el neto -- `Save with
a difference of 10`, no `Save budget`. Ver `pendingDifference()` en
`app/outlook/components/PersonBudgetEditor.tsx`.

## Qué hacer

- Antes de agregar varios números en uno para responder "¿está todo bien?",
  preguntarse si dos errores de signo opuesto podrían cancelarse en el
  camino. Si la respuesta es sí, el neto no sirve para esa pregunta.
- Cuando el objetivo es AVISAR (¿hay algo mal?), usar el valor absoluto, el
  máximo, o listar las partes -- nunca el neto. El neto sólo tiene sentido
  cuando la pregunta es "¿cuánto sobra o falta en total", no "¿algo está
  mal".

# El ancho de la página se mueve solo — tres veces, tres mecanismos

> Tercera vez en pocos días que una pantalla termina más ancha que su
> contenedor, sin que nadie haya tocado un `width` a mano. Van juntas porque
> el síntoma se repite -- una tabla o una tarjeta que de golpe necesita
> scroll horizontal, o columnas que dejan de alinear -- pero el MECANISMO no
> es el mismo las tres veces, y por eso el título no promete uno solo.

## Los tres casos

| caso | mecanismo | cómo se notó |
|---|---|---|
| La columna Position (OL26b, Outlook) | Una columna nueva con `min-width: 140px` en una tabla cuyo ancho ya sumaba exacto contra la página fija -- nadie sumó ese ancho al presupuesto, y la tabla pasó a necesitar scroll horizontal, cosa que no pasaba antes | Isabella, en pantalla |
| La columna fantasma (OL26c, Outlook) | Dos filas -- reconciliación y total -- tenían una celda `bp-center` vacía de más que el resto de las filas no tenía. El diff de anchos contra `main` ya daba cero: no era un ancho de más, era una CELDA de más | Isabella, en pantalla |
| La tarjeta de Performance summary (BP51, Business Plan) | `white-space: nowrap` sobre contenido de ancho variable (badges, un botón, una frase) pegado a una columna fija de 260px | Medido con Chromium real -- `scrollWidth` 1467 contra un viewport de 1440 -- antes de reportar, no después |

Ninguno de los tres tocaba un `width` fijo a propósito. El de Position
agregó un `min-width` que nadie sumó al ancho total. El de la columna
fantasma no tenía ningún ancho de más -- tenía una celda de más, que
desalineó todo lo que venía después en esas dos filas. Y éste no fijaba
ningún ancho: dejaba que el texto lo pidiera, sin techo.

## La regla de éste, que es la que vale escribir

**Un `white-space: nowrap` sobre contenido cuyo largo depende de los datos,
puesto dentro de una columna de ancho fijo, no recorta el texto -- lo
empuja.** `nowrap` no dice "no ocupes más lugar del que tenés": dice "no te
partas en dos líneas", y si no entra en una, el elemento crece más allá de
su contenedor. El navegador no avisa -- el elemento simplemente sale.

Acá pasó en `.bp-stat__value` (la fila de Starting benchmark, con su badge
de "provisional" y su enlace de "edit") y en `.bp-stat__flag` (el
"Forecast is below it" que colgaba de esa misma fila): los dos podían
crecer con los datos, los dos estaban fijados a una sola línea, y los dos
vivían dentro de una columna de 260px. Medido antes del arreglo, contra el
CSS real de esa etapa: `.bp-stats` entera con `scrollWidth` 348px contra
258px de `clientWidth`; la fila de Starting benchmark, 340 contra 242. La
página entera terminaba 27px más ancha que el viewport -- 1467 contra
1440 -- por una sola fila de una tarjeta.

> **Cualquier `nowrap` sobre algo que crece con los datos es un desborde
> esperando el dato largo.**

Ese día no rompía porque el dato de prueba era corto -- un badge, un
número de un dígito. El mismo CSS con una regla de crecimiento con nombre
más largo, o una segunda etiqueta, lo habría roto en cualquier carga
futura, sin que nadie tocara esa línea.

## Qué hacer

- **Antes de escribir `white-space: nowrap`, preguntarse si el contenido
  puede crecer con los datos** -- un badge condicional, una frase que
  cambia de largo según el estado, un número con más dígitos de los que
  hay en el caso que se está mirando. Si puede, `nowrap` no es una decisión
  de estilo: es una apuesta a que el dato largo nunca va a llegar.
- Si la fila tiene que quedarse de verdad en una sola línea -- un ancla, un
  ticker, una columna angosta a propósito -- **medir el peor caso de
  contenido, no el que está a la vista**, y dimensionar para ese peor caso
  en vez de confiar en que el texto se va a achicar solo.
- Verificar con `scrollWidth > clientWidth`, en el elemento Y en el
  documento entero: un elemento puede desbordar su propia fila sin que la
  fila desborde la tarjeta, pero cuando la tarjeta desborda, arrastra a la
  página con ella.

## Y las dos decisiones de método que valieron la pena

**Medir "antes" contra el CSS de antes, no contra el archivo ya editado.**
Con el CSS del módulo viviendo en un solo archivo, editarlo en el disco
borra el "antes": cualquier medición posterior del DOM viejo, hecha contra
ese mismo archivo, en realidad compara DOM viejo con CSS nuevo -- que no es
ni el estado real de antes ni el de después, y puede dar cualquier cosa por
casualidad. La salida fue simple: `git show HEAD:<ruta> > archivo-aparte`
antes de tocar el original, y apuntar la medición "antes" a esa copia. Es
la misma familia que "la operación tuvo éxito sobre el objeto equivocado" y
"una ausencia medida en el árbol equivocado" -- acá el objeto que cambiaba
de estado por debajo era el propio archivo contra el que se estaba
comparando.

**Medir en varios anchos, cruzando el breakpoint.** `.bp-q1-grid` pasa de
dos columnas a una a los 900px (`@media (max-width: 900px)`) -- un desborde
que sólo aparece apilado no lo ve nadie que mida sólo en desktop. Medido en
1440, 1280, 1024 y 800px: los cuatro sin desborde, con el apilado del
breakpoint incluido y no supuesto.
