import type RAPIER from '@dimforge/rapier3d-compat';
import { carTuning, type CarTuning } from './tuning';
import type { DriveInput } from './input';

type Rapier = typeof RAPIER;
type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

export interface Spawn {
  position: Vec3;
  rotation: Quat;
}

/** Geometría del auto en el espacio del chasis, sacada del modelo 3D. */
export interface CarLayout {
  /** Centro y radio de cada rueda, en el orden de FRONT_WHEELS / REAR_WHEELS. */
  wheels: { center: Vec3; radius: number }[];
  chassisCenter: Vec3;
  chassisHalfExtents: Vec3;
}

// Orden de ruedas: 0 delantera izq, 1 delantera der, 2 trasera izq, 3 trasera der.
export const FRONT_WHEELS = [0, 1];
export const REAR_WHEELS = [2, 3];

// En Rapier un ángulo de dirección positivo gira hacia -Z (izquierda en nuestra
// convención), así que lo invertimos para que steer > 0 sea derecha.
const STEER_SIGN = -1;

function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = q * v * q^-1
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Física del auto: chasis + controlador de vehículo por raycast de Rapier. */
export class Car {
  readonly body: RAPIER.RigidBody;
  readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  private steerAngle = 0;
  private spawn: Spawn;

  constructor(
    rapier: Rapier,
    private world: RAPIER.World,
    spawn: Spawn,
    readonly layout: CarLayout,
    readonly tuning: CarTuning = carTuning,
  ) {
    this.spawn = spawn;
    const t = tuning;
    const h = layout.chassisHalfExtents;
    const c = layout.chassisCenter;

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
        .setRotation(spawn.rotation)
        .setAngularDamping(t.angularDamping)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    // Masa explícita con centro de masa bajo (cerca de los ejes) para que no
    // vuelque fácil. El centro de masa queda entre los ejes, en coordenadas del
    // collider.
    const ws = layout.wheels;
    const axleY = ws.reduce((sum, w) => sum + w.center.y, 0) / ws.length;
    const comX = (ws[FRONT_WHEELS[0]].center.x + ws[REAR_WHEELS[0]].center.x) / 2;
    const m = t.mass;
    const [a, b, d] = [2 * h.x, 2 * h.y, 2 * h.z];
    world.createCollider(
      rapier.ColliderDesc.cuboid(h.x, h.y, h.z)
        .setTranslation(c.x, c.y, c.z)
        .setFriction(0.3)
        .setMassProperties(
          m,
          { x: comX - c.x, y: axleY + t.centerOfMassY - c.y, z: 0 },
          { x: (m * (b * b + d * d)) / 12, y: (m * (a * a + d * d)) / 12, z: (m * (a * a + b * b)) / 12 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 0;

    for (const w of layout.wheels) {
      this.vehicle.addWheel(this.wheelMount(w.center), { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, t.suspensionRestLength, w.radius);
    }
    this.applyWheelTuning();
  }

  /**
   * Punto de anclaje de la suspensión: arriba del centro de la rueda del modelo,
   * de modo que con la suspensión en reposo la rueda queda donde está en el modelo.
   */
  private wheelMount(center: Vec3): Vec3 {
    return { x: center.x, y: center.y + this.tuning.suspensionRestLength, z: center.z };
  }

  /** Reaplica los parámetros de rueda/suspensión (p. ej. desde el panel de ajuste). */
  applyWheelTuning() {
    const t = this.tuning;
    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      this.vehicle.setWheelChassisConnectionPointCs(i, this.wheelMount(this.layout.wheels[i].center));
      this.vehicle.setWheelSuspensionRestLength(i, t.suspensionRestLength);
      this.vehicle.setWheelSuspensionStiffness(i, t.suspensionStiffness);
      this.vehicle.setWheelSuspensionCompression(i, t.suspensionCompression);
      this.vehicle.setWheelSuspensionRelaxation(i, t.suspensionRelaxation);
      this.vehicle.setWheelMaxSuspensionTravel(i, t.maxSuspensionTravel);
      this.vehicle.setWheelMaxSuspensionForce(i, t.maxSuspensionForce);
      this.vehicle.setWheelFrictionSlip(i, t.frictionSlip);
      this.vehicle.setWheelSideFrictionStiffness(i, t.sideFrictionStiffness);
    }
    this.body.setAngularDamping(t.angularDamping);
  }

  get forward(): Vec3 {
    return rotate(this.body.rotation(), { x: 1, y: 0, z: 0 });
  }

  get up(): Vec3 {
    return rotate(this.body.rotation(), { x: 0, y: 1, z: 0 });
  }

  /** Velocidad con signo a lo largo del eje delantero, en m/s. */
  get forwardSpeed(): number {
    return dot(this.body.linvel(), this.forward);
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  get wheelsOnGround(): number {
    let n = 0;
    for (let i = 0; i < 4; i++) if (this.vehicle.wheelIsInContact(i)) n++;
    return n;
  }

  setSpawn(spawn: Spawn) {
    this.spawn = spawn;
  }

  respawn() {
    const { position: p, rotation: r } = this.spawn;
    this.body.setTranslation(p, true);
    this.body.setRotation(r, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
  }

  /** Se llama una vez por paso fijo de física, antes de world.step(). */
  update(input: DriveInput, dt: number) {
    const t = this.tuning;
    const v = this.forwardSpeed;
    const speedRatio = Math.min(Math.abs(v) / t.topSpeed, 1);

    // Dirección: el ángulo máximo baja con la velocidad, y se interpola suave.
    const maxSteer = t.steerMaxLowSpeed + (t.steerMaxHighSpeed - t.steerMaxLowSpeed) * Math.sqrt(speedRatio);
    const target = input.steer * maxSteer;
    const step = t.steerRate * dt;
    this.steerAngle += Math.max(-step, Math.min(step, target - this.steerAngle));
    for (const i of FRONT_WHEELS) this.vehicle.setWheelSteering(i, STEER_SIGN * this.steerAngle);

    // Acelerador / freno / reversa.
    let engine = 0;
    let brake = 0;
    if (input.throttle > 0 && v > -1) {
      engine = input.throttle * t.engineForce * (1 - speedRatio * speedRatio);
    } else if (input.throttle > 0) {
      brake = t.brakeForce; // venía en reversa: frenar primero
    }
    if (input.brake > 0) {
      if (v > 1) brake = Math.max(brake, input.brake * t.brakeForce);
      else if (v > -t.maxReverseSpeed) engine = -input.brake * t.reverseForce;
    }
    for (const i of REAR_WHEELS) this.vehicle.setWheelEngineForce(i, engine);
    for (let i = 0; i < 4; i++) this.vehicle.setWheelBrake(i, brake);

    // Freno de mano: menos agarre lateral atrás para derrapar.
    const side = input.handbrake ? t.driftSideFriction : t.sideFrictionStiffness;
    for (const i of REAR_WHEELS) this.vehicle.setWheelSideFrictionStiffness(i, side);

    const grounded = this.wheelsOnGround;
    if (grounded > 0) {
      // Carga aerodinámica: pega el auto al piso a alta velocidad.
      const up = this.up;
      const f = t.downforce * v * v * dt;
      this.body.applyImpulse({ x: -up.x * f, y: -up.y * f, z: -up.z * f }, true);
    } else {
      // Control en el aire: girar (A/D) e inclinar la trompa (W/S).
      const yaw = rotate(this.body.rotation(), { x: 0, y: -input.steer, z: 0 });
      const pitch = rotate(this.body.rotation(), { x: 0, y: 0, z: input.brake - input.throttle });
      const k = t.airControlTorque * dt;
      this.body.applyTorqueImpulse(
        { x: (yaw.x + pitch.x) * k, y: (yaw.y + pitch.y) * k, z: (yaw.z + pitch.z) * k },
        true,
      );
    }

    this.vehicle.updateVehicle(dt);
  }

  dispose() {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeRigidBody(this.body);
  }
}
