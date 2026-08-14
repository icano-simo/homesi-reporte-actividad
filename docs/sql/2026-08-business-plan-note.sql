-- ===========================================================================
-- BP20 — NOTAS DE SEGUIMIENTO EN LOS CUATRO NIVELES
-- ===========================================================================
--
-- ⚠ NO EJECUTADO. Lo aplica el revisor, igual que las migraciones anteriores
-- del módulo. Hasta que se aplique, la app muestra el panel de notas en modo
-- "todavía no disponible" y nombra este archivo: `useNotes` tolera el 404 de
-- PostgREST, no rompe la pantalla.
--
-- Qué resuelve: dejar registro de lo que se habló con el Loan Officer -- qué
-- dijo, qué se acordó, qué quedó pendiente -- pegado al objeto del que se
-- habló, y no en un documento aparte que nadie vuelve a abrir.
--
--
-- ---------------------------------------------------------------------------
-- 1. UNA TABLA, UNA FK POR DESTINO. NO UNA TABLA POLIMÓRFICA.
-- ---------------------------------------------------------------------------
--
-- El atajo habitual para "notas sobre cualquier cosa" es dos columnas sueltas,
-- `entity_type text` y `entity_id bigint`. Se descarta, y no por gusto:
--
--   · `entity_id` no puede tener FK, así que la base deja de saber si el 4.812
--     al que apunta una nota existe. Se puede borrar el nodo y la nota queda
--     colgando, apuntando a un número que ya no es nada.
--   · Tampoco hay cascada: habría que acordarse de borrar las notas a mano cada
--     vez que se borra un funnel, y el día que alguien se olvide quedan
--     huérfanas para siempre.
--   · Y `entity_type` es texto libre: 'node', 'Node' y 'nodo' conviven sin que
--     nada se queje.
--
-- Con una columna por destino, cada una con su FK y su `on delete cascade`, la
-- base garantiza las tres cosas. El precio es una columna más cada vez que
-- aparezca un quinto destino, que es un precio que se paga una vez.
--
-- El check de "exactamente una" es lo que impide el otro extremo: una nota sin
-- destino, o una pegada a un funnel Y a un paso a la vez.
--
--
-- ---------------------------------------------------------------------------
-- 2. QUÉ NIVEL ES CADA COLUMNA
-- ---------------------------------------------------------------------------
--
--   funnel_key                la ESTRATEGIA, en la biblioteca. Nota sobre el
--                             funnel en sí: qué funciona, qué hay que cambiar
--                             en la plantilla. La ve todo el que abra ese
--                             funnel, esté enrolado quien esté.
--
--   enrollment_node_key       la etapa DE UNA PERSONA. Es la copia, no la
--   enrollment_milestone_key  plantilla: "Angela habló con Gian y quedó en
--                             reprogramar" es un hecho del plan de Gian, no de
--                             Social Media B2C. Pegarla a `node` o a
--                             `node_milestone` la haría aparecer en el plan de
--                             todos los que usen esa plantilla.
--
--   employee_key              el PERFIL del Loan Officer. Lo que no cuelga de
--                             ningún paso: contexto, acuerdos generales, por
--                             qué se lo pasó a Watch.
--
--
-- ---------------------------------------------------------------------------
-- 3. SOLO INSERT Y SELECT. NO SE EDITAN NI SE BORRAN.
-- ---------------------------------------------------------------------------
--
-- Mismo criterio que `org.employee_benchmark`: una nota es el registro de lo
-- que se dijo. Poder editarla después convierte el historial en una versión
-- corregida de la historia, y entonces no sirve para lo único para lo que
-- existe -- saber qué se había acordado.
--
-- Se resuelve por AUSENCIA de política: con RLS activo y sin policy de UPDATE
-- ni de DELETE, las dos operaciones quedan vedadas para `authenticated`. El
-- grant tampoco las incluye, así que hay dos cerrojos independientes.
--
-- Si hay que rectificar, se escribe otra nota. Queda el error y la corrección,
-- que es exactamente lo que un registro tiene que mostrar.
--
--
-- ---------------------------------------------------------------------------
-- 4. TODO: PARA EL REVISOR
-- ---------------------------------------------------------------------------
--
-- `business_plan` ya está expuesto en PostgREST desde BP6, así que esta
-- migración NO necesita tocar `pgrst.db_schemas`. No hace falta ningún
-- `alter role`.
-- ===========================================================================

create table if not exists business_plan.note (
  note_key     bigint generated always as identity primary key,

  body         text not null check (length(btrim(body)) > 0),

  -- Quién y cuándo. El email, no el employee_key: quien escribe puede no estar
  -- en el roster (un manager, alguien de sistemas), y el email es lo que trae
  -- la sesión. La policy de abajo obliga a que sea el de quien escribe.
  author_email text not null,
  created_at   timestamptz not null default now(),

  -- Los cuatro destinos. Exactamente uno, ver el check al final.
  funnel_key               bigint references business_plan.funnel (funnel_key) on delete cascade,
  enrollment_node_key      bigint references business_plan.enrollment_node (enrollment_node_key) on delete cascade,
  enrollment_milestone_key bigint references business_plan.enrollment_milestone (enrollment_milestone_key) on delete cascade,
  employee_key             bigint references org.dim_employee (employee_key) on delete cascade,

  constraint note_exactly_one_target check (
    (funnel_key is not null)::int
    + (enrollment_node_key is not null)::int
    + (enrollment_milestone_key is not null)::int
    + (employee_key is not null)::int
    = 1
  )
);

-- Un índice por destino: la consulta real siempre es "las notas de ESTE
-- objeto", nunca un barrido de la tabla entera. Parciales porque tres de las
-- cuatro columnas están en null en cualquier fila dada.
create index if not exists note_funnel_idx
  on business_plan.note (funnel_key, created_at) where funnel_key is not null;
create index if not exists note_enrollment_node_idx
  on business_plan.note (enrollment_node_key, created_at) where enrollment_node_key is not null;
create index if not exists note_enrollment_milestone_idx
  on business_plan.note (enrollment_milestone_key, created_at) where enrollment_milestone_key is not null;
create index if not exists note_employee_idx
  on business_plan.note (employee_key, created_at) where employee_key is not null;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table business_plan.note enable row level security;

drop policy if exists note_select on business_plan.note;
create policy note_select on business_plan.note
  for select to authenticated using (business_plan.has_access());

/*
 * `author_email` se compara contra el email de la sesión: sin esto, cualquiera
 * con acceso al módulo podría insertar una nota firmada por otro. Es la misma
 * cláusula que usa `settings_write` con `updated_by`.
 */
drop policy if exists note_insert on business_plan.note;
create policy note_insert on business_plan.note
  for insert to authenticated
  with check (
    business_plan.has_access()
    and author_email = coalesce(auth.jwt() ->> 'email', '')
  );

-- Sin policy de update ni de delete: las dos quedan vedadas. Es intencional.

grant usage on schema business_plan to authenticated;
grant select, insert on business_plan.note to authenticated;
grant usage, select on all sequences in schema business_plan to authenticated;
