import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Car } from './Car';
import { CarView, loadCarModel, type CarModel } from './CarView';
import { ChaseCamera } from './ChaseCamera';
import { createEnvironment } from './environment';
import { createRenderPipeline, type RenderPipeline } from './renderPipeline';
import { Keyboard } from './input';
import { addGround, addTrackColliders } from './trackPhysics';
import { carTuning } from './tuning';
import { buildTrack, type BuiltTrack } from '../track/build';
import { setRoadBeat } from '../track/geometry';
import { getTheme } from '../track/themes';
import type { Song, TrackData } from '../track/types';
import { ROAD_HALF_WIDTH } from '../track/pieces';
import { MusicRun } from '../music/MusicRun';
import { distanceToBeat } from '../music/song';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const CAR_MODEL_URL = `${import.meta.env.BASE_URL}models/car.glb`;

export type RaceState = 'ready' | 'running' | 'finished';

export interface Telemetry {
  speedKmh: number;
  wheelsOnGround: number;
  fps: number;
  state: RaceState;
  /** Segundos desde la largada. */
  raceTime: number;
  /** Metros recorridos sobre la línea central. */
  progress: number;
  trackLength: number;
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
  readonly telemetry: Telemetry = {
    speedKmh: 0,
    wheelsOnGround: 0,
    fps: 0,
    state: 'ready',
    raceTime: 0,
    progress: 0,
    trackLength: 0,
  };

  private renderer: THREE.WebGLRenderer;
  private pipeline: RenderPipeline | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.1, 3000);
  private chase = new ChaseCamera(this.camera);
  private sun!: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3();
  private keyboard = new Keyboard();
  private world!: RAPIER.World;
  private car!: Car;
  private carView!: CarView;
  private track!: BuiltTrack;
  private song!: Song;
  /** Marcadores, sonido y puntaje; null si la pista no tiene melodía. */
  music: MusicRun | null = null;

  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private disposed = false;
  private pathHint = -1;
  private finishSide = -1;

  // Pose anterior y actual del chasis para interpolar el render.
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currRot = new THREE.Quaternion();
  private renderPos = new THREE.Vector3();
  private renderRot = new THREE.Quaternion();
  private tmp = new THREE.Vector3();

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

  static async create(container: HTMLElement, track: TrackData) {
    const [, carModel] = await Promise.all([initRapier(), loadCarModel(CAR_MODEL_URL)]);
    const game = new Game(container);
    game.setupScene(carModel, track);
    return game;
  }

  get carInstance() {
    return this.car;
  }

  get path() {
    return this.track.path;
  }

  private setupScene(carModel: CarModel, trackData: TrackData) {
    const theme = getTheme(trackData.theme);
    this.sun = createEnvironment(this.scene, theme).sun;
    this.sunOffset.set(...theme.sun.position);
    this.pipeline = createRenderPipeline(this.renderer, this.scene, this.camera, theme);
    this.resize();
    this.song = trackData.song;

    this.world = new RAPIER.World({ x: 0, y: carTuning.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    addGround(RAPIER, this.world);

    this.track = buildTrack(trackData);
    this.scene.add(this.track.group);
    addTrackColliders(RAPIER, this.world, this.track.geometries);
    this.telemetry.trackLength = this.track.path?.length ?? 0;

    if (trackData.song.notes.length > 0 && this.track.path) {
      this.music = new MusicRun(trackData.song, this.track.path);
      this.scene.add(this.music.view.group);
    }

    const { position: p, quaternion: q } = this.track.spawn;
    this.car = new Car(
      RAPIER,
      this.world,
      { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } },
      carModel.layout,
    );
    this.carView = new CarView(this.car, carModel);
    this.scene.add(this.carView.root);
    this.restart();
  }

  /** Cambia la gravedad (usado por el panel de ajuste). */
  setGravity(g: number) {
    this.world.gravity = { x: 0, y: g, z: 0 };
  }

  /** Vuelve a la largada y reinicia el cronómetro. */
  restart() {
    this.car.respawn();
    Object.assign(this.telemetry, { state: 'ready', raceTime: 0, progress: 0 });
    this.pathHint = -1;
    this.finishSide = -1;
    this.music?.reset();
    this.capturePose();
    this.capturePose();
    this.chase.snap();
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

  private step() {
    const input = this.keyboard.read();
    const t = this.telemetry;
    if (input.reset || this.currPos.y < this.track.minY - 30) {
      this.restart();
      return;
    }
    if (t.state === 'ready' && (input.throttle > 0 || input.brake > 0)) t.state = 'running';

    this.car.update(input, FIXED_DT);
    this.world.step();
    this.capturePose();

    if (t.state === 'running') {
      t.raceTime += FIXED_DT;
      this.updateProgress();
      this.music?.step(t.raceTime, this.currPos, t.progress, this.car.speed);
      this.checkFinish();
    }
  }

  private updateProgress() {
    const path = this.track.path;
    if (!path) return;
    const proj = path.project(this.currPos, this.pathHint);
    // Si nos alejamos mucho (salto, atajo), buscar en todo el recorrido.
    const p = proj.distance > 25 ? path.project(this.currPos) : proj;
    this.pathHint = p.index;
    this.telemetry.progress = p.s;
  }

  /** Detecta el cruce de la línea de llegada (plano en la entrada del tramo de llegada). */
  private checkFinish() {
    const f = this.track.finish;
    if (!f) return;
    const rel = this.tmp.subVectors(this.currPos, f.p);
    const side = Math.sign(rel.dot(f.t));
    const lateral = Math.abs(rel.dot(f.right));
    const vertical = rel.dot(f.up);
    if (this.finishSide < 0 && side >= 0 && lateral < ROAD_HALF_WIDTH + 2 && vertical > -2 && vertical < 8) {
      this.telemetry.state = 'finished';
    }
    this.finishSide = side;
  }

  private frame(now: number) {
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    // Física a paso fijo: el comportamiento no depende de los FPS.
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const alpha = this.accumulator / FIXED_DT;
    this.renderPos.lerpVectors(this.prevPos, this.currPos, alpha);
    this.renderRot.slerpQuaternions(this.prevRot, this.currRot, alpha);
    this.carView.sync(this.renderPos, this.renderRot);
    this.music?.view.update(frameDt);

    const speed = this.car.speed;
    this.chase.update(this.renderPos, this.renderRot, speed, this.car.tuning.topSpeed, frameDt);

    // La sombra sigue al auto.
    if (this.sun.castShadow) {
      this.sun.position.copy(this.renderPos).add(this.sunOffset);
      this.sun.target.position.copy(this.renderPos);
    }

    // Los cordones pulsan con el beat del jugador (su posición en la pista).
    setRoadBeat(this.track.roadMaterial, distanceToBeat(this.song, this.telemetry.progress));
    this.pipeline!.render();

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
    this.pipeline?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.keyboard.dispose();
    this.car.dispose();
    this.music?.dispose();
    this.world.free();
    this.track.geometries.forEach((g) => g.dispose());
    this.pipeline?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
