import { describe, expect, it } from 'vitest';
import { fitTempo, RhythmScorer, tempoBonus } from './scoring';

const spb = 0.5; // 120 BPM
const times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];

describe('fitTempo', () => {
  it('recupera offset y factor de tempo', () => {
    const hits = times.map((T) => ({ T, t: 3 + 1.2 * T }));
    const { a, k } = fitTempo(hits);
    expect(a).toBeCloseTo(3);
    expect(k).toBeCloseTo(1.2);
  });
});

describe('RhythmScorer', () => {
  it('no penaliza un tempo distinto si el ritmo es parejo', () => {
    const s = new RhythmScorer(times, spb);
    times.forEach((T, i) => expect(s.hit(i, 10 + 1.3 * T).judgement).toBe('perfect'));
    const r = s.result();
    expect(r.accuracy).toBe(1);
    expect(r.tempoFactor).toBeCloseTo(1.3);
    expect(r.tempoBonus).toBe(0);
    expect(r.grade).toBe('S');
  });

  it('da el bonus máximo al tempo original', () => {
    const s = new RhythmScorer(times, spb);
    times.forEach((T, i) => s.hit(i, 5 + T));
    const r = s.result();
    expect(r.tempoBonus).toBeCloseTo(0.25);
    expect(r.score).toBe(Math.round(800 * 1.25));
  });

  it('juzga una nota adelantada y corta el combo', () => {
    const s = new RhythmScorer(times, spb);
    for (let i = 0; i < 4; i++) s.hit(i, times[i]);
    // Medio beat antes de lo esperado.
    expect(s.hit(4, times[4] - 0.25).judgement).toBe('off');
    expect(s.combo).toBe(0);
    s.miss(5);
    expect(s.result().counts.miss).toBe(3); // la 5 y las que nunca se tocaron (6, 7)
  });
});

describe('tempoBonus', () => {
  it('decae linealmente entre 3% y 20%', () => {
    expect(tempoBonus(1.02)).toBeCloseTo(0.25);
    expect(tempoBonus(0.75)).toBe(0);
    expect(tempoBonus(1.115)).toBeCloseTo(0.125);
  });
});
