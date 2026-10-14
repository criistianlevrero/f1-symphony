import { midiToFreq } from './theory';

/**
 * Sintetizador mínimo con Web Audio: un tono tipo marimba/campana para las notas
 * y un click para el metrónomo. Sin samples ni dependencias.
 */
export class Synth {
  readonly ctx: AudioContext;
  private master: GainNode;
  private clickGain: GainNode;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp);

    // Eco corto para dar un poco de espacio.
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.18;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.22;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.25;
    this.master.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(comp);

    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = 0.35;
    this.clickGain.connect(comp);
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get now() {
    return this.ctx.currentTime;
  }

  /** Toca una nota MIDI. `when` en segundos del AudioContext (0 = ya). */
  note(midi: number, duration: number, when = 0, velocity = 1) {
    const t = Math.max(when, this.ctx.currentTime);
    const f = midiToFreq(midi);
    const dur = Math.max(0.12, Math.min(duration, 2.5));
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * velocity, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.18 * velocity, t + 0.25);
    env.gain.setValueAtTime(0.18 * velocity, t + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    env.connect(this.master);

    const partials: [OscillatorType, number, number][] = [
      ['triangle', 1, 1],
      ['sine', 2, 0.35],
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
      osc.stop(t + dur + 0.4);
    }
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
