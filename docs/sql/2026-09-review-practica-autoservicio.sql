-- ============================================================================
-- RV27 — PROPUESTA: que el equipo se asigne su propia práctica
-- ============================================================================
--
-- ⚠ NO APLICAR. Esto NO es parte de la etapa: es la opción B de una decisión
-- que toma Isabella. La etapa entregada funciona sin este archivo -- con
-- `review_admin` alcanza para crear una práctica desde `Coach settings`.
--
-- Se escribe ahora, sin aplicar, para que la decisión se pueda tomar mirando lo
-- que costaría y no una descripción de lo que costaría.
--
-- ── EL ESTADO DE HOY, MEDIDO (2026-09-30) ───────────────────────────────────
--
--   con el claim `review_admin`        3  (Isabella, Fernando, Ricardo)
--   equipo de soporte con acceso       10
--
--   ⚠ TRES, no cuatro. El brief decía cuatro y el comentario de
--   `2026-09-review-mode.sql` nombra a tres. Contado contra `auth.users`, son
--   los tres de ese comentario.
--
-- O sea que hoy siete personas del equipo dependen de que uno de los tres les
-- asigne una práctica para poder recorrer el modo coach.
--
-- ── QUÉ CAMBIA, Y QUÉ NO ────────────────────────────────────────────────────
--
-- Lo que se abre es ESTRECHO y conviene verlo escrito:
--
--   · sólo asignaciones con `is_practice = true`;
--   · sólo con uno mismo como revisor (`review.my_employee_key()`);
--   · sólo para quien ya tiene acceso al módulo y está en el roster activo.
--
-- Lo que NO cambia, y es la razón por la que esto es chico:
--
--   · una práctica no escribe hacia afuera -- lo decide
--     `lib/review/puertaDeEscritura.ts`, no una policy;
--   · no afecta ninguna revisión real: los dos índices de «una sola en curso»
--     están separados desde RV24;
--   · y quien practica ya podía VER los datos de esa persona. La práctica no
--     abre lectura nueva.
--
-- ── ⚠ Y LO QUE SÍ AGREGA, QUE NO ES OBVIO ───────────────────────────────────
--
-- Una práctica que uno se asigna queda en SU lista para siempre: `assignment`
-- no tiene policy de DELETE, y la de UPDATE --la que permite desactivar-- pide
-- `review_admin`. Sin la segunda policy de abajo, el autoservicio deja a cada
-- persona con una fila que sólo un administrador puede sacar, que es peor que
-- no poder crearla.
--
-- Y en la pantalla queda una fila que la persona ve en el intake de ese Loan
-- Officer: «N practice sessions on X are not listed here». Con siete personas
-- practicando sobre el mismo sujeto, ese número crece. No rompe nada -- dice la
-- verdad -- pero es el efecto visible de abrirlo.
--
-- ── LO QUE FALTA ADEMÁS DE ESTE ARCHIVO ─────────────────────────────────────
--
-- Un control en `/review` para crear la práctica: hoy el único formulario vive
-- en `/review/settings`, que `proxy.ts` cierra con `review_admin`. Sin eso,
-- estas policies no las puede usar nadie -- es la mitad del contrato que este
-- repo ya pagó tres veces.
--
-- ============================================================================

begin;

/*
 * Crear una práctica sobre uno mismo.
 *
 * ⚠ `is_practice` en el `with check` y no un trigger: una policy que dice
 * «sólo de práctica» y una columna que alguien puede cambiar después son dos
 * cosas distintas. Por eso va también la de UPDATE de abajo, acotada igual.
 */
create policy assignment_insert_practica_propia on review.assignment
  for insert to authenticated with check (
    review.has_access()
    and is_practice
    and reviewer_employee_key = review.my_employee_key()
    and created_by = coalesce(auth.jwt() ->> 'email', '')
  );

/*
 * Y poder darla de baja, que es la mitad que la vuelve usable. Acotada a las
 * propias y de práctica en las DOS cláusulas: sin el `with check`, un update
 * podría convertir la propia práctica en una asignación real de otro.
 */
create policy assignment_update_practica_propia on review.assignment
  for update to authenticated
  using (
    review.has_access()
    and is_practice
    and reviewer_employee_key = review.my_employee_key()
  )
  with check (
    is_practice
    and reviewer_employee_key = review.my_employee_key()
    and updated_by = coalesce(auth.jwt() ->> 'email', '')
  );

commit;


-- ============================================================================
-- CÓMO COMPROBARLO — y la mitad que importa es la que tiene que DECIR QUE NO
-- ============================================================================
--
-- ⚠ Las cuatro se corren simulando el JWT de alguien SIN `review_admin`, que es
-- justamente quien esto viene a habilitar. Con el claim puesto, las cuatro
-- pasan por la policy vieja y no prueban nada de ésta.
--
--   select set_config('request.jwt.claims',
--     '{"email":"<alguien del equipo>","app_metadata":{"allowed_apps":["commercial_activity"]}}', true);
--   set local role authenticated;
--
-- 1. La propia, de práctica: ENTRA.
-- 2. La propia, REAL (`is_practice = false`): tiene que ser rechazada.
-- 3. Con otro como revisor, aunque sea de práctica: tiene que ser rechazada.
-- 4. Y un update que la convierta en real: tiene que ser rechazado.
--
-- Las tres negativas son las que hay que correr. Una policy que sólo se vio
-- aceptar no está probada -- es el mismo agujero que un arnés que imprime
-- verde sin ejecutar una aserción.
--
-- Y la limpieza, con `returning` y el número en el reporte: el editor de SQL es
-- la única vía que puede borrar de `review` y la única que no deja rastro.
--
--   delete from review.assignment where created_by = '<el email>' and is_practice
--     returning assignment_key;
