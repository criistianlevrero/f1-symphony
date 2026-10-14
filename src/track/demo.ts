import { appendPiece } from './build';
import type { PieceType, PlacedPiece, TrackData } from './types';

function sequence(steps: (PieceType | { gap: number; type: PieceType })[]): PlacedPiece[] {
  const pieces: PlacedPiece[] = [];
  for (const s of steps) {
    if (typeof s === 'string') appendPiece(pieces, s);
    else appendPiece(pieces, s.type, s.gap);
  }
  return pieces;
}

/** Pista de ejemplo que viene con el juego. */
export function demoTrack(): TrackData {
  return {
    version: 1,
    id: 'demo',
    name: 'Demo: primer circuito',
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
    song: { bpm: 120, beatsPerBar: 4, designSpeed: 30, startOffset: 24, notes: [] },
  };
}
