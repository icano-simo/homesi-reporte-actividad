import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from '@/app/pipeline/pdf/pdfShared';

/**
 * ============================================================================
 * EL INTAKE DE UNA REVISIÓN, EN PDF — etapa BP50, punto 4
 * ============================================================================
 *
 * ARCHIVO NUEVO. Los comentarios de una revisión, para llevar a la
 * conversación o archivar.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SE REUSA `@react-pdf/renderer` Y SU PALETA, no se trae otra librería
 * ---------------------------------------------------------------------------
 * Ya está en el proyecto desde el export del Forecast, con el reparto de
 * responsabilidades escrito en `app/api/pipeline/pdf/route.tsx`: el cliente
 * calcula todo y el servidor sólo dibuja. Esto sigue el mismo camino -- la
 * ruta recibe el intake YA ARMADO por `useIntake` y no vuelve a consultar
 * nada.
 *
 * Y `BRAND` de `pdfShared` en vez de hexadecimales nuevos: un PDF no puede
 * leer las custom properties de `tokens.css`, así que la paleta duplicada ya
 * existía y está justificada ahí. Escribir otros hexadecimales acá sería una
 * TERCERA copia.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL PROMPT VIAJA CON LA RESPUESTA, y si cambió lo dice
 * ---------------------------------------------------------------------------
 * Mismo criterio que la pantalla: un comentario contestando una pregunta que
 * ya no existe se entiende mal sin la pregunta, y peor con la pregunta
 * equivocada. En el papel importa más, porque el papel no se puede reconsultar.
 */

export interface IntakePdfAnswer {
  stepLabel: string;
  phase_no: number;
  step_in_phase: number;
  prompt: string | null;
  promptDesactualizado: boolean;
  comment: string;
  answeredAt: string;
  answeredBy: string;
}

export interface IntakePdfPhase {
  phase_no: number;
  label: string;
  answers: IntakePdfAnswer[];
}

export interface IntakePdfData {
  loName: string;
  reviewerEmail: string;
  /** `completed <fecha>` o `started <fecha> · still in progress`, ya resuelto. */
  estado: string;
  generadoEl: string;
  fases: IntakePdfPhase[];
}

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 38, fontSize: 9.5, color: BRAND.navy },
  marca: { fontSize: 8, letterSpacing: 1.2, color: BRAND.coral, marginBottom: 4 },
  titulo: { fontSize: 17, marginBottom: 3 },
  meta: { fontSize: 8.5, color: '#5A6572', marginBottom: 2 },
  regla: { height: 2, backgroundColor: BRAND.coral, marginTop: 10, marginBottom: 14 },

  fase: { marginBottom: 14 },
  faseCabeza: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: BRAND.slate100,
    paddingVertical: 4,
    paddingHorizontal: 7,
    marginBottom: 7,
  },
  faseNombre: { fontSize: 10 },
  faseN: { fontSize: 8, color: '#5A6572' },

  /* Cada respuesta con su regla a la izquierda: el mismo recurso que la
     pantalla usa para separar bloques sin dibujar cajas. */
  respuesta: { borderLeftWidth: 2, borderLeftColor: BRAND.navySoft, paddingLeft: 8, marginBottom: 9 },
  paso: { fontSize: 9, marginBottom: 2 },
  pregunta: { fontSize: 8.5, color: '#5A6572', marginBottom: 3 },
  aviso: { fontSize: 7.5, color: BRAND.coral, marginBottom: 3 },
  comentario: { fontSize: 9.5, lineHeight: 1.45 },
  firma: { fontSize: 7.5, color: '#5A6572', marginTop: 3 },

  vacio: { fontSize: 9, color: '#5A6572' },
  pie: {
    position: 'absolute',
    bottom: 20,
    left: 38,
    right: 38,
    fontSize: 7.5,
    color: '#5A6572',
    textAlign: 'center',
  },
});

export default function IntakePdf({ data }: { data: IntakePdfData }) {
  const total = data.fases.reduce((n, f) => n + f.answers.length, 0);
  return (
    <Document title={'Coach intake — ' + data.loName} author={data.reviewerEmail}>
      <Page size="LETTER" style={s.page} wrap>
        <Text style={s.marca}>HOMESÍ · COACH INTAKE</Text>
        <Text style={s.titulo}>{data.loName}</Text>
        <Text style={s.meta}>
          {data.estado} · coached by {data.reviewerEmail}
        </Text>
        <Text style={s.meta}>
          {total} answer{total === 1 ? '' : 's'} · generated {data.generadoEl}
        </Text>
        <View style={s.regla} />

        {data.fases.length === 0 && (
          <Text style={s.vacio}>This coaching session has no comments recorded.</Text>
        )}

        {data.fases.map((f) => (
          <View key={f.phase_no} style={s.fase} wrap={false}>
            <View style={s.faseCabeza}>
              <Text style={s.faseNombre}>{f.label}</Text>
              <Text style={s.faseN}>
                {f.answers.length} answer{f.answers.length === 1 ? '' : 's'}
              </Text>
            </View>

            {f.answers.map((a) => (
              <View key={a.phase_no + ':' + a.step_in_phase} style={s.respuesta}>
                <Text style={s.paso}>
                  {a.phase_no}.{a.step_in_phase} · {a.stepLabel}
                </Text>
                {a.prompt !== null && <Text style={s.pregunta}>{a.prompt}</Text>}
                {/* Las dos formas en que la pregunta puede no ser la de hoy, y
                    las dos dichas: cambió, o ya no está. */}
                {a.promptDesactualizado && (
                  <Text style={s.aviso}>The question was reworded after this was answered.</Text>
                )}
                {a.prompt === null && (
                  <Text style={s.aviso}>The question this answered is no longer in the script.</Text>
                )}
                <Text style={s.comentario}>{a.comment}</Text>
                <Text style={s.firma}>
                  {a.answeredBy} · {a.answeredAt.slice(0, 10)}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={s.pie} fixed>
          Coach intake · {data.loName} · generated {data.generadoEl}
        </Text>
      </Page>
    </Document>
  );
}
