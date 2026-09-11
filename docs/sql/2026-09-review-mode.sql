-- ============================================================================
-- RV1 — MODO REVISIÓN: EL MODELO
-- ============================================================================
--
-- NO EJECUTADO. Lo aplica el revisor.
--
-- Lo que se guarda, y es de naturaleza distinta:
--
--   · el GUION       — las fases, sus pasos y sus textos. DATOS, no código.
--   · la ASIGNACIÓN  — configuración vigente: quién revisa a quién y para
--                      cuándo. Se corrige (una fecha se mueve).
--   · la SESIÓN      — el registro de una revisión que ocurrió.
--   · las RESPUESTAS — append-only, con autor y fecha.
--
-- ⚠ EL GUION SON DOS TABLAS DE CATÁLOGO, Y ES EL COSTO DE LA CORRECCIÓN 1.
--
-- El progreso se muestra por FASE --una por módulo-- con los pasos adentro, así
-- que la sesión ya no puede llevar un `current_step` plano de 1 a 7: necesita
-- saber en qué fase está y en qué paso de esa fase.
--
-- Y la CANTIDAD de fases y de pasos por fase no se escribe en ninguna parte del
-- código ni en un `check`: sale de las tablas. `Phase 2 of 3` es un
-- `count(*) from review.phase`, y `5 of 5` es contar los pasos de esa fase. Si
-- mañana el paso 4 se parte en dos, es un INSERT.
--
-- Es el mismo argumento que la decisión 3 --los textos son datos porque van a
-- cambiar-- aplicado a la FORMA del guion, que va a cambiar por lo mismo. Y ya
-- cambió una vez: pasó de siete pasos planos a tres fases antes de escribirse
-- una línea de pantalla.
--
-- ⚠ Y NO SE APLANAN LAS TRES A APPEND-ONLY, aunque el brief lo pida de forma
-- general. La distinción ya existe en esta base y conviene seguirla:
-- `business_plan.settings` se actualiza en el lugar porque es la configuración
-- vigente, y `business_plan.intervention` es append-only porque es un registro
-- histórico. Una asignación es lo primero: si Isabella mueve una fecha de SLA,
-- lo que hay que saber es cuál rige hoy, no reconstruir la vigente a partir de
-- cinco revisiones. Lo que pasó en la revisión sí es histórico, y eso es
-- append-only de verdad -- sin policy de UPDATE ni de DELETE, así que no es una
-- convención que la app pueda saltarse.
--
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UN ESQUEMA PROPIO Y NO `business_plan`
-- ---------------------------------------------------------------------------
--
-- La revisión ORQUESTA tres módulos: Business Plan (pasos 1-5 y 7), Outlook
-- (paso 6) y los cierres de Commercial Activity (paso 1). Meterla en
-- `business_plan` la ataría a uno de los tres y haría que su RLS dependiera del
-- claim de ese módulo -- que es justo el problema del punto 7 del brief: el BP
-- Team no tiene el claim `outlook`, y si la sesión viviera bajo las reglas de
-- Outlook nadie del BP Team podría escribir ni el paso 1.
--
-- Con esquema propio, el permiso de la revisión es una pregunta separada del
-- permiso de cada módulo que la revisión visita. Los dos se aplican: para
-- escribir el presupuesto del paso 6 sigue haciendo falta el claim `outlook`,
-- porque esa escritura la protege `outlook.has_access()` y esto no la toca.


-- ---------------------------------------------------------------------------
-- 0. EL ESQUEMA Y LOS DOS PERMISOS
-- ---------------------------------------------------------------------------

create schema if not exists review;

grant usage on schema review to authenticated;

comment on schema review is
  'Modo revision (RV1): capa de orquestacion sobre Business Plan, Commercial Activity y Outlook. No es un modulo: no tiene datos propios de negocio, solo el registro de quien reviso a quien, cuando, y que dijo.';

/*
 * Quién puede participar de una revisión: cualquiera de la app. El BP Team
 * entero lo tiene, y es lo que hace que `Mis revisiones` funcione sin otorgar
 * nada nuevo.
 *
 * Este permiso NO decide a quién ve cada uno -- eso lo deciden las policies de
 * abajo, comparando contra el email de la sesión. Acá sólo se decide si la
 * persona pertenece a la app.
 */
create or replace function review.has_access() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'commercial_activity',
    false
  );
$$;

/*
 * ⚠ EL SEGUNDO PERMISO: quién puede ASIGNAR. Hoy, Isabella, Fernando y
 * Ricardo -- claves 59, 60 y 65 en el roster.
 *
 * Es un claim y no una lista de tres claves en el código, por lo mismo que
 * Analytics dejó de estar apagado con una línea comentada: con un claim, quién
 * puede se otorga y se quita sin desplegar, y la ruta queda cerrada para el
 * resto. Con tres claves a mano, sumar a alguien es un release.
 *
 * ⚠ Y NO SE REUSA `admin`. Ese claim está documentado en `lib/auth/appAccess.ts`
 * como el permiso para VER datos de personal, con la advertencia explícita de
 * que un permiso de administración de verdad necesitaría otro nombre porque
 * `admin` ya está tomado por una lectura. Éste es ese caso.
 */
