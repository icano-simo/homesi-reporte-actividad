-- ============================================================================
-- Las seis personas del roster que no tienen fila en `org.dim_employee`
-- ============================================================================
--
-- NO EJECUTAR desde el repo. Lo aplica quien administra la base.
--
-- ── DE DONDE SALE ───────────────────────────────────────────────────────────
--
-- Medido el 2026-09-18 contra `simoOS-prod`:
--
--   aliases que apuntan a una fila inexistente        0 de 379
--   roster activo sin fila en dim_employee            6 de 111
--   de esos seis, que producen                        1  (Arnaldo Ortega)
--
-- O sea que NO es el caso sistematico que se sospechaba: los 127 employee_key
-- de `employee_alias` tienen los 127 su fila. Lo que falta son seis personas
-- que entraron al roster y nunca se dieron de alta en `dim_employee`, que se
-- mantiene a mano.
--
-- ⚠ Y el que importa es UNO. Los otros cinco no producen, asi que hoy no
-- rompen nada. Arnaldo Ortega es LOAN OFFICER con `is_producer` en el roster y
-- CERO prestamos todavia: el dia que cierre uno no va a tener a donde
-- atribuirse, y eso no se ve hasta que pasa. Se agregan los seis porque cuesta
-- lo mismo y evita que el caso vuelva la semana que viene.
--
-- ── ⚠ BELKYS NO ES UN INSERT: YA TIENE FILA ────────────────────────────────
--
-- `org.dim_employee` 120 es «Belkys Fernandez», CO, `source = 'roster-co'`,
-- con `person_code` en NULL. Y su alias de roster --«BELKYS JOHANA FERNADEZ
-- LLANOS», con `match_method = 'manual-sin-correo'`-- YA apunta a esa fila.
--
-- El roster la escribe «Belkys Johana Fernadez Llanos» (sin la primera `n` de
-- Fernandez, tal como viene el archivo). Insertarla habria creado una SEGUNDA
-- Belkys, y `full_name` es UNIQUE asi que ni siquiera habria fallado ruidoso:
-- habria entrado como otra persona.
--
-- Por eso su parte es un UPDATE que le pone el `person_code`, no un INSERT.
-- Es el mismo problema de identidad que `employee_alias` existe para resolver,
-- y se encontro mirando los nombres PARECIDOS antes de escribir el insert.
--
-- ── LOS VALORES NO ESTAN INVENTADOS, PERO TAMPOCO SON UNANIMES ──────────────
--
-- Se tomaron de como estan hoy las personas del MISMO cargo. Medido:
--
--   LOAN OFFICER          21 de 24 con lo=true, bm=false, prod=false, role_raw='LO'
--   BUSINESS DEVELOPMENT   2 de 4  con staff_type='BDR', role_raw='BDR'   ⚠
--   LO ASSISTANT           2 de 4  con lo=true y 2 de 4 con lo=false      ⚠
--   Administrative Assistant  NINGUN ejemplo en el roster activo          ⚠
--
-- ⚠ Las tres marcadas son decisiones y no lecturas, y por eso van dichas:
--
--   · Anahis Navarrete -> 'BDR', que es la mitad mas frecuente de cuatro. Si
--     Isabella dice que es 'BD', es cambiar una palabra.
--   · Jeovanni Diaz y Violeta Arteaga -> `is_loan_officer = false`, siguiendo
--     `roster_current.is_producer`, que en las dos es `false`. La tabla esta
--     partida al medio, asi que se eligio la fuente que decide quien produce
--     en el resto de la app -- la misma por la que Aimmee Buendia es
--     `LO ASSISTANT` y SI produce.
--   · Patricia Salgado -> todo en false, incluido `is_support`. No hay ningun
--     `Administrative Assistant` en el roster activo del que copiar, y un
--     `is_support = true` mal puesto la mueve de bucket sin que nadie lo note.
--     El `false` es el default de la columna: no afirma nada.
--
-- Ninguna de las tres cambia un numero hoy: los tres no producen.
--
-- ── LO QUE ESTE ARCHIVO NO HACE ─────────────────────────────────────────────
--
-- No toca `org.employee_branch`. 57 de las personas activas de `dim_employee`
-- tampoco tienen fila ahi, asi que tenerla no es la convencion y agregarla
-- seria un cambio aparte, con su propia razon.
--
-- ============================================================================

begin;

-- ── 1. Belkys: enlazar la fila que ya existe ────────────────────────────────
--
-- El `where person_code is null` no es decoracion: si alguien ya la enlazo,
-- esta sentencia toca CERO filas y el `returning` lo muestra vacio. Un update
-- que no matchea nada se parece demasiado a uno que funciono.

update org.dim_employee
   set person_code = 'belkys.fernandez'
 where employee_key = 120
   and full_name = 'Belkys Fernandez'
   and person_code is null
