import type { Song } from '../track/types';
import type { Synth } from './audio';
import { getInstrument, type Instrument, type ParamValues } from './instruments';
import { unroll } from './song';

/** Cada cuánto se revisa qué programar (ms) y cuánto hacia adelante (s). */
const INTERVAL_MS = 25;
const LOOKAHEAD = 0.1;
const VELOCITY = 0.8;

/**
 * Relación entre beats tocados y tiempo del AudioContext. En el editor es un reloj
 * fijo al BPM; en el juego, el director que sigue al auto.
 */
export interface BeatClock {
  beatAt(time: number): number;
  timeAt(beat: number): number;
}

export function fixedClock(bpm: number, startTime: number, startBeat: number): BeatClock {
  const spb = 60 / bpm;
  return {
    beatAt: (time) => startBeat + (time - startTime) / spb,
    timeAt: (beat) => startTime + (beat - startBeat) * spb,
  };
}

/** Salida de una pista: su instrumento más el volumen. */
export interface TrackOutput {
  instrument: Instrument;
  setVolume(volume: number): void;
  dispose(): void;
}

export interface SequencerDeps {
  now(): number;
  create(instrumentId: string, params: ParamValues): TrackOutput;
}

/** Conecta cada pista al bus principal de `synth` con su propio volumen. */
export function audioDeps(synth: Synth): SequencerDeps {
  return {
    now: () => synth.now,
    create(instrumentId, params) {
      const instrument = getInstrument(instrumentId).create(synth, params);
      const gain = synth.ctx.createGain();
      instrument.output.connect(gain);
      gain.connect(synth.master);
      return {
        instrument,
        setVolume: (v) => gain.gain.setTargetAtTime(v, synth.now, 0.02),
        dispose() {
          instrument.dispose();
          gain.disconnect();
        },
      };
    },
  };
}

interface NoteEvent {
  beat: number;
  end: number;
  pitch: number;
}

interface Voice {
  instrumentId: string;
  /** Parámetros aplicados, serializados para detectar cambios. */
  paramsKey: string;
  out: TrackOutput;
  events: NoteEvent[];
  next: number;
  sounding: NoteEvent[];
}

/**
 * Toca todas las pistas de una canción con lookahead («A Tale of Two Clocks»): cada
 * 25 ms programa las notas que empiezan o terminan en los próximos 100 ms, según el
 * reloj. El beat solo avanza: si el reloj retrocede, no se repite nada.
 */
export class Sequencer {
  private voices = new Map<string, Voice>();
  private clock: BeatClock | null = null;
  private horizon = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: SequencerDeps) {}

  get playing() {
    return this.clock !== null;
  }

  /** Hasta qué beat ya se programó. */
  get horizonBeat() {
    return this.horizon;
  }

  /** Beat que está sonando ahora, o null si está detenido. */
  get beat() {
    return this.clock ? this.clock.beatAt(this.deps.now()) : null;
  }

  /** Carga (o actualiza en vivo) las pistas. Reusa el instrumento si no cambió. */
  setSong(song: Song) {
    const ids = new Set(song.tracks.map((t) => t.id));
    for (const [id, v] of this.voices) {
      if (!ids.has(id)) {
        this.release(v, this.deps.now());
        v.out.dispose();
        this.voices.delete(id);
      }
    }
    for (const track of song.tracks) {
      let v = this.voices.get(track.id);
      if (v && v.instrumentId !== track.instrument) {
        this.release(v, this.deps.now());
        v.out.dispose();
        v = undefined;
      }
      const paramsKey = JSON.stringify(track.params ?? {});
      if (!v) {
        v = { instrumentId: track.instrument, paramsKey, out: this.deps.create(track.instrument, track.params ?? {}), events: [], next: 0, sounding: [] };
        this.voices.set(track.id, v);
      } else if (v.paramsKey !== paramsKey) {
        // Cambio de parámetros: se aplica al instrumento en vivo, sin recrearlo.
        v.paramsKey = paramsKey;
        v.out.instrument.set(track.params ?? {});
      }
      v.out.setVolume(track.volume ?? 1);
      v.events = unroll(track).map((n) => ({ beat: n.beat, end: n.beat + n.duration, pitch: n.pitch }));
      v.next = v.events.findIndex((e) => e.beat >= this.horizon);
      if (v.next < 0) v.next = v.events.length;
    }
  }

  /** Empieza a tocar desde `fromBeat`; las notas anteriores no suenan. */
  start(clock: BeatClock, fromBeat: number) {
    this.stop();
    this.clock = clock;
    this.horizon = fromBeat;
    for (const v of this.voices.values()) {
      v.next = v.events.findIndex((e) => e.beat >= fromBeat);
      if (v.next < 0) v.next = v.events.length;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
  }

  /** Corta todo: lo que suena se suelta ya y lo programado no llega a sonar. */
  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.clock = null;
    const now = this.deps.now();
    for (const v of this.voices.values()) this.release(v, now);
  }

  /** Programa lo que cae antes del horizonte. Público para los tests. */
  tick(now = this.deps.now()) {
    const clock = this.clock;
    if (!clock) return;
    const horizon = clock.beatAt(now + LOOKAHEAD);
    if (horizon <= this.horizon) return;
    this.horizon = horizon;
    const at = (beat: number) => Math.max(clock.timeAt(beat), now);

    for (const v of this.voices.values()) {
      // Junta encendidos y apagados para despacharlos en orden; a igual beat el
      // apagado va primero, así una nota repetida no se corta a sí misma.
      const due: { beat: number; on: boolean; e: NoteEvent }[] = [];
      while (v.next < v.events.length && v.events[v.next].beat < horizon) {
        const e = v.events[v.next++];
        due.push({ beat: e.beat, on: true, e });
        v.sounding.push(e);
      }
      v.sounding = v.sounding.filter((e) => {
        if (e.end >= horizon) return true;
        due.push({ beat: e.end, on: false, e });
        return false;
      });
      due.sort((a, b) => a.beat - b.beat || Number(a.on) - Number(b.on));
      const inst = v.out.instrument;
      for (const d of due) {
        if (d.on) inst.noteOn(d.e.pitch, VELOCITY, at(d.beat));
        else inst.noteOff(d.e.pitch, at(d.beat));
      }
    }
  }

  /** Toca una nota suelta con el instrumento de una pista (para probar en el editor). */
  preview(trackId: string, pitch: number, duration = 0.3) {
    const inst = this.voices.get(trackId)?.out.instrument;
    if (!inst) return;
    const now = this.deps.now();
    inst.noteOn(pitch, VELOCITY, now);
    inst.noteOff(pitch, now + duration);
  }

  private release(v: Voice, now: number) {
    v.sounding = [];
    v.out.instrument.allNotesOff(now);
  }

  dispose() {
    this.stop();
    for (const v of this.voices.values()) v.out.dispose();
    this.voices.clear();
  }
}