create or replace function review.can_assign() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'review_admin',
    false
  );
$$;

/*
 * El empleado que corresponde a la sesión actual, por email.
 *
 * Hace falta porque la identidad que llega en el JWT es un email y todo el
 * modelo de personas de esta base es `employee_key`. Verificado antes de
 * escribir esto: los 10 del equipo de soporte y los 35 Loan Officers activos
 * tienen email, y no hay un solo email repetido entre los 107 activos.
 *
 * `lower()` en los dos lados: el email del JWT viene como lo escribió quien
 * creó el usuario, y el del roster como lo trae RRHH.
 *
 * ⚠ Devuelve NULL para una sesión sin empleado en el roster -- un usuario de
 * servicio, o alguien recién creado. NULL hace que las policies de abajo no
 * dejen ver nada, que es el lado seguro de fallar. Y NULL no es cero
 * asignaciones: son cosas distintas y la pantalla tiene que poder decirlo.
 */
create or replace function review.my_employee_key() returns bigint
language sql stable
set search_path = ''
as $$
  select e.employee_key
  from org.dim_employee e
  where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and e.is_active
  limit 1;
$$;

comment on function review.my_employee_key is
  'employee_key de la sesion actual, por email. NULL si no hay empleado activo con ese email -- las policies lo tratan como "no ve nada".';


-- ---------------------------------------------------------------------------
-- 1. EL GUION: LAS FASES Y SUS PASOS
-- ---------------------------------------------------------------------------

create table if not exists review.phase (
  /*
   * El orden en la barra, y la clave. Sin `identity`: el número ES el dato que
   * la pantalla muestra (`Phase 2 of 3`), así que una clave sustituta obligaría
   * a llevar las dos y a mantenerlas de acuerdo.
   */
  phase_no  smallint primary key check (phase_no > 0),

  /* `Business Plan profile`, `Outlook budget`, `Funnel selection`. */
  label     text not null,

  /*
   * Qué módulo visita la fase. NO es decorativo: es lo que le permite a la
   * máscara saber que cruzar a la fase 2 significa cargar Outlook --y avisar
   * que está cargando, que es el punto 7 del brief-- sin que el número de fase
   * esté cableado en el código.
   *
   * Texto libre y no un enum: los módulos de esta app se agregan (Analytics es
   * el último) y un `check` los volvería una migración.
   */
  module    text not null
);

create table if not exists review.step (
  phase_no      smallint not null references review.phase (phase_no) on delete no action,

  /* Dentro de la fase, no global: `1 of 2` de la fase 2 es este número. */
  step_in_phase smallint not null check (step_in_phase > 0),

  /* El rótulo corto del paso en la lista de la máscara. */
  label         text not null,

  /*
   * ⚠ QUÉ HACE FALTA ADEMÁS DEL COMENTARIO PARA CERRAR EL PASO.
   *
   * `comment`   sólo el comentario y `OK`         (pasos 1, 3, 5, 7)
   * `number`    un número además del comentario   (paso 2, el benchmark)
   * `clicks`    interacción además del comentario (paso 4, los tres clics)
   * `budget`    presupuesto y comentario juntos   (fase 2)
   *
   * Está acá y no en el código por lo mismo que los textos: el guion va a
   * cambiar. Y `gate_kind` es lo que la pantalla mira para decidir qué dibuja,
   * así que agregar una compuerta nueva es una fila más y un caso más en un
   * `switch`, no un rediseño.
   */
  gate_kind     text not null default 'comment'
                check (gate_kind in ('comment', 'number', 'clicks', 'budget')),

  /*
   * Los datos que la compuerta necesita y que no son texto: el link a MMI del
   * paso 2, y qué números hay que abrir en el paso 4. `jsonb` por lo mismo que
   * `response.gate` -- una columna por dato sería una migración por cada cambio
   * de guion.
   *
   *   paso 2:  {"link": {"label": "MMI", "url": "https://..."}}
   *   paso 4:  {"clicks": ["total_pipeline", "healthy_loans"]}
   */
  gate_config   jsonb,

  primary key (phase_no, step_in_phase)
);

comment on table review.phase is
  'Las fases del guion, una por modulo. `Phase 2 of 3` se cuenta de aca: la cantidad no esta en el codigo. Ver RV1.';
comment on table review.step is
  'Los pasos de cada fase. `5 of 5` se cuenta de aca. `gate_kind` dice que hace falta ademas del comentario para cerrar el paso. Ver RV1.';


-- ---------------------------------------------------------------------------
-- 2. LA ASIGNACIÓN
-- ---------------------------------------------------------------------------

