-- ============================================================================
-- LAS DOS ESCRITURAS DEL PRESUPUESTO, EN UNA SOLA TRANSACCION — etapa OL51
-- ============================================================================
--
-- ⚠ HAY QUE VOLVER A APLICARLO. La primera version se aplico el 2026-09-16 y
-- tiene un defecto que encontro probar las dos ramas: la comprobacion de
-- concurrencia levantaba `errcode = '40001'` --serialization_failure-- y
-- PostgREST reintenta ese codigo solo, asi que esa rama devolvia `504 upstream
-- request timeout` en vez del mensaje. Es `create or replace`, asi que correr
-- este archivo de nuevo alcanza. El detalle esta en el comentario de la
-- comprobacion, mas abajo.
--
-- ---------------------------------------------------------------------------
-- QUE PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- Guardar el presupuesto de una persona son DOS llamadas separadas desde el
-- navegador --`savePersonBudgetTotal` y `savePersonBudgetBreakdown`, en
-- `lib/outlook/save.ts`-- y cada request de PostgREST es su propia transaccion.
-- Si la primera entra y la segunda no, el estado queda partido y nadie se
-- entera: el numero aparece en la fila de la persona y falta en la composicion,
-- o al reves.
--
-- ⚠ NO ES UNA HIPOTESIS. Se construyo el caso interceptando los dos POST, sin
-- que nada llegara a la base:
--
--     budget_total      status=201  cuerpo=""   filas enviadas=3
--     budget_breakdown  status=403              filas enviadas=3
--     y el editor dijo: «Your session does not have the `outlook` claim, so it
--     can read but not save.»
--
-- El total SI quedo escrito y el mensaje afirma lo contrario. Dos cosas de ahi:
--
--   1. la mitad que entro no se deshace ni se avisa;
--   2. un `201` con cuerpo vacio NO distingue tres filas escritas de cero. El
--      insert va sin `Prefer: return=representation`, asi que el cliente no
--      puede saber cuanto toco. Es la regla del `update` sin `returning` de
--      AGENTS.md, del lado del producto y no de una verificacion.
--
-- ---------------------------------------------------------------------------
-- POR QUE UNA TRANSACCION Y NO UNA COMPENSACION
-- ---------------------------------------------------------------------------
-- La alternativa era que la segunda llamada, al fallar, revirtiera a la
-- primera. Se descarto por tres razones, y la segunda es la que decide:
--
--   1. una compensacion tambien puede fallar, y entonces el estado es peor y la
--      historia mas larga de explicar;
--   2. estas tablas son APPEND-ONLY. «Revertir» significa escribir una fila que
--      diga «ignora la anterior», o sea una CUARTA clase de fila --al lado de
--      numero, confirmacion y liberacion-- metida en el modelo de gobierno para
--      tapar un problema de transporte. El gobierno decide QUE numero manda; que
--      una llamada HTTP se haya caido no es una decision de nadie sobre ningun
--      numero, y no tiene por que dejar rastro en el mismo vocabulario;
--   3. no arregla la carrera: `siguienteRevisionDelTotal` LEE el maximo y
--      DESPUES inserta, asi que dos guardados simultaneos eligen la misma
--      revision.
--
-- ---------------------------------------------------------------------------
-- QUE HACE
-- ---------------------------------------------------------------------------
-- Una funcion que recibe las filas YA ARMADAS por el cliente y hace los dos
-- inserts en una sola sentencia, con CTEs. Devuelve la revision y el CONTEO de
-- cada tabla.
--
-- ⚠ LAS FILAS LAS SIGUE ARMANDO EL CLIENTE, a proposito. El arrastre de lo que
-- quedo fuera de la ventana de edicion (`filasFueraDeVentana`, etapa OL38) y el
-- criterio de que revision gobierna (`lib/outlook/gobierno.ts`, etapa OL41) son
-- decisiones de producto que HOY viven en un solo lugar y las leen tambien las
-- dos pantallas. Reescribirlas en PL/pgSQL crearia una segunda copia de cada
-- una, que es exactamente lo que este proyecto lleva nueve casos documentados
-- de pagar. Lo que se mueve a la base es lo unico que la base puede garantizar
-- y el cliente no: la atomicidad y el numero de revision.
--
-- ⚠ Y LA REVISION LA ASIGNA LA FUNCION, no el cliente. Con `max(revision)+1`
-- calculado dentro de la misma sentencia que inserta, dos guardados
-- simultaneos ya no pueden elegir el mismo numero.
--
-- ⚠ PERO LA CARRERA DEL ARRASTRE NO SE ARREGLA SOLA, y conviene decirlo en vez
-- de dejarlo implicito: el cliente LEE las filas vigentes para decidir cuales
-- arrastra, y entre esa lectura y esta escritura otro guardado puede entrar. La
-- revision seria N y N+1 --ya no dos N-- pero la N+1 arrastraria una foto
-- vieja. Por eso la funcion acepta `p_expected_total_revision`: la revision
-- sobre la que el cliente baso su arrastre. Si ya no es esa, la funcion FALLA
-- en vez de escribir. Una actualizacion perdida en silencio se convierte en un
-- error ruidoso, que es lo unico que se puede pedir sin mover las reglas de
-- producto a la base.
--
-- ---------------------------------------------------------------------------
-- SEGURIDAD
-- ---------------------------------------------------------------------------
-- `security invoker` --el default, escrito igual para que se lea-- para que los
-- inserts pasen por las MISMAS policies que hoy: `budget_total_insert` y
-- `budget_breakdown_insert`, las dos con `with check (outlook.has_access())`.
-- Una funcion `security definer` aca saltearia el unico control que tiene el
-- modulo, y no hace falta para nada.
--
-- ⚠ Y NO SE TOCA `pgrst.db_schemas`: `outlook` ya esta expuesto desde OL26, asi
-- que PostgREST publica esta funcion en `/rest/v1/rpc/save_person_budget` sin
-- cambiar esa lista. Se dice el POR QUE y no solo «no hace falta», porque una
-- nota que dice «no hace falta nunca» envejece distinto que una que dice «no
-- hace falta ACA» -- y la primera ya costo un 406 en este proyecto.
--
-- ⚠ `grant execute` A `authenticated` Y NO A `service_role`. `service_role` no
-- tiene `usage` sobre `outlook` --decision del 2026-09-09, anotada en
-- AGENTS.md-- asi que un grant aca seria permiso para algo que igual no puede
-- llegar al esquema. Y el default de Postgres es `execute` a `public`, que es
-- mas de lo que queremos: se revoca primero.
--
-- ---------------------------------------------------------------------------
-- LO QUE SI SE VERIFICO ANTES DE ENTREGARLO, SIN APLICARLO
-- ---------------------------------------------------------------------------
-- La sentencia de los dos CTE se paso por `EXPLAIN` --que PLANIFICA y no
-- ejecuta-- contra las tablas reales. El plan trae `Insert on budget_total` e
-- `Insert on budget_breakdown` como dos CTE, cada una referenciada por un
-- InitPlan, asi que los nombres de columna, los casts y la forma de la
-- sentencia resuelven. Y despues se conto el destino, no el origen:
--
--   totales 96 · desgloses 90 · funcion_creada 0
--
-- O sea: no se escribio ni una fila y la funcion NO existe todavia. La guarda
-- del conteo es redundante a proposito -- que un comando salga bien no prueba
-- que no toco nada.
--
-- Lo que un `EXPLAIN` NO cubre: el cuerpo PL/pgSQL alrededor (las validaciones,
-- el `into` y el `return next`) no se planifica hasta la primera llamada. Eso
-- se comprueba con el paso 2 de abajo.
--
-- ---------------------------------------------------------------------------
-- COMO COMPROBARLO DESPUES DE APLICAR
-- ---------------------------------------------------------------------------
-- ⚠ NO INVENTAR LA CLAVE: el sujeto sale de una consulta, no de un numero
-- escrito a mano. Un `insert` que no matchea nada se parece a uno que funciono,
-- y ya costo un reporte falso en este proyecto.
--
--   -- 1. que exista y con que firma
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef as es_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'outlook' and p.proname = 'save_person_budget';
--
--   -- 2. que los dos inserts o ninguno. Se elige un sujeto REAL y se manda un
--   --    desglose invalido a proposito: un realtor no admite el bucket `nppm`
--   --    (`budget_breakdown_realtor_buckets_check`). Tiene que fallar ENTERO.
--   with sujeto as (
--     select nppm_realtor_code as code,
--            (select max(revision) from outlook.budget_total t2
--              where t2.nppm_realtor_code = t.nppm_realtor_code) as rev
--     from outlook.budget_total t
--     where nppm_realtor_code is not null limit 1
--   )
--   select outlook.save_person_budget(
--     null, (select code from sujeto), null,
--     jsonb_build_array(jsonb_build_object(
--       'target_month','2026-10-01','total',9,'confirmed_only',false,
--       'released_to_rule',false,'set_by','prueba','note','prueba atomica')),
--     jsonb_build_array(jsonb_build_object(
--       'target_month','2026-10-01','bucket','nppm','value',9,
--       'set_by','prueba','note','prueba atomica')),
--     (select rev from sujeto), null)
--   from sujeto;
--   -- esperado: ERROR 23514 del check, y CERO filas nuevas en las dos tablas.
--
--   -- 3. y que el conteo de la tabla no se movio (en OTRA sentencia: los
--   --    `select` de la misma sentencia ven el snapshot anterior)
--   select (select count(*) from outlook.budget_total)     as totales,
--          (select count(*) from outlook.budget_breakdown) as desgloses;
--
-- ============================================================================

