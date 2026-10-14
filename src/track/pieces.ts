import type { Heading, PieceType } from './types';

/** Distancia entre nodos de la grilla en planta (m). */
export const CELL = 16;
/** Altura de un nivel de la grilla (m). */
export const LEVEL = 4;
export const ROAD_HALF_WIDTH = 6;
export const ROAD_THICKNESS = 0.8;

export interface LocalSample {
  x: number;
  y: number;
  z: number;
  /** Peralte en radianes alrededor de la tangente (positivo inclina hacia la derecha). */
  bank: number;
}

export interface PieceDef {
  type: PieceType;
  label: string;
  /**
   * Salida relativa a la entrada, en unidades de grilla: [adelante, niveles, derecha],
   * y rumbo relativo. `null` si el tramo no continúa (rampa de salto).
   */
  exit: { offset: [number, number, number]; heading: Heading } | null;
  /** Centro de la calzada en coordenadas locales (m): entrada en el origen mirando a +X, derecha = +Z. */
  sample: (u: number) => LocalSample;
  segments: number;
}

const flat = (x: number, z: number, y = 0, bank = 0): LocalSample => ({ x, y, z, bank });
const smooth = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
const BANK = 0.42; // ~24°

function curve(radius: number, side: 1 | -1, bank = 0) {
  return (u: number): LocalSample => {
    const a = (u * Math.PI) / 2;
    return flat(radius * Math.sin(a), side * radius * (1 - Math.cos(a)), 0, side * bank * Math.sin(Math.PI * u));
  };
}

function ramp(length: number, rise: number) {
  return (u: number) => flat(u * length, 0, rise * smooth(u));
}

const straight = (u: number) => flat(u * CELL, 0);

export const PIECES: Record<PieceType, PieceDef> = {
  start: { type: 'start', label: 'Largada', exit: { offset: [1, 0, 0], heading: 0 }, sample: straight, segments: 6 },
  finish: { type: 'finish', label: 'Llegada', exit: { offset: [1, 0, 0], heading: 0 }, sample: straight, segments: 6 },
  straight: { type: 'straight', label: 'Recta', exit: { offset: [1, 0, 0], heading: 0 }, sample: straight, segments: 6 },
  curveR: { type: 'curveR', label: 'Curva derecha', exit: { offset: [1, 0, 1], heading: 1 }, sample: curve(CELL, 1), segments: 16 },
  curveL: { type: 'curveL', label: 'Curva izquierda', exit: { offset: [1, 0, -1], heading: 3 }, sample: curve(CELL, -1), segments: 16 },
  curveR2: { type: 'curveR2', label: 'Curva abierta der.', exit: { offset: [2, 0, 2], heading: 1 }, sample: curve(2 * CELL, 1), segments: 28 },
  curveL2: { type: 'curveL2', label: 'Curva abierta izq.', exit: { offset: [2, 0, -2], heading: 3 }, sample: curve(2 * CELL, -1), segments: 28 },
  bankR2: { type: 'bankR2', label: 'Peralte derecha', exit: { offset: [2, 0, 2], heading: 1 }, sample: curve(2 * CELL, 1, BANK), segments: 28 },
  bankL2: { type: 'bankL2', label: 'Peralte izquierda', exit: { offset: [2, 0, -2], heading: 3 }, sample: curve(2 * CELL, -1, BANK), segments: 28 },
  rampUp: { type: 'rampUp', label: 'Subida', exit: { offset: [2, 1, 0], heading: 0 }, sample: ramp(2 * CELL, LEVEL), segments: 16 },
  rampDown: { type: 'rampDown', label: 'Bajada', exit: { offset: [2, -1, 0], heading: 0 }, sample: ramp(2 * CELL, -LEVEL), segments: 16 },
  rampUp2: { type: 'rampUp2', label: 'Subida fuerte', exit: { offset: [2, 2, 0], heading: 0 }, sample: ramp(2 * CELL, 2 * LEVEL), segments: 16 },
  rampDown2: { type: 'rampDown2', label: 'Bajada fuerte', exit: { offset: [2, -2, 0], heading: 0 }, sample: ramp(2 * CELL, -2 * LEVEL), segments: 16 },
  kicker: {
    type: 'kicker',
    label: 'Rampa de salto',
    exit: null,
    sample: (u) => flat(u * CELL, 0, 2.2 * u * u),
    segments: 10,
  },
};

export const PIECE_ORDER: PieceType[] = [
  'start',
  'finish',
  'straight',
  'curveR',
  'curveL',
  'curveR2',
  'curveL2',
  'bankR2',
  'bankL2',
  'rampUp',
  'rampDown',
  'rampUp2',
  'rampDown2',
  'kicker',
];
