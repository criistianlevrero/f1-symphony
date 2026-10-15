/** Rumbo en la grilla: 0 = +X, 1 = +Z, 2 = -X, 3 = -Z (sumar 1 es girar a la derecha). */
export type Heading = 0 | 1 | 2 | 3;

export type PieceType =
  | 'start'
  | 'finish'
  | 'straight'
  | 'curveR'
  | 'curveL'
  | 'curveR2'
  | 'curveL2'
  | 'bankR2'
  | 'bankL2'
  | 'rampUp'
  | 'rampDown'
  | 'rampUp2'
  | 'rampDown2'
  | 'kicker';

/** Tramo colocado. `cell` es el nodo de la grilla donde está su entrada: [x, nivel, z]. */
export interface PlacedPiece {
  type: PieceType;
  cell: [number, number, number];
  rot: Heading;
}

export interface SongNote {
  pitch: number; // MIDI (60 = C4)
  beat: number; // inicio en beats desde el comienzo
  duration: number; // en beats
}

export interface Song {
  bpm: number;
  beatsPerBar: number;
  designSpeed: number; // m/s
  startOffset: number; // metros desde la largada hasta el beat 0
  notes: SongNote[];
}

/** Elemento decorativo en la grilla. Solo visual: nunca tiene física. */
export interface PlacedDecoration {
  asset: string;
  cell: [number, number, number];
  rot: Heading;
}

export interface TrackData {
  version: 1;
  id: string;
  name: string;
  updatedAt: number;
  pieces: PlacedPiece[];
  song: Song;
  /** Estética elegida. Se guarda tal cual aunque esta versión no la conozca. */
  theme: string;
  /**
   * Decoración por estética. Solo se dibuja la de `theme`; las demás se conservan
   * para que cambiar de estética no borre lo ubicado.
   */
  decorations: Record<string, PlacedDecoration[]>;
}
