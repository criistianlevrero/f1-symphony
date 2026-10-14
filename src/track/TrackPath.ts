import * as THREE from 'three';
import type { Frame } from './layout';

export interface PathSample extends Frame {
  s: number; // metros desde el inicio del recorrido
}

/**
 * Línea central del recorrido completo, parametrizada por distancia (s).
 * Se usa para ubicar marcadores y para saber cuánto avanzó el auto.
 */
export class TrackPath {
  readonly samples: PathSample[] = [];
  private tmp = new THREE.Vector3();

  constructor(frames: Frame[]) {
    let s = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (i > 0) {
        const d = f.p.distanceTo(frames[i - 1].p);
        if (d < 1e-4) continue; // puntos duplicados entre tramos
        s += d;
      }
      this.samples.push({ ...f, s });
    }
  }

  get length() {
    return this.samples.length ? this.samples[this.samples.length - 1].s : 0;
  }

  private indexAt(s: number) {
    const a = this.samples;
    let lo = 0;
    let hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid].s <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Marco interpolado a la distancia s. */
  frameAt(s: number): Frame {
    const a = this.samples;
    if (a.length === 0) throw new Error('Recorrido vacío');
    const clamped = Math.max(0, Math.min(this.length, s));
    const i = this.indexAt(clamped);
    const j = Math.min(i + 1, a.length - 1);
    const span = a[j].s - a[i].s;
    const k = span > 0 ? (clamped - a[i].s) / span : 0;
    const lerp = (x: THREE.Vector3, y: THREE.Vector3) => new THREE.Vector3().lerpVectors(x, y, k);
    return {
      p: lerp(a[i].p, a[j].p),
      t: lerp(a[i].t, a[j].t).normalize(),
      up: lerp(a[i].up, a[j].up).normalize(),
      right: lerp(a[i].right, a[j].right).normalize(),
    };
  }

  /**
   * Proyecta un punto sobre el recorrido. Busca alrededor de `hint` (índice de la
   * proyección anterior) para que sea barato llamarlo cada paso de física.
   */
  project(point: THREE.Vector3, hint = -1, window = 40): { s: number; index: number; distance: number } {
    const a = this.samples;
    const from = hint < 0 ? 0 : Math.max(0, hint - window);
    const to = hint < 0 ? a.length - 2 : Math.min(a.length - 2, hint + window);
    let best = { s: 0, index: 0, distance: Infinity };
    for (let i = from; i <= to; i++) {
      const p0 = a[i].p;
      const seg = this.tmp.subVectors(a[i + 1].p, p0);
      const len2 = seg.lengthSq();
      const k = len2 > 0 ? Math.max(0, Math.min(1, (point.x - p0.x) * seg.x / len2 + (point.y - p0.y) * seg.y / len2 + (point.z - p0.z) * seg.z / len2)) : 0;
      const px = p0.x + seg.x * k;
      const py = p0.y + seg.y * k;
      const pz = p0.z + seg.z * k;
      const d = Math.hypot(point.x - px, point.y - py, point.z - pz);
      if (d < best.distance) best = { s: a[i].s + (a[i + 1].s - a[i].s) * k, index: i, distance: d };
    }
    return best;
  }
}
