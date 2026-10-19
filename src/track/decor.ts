import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, LEVEL } from './pieces';
import type { DecorAsset, Theme } from './themes';
import type { PlacedDecoration } from './types';

/** Modelos ya cargados, por id de asset. Comparten geometría y materiales entre instancias. */
export type DecorModels = Map<string, THREE.Object3D>;

const cache = new Map<string, Promise<THREE.Object3D>>();

function loadAsset(asset: DecorAsset): Promise<THREE.Object3D> {
  let model = cache.get(asset.url);
  if (!model) {
    model = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${asset.url}`).then((gltf) => {
      gltf.scene.traverse((o) => (o.castShadow = true));
      return gltf.scene;
    });
    cache.set(asset.url, model);
  }
  return model;
}

/** Carga los modelos de decoración de la estética. Un asset que no carga se omite (con aviso). */
export async function loadDecorModels(theme: Theme): Promise<DecorModels> {
  const models: DecorModels = new Map();
  await Promise.all(
    theme.decor.map(async (asset) => {
      try {
        models.set(asset.id, await loadAsset(asset));
      } catch (err) {
        console.warn(`No se pudo cargar la decoración "${asset.id}" (${asset.url})`, err);
      }
    }),
  );
  return models;
}

/** Instancia de un modelo ubicada en una celda, con el mismo giro que el cursor del editor. */
export function placeDecor(model: THREE.Object3D, d: Pick<PlacedDecoration, 'cell' | 'rot'>): THREE.Object3D {
  const obj = model.clone();
  obj.position.set(d.cell[0] * CELL, d.cell[1] * LEVEL, d.cell[2] * CELL);
  obj.rotation.y = (-d.rot * Math.PI) / 2;
  return obj;
}

/**
 * Arma la decoración visible. Solo visual: no genera colliders ni toca los tramos.
 * Los assets que esta versión no conoce se omiten.
 */
export function buildDecorations(list: PlacedDecoration[], models: DecorModels): THREE.Group {
  const group = new THREE.Group();
  for (const d of list) {
    const model = models.get(d.asset);
    if (model) group.add(placeDecor(model, d));
  }
  return group;
}