create table if not exists review.assignment (
  assignment_key        bigint generated always as identity primary key,

  /*
   * Quién revisa. Es del equipo de soporte, pero eso NO se fuerza con una
   * constraint: `is_support` es un dato que RRHH cambia en cada carga, y una
   * constraint sobre él volvería la próxima carga del roster un fallo de
   * integridad. Se filtra en la pantalla de asignación, que es donde se elige.
   */
  reviewer_employee_key bigint not null references org.dim_employee (employee_key) on delete no action,

  /* A quién se revisa. Mismo criterio. */
  lo_employee_key       bigint not null references org.dim_employee (employee_key) on delete no action,

  /*
   * El SLA: para cuándo tiene que estar hecha. `date` y no `timestamptz`
   * porque es un vencimiento de calendario, no un instante -- y guardarlo con
   * hora obligaría a elegir una hora que nadie decidió.
   */
  due_on                date not null,

  /*
   * Se DESACTIVA, no se borra. Igual que un área o un funnel: si se borrara,
   * habría que decidir qué pasa con la sesión que ya empezó, y las dos
   * respuestas son malas -- perder la revisión, o dejarla apuntando a nada.
   */
  is_active             boolean not null default true,

  created_at            timestamptz not null default now(),
  created_by            text not null,
  updated_at            timestamptz,
  updated_by            text
);

/*
 * ⚠ NO ES ÚNICO SOBRE (reviewer, lo). A la misma persona se la revisa varias
 * veces --el brief dice "si hay varias revisiones, se pueden comparar"-- así
 * que dos asignaciones del mismo par con fechas distintas son el caso normal,
 * no un error.
 *
 * Lo que sí se prohíbe es dos revisiones EN CURSO a la vez, y eso se aplica
 * sobre la sesión, no sobre la asignación. Ver el índice del punto 2.
 */
create index if not exists assignment_reviewer_idx
  on review.assignment (reviewer_employee_key, due_on) where is_active;
create index if not exists assignment_lo_idx
  on review.assignment (lo_employee_key, due_on) where is_active;

/*
 * ⚠ ÚNICO SOBRE (assignment_key, lo_employee_key), QUE PARECE REDUNDANTE Y NO
 * LO ES. `assignment_key` ya es la clave primaria, así que este índice no
 * prohíbe nada nuevo -- existe para que la sesión pueda apuntarle con una FK
 * COMPUESTA y así garantizar que su copia del Loan Officer no pueda divergir
 * de la asignación. Ver la nota de `session.lo_employee_key`.
 */
create unique index if not exists assignment_lo_pin_uk
  on review.assignment (assignment_key, lo_employee_key);

comment on table review.assignment is
  'Quien revisa a quien y para cuando. Configuracion vigente, no historico: due_on se corrige en el lugar con updated_by, y una asignacion se desactiva en vez de borrarse. Ver RV1.';


-- ---------------------------------------------------------------------------
-- 3. LA SESIÓN
-- ---------------------------------------------------------------------------

create table if not exists review.session (
  session_key      bigint generated always as identity primary key,
  assignment_key   bigint not null references review.assignment (assignment_key) on delete no action,

  /*
   * ⚠ EL LOAN OFFICER, COPIADO, Y CLAVADO POR UNA FK COMPUESTA.
   *
   * Está acá porque el índice de "una sola en curso" tiene que ser un índice
   * único parcial sobre el Loan Officer, y un índice no puede mirar la tabla de
   * al lado. La copia es lo que lo hace declarativo en vez de un trigger.
   *
   * Y la copia NO puede divergir: la FK compuesta
   * `(assignment_key, lo_employee_key)` contra `assignment_lo_pin_uk` obliga a
   * que el par exista en la asignación. Escribir otro Loan Officer acá es una
   * violación de integridad, no un dato inconsistente que alguien tenga que
   * notar después.
   *
   * Es el mismo mecanismo que BP46 usó para que la dependencia de un nodo no
   * pudiera apuntar a otro funnel: una FK compuesta expresa "el mismo padre"
   * sin un trigger.
   */
  lo_employee_key  bigint not null,

  /*
   * ⚠ DOS ESTADOS Y NO TRES. `abandoned` NO se guarda: se DERIVA de que la
   * sesión siga `in_progress` y su última respuesta sea vieja.
   *
   * Guardarlo obligaría a que algo la marque --un cron, o la propia pantalla al
   * abrirla-- y a decidir qué pasa cuando la persona vuelve: habría que
   * devolverla a `in_progress`, y entonces el estado no dice nada que la fecha
   * no diga mejor. Es la misma decisión que `blocked` en BP46: un estado que se
   * calcula de otros dos no es un estado, y una columna no puede guardar las
   * dos cosas a la vez.
   *
   * Con guion bajo y en minúscula, y la pantalla muestra `In progress`: el
   * renombre de BP42 dejó ese criterio fijado para `enrollment_milestone`.
   */
  status           text not null default 'in_progress'
                   check (status in ('in_progress', 'completed')),

  /*
   * ⚠ EL CURSOR, QUE NO ES EL AVANCE. Es DÓNDE ESTÁ la persona; cuánto completó
   * se deriva de `review.response`. Son dos cosas distintas y por eso hay
   * columnas para una y ninguna para la otra:
   *
   *   · alguien que completó cinco pasos y volvió al 2 está en el 2 con 5 hechos;
   *   · el avance no se puede guardar acá porque ya está en las respuestas, y
   *     dos lugares con el mismo número quedan libres de discrepar.
   *
   * ⚠ SON DOS COLUMNAS Y NO UN NÚMERO DE 1 A 7 --corrección 1--. El progreso se
   * muestra por fase, así que el cursor tiene que decir fase Y paso de esa
   * fase. Un número plano obligaría a traducirlo a fase con la cantidad de
   * pasos de cada una cableada en el código, que es justo lo que las tablas del
   * guion evitan: partir el paso 4 en dos correría los números 5, 6 y 7 y las
   * sesiones abiertas quedarían apuntando a otro paso del que estaban.
   *
   * La FK compuesta contra `review.step` es lo que impide un cursor en un paso
   * que el guion no tiene.
   */
  current_phase         smallint not null default 1,
  current_step_in_phase smallint not null default 1,

  started_at       timestamptz not null default now(),
  started_by       text not null,
  completed_at     timestamptz,

  /*
   * Coherencia entre estado y fecha, en la base. Sin esto, una sesión
   * `completed` sin fecha se lee como "terminó, no sé cuándo", que es
   * exactamente el dato que el punto 5 del brief pide registrar.
   */
  constraint session_completed_has_date check (
    (status = 'completed' and completed_at is not null) or
    (status = 'in_progress' and completed_at is null)
  ),

  constraint session_lo_matches_assignment
    foreign key (assignment_key, lo_employee_key)
    references review.assignment (assignment_key, lo_employee_key)
    on delete no action,

  /* El cursor tiene que ser un paso que existe en el guion. */
  constraint session_cursor_exists
    foreign key (current_phase, current_step_in_phase)
    references review.step (phase_no, step_in_phase)
    on delete no action
);

