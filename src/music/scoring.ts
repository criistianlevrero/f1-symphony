export type Judgement = 'perfect' | 'great' | 'good' | 'off' | 'miss';

export const JUDGEMENTS: Record<Judgement, { label: string; points: number; color: string }> = {
  perfect: { label: '¡Perfecto!', points: 100, color: '#5ef2c2' },
  great: { label: 'Muy bien', points: 70, color: '#7fb3ff' },
  good: { label: 'Bien', points: 40, color: '#f2c94c' },
  off: { label: 'Fuera de tiempo', points: 10, color: '#f2994a' },
  miss: { label: 'Perdida', points: 0, color: '#ff6b6b' },
};

/** Ventanas de error rítmico, en beats del tempo del jugador. */
export const WINDOWS = { perfect: 0.08, great: 0.16, good: 0.3 };
/** Cantidad de notas anteriores que se usan para estimar el tempo del jugador. */
const TEMPO_WINDOW = 6;
/** Bonus por tempo: máximo si se desvía menos de MIN, nada a partir de MAX. */
const TEMPO_BONUS = { max: 0.25, minDev: 0.03, maxDev: 0.2 };

interface Hit {
  index: number;
  T: number; // tiempo ideal (partitura, tempo original)
  t: number; // tiempo real del jugador
}

/** Ajuste lineal t ≈ a + k·T por mínimos cuadrados. Con un solo punto asume k = 1. */
export function fitTempo(hits: { T: number; t: number }[]): { a: number; k: number } {
  if (hits.length === 0) return { a: 0, k: 1 };
  if (hits.length === 1) return { a: hits[0].t - hits[0].T, k: 1 };
  const n = hits.length;
  const mT = hits.reduce((s, h) => s + h.T, 0) / n;
  const mt = hits.reduce((s, h) => s + h.t, 0) / n;
  let num = 0;
  let den = 0;
  for (const h of hits) {
    num += (h.T - mT) * (h.t - mt);
    den += (h.T - mT) ** 2;
  }
  const k = den > 1e-9 ? num / den : 1;
  return { a: mt - k * mT, k };
}

export function judge(errorBeats: number): Judgement {
  if (errorBeats <= WINDOWS.perfect) return 'perfect';
  if (errorBeats <= WINDOWS.great) return 'great';
  if (errorBeats <= WINDOWS.good) return 'good';
  return 'off';
}

export function tempoBonus(k: number) {
  const dev = Math.abs(k - 1);
  const x = (TEMPO_BONUS.maxDev - dev) / (TEMPO_BONUS.maxDev - TEMPO_BONUS.minDev);
  return TEMPO_BONUS.max * Math.max(0, Math.min(1, x));
}

export interface RunResult {
  score: number;
  /** Puntos rítmicos sobre el máximo posible (0..1), sin bonus. */
  accuracy: number;
  /** Factor de tempo k (t ≈ a + k·T): 1 = tempo original, >1 = más lento. */
  tempoFactor: number;
  tempoBonus: number;
  counts: Record<Judgement, number>;
  maxCombo: number;
  grade: string;
}

/**
 * Puntaje por ritmo relativo: cada nota se juzga contra el tempo que viene
 * llevando el jugador (no contra el original), así ir más rápido o más lento no
 * penaliza si el ritmo es parejo. Al final se suma un bonus por acercarse al
 * tempo original.
 */
export class RhythmScorer {
  private hits: Hit[] = [];
  readonly judgements: (Judgement | undefined)[];
  points = 0;
  combo = 0;
  maxCombo = 0;

  /**
   * @param times tiempo ideal de cada marcador desde el beat 0 (s)
   * @param secondsPerBeat al tempo original
   */
  constructor(
    private times: number[],
    private secondsPerBeat: number,
  ) {
    this.judgements = new Array(times.length).fill(undefined);
  }

  get resolved() {
    return this.judgements.filter(Boolean).length;
  }

  hit(index: number, t: number): { judgement: Judgement; errorBeats: number } {
    const T = this.times[index];
    const recent = this.hits.slice(-TEMPO_WINDOW);
    let judgement: Judgement = 'perfect';
    let errorBeats = 0;
    // Las dos primeras notas definen el tempo del jugador: no se juzgan.
    if (recent.length >= 2) {
      const { a, k } = fitTempo(recent);
      const beat = Math.max(k, 0.05) * this.secondsPerBeat;
      errorBeats = Math.abs(t - (a + k * T)) / beat;
      judgement = judge(errorBeats);
    }
    this.hits.push({ index, T, t });
    this.record(index, judgement);
    return { judgement, errorBeats };
  }

  miss(index: number) {
    this.record(index, 'miss');
  }

  private record(index: number, j: Judgement) {
    this.judgements[index] = j;
    this.points += JUDGEMENTS[j].points;
    this.combo = j === 'miss' || j === 'off' ? 0 : this.combo + 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }

  result(): RunResult {
    const counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, off: 0, miss: 0 };
    for (const j of this.judgements) counts[j ?? 'miss']++;
    const total = this.times.length;
    const points = this.judgements.reduce((s, j) => s + JUDGEMENTS[j ?? 'miss'].points, 0);
    const accuracy = total ? points / (total * JUDGEMENTS.perfect.points) : 0;
    const k = this.hits.length >= 2 ? fitTempo(this.hits).k : 1;
    const bonus = this.hits.length >= 2 ? tempoBonus(k) : 0;
    const grade = accuracy >= 0.95 ? 'S' : accuracy >= 0.85 ? 'A' : accuracy >= 0.7 ? 'B' : accuracy >= 0.5 ? 'C' : 'D';
    return {
      score: Math.round(points * (1 + bonus)),
      accuracy,
      tempoFactor: k,
      tempoBonus: bonus,
      counts,
      maxCombo: this.maxCombo,
      grade,
    };
  }
}
