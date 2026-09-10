'use client';

/**
 * ============================================================================
 * EL PERFIL DEL LOAN OFFICER, BAJO EL NOMBRE — etapa BP50
 * ============================================================================
 *
 * ARCHIVO NUEVO. La pantalla del Loan Officer se leía como un tablero de
 * números; esto le agrega lo que la vuelve un CV: dónde opera, sus licencias,
 * su NMLS, de dónde vienen sus leads, si es tiempo completo, cuándo entró y qué
 * le interesa.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SE EDITA EN EL LUGAR, Y ESO SE VE
 * ---------------------------------------------------------------------------
 * No es append-only --ver `docs/sql/2026-09-lo-profile.sql` para el por qué--
 * así que no hay «revisión anterior» que mostrar. Lo que sí se muestra es
 * QUIÉN lo tocó por última vez y cuándo, que es el único rastro que el modelo
 * guarda: decirlo evita que alguien espere una historia que no existe.
 *
 * ---------------------------------------------------------------------------
 * ⚠ TRES ESTADOS EN LA CARGA, no dos
 * ---------------------------------------------------------------------------
 *   `undefined` todavía no se leyó
 *   `null`      se leyó y no hay perfil cargado
 *   objeto      hay perfil
 *
 * Es la distinción de siempre, y acá importa porque «no tiene nada cargado» y
 * «todavía no sé» se dibujan distinto: el primero invita a llenar, el segundo
 * no puede afirmar nada.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL PREFIJO ES `bp-cv` Y NO `bp-profile`, Y NO ES CAPRICHO
 * ---------------------------------------------------------------------------
 * `.bp-profile` YA EXISTE en `bp-visual.css`: es la ficha del encabezado
 * --avatar, nombre, meta-- y la usa esta misma pantalla. Con ese prefijo,
 * `.bp-profile` le habría puesto `display: flex` a esta sección y
 * `.bp-profile__meta` habría chocado con el subtítulo del nombre.
 *
 * Lo cazó el `git grep` de rigor antes de escribir una línea de CSS, que es
 * exactamente para lo que está esa regla: una clase redefinida no rompe donde
 * la escribís, rompe donde ya estaba.
 */

import { useEffect, useState } from 'react';
import { CalendarIcon, CloseIcon, TargetIcon } from '@/components/ui/icons';
import {
  ESTADO_VALIDO,
  PERFIL_VACIO,
  estadosSugeridos,
  guardarPerfil,
  leerPerfil,
  linkMmi,
  nmlsEfectivo,
  type LoProfile,
  type LoProfileDraft,
} from '@/lib/business-plan/perfil';

const SCHEDULE_LABEL: Record<'full_time' | 'part_time', string> = {
  full_time: 'Full time',
  part_time: 'Part time',
};

