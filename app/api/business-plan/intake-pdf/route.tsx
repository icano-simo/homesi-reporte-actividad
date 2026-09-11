import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import IntakePdf, { type IntakePdfData } from '@/app/business-plan/pdf/IntakePdf';

/**
 * ============================================================================
 * EL INTAKE EN PDF — etapa BP50, punto 4
 * ============================================================================
 *
 * Mismo patrón que `app/api/pipeline/pdf/route.tsx`, que es de donde sale la
 * librería: el cliente manda TODO ya armado en el body y esto sólo dibuja. No
 * consulta Supabase.
 *
 * ⚠ Y ESO NO ES UN ATAJO, es lo que evita duplicar la lectura: el intake ya lo
 * resolvió `useIntake` en el cliente --con su RLS, sus prompts resueltos y su
 * marca de «la pregunta cambió»--. Volver a leerlo acá sería una segunda
 * consulta con otra sesión y otro camino de permisos, o sea otra fuente que
 * puede decir algo distinto.
 *
 * ⚠ LO QUE SÍ IMPLICA, dicho: el contenido del PDF es el que el cliente
 * manda. Quien no puede leer el intake no puede armar el body --RLS filtra
 * antes-- así que esto no expone nada nuevo; pero tampoco es una autoridad
 * sobre lo que dice el papel.
 */

export const runtime = 'nodejs';

function textoDeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Un nombre de archivo que sobreviva a cualquier nombre de persona. */
function nombreArchivo(loName: string, cuando: string): string {
  const base = loName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return 'Coach_intake_' + (base === '' ? 'LO' : base) + '_' + cuando + '.pdf';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<IntakePdfData>;
    /*
     * ⚠ SE VALIDA LO QUE SE VA A USAR, y con el mensaje que dice qué falta: un
     * 400 sin motivo obliga a adivinar del otro lado.
     */
    if (typeof body?.loName !== 'string' || body.loName.trim() === '') {
      return NextResponse.json({ error: 'Missing loName.' }, { status: 400 });
    }
    if (!Array.isArray(body?.fases)) {
      return NextResponse.json({ error: 'Missing fases.' }, { status: 400 });
    }

    const ahora = new Date();
    const stamp =
      ahora.getFullYear() +
      '-' +
      String(ahora.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(ahora.getDate()).padStart(2, '0');

    const data: IntakePdfData = {
      loName: body.loName,
      reviewerEmail: body.reviewerEmail ?? 'unknown',
      estado: body.estado ?? '',
      generadoEl: body.generadoEl ?? stamp,
      fases: body.fases,
    };

    const buffer = await renderToBuffer(
      /* Igual que la ruta del Forecast: `renderToBuffer` ejecuta el render real
         dentro de este await, así que un error de dibujo cae en el catch de
         abajo -- no como con react-dom, donde el JSX sólo describe. */
      // eslint-disable-next-line react-hooks/error-boundaries
      <IntakePdf data={data} />
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + nombreArchivo(data.loName, stamp) + '"',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: textoDeError(err) }, { status: 500 });
  }
}