/*
 * ⚠ DECISIÓN 1 DEL PUNTO 6: UNA SOLA REVISIÓN EN CURSO POR LOAN OFFICER.
 *
 * De acuerdo con prohibirlo, y se aplica en la BASE y no en la app: la app no
 * es el único escritor -- el editor de SQL y cualquier script pueden insertar.
 *
 * Un índice único parcial y no un trigger, y no es una preferencia de estilo:
 * un trigger que cuenta filas puede perder contra dos inserciones simultáneas
 * --las dos leen cero y las dos insertan-- y un índice único no puede.
 *
 * Es exactamente `enrollment_one_active_idx`, que ya hace esto mismo para "un
 * solo plan activo por persona" en `business_plan.enrollment`. Mismo problema,
 * misma forma.
 *
 * ⚠ Y ES POR LOAN OFFICER, NO POR ASIGNACIÓN: dos asignaciones distintas del
 * mismo Loan Officer --dos revisores, o dos fechas-- no pueden tener sesiones
 * abiertas a la vez. Prohibirlo por asignación dejaría pasar justo el caso que
 * hay que evitar.
 */
create unique index if not exists session_one_in_progress_idx
  on review.session (lo_employee_key) where status = 'in_progress';

create index if not exists session_assignment_idx
  on review.session (assignment_key, started_at desc);

comment on table review.session is
  'Una revision. `abandoned` no se guarda: se deriva de status=in_progress con su ultima respuesta vieja. (current_phase, current_step_in_phase) es el CURSOR, no el avance -- el avance se deriva de review.response. Ver RV1.';
comment on column review.session.lo_employee_key is
  'Copia del Loan Officer de la asignacion, clavada por la FK compuesta contra assignment_lo_pin_uk: no puede divergir. Esta acá para que session_one_in_progress_idx pueda ser un indice unico parcial.';


-- ---------------------------------------------------------------------------
-- 4. LOS TEXTOS, COMO DATOS
-- ---------------------------------------------------------------------------
--
-- DECISIÓN 3 DEL PUNTO 6. Los textos van en una tabla, no en el código, porque
-- van a cambiar mucho y cambiarlos no puede ser un release.
--
-- ⚠ APPEND-ONLY CON REVISIÓN, y esto es lo que hay que discutir del punto 3.
--
-- Si los textos fueran mutables y las respuestas no guardaran contra qué
-- versión se contestaron, entonces editar una pregunta CAMBIARÍA EL SIGNIFICADO
-- DE TODAS LAS RESPUESTAS VIEJAS. El intake de marzo diría que Nathan contestó
-- la pregunta de septiembre.
--
-- Es el mismo problema que este módulo ya resolvió en la otra punta: al activar
-- un funnel, el plan se COPIA, así que editar la plantilla no toca a quien ya
-- está corriendo. Acá alcanza con un entero: la respuesta guarda qué revisión
-- vio, y el intake se lee con esa.

create table if not exists review.step_prompt (
  step_prompt_key bigint generated always as identity primary key,

  phase_no        smallint not null,
  step_in_phase   smallint not null,

  /* Monótona por paso. La app lee siempre la más alta. */
  revision        integer not null,

  /* Lo que se le pregunta a la persona en ese paso. */
  prompt          text not null,

  /*
   * La ayuda corta debajo del campo, opcional. NULL = no hay ayuda, que no es
   * lo mismo que una ayuda vacía -- y por eso es nullable y no `default ''`.
   */
  helper          text,

  created_at      timestamptz not null default now(),
  created_by      text not null,

  constraint step_prompt_step_fk
    foreign key (phase_no, step_in_phase)
    references review.step (phase_no, step_in_phase)
    on delete no action
);

