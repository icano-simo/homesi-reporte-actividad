-- ============================================================================
-- LOS DUEÑOS DE NPPM SALEN DEL ROSTER, NO DEL HISTORICO — etapa OL43
-- ============================================================================
--
-- NO EJECUTADO. Se entrega para aplicar a mano, como el resto de docs/sql.
--
-- ⚠ REEMPLAZA AL SEED DE `2026-09-nppm-realtor-owner.sql`. Aquel cargo 26
-- vinculos sacados del HISTORICO DE PRESTAMOS --todo codigo de realtor que
-- apareciera en `loan_records_v2`-- y el criterio correcto es otro: el roster
-- de NPPM contratados, `org.nppm_realtor`.
--
-- La diferencia no es de matiz. De los 26 que cargue, DIECINUEVE no son del
-- programa: Santiago Jaraba Chacon (53 prestamos), Walter Mena (29), Pilar
-- Guzman Hamrick (11), Yolanda Rojas, Tony Villeda, Paul Marston... Son
-- realtors con los que la division cierra, y ninguno es un NPPM contratado.
-- Un presupuesto suyo sumando en el bucket NPPM de alguien es un numero que no
-- significa lo que el bucket dice.
--
-- ---------------------------------------------------------------------------
-- EL CRITERIO, Y LO QUE SE MIDIO DE CADA ADVERTENCIA
-- ---------------------------------------------------------------------------
-- `org.nppm_realtor` con `estado = 'contratado' and is_active`. Son 13, y hoy
-- la tabla entera son esas 13 filas: no hay ninguna en otro estado.
--
--   · `sf_nppm_flag` es CONTRASTE, nunca criterio. Medido: de los 12 con cargo
--     NPPM, 8 lo tienen y 4 no --Robert Kravitz, Marina Aguirre-Anthony,
--     Eduardo Martinez Daboud y Valeria Gonzalez Uribe-- y los cuatro son NPPM
--     igual. Un `false` no es un hueco.
--   · `cargo` se compara por `upper(cargo)`. En esta tabla hay DOS grafias
--     --«Non-Producing Production Manager» y «BUSINESS DEVELOPMENT»-- y el
--     tablero escribe una tercera, «Business Development». Por eso la
--     comparacion exacta no sirve aunque hoy, en esta tabla, alcanzara.
--   · `contracted_date` no dice si esta contratado. Acá se ve por el otro lado:
--     CUATRO de los 13 contratados la tienen NULA. La fecha no afirma ni niega;
--     solo `estado` lo dice.
--   · Y un NPPM no origina prestamos. Verificado en pantalla en el 724, 733,
--     776, 703 y 716: ninguno de los 13 se dibuja como fila de Loan Officer.
--     Los 13 estan en `org.roster_current` con `is_producer = false`, que es lo
--     que los mantiene de un solo lado.
--
-- ---------------------------------------------------------------------------
-- ⚠ Y LAS DOS COLUMNAS NUEVAS NO SON LA MISMA PREGUNTA
-- ---------------------------------------------------------------------------
-- `nppm_realtor_code` lo tienen TODOS los realtors: 275 prestamos, 30 codigos
-- distintos. `nppm_is_member` dice si es del programa: 92 de esos 275.
--
-- Filtrar el codigo por pertenencia pierde 183 prestamos, y agrupar por
-- pertenencia perderia 23 de los 30 realtors. Para AGRUPAR va el codigo; para
-- saber si es del programa, la bandera.
--
-- Y las dos fuentes coinciden exactamente, que es la comprobacion que vale:
-- los 92 prestamos con `nppm_is_member` son de los 7 miembros que tienen
-- prestamos, y los 23 realtors de fuera del roster tienen CERO prestamos con
-- la bandera. `org.nppm_realtor` y `nppm_is_member` dicen lo mismo por dos
-- caminos.
--
-- ---------------------------------------------------------------------------
-- QUE HACE
-- ---------------------------------------------------------------------------
-- Borra los 26 vinculos del seed anterior y carga 7: los del roster que tienen
-- historico del que sacar un dueño. Los otros 6 QUEDAN SIN FILA a proposito --
-- ver abajo.
--
-- ⚠ El DELETE corre desde el editor SQL, que es el dueño de la tabla. Desde la
-- app no se puede: OL42 le saco a `authenticated` el grant y la policy de
-- delete, y eso sigue asi -- un vinculo se edita, no se borra.
-- ---------------------------------------------------------------------------

begin;

delete from outlook.nppm_realtor_owner where set_by = 'ol42-default';

