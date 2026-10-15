import * as THREE from 'three';
import { pieceFrames, type Frame } from './layout';
import { ROAD_HALF_WIDTH, ROAD_THICKNESS } from './pieces';
import type { RoadPalette, Theme } from './themes';
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

type StripColors = Record<Exclude<keyof RoadPalette, 'pillar'>, THREE.Color>;

const stripColors = (p: RoadPalette): StripColors => ({
  road: new THREE.Color(p.road),
  curbA: new THREE.Color(p.curbA),
  curbB: new THREE.Color(p.curbB),
  side: new THREE.Color(p.side),
  bottom: new THREE.Color(p.bottom),
});

const isCurb = (strip: number) => strip === 1 || strip === 3;

// Color de cada franja del perfil (franja i va de PROFILE[i] a PROFILE[i+1]; la última cierra).
function stripColor(colors: StripColors, strip: number, s: number) {
  if (isCurb(strip)) return Math.floor(s / CURB_PERIOD) % 2 ? colors.curbA : colors.curbB;
  if (strip === 2) return colors.road;
  if (strip === 5) return colors.bottom;
  return colors.side;
}

const point = (f: Frame, [lat, vert]: [number, number], target: THREE.Vector3) =>
  target.copy(f.p).addScaledVector(f.right, lat).addScaledVector(f.up, vert);

/**
 * Malla de la calzada de un tramo (no indexada, con colores por vértice y un atributo
 * `glow` que marca los cordones). La paleta solo cambia colores: las posiciones, que
 * también usa la física, no dependen de la estética.
 */
export function buildPieceGeometry(piece: PlacedPiece, palette: RoadPalette): THREE.BufferGeometry {
  const tint = stripColors(palette);
  const frames = pieceFrames(piece);
  const positions: number[] = [];
  const colors: number[] = [];
  const glow: number[] = [];
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
      const col = stripColor(tint, k, s + segLen / 2);
      for (let v = 0; v < 6; v++) {
        colors.push(col.r, col.g, col.b);
        glow.push(isCurb(k) ? 1 : 0);
      }
    }
    s += segLen;
  }
  // Tapas en los extremos para que el bloque se vea cerrado. El perfil no es convexo
  // (los cordones suben sobre la calzada), así que se triangula en vez de usar un abanico.
  const capTris = THREE.ShapeUtils.triangulateShape(
    PROFILE.map(([lat, vert]) => new THREE.Vector2(lat, vert)),
    [],
  );
  const n = new THREE.Vector3();
  for (const [f, outward] of [
    [frames[0], -1],
    [frames[frames.length - 1], 1],
  ] as const) {
    const pts = PROFILE.map((p) => point(f, p, new THREE.Vector3()));
    for (const [i, j, k] of capTris) {
      n.subVectors(pts[j], pts[i]).cross(c.subVectors(pts[k], pts[i]));
      const tri = n.dot(f.t) * outward >= 0 ? [pts[i], pts[j], pts[k]] : [pts[i], pts[k], pts[j]];
      for (const v of tri) positions.push(v.x, v.y, v.z);
      for (let v = 0; v < 3; v++) {
        colors.push(tint.side.r, tint.side.g, tint.side.b);
        glow.push(0);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Material de la calzada. Si la estética tiene brillo de cordones, se parchea el shader
 * estándar para sumar `color × glow × curbGlow` a la emisión, así brillan solo los
 * cordones sin separar la malla en dos materiales.
 */
export function makeRoadMaterial(theme: Theme, params: THREE.MeshStandardMaterialParameters = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, ...params });
  if (theme.curbGlow > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.curbGlow = { value: theme.curbGlow };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float curbGlow;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * curbGlow;');
    };
    mat.customProgramCacheKey = () => 'road-glow';
  }
  return mat;
}

/** Arco de largada o llegada sobre la entrada del tramo. */
export function buildGate(frame: Frame, kind: 'start' | 'finish', palette: RoadPalette): THREE.Group {
  const g = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: palette.pillar, flatShading: true });
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
