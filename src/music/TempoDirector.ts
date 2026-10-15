import type { BeatClock } from './Sequencer';

/** Constante de tiempo del suavizado del tempo (s). */
const SMOOTHING = 0.25;
/** Por debajo de esta fracción del tempo de diseño el acompañamiento se apaga… */
const OFF_RATIO = 0.4;
/** …y vuelve recién por encima de esta (histéresis, para que no titile). */
const ON_RATIO = 0.5;
/** Tope del tempo medido, para que un salto de posición no dispare la extrapolación. */
const MAX_RATIO = 3;
/** Cuánto se extrapola como máximo desde la última medición (s). */
const MAX_EXTRAPOLATION = 0.3;

/**
 * Reloj de beats que sigue al auto. Mide el tempo a partir del beat del jugador en
 * cada paso de física (tiempo de simulación), lo suaviza, y lo ancla al tiempo del
 * AudioContext para que el secuenciador pueda programar hacia adelante.
 *
 * El ancla es siempre el beat medido, aunque retroceda (marcha atrás): si se
 * quedara con lo extrapolado, al frenar el tempo suavizado (que va atrasado) lo
 * dejaría adelantado para siempre. Que no se repitan notas lo garantiza el
 * horizonte del secuenciador.
 */
export class TempoDirector implements BeatClock {
  /** Tempo suavizado, en beats por segundo. */
  tempo = 0;
  /** Si el acompañamiento debería sonar (tempo suficiente, con histéresis). */
  active = false;
  private beat = -Infinity;
  private anchorTime = 0;
  private lastSim: number | null = null;

  /** `designTempo`: beats por segundo a la velocidad de diseño (bpm / 60). */
  constructor(private designTempo: number) {}

  reset() {
    this.tempo = 0;
    this.active = false;
    this.beat = -Infinity;
    this.lastSim = null;
  }

  /** Último beat medido. */
  get currentBeat() {
    return this.beat;
  }

  /**
   * Nueva medición: `simTime` y `playerBeat` vienen de la física; `audioNow` es el
   * tiempo del AudioContext en este momento.
   */
  update(simTime: number, playerBeat: number, audioNow: number) {
    if (this.lastSim !== null) {
      const dt = simTime - this.lastSim;
      if (dt > 0) {
        const raw = Math.min(Math.max(0, (playerBeat - this.beat) / dt), this.designTempo * MAX_RATIO);
        this.tempo += (raw - this.tempo) * (1 - Math.exp(-dt / SMOOTHING));
      }
    }
    this.lastSim = simTime;
    this.beat = playerBeat;
    this.anchorTime = audioNow;

    const ratio = this.tempo / this.designTempo;
    if (this.active && ratio < OFF_RATIO) this.active = false;
    else if (!this.active && ratio > ON_RATIO) this.active = true;
  }

  beatAt(time: number) {
    if (!this.active || !Number.isFinite(this.beat)) return this.beat;
    return this.beat + this.tempo * Math.min(Math.max(0, time - this.anchorTime), MAX_EXTRAPOLATION);
  }

  timeAt(beat: number) {
    if (this.tempo <= 1e-6 || beat <= this.beat) return this.anchorTime;
    return this.anchorTime + (beat - this.beat) / this.tempo;
  }
}
