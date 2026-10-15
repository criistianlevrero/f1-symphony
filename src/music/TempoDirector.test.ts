import { describe, expect, it } from 'vitest';
import { TempoDirector } from './TempoDirector';

const DT = 1 / 60;

/** Simula `seconds` de manejo a `ratio` del tempo de diseño (2 beats/s). */
function drive(d: TempoDirector, state: { t: number; beat: number }, ratio: number, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state.t += DT;
    state.beat += 2 * ratio * DT;
    d.update(state.t, state.beat, state.t);
  }
}

describe('TempoDirector', () => {
  it('converge al tempo del auto y se activa', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: -4 };
    drive(d, s, 1, 2);
    expect(d.tempo).toBeCloseTo(2, 2);
    expect(d.active).toBe(true);
  });

  it('extrapola desde la última medición, con un tope', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: 0 };
    drive(d, s, 1, 2);
    expect(d.beatAt(s.t + 0.1)).toBeCloseTo(s.beat + 0.2, 1);
    expect(d.beatAt(s.t + 5)).toBeCloseTo(s.beat + 0.6, 1);
    expect(d.timeAt(s.beat + 1)).toBeCloseTo(s.t + 0.5, 1);
  });

  it('se apaga por debajo del 40 % y vuelve recién por encima del 50 %', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: 0 };
    drive(d, s, 1, 2);
    drive(d, s, 0.45, 2);
    expect(d.active).toBe(true);
    drive(d, s, 0.3, 2);
    expect(d.active).toBe(false);
    drive(d, s, 0.45, 2);
    expect(d.active).toBe(false);
    drive(d, s, 0.6, 2);
    expect(d.active).toBe(true);
  });

  it('marcha atrás: el tempo cae a cero y no extrapola', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: 0 };
    drive(d, s, 1, 2);
    drive(d, s, -0.5, 2);
    expect(d.currentBeat).toBeCloseTo(s.beat, 6);
    expect(d.tempo).toBeLessThan(0.01);
    expect(d.active).toBe(false);
    expect(d.beatAt(s.t + 1)).toBe(d.currentBeat);
  });

  it('al frenar, el ancla sigue al auto (no queda adelantada)', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: 0 };
    drive(d, s, 1, 2);
    drive(d, s, 0.6, 3);
    expect(d.beatAt(s.t)).toBeCloseTo(s.beat, 6);
  });

  it('un salto de posición no dispara el tempo más allá del tope', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: 0 };
    drive(d, s, 1, 1);
    s.t += DT;
    s.beat += 50;
    d.update(s.t, s.beat, s.t);
    expect(d.tempo).toBeLessThan(2 * 3);
  });

  it('reset vuelve al estado inicial', () => {
    const d = new TempoDirector(2);
    const s = { t: 0, beat: 0 };
    drive(d, s, 1, 2);
    d.reset();
    expect(d.active).toBe(false);
    expect(d.tempo).toBe(0);
  });
});
