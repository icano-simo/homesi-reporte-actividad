-- ============================================================================
-- BP41 — CORRECCIÓN: la FK del plan quedó más débil de lo que decía el archivo
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor.
--
-- ---------------------------------------------------------------------------
-- QUÉ PASÓ
-- ---------------------------------------------------------------------------
--
-- `2026-09-node-dependencies.sql` se aplicó, y del lado de la PLANTILLA quedó
-- exactamente como estaba escrito -- comprobado leyendo `pg_constraint`:
--
--   funnel_node_depends_fk      FOREIGN KEY (funnel_key, depends_on_node_key)
--                                 REFERENCES funnel_node(funnel_key, node_key)
--   funnel_node_depends_not_self CHECK (...)
--   funnel_node_position_uk     UNIQUE (funnel_key, position) DEFERRABLE
--   funnel_node_dep_order       TRIGGER DEFERRABLE INITIALLY DEFERRED
--
-- Del lado del PLAN quedó otra cosa:
--
--   enrollment_node_depends_fk  FOREIGN KEY (depends_on_enrollment_node_key)
--                                 REFERENCES enrollment_node(enrollment_node_key)
--                                 ON DELETE SET NULL
--
-- Es de UNA columna y no de dos, y con `set null` en vez de `no action`. Y
-- faltan las otras dos piezas del bloque: `enrollment_node_enr_uk` (la unicidad
-- que respalda la FK compuesta) y `enrollment_node_depends_not_self`.
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ IMPORTA — y no es teórico, se reprodujo
-- ---------------------------------------------------------------------------
--
-- 1. UN NODO DE UN PLAN PUEDE ESPERAR AL NODO DE OTRA PERSONA.
--
--    Con la FK de una sola columna, `depends_on_enrollment_node_key` acepta
--    cualquier `enrollment_node` de la base. Comprobado: un PATCH apuntando el
--    nodo de un plan de prueba a un nodo del plan 36 devolvió 200.
--
--    Es exactamente lo que la decisión 3 existía para impedir. Ana (plan 36) y
--    Kiana (plan 47) tienen HOY el mismo funnel, así que el día que algo llene
--    esta columna, desbloquear a una podría desbloquear a la otra.
--
-- 2. `ON DELETE SET NULL` BORRA LA DEPENDENCIA EN SILENCIO.
--
--    Si se saca del plan el nodo que otro esperaba, el que esperaba queda
--    desbloqueado y no queda registro de que alguna vez esperó. Es el patrón de
--    `docs/../AGENTS.md`: lo que compensa una ausencia hace que la ausencia no
--    se note. `no action` en cambio se niega, y la pantalla puede decir por qué.
--
-- NADA ESTÁ ROTO HOY: la columna existe, nada la llena todavía --el fragmento
-- de `activate_funnel` no se escribió-- y hay 0 filas con valor. La corrección
-- va antes de que algo la use, que es el único momento barato.


-- ---------------------------------------------------------------------------
-- LA CORRECCIÓN
-- ---------------------------------------------------------------------------

-- Se cae la FK débil. No hay datos que migrar: 0 filas tienen valor.
alter table business_plan.enrollment_node
  drop constraint if exists enrollment_node_depends_fk;

-- La unicidad que respalda la FK compuesta. La PK ya garantiza que
-- `enrollment_node_key` es único, así que el par también lo es -- pero Postgres
-- exige la constraint DECLARADA para poder referenciarla.
alter table business_plan.enrollment_node
  add constraint enrollment_node_enr_uk unique (enrollment_key, enrollment_node_key);

-- La FK compuesta: el antecesor tiene que ser un nodo DEL MISMO enrolamiento.
--
-- ⚠ `no action` Y NO `set null` NI `restrict`:
--   · `set null` borraría la dependencia sin dejar rastro (ver arriba);
--   · `restrict` se evalúa fila por fila, así que rompería `cancel_funnel`, que
--     borra todos los `enrollment_node` del plan en UN statement;
--   · `no action` se evalúa al final del statement: la cancelación del plan
--     entero pasa, y sacar UN nodo del que otro depende se niega.
--
-- Verificado sobre un plan descartable: `cancel_funnel` borró un plan de 4
-- nodos y 18 steps con una dependencia puesta, sin error.
alter table business_plan.enrollment_node
  add constraint enrollment_node_depends_fk
  foreign key (enrollment_key, depends_on_enrollment_node_key)
  references business_plan.enrollment_node (enrollment_key, enrollment_node_key)
  on delete no action;

alter table business_plan.enrollment_node
  add constraint enrollment_node_depends_not_self
  check (depends_on_enrollment_node_key is null
         or depends_on_enrollment_node_key <> enrollment_node_key);


-- ---------------------------------------------------------------------------
-- CÓMO COMPROBAR QUE QUEDÓ
-- ---------------------------------------------------------------------------
--
-- No alcanza con que el `alter` no dé error: la primera vez tampoco lo dio y
-- quedó otra cosa. Se lee la definición de vuelta:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'business_plan.enrollment_node'::regclass
--     and conname like '%depends%';
--
-- Tiene que decir `FOREIGN KEY (enrollment_key, depends_on_enrollment_node_key)`
-- -- las DOS columnas -- y no traer `ON DELETE SET NULL`.
