import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

type Rapier = typeof RAPIER;

/**
 * Escenario de prueba de la fase 1: un piso grande con rampas y peraltes para
 * ajustar el manejo. Se reemplaza por pistas armadas con tramos en la fase 2.
 */
export function buildSandbox(rapier: Rapier, world: RAPIER.World, scene: THREE.Scene) {
  const ground = world.createRigidBody(rapier.RigidBodyDesc.fixed());

  const addBox = (
    size: [number, number, number],
    pos: [number, number, number],
    euler: [number, number, number],
    color: number,
  ) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler, 'YXZ'));
    world.createCollider(
      rapier.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setTranslation(...pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(1),
      ground,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }),
    );
    mesh.position.set(...pos);
    mesh.quaternion.copy(q);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  // Piso
  const size = 1200;
  world.createCollider(rapier.ColliderDesc.cuboid(size / 2, 1, size / 2).setTranslation(0, -1, 0).setFriction(1), ground);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(size, size / 8, 0x56607a, 0x485062);
  grid.position.y = 0.01;
  scene.add(grid);

  // Rampas de salto
  addBox([20, 1, 12], [80, 1.6, 0], [0, 0, 0.18], 0xf2a541);
  addBox([20, 1, 12], [160, 2.8, 0], [0, 0, 0.3], 0xf2a541);
  // Rampa de subida a una meseta
  addBox([30, 1, 14], [0, 3.5, 90], [0, 0, 0.25], 0x4ea5d9);
  addBox([60, 1, 14], [44.5, 7.3, 90], [0, 0, 0], 0x4ea5d9);
  // Peralte (banked) en arco
  const arcR = 70;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    const x = -120 + Math.cos(a) * arcR;
    const z = -40 - Math.sin(a) * arcR;
    addBox([16, 1, 14], [x, 1.95, z], [-0.35, a + Math.PI / 2, 0], 0x44cf6c);
  }
  // Algunos conos/obstáculos
  for (let i = 0; i < 10; i++) addBox([1, 1.5, 1], [30 + i * 12, 0.75, -25], [0, 0, 0], 0xffffff);
}
