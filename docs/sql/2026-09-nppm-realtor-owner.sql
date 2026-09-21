-- ============================================================================
-- CADA REALTOR NPPM TIENE UN LOAN OFFICER — etapa OL42
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ---------------------------------------------------------------------------
-- QUE PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- El presupuesto de un realtor se fija por realtor --`budget_total` ya lo
-- acepta como sujeto-- pero el bucket `nppm` del Loan Officer se escribe a
-- mano, asi que los dos numeros pueden decir cosas distintas sobre lo mismo.
-- Para que el bucket sea LA SUMA de sus realtors hace falta saber a QUE Loan
-- Officer va cada uno, y eso el dato solo no lo dice: hay realtors que cierran
-- con varios.
--
-- ---------------------------------------------------------------------------
-- POR QUE UN DUEÑO Y NO UN REPARTO
-- ---------------------------------------------------------------------------
-- Repartir por proporcion historica mueve el presupuesto solo: la proporcion
-- cambia con cada cierre, asi que lo fijado hoy se redistribuye mañana sin que
-- nadie lo decida. Y choca con OL30, que ya definio que un realtor proyecta en
-- UN branch --el del ultimo cierre--: a Laura Delgado el reparto le mandaria el
-- 33% al 733, donde ya no proyecta.
--
-- Fijar por PAR (realtor, loan officer) seria mas preciso, y no es expresible
-- hoy: `budget_total` sostiene `num_nonnulls(employee_key, nppm_realtor_code,
-- branch_code) = 1`, asi que el par exige romper ese CHECK o inventar un cuarto
-- sujeto. Un dueño por realtor se expresa con esta tabla y usa el sujeto que ya
-- existe.
--
-- ---------------------------------------------------------------------------
-- ⚠ EL DEFAULT SALE DEL DATO, Y DE TODO EL DATO
-- ---------------------------------------------------------------------------
-- Las filas de abajo son el Loan Officer con mas prestamos de ese realtor, sin
-- contar los perdidos (`Closed Lost`), pesando primero los cierres que cuentan
-- para la division y despues el pipeline abierto.
--
-- El pipeline CUENTA a proposito: la relacion entre un realtor y un Loan
-- Officer no es un cierre. Medir solo los cierres da un universo mas chico que
-- la pregunta --28 realtors contra 16-- y en dos casos da una respuesta falsa:
-- el unico cierre de Daniel Rodriguez es de Anthony DiToma, que no esta en el
-- roster, mientras sus cinco prestamos vivos son de Aimmee y Stephanie; y el
-- unico cierre de Dario Montoya es de Michael Tirio en el branch 203, mientras
-- sus cuatro restantes son de Gian Laino. Con los cierres solos los dos
-- parecian no tener dueño posible, y los dos lo tienen.
--
-- SE EDITA. El default es un punto de partida, no una decision: se cambia desde
-- la pantalla del realtor.
--
-- ⚠ DOS CASOS QUE EL DATO NO RESUELVE, y quedan sin fila a proposito:
--
--   · Lourdes Moscoso: Aimmee Buendia y Stephanie Garcia tienen un prestamo
--     abierto cada una y ningun cierre. La fila esta puesta con Aimmee y
--     marcada: si tiene que ser Stephanie, se cambia.
--   · Lizandra Diaz y Jesus Garcia: NINGUNO de sus Loan Officers esta en el
--     roster. No se les inventa un dueño -- sin fila, su presupuesto no suma en
--     ningun lado y la pantalla lo dice.
-- ---------------------------------------------------------------------------

begin;

create table if not exists outlook.nppm_realtor_owner (
  nppm_realtor_code text primary key,
  employee_key      integer not null,
  set_by            text,
  note              text,
  -- ⚠ SIN `updated_at`: no hay trigger que lo mantenga, y una columna que dice
  -- «ultima edicion» y nunca cambia miente con mas autoridad que no estar. La
  -- fecha de la ultima edicion se sabra el dia que haya una pantalla que edite
  -- el vinculo y escriba su propio rastro.
  created_at        timestamptz not null default now()
);

