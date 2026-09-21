-- ============================================================================
-- SOLTAR EL TOTAL: QUE UN MES VUELVA A LA REGLA — etapa OL41
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- QUE PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- Un total fijado no se puede desfijar. Soltar ALGUNOS meses es hoy un efecto
-- secundario --se borran sus celdas y la revision nueva los omite, asi que el
-- lector los hace caer a la regla-- y soltarlos TODOS no se puede: una revision
-- necesita al menos una fila, y por eso el editor termina diciendo «Clearing
-- every cell is not supported».
--
-- ⚠ Y EL ACTO QUE FALTA SE BUSCA IGUAL. Galo Rizzo tiene cuatro confirmaciones
-- en tres minutos --16:36:08, 16:36:33, 16:37:13 y 16:39:47-- apretando el
-- unico boton que parecia soltar el numero. «Confirm as reviewed» escribe una
-- fila que A PROPOSITO no toca el gobierno (RV15), asi que su total siguio
-- fijado en 4/4/4 y nadie lo vio hasta que la composicion del branch de OL39
-- puso los dos numeros uno al lado del otro.
--
-- ---------------------------------------------------------------------------
-- QUE HACE
-- ---------------------------------------------------------------------------
-- Una tercera clase de fila en `outlook.budget_total`, hermana de
-- `confirmed_only`:
--
--   NUMERO        `total` con valor. «El presupuesto de este mes es este.»
--   CONFIRMACION  `confirmed_only`, sin numero. «Lo mire y esta bien asi.» NO
--                 toca el gobierno -- si contara, confirmar le borraria el
--                 presupuesto a alguien por apretar un boton que dice «lo
--                 revise».
--   LIBERACION    `released_to_rule`, sin numero. «Este mes vuelve a la regla.»
--                 SI gobierna: es una decision sobre el numero, y lo que decide
--                 es que no haya numero.
--
-- ⚠ UNA LIBERACION NO ES UN CERO. Cero es «espero cero prestamos este mes», una
-- decision con numero. Liberar es «no decido yo, decide la regla». Darles el
-- mismo valor es el error que este modulo viene evitando desde el primer dia.
--
-- ---------------------------------------------------------------------------
-- ⚠ EL CHECK ES LA MITAD QUE SOSTIENE LA LECTURA
-- ---------------------------------------------------------------------------
-- El lector descarta `total is null` como guarda redundante --un nulo leido
-- como `Number(null)` seria un cero que nadie fijo--. Con tres clases de fila
-- esa redundancia deja de alcanzar, asi que el CHECK la reemplaza: una fila o
-- tiene numero, o es confirmacion, o es liberacion. Nunca dos, nunca ninguna.
--
-- El CHECK viejo --`confirmed_only` implica `total` nulo-- se reemplaza por
-- este, que dice lo mismo y ademas cubre la clase nueva.
-- ---------------------------------------------------------------------------

begin;

alter table outlook.budget_total
  add column if not exists released_to_rule boolean not null default false;

comment on column outlook.budget_total.released_to_rule is
  'OL41: esta fila SUELTA el mes a la regla de crecimiento. Gobierna (a '
  'diferencia de confirmed_only) y no lleva numero: no es un cero, es «no lo '
  'decido yo».';

-- El nombre del CHECK viejo puede variar segun como se creo la tabla; se borra
-- si esta y se agrega el nuevo. Ver `2026-09-person-budget-confirm-reviewed.sql`.
alter table outlook.budget_total
  drop constraint if exists person_budget_total_confirmed_only_check;
alter table outlook.budget_total
  drop constraint if exists budget_total_confirmed_only_check;

alter table outlook.budget_total
  add constraint budget_total_una_clase_de_fila check (
    (total is not null and confirmed_only is not true and released_to_rule is not true)
    or (total is null and confirmed_only is true and released_to_rule is not true)
    or (total is null and confirmed_only is not true and released_to_rule is true)
  );

commit;

-- ---------------------------------------------------------------------------
-- PARA VERIFICAR, despues de aplicar
-- ---------------------------------------------------------------------------
-- 1. La columna existe y ninguna fila de hoy la tiene puesta:
--
--      select released_to_rule, count(*)
--        from outlook.budget_total group by 1;
--
--    Tiene que dar una sola linea, `false` con el total de filas de hoy: las
--    81 que hay ahora siguen significando lo mismo.
--
-- 2. El CHECK rechaza una fila de dos clases a la vez:
--
--      insert into outlook.budget_total
--        (employee_key, revision, target_month, total, confirmed_only, released_to_rule, set_by)
--      values (7, 999, '2026-10-01', 5, false, true, 'prueba');
--
--    Tiene que fallar con 23514. Si entra, el CHECK no quedo puesto.
--
-- 3. Y en pantalla: el editor de una persona con meses fijados muestra «Back to
--    the growth rule». Soltarlos deja su fila del branch proyectando por regla,
--    y la composicion del branch sigue dando lo mismo que la fila -- el
--    invariante de OL39, que es lo que esta etapa no puede romper.
