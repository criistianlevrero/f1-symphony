# Audio: instrumentos, pistas y acompañamiento

La melodía que toca el auto se acompaña con otras pistas (bajo, batería, pads…) que
suenan en tiempo real y siguen el tempo del jugador. Este documento reúne la
investigación de motores de sonido, las decisiones tomadas y el diseño.

## Por qué síntesis en tiempo real y no audio prerenderizado

Se evaluaron dos caminos para el acompañamiento:

1. **Pistas tipo MIDI sintetizadas en la aplicación** (elegido). Cada nota se
   programa en el momento en que el beat del auto llega a ella. La sincronía es
   exacta a cualquier tempo y sin artefactos: auto parado es silencio, y auto lento
   es la canción más lenta pero limpia. Encaja con el modelo en beats, el piano roll
   y las pistas creadas por usuarios.
2. **Audio prerenderizado con time-stretch** (descartado como base). Necesita
   stems sin la melodía del auto, el timbre de las notas sintetizadas choca con el
   del audio grabado, los algoritmos de stretch agregan latencia y artefactos fuera
   de ±25–30 %, y no sirve para una melodía compuesta en el editor. Podría volver
   como complemento (por ejemplo un loop de batería grabado dentro de un rango de
   tempo acotado).

## Qué le exige el juego al motor de sonido

1. **Programar notas a un tiempo exacto** del `AudioContext`, para el secuenciador
   con lookahead.
2. **`noteOn` y `noteOff` separados**, no solo "nota con duración". Si el auto
   frena a mitad de una nota larga, se suelta cuando llega el beat de su final, no a
   los segundos calculados al programarla. También hace posibles la pausa y el stop
   del editor.
3. **Compartir el `AudioContext`** de [`audio.ts`](../src/music/audio.ts): un solo
   reloj para clicks, melodía y acompañamiento.
4. **Liviano**: pocos MB de descarga y poca CPU, pensando en mobile.
5. **Licencia** que no condicione el resto del juego.

## Opciones evaluadas (octubre 2026)

| Opción | Tipo | Sonido | Peso | Licencia | Notas |
|---|---|---|---|---|---|
| **Tone.js** (v15) | Síntesis sustractiva, FM, AM, membrana, ruido, metálica | Sintético y prolijo, ideal para electrónica | ~150 KB, sin samples | MIT | `triggerAttack/Release` con tiempo exacto; acepta un `AudioContext` propio; su Transport no hace falta. Incluye batería sintetizada. La más madura. |
| **SpessaSynth** (`spessasynth_lib` v4) | Reproductor SF2/SF3/DLS en AudioWorklet | El del soundfont cargado | Librería chica + soundfont (~5–40 MB en SF3) | Apache-2.0 | SF2 completo, canales GM con program change, reproduce MIDI. Hay que verificar cómo programar `noteOn` a un tiempo futuro. |
| **js-synthesizer** (FluidSynth en WASM) | SoundFont | Igual que SpessaSynth | Más pesado | LGPL 2.1 (FluidSynth) + BSD-3 | Motor de referencia, integración incómoda (script tag, worklet aparte). |
| **smplr** | Instrumentos sampleados: piano Splendid, GM, batería, mallets | Muy bueno en piano | Samples bajo demanda (GitHub Pages, con límite de pedidos; se pueden alojar en un servidor propio) | MIT | `start({ note, time, duration })` devuelve una función para soltar la nota. Todavía antes de la 1.0. |
| **WebAudioFont** | Miles de instrumentos GM sampleados | Variable | Por instrumento | Propia | API vieja con globals. No recomendada. |
| **Web Audio Modules 2** | Plugins tipo VST: OB-Xd, Dexed, ~40 más | Sintetizadores "de verdad" | WASM por plugin | Por plugin (OB-Xd y Dexed son GPL) | Potente, pero suma complejidad de integración y de licencia. |
| **Faust → WASM** / **Elementary** | DSP propio (modelado físico, etc.) | Lo que se diseñe | Chico | Código generado propio / MIT | Para un instrumento firma, no para un catálogo. |
| **superdough** (Strudel) | Sampler + síntesis | Bueno | — | **AGPL-3.0** | Descartado: la licencia obligaría a publicar el código del juego. |

### Decisión

- **Etapa actual: Tone.js.** Sin samples ni descargas, con batería incluida, y
  coherente con las estéticas del juego (Día, Abismo neón).
- **Etapa posterior: SpessaSynth con un SF3 chico**, cargado de forma diferida solo
  si alguna pista usa un instrumento GM. Sirve para timbres acústicos y para respetar
  los program change de un MIDI importado.

## Diseño

