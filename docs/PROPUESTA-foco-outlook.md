# Propuesta — cablear `focus.ts` en la vista del branch de Outlook

Etapa RV6, **sin construir**. `lib/review/focus.ts` está escrito y probado desde
RV1 (12 aserciones puras) y no está conectado a ninguna pantalla.

## La restricción que manda sobre todo lo demás

> **Enfocar no puede cambiar los números.**

La vista del branch muestra, para cada estrategia, el presupuesto del branch y
después las filas de cada persona. Si el foco se aplica en la fuente, los
números del branch cambian — y cambian **sin que nada falle**, que es la peor
forma.

Y no es sólo la fila de la suma. El caso grave está en el reparto:

```
app/outlook/branch/[code]/page.tsx:1413-1425
  const exactos = personas.map(...)                  // el presupuesto exacto de cada uno
  const enteros = apportionByWeight(total, exactos)  // el ENTERO de la estrategia, repartido
```

`apportionByWeight` reparte **el entero de la estrategia** en proporción al peso
de cada persona. Con `personas` filtrado a una, el entero completo cae en ella:
la pantalla mostraría a Adriana con el presupuesto de las ocho. Es el mismo
mecanismo que ya documentó este archivo cuando los pesos daban todos cero y el
entero se volcaba en Annie Garrido.

## Los sitios, uno por uno

`const personas = personasDe(bs)` está en la línea **1238**. Se mantiene
**completa** en todos los cálculos, y el foco se aplica sólo donde se emiten
filas.

| línea | qué hace | ¿enfocar? |
|---|---|---|
| **921** | `personasDe(bs).reduce(...)` → el benchmark de la estrategia | **No.** Es la suma del branch. |
| **1238** | la lista base | **No.** De acá salen las dos cosas. |
| **1241** | `personas.length + bs.recruits.length > 0` → si la estrategia se abre | **No.** Con foco, una estrategia en la que la persona no participa se cerraría y no habría cómo ver que existe. |
| **1244** | `conBenchmark` — cuántos tienen benchmark | **No.** Es un conteo del branch, y se muestra como `X of Y`. |
| **1260-1262** | el texto `X of Y` | **No.** Pero tiene que decir que la tabla está filtrada. |
| **1270-1277** | el tooltip, que ya calcula `branch.loanOfficers.length - personas.length` | **No.** Y acá va `hiddenCount`, que es su hermano. |
| **1413-1425** | `exactos` y `enteros` — el reparto | **No.** Ver arriba: filtrar acá vuelca el entero de la estrategia en la persona visible. |
| **1427** | `personas.map((lo, idx) => <tr>)` | **SÍ.** Primer sitio de render. |
| **1637** | `bs.owners.map((o, idx) => <tr>)` — los Account Executives de Affinity | **SÍ.** Segundo sitio de render. |
| **855-887** | `porDueno` — el reparto de los dueños | **No.** Misma razón que 1413. |

Y la vista de la división (`app/outlook/page.tsx`) **no necesita nada**: no lista
personas, lista branches. Sus dos menciones de `loanOfficers` son comentarios.

## La forma del cambio

Dos sitios, y en los dos hay que **conservar el índice** para no desalinear los
enteros ya repartidos:

```tsx
// 1427, hoy
return personas.map((lo, idx) => { … enteros[idx] … });

// 1427, propuesto
return personas
  .map((lo, idx) => ({ lo, idx }))          // el idx se ata ANTES de filtrar
  .filter(({ lo }) => focoKey === null || lo.employeeKey === focoKey)
  .map(({ lo, idx }) => { … enteros[idx] … });
```

`focusOn` no sirve tal cual acá porque el filtro tiene que preservar el índice
original. Dos opciones, y prefiero la segunda:

- **(a)** usar `focusOn(personas, focoKey)` y recalcular el reparto sobre la
  lista enfocada. **Descartada:** es exactamente el defecto de arriba.
- **(b)** atar el índice antes de filtrar, como el bloque de código. `focus.ts`
  gana una función hermana —`focusIndexed`— probada igual que las otras tres, y
  la pantalla no inventa el criterio.

## Lo que la pantalla tiene que DECIR

Enfocar sin decirlo es peor que no enfocar: quien mire va a ver una fila donde
había ocho y no va a saber si el branch se quedó sin gente o si la vista está
filtrada. Ya está previsto en `focus.ts`:

- `hiddenCount` → «7 more hidden while reviewing Adriana», junto al `X of Y` de
  la línea 1262.
- `focusIsAbsent` → cuando la persona revisada **no participa** de la
  estrategia, la tabla queda en cero filas y eso no es «el branch no tiene
  gente». Hay que decir «Adriana no participa de NPPM» con esas palabras.

## De dónde sale `focoKey`

De `useReview().recorriendo?.session?.lo_employee_key ?? null`, igual que todo
lo demás desde RV5. Y `null` cuando no se está recorriendo, que es lo que deja
la app normal idéntica — la nota de `focus.ts` ya lo dice: `null` no es «mostrar
a nadie».

⚠ Y con eso el foco **se apaga al dar `Save and exit`**, sin trabajo extra: la
distinción que RV5 introdujo sirve para esto también.

## Lo que hay que decidir, y es tuyo

1. **¿La estrategia en la que la persona no participa se muestra o se esconde?**
   Mi recomendación: **se muestra**, vacía y con el motivo. Esconderla haría que
   la revisión no pueda ver que existe un presupuesto que no la incluye — y
   «no participa» es una conversación válida.

2. **¿El branch entero o sólo las filas de personas?** Mi recomendación: **sólo
   las filas**. Los totales del branch son el contexto que la fase 2 pide leer
   —«el actual, el forecast y el presupuesto como una línea»— y esa línea es del
   branch, no de la persona.

3. **¿Los recruits (`bs.recruits`) también?** No los toqué en la tabla de
   arriba porque no tienen `employeeKey` en todos los casos. Si la respuesta es
   sí, hace falta decidir cómo se identifican.

## Coste

Dos sitios de render, una función nueva en `focus.ts` con sus aserciones, y dos
avisos de pantalla. Nada de esto toca los cálculos, y eso es verificable: los
números del branch tienen que ser **idénticos** con foco y sin foco, y ésa es la
primera aserción que voy a escribir.
