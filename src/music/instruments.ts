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

export type ParamValue = number | string;
export type ParamValues = Record<string, ParamValue>;

/** Un instrumento que el secuenciador puede tocar. Los tiempos son del AudioContext. */
export interface Instrument {
  noteOn(pitch: number, velocity: number, when: number): void;
  noteOff(pitch: number, when: number): void;
  /** Suelta todo lo que esté sonando o programado. */
  allNotesOff(when: number): void;
  /** Aplica en vivo los parámetros de la pista (los que falten vuelven al preset). */
  set(params: ParamValues): void;
  /** Salida del instrumento: el volumen de la pista se aplica después. */
  output: AudioNode;
  dispose(): void;
}

/**
 * Un parámetro ajustable. El `id` es la ruta dentro de las opciones de Tone
 * (`envelope.attack`, `filter.Q`; en la batería, con la voz adelante:
 * `kick.envelope.decay`), así sumar uno al catálogo es una línea.
 */
export interface ParamDef {
  id: string;
  label: string;
  group: string;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Si está, es una lista de opciones en vez de un rango. */
  options?: { value: string; label: string }[];
}

export interface InstrumentInfo {
  id: string;
  name: string;
  create(synth: Synth, params: ParamValues): Instrument;
  /** Catálogo de parámetros que el instrumento entiende. */
  params: ParamDef[];
  /** Los que muestra el panel (más adelante se van a poder elegir). */
  exposed: string[];
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

// ---- Parámetros ----

/** Valores completos: los del preset, pisados por los de la pista que el catálogo conoce. */
export function resolveParams(defs: ParamDef[], overrides: ParamValues = {}): ParamValues {
  const out: ParamValues = {};
  for (const d of defs) {
    const v = overrides[d.id];
    out[d.id] = typeof v === typeof d.default ? v : d.default;
  }
  return out;
}

type Nested = { [key: string]: ParamValue | Nested };

/** Convierte `{ 'envelope.attack': 0.1 }` en `{ envelope: { attack: 0.1 } }`. */
export function toOptions(values: ParamValues): Nested {
  const out: Nested = {};
  for (const [path, v] of Object.entries(values)) {
    const keys = path.split('.');
    let node = out;
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Nested;
    node[keys.at(-1)!] = v;
  }
  return out;
}

/** Une opciones fijas del preset con las que salen de los parámetros. */
function merge(base: Nested, extra: Nested): Nested {
  const out: Nested = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? merge(b, v) : v;
  }
  return out;
}

const envelope = (group: string, d: { attack: number; decay: number; sustain: number; release: number }, max = { attack: 2, decay: 2, release: 4 }): ParamDef[] => [
  { id: 'envelope.attack', label: 'Attack', group, default: d.attack, min: 0.001, max: max.attack, step: 0.001, unit: 's' },
  { id: 'envelope.decay', label: 'Decay', group, default: d.decay, min: 0.01, max: max.decay, step: 0.01, unit: 's' },
  { id: 'envelope.sustain', label: 'Sustain', group, default: d.sustain, min: 0, max: 1, step: 0.01 },
  { id: 'envelope.release', label: 'Release', group, default: d.release, min: 0.01, max: max.release, step: 0.01, unit: 's' },
];

const WAVES = [
  { value: 'sine', label: 'Senoidal' },
  { value: 'triangle', label: 'Triangular' },
  { value: 'square', label: 'Cuadrada' },
  { value: 'sawtooth', label: 'Sierra' },
];

// ---- Instrumentos ----

const MARIMBA_PARAMS: ParamDef[] = [
  { id: 'brightness', label: 'Brillo', group: 'Timbre', default: 0.35, min: 0, max: 1, step: 0.01 },
  { id: 'sustain', label: 'Sustain', group: 'Envolvente', default: 0.18, min: 0.01, max: 0.5, step: 0.01 },
  { id: 'release', label: 'Release', group: 'Envolvente', default: 0.35, min: 0.05, max: 2, step: 0.01, unit: 's' },
];

