-- ============================================================================
-- EL PERFIL DEL LOAN OFFICER -- etapa BP50
-- ============================================================================
--
-- Los campos que hacen que la pantalla se lea como un CV: donde opera, sus
-- licencias, su NMLS, de donde vienen sus leads, si es tiempo completo, cuando
-- entro y que le interesa.
--
-- ============================================================================
-- 1. POR QUE UNA TABLA NUEVA Y NO COLUMNAS EN `dim_employee`
-- ============================================================================
-- `org.dim_employee` se sincroniza desde BigQuery (`synced_from_bigquery_at`).
-- Una columna de la app ahi se pierde en la proxima corrida, o peor: sobrevive
-- a medias y nadie sabe cual es la fuente. Estos campos los escribe una
-- persona en el portal, asi que viven aparte y se atan por `employee_key`.
--
-- ============================================================================
-- 2. SE EDITA EN EL LUGAR, NO ES APPEND-ONLY -- Y ESTA ES LA RAZON
-- ============================================================================
-- Un perfil es CONFIGURACION VIGENTE, no una decision con historia. El
-- criterio del repo distingue las dos cosas y ya tiene un ejemplo de cada una:
--
--   `business_plan.settings`      configuracion    se edita en el lugar
--   `business_plan.intervention`  una decision     append-only, con autor y fecha
--   `outlook.person_budget_total` una decision     append-only, por revision
--
-- La pregunta que decide es: ¿alguien va a querer saber que decia ANTES?
-- Para un benchmark o un presupuesto, si -- es la vara con la que se evaluo a
-- alguien. Para «opera en FL y VA» o «le interesa el marketing», no: lo que
-- importa es lo que vale hoy, y una version anterior es ruido.
--
-- ⚠ LO QUE SE PIERDE, dicho: no hay historia. Si manana hace falta saber desde
-- cuando alguien opera en un estado, ese campo se muda a su propia tabla
-- append-only; no se convierte esta. Mientras tanto queda el rastro minimo
-- --`updated_at` y `updated_by`-- que dice QUIEN toco por ultima vez, no que
-- cambio.
--
-- ⚠ Y NO HAY POLICY DE DELETE, a proposito: un perfil no se borra, se vacia
-- campo por campo. Igual que `review`: si algun dia hace falta, se agrega con
-- la razon escrita.

begin;