create unique index if not exists step_prompt_rev_uk
  on review.step_prompt (phase_no, step_in_phase, revision);

comment on table review.step_prompt is
  'Los textos de los 7 pasos, como datos. Append-only por revision: review.response guarda cual vio, asi que editar una pregunta no reescribe el significado de las respuestas viejas. Isabella define los textos definitivos; los de abajo son relleno. Ver RV1.';


-- ---------------------------------------------------------------------------
-- 5. LAS RESPUESTAS
-- ---------------------------------------------------------------------------

create table if not exists review.response (
  response_key    bigint generated always as identity primary key,
  session_key     bigint not null references review.session (session_key) on delete no action,

  phase_no        smallint not null,
  step_in_phase   smallint not null,

  /* Contra qué versión de la pregunta se contestó. Ver el punto 3. */
  prompt_revision integer not null,

  /*
   * El comentario. `not null` y sin `default ''`: un paso no se completa sin
   * comentario, así que una fila con comentario vacío no es un estado válido.
   * Que no esté en blanco lo comprueba la app antes de habilitar el botón; acá
   * se impide el caso peor, que es una fila sin nada.
   */
  comment         text not null check (length(btrim(comment)) > 0),

  /*
   * ⚠ LO QUE EL PASO PRODUJO ADEMÁS DEL COMENTARIO, Y SÓLO LA EVIDENCIA DE LA
   * COMPUERTA -- no el dato.
   *
   * El paso 2 fija un benchmark y el 6 un presupuesto, y esos números NO se
   * copian acá: viven en `org.employee_benchmark` y en las tablas de Outlook,
   * que ya son append-only y con autor. Copiarlos daría dos fuentes para el
   * mismo número, libres de discrepar -- el problema que BP40 resolvió
   * derivando `enrollmentsByFunnel` de `enrolledByFunnel` en vez de contar dos
   * veces.
   *
   * Lo que sí va acá es lo que no tiene otra casa: los tres clics del paso 4.
   * Forma esperada, con las claves fijas para que la pantalla no adivine:
   *
   *   paso 4:  {"clicked": ["total_pipeline", "healthy_loans"]}
   *
   * `jsonb` y no tres columnas booleanas porque los pasos van a cambiar --el
   * brief lo dice de las preguntas y vale igual para las compuertas-- y una
   * columna por clic obligaría a una migración por cada cambio de guion.
   */
  gate            jsonb,

  answered_at     timestamptz not null default now(),
  answered_by     text not null,

  /*
   * El paso contestado tiene que existir en el guion. Y esto es lo que hace que
   * `5 of 5` se pueda contar sin que la pantalla sepa cuántos pasos hay: se
   * cuentan las respuestas distintas de la fase contra los pasos de la fase.
   */
  constraint response_step_fk
    foreign key (phase_no, step_in_phase)
    references review.step (phase_no, step_in_phase)
    on delete no action
);

/*
 * ⚠ SIN ÍNDICE ÚNICO SOBRE (session_key, phase_no, step_in_phase), a propósito:
 * es append-only, así que corregir un comentario es una fila NUEVA y la vigente
 * es la última. Se lee con
 * `distinct on (phase_no, step_in_phase) ... order by phase_no, step_in_phase, answered_at desc`.
 *
 * El índice está ordenado para que esa lectura no ordene en memoria.
 */
create index if not exists response_latest_idx
  on review.response (session_key, phase_no, step_in_phase, answered_at desc);

comment on table review.response is
  'Append-only: corregir un comentario es una fila nueva y vale la ultima por (session_key, phase_no, step_in_phase). `gate` guarda solo la evidencia de la compuerta --los tres clics del paso 4--, nunca el benchmark ni el presupuesto, que viven en sus propias tablas. Ver RV1.';


-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
--
-- ⚠ LOS GRANTS VAN EXPLÍCITOS, TABLA POR TABLA. Un `create table` nuevo NO
-- hereda el grant del esquema, y olvidarlo no se parece a un problema de
-- permisos: `business_plan.area` quedó como la única de nueve tablas sin grant
-- y eso rompió una pantalla que ni la menciona -- un trigger `security invoker`
-- la leía, así que asignar un área devolvía 403.
--
-- Cero filas con `error: null` es una policy que no aplica; un
-- `403 permission denied for table X` es un grant que falta. Los dos se ven
-- distinto y conviene.

alter table review.phase       enable row level security;
alter table review.step        enable row level security;
alter table review.assignment  enable row level security;
alter table review.session     enable row level security;
alter table review.step_prompt enable row level security;
alter table review.response    enable row level security;

-- La asignación se corrige, así que lleva UPDATE. Las otras tres, no.
grant select                 on review.phase       to authenticated;
grant select                 on review.step        to authenticated;
grant select, insert, update on review.assignment  to authenticated;
grant select, insert         on review.session     to authenticated;
grant select, insert         on review.step_prompt to authenticated;
grant select, insert         on review.response    to authenticated;
-- La sesión sí se actualiza, y sólo en cuatro columnas: el cursor --que ahora
-- son dos-- y el cierre. El grant es POR COLUMNA, así que no hace falta confiar
-- en que la app se porte bien con `assignment_key` ni con `started_by`: la base
-- no la deja tocarlas.
grant update (current_phase, current_step_in_phase, status, completed_at)
  on review.session to authenticated;
