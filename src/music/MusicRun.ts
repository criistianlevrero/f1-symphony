import * as THREE from 'three';
import type { TrackPath } from '../track/TrackPath';
import type { Song } from '../track/types';
import { getSynth, type Synth } from './audio';
import { CHORD_SPACING, MarkerView } from './MarkerView';
import { JUDGEMENTS, RhythmScorer, type Judgement, type RunResult } from './scoring';
import { computeMarkers, distanceToBeat, secondsPerBeat, type Marker } from './song';

/** Zona de toque: cilindro alrededor del marcador, alineado con la pista. */
const HIT_RADIUS = 3.4;
const HIT_BELOW = 3;
const HIT_ABOVE = 9; // generoso hacia arriba, para tocar notas en pleno salto
/** Un marcador que quedó tantos metros atrás sin tocarse cuenta como perdido. */
const MISS_DISTANCE = 10;

export interface MusicHudState {
  /** Beat al tempo original (corre por reloj desde que el auto cruza el beat 0). */
  originalBeat: number;
  /** Beat según la posición del auto en la pista. */
  playerBeat: number;
  beatsPerBar: number;
  bpm: number;
  designSpeed: number;
  last: { judgement: Judgement; at: number } | null;
  score: number;
  combo: number;
  resolved: number;
  total: number;
}

const rel = new THREE.Vector3();

export function isHit(m: Marker, carPos: THREE.Vector3) {
  rel.subVectors(carPos, m.position);
  const up = rel.dot(m.frame.up);
  if (up < -HIT_BELOW || up > HIT_ABOVE) return false;
  const along = rel.dot(m.frame.t);
  const lateral = Math.max(0, Math.abs(rel.dot(m.frame.right)) - ((m.notes.length - 1) * CHORD_SPACING) / 2);
  return Math.hypot(along, lateral) < HIT_RADIUS;
}

/** Lógica musical de una vuelta: marcadores, sonido, metrónomo y puntaje. */
export class MusicRun {
  readonly markers: Marker[];
  readonly overflow: number;
  readonly view: MarkerView;
  readonly hud: MusicHudState;
  metronome = true;

  private scorer!: RhythmScorer;
  private synth: Synth;
  private next = 0;
  private crossTime: number | null = null;
  private lastClick = -Infinity;
  private spb: number;

  constructor(
    private song: Song,
    path: TrackPath | null,
  ) {
    const { markers, overflow } = computeMarkers(song, path);
    this.markers = markers;
    this.overflow = overflow;
    this.view = new MarkerView(markers);
    this.synth = getSynth();
    this.spb = secondsPerBeat(song);
    this.hud = {
      originalBeat: 0,
      playerBeat: 0,
      beatsPerBar: song.beatsPerBar,
      bpm: song.bpm,
      designSpeed: song.designSpeed,
      last: null,
      score: 0,
      combo: 0,
      resolved: 0,
      total: markers.length,
    };
    this.reset();
  }

  reset() {
    this.scorer = new RhythmScorer(
      this.markers.map((m) => m.time),
      this.spb,
    );
    this.next = 0;
    this.crossTime = null;
    this.lastClick = -Infinity;
    this.view.reset();
    Object.assign(this.hud, { last: null, score: 0, combo: 0, resolved: 0 });
    this.updateBeats(0, 0, 0);
  }

  private updateBeats(time: number, progress: number, speed: number) {
    const playerBeat = distanceToBeat(this.song, progress);
    if (this.crossTime === null && progress >= this.song.startOffset) {
      // Momento (interpolado) en que el auto pasó por el beat 0.
      this.crossTime = time - (progress - this.song.startOffset) / Math.max(speed, 1);
    }
    this.hud.playerBeat = playerBeat;
    this.hud.originalBeat = this.crossTime === null ? playerBeat : (time - this.crossTime) / this.spb;
  }

  /** Se llama en cada paso de física mientras la vuelta está en curso. */
  step(time: number, carPos: THREE.Vector3, progress: number, speed: number) {
    this.updateBeats(time, progress, speed);

    if (this.metronome) {
      const beat = Math.floor(this.hud.originalBeat);
      if (beat > this.lastClick && beat >= -this.song.beatsPerBar) {
        if (this.lastClick > -Infinity) this.synth.click(((beat % this.song.beatsPerBar) + this.song.beatsPerBar) % this.song.beatsPerBar === 0);
        this.lastClick = beat;
      }
    }

    for (let i = this.next; i < this.markers.length; i++) {
      const m = this.markers[i];
      if (m.s > progress + 20) break;
      if (this.scorer.judgements[i]) continue;
      if (isHit(m, carPos)) {
        const { judgement } = this.scorer.hit(i, time);
        for (const n of m.notes) this.synth.note(n.pitch, n.duration * this.spb);
        this.view.setHit(i, JUDGEMENTS[judgement].color);
        this.hud.last = { judgement, at: time };
      } else if (m.s < progress - MISS_DISTANCE) {
        this.scorer.miss(i);
        this.view.setMissed(i);
        this.hud.last = { judgement: 'miss', at: time };
      }
    }
    while (this.next < this.markers.length && this.scorer.judgements[this.next]) this.next++;

    this.hud.score = this.scorer.points;
    this.hud.combo = this.scorer.combo;
    this.hud.resolved = this.scorer.resolved;
  }

  result(): RunResult {
    return this.scorer.result();
  }

  dispose() {
    this.view.dispose();
  }
}