/** La marimba original de `Synth`, con noteOn/noteOff. */
function marimba(synth: Synth, params: ParamValues): Instrument {
  const output = synth.ctx.createGain();
  const voices = new Map<number, ((at: number) => void)[]>();
  let opts = resolveParams(MARIMBA_PARAMS, params) as { brightness: number; sustain: number; release: number };
  return {
    output,
    noteOn(pitch, velocity, when) {
      const release = synth.voice(pitch, when, velocity, output, opts);
      voices.set(pitch, [...(voices.get(pitch) ?? []), release]);
    },
    noteOff(pitch, when) {
      voices.get(pitch)?.shift()?.(when);
    },
    allNotesOff(when) {
      for (const list of voices.values()) for (const release of list) release(when);
      voices.clear();
    },
    set(p) {
      opts = resolveParams(MARIMBA_PARAMS, p) as typeof opts;
    },
    dispose() {
      output.disconnect();
    },
  };
}

/**
 * Envuelve un PolySynth de Tone: cada nota es una voz con ataque y release. `base`
 * son las opciones fijas del preset; los parámetros se aplican encima.
 */
function poly(defs: ParamDef[], volume: number, make: (options: Nested) => PolySynth): (synth: Synth, params: ParamValues) => Instrument {
  return (synth, params) => {
    const output = synth.ctx.createGain();
    const ps = make(toOptions(resolveParams(defs, params)));
    ps.volume.value = volume;
    ps.connect(output);
    return {
      output,
      noteOn: (pitch, velocity, when) => ps.triggerAttack(midiToFreq(pitch), when, velocity),
      noteOff: (pitch, when) => ps.triggerRelease(midiToFreq(pitch), when),
      allNotesOff: (when) => ps.releaseAll(when),
      set: (p) => ps.set(toOptions(resolveParams(defs, p))),
      dispose() {
        ps.dispose();
        output.disconnect();
      },
    };
  };
}

const LEAD_PARAMS: ParamDef[] = [
  {
    id: 'oscillator.type',
    label: 'Forma de onda',
    group: 'Oscilador',
    default: 'fatsawtooth',
    options: [
      { value: 'fatsawtooth', label: 'Sierra' },
      { value: 'fatsquare', label: 'Cuadrada' },
      { value: 'fattriangle', label: 'Triangular' },
    ],
  },
  { id: 'oscillator.spread', label: 'Desafinación', group: 'Oscilador', default: 20, min: 0, max: 80, step: 1, unit: 'cents' },
  ...envelope('Envolvente', { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }),
];

const BASS_PARAMS: ParamDef[] = [
  { id: 'oscillator.type', label: 'Forma de onda', group: 'Oscilador', default: 'square', options: WAVES.slice(1) },
  { id: 'filterEnvelope.baseFrequency', label: 'Corte', group: 'Filtro', default: 120, min: 30, max: 1000, step: 1, unit: 'Hz' },
  { id: 'filterEnvelope.octaves', label: 'Recorrido', group: 'Filtro', default: 3, min: 0, max: 6, step: 0.1, unit: 'oct' },
  { id: 'filter.Q', label: 'Resonancia', group: 'Filtro', default: 2, min: 0, max: 12, step: 0.1 },
  ...envelope('Envolvente', { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.15 }, { attack: 1, decay: 2, release: 2 }),
];

const PAD_PARAMS: ParamDef[] = [
  { id: 'oscillator.type', label: 'Forma de onda', group: 'Oscilador', default: 'sine', options: WAVES },
  { id: 'harmonicity', label: 'Armonicidad', group: 'Oscilador', default: 1.5, min: 0.25, max: 4, step: 0.05 },
  ...envelope('Envolvente', { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.5 }, { attack: 4, decay: 4, release: 6 }),
];

