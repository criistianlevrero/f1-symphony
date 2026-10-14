import { appendPiece } from './build';
import type { PieceType, PlacedPiece, SongNote, TrackData } from './types';

function sequence(steps: (PieceType | { gap: number; type: PieceType })[]): PlacedPiece[] {
  const pieces: PlacedPiece[] = [];
  for (const s of steps) {
    if (typeof s === 'string') appendPiece(pieces, s);
    else appendPiece(pieces, s.type, s.gap);
  }
  return pieces;
}

const C = 72;
const D = 74;
const E = 76;
const F = 77;
const G = 79;

/** «Oda a la alegría» (Beethoven), dos frases. [nota, beat, duración] */
function odeToJoy(): SongNote[] {
  const phrase = (start: number, ending: [number, number]): [number, number, number][] => [
    [E, 0, 1], [E, 1, 1], [F, 2, 1], [G, 3, 1],
    [G, 4, 1], [F, 5, 1], [E, 6, 1], [D, 7, 1],
    [C, 8, 1], [C, 9, 1], [D, 10, 1], [E, 11, 1],
    [ending[0], 12, 1.5], [ending[1], 13.5, 0.5], [ending[1], 14, 2],
  ].map(([p, b, d]) => [p, b + start, d] as [number, number, number]);
  return [...phrase(0, [E, D]), ...phrase(16, [D, C])].map(([pitch, beat, duration]) => ({ pitch, beat, duration }));
}

/** Pista de ejemplo que viene con el juego. */
export function demoTrack(): TrackData {
  return {
    version: 1,
    id: 'demo',
    name: 'Demo: Oda a la alegría',
    updatedAt: 0,
    pieces: sequence([
      'start',
      'straight',
      'straight',
      'straight',
      'curveR2',
      'straight',
      'rampUp',
      'straight',
      'bankR2',
      'straight',
      'straight',
      'rampDown',
      'straight',
      'kicker',
      { gap: 3, type: 'straight' },
      'straight',
      'curveR',
      'straight',
      'curveL',
      'straight',
      'curveR2',
      'straight',
      'finish',
    ]),
    song: { bpm: 120, beatsPerBar: 4, designSpeed: 30, startOffset: 60, notes: odeToJoy() },
  };
}
