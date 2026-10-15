import * as THREE from 'three';
import type { Theme } from '../track/themes';

export interface Environment {
  sun: THREE.DirectionalLight;
  /** Saca el ambiente de la escena y libera sus recursos (para cambiar de estética). */
  dispose: () => void;
}

/** Cielo, luces y piso compartidos entre el juego y el editor, según la estética. */
export function createEnvironment(scene: THREE.Scene, theme: Theme): Environment {
  const group = new THREE.Group();
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  group.add(new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));

  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.set(...theme.sun.position);
  sun.castShadow = theme.sun.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 50;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
  group.add(sun, sun.target);

  const size = 4000;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: theme.floor, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  group.add(floor);
  scene.add(group);

  return {
    sun,
    dispose: () => {
      scene.remove(group);
      sun.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
    },
  };
}
