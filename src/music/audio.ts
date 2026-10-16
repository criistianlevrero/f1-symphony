// Import directo del módulo: el índice de Tone crea el AudioContext al importarse,
// fuera de un gesto del usuario (ver docs/AUDIO.md, «Riesgos conocidos»).
import { getContext } from 'tone/build/esm/core/Global.js';
import type { SongEffects } from '../track/types';
import { EffectBuses } from './effects';
import { midiToFreq } from './theory';

/**
 * Salida de audio de la app: un tono tipo marimba/campana para las notas, un click
 * para el metrónomo y el bus donde se conectan los instrumentos.
 */
/** Corte de seguridad para una voz que nunca se suelta (s). */
const MAX_VOICE = 30;

export class Synth {
  /**
   * El contexto crudo de Tone (latencia «interactive»), compartido con los
   * instrumentos para que nodos nativos y de Tone se puedan conectar.
   */
  readonly ctx: AudioContext;
  /** Entrada del bus principal (seco, con compresor). Los efectos irán en buses aparte. */
  readonly master: GainNode;
  /** Buses de efectos A (reverb) y B (delay), que vuelven a `master`. */
  readonly buses: EffectBuses;
  private clickGain: GainNode;

  constructor() {
    const tone = getContext();
    // El secuenciador programa con tiempos exactos; sin esto Tone corre sus cambios
    // de parámetros (volumen, etc.) 0,1 s hacia adelante y la primera nota sale fuerte.
    tone.lookAhead = 0;
    this.ctx = tone.rawContext as AudioContext;
    const comp = this.ctx.createDynamicsCompressor();
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp);
    this.buses = new EffectBuses(this.ctx, this.master);

    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = 0.35;
    this.clickGain.connect(comp);
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Configura los buses con los efectos de la canción abierta. */
  setEffects(effects: SongEffects | undefined) {
    this.buses.set(effects);
  }

  get now() {
    return this.ctx.currentTime;
  }

  /** Toca una nota MIDI. `when` en segundos del AudioContext (0 = ya). */
  note(midi: number, duration: number, when = 0, velocity = 1) {
    const t = Math.max(when, this.ctx.currentTime);
    this.voice(midi, t, velocity)(t + Math.max(0.12, Math.min(duration, 2.5)));
  }

  /**
   * Arranca una nota de marimba en `when` hacia `dest` y devuelve la función que la
   * suelta (con la cola de `release`). Si nunca se suelta, se corta a los 30 s.
   * `brightness` es el nivel del segundo armónico y `sustain`, el nivel que queda
   * después del golpe.
   */
  voice(midi: number, when: number, velocity = 1, dest: AudioNode = this.master, { brightness = 0.35, sustain = 0.18, release = 0.35 } = {}) {
    const t = when;
    const f = midiToFreq(midi);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * velocity, t + 0.006);
    env.gain.exponentialRampToValueAtTime(sustain * velocity, t + 0.25);
    env.connect(dest);
    const oscs: OscillatorNode[] = [];

    const partials: [OscillatorType, number, number][] = [
      ['triangle', 1, 1],
      ['sine', 2, brightness],
      ['sine', 4.01, 0.08],
    ];
    for (const [type, mult, gain] of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(t + MAX_VOICE);
      oscs.push(osc);
    }
    let released = false;
    return (at: number) => {
      if (released) return;
      released = true;
      const r = Math.max(at, t + 0.12, this.ctx.currentTime);
      if (r >= t + MAX_VOICE) return;
      // Mantiene el valor que tenga la envolvente en r y desde ahí hace la cola.
      if (env.gain.cancelAndHoldAtTime) env.gain.cancelAndHoldAtTime(r);
      else {
        env.gain.cancelScheduledValues(r);
        env.gain.setValueAtTime(sustain * velocity, r);
      }
      env.gain.exponentialRampToValueAtTime(0.0001, r + release);
      for (const osc of oscs) osc.stop(r + release + 0.05);
    };
  }

  /** Click de metrónomo; `accent` para el primer tiempo del compás. */
  click(accent: boolean, when = 0) {
    const t = Math.max(when, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1175;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(accent ? 0.5 : 0.3, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(env);
    env.connect(this.clickGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

let shared: Synth | null = null;

/** Un solo AudioContext para toda la app (los navegadores limitan cuántos se crean). */
export function getSynth() {
  shared ??= new Synth();
  shared.resume();
  return shared;
}

/** Estado del audio: 'running' si suena; otro valor si el navegador lo tiene bloqueado. */
export function audioState(): AudioContextState | 'none' {
  return shared?.ctx.state ?? 'none';
}

/**
 * Los navegadores solo dejan arrancar el audio dentro de un gesto del usuario
 * (click, toque o tecla); Safari además exige que el AudioContext se cree ahí.
 * Este listener crea/reactiva el audio en cada gesto, así nunca queda trabado.
 */
export function installAudioUnlock() {
  let primed = false;
  const unlock = () => {
    const synth = getSynth();
    if (synth.ctx.state !== 'running') void synth.ctx.resume();
    if (!primed) {
      // Un buffer silencioso termina de destrabar el audio en iOS/Safari.
      const src = synth.ctx.createBufferSource();
      src.buffer = synth.ctx.createBuffer(1, 1, synth.ctx.sampleRate);
      src.connect(synth.ctx.destination);
      src.start(0);
      primed = true;
    }
  };
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, { capture: true });
}
