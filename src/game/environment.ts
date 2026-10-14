import * as THREE from 'three';

/** Cielo, luces y piso compartidos entre el juego y el editor. */
export function createEnvironment(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x9cc7e8);
  scene.fog = new THREE.Fog(0x9cc7e8, 300, 1100);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x404858, 1.1));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 50;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
  scene.add(sun, sun.target);

  const size = 4000;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x55705a, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  scene.add(floor);

  return { sun };
}
