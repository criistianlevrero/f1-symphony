import * as THREE from 'three';
import { pieceFrames, type Frame } from './layout';
import { ROAD_HALF_WIDTH, ROAD_THICKNESS } from './pieces';
import type { PlacedPiece } from './types';

const W = ROAD_HALF_WIDTH;
const T = ROAD_THICKNESS;
const CURB_W = 0.8;
const LIP = 0.22;
const CURB_PERIOD = 8 / 3; // largo de cada franja roja/blanca (m)

// Perfil transversal (lateral, vertical) recorrido de izquierda a derecha por arriba.
const PROFILE: [number, number][] = [
  [-W, -T],
  [-W, LIP],
  [-W + CURB_W, 0],
  [W - CURB_W, 0],
  [W, LIP],
  [W, -T],
];

const COLORS = {
  road: new THREE.Color(0x2c3038),
  curbA: new THREE.Color(0xe03a3a),
  curbB: new THREE.Color(0xf2f2f2),
  side: new THREE.Color(0x6c7689),
  bottom: new THREE.Color(0x4a5163),
};

// Color de cada franja del perfil (franja i va de PROFILE[i] a PROFILE[i+1]; la última cierra).
function stripColor(strip: number, s: number) {
  if (strip === 1 || strip === 3) return Math.floor(s / CURB_PERIOD) % 2 ? COLORS.curbA : COLORS.curbB;
  if (strip === 2) return COLORS.road;
  if (strip === 5) return COLORS.bottom;
  return COLORS.side;
}

const point = (f: Frame, [lat, vert]: [number, number], target: THREE.Vector3) =>
  target.copy(f.p).addScaledVector(f.right, lat).addScaledVector(f.up, vert);

/** Malla de la calzada de un tramo (no indexada, con colores por vértice). */
export function buildPieceGeometry(piece: PlacedPiece): THREE.BufferGeometry {
  const frames = pieceFrames(piece);
  const positions: number[] = [];
  const colors: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  let s = 0;

  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const segLen = f0.p.distanceTo(f1.p);
    for (let k = 0; k < PROFILE.length; k++) {
      const p0 = PROFILE[k];
      const p1 = PROFILE[(k + 1) % PROFILE.length];
      point(f0, p0, a);
      point(f0, p1, b);
      point(f1, p1, c);
      point(f1, p0, d);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      const col = stripColor(k, s + segLen / 2);
      for (let v = 0; v < 6; v++) colors.push(col.r, col.g, col.b);
    }
    s += segLen;
  }
  // Tapas en los extremos para que el bloque se vea cerrado.
  for (const [f, flip] of [
    [frames[0], true],
    [frames[frames.length - 1], false],
  ] as const) {
    const center = new THREE.Vector3();
    const pts = PROFILE.map((p) => point(f, p, new THREE.Vector3()));
    pts.forEach((p) => center.add(p));
    center.divideScalar(pts.length);
    for (let k = 0; k < pts.length; k++) {
      const p0 = pts[k];
      const p1 = pts[(k + 1) % pts.length];
      const tri = flip ? [center, p1, p0] : [center, p0, p1];
      for (const v of tri) positions.push(v.x, v.y, v.z);
      for (let v = 0; v < 3; v++) colors.push(COLORS.side.r, COLORS.side.g, COLORS.side.b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Arco de largada o llegada sobre la entrada del tramo. */
export function buildGate(frame: Frame, kind: 'start' | 'finish'): THREE.Group {
  const g = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x20242c, flatShading: true });
  const bannerMat =
    kind === 'start'
      ? new THREE.MeshStandardMaterial({ color: 0x2bb673, emissive: 0x0d4a2a, flatShading: true })
      : new THREE.MeshStandardMaterial({ map: checkerTexture(), flatShading: true });
  const h = 6;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), pillarMat);
    pillar.position.set(0, h / 2, side * (W + 0.6));
    g.add(pillar);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 2 * W + 2), bannerMat);
  banner.position.set(0, h, 0);
  g.add(banner);
  g.traverse((o) => (o.castShadow = true));

  const m = new THREE.Matrix4().makeBasis(frame.t, frame.up, frame.right);
  g.quaternion.setFromRotationMatrix(m);
  g.position.copy(frame.p);
  return g;
}

let checker: THREE.Texture | null = null;
function checkerTexture() {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  checker = new THREE.CanvasTexture(c);
  checker.magFilter = THREE.NearestFilter;
  checker.colorSpace = THREE.SRGBColorSpace;
  return checker;
}