create table if not exists org.lo_profile (
  employee_key bigint primary key references org.dim_employee(employee_key),

  -- Los estados donde opera. Arreglo y no tabla hija: es un multi-select de
  -- configuracion, no una relacion con atributos propios.
  operating_states text[] not null default '{}',

  -- ⚠ EL CHECK VA SOBRE EL ARREGLO ENTERO, con `array_to_string` porque en un
  -- CHECK no se puede usar una subconsulta. Sin esto entraria 'Florida', 'fl'
  -- o ' FL ', y el dia que alguien agrupe por estado no cierra.
  constraint lo_profile_states_check
    check (array_to_string(operating_states, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),

  -- Texto libre por ahora: se midio que no hay una fuente con formato para
  -- esto. `activity_report.lo_recruitment.licensed_states` existe pero es del
  -- pipeline de RECLUTAMIENTO: ninguno de los 35 LO activos aparece ahi.
  licenses text,

  -- ⚠ NO DUPLICA EL NMLS: es un OVERRIDE. `org.dim_employee.nmls` ya lo trae
  -- para 34 de 35 LO activos (medido, 2026-09-10; el que falta es Lucio
  -- Romero, 100). Guardar una copia crearia dos verdades y ninguna forma de
  -- saber cual manda.
  --
  --   null           usa el de `dim_employee`
  --   un valor       lo reemplaza, porque alguien lo corrigio a mano
  --
  -- El efectivo es `coalesce(p.nmls_override, e.nmls)`, y con los dos en null
  -- NO HAY LINK -- no un link roto a https://new.mmi.run/nmls/null.
  nmls_override text,

  -- De donde viene su negocio. Texto libre hasta que exista la taxonomia:
  -- una lista cerrada inventada acá se volveria la taxonomia por defecto.
  lead_source text,

  -- Tiempo completo o medio tiempo.
  schedule text,
  constraint lo_profile_schedule_check
    check (schedule is null or schedule in ('full_time', 'part_time')),

  -- ⚠ QUEDA VACIA Y EDITABLE: no se puede precargar. Medido -- los 35 LO
  -- activos tienen fila en `org.roster_current` y CERO tienen `date_started`
  -- (las 45 fechas de esa tabla son de otra gente). Y `public.hr_active_roster`
  -- tampoco sirve: sus 78 filas no matchean ninguno de los 35, ni por nombre
  -- ni por correo.
  started_on date,

  -- Para conocer a la persona: si le gusta el marketing, si prefiere el trato
  -- directo.
  interests text,

  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz,
  updated_by text,

  -- ⚠ NI UN '' EN NINGUNO DE LOS CUATRO TEXTOS. El parser del repo ya coerciona
  -- a cadena vacia en otra ruta y por eso «no vino» y «vino vacio» no se
  -- distinguen (docs/ARQUITECTURA.md). Acá se corta de entrada: o hay dato, o
  -- es null.
  constraint lo_profile_sin_vacios_check check (
    (licenses is null or btrim(licenses) <> '') and
    (nmls_override is null or btrim(nmls_override) <> '') and
    (lead_source is null or btrim(lead_source) <> '') and
    (interests is null or btrim(interests) <> '')
  )
);

comment on table org.lo_profile is
  'Perfil editable de un Loan Officer (BP50). Configuracion vigente: se edita en el lugar, no es append-only. Los campos sincronizados desde BigQuery viven en org.dim_employee y no se copian acá -- nmls_override es un override, no una copia.';

-- ============================================================================
-- 3. RLS -- mismo idioma que el resto de `org`
-- ============================================================================
-- Sin funcion helper: las tablas de `org` chequean el claim inline, y
-- `employee_benchmark` es el precedente mas cercano porque ademas exige que el
-- autor sea el de la sesion.

alter table org.lo_profile enable row level security;

create policy lo_profile_read on org.lo_profile
  for select using (
    coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity', false)
  );

-- ⚠ EL AUTOR SALE DE LA SESION, NO DEL FORMULARIO. Si viniera del cuerpo del
-- request, cualquiera podria firmar el perfil de otro. Mismo criterio que
-- `employee_benchmark.set_by`.
create policy lo_profile_insert on org.lo_profile
  for insert with check (
    coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity', false)
    and created_by = coalesce(auth.jwt() ->> 'email', '')
  );

create policy lo_profile_update on org.lo_profile
  for update using (
    coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity', false)
  ) with check (
    coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity', false)
    and updated_by = coalesce(auth.jwt() ->> 'email', '')
  );

-- ⚠ UNA TABLA NUEVA NO HEREDA EL GRANT DEL ESQUEMA. Ya paso: `business_plan.area`
-- quedo como la unica de nueve tablas sin grant, y eso rompio una pantalla que
-- ni la menciona --un trigger `security invoker` la leia--. Va explicito.
--
-- Y solo a `authenticated`. Medido hoy: `service_role` SI tiene usage sobre
-- `org` --a diferencia de `business_plan`, `outlook` y `review`, donde no la
-- tiene-- pero eso es el esquema, no la tabla: sin este grant no la puede
-- tocar, y asi queda. Si algo del backend la necesita, se otorga con la razon
-- escrita en su propia migracion.
grant select, insert, update on org.lo_profile to authenticated;

commit;

-- ============================================================================
-- 4. VERIFICACION
-- ============================================================================

-- 4a. La tabla, sus constraints y su grant.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'org' and table_name = 'lo_profile'
order by ordinal_position;

select conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'org.lo_profile'::regclass order by conname;

select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'org' and table_name = 'lo_profile' order by grantee, privilege_type;

select polname, polcmd from pg_policy where polrelid = 'org.lo_profile'::regclass order by polname;

-- 4b. Los CHECK, en las dos direcciones y sobre un employee_key que EXISTE
--     (sale de la tabla, no de la memoria). Todo dentro de una transaccion que
--     se deshace.
begin;
do $$
declare v_key bigint; v_ok boolean;
begin
  select employee_key into strict v_key
  from org.dim_employee where is_loan_officer and is_active limit 1;

  -- pasa: estados en dos letras mayusculas y nada mas cargado
  insert into org.lo_profile (employee_key, operating_states, created_by)
  values (v_key, array['FL','VA'], 'verificacion');
  raise notice '4b-1 estados FL,VA: ACEPTADO (correcto)';

  -- pasa: el arreglo vacio es el default y es valido
  update org.lo_profile set operating_states = '{}', updated_by = 'verificacion',
         updated_at = now() where employee_key = v_key;
  raise notice '4b-2 arreglo vacio: ACEPTADO (correcto)';

  -- rechaza: nombre completo del estado
  v_ok := false;
  begin
    update org.lo_profile set operating_states = array['Florida'] where employee_key = v_key;
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '4b-3 FALLA: entro "Florida"'; end if;
  raise notice '4b-3 "Florida": RECHAZADO (correcto)';

  -- rechaza: minusculas
  v_ok := false;
  begin
    update org.lo_profile set operating_states = array['fl'] where employee_key = v_key;
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '4b-4 FALLA: entro "fl"'; end if;
  raise notice '4b-4 "fl": RECHAZADO (correcto)';

  -- rechaza: una cadena vacia en un texto libre
  v_ok := false;
  begin
    update org.lo_profile set interests = '' where employee_key = v_key;
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '4b-5 FALLA: entro un interests vacio'; end if;
  raise notice '4b-5 interests = "": RECHAZADO (correcto)';

  -- rechaza: un schedule que no es ninguno de los dos
  v_ok := false;
  begin
    update org.lo_profile set schedule = 'weekends' where employee_key = v_key;
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '4b-6 FALLA: entro schedule "weekends"'; end if;
  raise notice '4b-6 schedule "weekends": RECHAZADO (correcto)';
end $$;
rollback;

-- 4c. Y que el rollback dejo la tabla vacia.
select count(*) as filas_de_verificacion from org.lo_profile;
-- esperado: 0

-- ============================================================================
-- 5. LA SUGERENCIA DE ESTADOS -- MEDIDA, NO CREADA ACA
-- ============================================================================
-- `property_state` sirve para SUGERIR, y esta medido (2026-09-10):
--
--   26.191 prestamos entre las dos tablas de `pipeline_forecast`
--   10.702 con `property_state` (0 con cadena vacia)
--   21 de los 35 LO activos matchean por nombre exacto normalizado
--   3,19 estados distintos en promedio; el maximo es 21 (Nathan Martinez,
--        3.612 prestamos), y Haydee Tito-Pace da 2 (MD, VA)
--
-- ⚠ LA ATADURA ES EL NOMBRE, no una clave: ni `pipeline_loans` ni
-- `pipeline_resolved_loans` traen `loan_officer_person_code` --lo traen para
-- el processor y los LOA, no para el LO--. Asi que esto es una SUGERENCIA y
-- nunca la verdad: 14 de 35 no matchean, y donde el negocio se cerro no es lo
-- mismo que donde alguien tiene licencia.
--
-- La consulta, para el que escriba la pantalla:
--
--   select property_state, count(*) as prestamos
--     from (
--       select loan_officer, property_state from pipeline_forecast.pipeline_resolved_loans
--       union all
--       select loan_officer, property_state from pipeline_forecast.pipeline_loans
--     ) t
--    where upper(btrim(loan_officer)) = upper(btrim($1))
--      and property_state is not null and property_state <> ''
--    group by property_state
--    order by prestamos desc;
--
-- No se crea una vista en esta etapa a proposito: como exponerla --vista con
-- `security_invoker`, o la consulta del lado del cliente-- es una decision de
-- la pantalla, y la pantalla todavia no esta escrita.
