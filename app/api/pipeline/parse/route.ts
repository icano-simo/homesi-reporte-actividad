import { NextResponse } from 'next/server';
import { parseSalesforcePipelineFile } from '@/lib/pipeline/sources/salesforce-file';

// parseSalesforcePipelineFile() espera un Buffer (API de Node), no algo que
// exista en el navegador -- por eso el parseo corre acá, server-side, en
// vez de en el cliente. El cálculo de aggregate.ts (puro, sin I/O) sí corre
// en el cliente, sobre el JSON que devuelve este endpoint.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = parseSalesforcePipelineFile(buffer);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