comment on table outlook.nppm_realtor_owner is
  'OL42: a que Loan Officer se le suma el presupuesto de este realtor NPPM. '
  'Un vinculo, no una decision con historia: se edita en su lugar, sin '
  'revisiones -- mismo criterio que org.branch_group.';

alter table outlook.nppm_realtor_owner enable row level security;

-- ---------------------------------------------------------------------------
-- ⚠ EL CRITERIO DE ACCESO ES `outlook.has_access()`, Y NO SE REESCRIBE ACA
-- ---------------------------------------------------------------------------
-- La primera version de este archivo escribia el chequeo a mano:
--
--     using (coalesce((auth.jwt() -> 'app_metadata' ->> 'outlook')::boolean, false))
--
-- y NO HABRIA FUNCIONADO NUNCA. El claim no es un objeto con claves booleanas
-- sino `allowed_apps`, un arreglo: `app_metadata ->> 'outlook'` da null, el
-- coalesce da false, y nadie habria podido escribir jamas -- una tabla de solo
-- lectura sin que nadie lo decidiera.
--
-- `outlook.has_access()` --`(app_metadata -> 'allowed_apps') ? 'outlook'`--
-- existe justamente para eso, y su propia nota lo dice: se define como funcion
-- «para que el dia que el criterio cambie, cambie en un solo lugar». Escribirlo
-- a mano habria sido la copia numero dos, con el agravante de que esta estaba
-- mal.
drop policy if exists nppm_realtor_owner_select on outlook.nppm_realtor_owner;
create policy nppm_realtor_owner_select on outlook.nppm_realtor_owner
  for select to authenticated using (outlook.has_access());

drop policy if exists nppm_realtor_owner_insert on outlook.nppm_realtor_owner;
create policy nppm_realtor_owner_insert on outlook.nppm_realtor_owner
  for insert to authenticated with check (outlook.has_access());

drop policy if exists nppm_realtor_owner_update on outlook.nppm_realtor_owner;
create policy nppm_realtor_owner_update on outlook.nppm_realtor_owner
  for update to authenticated
  using (outlook.has_access()) with check (outlook.has_access());

-- ⚠ NI GRANT NI POLICY DE `delete`, a proposito. El vinculo se EDITA: un
-- realtor cambia de Loan Officer, no deja de tener uno. Y un delete sin nada
-- que lo distinga permite vaciar la tabla entera, que es la unica operacion de
-- esta etapa que no se puede deshacer leyendo -- las demas dejan la fila con
-- otro valor. El dia que haga falta DESASIGNAR a alguien, eso es una decision
-- que se modela (una columna que diga por que, o un `employee_key` nulo con su
-- motivo), no un borrado en silencio.
--
-- ⚠ Y EL GRANT NO SE HEREDA del schema: `business_plan.area` quedo como la
-- unica tabla sin grant de nueve y rompio una pantalla que ni la menciona.
grant select, insert, update on outlook.nppm_realtor_owner to authenticated;

