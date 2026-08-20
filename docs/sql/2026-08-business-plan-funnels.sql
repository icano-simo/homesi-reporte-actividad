-- ===========================================================================
-- business_plan — funnels, nodos, milestones y planes activos
-- ===========================================================================
--
-- Etapa BP12, fase 1.
--
-- ⚠ NO EJECUTADA POR QUIEN ESCRIBIÓ ESTE ARCHIVO. La aplica el revisor.
--
-- ---------------------------------------------------------------------------
-- LA DECISIÓN QUE ORDENA TODO EL MODELO: PLANTILLA vs INSTANCIA
-- ---------------------------------------------------------------------------
-- Hay DOS mitades y no se tocan:
--
--   PLANTILLAS   funnel · node · funnel_node · node_milestone · node_owner
--                La biblioteca. Se edita y se borra libremente.
--
--   INSTANCIAS   enrollment · enrollment_node · enrollment_milestone
--                El plan de UNA persona. Al enrolarse se COPIA de la
--                plantilla; no la referencia.
--
-- Por qué copia y no referencia: si el plan apuntara a la plantilla, editar un
-- funnel en la biblioteca cambiaría retroactivamente el plan de todos los
-- enrolados. Alguien con 11 de 19 milestones hechos pasaría de golpe a otro
-- plan y su progreso dejaría de significar nada. Es el mismo principio que ya
-- rige el histórico de forecast: lo que pasó no se recalcula cuando cambian las
-- reglas.
--
-- Eso es también lo que permite EDITAR el plan de una persona sin afectar a
-- nadie más, y por eso no hace falta crear una plantilla por cada variación --
-- en un año habría cuarenta funnels casi idénticos y nadie sabría cuál usar.
-- ===========================================================================


-- ===========================================================================
-- 1. PLANTILLAS
-- ===========================================================================

