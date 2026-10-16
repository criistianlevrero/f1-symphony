// Imports directos de cada módulo de Tone: el índice crea el AudioContext al
// importarse, fuera de un gesto del usuario (ver docs/AUDIO.md, «Riesgos conocidos»).
import { connect } from 'tone/build/esm/core/context/ToneAudioNode.js';
import { FeedbackDelay } from 'tone/build/esm/effect/FeedbackDelay.js';
import { Freeverb } from 'tone/build/esm/effect/Freeverb.js';
import type { SongEffects } from '../track/types';
import { resolveParams, toOptions, type ParamDef, type ParamValues } from './instruments';

/** Nivel con que el bus vuelve al bus principal. No es un parámetro de Tone. */
const RETURN = 'return';

type BusId = keyof SongEffects;

interface ToneEffect {
  input: unknown;
  wet: { value: number };
  set(options: object): unknown;
  connect(dest: AudioNode): unknown;
  dispose(): unknown;
}

export interface BusInfo {
  id: BusId;
  name: string;
  /** Nombre corto para el envío de cada pista. */
  sendLabel: string;
  params: ParamDef[];
  create(): ToneEffect;
}

const returnParam = (group: string): ParamDef => ({ id: RETURN, label: 'Nivel de retorno', group, default: 0.4, min: 0, max: 1, step: 0.01 });

export const BUSES: BusInfo[] = [
  {
    id: 'a',
    name: 'Bus A: Reverb',
    sendLabel: 'Envío Reverb',
    params: [
      { id: 'roomSize', label: 'Tamaño de sala', group: 'Reverb', default: 0.75, min: 0, max: 0.98, step: 0.01 },
      { id: 'dampening', label: 'Amortiguación', group: 'Reverb', default: 3000, min: 200, max: 10000, step: 10, unit: 'Hz' },
      returnParam('Reverb'),
    ],
    // Freeverb es algorítmico: responde al instante (el Reverb de convolución no).
    create: () => new Freeverb(),
  },
  {
    id: 'b',
    name: 'Bus B: Delay',
    sendLabel: 'Envío Delay',
    params: [
      { id: 'delayTime', label: 'Tiempo', group: 'Delay', default: 0.25, min: 0.02, max: 1, step: 0.005, unit: 's' },
      { id: 'feedback', label: 'Realimentación', group: 'Delay', default: 0.3, min: 0, max: 0.9, step: 0.01 },
      returnParam('Delay'),
    ],
    create: () => new FeedbackDelay({ maxDelay: 1 }),
  },
];

/**
 * Los dos buses de efectos: cada pista manda una parte de su señal a `inputs[i]`, el
 * efecto procesa solo lo enviado (wet = 1) y vuelve a `dest` con su nivel de retorno.
 */
export class EffectBuses {
  /** Entradas nativas de los buses A y B, en el orden de `BUSES`. */
  readonly inputs: GainNode[];
  private effects: ToneEffect[];
  private returns: GainNode[];

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.inputs = BUSES.map(() => ctx.createGain());
    this.returns = BUSES.map(() => ctx.createGain());
    this.effects = BUSES.map((bus, i) => {
      const fx = bus.create();
      fx.wet.value = 1;
      connect(this.inputs[i], fx as never);
      fx.connect(this.returns[i]);
      this.returns[i].connect(dest);
      return fx;
    });
    this.set(undefined);
  }

  /** Aplica los ajustes de la canción (lo que falte vuelve al preset). */
  set(effects: SongEffects | undefined) {
    BUSES.forEach((bus, i) => {
      const { [RETURN]: level, ...rest } = resolveParams(bus.params, effects?.[bus.id] as ParamValues | undefined);
      this.effects[i].set(toOptions(rest));
      this.returns[i].gain.value = level as number;
    });
  }

  dispose() {
    for (const fx of this.effects) fx.dispose();
    for (const n of [...this.inputs, ...this.returns]) n.disconnect();
  }
}