grant usage on all sequences in schema review to authenticated;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LA ASIGNACIÓN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lee: quien asigna ve todas; el resto ve SÓLO las suyas -- las que le tocan
 * como revisor. El brief lo pide así: "cada revisor ve solo sus Loan Officers
 * asignados".
 *
 * ⚠ Y el Loan Officer NO ve la suya. No está pedido y no es obvio que deba:
 * la asignación dice quién lo va a revisar y para cuándo, y eso es una agenda
 * del BP Team. Si hace falta, es una línea más acá -- pero que hoy no la vea
 * tiene que ser una decisión y no un olvido.
 */
create policy assignment_select on review.assignment
  for select to authenticated using (
    review.has_access() and (
      review.can_assign() or reviewer_employee_key = review.my_employee_key()
    )
  );

/* Crear y corregir: sólo quien tiene el claim de asignar. */
create policy assignment_insert on review.assignment
  for insert to authenticated with check (
    review.can_assign() and created_by = coalesce(auth.jwt() ->> 'email', '')
  );
create policy assignment_update on review.assignment
  for update to authenticated
  using (review.can_assign())
  with check (review.can_assign() and updated_by = coalesce(auth.jwt() ->> 'email', ''));
/*
 * Sin policy de DELETE. Una asignación se desactiva. El intento no falla: RLS
 * filtra y devuelve cero filas, así que la app tiene que mirar las filas
 * afectadas -- es el silencio que BP42 documentó, y el `.select()` de
 * `patchMilestone` es el patrón a repetir.
 */

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LA SESIÓN Y LAS RESPUESTAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El dueño de una sesión es el revisor de su asignación. Se resuelve con un
 * `exists` contra la asignación en vez de copiar el revisor a la sesión: acá la
 * copia no compraría nada --no hay índice único que la necesite, como sí lo
 * necesitaba el Loan Officer-- y sería un segundo lugar donde puede divergir.
 */
create or replace function review.owns_session(p_assignment_key bigint) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from review.assignment a
    where a.assignment_key = p_assignment_key
      and a.reviewer_employee_key = review.my_employee_key()
  );
$$;

create policy session_select on review.session
  for select to authenticated using (
    review.has_access() and (review.can_assign() or review.owns_session(assignment_key))
  );
create policy session_insert on review.session
  for insert to authenticated with check (
    review.owns_session(assignment_key) and started_by = coalesce(auth.jwt() ->> 'email', '')
  );
/*
 * El UPDATE alcanza al cursor y al cierre, y sólo esas tres columnas están en
 * el grant. La policy agrega quién: sólo el revisor de esa asignación.
 */
create policy session_update on review.session
  for update to authenticated
  using (review.owns_session(assignment_key))
  with check (review.owns_session(assignment_key));

create policy response_select on review.response
  for select to authenticated using (
    review.has_access() and exists (
      select 1 from review.session s
      where s.session_key = review.response.session_key
        and (review.can_assign() or review.owns_session(s.assignment_key))
    )
  );
create policy response_insert on review.response
  for insert to authenticated with check (
    answered_by = coalesce(auth.jwt() ->> 'email', '')
    and exists (
      select 1 from review.session s
      where s.session_key = review.response.session_key
        and s.status = 'in_progress'
        and review.owns_session(s.assignment_key)
    )
  );
/*
 * ⚠ `s.status = 'in_progress'` EN EL `with check`: una sesión cerrada no
 * acepta respuestas nuevas. Sin esa condición, el intake de una revisión
 * terminada podría crecer después de la fecha en que se registró como
 * completa, y entonces la fecha no diría nada.
 *
 * Sin policies de UPDATE ni DELETE en `response`: eso es lo que hace
 * append-only al modelo -- no es una convención que la app pueda saltarse, es
 * que la base no tiene por dónde.
 */

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LAS PREGUNTAS
 * ═══════════════════════════════════════════════════════════════════════════
 * Las lee cualquiera de la app: el revisor las necesita para que la máscara
 * dibuje el paso. Las escribe sólo quien asigna.
 */
/*
 * El guion lo lee cualquiera de la app y NO lo escribe nadie desde la app: sin
 * grant de insert, cambiar la forma del guion es aplicar SQL. Es deliberado --
 * partir una fase en dos con sesiones abiertas mueve el cursor de todas, y eso
 * no puede ser un clic en una pantalla.
 */
create policy phase_select on review.phase
  for select to authenticated using (review.has_access());
create policy step_select on review.step
  for select to authenticated using (review.has_access());

create policy step_prompt_select on review.step_prompt
  for select to authenticated using (review.has_access());
create policy step_prompt_insert on review.step_prompt
  for insert to authenticated with check (
    review.can_assign() and created_by = coalesce(auth.jwt() ->> 'email', '')
  );