-- El dueño es el Loan Officer con mas prestamos de ese NPPM, sin contar los
-- perdidos, pesando primero los cierres que cuentan para la division.
--
-- ⚠ Y LOS SIETE COINCIDEN CON SU BRANCH. El `branch_code` que el roster de
-- NPPM le da a cada uno es el mismo branch del dueño que propone el historico,
-- en los siete casos. Son dos caminos independientes --uno mira prestamos, el
-- otro mira el roster-- y coincidir no era gratis.
insert into outlook.nppm_realtor_owner (nppm_realtor_code, employee_key, set_by, note)
values
  ('nppm_5203107c6acd', 13, 'ol43-roster', 'Jose Lopez Boggio -> Mariano Claudio (724)'),
  ('nppm_a7cea027d81e',  1, 'ol43-roster', 'Fred Gomez -> Ana Zegarra (703)'),
  ('nppm_97f657686c3e', 13, 'ol43-roster', 'Diana Carrasco -> Mariano Claudio (724)'),
  ('nppm_6eb0ca5380b6', 13, 'ol43-roster', 'Daniella Ottone -> Mariano Claudio (724)'),
  ('nppm_fcfa58f2d8f9', 30, 'ol43-roster', 'Estefania Borns -> Aimmee Buendia (733)'),
  ('nppm_16cc9e15a325', 30, 'ol43-roster', 'Daniel Rodriguez -> Aimmee Buendia (733)'),
  ('nppm_5824c0a784ae', 45, 'ol43-roster', 'Laura Delgado -> Silvio Arteaga (776)')
on conflict (nppm_realtor_code) do update
  set employee_key = excluded.employee_key,
      set_by       = excluded.set_by,
      note         = excluded.note;

commit;

-- ---------------------------------------------------------------------------
-- ⚠ LOS SEIS QUE QUEDAN SIN DUEÑO, Y POR QUE NO SE LES INVENTA UNO
-- ---------------------------------------------------------------------------
-- No tienen NI UN PRESTAMO en `loan_records_v2`, ni cerrado ni abierto, asi que
-- el historico no puede proponer nada. Su `branch_code` acota la lista pero no
-- elige: en el 716 y el 733 hay varios Loan Officers, y en el 709 no hay ni
-- branch en la lista de Outlook.
--
--   Robert Kravitz            709   nppm_8af9b1ad15d6
--   Nelson Calderon           716   nppm_960b299d25fd
--   Miguel Ordonez            716   nppm_948c3be94fd3
--   Marina Aguirre-Anthony    733   nppm_665ae68644b9
--   Eduardo Martinez Daboud   760   nppm_786780695cac
--   Valeria Gonzalez Uribe    703   nppm_8a4dc6bef229
--
-- Sin fila, su presupuesto no suma en ningun lado y la pantalla no los muestra
-- --es la regla de OL42, y es la correcta: colgarlos del branch o repartirlos
-- seria inventar una decision que nadie tomo--. Para asignarlos, una fila cada
-- uno con el `employee_key` que corresponda:
--
--   insert into outlook.nppm_realtor_owner (nppm_realtor_code, employee_key, set_by, note)
--   values ('nppm_960b299d25fd', <employee_key>, 'isabella', 'Nelson Calderon -> …');
--
-- ⚠ Y ROBERT KRAVITZ ESTA EN EL BRANCH 709, que no aparece en la lista de
-- Outlook. Antes de asignarle un dueño conviene saber si ese branch entra al
-- modulo o si su produccion se cuenta en otro lado.
--
-- ---------------------------------------------------------------------------
-- ⚠ Y UNA CONSECUENCIA QUE SE VE EL MISMO DIA
-- ---------------------------------------------------------------------------
-- Hay un presupuesto de realtor cargado el 2026-09-16 a las 00:58: Santiago
-- Jaraba Chacon, 1 para octubre. Santiago NO es del programa --53 prestamos,
-- cero con `nppm_is_member`-- asi que al aplicar esto pierde su dueño y su 1
-- DEJA DE SUMAR: el branch 733 vuelve a Own Production 4/4/4 y su tarjeta
-- pierde la fila de NPPM.
--
-- El numero no se borra --sigue en `outlook.budget_total`-- pero deja de
-- contarse. Si ese 1 era para un NPPM del 733, el del roster es Marina
-- Aguirre-Anthony, que es uno de los seis sin dueño.
--
-- ---------------------------------------------------------------------------
-- PARA VERIFICAR, despues de aplicar
-- ---------------------------------------------------------------------------
-- 1. Siete filas, todas del roster contratado:
--
--      select count(*) from outlook.nppm_realtor_owner;                    -- 7
--      select o.nppm_realtor_code from outlook.nppm_realtor_owner o
--        left join org.nppm_realtor r
--          on r.realtor_code = o.nppm_realtor_code
--         and r.estado = 'contratado' and r.is_active
--       where r.realtor_code is null;                                      -- 0 filas
--
-- 2. Y ningun `employee_key` que no exista:
--
--      select o.* from outlook.nppm_realtor_owner o
--        left join org.employee_alias a
--          on a.employee_key = o.employee_key and a.source_system = 'person_code'
--       where a.employee_key is null;                                      -- 0 filas
--
-- 3. En pantalla: el 733 sin fila de NPPM (Santiago perdio el dueño), y el 776
--    con Laura Delgado debajo de NPPM si alguien le fija presupuesto.
