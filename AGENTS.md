<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verificar antes de reportar

> Esta sección va FUERA del bloque de arriba a propósito: ese lo regenera una
> herramienta y se lleva lo que tenga dentro.

## La regla

**No reportes un fallo sin haberlo reproducido por otra vía.**

Sale de cuatro casos reales de esta base de código, en una sola serie de
trabajo. Las cuatro veces la herramienta de verificación dio un falso negativo
que se parecía a un bug del código:

| lo que la prueba dijo | lo que pasaba de verdad |
|---|---|
| «el subtítulo del mes no se renderiza» | un `<input type="month">` no tiene `innerText` |
| «mover el benchmark liberó 118px» | la estimación era mía; medido, la tabla quedó **más ancha** |
| «el forecast de Brokered no coincide» | mi script de comparación leía la columna equivocada del Excel |
| «julio no muestra el aviso de integridad» | mi timeout era de 3,5s y la ruta tardaba más |
| «la ventana de 12 meses aceleró la ruta 3×» | la ventana no descartaba **ni un** snapshot; los 7,9s eran el compile en frío |

Los cinco fallaron de modos **distintos**, así que no hay un chequeo general
que los cubra. Lo único que funcionó las cinco veces fue medir de nuevo por un
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
