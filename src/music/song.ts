import * as THREE from 'three';
import type { Frame } from '../track/layout';
import type { TrackPath } from '../track/TrackPath';
import type { Song, SongNote } from '../track/types';

/** Distancia libre al final del recorrido donde no se ubican marcadores (m). */
const END_MARGIN = 8;

export const secondsPerBeat = (song: Song) => 60 / song.bpm;
export const beatToTime = (song: Song, beat: number) => beat * secondsPerBeat(song);
export const beatToDistance = (song: Song, beat: number) => song.startOffset + song.designSpeed * beatToTime(song, beat);
export const distanceToBeat = (song: Song, s: number) => (s - song.startOffset) / song.designSpeed / secondsPerBeat(song);

/** Cuántos beats entran en la pista a la velocidad de diseño. */
export function availableBeats(song: Song, pathLength: number) {
  return Math.max(0, distanceToBeat(song, pathLength - END_MARGIN));
}

export function songLengthBeats(song: Song) {
  return song.notes.reduce((m, n) => Math.max(m, n.beat + n.duration), 0);
}

export interface Marker {
  /** Beat de la partitura (las notas simultáneas comparten marcador). */
  beat: number;
  /** Tiempo ideal desde el beat 0, al tempo original (s). */
  time: number;
  s: number;
  notes: SongNote[];
  frame: Frame;
  /** Centro del marcador en el mundo (a la altura del auto). */
  position: THREE.Vector3;
}

/**
 * Ubica un marcador por cada momento de la melodía sobre la línea central:
 * s = inicio + velocidadDeDiseño × tiempo. Devuelve también las notas que no
 * entran en la pista.
 */
export function computeMarkers(song: Song, path: TrackPath | null): { markers: Marker[]; overflow: number } {
  if (!path) return { markers: [], overflow: song.notes.length };
  const groups = new Map<number, SongNote[]>();
  for (const n of song.notes) {
    const key = Math.round(n.beat * 1000) / 1000;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const markers: Marker[] = [];
  let overflow = 0;
  for (const [beat, notes] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const s = beatToDistance(song, beat);
    if (s < 0 || s > path.length - END_MARGIN) {
      overflow += notes.length;
      continue;
    }
    const frame = path.frameAt(s);
    markers.push({
      beat,
      time: beatToTime(song, beat),
      s,
      notes: notes.sort((a, b) => a.pitch - b.pitch),
      frame,
      position: frame.p.clone().addScaledVector(frame.up, 1.4),
    });
  }
  return { markers, overflow };
}