returning employee_key, full_name, person_code;

-- ── 2. Los cinco que no tienen fila ─────────────────────────────────────────
--
-- ⚠ `employee_key` es `generated always as identity`: NO se lista. Pasarle un
-- valor obliga a `overriding system value` y desincroniza la secuencia.
--
-- El `where not exists` hace la sentencia repetible: corrida dos veces, la
-- segunda inserta cero y el `returning` lo dice. Sin el, la segunda corrida
-- chocaria contra el UNIQUE de `full_name`.

insert into org.dim_employee
  (full_name, email, person_code, country, is_loan_officer, is_branch_manager,
   is_producing, is_support, staff_type, role_raw, roster_status, source)
select v.full_name, v.email, v.person_code, v.country, v.is_loan_officer, false,
       false, false, v.staff_type, v.role_raw, 'Active', 'roster'
from (values
  -- El unico que produce. Los valores son los de los otros 21 LOAN OFFICER.
  ('Arnaldo Ortega Betancourt', 'arnaldo.ortega@supremelending.com', 'arnaldo.ortega', 'US', true,  null::text, 'LO'),
  -- ⚠ 'BDR' es la mitad mas frecuente de cuatro. Ver la nota de arriba.
  ('Anahis Navarrete',          'anahis.navarrete@supremelending.com', 'anahis.navarrete', 'US', false, 'BDR', 'BDR'),
  -- ⚠ `is_loan_officer = false` sigue a `roster_current.is_producer`.
  ('Jeovanni Diaz Jr',          'jeovanni.diaz@supremelending.com',  'jeovanni.diaz',  'US', false, null,  null),
  ('Violeta Arteaga',           'violeta.arteaga@supremelending.com', 'violeta.arteaga', 'US', false, null,  null),
  -- ⚠ Sin ejemplo del que copiar. Todo en false no afirma nada.
  ('Patricia Salgado',          'patricia.salgado@supremelending.com', 'patricia.salgado', 'US', false, null,  null)
) as v(full_name, email, person_code, country, is_loan_officer, staff_type, role_raw)
where not exists (
  select 1 from org.dim_employee d
   where d.person_code = v.person_code or d.full_name = v.full_name
)
returning employee_key, full_name, person_code, is_loan_officer;

-- ── 3. El alias por `person_code`, que es la convencion ─────────────────────
--
-- 117 de las 127 filas de `dim_employee` tienen uno. Es la via por la que
-- `loan_records_v2.loan_officer_person_code` resuelve sin depender del nombre,
-- y es justo lo que hace que Ana Manjarres --que se escribe de cinco formas
-- distintas, una de ellas con `z`-- resuelva igual.
--
-- ⚠ `match_method` dice de DONDE sale esta fila, no que metodo la encontro:
-- estas se siembran desde el `person_code` del roster, en septiembre.

insert into org.employee_alias (source_system, name_raw, employee_key, match_method)
select 'person_code', d.person_code, d.employee_key, 'person-code-2026-09'
from org.dim_employee d
where d.person_code in ('arnaldo.ortega', 'anahis.navarrete', 'jeovanni.diaz',
                        'violeta.arteaga', 'patricia.salgado', 'belkys.fernandez')
  and not exists (
    select 1 from org.employee_alias a
     where a.employee_key = d.employee_key and a.source_system = 'person_code'
  )
returning employee_key, name_raw, source_system, match_method;

commit;

-- ============================================================================
-- COMO COMPROBARLO — EN OTRA SENTENCIA, DESPUES DEL COMMIT
-- ============================================================================
--
-- ⚠ NO va junto a los inserts en una sentencia con CTE: los `select` de la
-- misma sentencia ven el snapshot ANTERIOR, asi que contarian lo de antes y
-- diria que no paso nada. Ya costo una vez.
--
-- ⚠ Y las claves NO se escriben a mano. Se leen. Una constante tipeada en una
-- prueba es una suposicion sobre los datos disfrazada de dato.
--
-- Tiene que dar 0:
--
--   select count(*) as productores_sin_dim
--     from org.roster_current r
--    where r.is_active and r.is_producer
--      and not exists (select 1 from org.dim_employee d
--                       where d.person_code = r.person_code);
--
-- Y esto, 0 tambien -- el roster activo entero:
--
--   select count(*) as roster_activo_sin_dim
--     from org.roster_current r
--    where r.is_active
--      and not exists (select 1 from org.dim_employee d
--                       where d.person_code = r.person_code);
--
-- Y que Belkys siga siendo UNA sola persona, que es lo que el update evita:
--
--   select count(*) as filas_de_belkys
--     from org.dim_employee
--    where full_name ilike 'belkys%fern%';        -- tiene que dar 1
--
-- Antes de aplicar, los mismos tres dan 1, 6 y 1.
