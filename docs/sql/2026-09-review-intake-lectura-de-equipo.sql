-- ============================================================================
-- EL INTAKE SE LEE EN EQUIPO -- etapa RV23
-- ============================================================================
--
-- ⚠ ESTE ARCHIVO ES UN RASTRO, NO UNA TAREA. Isabella ya aplico estas dos
-- policies desde el editor SQL el 2026-09-11. Esta acá porque el editor no deja
-- rastro en el repo, y sin esto `2026-09-review-mode.sql` --que sigue mostrando
-- las policies viejas-- es la unica version escrita de algo que ya cambio. Un
-- archivo de migracion que miente sobre el estado de la base es peor que no
-- tenerlo.
--
-- ---------------------------------------------------------------------------
-- QUE CAMBIO Y POR QUE
-- ---------------------------------------------------------------------------
-- Las dos policies de LECTURA pedian, ademas de pertenecer a la app,
-- `can_assign()` o ser el revisor de esa asignacion. Con eso Isabella no podia
-- leer la revision que Fernando le hizo a Luis Silva: el intake es un REGISTRO
-- COMPARTIDO del equipo --por eso vive en el perfil y no en la mascara-- y
-- estaba detras de un permiso personal.
--
-- ⚠ ESCRIBIR NO CAMBIO. `response_insert` sigue pidiendo `owns_session` y que
-- `answered_by` sea el email de la sesion. Se lee en equipo y se escribe de a
-- uno, que son dos decisiones distintas y conviene que sigan siendolo.
--
-- ---------------------------------------------------------------------------
-- ⚠ Y LO QUE ARRASTRO EN EL CODIGO
-- ---------------------------------------------------------------------------
-- `useIntake` tenia una bandera `visible` que leia «cero respuestas sobre una
-- sesion cerrada» como «RLS filtro». Esa causa dejo de existir: las dos
-- policies son ahora EL MISMO predicado, asi que quien ve la sesion ve sus
-- respuestas. El mensaje de permiso salia en el perfil de Luis Silva cuando el
-- permiso estaba y los comentarios no existian, y se saco en RV23.
--
-- Si alguna vez `response_select` vuelve a ser mas estrecha que
-- `session_select`, ese estado tiene que volver: ahi cero filas significa dos
-- cosas otra vez.

begin;

drop policy if exists session_select on review.session;
create policy session_select on review.session
  for select to authenticated using (review.has_access());

drop policy if exists response_select on review.response;
create policy response_select on review.response
  for select to authenticated using (review.has_access());

commit;

-- ---------------------------------------------------------------------------
-- Verificacion: las dos de lectura sin condicion extra, las de escritura como
-- estaban.
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'review'
  and tablename in ('session', 'response')
order by tablename, policyname;
-- esperado: `session_select` y `response_select` con qual = review.has_access()
-- y sin `owns_session` ni `can_assign`; `response_insert` y `session_insert`
-- con `owns_session` en el `with_check`.

-- Y la comprobacion que importa, que es de comportamiento y no de texto:
-- alguien con `commercial_activity` y SIN `review_admin` tiene que poder leer
-- las respuestas de una sesion que no es suya. Medido el 2026-09-11 con tres
-- personas (adriana.cervantes, nila.granadillo, heather.pena): las tres leen
-- las 3 respuestas de la sesion 65 de Luis Silva, que es de Fernando.