-- El default del dato, para editar. `employee_key` y no `person_code`: es la
-- columna con la que se une `budget_total`.
insert into outlook.nppm_realtor_owner (nppm_realtor_code, employee_key, set_by, note)
values
  ('nppm_16cc9e15a325', 30, 'ol42-default', 'Daniel Rodriguez -> Aimmee Buendia Hinojosa'),
  ('nppm_6ec746eca446', 30, 'ol42-default', 'Santiago Jaraba Chacon -> Aimmee Buendia Hinojosa'),
  ('nppm_4eb25a479259', 30, 'ol42-default', 'Pilar Guzman Hamrick -> Aimmee Buendia Hinojosa'),
  ('nppm_400f32e80c74',  1, 'ol42-default', 'Tony Villeda -> Ana Zegarra'),
  ('nppm_a7cea027d81e',  1, 'ol42-default', 'FRED A GOMEZ -> Ana Zegarra'),
  ('nppm_d09cf374307b', 30, 'ol42-default', 'Yolanda Rojas -> Aimmee Buendia Hinojosa'),
  ('nppm_5203107c6acd', 13, 'ol42-default', 'Jose Boggio -> Mariano Claudio'),
  ('nppm_0ba2c0de021e',  6, 'ol42-default', 'Aida Villalobos -> Stephanie Garcia Garzon'),
  ('nppm_c5d8986db10b',  3, 'ol42-default', 'Estuardo Perez -> Nathan Martinez'),
  ('nppm_5824c0a784ae', 45, 'ol42-default', 'Laura Delgado -> Silvio Arteaga'),
  ('nppm_b8d7f1fda733', 30, 'ol42-default', 'EMPATE con Stephanie Garcia: Lourdes Moscoso -> Aimmee Buendia Hinojosa'),
  ('nppm_e1fc0327e096', 25, 'ol42-default', 'LUCIO ROMERO -> Kiana Smith'),
  ('nppm_f746a8af4b17', 10, 'ol42-default', 'Jenny Caceres -> Juseth Castro'),
  ('nppm_1e165d240c97', 30, 'ol42-default', 'Artemisa, Boston -> Aimmee Buendia Hinojosa'),
  ('nppm_dcfee169b3ad', 12, 'ol42-default', 'Dario Montoya -> Gian Laino'),
  ('nppm_ad440a3e5e56',  6, 'ol42-default', 'Moises, Nalvarte -> Stephanie Garcia Garzon'),
  ('nppm_4b0f953d52f8', 12, 'ol42-default', 'Sandra Reyna -> Gian Laino'),
  ('nppm_97f657686c3e', 13, 'ol42-default', 'Diana Carrasco -> Mariano Claudio'),
  ('nppm_04d84d768963', 12, 'ol42-default', 'JUAN NUNEZ -> Gian Laino'),
  ('nppm_d2481ccd46f1',  3, 'ol42-default', 'Jonathan Mendoza -> Nathan Martinez'),
  ('nppm_fcfa58f2d8f9', 30, 'ol42-default', 'Estefania Borns -> Aimmee Buendia Hinojosa'),
  ('nppm_257200fe9122', 30, 'ol42-default', 'Paul Marston -> Aimmee Buendia Hinojosa'),
  ('nppm_de066c0c24f9', 30, 'ol42-default', 'Ana Hardy -> Aimmee Buendia Hinojosa'),
  ('nppm_e140a340c694', 25, 'ol42-default', 'David Cepeda -> Kiana Smith'),
  ('nppm_6eb0ca5380b6', 13, 'ol42-default', 'Daniela Ottone -> Mariano Claudio'),
  ('nppm_2a244823d8b1', 10, 'ol42-default', 'ELVIRA HANNA -> Juseth Castro')
on conflict (nppm_realtor_code) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- PARA VERIFICAR, despues de aplicar
-- ---------------------------------------------------------------------------
-- 0. Que la policy deje escribir DE VERDAD, que es lo que la version anterior
--    de este archivo no habria hecho:
--
--      select outlook.has_access();                                    -- true
--      update outlook.nppm_realtor_owner set note = note
--       where nppm_realtor_code = 'nppm_4b0f953d52f8';                 -- 1 fila
--
--    Y que borrar no se pueda:
--
--      delete from outlook.nppm_realtor_owner
--       where nppm_realtor_code = 'nppm_4b0f953d52f8';                 -- 0 filas
--
--    ⚠ Cero filas borradas y no un error: sin policy de delete, RLS filtra en
--    vez de rechazar. Es la misma distincion que ya mordio en este repo --cero
--    filas con `error: null` es una policy que no aplica-- y aca juega a favor.
--
-- 1. Veintiseis filas, y ningun `employee_key` que no exista:
--
--      select count(*) from outlook.nppm_realtor_owner;                -- 26
--      select o.* from outlook.nppm_realtor_owner o
--        left join org.employee_alias a
--          on a.employee_key = o.employee_key and a.source_system = 'person_code'
--       where a.employee_key is null;                                  -- 0 filas
--
-- 2. Y en pantalla: el editor de un Loan Officer ya NO deja escribir `nppm`
--    --el numero sale de sus realtors-- y el Budget composition del branch
--    abre la fila de NPPM en sus realtors. Con cero presupuestos de realtor
--    cargados, ese bucket da cero en los 18: es lo correcto, y es lo que hace
--    que el invariante de OL39 siga en 12 de 12.
