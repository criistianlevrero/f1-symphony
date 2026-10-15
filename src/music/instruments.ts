// Imports directos de cada módulo de Tone: el índice crea el AudioContext al
// importarse, fuera de un gesto del usuario (ver docs/AUDIO.md, «Riesgos conocidos»).
import { AMSynth } from 'tone/build/esm/instrument/AMSynth.js';
import { FMSynth } from 'tone/build/esm/instrument/FMSynth.js';
import { MembraneSynth } from 'tone/build/esm/instrument/MembraneSynth.js';
import { MetalSynth } from 'tone/build/esm/instrument/MetalSynth.js';
import { MonoSynth } from 'tone/build/esm/instrument/MonoSynth.js';
import { NoiseSynth } from 'tone/build/esm/instrument/NoiseSynth.js';
import { PolySynth } from 'tone/build/esm/instrument/PolySynth.js';
import { Synth as ToneSynth } from 'tone/build/esm/instrument/Synth.js';
import type { Synth } from './audio';
import { midiToFreq } from './theory';

/** Un instrumento que el secuenciador puede tocar. Los tiempos son del AudioContext. */
export interface Instrument {
  noteOn(pitch: number, velocity: number, when: number): void;
  noteOff(pitch: number, when: number): void;
  /** Suelta todo lo que esté sonando o programado. */
  allNotesOff(when: number): void;
  /** Salida del instrumento: el volumen de la pista se aplica después. */
  output: AudioNode;
  dispose(): void;
}

export interface InstrumentInfo {
  id: string;
  name: string;
  create(synth: Synth): Instrument;
  /** Si está, el instrumento solo suena en estas notas: el piano roll muestra estas filas. */
  rows?: DrumRow[];
}

type DrumSound = 'kick' | 'snare' | 'hat' | 'openHat' | 'crash';

/** Fila del piano roll de batería: una nota GM principal y sus equivalentes. */
export interface DrumRow {
  pitch: number;
  name: string;
  sound: DrumSound;
  /** Otras notas GM que suenan igual (por ejemplo, de un MIDI importado). */
  aliases: number[];
}

/** Mapa de percusión General MIDI, de arriba hacia abajo como se ve en el piano roll. */
export const DRUM_ROWS: DrumRow[] = [
  { pitch: 49, name: 'Platillo', sound: 'crash', aliases: [57] },
  { pitch: 46, name: 'Hi-hat abierto', sound: 'openHat', aliases: [] },
  { pitch: 42, name: 'Hi-hat cerrado', sound: 'hat', aliases: [44] },
  { pitch: 38, name: 'Caja', sound: 'snare', aliases: [40] },
  { pitch: 36, name: 'Bombo', sound: 'kick', aliases: [35] },
];

/** La marimba original de `Synth`, con noteOn/noteOff. */
function marimba(synth: Synth): Instrument {
  const output = synth.ctx.createGain();
  const voices = new Map<number, ((at: number) => void)[]>();
  return {
    output,
    noteOn(pitch, velocity, when) {
      const release = synth.voice(pitch, when, velocity, output);
      voices.set(pitch, [...(voices.get(pitch) ?? []), release]);
    },
    noteOff(pitch, when) {
      voices.get(pitch)?.shift()?.(when);
    },
    allNotesOff(when) {
      for (const list of voices.values()) for (const release of list) release(when);
      voices.clear();
    },
    dispose() {
      output.disconnect();
    },
  };
}

/** Envuelve un PolySynth de Tone: cada nota es una voz con ataque y release. */
function poly(make: () => PolySynth): (synth: Synth) => Instrument {
  return (synth) => {
    const output = synth.ctx.createGain();
    const ps = make();
    ps.connect(output);
    return {
      output,
      noteOn: (pitch, velocity, when) => ps.triggerAttack(midiToFreq(pitch), when, velocity),
      noteOff: (pitch, when) => ps.triggerRelease(midiToFreq(pitch), when),
      allNotesOff: (when) => ps.releaseAll(when),
      dispose() {
        ps.dispose();
        output.disconnect();
      },
    };
  };
}

