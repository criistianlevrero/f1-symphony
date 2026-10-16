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

/** Tramo de una pista que suena `times` veces en total (como un signo de repetición). */
export interface Repeat {
  start: number; // beat escrito
  end: number; // beat escrito, exclusivo
  times: number; // vueltas totales (2 = suena dos veces)
}

export interface SongTrack {
  id: string;
  name: string;
  /** Id del catálogo de instrumentos. Se guarda tal cual aunque esta versión no lo conozca. */
  instrument: string;
  /** En beats escritos: sin desplegar las repeticiones. */
  notes: SongNote[];
  repeats: Repeat[];
  /** La pista del auto: la única que genera marcadores. Hay exactamente una. */
  main?: boolean;
  volume?: number;
  /**
   * Parámetros del instrumento cambiados respecto del preset (id del parámetro →
   * valor). Se guardan tal cual aunque esta versión no los conozca.
   */
  params?: Record<string, number | string>;
  /** Cuánto manda la pista a los buses de efectos A (reverb) y B (delay), de 0 a 1. */
  sends?: [number, number];
}

/** Ajustes de los buses de efectos de la canción: solo lo que difiere del preset. */
export interface SongEffects {
  a?: Record<string, number | string>;
  b?: Record<string, number | string>;
}

export interface Song {
  bpm: number;
  beatsPerBar: number;
  designSpeed: number; // m/s
  startOffset: number; // metros desde la largada hasta el beat 0
  tracks: SongTrack[];
  effects?: SongEffects;
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
