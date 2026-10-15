import * as THREE from 'three';
import { frameQuaternion } from '../track/build';
import { pitchHue } from './theory';
import type { Marker } from './song';

const crystalGeo = new THREE.OctahedronGeometry(0.425, 0).scale(1, 1.7, 1);
const ringGeo = new THREE.RingGeometry(2.3, 2.75, 32).rotateX(-Math.PI / 2);
/** Separación lateral entre notas de un mismo acorde (m). */
export const CHORD_SPACING = 2.0;

interface Item {
  root: THREE.Group;
  crystals: THREE.Mesh[];
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  hitAt: number;
  state: 'idle' | 'hit' | 'missed';
}

/** Marcadores musicales: un cristal por nota (los acordes, uno al lado del otro). */
export class MarkerView {
  readonly group = new THREE.Group();
  private items: Item[] = [];
  private time = 0;

  constructor(markers: Marker[]) {
    for (const m of markers) {
      const root = new THREE.Group();
      root.position.copy(m.position);
      frameQuaternion(m.frame, root.quaternion);
      const crystals = m.notes.map((n, j) => {
        const color = new THREE.Color().setHSL(pitchHue(n.pitch), 0.75, 0.55);
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3, flatShading: true });
        const c = new THREE.Mesh(crystalGeo, mat);
        c.position.z = (j - (m.notes.length - 1) / 2) * CHORD_SPACING;
        c.castShadow = true;
        root.add(c);
        return c;
      });
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = -1.3;
      root.add(ring);
      this.group.add(root);
      this.items.push({ root, crystals, ring, ringMat, hitAt: 0, state: 'idle' });
    }
  }

  setHit(i: number, color: string) {
    const it = this.items[i];
    if (!it) return;
    it.state = 'hit';
    it.hitAt = this.time;
    it.ringMat.color.set(color);
    it.ringMat.opacity = 0.9;
  }

  setMissed(i: number) {
    const it = this.items[i];
    if (!it) return;
    it.state = 'missed';
    for (const c of it.crystals) {
      const mat = c.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0;
      mat.color.set(0x555a66);
    }
    it.ringMat.opacity = 0.1;
  }

  reset() {
    for (const it of this.items) {
      it.state = 'idle';
      it.root.visible = true;
      it.ringMat.color.set(0xffffff);
      it.ringMat.opacity = 0.35;
      for (const c of it.crystals) {
        c.scale.setScalar(1);
        const mat = c.material as THREE.MeshStandardMaterial;
        mat.color.copy(mat.emissive);
        mat.emissiveIntensity = 0.55;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const it of this.items) {
      if (!it.root.visible) continue;
      if (it.state === 'hit') {
        // Destello: crece y desaparece.
        const k = (this.time - it.hitAt) / 0.45;
        if (k >= 1) {
          it.root.visible = false;
          continue;
        }
        for (const c of it.crystals) {
          c.scale.setScalar(1 + k * 1.2);
          (c.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 * (1 - k);
        }
        it.ring.scale.setScalar(1 + k);
      }
      for (const c of it.crystals) c.rotation.y += dt * 1.6;
    }
  }

  dispose() {
    for (const it of this.items) {
      for (const c of it.crystals) (c.material as THREE.Material).dispose();
      it.ringMat.dispose();
    }
  }
}