/**
 * Batería sintetizada con el mapa de percusión General MIDI (`DRUM_ROWS`). Los golpes
 * no usan noteOff: cada sonido tiene su propia caída. Las demás notas se ignoran.
 */
function drumKit(synth: Synth): Instrument {
  const output = synth.ctx.createGain();
  const kick = new MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 } });
  const snare = new NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 } });
  const hat = new MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5 });
  const openHat = new MetalSynth({ envelope: { attack: 0.001, decay: 0.3, release: 0.1 }, harmonicity: 5.1, modulationIndex: 32, resonance: 5000, octaves: 1.5 });
  const crash = new MetalSynth({ envelope: { attack: 0.001, decay: 1.4, release: 0.4 }, harmonicity: 5.1, modulationIndex: 40, resonance: 4000, octaves: 2 });
  kick.volume.value = -2;
  snare.volume.value = -10;
  hat.volume.value = -24;
  openHat.volume.value = -26;
  crash.volume.value = -26;
  const parts = [kick, snare, hat, openHat, crash];
  for (const p of parts) p.connect(output);

  // Los sintes monofónicos de Tone exigen que cada golpe empiece estrictamente
  // después del anterior.
  const last = new Map<object, number>();
  const at = (voice: object, when: number) => {
    const t = Math.max(when, (last.get(voice) ?? -1) + 0.001);
    last.set(voice, t);
    return t;
  };
  const sounds: Record<DrumSound, (when: number, velocity: number) => void> = {
    kick: (w, v) => kick.triggerAttack('C1', at(kick, w), v),
    snare: (w, v) => snare.triggerAttack(at(snare, w), v),
    hat: (w, v) => hat.triggerAttack(300, at(hat, w), v),
    openHat: (w, v) => openHat.triggerAttack(300, at(openHat, w), v),
    crash: (w, v) => crash.triggerAttack(300, at(crash, w), v),
  };
  const hits: Record<number, (when: number, velocity: number) => void> = {};
  for (const row of DRUM_ROWS) for (const pitch of [row.pitch, ...row.aliases]) hits[pitch] = sounds[row.sound];
  return {
    output,
    noteOn: (pitch, velocity, when) => hits[pitch]?.(when, velocity),
    noteOff: () => {},
    allNotesOff: (when) => {
      for (const p of parts) p.triggerRelease(at(p, when));
    },
    dispose() {
      for (const p of parts) p.dispose();
      output.disconnect();
    },
  };
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { id: 'marimba', name: 'Marimba', create: marimba },
  {
    id: 'synth:lead',
    name: 'Lead',
    create: poly(() => {
      const ps = new PolySynth(ToneSynth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 20 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } });
      ps.volume.value = -4;
      return ps;
    }),
  },
  {
    id: 'synth:bass',
    name: 'Bajo',
    create: poly(() => {
      const ps = new PolySynth(MonoSynth, {
        oscillator: { type: 'square' },
        filter: { Q: 2, type: 'lowpass' },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.15 },
        filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2, baseFrequency: 120, octaves: 3 },
      });
      ps.volume.value = -10;
      return ps;
    }),
  },
  {
    id: 'synth:pad',
    name: 'Pad',
    create: poly(() => {
      const ps = new PolySynth(AMSynth, { harmonicity: 1.5, envelope: { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.5 } });
      ps.volume.value = -2;
      return ps;
    }),
  },
  {
    id: 'synth:pluck',
    name: 'Pluck',
    create: poly(() => {
      const ps = new PolySynth(FMSynth, { harmonicity: 3, modulationIndex: 8, envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 } });
      ps.volume.value = -3;
      return ps;
    }),
  },
  { id: 'drums:kit', name: 'Batería', create: drumKit, rows: DRUM_ROWS },
];

/** Busca un instrumento del catálogo. Un id desconocido suena como marimba. */
export function getInstrument(id: string): InstrumentInfo {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}
