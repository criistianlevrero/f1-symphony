import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

type Rapier = typeof RAPIER;

/** Crea colliders fijos (trimesh) a partir de la geometría de los tramos. */
export function addTrackColliders(rapier: Rapier, world: RAPIER.World, geometries: THREE.BufferGeometry[]) {
  const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    const vertices = new Float32Array(pos.array as ArrayLike<number>);
    const indices = new Uint32Array(pos.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    world.createCollider(rapier.ColliderDesc.trimesh(vertices, indices).setFriction(1), body);
  }
  return body;
}

/** Piso infinito (a efectos prácticos) a nivel 0. */
export function addGround(rapier: Rapier, world: RAPIER.World, size = 4000) {
  const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
  world.createCollider(rapier.ColliderDesc.cuboid(size / 2, 1, size / 2).setTranslation(0, -1.05, 0).setFriction(1), body);
}
