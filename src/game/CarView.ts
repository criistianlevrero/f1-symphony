import * as THREE from 'three';
import type { Car } from './Car';

/**
 * Representación visual del auto. Por ahora es un modelo de cajas; la idea es
 * reemplazarlo por el .glb low poly (ver docs/CAR_MODEL.md).
 */
export class CarView {
  readonly root = new THREE.Group();
  private chassis = new THREE.Group();
  private wheels: THREE.Object3D[] = [];

  constructor(private car: Car) {
    const t = car.tuning;
    const h = t.chassisHalfExtents;
    const body = new THREE.MeshStandardMaterial({ color: 0xd7263d, roughness: 0.4, metalness: 0.2, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.8, flatShading: true });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 1.2), body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, h.y * 1.2, h.z * 0.6), body);
    nose.position.set(h.x + 0.4, -0.05, 0);
    const frontWing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, h.z * 2.3), dark);
    frontWing.position.set(h.x + 0.7, -0.15, 0);
    const rearWing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, h.z * 1.8), dark);
    rearWing.position.set(-h.x + 0.1, 0.65, 0);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.45, 0.1), dark);
    pylon.position.set(-h.x + 0.1, 0.4, 0);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.6), dark);
    cockpit.position.set(0.2, h.y + 0.1, 0);
    for (const m of [hull, nose, frontWing, rearWing, pylon, cockpit]) {
      m.castShadow = true;
      this.chassis.add(m);
    }
    this.root.add(this.chassis);

    const wheelGeo = new THREE.CylinderGeometry(t.wheelRadius, t.wheelRadius, 0.4, 14);
    wheelGeo.rotateX(Math.PI / 2); // eje del cilindro sobre Z
    for (let i = 0; i < 4; i++) {
      const steerPivot = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeo, dark);
      wheel.castShadow = true;
      steerPivot.add(wheel);
      this.chassis.add(steerPivot);
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
