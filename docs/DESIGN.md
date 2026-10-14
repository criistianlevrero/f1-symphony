# F1 Symphony: documento de diseño

Juego de manejo 3D en el navegador con física arcade estilo Trackmania. El jugador
recorre una pista tocando marcadores que suenan; los marcadores están ubicados de
forma que, al recorrerla, se reproduce una melodía. El objetivo es tocar la melodía
con la mayor precisión rítmica posible.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Plataforma | Navegador de escritorio con teclado. Mobile en una fase posterior. |
| Stack | TypeScript + Vite + Three.js + Rapier (`@dimforge/rapier3d-compat`) |
| UI | React solo para menús, editor y HUD. El loop del juego es TypeScript plano, fuera de React. |
| Audio | Web Audio API (posiblemente Tone.js para sintetizar y programar notas) |
| Persistencia | `localStorage` con JSON versionado, más exportar/importar a archivo |
| Ingreso de melodía | Piano roll en el editor. MIDI u otros métodos, más adelante. |
| Puntaje | Ritmo relativo (opción C), con bonus por ir al tempo original |
| Auto | Modelo low poly propio en `.glb` (ver [CAR_MODEL.md](./CAR_MODEL.md)) |

### Rendimiento y React

React no participa del loop por frame. `Game` maneja renderer, física y cámara con
`requestAnimationFrame` propio; el HUD lee la telemetría por ref y escribe directo al
DOM. Así React no agrega costo por frame. Las vistas de UI (editor, piano roll) sí
usan React normalmente.

## Física

- Paso fijo de 60 Hz con acumulador, más interpolación del render. Es determinista,
  independiente de los FPS, y necesario porque el ritmo depende de la velocidad.
- Vehículo por raycast (`DynamicRayCastVehicleController` de Rapier). Tracción trasera.
- Arcade: gravedad de -20, carga aerodinámica proporcional a v², dirección que se
  reduce con la velocidad, freno de mano que baja el agarre lateral trasero para
  derrapar, y control de giro e inclinación en el aire.
- Convención del chasis: +X adelante, +Y arriba, +Z derecha.
- Todos los parámetros están en `src/game/tuning.ts` y se ajustan en vivo con la tecla T.

## Pistas por tramos

- Grilla 3D. Cada tramo ocupa celdas y tiene **conectores** de entrada y salida
  (celda, dirección y altura). El editor solo deja encajar un tramo donde coincide
  un conector.
- Cada tramo expone su **línea central como curva** (spline). La pista entera se
  convierte en una curva continua con parámetro `s` (metros desde la largada).
- Catálogo inicial: largada, recta, curva de 90° (cerrada y abierta), rampa de
  subida y de bajada, peralte y llegada.
- Colisión: geometría generada por tramo (trimesh o cuboides).

### Formato guardado (borrador)

```json
{
  "version": 1,
  "id": "uuid",
  "name": "Für Elise",
  "pieces": [{ "type": "straight", "cell": [0, 0, 0], "rot": 0 }],
  "song": {
    "bpm": 120,
    "timeSignature": [4, 4],
    "designSpeed": 40,
    "notes": [{ "pitch": 76, "beat": 0, "duration": 0.5 }]
  },
  "markers": [{ "s": 42.5, "lateral": 0, "noteIndex": 0 }]
}
```

`localStorage` guarda un índice de pistas (`f1s:tracks`) y cada pista por separado
(`f1s:track:<id>`), para no reescribir todo al guardar una sola.

## Melodía y marcadores

### Piano roll (editor)

- Eje vertical: notas (rango de 2 o 3 octavas configurable). Eje horizontal: beats,
  con grilla según el compás.
- Se definen BPM, compás y una **velocidad de diseño** (m/s).
- Reproducción de prueba dentro del editor.

### Colocación automática

Cada nota se ubica sobre la curva de la pista en

```
s = s_largada + velocidadDeDiseño × tiempoDeLaNota
tiempoDeLaNota = beat × 60 / bpm
```

Después el autor puede correr marcadores a mano, aunque eso cambia el ritmo a esa
velocidad. El editor avisa si la melodía no entra en la pista o si dos marcadores
quedan demasiado cerca.

Los marcadores son **sensores**: se atraviesan sin frenar el auto, suenan al
contacto y cambian de aspecto. Cada marcador se activa una sola vez por intento.

## Puntaje

Sea `tᵢ` el tiempo en que el jugador tocó la nota i, y `Tᵢ` el tiempo ideal según la
partitura.

1. **Ritmo relativo (principal):** se estima el tempo del jugador con la regresión
   lineal `tᵢ ≈ a + k·Tᵢ` (k es el factor de tempo: k > 1 es más lento). El error
   rítmico de cada nota es `|tᵢ − (a + k·Tᵢ)|`, medido en beats del tempo del
   jugador. Cada nota da puntos según ventanas (por ejemplo Perfecto / Bien / Ok / Mal),
   así que ir más rápido o más lento no penaliza mientras se mantenga el ritmo.
2. **Bonus por tempo:** multiplicador según qué tan cerca está k de 1
   (por ejemplo ±3% da el bonus máximo, y decae hasta ±20%).
3. **Notas perdidas:** un marcador sin tocar cuenta como fallo y rompe el combo.

El cálculo es incremental: el feedback por nota (Perfecto / Bien…) se muestra en vivo
usando la estimación de tempo de las notas tocadas hasta el momento.

## Metrónomo (HUD)

Dos barras horizontales en la parte superior de la pantalla, que avanzan de
izquierda a derecha:

- **Arriba: tempo original.** El cursor avanza al BPM de la partitura.
- **Abajo: tempo del jugador.** El cursor avanza según la posición `s` del auto
  sobre la pista, convertida en beats (`s / velocidadDeDiseño × bpm / 60`). Si el
  jugador va a la velocidad de diseño, las dos barras van sincronizadas.
- Cada barra muestra un compás con marcas de beat: el primer tiempo es largo y el
  resto son cortos (en 4/4: uno largo y tres cortos).
- Opcional: click de metrónomo audible en la barra de arriba.

Se dibuja en un `<canvas>` 2D aparte, para no tocar el DOM en cada frame.

## Fases

1. **Manejo** ✅ base: auto, cámara de persecución, escenario de prueba y panel de ajuste.
2. **Tramos:** catálogo, curva central y armado de pista desde JSON.
3. **Editor de pista:** colocar y rotar tramos en la grilla, y guardar y cargar desde `localStorage`.
4. **Música:** piano roll, colocación de marcadores, sonido, metrónomo y puntaje.
5. **Interfaz:** menú, lista de pistas, resultados y mejor puntaje por pista.
6. Después: mobile (controles táctiles), MIDI y fantasma de la mejor vuelta.
