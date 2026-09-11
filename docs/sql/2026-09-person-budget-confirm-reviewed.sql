-- ============================================================================
-- CONFIRMAR SIN FIJAR: una revision que no fija ningun numero  -- etapa RV15
-- ============================================================================
--
-- El editor de presupuesto ya ofrece «Confirm as reviewed» cuando no hay
-- cambios, pero no escribia nada: `save()` escribe solo lo que cambio. Asi que
-- la compuerta del paso 2.2 --que exige una fila de esa persona escrita
-- despues del arranque de la sesion-- seguia cerrada, y confirmar no dejaba
-- rastro.
--
-- Confirmar tiene que escribir. Y la fila que escribe NO PUEDE SER UN TOTAL:
--
--   * OL26e dice «person_budget_total manda cuando existe, la regla cuando no»,
--     por persona y por mes. Escribir un total donde hoy proyecta la regla es
--     un cambio de gobierno -- la propia pantalla lo avisa antes de guardar
--     («Saving a Total for a month replaces the rule for that month»).
--   * Y hoy `person_budget_total` esta en CERO filas (RV14 borro las pruebas),
--     asi que TODA persona proyecta por regla. Si confirmar escribiera el
--     numero proyectado, cada confirmacion congelaria la proyeccion de una
--     persona y las 190 reglas de crecimiento dejarian de gobernar de a una,
--     por el click de un boton que dice «lo revise».
--   * En el otro sentido: una revision nueva con totales nulos sobre alguien
--     que SI tiene total fijado le quitaria el gobierno, porque el lector toma
--     la revision mas alta. Confirmar no puede desfijar nada.
--
-- Entonces son DOS ACTOS DISTINTOS y necesitan quedar distinguibles, que es lo
-- que `outlook.snapshot.warnings` ya hace a proposito con NULL contra arreglo
-- vacio:
--
--   confirmed_only = false   «fije estos numeros»       -- gobierna
--   confirmed_only = true    «mire lo que hay y lo acepto» -- no gobierna
--
-- El lector (`lib/outlook/loadData.ts`) calcula la revision vigente IGNORANDO
-- las confirmaciones, asi que una confirmacion nunca mueve un mes de la regla
-- al total ni al reves. Para la compuerta, en cambio, cualquier fila alcanza:
-- solo pide `created_at` de esa persona posterior al arranque de la sesion.
--
-- Y son append-only por revision a proposito: dos confirmaciones con el mismo
-- estado dicen algo --que se miro dos veces y se acepto dos veces--, no son un
-- duplicado.
--
-- ============================================================================

begin;

alter table outlook.person_budget_total
  add column if not exists confirmed_only boolean not null default false;

comment on column outlook.person_budget_total.confirmed_only is
  'true = la revision es un acto de revision, no un total fijado: no gobierna la proyeccion y su total es null. false = el total fijado a mano, que manda sobre la regla de crecimiento del mes (OL26e).';

-- El total deja de ser obligatorio, PERO SOLO PARA UNA CONFIRMACION. El CHECK
-- es lo que impide que esto se vuelva un total nulo por descuido: sin el, un
-- insert con `total` faltante pasaria de largo y el mes quedaria sin numero
-- pareciendo fijado.
alter table outlook.person_budget_total
  alter column total drop not null;

alter table outlook.person_budget_total
  add constraint person_budget_total_confirmed_check
  check ((confirmed_only and total is null) or (not confirmed_only and total is not null));

commit;

-- ============================================================================
-- VERIFICACION
-- ============================================================================
-- Con `returning` y sin claves inventadas: un UPDATE/INSERT que no matchea
-- nada se parece a uno que funciono, y una clave escrita a mano puede no
-- existir (paso: se reporto que tres CHECK «no rechazaban nada» usando una
-- clave que ninguna fila tenia).

-- 1. La columna quedo, con su default y su not null.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'outlook'
  and table_name = 'person_budget_total'
  and column_name in ('total', 'confirmed_only');
-- esperado: total YES (nullable), confirmed_only NO con default false

-- 2. El CHECK esta y dice lo que tiene que decir.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'outlook.person_budget_total'::regclass
  and conname = 'person_budget_total_confirmed_check';

-- 3. Las cuatro combinaciones, sobre un employee_key que EXISTE de verdad
--    (sale de la propia tabla de empleados, no de la memoria de nadie), y
--    todo dentro de una transaccion que se deshace.
begin;
do $$
declare
  v_key bigint;
  v_ok  boolean;
begin
  select employee_key into strict v_key from org.dim_employee limit 1;

  -- 3a. Un total de verdad: pasa.
  insert into outlook.person_budget_total (employee_key, revision, target_month, total, confirmed_only, set_by)
  values (v_key, 9001, date_trunc('month', now())::date, 12, false, 'verificacion');
  raise notice '3a total fijado: ACEPTADO (correcto)';

  -- 3b. Una confirmacion sin numero: pasa.
  insert into outlook.person_budget_total (employee_key, revision, target_month, total, confirmed_only, set_by)
  values (v_key, 9002, date_trunc('month', now())::date, null, true, 'verificacion');
  raise notice '3b confirmacion sin total: ACEPTADO (correcto)';

  -- 3c. Un total sin numero: RECHAZADO.
  v_ok := false;
  begin
    insert into outlook.person_budget_total (employee_key, revision, target_month, total, confirmed_only, set_by)
    values (v_key, 9003, date_trunc('month', now())::date, null, false, 'verificacion');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '3c FALLA: un total sin numero entro'; end if;
  raise notice '3c total sin numero: RECHAZADO (correcto)';

  -- 3d. Una confirmacion CON numero: RECHAZADA. Es la mitad que evita que
  --     confirmar se convierta en fijar sin decirlo.
  v_ok := false;
  begin
    insert into outlook.person_budget_total (employee_key, revision, target_month, total, confirmed_only, set_by)
    values (v_key, 9004, date_trunc('month', now())::date, 7, true, 'verificacion');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '3d FALLA: una confirmacion con numero entro'; end if;
  raise notice '3d confirmacion con numero: RECHAZADA (correcto)';
end $$;
rollback;

-- 4. Y que el rollback dejo la tabla como estaba: cero filas de la
--    verificacion.
select count(*) as filas_de_verificacion
from outlook.person_budget_total
where set_by = 'verificacion';
-- esperado: 0
