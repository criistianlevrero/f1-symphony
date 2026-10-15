import * as THREE from 'three';
import type { Frame } from '../track/layout';
import type { TrackPath } from '../track/TrackPath';
import type { Repeat, Song, SongNote, SongTrack } from '../track/types';

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

/** La pista del auto. La validación al cargar garantiza que existe. */
export function mainTrack(song: Song): SongTrack {
  return song.tracks.find((t) => t.main) ?? song.tracks[0];
}

const byStart = (repeats: Repeat[]) => [...repeats].sort((a, b) => a.start - b.start);

/** Nota desplegada, con el índice de la nota escrita y la vuelta (0 = la escrita). */
export interface PlayedNote {
  note: SongNote;
  index: number;
  copy: number;
}

/**
 * Despliega las repeticiones: devuelve las notas en beats tocados. Cada repetición
 * inserta (times − 1) vueltas extra y corre lo que sigue en esa pista. Una nota que
 * empieza dentro del tramo se copia en cada vuelta con su duración original.
 */
export function unrollWithSource(track: SongTrack): PlayedNote[] {
  const repeats = byStart(track.repeats);
  const out: PlayedNote[] = [];
  track.notes.forEach((n, index) => {
    let shift = 0;
    let copies = 1;
    let len = 0;
    for (const r of repeats) {
      const extra = (r.times - 1) * (r.end - r.start);
      if (n.beat >= r.end) shift += extra;
      else if (n.beat >= r.start) {
        copies = r.times;
        len = r.end - r.start;
        break;
      } else break;
    }
    for (let copy = 0; copy < copies; copy++) out.push({ note: { ...n, beat: n.beat + shift + copy * len }, index, copy });
  });
  return out.sort((a, b) => a.note.beat - b.note.beat || a.note.pitch - b.note.pitch);
}

export function unroll(track: SongTrack): SongNote[] {
  return unrollWithSource(track).map((p) => p.note);
}

/** Beat tocado de la primera vuelta de un beat escrito. */
export function playedBeat(track: SongTrack, written: number): number {
  let shift = 0;
  for (const r of byStart(track.repeats)) if (written >= r.end) shift += (r.times - 1) * (r.end - r.start);
  return written + shift;
}

/** Tramo tocado que ocupa una repetición, con todas sus vueltas. */
export function playedRepeat(track: SongTrack, r: Repeat) {
  const start = playedBeat(track, r.start);
  return { start, end: start + r.times * (r.end - r.start), firstEnd: start + (r.end - r.start) };
}

const overlaps = (a: Repeat, b: Repeat) => a.start < b.end && b.start < a.end;

/** Agrega una repetición. Devuelve la lista nueva, o un mensaje si no se puede. */
export function addRepeat(track: SongTrack, r: Repeat): Repeat[] | string {
  if (r.end <= r.start) return 'El tramo está vacío';
  if (r.times < 2) return 'Tiene que sonar al menos dos veces';
  if (track.repeats.some((o) => overlaps(o, r))) return 'Se superpone con otra repetición';
  return byStart([...track.repeats, r]);
}

/**
 * Mueve las notas y repeticiones seleccionadas `dBeat` beats escritos y `dPitch`
 * semitonos. Ajusta el movimiento para que nada quede antes del beat 0 ni fuera de
 * [low, high]. Devuelve null si las repeticiones se superpondrían.
 */
export function moveSelection(
  track: SongTrack,
  notes: ReadonlySet<number>,
  repeats: ReadonlySet<number>,
  dBeat: number,
  dPitch: number,
  low: number,
  high: number,
): SongTrack | null {
  const selNotes = track.notes.filter((_, i) => notes.has(i));
  const selRepeats = track.repeats.filter((_, i) => repeats.has(i));
  const minBeat = Math.min(...selNotes.map((n) => n.beat), ...selRepeats.map((r) => r.start));
  if (Number.isFinite(minBeat)) dBeat = Math.max(dBeat, -minBeat);
  if (selNotes.length) {
    dPitch = Math.max(dPitch, low - Math.min(...selNotes.map((n) => n.pitch)));
    dPitch = Math.min(dPitch, high - Math.max(...selNotes.map((n) => n.pitch)));
  }
  const moved = track.repeats.map((r, i) => (repeats.has(i) ? { ...r, start: r.start + dBeat, end: r.end + dBeat } : r));
  if (moved.some((a, i) => moved.some((b, j) => i < j && overlaps(a, b)))) return null;
  return {
    ...track,
    notes: track.notes.map((n, i) => (notes.has(i) ? { ...n, beat: n.beat + dBeat, pitch: n.pitch + dPitch } : n)),
    // Se conserva el orden para que los índices de la selección sigan valiendo.
    repeats: moved,
  };
}

/**
 * Inverso de `unroll`: convierte un beat tocado en beat escrito. Devuelve `null` si
 * cae en una vuelta extra (una copia que no se edita directamente).
 */
export function writtenBeat(track: SongTrack, played: number): number | null {
  let shift = 0;
  for (const r of byStart(track.repeats)) {
    const len = r.end - r.start;
    const start = r.start + shift;
    if (played < start) break;
    if (played < start + len) return played - shift;
    if (played < start + r.times * len) return null;
    shift += (r.times - 1) * len;
  }
  return played - shift;
}

/** Largo de la canción en beats tocados: la pista desplegada más larga. */
export function songLengthBeats(song: Song) {
  return song.tracks.reduce((m, t) => unroll(t).reduce((mm, n) => Math.max(mm, n.beat + n.duration), m), 0);
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
 * Ubica un marcador por cada momento de la pista principal (desplegada) sobre la
 * línea central: s = inicio + velocidadDeDiseño × tiempo. Devuelve también las
 * notas que no entran en la pista.
 */
export function computeMarkers(song: Song, path: TrackPath | null): { markers: Marker[]; overflow: number } {
  const notes = unroll(mainTrack(song));
  if (!path) return { markers: [], overflow: notes.length };
  const groups = new Map<number, SongNote[]>();
  for (const n of notes) {
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
