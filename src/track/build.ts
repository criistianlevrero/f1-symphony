import * as THREE from 'three';
import { buildGate, buildPieceGeometry, makeRoadMaterial } from './geometry';
import { chainPieces, exitConnector, headingDir, pieceFrames, type Frame } from './layout';
import { getTheme } from './themes';
import { TrackPath } from './TrackPath';
import type { Heading, PieceType, PlacedPiece, TrackData } from './types';

export interface BuiltTrack {
  group: THREE.Group;
  /** Geometría por tramo, en coordenadas de mundo (para colisiones). */
  geometries: THREE.BufferGeometry[];
  /** Recorrido desde la largada; null si la pista está vacía. */
  path: TrackPath | null;
  /** Índices de tramos en orden de recorrido. */
  order: number[];
  spawn: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  /** Línea de llegada (entrada del tramo de llegada), si el recorrido la alcanza. */
  finish: Frame | null;
  minY: number;
}

export function frameQuaternion(f: Frame, target = new THREE.Quaternion()) {
  return target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.t, f.up, f.right));
}

/** Arma la parte visual y los datos de recorrido de una pista. */
export function buildTrack(track: TrackData): BuiltTrack {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  let minY = 0;
  const theme = getTheme(track.theme);
  const roadMaterial = makeRoadMaterial(theme);

  for (const piece of track.pieces) {
    const geo = buildPieceGeometry(piece, theme.road);
    geometries.push(geo);
    geo.computeBoundingBox();
    minY = Math.min(minY, geo.boundingBox!.min.y);
    const mesh = new THREE.Mesh(geo, roadMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (piece.type === 'start' || piece.type === 'finish') group.add(buildGate(pieceFrames(piece)[0], piece.type, theme.road));
  }

  const { order } = chainPieces(track.pieces);
  const frames: Frame[] = [];
  for (const i of order) frames.push(...pieceFrames(track.pieces[i]));
  const path = frames.length > 1 ? new TrackPath(frames) : null;

  const last = order.length ? track.pieces[order[order.length - 1]] : null;
  const finish = last?.type === 'finish' ? pieceFrames(last)[0] : null;

  let spawn = { position: new THREE.Vector3(0, 1.5, 0), quaternion: new THREE.Quaternion() };
  if (path) {
    const f = path.frameAt(Math.min(4, path.length));
    spawn = { position: f.p.clone().addScaledVector(f.up, 1.2), quaternion: frameQuaternion(f) };
  }

  return { group, geometries, path, order, spawn, finish, minY };
}

/** Agrega un tramo pegado a la salida del último tramo de la lista. */
export function appendPiece(pieces: PlacedPiece[], type: PieceType, gap = 0): PlacedPiece {
  const prev = pieces[pieces.length - 1];
  let cell: [number, number, number] = [0, 0, 0];
  let rot: Heading = 0;
  if (prev) {
    // Tramo sin salida (salto): continuar en línea recta desde su final.
    const exit = exitConnector(prev);
    rot = exit?.heading ?? prev.rot;
    const [dx, dz] = headingDir(rot);
    const from = exit?.cell ?? [prev.cell[0] + dx, prev.cell[1], prev.cell[2] + dz];
    cell = [from[0] + dx * gap, from[1], from[2] + dz * gap];
  }
  const piece: PlacedPiece = { type, cell, rot };
  pieces.push(piece);
  return piece;
}