const PLUCK_PARAMS: ParamDef[] = [
  { id: 'harmonicity', label: 'Armonicidad', group: 'Modulación', default: 3, min: 0.5, max: 8, step: 0.05 },
  { id: 'modulationIndex', label: 'Brillo FM', group: 'Modulación', default: 8, min: 0, max: 40, step: 0.5 },
  { id: 'envelope.decay', label: 'Decay', group: 'Envolvente', default: 0.3, min: 0.05, max: 2, step: 0.01, unit: 's' },
  { id: 'envelope.release', label: 'Release', group: 'Envolvente', default: 0.2, min: 0.01, max: 2, step: 0.01, unit: 's' },
];

const DRUM_PARAMS: ParamDef[] = [
  { id: 'kick.pitchDecay', label: 'Barrido de tono', group: 'Bombo', default: 0.04, min: 0.005, max: 0.2, step: 0.005, unit: 's' },
  { id: 'kick.envelope.decay', label: 'Caída', group: 'Bombo', default: 0.35, min: 0.05, max: 1.5, step: 0.01, unit: 's' },
  { id: 'snare.envelope.decay', label: 'Caída', group: 'Caja', default: 0.16, min: 0.03, max: 0.6, step: 0.01, unit: 's' },
  { id: 'hat.envelope.decay', label: 'Caída', group: 'Hi-hat cerrado', default: 0.05, min: 0.01, max: 0.3, step: 0.005, unit: 's' },
  { id: 'crash.envelope.decay', label: 'Caída', group: 'Platillo', default: 1.4, min: 0.2, max: 4, step: 0.05, unit: 's' },
];

/**
 * Batería sintetizada con el mapa de percusión General MIDI (`DRUM_ROWS`). Los golpes
 * no usan noteOff: cada sonido tiene su propia caída. Las demás notas se ignoran.
 */
function drumKit(synth: Synth, params: ParamValues): Instrument {
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
  const voices: Partial<Record<DrumSound, { set(o: object): unknown }>> = { kick, snare, hat, crash };
  const set = (p: ParamValues) => {
    const opts = toOptions(resolveParams(DRUM_PARAMS, p));
    for (const [name, o] of Object.entries(opts)) voices[name as DrumSound]?.set(o as object);
  };
  set(params);

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
    set,
    dispose() {
      for (const p of parts) p.dispose();
      output.disconnect();
    },
  };
}

const info = (i: Omit<InstrumentInfo, 'exposed'> & { exposed?: string[] }): InstrumentInfo => ({ ...i, exposed: i.exposed ?? i.params.map((p) => p.id) });

export const INSTRUMENTS: InstrumentInfo[] = [
  info({ id: 'marimba', name: 'Marimba', create: marimba, params: MARIMBA_PARAMS }),
  info({
    id: 'synth:lead',
    name: 'Lead',
    params: LEAD_PARAMS,
    create: poly(LEAD_PARAMS, -4, (o) => new PolySynth(ToneSynth, merge({ oscillator: { count: 3 } }, o))),
  }),
  info({
    id: 'synth:bass',
    name: 'Bajo',
    params: BASS_PARAMS,
    create: poly(BASS_PARAMS, -10, (o) => new PolySynth(MonoSynth, merge({ filter: { type: 'lowpass' } }, o))),
  }),
  info({ id: 'synth:pad', name: 'Pad', params: PAD_PARAMS, create: poly(PAD_PARAMS, -2, (o) => new PolySynth(AMSynth, o)) }),
  info({
    id: 'synth:pluck',
    name: 'Pluck',
    params: PLUCK_PARAMS,
    create: poly(PLUCK_PARAMS, -3, (o) => new PolySynth(FMSynth, merge({ envelope: { attack: 0.002, sustain: 0 } }, o))),
  }),
  info({ id: 'drums:kit', name: 'Batería', create: drumKit, params: DRUM_PARAMS, rows: DRUM_ROWS }),
];

/** Busca un instrumento del catálogo. Un id desconocido suena como marimba. */
export function getInstrument(id: string): InstrumentInfo {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}