create table if not exists business_plan.funnel (
  funnel_key      bigint generated always as identity primary key,
  name            text not null,
  category        text not null check (category in ('core', 'growth')),
  description     text,
  icon            text,

  -- Duración NOMINAL, la que se publica en la tarjeta del catálogo ("~10
  -- weeks"). No se confunde con los rangos de días de cada nodo, que NO se
  -- guardan: se calculan de los SLA y de la posición del nodo, para que al
  -- reordenar la secuencia las fechas se recalculen solas.
  duration_weeks  integer check (duration_weeks > 0),

  position        integer not null default 0,

  -- Desactivar en vez de borrar: un funnel con enrolamientos NO se puede
  -- borrar (ver la FK de enrollment, que es RESTRICT). Desactivado deja de
  -- aparecer en el catálogo y los planes en curso siguen.
  is_active       boolean not null default true,

  -- Marca los ejemplos sembrados por este archivo, para que se puedan
  -- distinguir de lo que carga el negocio y borrar en bloque.
  is_example      boolean not null default false,

  created_at      timestamptz not null default now(),
  created_by      text
);

/*
 * Los nodos son REUTILIZABLES entre funnels: "Social Media Setup" aparece en
 * dos funnels del ejemplo y tiene que ser la MISMA fila. Por eso `node` es una
 * tabla propia y no una columna de `funnel_node`.
 */
create table if not exists business_plan.node (
  node_key    bigint generated always as identity primary key,
  name        text not null unique,
  description text,
  icon        text,
  is_example  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  text
);

/*
 * Puente funnel ↔ nodo CON POSICIÓN. La posición es la secuencia, y es lo que
 * reordena el drag and drop del constructor.
 *
 * No hay coordenadas ni lienzo: estos funnels son lineales (cinco nodos en
 * fila). Un lienzo con posiciones libres agregaría estado y complejidad sin
 * cambiar nada de lo que el usuario puede expresar. Si algún día se necesitan
 * bifurcaciones, se extiende sobre esto.
 */
create table if not exists business_plan.funnel_node (
  funnel_key bigint not null references business_plan.funnel (funnel_key) on delete cascade,
  node_key   bigint not null references business_plan.node (node_key) on delete cascade,
  position   integer not null,
  primary key (funnel_key, node_key)
);
create index if not exists funnel_node_order_idx on business_plan.funnel_node (funnel_key, position);

/*
 * Los milestones cuelgan del NODO, no del par funnel+nodo. Es la consecuencia
 * de que el nodo sea reutilizable: "Cold Calling" tiene los mismos seis
 * milestones aparezca en el funnel que aparezca. Si el negocio necesitara los
 * mismos pasos con distinto contenido según el funnel, eso sería otro nodo.
 */
create table if not exists business_plan.node_milestone (
  milestone_key            bigint generated always as identity primary key,
  node_key                 bigint not null references business_plan.node (node_key) on delete cascade,
  title                    text not null,

  -- El responsable es una PERSONA, no un rol. Con un rol no se puede saber
  -- quién tiene permiso de marcar el milestone como hecho, que es exactamente
  -- lo que el portal necesita resolver.
  accountable_employee_key bigint references org.dim_employee (employee_key) on delete set null,

  -- Días desde el inicio del NODO. De acá salen los rangos "DAY 1-5".
  sla_days                 integer check (sla_days >= 0),
  resource_url             text,
  position                 integer not null default 0,
  created_at               timestamptz not null default now()
);
create index if not exists node_milestone_order_idx on business_plan.node_milestone (node_key, position);

/*
 * Responsables del NODO. Puente y no una columna porque puede haber más de uno
 * -- en el mockup un nodo muestra dos personas.
 */
create table if not exists business_plan.node_owner (
  node_key     bigint not null references business_plan.node (node_key) on delete cascade,
  employee_key bigint not null references org.dim_employee (employee_key) on delete cascade,
  primary key (node_key, employee_key)
);


-- ===========================================================================
-- 2. INSTANCIAS — el plan de una persona
-- ===========================================================================

/*
 * Un Loan Officer se enrola en UN funnel. El índice único parcial es lo que lo
 * impone: puede tener varios enrolamientos a lo largo del tiempo, pero sólo
 * uno activo a la vez. Sin esto, dos clics seguidos en "Activate" dejarían dos
 * planes vivos y el portal no sabría cuál mostrar.
 */
create table if not exists business_plan.enrollment (
  enrollment_key bigint generated always as identity primary key,
  employee_key   bigint not null references org.dim_employee (employee_key) on delete cascade,

  -- RESTRICT y no CASCADE: un funnel con enrolamientos NO se puede borrar. La
  -- base lo impide, no sólo la interfaz.
  funnel_key     bigint not null references business_plan.funnel (funnel_key) on delete restrict,

  -- Copia del nombre al momento de activar. Si mañana renombran la plantilla,
  -- el plan sigue diciendo con qué se activó.
  funnel_name    text not null,

  status         text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  activated_at   timestamptz not null default now(),
  activated_by   text not null,
  completed_at   timestamptz
);
create unique index if not exists enrollment_one_active_idx
  on business_plan.enrollment (employee_key) where status = 'active';

create table if not exists business_plan.enrollment_node (
  enrollment_node_key bigint generated always as identity primary key,
  enrollment_key      bigint not null references business_plan.enrollment (enrollment_key) on delete cascade,

  -- Trazabilidad, no dependencia: SET NULL para que borrar un nodo de la
  -- biblioteca no rompa un plan en curso. El plan ya tiene su propia copia.
  source_node_key     bigint references business_plan.node (node_key) on delete set null,

  name                text not null,
  description         text,
  icon                text,
  position            integer not null
);
create index if not exists enrollment_node_order_idx on business_plan.enrollment_node (enrollment_key, position);

create table if not exists business_plan.enrollment_milestone (
  enrollment_milestone_key bigint generated always as identity primary key,
  enrollment_node_key      bigint not null
    references business_plan.enrollment_node (enrollment_node_key) on delete cascade,
  source_milestone_key     bigint references business_plan.node_milestone (milestone_key) on delete set null,

  title                    text not null,
  accountable_employee_key bigint references org.dim_employee (employee_key) on delete set null,
  resource_url             text,

  -- Resuelta al copiar: fecha de activación + los SLA acumulados.
  due_date                 date,

  status                   text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done')),
  completed_at             timestamptz,
  completed_by             text,
  position                 integer not null default 0
);
create index if not exists enrollment_milestone_order_idx
  on business_plan.enrollment_milestone (enrollment_node_key, position);


-- ===========================================================================
-- 3. La FK que quedó pendiente en BP5
-- ===========================================================================
--
-- `business_plan.intervention.funnel_key` existe desde BP5 sin FK, esperando
-- este catálogo. Se iguala el tipo y se agrega la referencia.
alter table business_plan.intervention
  alter column funnel_key type bigint using funnel_key::bigint;

alter table business_plan.intervention
  drop constraint if exists intervention_funnel_fk;
alter table business_plan.intervention
  add constraint intervention_funnel_fk
  foreign key (funnel_key) references business_plan.funnel (funnel_key) on delete set null;


-- ===========================================================================
-- 4. RLS
-- ===========================================================================

alter table business_plan.funnel               enable row level security;
alter table business_plan.node                 enable row level security;
alter table business_plan.funnel_node          enable row level security;
alter table business_plan.node_milestone       enable row level security;
alter table business_plan.node_owner           enable row level security;
alter table business_plan.enrollment           enable row level security;
alter table business_plan.enrollment_node      enable row level security;
alter table business_plan.enrollment_milestone enable row level security;

/*
 * Las tablas de PLANTILLA llevan las cuatro operaciones, DELETE incluido. Es la
 * excepción al criterio de solo-append que rige el benchmark, y es correcta
 * porque una plantilla no es un registro histórico: es configuración. Borrar un
 * funnel que nadie usa no borra nada que haya pasado.
 */
do $$
declare t text;
begin
  foreach t in array array['funnel', 'node', 'funnel_node', 'node_milestone', 'node_owner']
  loop
    execute format('drop policy if exists %I_all on business_plan.%I', t, t);
    execute format(
      'create policy %I_all on business_plan.%I for all to authenticated
         using (business_plan.has_access()) with check (business_plan.has_access())', t, t);
  end loop;
end $$;

-- Enrolamiento y sus nodos: lectura, alta, edición y baja.
do $$
declare t text;
begin
  foreach t in array array['enrollment', 'enrollment_node']
  loop
    execute format('drop policy if exists %I_all on business_plan.%I', t, t);
    execute format(
      'create policy %I_all on business_plan.%I for all to authenticated
         using (business_plan.has_access()) with check (business_plan.has_access())', t, t);
  end loop;
end $$;

/*
 * ⚠ LOS MILESTONES YA COMPLETADOS NO SE PUEDEN BORRAR NI REABRIR.
 *
 * Marcar algo como hecho SÍ es un hecho histórico, a diferencia de la
 * plantilla. Se resuelve con RLS y no con un trigger porque el `using` de una
 * política de UPDATE/DELETE se evalúa sobre la fila EXISTENTE:
 *
 *   using (status <> 'done')   ->  una fila que ya está en 'done' es invisible
 *                                  para UPDATE y para DELETE.
 *
 * Marcarla como hecha sigue funcionando: en ese momento la fila todavía está
 * en 'pending' o 'in_progress', así que pasa el `using`. Lo que queda vedado es
 * tocarla DESPUÉS.
 *
 * Cuatro políticas separadas en vez de un `for all`, justamente porque select e
 * insert no llevan esa restricción.
 */
drop policy if exists enrollment_milestone_select on business_plan.enrollment_milestone;
create policy enrollment_milestone_select on business_plan.enrollment_milestone
  for select to authenticated using (business_plan.has_access());

drop policy if exists enrollment_milestone_insert on business_plan.enrollment_milestone;
create policy enrollment_milestone_insert on business_plan.enrollment_milestone
  for insert to authenticated with check (business_plan.has_access());

drop policy if exists enrollment_milestone_update on business_plan.enrollment_milestone;
create policy enrollment_milestone_update on business_plan.enrollment_milestone
  for update to authenticated
  using (business_plan.has_access() and status <> 'done')
  with check (business_plan.has_access());

drop policy if exists enrollment_milestone_delete on business_plan.enrollment_milestone;
create policy enrollment_milestone_delete on business_plan.enrollment_milestone
  for delete to authenticated
  using (business_plan.has_access() and status <> 'done');

grant usage on schema business_plan to authenticated;
grant select, insert, update, delete on all tables in schema business_plan to authenticated;
grant usage, select on all sequences in schema business_plan to authenticated;


-- ===========================================================================
-- 5. DATOS DE EJEMPLO — son datos, no código. Todos borrables.
-- ===========================================================================
--
-- Se marcan con `is_example = true` para poder barrerlos en bloque:
--
--   delete from business_plan.funnel where is_example;
--   delete from business_plan.node   where is_example;
--
-- Los responsables se buscan por `full_name` contra el equipo de soporte
-- (`is_support = true`), no por clave a mano: la clave es interna y el nombre
-- es lo que alguien puede verificar leyendo este archivo.

-- ── Nodos ────────────────────────────────────────────────────────────────
insert into business_plan.node (name, description, icon, is_example, created_by) values
  ('Social Media Setup',   'Profiles, branding and posting cadence in place.',        'grid',     true, 'seed (BP12)'),
  ('Marketing Campaigns',  'Paid and organic campaigns live with tracked results.',   'trending', true, 'seed (BP12)'),
  ('AI WhatsApp',          'Automated first-touch and qualification over WhatsApp.',  'target',   true, 'seed (BP12)'),
  ('Sales Call',           'Structured discovery call with a qualified lead.',        'users',    true, 'seed (BP12)'),
  ('Application',          'Lead converted into a submitted application.',            'file',     true, 'seed (BP12)'),
  ('Cold Calling',         'Outbound calling to a seeded realtor list.',              'target',   true, 'seed (BP12)'),
  ('Consultative Mtg',     'Consultative meeting with a realtor prospect.',           'users',    true, 'seed (BP12)'),
  ('Realtor Activation',   'Realtor signed up and receiving co-marketing.',           'building', true, 'seed (BP12)'),
  ('Pipeline Sharing',     'Shared pipeline reviews with the activated realtor.',     'chart',    true, 'seed (BP12)'),
  ('Database Segmentation','Past clients segmented by rate, equity and tenure.',      'grid',     true, 'seed (BP12)'),
  ('Reactivation Campaign','Outreach sequence to the segmented database.',            'trending', true, 'seed (BP12)'),
  ('Referral Ask',         'Structured referral request to reactivated clients.',     'users',    true, 'seed (BP12)'),
  ('Prospect List Build',  'Direct-to-consumer prospect list assembled and cleaned.', 'grid',     true, 'seed (BP12)'),
  ('Door Knocking',        'Field outreach on the mapped prospect list.',             'building', true, 'seed (BP12)'),
  ('Follow-up Sequence',   'Multi-touch follow-up after the first contact.',          'target',   true, 'seed (BP12)'),
  ('Builder Partnership',  'Relationship opened with a local builder.',               'building', true, 'seed (BP12)'),
  ('Event Hosting',        'Homebuyer seminar hosted with a partner.',                'users',    true, 'seed (BP12)'),
  ('Community Presence',   'Recurring presence in a local community channel.',        'trending', true, 'seed (BP12)')
on conflict (name) do nothing;

-- ── Funnels ──────────────────────────────────────────────────────────────
insert into business_plan.funnel (name, category, description, icon, duration_weeks, position, is_example, created_by) values
  ('Social Media B2C',      'core',   'Build an inbound consumer pipeline from social presence to application.', 'trending', 10, 1, true, 'seed (BP12)'),
  ('Realtor Outreach B2B',  'core',   'Open and activate realtor partnerships through structured outbound.',     'building',  8, 2, true, 'seed (BP12)'),
  ('Database Reactivation', 'core',   'Bring past clients back with segmentation and a reactivation sequence.',  'grid',      6, 3, true, 'seed (BP12)'),
  ('Direct Outreach B2C',   'core',   'Reach consumers directly through field outreach and follow-up.',          'target',    8, 4, true, 'seed (BP12)'),
  ('Builder Alliances',     'growth', 'EXAMPLE. Grow volume through builder partnerships and events.',           'building', 12, 5, true, 'seed (BP12)'),
  ('Community Referrals',   'growth', 'EXAMPLE. Turn recurring community presence into a referral engine.',      'users',    10, 6, true, 'seed (BP12)')
on conflict do nothing;

-- ── Secuencias ───────────────────────────────────────────────────────────
insert into business_plan.funnel_node (funnel_key, node_key, position)
select f.funnel_key, n.node_key, s.position
from (values
  ('Social Media B2C',      'Social Media Setup',    1),
  ('Social Media B2C',      'Marketing Campaigns',   2),
  ('Social Media B2C',      'AI WhatsApp',           3),
  ('Social Media B2C',      'Sales Call',            4),
  ('Social Media B2C',      'Application',           5),
  ('Realtor Outreach B2B',  'Social Media Setup',    1),
  ('Realtor Outreach B2B',  'Cold Calling',          2),
  ('Realtor Outreach B2B',  'Consultative Mtg',      3),
  ('Realtor Outreach B2B',  'Realtor Activation',    4),
  ('Realtor Outreach B2B',  'Pipeline Sharing',      5),
  ('Database Reactivation', 'Database Segmentation', 1),
  ('Database Reactivation', 'Reactivation Campaign', 2),
  ('Database Reactivation', 'Sales Call',            3),
  ('Database Reactivation', 'Referral Ask',          4),
  ('Direct Outreach B2C',   'Prospect List Build',   1),
  ('Direct Outreach B2C',   'Door Knocking',         2),
  ('Direct Outreach B2C',   'Follow-up Sequence',    3),
  ('Direct Outreach B2C',   'Sales Call',            4),
  ('Direct Outreach B2C',   'Application',           5),
  ('Builder Alliances',     'Builder Partnership',   1),
  ('Builder Alliances',     'Event Hosting',         2),
  ('Builder Alliances',     'Sales Call',            3),
  ('Community Referrals',   'Community Presence',    1),
  ('Community Referrals',   'Event Hosting',         2),
  ('Community Referrals',   'Referral Ask',          3)
) as s(funnel_name, node_name, position)
join business_plan.funnel f on f.name = s.funnel_name
join business_plan.node   n on n.name = s.node_name
on conflict do nothing;

-- Nótese que "Social Media Setup" queda compartido entre dos funnels, y
-- "Sales Call" entre cuatro: una sola fila de `node`, varias de `funnel_node`.
-- Eso es el punto de que el nodo sea reutilizable.

-- ── Milestones ───────────────────────────────────────────────────────────
-- Los de Cold Calling son los del mockup. El resto son plausibles y borrables.
insert into business_plan.node_milestone (node_key, title, accountable_employee_key, sla_days, position)
select n.node_key, s.title, e.employee_key, s.sla_days, s.position
from (values
  ('Cold Calling', 'Receive B2B playbook',                 'Juanjo Cabrera',  2,  1),
  ('Cold Calling', 'Cold-call methodology training',       'Juanjo Cabrera',  4,  2),
  ('Cold Calling', 'Receive 100-realtor seed list',        'Isabella Cano',   5,  3),
  ('Cold Calling', 'Week 1 · 50 calls verified',           'Isabella Cano',  12,  4),
  ('Cold Calling', 'Week 2 · 50 calls verified',           'Isabella Cano',  19,  5),
  ('Cold Calling', 'Week 3 · 50 calls verified',           'Isabella Cano',  26,  6),

  ('Social Media Setup',    'Profiles audited and rebranded',      'Angela Freile',      3, 1),
  ('Social Media Setup',    'Content calendar approved',           'Estefania Escobar',  5, 2),
  ('Social Media Setup',    'First two weeks scheduled',           'Laura Garcia',       7, 3),

  ('Marketing Campaigns',   'Campaign brief signed off',           'Angela Freile',      3, 1),
  ('Marketing Campaigns',   'Creatives delivered',                 'Estefania Escobar',  6, 2),
  ('Marketing Campaigns',   'Campaign live and tracked',           'Laura Garcia',      10, 3),

  ('AI WhatsApp',           'Number provisioned and verified',     'Javier Penaloza',    3, 1),
  ('AI WhatsApp',           'Qualification script approved',       'Juanjo Cabrera',     6, 2),
  ('AI WhatsApp',           'First 50 conversations reviewed',     'Isabella Cano',     12, 3),

  ('Sales Call',            'Discovery script training',           'Juanjo Cabrera',     4, 1),
  ('Sales Call',            'First 10 calls shadowed',             'Juanjo Cabrera',     9, 2),
  ('Sales Call',            'Call outcomes logged',                'Isabella Cano',     12, 3),

  ('Application',           'Submission checklist reviewed',       'Ricardo Cera',       3, 1),
  ('Application',           'First application submitted',         'Fernando Orduz',     8, 2),

  ('Consultative Mtg',      'Meeting deck delivered',              'Estefania Escobar',  3, 1),
  ('Consultative Mtg',      'First 5 meetings held',               'Juanjo Cabrera',    10, 2),
  ('Consultative Mtg',      'Outcomes logged and reviewed',        'Isabella Cano',     14, 3),

  ('Realtor Activation',    'Co-marketing agreement signed',       'Fernando Orduz',     5, 1),
  ('Realtor Activation',    'Joint collateral delivered',          'Angela Freile',     10, 2),

  ('Pipeline Sharing',      'Shared pipeline board set up',        'Isabella Cano',      4, 1),
  ('Pipeline Sharing',      'First joint pipeline review',         'Ricardo Cera',       9, 2),

  ('Database Segmentation', 'Database exported and cleaned',       'Isabella Cano',      3, 1),
  ('Database Segmentation', 'Segments defined and approved',       'Fernando Orduz',     6, 2),

  ('Reactivation Campaign', 'Message sequence approved',           'Estefania Escobar',  4, 1),
  ('Reactivation Campaign', 'Sequence sent to first segment',      'Laura Garcia',       9, 2),
  ('Reactivation Campaign', 'Response rate reviewed',              'Isabella Cano',     14, 3),

  ('Referral Ask',          'Referral script approved',            'Juanjo Cabrera',     4, 1),
  ('Referral Ask',          'First 20 asks completed',             'Isabella Cano',     11, 2),

  ('Prospect List Build',   'Territory mapped',                    'Isabella Cano',      3, 1),
  ('Prospect List Build',   'List cleaned and verified',           'Ricardo Cera',       6, 2),

  ('Door Knocking',         'Field script training',               'Juanjo Cabrera',     4, 1),
  ('Door Knocking',         'Week 1 · 100 doors',                  'Isabella Cano',     11, 2),
  ('Door Knocking',         'Week 2 · 100 doors',                  'Isabella Cano',     18, 3),

  ('Follow-up Sequence',    'Follow-up cadence approved',          'Angela Freile',      4, 1),
  ('Follow-up Sequence',    'Sequence running on all contacts',    'Laura Garcia',       9, 2),

  ('Builder Partnership',   'Target builder list agreed',          'Fernando Orduz',     5, 1),
  ('Builder Partnership',   'First partnership meeting held',      'Juanjo Cabrera',    12, 2),

  ('Event Hosting',         'Venue and date confirmed',            'Ricardo Cera',       7, 1),
  ('Event Hosting',         'Invitations sent',                    'Laura Garcia',      12, 2),
  ('Event Hosting',         'Seminar held and leads captured',     'Angela Freile',     21, 3),

  ('Community Presence',    'Community channels identified',       'Angela Freile',      4, 1),
  ('Community Presence',    'Monthly presence calendar approved',  'Estefania Escobar',  8, 2)
) as s(node_name, title, accountable, sla_days, position)
join business_plan.node n on n.name = s.node_name
left join org.dim_employee e on e.full_name = s.accountable and e.is_support
on conflict do nothing;

-- ── Responsables de nodo (varios por nodo) ───────────────────────────────
insert into business_plan.node_owner (node_key, employee_key)
select n.node_key, e.employee_key
from (values
  ('Cold Calling',        'Juanjo Cabrera'),
  ('Cold Calling',        'Isabella Cano'),
  ('Social Media Setup',  'Angela Freile'),
  ('Social Media Setup',  'Estefania Escobar'),
  ('Marketing Campaigns', 'Angela Freile'),
  ('Marketing Campaigns', 'Laura Garcia'),
  ('AI WhatsApp',         'Javier Penaloza'),
  ('Sales Call',          'Juanjo Cabrera'),
  ('Application',         'Ricardo Cera'),
  ('Application',         'Fernando Orduz')
) as s(node_name, owner)
join business_plan.node n on n.name = s.node_name
join org.dim_employee e on e.full_name = s.owner and e.is_support
on conflict do nothing;


-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
--
-- 1. Un nodo compartido es UNA fila:
--      select n.name, count(*) as funnels
--        from business_plan.node n
--        join business_plan.funnel_node fn using (node_key)
--       group by n.name having count(*) > 1;
--    "Social Media Setup" debe dar 2 y "Sales Call" 4.
--
-- 2. Los conteos de la tarjeta del catálogo salen de CONTAR:
--      select f.name,
--             count(distinct fn.node_key) as nodes,
--             count(nm.milestone_key)     as sub_milestones
--        from business_plan.funnel f
--        left join business_plan.funnel_node fn using (funnel_key)
--        left join business_plan.node_milestone nm on nm.node_key = fn.node_key
--       group by f.name order by f.name;
--
-- 3. Un funnel con enrolamientos NO se puede borrar:
--      delete from business_plan.funnel where funnel_key = <uno con enrolamiento>;
--    -> debe fallar por `intervention_funnel_fk` / la FK RESTRICT de enrollment.
--
-- 4. Un milestone hecho no se puede reabrir ni borrar. Con sesión
--    `authenticated`, sobre una fila con status = 'done':
--      update business_plan.enrollment_milestone set status = 'pending' where ...;  -- 0 filas
--      delete from business_plan.enrollment_milestone where ...;                    -- 0 filas
--    Y marcar una pendiente como hecha SÍ funciona.
--
-- 5. El equipo de soporte no entra en el triage:
--      select count(*) from org.dim_employee where is_support and is_loan_officer;  -- 0
--
-- ===========================================================================
-- PARA REVERTIR
-- ===========================================================================
--
--   alter table business_plan.intervention drop constraint if exists intervention_funnel_fk;
--   drop table if exists business_plan.enrollment_milestone;
--   drop table if exists business_plan.enrollment_node;
--   drop table if exists business_plan.enrollment;
--   drop table if exists business_plan.node_owner;
--   drop table if exists business_plan.node_milestone;
--   drop table if exists business_plan.funnel_node;
--   drop table if exists business_plan.node;
--   drop table if exists business_plan.funnel;
--
-- O sólo los ejemplos:
--   delete from business_plan.funnel where is_example;
--   delete from business_plan.node   where is_example;
--
-- ===========================================================================
