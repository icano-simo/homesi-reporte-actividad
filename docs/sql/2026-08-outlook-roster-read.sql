-- ============================================================================
-- Outlook necesita leer org.roster_current — etapa OL7
-- ============================================================================
--
-- QUÉ PASA HOY
-- ------------
-- `org.roster_current` tiene una sola policy, `roster_v2_admin`, y exige el
-- claim `admin`. Las cuatro personas que usan Outlook tienen el claim `outlook`
-- y NO tienen `admin`, así que para ellas la tabla devuelve **cero filas sin
-- error**: la RLS no rechaza, filtra.
--
-- ⚠ POR QUÉ ESO ES PEOR QUE UN ERROR. Outlook cae al comportamiento anterior
-- --la lista de `org.employee_branch`-- y la pantalla sale LLENA, con nombres
-- reales y totales plausibles. No hay nada que mirando delate que la lista es
-- la vieja. Así se descubrió: la pantalla parecía correcta y mostraba a Shon
-- Lamberty, que ya no produce, y le faltaban Lucio Romero y Abel Berrocal.
--
-- Mientras esto no se aplique, el diagnóstico al pie del módulo lo dice en
-- palabras, y `diagnostics.rosterAvailable` es la señal en el dato.
--
-- QUÉ HACE ESTE SQL
-- -----------------
-- Agrega una policy de SELECT para el claim `outlook`, en paralelo a la de
-- `admin`. Son PERMISSIVE, así que se suman: quien tenga cualquiera de los dos
-- claims ve las filas, y quien no tenga ninguno sigue sin verlas.
--
-- Es el mismo patrón que ya usan `org.dim_employee` y `org.employee_alias` con
-- el claim `commercial_activity`.
--
-- Sólo lectura. No toca datos, no toca la policy existente, y no toca
-- org.dim_employee.

create policy "outlook read"
  on org.roster_current
  for select
  to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') -> 'allowed_apps') ? 'outlook'
  );

-- Verificación, después de aplicar:
--
--   select policyname, cmd, roles, qual
--   from pg_policies
--   where schemaname = 'org' and tablename = 'roster_current';
--
-- Se esperan DOS filas: `roster_v2_admin` y `outlook read`.
--
-- Y en la pantalla: el pie de /outlook deja de avisar que el roster no se pudo
-- leer, la lista pasa de 34 personas a 35, y el 728 muestra a Abel Berrocal.