### Instrumentos

Cada motor queda detrás de una interfaz propia, así cambiar o sumar uno no toca el
editor ni el juego:

```ts
interface Instrument {
  noteOn(pitch: number, velocity: number, when: number): void;
  noteOff(pitch: number, when: number): void;
  allNotesOff(when?: number): void;
  output: AudioNode; // volumen, paneo y efectos por pista
}
```

Un catálogo asocia ids a fábricas: `synth:lead`, `synth:bass`, `synth:pad`,
`synth:pluck`, `drums:kit`, `marimba` (el sintetizador original) y, más adelante,
`gm:<programa>`.

### Pistas

Una canción tiene varias pistas. Una es la **principal**: la del auto, la única que
genera marcadores. Las demás son acompañamiento.

```ts
interface SongTrack {
  id: string;
  name: string;
  instrument: string;   // id del catálogo
  notes: SongNote[];    // en beats escritos
  repeats: Repeat[];
  main?: boolean;
  volume?: number;
}
```

Las canciones guardadas con el formato anterior (`song.notes`) se migran a una pista
principal con el instrumento `marimba`.

### Repeticiones (por pista)

Una repetición marca un tramo de **una pista** para que suene n veces, como un signo
de repetición en una partitura. Es por pista y no global: sirve para las partes
repetitivas (batería, bajo) sin obligar a repetir el lead.

```ts
interface Repeat {
  start: number; // beat escrito, en múltiplos de compás
  end: number;
  times: number; // vueltas totales (2 = suena dos veces)
}
```

- Las notas se escriben una sola vez. `unroll(track)` despliega la pista en beats
  **tocados**: inserta las vueltas extra y corre lo que sigue en esa pista. Las
  otras pistas no se mueven.
- Todo lo que suena o se ubica en la pista (marcadores, secuenciador, largo de la
  canción, aviso de "fin de pista") usa la versión desplegada.
- Las repeticiones de una misma pista no se pueden superponer.
- **Piano roll:** muestra la línea de tiempo tocada. La primera vuelta se edita; las
  vueltas extra se ven semitransparentes, con un corchete "×n" en la regla. Editar
  una nota convierte su beat tocado en beat escrito.

### Secuenciador y director de tempo

Un solo `Sequencer` toca las pistas desplegadas con lookahead (patrón "A Tale of
Two Clocks"): cada ~25 ms programa las notas que caen en la ventana próxima y suelta
las que terminan. Lo que cambia es **quién marca el beat**:

- **Editor:** un reloj al BPM de la canción. Permite play desde cualquier beat,
  pausa (el cabezal queda donde está) y stop (vuelve al inicio y suelta todo).
- **Juego:** un *director* que convierte la posición del auto en beat, con el tempo
  suavizado (pasa-bajos sobre `velocidad / velocidadDeDiseño`), predicción para la
  ventana de lookahead, y reglas para casos raros: la música solo avanza con el beat
  máximo alcanzado, y se apaga con un fade si el tempo cae debajo de un mínimo
  (auto parado, marcha atrás, respawn).

## Etapas

1. Este documento.
2. Modelo de pistas y repeticiones, migración y `unroll` con tests.
3. Tone.js, catálogo de instrumentos y `Sequencer`.
4. Piano roll: transporte (▶ ⏸ ■, espacio, click en la regla), selector de pista e
   instrumento, pistas de fondo semitransparentes y repeticiones.
5. Acompañamiento en el juego, siguiendo al director de tempo.
6. Después: soundfonts (SpessaSynth) e importación de MIDI.

## Fuentes

- Tone.js: [jsDelivr](https://www.jsdelivr.com/package/npm/tone) ·
  [comparativa 2026](https://www.pistack.xyz/posts/2026-08-23-javascript-audio-libraries-howler-tonejs-wavesurfer-comparison/)
- [spessasynth_lib](https://github.com/spessasus/spessasynth_lib) ·
  [SpessaSynth](https://github.com/spessasus/SpessaSynth)
- [js-synthesizer](https://www.npmjs.com/package/js-synthesizer) ·
  [fluidsynth-emscripten](https://github.com/jet2jet/fluidsynth-emscripten)
- [smplr](https://github.com/danigb/smplr) · [WebAudioFont](https://github.com/surikov/webaudiofont)
- [OB-Xd WAM](https://github.com/jariseon/obxd) ·
  [wam-community](https://www.npmjs.com/package/wam-community)
- [faustwasm](https://github.com/fr0stbyter/faustwasm) ·
  [Elementary web renderer](https://elementary.audio/docs/packages/web-renderer)
- [superdough](https://www.npmjs.com/package/superdough)
