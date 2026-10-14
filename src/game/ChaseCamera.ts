import * as THREE from 'three';

/** Cámara de persecución suavizada, con FOV que aumenta con la velocidad. */
export class ChaseCamera {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private initialized = false;

  distance = 7.5;
  height = 2.6;
  lookAhead = 4;
  baseFov = 68;
  maxFovBoost = 18;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap() {
    this.initialized = false;
  }

  update(target: THREE.Vector3, rotation: THREE.Quaternion, speed: number, topSpeed: number, dt: number) {
    // Usamos solo el rumbo horizontal para que la cámara no se sacuda en saltos.
    this.fwd.set(1, 0, 0).applyQuaternion(rotation);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(1, 0, 0);
    this.fwd.normalize();

    this.desired.copy(target).addScaledVector(this.fwd, -this.distance);
    this.desired.y = target.y + this.height;
    const lookTarget = this.fwd.clone().multiplyScalar(this.lookAhead).add(target);
    lookTarget.y += 0.8;

    if (!this.initialized) {
      this.pos.copy(this.desired);
      this.look.copy(lookTarget);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-8 * dt);
      this.pos.lerp(this.desired, k);
      this.look.lerp(lookTarget, 1 - Math.exp(-14 * dt));
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const fov = this.baseFov + this.maxFovBoost * Math.min(speed / topSpeed, 1);
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