create or replace function outlook.save_person_budget(
  -- Exactamente uno de los tres sujetos, igual que el CHECK de las tablas.
  p_employee_key bigint,
  p_nppm_realtor_code text,
  p_branch_code text,
  -- [{target_month, total, confirmed_only, released_to_rule, set_by, note}]
  p_totals jsonb,
  -- [{target_month, bucket, value, set_by, note}]
  p_breakdowns jsonb,
  -- La revision sobre la que el cliente baso su arrastre. `null` = no habia.
  p_expected_total_revision integer default null,
  p_expected_breakdown_revision integer default null
)
returns table (
  total_revision integer,
  total_rows integer,
  breakdown_revision integer,
  breakdown_rows integer
)
language plpgsql
security invoker
set search_path = outlook, public
as $$
declare
  v_total_rev     integer;
  v_break_rev     integer;
  v_actual_total  integer;
  v_actual_break  integer;
begin
  -- El mismo criterio que el CHECK `num_nonnulls(...) = 1` de las tablas, dicho
  -- aca para que el error nombre el problema en vez de llegar como 23514 sobre
  -- la primera fila.
  if num_nonnulls(p_employee_key, p_nppm_realtor_code, p_branch_code) <> 1 then
    raise exception
      'save_person_budget: exactly one subject is required (employee_key, nppm_realtor_code or branch_code)'
      using errcode = '22023';
  end if;

  if coalesce(jsonb_array_length(p_totals), 0) = 0
     and coalesce(jsonb_array_length(p_breakdowns), 0) = 0 then
    raise exception 'save_person_budget: there is nothing to write' using errcode = '22023';
  end if;

  -- ── La revision vigente de cada tabla, LEIDA ACA ──────────────────────────
  -- Dentro de la transaccion, asi que el `+1` de abajo no puede coincidir con
  -- el de otro guardado simultaneo.
  select coalesce(max(revision), 0) into v_actual_total
  from outlook.budget_total
  where employee_key is not distinct from p_employee_key
    and nppm_realtor_code is not distinct from p_nppm_realtor_code
    and branch_code is not distinct from p_branch_code;

  select coalesce(max(revision), 0) into v_actual_break
  from outlook.budget_breakdown
  where employee_key is not distinct from p_employee_key
    and nppm_realtor_code is not distinct from p_nppm_realtor_code
    and branch_code is not distinct from p_branch_code;

  -- ⚠ CONCURRENCIA OPTIMISTA. Si el cliente armo su arrastre sobre una revision
  -- que ya no es la ultima, otro guardado entro en el medio y arrastrar la foto
  -- vieja borraria lo que ese otro decidio. Falla ruidoso en vez de perderlo.
  --
  -- ⚠ SIN `errcode = '40001'`, Y LO ENCONTRO PROBARLO. La primera version usaba
  -- `40001` --serialization_failure-- porque describe bien lo que paso. Medido
  -- contra PostgREST, esa rama devolvia `504 upstream request timeout` en vez
  -- del mensaje: `40001` significa «transitorio, volve a intentar», y la capa
  -- de arriba REINTENTA sola. Este chequeo no es transitorio -- reintentarlo da
  -- el mismo resultado siempre-- asi que reintentar solo consume el timeout.
  --
  -- Llamada directa desde SQL la funcion contestaba perfecto, con su mensaje.
  -- Un error correcto por el canal equivocado se ve como una caida.
  --
  -- ⚠ Y NO ERA SOLO UN TIMEOUT, que es lo que lo vuelve grave. Despues de
  -- limpiar las filas de prueba quedaron DOS que no habia puesto nadie, con
  -- `created_at` POSTERIOR a la limpieza: el reintento seguia corriendo, y al
  -- volver a intentar sobre una tabla ya vacia la comprobacion --que compara
  -- contra `max(revision)`-- paso, y ESCRIBIO. O sea que la guarda que dice
  -- «esto cambio debajo tuyo, no escribo» termino escribiendo despues de que el
  -- cliente se rindiera. Un rechazo marcado como transitorio no es un rechazo.
  --
  -- Sin `using errcode`, `raise exception` es `P0001`, que PostgREST traduce a
  -- un 400 con el mensaje visible, que es lo que tiene que leer quien guarda.
  --
  if p_expected_total_revision is not null and p_expected_total_revision <> v_actual_total then
    raise exception
      'save_person_budget: this budget changed while you were editing (revision % is now %). Reopen and try again.',
      p_expected_total_revision, v_actual_total;
  end if;
  if p_expected_breakdown_revision is not null and p_expected_breakdown_revision <> v_actual_break then
    raise exception
      'save_person_budget: this breakdown changed while you were editing (revision % is now %). Reopen and try again.',
      p_expected_breakdown_revision, v_actual_break;
  end if;

  v_total_rev := v_actual_total + 1;
  v_break_rev := v_actual_break + 1;

  -- ── Los dos inserts, en UNA sentencia ─────────────────────────────────────
  -- Un CTE que modifica y otro que modifica: las dos ramas corren en la misma
  -- sentencia, asi que o entran las dos o no entra ninguna. Si el check de
  -- cualquiera de las dos rechaza una fila, la sentencia entera aborta.
  --
  -- ⚠ Y LOS CONTEOS SALEN DEL `returning`, no de `jsonb_array_length` del
  -- argumento: contar lo que se MANDO y llamarlo lo que se ESCRIBIO es
  -- exactamente el `201` con cuerpo vacio, otra vez.
  with t as (
    insert into outlook.budget_total (
      employee_key, nppm_realtor_code, branch_code, revision, target_month,
      total, confirmed_only, released_to_rule, set_by, note)
    select
      p_employee_key, p_nppm_realtor_code, p_branch_code, v_total_rev,
      (r->>'target_month')::date,
      nullif(r->>'total', '')::numeric,
      coalesce((r->>'confirmed_only')::boolean, false),
      coalesce((r->>'released_to_rule')::boolean, false),
      r->>'set_by',
      nullif(r->>'note', '')
    from jsonb_array_elements(coalesce(p_totals, '[]'::jsonb)) as r
    returning 1
  ), b as (
    insert into outlook.budget_breakdown (
      employee_key, nppm_realtor_code, branch_code, revision, target_month,
      bucket, value, set_by, note)
    select
      p_employee_key, p_nppm_realtor_code, p_branch_code, v_break_rev,
      (r->>'target_month')::date,
      r->>'bucket',
      (r->>'value')::numeric,
      r->>'set_by',
      nullif(r->>'note', '')
    from jsonb_array_elements(coalesce(p_breakdowns, '[]'::jsonb)) as r
    returning 1
  )
  select
    (select count(*) from t)::integer,
    (select count(*) from b)::integer
  into total_rows, breakdown_rows;

  -- Una revision que no escribio ninguna fila no existe: se devuelve `null`
  -- para que el cliente no muestre «revision 7» de algo que no esta.
  total_revision     := case when total_rows > 0 then v_total_rev else null end;
  breakdown_revision := case when breakdown_rows > 0 then v_break_rev else null end;
  return next;
end;
$$;

comment on function outlook.save_person_budget(bigint, text, text, jsonb, jsonb, integer, integer) is
  'Escribe el total y el desglose de un presupuesto en UNA transaccion, asigna la revision de cada tabla y devuelve el conteo real de filas escritas. Etapa OL51; ver docs/sql/2026-09-save-person-budget-atomico.sql.';

-- El default de Postgres es `execute` a `public`. Se revoca y se otorga solo a
-- quien lo necesita, que es la sesion de la app.
revoke all on function outlook.save_person_budget(bigint, text, text, jsonb, jsonb, integer, integer) from public;
grant execute on function outlook.save_person_budget(bigint, text, text, jsonb, jsonb, integer, integer) to authenticated;

-- PostgREST cachea el esquema: sin esto la funcion no aparece en /rpc hasta el
-- proximo reinicio.
notify pgrst, 'reload schema';
