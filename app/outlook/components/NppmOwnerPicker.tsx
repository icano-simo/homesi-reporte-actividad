'use client';

import { useState } from 'react';
import { saveNppmRealtorOwner } from '@/lib/outlook/save';

/**
 * ============================================================================
 * A QUIÉN SE LE SUMA ESTE REALTOR — etapa OL44
 * ============================================================================
 *
 * El presupuesto de un NPPM va al bucket `nppm` de UN Loan Officer, y hasta
 * esta etapa ese vínculo se cargaba con un `insert` a mano. Con trece NPPM en
 * el roster, cinco sin asignar y uno que ya hubo que corregir, la decisión
 * tiene que estar donde se mira: en la fila del realtor.
 *
 * ⚠ SIN OPCIÓN VACÍA. Se puede cambiar de dueño y no se puede quitarlo: la
 * tabla no tiene `delete` --ni grant ni policy, decidido en OL42-- porque un
 * realtor cambia de Loan Officer, no deja de tener uno. «Sin dueño» es el
 * estado inicial, y se ve; no es algo a lo que se vuelva.
 *
 * ⚠ Y LAS OPCIONES SON LOS LOAN OFFICERS DE SU BRANCH. Asignarle un dueño de
 * otro branch mandaría su presupuesto a una tarjeta donde su producción no
 * está: el número aparecería donde el realtor no cierra. Si algún día hace
 * falta cruzar branches, es una decisión aparte y se verá en la lista.
 */
export default function NppmOwnerPicker({
  realtorCode,
  ownerEmployeeKey,
  loanOfficers,
  onSaved,
}: {
  realtorCode: string;
  /** `null` = nadie decidió todavía. Distinto de un dueño que se quitó, que no existe. */
  ownerEmployeeKey: number | null;
  loanOfficers: { employeeKey: number; fullName: string }[];
  onSaved: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loanOfficers.length === 0) {
    /*
     * Un branch sin Loan Officers con quien vincularlo. No es un desplegable
     * vacío --que se lee como «elegí» sin nada que elegir-- sino la razón.
     */
    return (
      <span className="bp-muted ol-tag" title="This branch has no loan officers on the roster, so there is nobody to assign this realtor to.">
        nobody to assign to
      </span>
    );
  }

  return (
    <span className="bp-muted ol-tag" data-ol-owner-picker={realtorCode}>
      <select
        className="field ol-owner-picker"
        value={ownerEmployeeKey === null ? '' : String(ownerEmployeeKey)}
        disabled={busy}
        aria-label={'Loan officer this realtor adds to'}
        title={
          ownerEmployeeKey === null
            ? 'Nobody decided yet who this realtor adds to, so their budget does not count anywhere. Pick a loan officer.'
            : 'The loan officer whose NPPM plan this realtor adds to. Changing it moves their budget.'
        }
        onChange={async (e) => {
          const key = Number(e.target.value);
          if (!Number.isFinite(key) || key === 0) return;
          setBusy(true);
          setError(null);
          try {
            await saveNppmRealtorOwner({ realtorCode, employeeKey: key });
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {ownerEmployeeKey === null && (
          <option value="" disabled>
            no owner yet
          </option>
        )}
        {loanOfficers.map((lo) => (
          <option key={lo.employeeKey} value={lo.employeeKey}>
            {lo.fullName}
          </option>
        ))}
      </select>
      {error !== null && (
        <span className="bp-notice bp-notice--warn" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
