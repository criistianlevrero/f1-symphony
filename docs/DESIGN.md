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
  "theme": "abyss",
  "decorations": { "abyss": [{ "asset": "calamar", "cell": [2, 0, 1], "rot": 0 }] },
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

## Estéticas y decoración

Cada pista elige una **estética** (`theme`), definida en `src/track/themes.ts`: cielo,
niebla, luces, piso, grilla del editor y paleta de la calzada. Hoy hay dos: **Día** y
**Abismo** (noche con cordones de neón). El brillo de los cordones se logra parcheando
el shader estándar (`makeRoadMaterial`): la malla lleva un atributo `glow` que vale 1
en los cordones y se suma a la emisión.

- **Pulso:** con `curbPulse > 0`, el brillo de los cordones destella en cada beat y se
  apaga hasta el siguiente. En el juego sigue el **beat del jugador** (su posición en
  la pista, `distanceToBeat`); en el editor, el reloj al tempo de la canción.
- **Bloom:** las estéticas con `bloom` se dibujan con un `EffectComposer` y
  `UnrealBloomPass` (`src/game/renderPipeline.ts`). Las que no lo tienen usan el render
  directo, sin costo extra.

- **La estética y la decoración nunca alteran la física.** La estética solo cambia
  colores y materiales; las posiciones de la malla (que también usa el collider) no
  dependen de ella. La decoración es solo visual y nunca llega a `addTrackColliders`.
  Así el puntaje no depende de cómo se vea la pista.
- **La decoración se guarda por estética** (`decorations: { [theme]: [...] }`), ubicada
  en la grilla. Solo se dibuja la de la estética activa; cambiar de estética no borra
  la de las otras.
- Una estética o un asset que esta versión no conoce se **conserva** al cargar y guardar;
  la estética desconocida se dibuja como Día.
- A futuro, los tramos cargados desde `.glb` (con física) van a necesitar separar la
  malla visual de la geometría de colisión en `buildTrack`. Hoy son la misma.

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

Las notas que empiezan en el mismo beat forman un acorde y comparten marcador. El
editor muestra los marcadores sobre la pista en vivo y avisa cuántas notas no entran.
Pendiente: mover marcadores a mano.

Los marcadores son **sensores**: se atraviesan sin frenar el auto, suenan al
contacto y cambian de aspecto. Cada marcador se activa una sola vez por intento.

## Puntaje

Implementado en `src/music/scoring.ts` (con tests). Sea `tᵢ` el tiempo en que el
jugador tocó la nota i, y `Tᵢ` el tiempo ideal según la partitura.

1. **Ritmo relativo (principal):** el tempo del jugador se estima con la regresión
   lineal `t ≈ a + k·T` sobre las **últimas 6 notas tocadas** (k es el factor de
   tempo: k > 1 es más lento). Así se tolera que el tempo vaya cambiando de a poco.
   Cada nota nueva se compara con lo que predice ese ajuste, y el error se mide en
   beats del tempo del jugador:

   | Juicio | Error | Puntos |
   |---|---|---|
   | ¡Perfecto! | ≤ 0,08 beat | 100 |
   | Muy bien | ≤ 0,16 beat | 70 |
   | Bien | ≤ 0,30 beat | 40 |
   | Fuera de tiempo | más | 10 (corta el combo) |
   | Perdida | marcador sin tocar | 0 (corta el combo) |

   Las dos primeras notas definen el tempo, así que no se juzgan.
2. **Bonus por tempo:** al final se ajusta k sobre todas las notas. Si se desvía menos
   de 3% del tempo original, el bonus es de +25%; baja linealmente hasta 0 con un
   20% de desvío.
3. **Nota final:** S ≥ 95%, A ≥ 85%, B ≥ 70% y C ≥ 50% de precisión rítmica.

### Detección de toques

Cada marcador tiene una zona cilíndrica alineada con la pista: 3,4 m de radio en el
plano de la calzada, y de 3 m abajo a 9 m arriba (generoso, para tocar notas en
pleno salto). Los acordes ensanchan la zona lateralmente.

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

Se dibuja en un `<canvas>` 2D aparte, para no tocar el DOM en cada frame. Arriba
del velocímetro se muestra la velocidad sugerida (en verde si vas dentro del ±5%).
El click del metrónomo se activa y desactiva con la tecla M.

## Fases

1. **Manejo** ✅ auto, cámara de persecución y panel de ajuste.
2. **Tramos** ✅ catálogo de 14 tramos, curva central y armado de pista desde JSON.
3. **Editor de pista** ✅ colocar y rotar tramos en la grilla, guardar y cargar desde `localStorage`, exportar e importar.
4. **Música** ✅ piano roll, colocación de marcadores, sonido, metrónomo y puntaje.
5. **Interfaz:** ✅ menú, lista de pistas y resultados. Falta guardar el mejor puntaje por pista.
6. Después: mobile (controles táctiles), MIDI y fantasma de la mejor vuelta.
