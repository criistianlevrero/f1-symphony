import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FRONT_WHEELS, type Car, type CarLayout } from './Car';

// Nombres de las ruedas en el .glb, en el orden de FRONT_WHEELS / REAR_WHEELS.
const WHEEL_NAMES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];

/** Modelo listo para usar: mallas en coordenadas del chasis y medidas para la física. */
export interface CarModel {
  body: THREE.Object3D[];
  /** Ruedas con la geometría centrada en su eje (que queda sobre Z). */
  wheels: THREE.Object3D[];
  layout: CarLayout;
}

/**
 * Carga el .glb del auto (ver docs/CAR_MODEL.md). El modelo viene con la trompa
 * hacia +Z; lo giramos para que mire a +X como el chasis físico, y horneamos las
 * transformaciones en la geometría para trabajar todo en el espacio del chasis.
 */
export async function loadCarModel(url: string): Promise<CarModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  scene.rotation.y = Math.PI / 2; // +Z del modelo → +X del chasis
  scene.updateMatrixWorld(true);

  // Cada nodo puede traer varias mallas (una por material): se agrupan por nodo.
  const byWheel = new Map<string, THREE.Mesh[]>();
  const body: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    let node: THREE.Object3D | null = o;
    while (node && !WHEEL_NAMES.includes(node.name)) node = node.parent;
    if (node) byWheel.set(node.name, [...(byWheel.get(node.name) ?? []), o as THREE.Mesh]);
    else body.push(o as THREE.Mesh);
  });
  for (const mesh of [...body, ...[...byWheel.values()].flat()]) {
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
    mesh.castShadow = true;
  }

  const wheels: THREE.Object3D[] = [];
  const wheelLayout: CarLayout['wheels'] = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const allBox = new THREE.Box3();
  for (const name of WHEEL_NAMES) {
    const parts = byWheel.get(name);
    if (!parts) throw new Error(`El modelo del auto no tiene la rueda "${name}"`);
    box.makeEmpty();
    for (const p of parts) box.expandByObject(p);
    allBox.union(box);
    box.getCenter(center);
    box.getSize(size);
    const wheel = new THREE.Group();
    for (const p of parts) {
      p.geometry.translate(-center.x, -center.y, -center.z);
      wheel.add(p);
    }
    wheels.push(wheel);
    wheelLayout.push({ center: { x: center.x, y: center.y, z: center.z }, radius: Math.max(size.x, size.y) / 2 });
  }
  if (body.length === 0) throw new Error('El modelo del auto no tiene carrocería');

  // Collider: caja que cubre carrocería y ruedas en planta; en altura va desde el
  // eje de las ruedas hasta el techo, para no rozar el piso al comprimir la suspensión.
  // Por delante termina en el borde de las ruedas delanteras: el voladizo de la trompa
  // (alerón) queda fuera para que no pegue contra el piso al entrar en pendientes fuertes.
  const bodyBox = new THREE.Box3();
  for (const b of body) bodyBox.expandByObject(b);
  allBox.union(bodyBox);
  const axleY = wheelLayout.reduce((sum, w) => sum + w.center.y, 0) / wheelLayout.length;
  const min = new THREE.Vector3(allBox.min.x, axleY, allBox.min.z);
  const frontX = Math.max(...FRONT_WHEELS.map((i) => wheelLayout[i].center.x + wheelLayout[i].radius));
  const max = new THREE.Vector3(frontX, bodyBox.max.y, allBox.max.z);

  return {
    body,
    wheels,
    layout: {
      wheels: wheelLayout,
      chassisCenter: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
      chassisHalfExtents: { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 },
    },
  };
}

/** Representación visual del auto: el modelo cargado, con las ruedas siguiendo la física. */
export class CarView {
  readonly root = new THREE.Group();
  private wheels: THREE.Object3D[] = [];

  constructor(
    private car: Car,
    model: CarModel,
  ) {
    for (const b of model.body) this.root.add(b);
    for (const wheel of model.wheels) {
      const steerPivot = new THREE.Group();
      steerPivot.add(wheel);
      this.root.add(steerPivot);
      this.wheels.push(steerPivot);
    }
  }

  /** Copia la pose interpolada del chasis y actualiza ruedas. */
  sync(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);

    const v = this.car.vehicle;
    for (let i = 0; i < this.wheels.length; i++) {
      const pivot = this.wheels[i];
      const conn = v.wheelChassisConnectionPointCs(i);
      const susp = v.wheelSuspensionLength(i) ?? 0;
      if (conn) pivot.position.set(conn.x, conn.y - susp, conn.z);
      pivot.rotation.set(0, v.wheelSteering(i) ?? 0, 0);
      // Rapier acumula la rotación de la rueda alrededor del eje (+Z).
      pivot.children[0].rotation.z = -(v.wheelRotation(i) ?? 0);
    }
  }
}
