import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Car } from './Car';
import { CarView, loadCarModel, type CarModel } from './CarView';
import { ChaseCamera } from './ChaseCamera';
import { Keyboard } from './input';
import { buildSandbox } from './sandbox';
import { carTuning } from './tuning';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const CAR_MODEL_URL = `${import.meta.env.BASE_URL}models/car.glb`;

export interface Telemetry {
  speedKmh: number;
  wheelsOnGround: number;
  fps: number;
}

let rapierReady: Promise<void> | null = null;
function initRapier() {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/**
 * Núcleo del juego. Vive fuera de React: React solo monta el canvas y la UI,
 * el loop de render/física no dispara renders de React.
 */
export class Game {
  readonly telemetry: Telemetry = { speedKmh: 0, wheelsOnGround: 0, fps: 0 };

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2000);
  private chase = new ChaseCamera(this.camera);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private keyboard = new Keyboard();
  private world!: RAPIER.World;
  private car!: Car;
  private carView!: CarView;

  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private disposed = false;

  // Pose anterior y actual del chasis para interpolar el render.
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currRot = new THREE.Quaternion();
  private renderPos = new THREE.Vector3();
  private renderRot = new THREE.Quaternion();

  private resizeObserver: ResizeObserver;

  private constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  static async create(container: HTMLElement) {
    const [, carModel] = await Promise.all([initRapier(), loadCarModel(CAR_MODEL_URL)]);
    const game = new Game(container);
    game.setupScene(carModel);
    return game;
  }

  get carInstance() {
    return this.car;
  }

  private setupScene(carModel: CarModel) {
    const scene = this.scene;
    scene.background = new THREE.Color(0x9cc7e8);
    scene.fog = new THREE.Fog(0x9cc7e8, 250, 900);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x404858, 1.1));

    this.sun.position.set(60, 120, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 40;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 300 });
    scene.add(this.sun, this.sun.target);

    this.world = new RAPIER.World({ x: 0, y: carTuning.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    buildSandbox(RAPIER, this.world, scene);

    this.car = new Car(RAPIER, this.world, {
      position: { x: 0, y: 1.2, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    }, carModel.layout);
    this.carView = new CarView(this.car, carModel);
    scene.add(this.carView.root);
    this.capturePose();
    this.capturePose();
  }

  /** Cambia la gravedad (usado por el panel de ajuste). */
  setGravity(g: number) {
    this.world.gravity = { x: 0, y: g, z: 0 };
  }

  start() {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private capturePose() {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    const p = this.car.body.translation();
    const r = this.car.body.rotation();
    this.currPos.set(p.x, p.y, p.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  private frame(now: number) {
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    // Física a paso fijo: el comportamiento no depende de los FPS.
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const input = this.keyboard.read();
      this.car.update(input, FIXED_DT);
      this.world.step();
      this.capturePose();
      if (input.reset) this.capturePose(); // sin interpolar el teletransporte
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const alpha = this.accumulator / FIXED_DT;
    this.renderPos.lerpVectors(this.prevPos, this.currPos, alpha);
    this.renderRot.slerpQuaternions(this.prevRot, this.currRot, alpha);
    this.carView.sync(this.renderPos, this.renderRot);

    const speed = this.car.speed;
    this.chase.update(this.renderPos, this.renderRot, speed, this.car.tuning.topSpeed, frameDt);

    // La sombra sigue al auto.
    this.sun.position.set(this.renderPos.x + 60, this.renderPos.y + 120, this.renderPos.z + 40);
    this.sun.target.position.copy(this.renderPos);

    this.renderer.render(this.scene, this.camera);

    this.telemetry.speedKmh = this.car.forwardSpeed * 3.6;
    this.telemetry.wheelsOnGround = this.car.wheelsOnGround;
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.telemetry.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.keyboard.dispose();
    this.car.dispose();
    this.world.free();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
