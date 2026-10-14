import * as THREE from 'three';
import { CELL, LEVEL, PIECES } from './pieces';
import type { Heading, PlacedPiece } from './types';

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export const headingDir = (h: number) => DIRS[((h % 4) + 4) % 4];

/** Rotación (alrededor de Y) que lleva +X al rumbo dado. */
export function headingQuaternion(h: Heading, target = new THREE.Quaternion()) {
  return target.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-h * Math.PI) / 2);
}

/** Pasa un punto local del tramo (m) a coordenadas de mundo. */
export function localToWorld(piece: PlacedPiece, x: number, y: number, z: number, target = new THREE.Vector3()) {
  const [dx, dz] = headingDir(piece.rot);
  const [rx, rz] = headingDir(piece.rot + 1);
  return target.set(
    piece.cell[0] * CELL + x * dx + z * rx,
    piece.cell[1] * LEVEL + y,
    piece.cell[2] * CELL + x * dz + z * rz,
  );
}

export interface Connector {
  cell: [number, number, number];
  heading: Heading;
}

export function exitConnector(piece: PlacedPiece): Connector | null {
  const exit = PIECES[piece.type].exit;
  if (!exit) return null;
  const [f, l, r] = exit.offset;
  const [dx, dz] = headingDir(piece.rot);
  const [rx, rz] = headingDir(piece.rot + 1);
  return {
    cell: [piece.cell[0] + f * dx + r * rx, piece.cell[1] + l, piece.cell[2] + f * dz + r * rz],
    heading: ((piece.rot + exit.heading) % 4) as Heading,
  };
}

export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3; // tangente (adelante)
  up: THREE.Vector3;
  right: THREE.Vector3;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Marcos de la línea central del tramo, en coordenadas de mundo. */
export function pieceFrames(piece: PlacedPiece): Frame[] {
  const def = PIECES[piece.type];
  const n = def.segments;
  const frames: Frame[] = [];
  const eps = 1e-3;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const s = def.sample(u);
    const a = def.sample(Math.max(0, u - eps));
    const b = def.sample(Math.min(1, u + eps));
    const p = localToWorld(piece, s.x, s.y, s.z);
    const pa = localToWorld(piece, a.x, a.y, a.z);
    const pb = localToWorld(piece, b.x, b.y, b.z);
    const t = pb.sub(pa).normalize();
    // "Arriba" perpendicular a la tangente, luego rotado por el peralte.
    const right = new THREE.Vector3().crossVectors(t, WORLD_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, t).normalize();
    if (s.bank !== 0) {
      up.applyAxisAngle(t, s.bank);
      right.crossVectors(t, up).normalize();
    }
    frames.push({ p, t, up, right });
  }
  return frames;
}

const key = (c: [number, number, number], h: number) => `${c[0]},${c[1]},${c[2]}:${h}`;

/**
 * Ordena los tramos siguiendo el recorrido desde la largada: conecta salida con
 * entrada, y si un tramo no tiene salida (o no hay nada pegado) busca adelante el
 * próximo tramo alineado, para permitir saltos.
 */
export function chainPieces(pieces: PlacedPiece[]): { order: number[]; gaps: boolean[] } {
  const byEntry = new Map<string, number>();
  pieces.forEach((p, i) => byEntry.set(key(p.cell, p.rot), i));

  let current = pieces.findIndex((p) => p.type === 'start');
  if (current < 0) current = pieces.length ? 0 : -1;
  const order: number[] = [];
  const gaps: boolean[] = [];
  const visited = new Set<number>();
  let gap = false;

  while (current >= 0 && !visited.has(current)) {
    visited.add(current);
    order.push(current);
    gaps.push(gap);
    const piece = pieces[current];
    if (piece.type === 'finish') break;

    const exit = exitConnector(piece);
    let next = exit ? byEntry.get(key(exit.cell, exit.heading)) : undefined;
    gap = false;
    if (next === undefined) {
      // Salto: buscar adelante, hasta 8 nodos, a la misma altura o más abajo.
      const h = exit?.heading ?? piece.rot;
      const from = exit?.cell ?? [piece.cell[0] + headingDir(h)[0], piece.cell[1], piece.cell[2] + headingDir(h)[1]];
      const [dx, dz] = headingDir(h);
      search: for (let k = exit ? 1 : 0; k <= 8; k++) {
        for (let dy = 1; dy >= -6; dy--) {
          const c: [number, number, number] = [from[0] + dx * k, from[1] + dy, from[2] + dz * k];
          const found = byEntry.get(key(c, h));
          if (found !== undefined && !visited.has(found)) {
            next = found;
            break search;
          }
        }
      }
      gap = next !== undefined;
    }
    current = next ?? -1;
  }
  return { order, gaps };
}
