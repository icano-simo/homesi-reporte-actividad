'use client';

/**
 * ============================================================================
 * EN QUÉ BRANCHES ESTÁ UNA PERSONA, Y A DÓNDE LLEVA CADA MÓDULO
 * ============================================================================
 *
 * Etapa RV5 — ARCHIVO NUEVO, y lo que lo hizo falta es una divergencia.
 *
 * `rutaDelModulo` estaba escrita DOS VECES a propósito --en el anfitrión de la
 * máscara y en la pantalla que arranca la revisión-- con esta nota: «Duplicado a
 * propósito: son dos momentos distintos, y compartirlo obligaría a un archivo
 * más para tres líneas. Si aparece un tercer llamador, se extrae».
 *
 * ⚠ NO APARECIÓ UN TERCER LLAMADOR: APARECIÓ UN CAMBIO. En RV4 la copia del
 * anfitrión aprendió que Outlook tiene una pantalla por BRANCH y la otra no, así
 * que retomar una revisión parada en la fase 2 llevaba a `/outlook` --la lista de
 * los trece-- mientras avanzar a la misma fase llevaba al branch correcto.
 *
 * Las dos copias eran correctas cuando se escribieron. Lo que las separó fue
 * editar una. Y es la misma forma que `chequearChoqueDeClases` vigila en el CSS:
 * el daño no aparece donde se escribe, aparece donde ya estaba.
 */

import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * Los códigos de branch de una persona, ordenados.
 *
 * `dim_branch` completa y no filtrada por clave: son trece filas, y filtrarla
 * pidiendo un `in` con las claves de la persona sería una segunda consulta
 * dependiente de la primera. Trece filas se leen una vez.
 */
export async function buscarBranches(loEmployeeKey: number): Promise<string[]> {
  const sb = getSupabaseClient().schema('org');
  const [asig, ramas] = await Promise.all([
    sb.from('employee_branch').select('branch_key').eq('employee_key', loEmployeeKey),
    sb.from('dim_branch').select('branch_key, branch_code'),
  ]);
  const codigoDe = new Map(
    ((ramas.data ?? []) as { branch_key: number; branch_code: string }[]).map((b) => [
      b.branch_key,
      b.branch_code,
    ])
  );
  return ((asig.data ?? []) as { branch_key: number }[])
    .map((a) => codigoDe.get(a.branch_key))
    .filter((c): c is string => typeof c === 'string' && c !== '')
    /* Ordenados, para que «el primero» sea siempre el mismo: sin `order` la
       respuesta de PostgREST no promete un orden. */
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * A dónde manda cada módulo del guion.
 *
 * ⚠ SE COMPARA CONTRA EL DATO DE LA BASE, que dice `business-plan` y `outlook`
 * --con guion, igual que el segmento de la URL--. Isabella lo aplicó así y es
 * mejor que lo que estaba sembrado (`business_plan`), justamente porque coincide
 * con la ruta.
 *
 * Y un módulo que este código no conoce cae en la lista de revisiones y no en
 * una ruta inventada: mandar a `/algo` daría un 404 en medio de una revisión.
 *
 * ⚠ `branchCode` en `null` cae a `/outlook`, que es el respaldo de «todavía no
 * sé en qué branch está» o «no está en ninguno». Se ejerce de verdad --el branch
 * llega de la base-- así que no es un respaldo muerto; y quien navega tiene que
 * ESPERAR el branch en vez de leer un estado que puede no haber llegado. Eso
 * costó una carrera en RV4.
 */
export function rutaDelModulo(
  modulo: string,
  loEmployeeKey: number,
  branchCode: string | null
): string {
  if (modulo === 'business-plan') return '/business-plan/lo/' + loEmployeeKey;
  if (modulo === 'outlook') {
    return branchCode === null ? '/outlook' : '/outlook/branch/' + encodeURIComponent(branchCode);
  }
  return '/review';
}