-- ---------------------------------------------------------------------------
-- 7. EL GUION DE RELLENO: TRES FASES Y OCHO PASOS
-- ---------------------------------------------------------------------------
--
-- ⚠ SON RELLENO Y LO DICEN. Isabella define los definitivos; cambiarlos es un
-- INSERT con `revision = 2`, no un despliegue.
--
-- `created_by` va con el email de quien aplica este archivo. Se pone a mano
-- abajo -- no se deriva de `auth.jwt()`, porque desde el editor de SQL la
-- sesión es `postgres` y quedaría firmado por un rol y no por una persona.
-- Es la misma corrección que hizo falta en la nota del recálculo del plan 66.

-- Las tres fases. `module` es lo que le dice a la máscara que la 2 cruza a
-- Outlook y que ahí hay que avisar que está cargando.
insert into review.phase (phase_no, label, module) values
  (1, 'Business Plan profile', 'business_plan'),
  (2, 'Outlook budget',        'outlook'),
  (3, 'Funnel selection',      'business_plan')
on conflict (phase_no) do nothing;

/*
 * Los pasos. Ocho, repartidos 5 / 2 / 1 -- que es lo que dice la barra de la
 * corrección 1: `5 of 5`, `1 of 2`, y la tercera sin abrir.
 *
 * ⚠ LA PARTICIÓN DE LA FASE 2 EN DOS PASOS ES UNA LECTURA MÍA, y conviene que
 * se mire. El brief original tenía la fase de Outlook como un solo paso; la
 * barra corregida dice `1 of 2`. Lo partí donde el trabajo cambia de naturaleza:
 * elegir el horizonte de proyección es una decisión sobre la VISTA, y fijar el
 * presupuesto con su comentario es el registro. Si el corte era otro, es un
 * UPDATE de dos filas -- por eso está acá y no en el código.
 */
insert into review.step (phase_no, step_in_phase, label, gate_kind, gate_config) values
  (1, 1, 'Closings this year',        'comment', null),
  (1, 2, 'Benchmark',                 'number',
     '{"link": {"label": "MMI", "url": "PLACEHOLDER"}}'::jsonb),
  (1, 3, 'Future performance',        'comment', null),
  (1, 4, 'Current performance',       'clicks',
     '{"clicks": ["total_pipeline", "healthy_loans"]}'::jsonb),
  (1, 5, 'Risk status',               'comment', null),
  (2, 1, 'Project through',           'comment', null),
  (2, 2, 'Budget and strategies',     'budget',  null),
  (3, 1, 'Funnel',                    'comment', null)
on conflict (phase_no, step_in_phase) do nothing;

do $$
declare
  v_autor text := 'isabella.cano@supremelending.com';  -- ⚠ cambiar si lo aplica otra persona
begin
  insert into review.step_prompt (phase_no, step_in_phase, revision, prompt, helper, created_by)
  select * from (values
    (1::smallint, 1::smallint, 1, 'PLACEHOLDER — What does this year''s closing trend tell you?',
       'Filler text. Isabella defines the real prompt.', v_autor),
    (1::smallint, 2::smallint, 1, 'PLACEHOLDER — What benchmark did you agree on, and why that number?',
       'Filler text. The MMI link goes next to this field.', v_autor),
    (1::smallint, 3::smallint, 1, 'PLACEHOLDER — What do the applications say about future performance?',
       'Filler text.', v_autor),
    (1::smallint, 4::smallint, 1, 'PLACEHOLDER — What does the forecast total tell you about this month?',
       'Filler text. Open total pipeline and healthy loans before answering.', v_autor),
    (1::smallint, 5::smallint, 1, 'PLACEHOLDER — Is the risk status right, and what changes it?',
       'Filler text.', v_autor),
    (2::smallint, 1::smallint, 1, 'PLACEHOLDER — How far out are you projecting, and why?',
       'Filler text.', v_autor),
    (2::smallint, 2::smallint, 1, 'PLACEHOLDER — Which strategies will they use to grow, and why?',
       'Filler text. The budget without the reasoning is not a record.', v_autor),
    (3::smallint, 1::smallint, 1, 'PLACEHOLDER — Why this funnel for the next stretch?',
       'Filler text.', v_autor)
  ) as t(phase_no, step_in_phase, revision, prompt, helper, created_by)
  where not exists (select 1 from review.step_prompt);
end $$;


-- ---------------------------------------------------------------------------
-- 8. UNA COLUMNA QUE DEJA DE LEERSE (decisión de BP39, aplicada acá)
-- ---------------------------------------------------------------------------
--
-- `business_plan.intervention.funnel_key` nombra UN funnel. La intervención es
-- de la PERSONA --su estado de acompañamiento-- y no del plan, así que con
-- varios planes activos esa columna no tiene una respuesta:
--
--   · NULL      obligaría a decidir cuándo se llena;
--   · "el primero" es arbitrario, igual que el `[0]` del Map de `loadData.ts`.
--
-- NO SE BORRA Y NO SE VACÍA. Hay 5 filas con valor y perderlas no gana nada;
-- lo que hay que impedir es que alguien la LEA y crea que dice el funnel de la
-- persona. Así que queda anotada, y el aviso vive en el único lugar que nadie
-- puede evitar leer al mirar la tabla.
--
-- ⚠ Va en este archivo y no en el de BP39, que todavía no existe, por una
-- razón concreta: un comentario que hay que escribir "después" es cómo se
-- queda sin escribir, y el comentario viejo del claim `outlook` --que decía
-- cuatro personas cuando eran dos-- es exactamente lo que cuesta. Esto no toca
-- una fila ni una definición: es texto sobre una columna.