export default function LoProfile({
  employeeKey,
  fullName,
  nmlsDeLaBase,
}: {
  employeeKey: number;
  fullName: string;
  /** El de `org.dim_employee`. El perfil hereda de acá si no hay override. */
  nmlsDeLaBase: string | null;
}) {
  const [fila, setFila] = useState<LoProfile | null | undefined>(undefined);
  const [borrador, setBorrador] = useState<LoProfileDraft>(PERFIL_VACIO);
  const [sugeridos, setSugeridos] = useState<string[]>([]);
  const [nuevoEstado, setNuevoEstado] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { perfil, error: err } = await leerPerfil(employeeKey);
      if (!vivo) return;
      setFila(perfil);
      setBorrador(
        perfil === null
          ? PERFIL_VACIO
          : {
              operating_states: perfil.operating_states ?? [],
              licenses: perfil.licenses,
              nmls_override: perfil.nmls_override,
              lead_source: perfil.lead_source,
              schedule: perfil.schedule,
              started_on: perfil.started_on,
              interests: perfil.interests,
            }
      );
      if (err !== null) setError(err);
    })();
    return () => {
      vivo = false;
    };
  }, [employeeKey]);

  /* Las sugerencias se piden aparte y no bloquean nada: sin ellas el campo se
     llena a mano, que es lo que va a pasar en 14 de 35 personas. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      const e = await estadosSugeridos(fullName);
      if (vivo) setSugeridos(e);
    })();
    return () => {
      vivo = false;
    };
  }, [fullName]);

  const nmls = nmlsEfectivo(borrador, nmlsDeLaBase);
  const mmi = linkMmi(nmls);
  const heredado = (borrador.nmls_override ?? '').trim() === '';

  const estados = borrador.operating_states;
  const paraSugerir = sugeridos.filter((s) => !estados.includes(s));

  const set = <K extends keyof LoProfileDraft>(k: K, v: LoProfileDraft[K]) => {
    setBorrador((b) => ({ ...b, [k]: v }));
    setGuardado(false);
  };

  function agregarEstado(e: string) {
    const limpio = e.trim().toUpperCase();
    if (!ESTADO_VALIDO.test(limpio) || estados.includes(limpio)) return;
    set('operating_states', [...estados, limpio].sort());
    setNuevoEstado('');
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const err = await guardarPerfil(employeeKey, borrador, nmlsDeLaBase, fila !== null && fila !== undefined);
    if (err === null) {
      const { perfil } = await leerPerfil(employeeKey);
      setFila(perfil);
      setGuardado(true);
    } else {
      setError(err);
    }
    setGuardando(false);
  }

  return (
    <section className="bp-cv">
      <div className="bp-cv__head">
        <h2 className="bp-cv__title">
          <TargetIcon size={13} /> LO profile
        </h2>
        {/*
          ⚠ EL PIE DICE LO ÚNICO QUE EL MODELO GUARDA. Sin historia no se puede
          decir qué cambió, así que se dice quién tocó por última vez y cuándo.
          Y con los tres estados: mientras no se leyó, no se afirma nada.
        */}
        <span className="bp-cv__meta">
          {fila === undefined
            ? 'loading…'
            : fila === null
              ? 'nothing on record yet'
              : 'last edited by ' +
                (fila.updated_by ?? fila.created_by) +
                ' on ' +
                (fila.updated_at ?? fila.created_at).slice(0, 10)}
        </span>
        <button
          type="button"
          className="bp-cv__toggle"
          data-bp-cv-toggle=""
          aria-expanded={abierto}
          onClick={() => setAbierto((a) => !a)}
        >
          {abierto ? 'Close' : fila === null ? 'Fill it in' : 'Edit'}
        </button>
      </div>

      {/*
        CERRADO MUESTRA LO QUE HAY, no un formulario: la pantalla es un CV, y un
        CV se lee. Los campos vacíos no se dibujan -- una grilla de «—» no dice
        nada y ocupa lo mismo que los datos.
      */}
      {!abierto && fila !== undefined && (
        <dl className="bp-cv__grid">
          {estados.length > 0 && (
            <div className="bp-cv__pair">
              <dt>Operates in</dt>
              <dd>{estados.join(' · ')}</dd>
            </div>
          )}
          {nmls !== null && (
            <div className="bp-cv__pair">
              <dt>NMLS</dt>
              <dd>
                {nmls}
                {mmi !== null && (
                  <>
                    {' '}
                    <a href={mmi} target="_blank" rel="noreferrer">
                      MMI
                    </a>
                  </>
                )}
                {!heredado && <span className="bp-cv__tag">edited here</span>}
              </dd>
            </div>
          )}
          {borrador.licenses !== null && (
            <div className="bp-cv__pair">
              <dt>Licenses</dt>
              <dd>{borrador.licenses}</dd>
            </div>
          )}
          {borrador.lead_source !== null && (
            <div className="bp-cv__pair">
              <dt>Main lead source</dt>
              <dd>{borrador.lead_source}</dd>
            </div>
          )}
          {borrador.schedule !== null && (
            <div className="bp-cv__pair">
              <dt>Schedule</dt>
              <dd>{SCHEDULE_LABEL[borrador.schedule]}</dd>
            </div>
          )}
          {borrador.started_on !== null && (
            <div className="bp-cv__pair">
              <dt>Started</dt>
              <dd>
                <CalendarIcon size={12} /> {borrador.started_on}
              </dd>
            </div>
          )}
          {borrador.interests !== null && (
            <div className="bp-cv__pair bp-cv__pair--wide">
              <dt>Interests</dt>
              <dd>{borrador.interests}</dd>
            </div>
          )}
          {fila === null && (
            <p className="bp-muted-line">
              Nothing on record yet — states, licenses, lead source, schedule, start date and
              interests are filled in here.
            </p>
          )}
        </dl>
      )}

      {abierto && (
        <div className="bp-cv__form">
          {/* ── Estados ─────────────────────────────────────────────────── */}
          <div className="bp-form__field bp-cv__field--wide">
            <span className="bp-form__label">States where they operate</span>
            <div className="bp-cv__chips">
              {estados.map((e) => (
                <span key={e} className="bp-cv__chip">
                  {e}
                  <button
                    type="button"
                    aria-label={'Remove ' + e}
                    onClick={() => set('operating_states', estados.filter((x) => x !== e))}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ))}
              {estados.length === 0 && <span className="bp-muted">none yet</span>}
            </div>
            <div className="bp-cv__addstate">
              {/*
                ⚠ DOS LETRAS Y EL MISMO PATRÓN QUE EL CHECK DE LA BASE. No hay
                lista de los cincuenta estados en el código a propósito: una
                lista inventada acá se volvería la taxonomía por defecto, y el
                CHECK ya dice qué es válido. Lo que sí hay son las SUGERENCIAS,
                que salen de los préstamos.
              */}
              <input
                className="field bp-cv__stateinput"
                value={nuevoEstado}
                maxLength={2}
                placeholder="FL"
                onChange={(e) => setNuevoEstado(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    agregarEstado(nuevoEstado);
                  }
                }}
              />
              <button
                type="button"
                className="bp-btn bp-btn--small"
                disabled={!ESTADO_VALIDO.test(nuevoEstado)}
                onClick={() => agregarEstado(nuevoEstado)}
              >
                Add
              </button>
            </div>
            {paraSugerir.length > 0 && (
              <p className="bp-cv__hint">
                {/*
                  ⚠ SUGERENCIA, Y DICE POR QUÉ. Donde alguien CERRÓ no es donde
                  tiene licencia, así que se ofrecen para agregar de un clic y no
                  se cargan solas. Y si no hay ninguna --14 de 35 personas no
                  matchean por nombre-- esta línea no aparece en vez de mentir
                  con una lista vacía.
                */}
                From closed and open loans, most first:{' '}
                {paraSugerir.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="bp-cv__sugg"
                    onClick={() => agregarEstado(e)}
                  >
                    + {e}
                  </button>
                ))}
              </p>
            )}
          </div>

          {/* ── NMLS ────────────────────────────────────────────────────── */}
          <div className="bp-form__field">
            <span className="bp-form__label">
              NMLS
              {/*
                Que se DIGA de dónde viene el número: precargado de la
                sincronización, y editarlo guarda un override. Si se vuelve a
                escribir el mismo, se guarda heredado -- así el perfil sigue los
                cambios de la fuente en vez de congelar una copia.
              */}
              <span className="bp-cv__hintline">
                {nmlsDeLaBase === null
                  ? 'the roster has none for this person'
                  : heredado
                    ? 'from the roster · editing it saves an override'
                    : 'edited here · clearing it goes back to ' + nmlsDeLaBase}
              </span>
            </span>
            <div className="bp-cv__addstate">
              <input
                className="field"
                value={borrador.nmls_override ?? (heredado ? (nmlsDeLaBase ?? '') : '')}
                placeholder="NMLS number"
                onChange={(e) => set('nmls_override', e.target.value)}
              />
              {mmi !== null && (
                <a className="bp-btn bp-btn--small" href={mmi} target="_blank" rel="noreferrer">
                  Open MMI
                </a>
              )}
            </div>
          </div>

          <div className="bp-form__field">
            <span className="bp-form__label">Licenses</span>
            <input
              className="field"
              value={borrador.licenses ?? ''}
              placeholder="Free text for now"
              onChange={(e) => set('licenses', e.target.value)}
            />
          </div>

          <div className="bp-form__field">
            <span className="bp-form__label">Main lead source</span>
            <input
              className="field"
              value={borrador.lead_source ?? ''}
              placeholder="Where their business comes from"
              onChange={(e) => set('lead_source', e.target.value)}
            />
          </div>

          <div className="bp-form__field">
            <span className="bp-form__label">Schedule</span>
            <select
              className="field"
              value={borrador.schedule ?? ''}
              onChange={(e) =>
                set('schedule', e.target.value === '' ? null : (e.target.value as 'full_time' | 'part_time'))
              }
            >
              <option value="">Not set</option>
              <option value="full_time">Full time</option>
              <option value="part_time">Part time</option>
            </select>
          </div>

          <div className="bp-form__field">
            <span className="bp-form__label">
              Start date
              {/*
                ⚠ VACÍA A PROPÓSITO: no se puede precargar. Medido -- los 35 LO
                activos tienen fila en `org.roster_current` y NINGUNO tiene
                `date_started`.
              */}
              <span className="bp-cv__hintline">the roster has no start date for loan officers</span>
            </span>
            <input
              className="field"
              type="date"
              value={borrador.started_on ?? ''}
              onChange={(e) => set('started_on', e.target.value)}
            />
          </div>

          <div className="bp-form__field bp-cv__field--wide">
            <span className="bp-form__label">Interests</span>
            <textarea
              className="field"
              rows={2}
              value={borrador.interests ?? ''}
              placeholder="Marketing, direct contact, referrals — what this person leans towards"
              onChange={(e) => set('interests', e.target.value)}
            />
          </div>

          {error !== null && <p className="bp-notice bp-notice--warn">{error}</p>}
          {guardado && <p className="bp-notice">Saved.</p>}

          <div className="bp-cv__actions">
            <button
              type="button"
              className="bp-btn bp-btn--primary bp-btn--small"
              data-bp-cv-save=""
              disabled={guardando}
              onClick={guardar}
            >
              {guardando ? 'Saving…' : 'Save profile'}
            </button>
            <button type="button" className="bp-btn bp-btn--small" onClick={() => setAbierto(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