comment on column business_plan.intervention.funnel_key is
  'OBSOLETA desde RV1/BP39: NO LEER. La intervencion es de la persona, no del plan, y con varios planes activos esta columna no puede nombrar "el" funnel -- el primero seria arbitrario. Se conserva porque hay filas con valor; el funnel de cada plan esta en business_plan.enrollment.funnel_key, que es donde corresponde. Ver la seccion 8 de docs/sql/2026-09-review-mode.sql.';


-- ---------------------------------------------------------------------------
-- 9. COMPROBACIONES DESPUÉS DE APLICAR
-- ---------------------------------------------------------------------------
--
-- Las cuatro se corren desde el editor de SQL. La segunda y la tercera tienen
-- que FALLAR: son las que verifican que las guardas muerden.
--
--   -- 1. Las cuatro tablas, los grants y las siete preguntas.
--   select table_name,
--          has_table_privilege('authenticated', 'review.' || table_name, 'select') as sel,
--          has_table_privilege('authenticated', 'review.' || table_name, 'insert') as ins,
--          has_table_privilege('authenticated', 'review.' || table_name, 'update') as upd,
--          has_table_privilege('authenticated', 'review.' || table_name, 'delete') as del
--   from information_schema.tables where table_schema = 'review' order by table_name;
--   -- esperado: select en las seis; insert en assignment, session, step_prompt y
--   --           response; update SOLO en assignment y session; delete en NINGUNA.
--   --           `phase` y `step` sin insert: el guion se cambia por SQL.
--
--   -- 1b. El guion, y que la barra pueda contarse sin el codigo.
--   select p.phase_no, p.label, p.module, count(s.step_in_phase) as pasos
--   from review.phase p left join review.step s using (phase_no)
--   group by 1, 2, 3 order by 1;
--   -- esperado: 1 Business Plan profile / business_plan / 5
--   --           2 Outlook budget        / outlook       / 2
--   --           3 Funnel selection      / business_plan / 1
--   -- y `select count(*) from review.step_prompt` = 8, uno por paso.
--
--   -- 2. Una sesión que apunta a otro Loan Officer que el de su asignación.
--   --    Tiene que fallar por `session_lo_matches_assignment`.
--   insert into review.assignment (reviewer_employee_key, lo_employee_key, due_on, created_by)
--     values (63, 5, current_date + 7, 'prueba@rv1') returning assignment_key;   -- digamos 1
--   insert into review.session (assignment_key, lo_employee_key, started_by)
--     values (1, 77, 'prueba@rv1');   -- 77 NO es el LO de la asignación
--   -- esperado: ERROR de violación de llave foránea. Si pasa, la copia puede
--   -- divergir y el índice de "una sola en curso" deja de significar nada.
--
--   -- 3. Dos sesiones en curso del mismo Loan Officer.
--   --    Tiene que fallar por `session_one_in_progress_idx`.
--   insert into review.assignment (reviewer_employee_key, lo_employee_key, due_on, created_by)
--     values (65, 5, current_date + 14, 'prueba@rv1') returning assignment_key;  -- digamos 2
--   insert into review.session (assignment_key, lo_employee_key, started_by) values (1, 5, 'prueba@rv1');
--   insert into review.session (assignment_key, lo_employee_key, started_by) values (2, 5, 'prueba@rv1');
--   -- esperado: la segunda falla con `duplicate key value ... session_one_in_progress_idx`.
--   -- ⚠ Nótese que son DOS asignaciones distintas: es el caso que un único por
--   -- asignación dejaría pasar.
--
--   -- 4. Cerrar la primera y comprobar que entonces la segunda entra.
--   update review.session set status = 'completed', completed_at = now() where assignment_key = 1;
--   insert into review.session (assignment_key, lo_employee_key, started_by) values (2, 5, 'prueba@rv1');
--   -- esperado: ahora sí. Prohibir dos EN CURSO no prohíbe dos revisiones.
--
--   -- Limpieza de la prueba:
--   -- 5. Un cursor en un paso que el guion no tiene. Tiene que fallar por
--   --    `session_cursor_exists` -- es lo que impide que partir una fase deje
--   --    sesiones apuntando a un paso inexistente.
--   update review.session set current_phase = 2, current_step_in_phase = 9
--     where assignment_key = 2;
--   -- esperado: ERROR de violación de llave foránea.
--
--   delete from review.response where session_key in
--     (select session_key from review.session where assignment_key in (1, 2));
--   delete from review.session where assignment_key in (1, 2);
--   delete from review.assignment where created_by = 'prueba@rv1';
--   -- (funciona desde el editor porque `postgres` no pasa por RLS; desde la app
--   --  no hay policy de delete, que es el punto)
