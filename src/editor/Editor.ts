import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment, type Environment } from '../game/environment';
import { createRenderPipeline, type RenderPipeline } from '../game/renderPipeline';
import { buildDecorations, loadDecorModels, placeDecor, type DecorModels } from '../track/decor';
import { buildGate, buildPieceGeometry, makeRoadMaterial, setRoadBeat } from '../track/geometry';
import { chainPieces, exitConnector, headingDir, pieceFrames } from '../track/layout';
import { CELL, LEVEL } from '../track/pieces';
import { getTheme, type Theme } from '../track/themes';
import type { Heading, PieceType, PlacedDecoration, PlacedPiece, Song, TrackData } from '../track/types';
import { TrackPath } from '../track/TrackPath';
import { MarkerView } from '../music/MarkerView';
import { computeMarkers, secondsPerBeat } from '../music/song';

const MAX_LEVEL = 12;
const MAX_HISTORY = 200;

export interface EditorCursor {
  cell: [number, number, number];
  rot: Heading;
}

/** Qué coloca el click: tramos o decoración de la estética actual. */
export type EditorMode = 'track' | 'decor';

type Decorations = TrackData['decorations'];

interface Snapshot {
  pieces: PlacedPiece[];
  decorations: Decorations;
}

export interface EditorEvents {
  onChange?: (pieces: PlacedPiece[], decorations: Decorations) => void;
  onCursor?: (cursor: EditorCursor) => void;
  /** Largo del recorrido (m) cada vez que cambia la pista. */
  onPathLength?: (length: number) => void;
}

const sameCell = (a: [number, number, number], b: [number, number, number]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Editor de pistas en 3D. Igual que Game, vive fuera de React: React solo le
 * pasa el tramo elegido y escucha los cambios.
 */
export class Editor {
  private renderer: THREE.WebGLRenderer;
  private pipeline: RenderPipeline | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private pieces: PlacedPiece[];
  private decorations: Decorations;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private mode: EditorMode = 'track';
  private decorAsset: string | null = null;
  private cursor: EditorCursor = { cell: [0, 0, 0], rot: 0 };
  private type: PieceType = 'straight';
  private hovered = -1;
  private song: Song | null = null;
  private path: TrackPath | null = null;
  private markerView: MarkerView | null = null;

  private trackGroup = new THREE.Group();
  /** Decoración de la estética actual. Comparte geometría con el caché de modelos: no se libera. */
  private decorGroup = new THREE.Group();
  private decorModels: DecorModels = new Map();
  private decorLoad = 0;
  private pieceMeshes: THREE.Mesh[] = [];
  private ghost = new THREE.Group();
  private cursorMarker: THREE.Mesh;
  private grid!: THREE.GridHelper;
  /** Capa libre para que otras vistas (p. ej. marcadores) dibujen sobre la pista. */
  readonly overlay = new THREE.Group();
  private _inputEnabled = true;

  private themeId!: string;
  private theme!: Theme;
  private env: Environment | null = null;
  private roadMat!: THREE.MeshStandardMaterial;
  private detachedMat!: THREE.MeshStandardMaterial;
  private hoverMat!: THREE.MeshStandardMaterial;
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0x4dd88a, transparent: true, opacity: 0.55, depthWrite: false });
  private ghostReplaceMat = new THREE.MeshStandardMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.55, depthWrite: false });

  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private downAt = { x: 0, y: 0, button: -1 };

  constructor(
    private container: HTMLElement,
    track: Pick<TrackData, 'pieces' | 'theme' | 'decorations'>,
    private events: EditorEvents = {},
  ) {
    this.pieces = structuredClone(track.pieces);
    this.decorations = structuredClone(track.decorations);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.applyTheme(track.theme);
    this.scene.add(this.trackGroup, this.decorGroup, this.ghost, this.overlay);

    this.cursorMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.3, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.x = 3;
    this.cursorMarker.add(arrow);
    this.scene.add(this.cursorMarker);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 900;
    this.controls.screenSpacePanning = false;

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    // Cursor al final del recorrido, cámara encuadrando la pista.
    const { order } = chainPieces(this.pieces);
    const last = this.pieces[order[order.length - 1] ?? -1];
    if (last) this.moveCursorAfter(last);
    this.rebuild();
    this.frameAll();
    this.loop();
  }

  // ---------- API pública ----------

  getPieces() {
    return structuredClone(this.pieces);
  }

  getDecorations() {
    return structuredClone(this.decorations);
  }

  /** Si es false, el editor no coloca ni borra tramos (la cámara sigue andando). */
  get inputEnabled() {
    return this._inputEnabled;
  }

  set inputEnabled(on: boolean) {
    this._inputEnabled = on;
    this.ghost.visible = on;
    this.cursorMarker.visible = on;
    if (!on) this.setHovered(-1);
  }

  /** Muestra los marcadores de la melodía sobre la pista. */
  setSong(song: Song) {
    this.song = song;
    this.updateMarkers();
  }

  /** Cambia la estética con la que se dibuja la pista. */
  setTheme(id: string) {
    if (id === this.themeId) return;
    this.applyTheme(id);
    this.rebuild();
    this.rebuildDecor();
  }

  setMode(mode: EditorMode) {
    this.mode = mode;
    if (mode === 'decor') this.setHovered(-1);
    this.updateGhost();
  }

  /** Asset de decoración que coloca el click (id dentro de la estética actual). */
  setDecorAsset(id: string | null) {
    this.decorAsset = id;
    this.updateGhost();
  }

  setPieceType(type: PieceType) {
    this.type = type;
    this.updateGhost();
  }

  rotate(delta: number) {
    this.cursor.rot = ((((this.cursor.rot + delta) % 4) + 4) % 4) as Heading;
    this.cursorChanged();
  }

  changeLevel(delta: number) {
    this.cursor.cell[1] = Math.max(0, Math.min(MAX_LEVEL, this.cursor.cell[1] + delta));
    this.cursorChanged();
  }

  place() {
    if (this.mode === 'decor') return this.placeDecoration();
    this.commit(() => {
      const piece: PlacedPiece = { type: this.type, cell: [...this.cursor.cell], rot: this.cursor.rot };
      this.pieces = this.pieces.filter(
        (p) => !sameCell(p.cell, piece.cell) && !(piece.type === 'start' && p.type === 'start'),
      );
      this.pieces.push(piece);
      this.moveCursorAfter(piece);
    });
  }

  /** Borra el tramo bajo el mouse o, si no hay, el que arranca en el cursor. */
  remove() {
    if (this.mode === 'decor') return this.removeDecoration();
    const index = this.hovered >= 0 ? this.hovered : this.pieces.findIndex((p) => sameCell(p.cell, this.cursor.cell));
    if (index < 0) return;
    this.commit(() => {
      this.pieces.splice(index, 1);
      this.hovered = -1;
    });
  }

  clear() {
    this.commit(() => {
      this.pieces = [{ type: 'start', cell: [0, 0, 0], rot: 0 }];
      this.cursor = { cell: [1, 0, 0], rot: 0 };
    });
  }

  /** Borra toda la decoración de la estética actual (la de las otras se conserva). */
  clearDecorations() {
    if (!this.decorList.length) return;
    this.commit(() => {
      this.decorations = { ...this.decorations, [this.themeId]: [] };
    });
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  /** Encuadra toda la pista. */
  frameAll() {
    const box = new THREE.Box3();
    for (const m of this.pieceMeshes) box.expandByObject(m);
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(100, 10, 100));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(-0.5, 0.9, 0.7).normalize().multiplyScalar(Math.max(80, size * 0.9)));
    this.controls.update();
  }

  dispose() {
    this.disposed = true;
    this.decorLoad++;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    this.controls.dispose();
    this.disposeTrackMeshes();
    this.markerView?.dispose();
    this.env?.dispose();
    this.pipeline?.dispose();
    this.grid.dispose();
    for (const m of [this.roadMat, this.detachedMat, this.hoverMat, this.ghostMat, this.ghostReplaceMat]) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Estado ----------

  private get decorList(): PlacedDecoration[] {
    return this.decorations[this.themeId] ?? [];
  }

  private snapshot(): Snapshot {
    return { pieces: structuredClone(this.pieces), decorations: structuredClone(this.decorations) };
  }

  private restore(s: Snapshot) {
    this.pieces = s.pieces;
    this.decorations = s.decorations;
    this.afterChange();
  }

  private placeDecoration() {
    const asset = this.decorAsset;
    if (!asset || !this.decorModels.has(asset)) return;
    this.commit(() => {
      const d: PlacedDecoration = { asset, cell: [...this.cursor.cell], rot: this.cursor.rot };
      // Una decoración por celda: colocar en una ocupada la reemplaza.
      const others = this.decorList.filter((o) => !sameCell(o.cell, d.cell));
      this.decorations = { ...this.decorations, [this.themeId]: [...others, d] };
    });
  }

  private removeDecoration() {
    if (!this.decorList.some((d) => sameCell(d.cell, this.cursor.cell))) return;
    this.commit(() => {
      this.decorations = { ...this.decorations, [this.themeId]: this.decorList.filter((d) => !sameCell(d.cell, this.cursor.cell)) };
    });
  }

  private commit(mutate: () => void) {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    mutate();
    this.afterChange();
  }

  private afterChange() {
    this.rebuild();
    this.rebuildDecor();
    this.events.onChange?.(this.getPieces(), this.getDecorations());
  }

  private moveCursorAfter(piece: PlacedPiece) {
    const exit = exitConnector(piece);
    if (exit) {
      this.cursor = { cell: [...exit.cell], rot: exit.heading };
    } else {
      // Rampa de salto: dejar el cursor unos nodos más adelante, para la caída.
      const [dx, dz] = headingDir(piece.rot);
      this.cursor = { cell: [piece.cell[0] + dx * 4, piece.cell[1], piece.cell[2] + dz * 4], rot: piece.rot };
    }
    this.cursorChanged();
  }

  private cursorChanged() {
    const [x, y, z] = this.cursor.cell;
    this.cursorMarker.position.set(x * CELL, y * LEVEL + 0.3, z * CELL);
    this.cursorMarker.rotation.y = (-this.cursor.rot * Math.PI) / 2;
    this.grid.position.y = y * LEVEL + 0.02;
    this.plane.constant = -y * LEVEL;
    this.updateGhost();
    this.events.onCursor?.({ cell: [...this.cursor.cell], rot: this.cursor.rot });
  }

  // ---------- Escena ----------

  /** Ambiente, grilla y materiales de la calzada según la estética. No rearma los tramos. */
  private applyTheme(id: string) {
    this.themeId = id;
    this.theme = getTheme(id);
    this.loadDecor();
    this.env?.dispose();
    this.env = createEnvironment(this.scene, this.theme);
    this.env.sun.castShadow = false;

    this.roadMat?.dispose();
    this.detachedMat?.dispose();
    this.hoverMat?.dispose();
    this.roadMat = makeRoadMaterial(this.theme);
    this.detachedMat = makeRoadMaterial(this.theme, { transparent: true, opacity: 0.45 });
    this.hoverMat = makeRoadMaterial(this.theme, { emissive: 0x7a1010 });

    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    this.grid = new THREE.GridHelper(CELL * 80, 80, this.theme.grid.center, this.theme.grid.lines);
    this.grid.position.y = this.cursor.cell[1] * LEVEL + 0.02;
    this.scene.add(this.grid);

    this.pipeline?.dispose();
    this.pipeline = createRenderPipeline(this.renderer, this.scene, this.camera, this.theme);
  }

  /** Carga los modelos de decoración de la estética; si mientras tanto cambia, se descarta. */
  private loadDecor() {
    const token = ++this.decorLoad;
    this.decorModels = new Map();
    void loadDecorModels(this.theme).then((models) => {
      if (token !== this.decorLoad) return;
      this.decorModels = models;
      this.rebuildDecor();
      this.updateGhost();
    });
  }

  private rebuildDecor() {
    this.scene.remove(this.decorGroup);
    this.decorGroup = buildDecorations(this.decorList, this.decorModels);
    this.scene.add(this.decorGroup);
  }

  private disposeTrackMeshes() {
    for (const child of [...this.trackGroup.children]) {
      child.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      this.trackGroup.remove(child);
    }
    this.pieceMeshes = [];
  }

  private rebuild() {
    this.disposeTrackMeshes();
    const { order } = chainPieces(this.pieces);
    const inRoute = new Set(order);
    const frames = order.flatMap((i) => pieceFrames(this.pieces[i]));
    this.path = frames.length > 1 ? new TrackPath(frames) : null;
    this.events.onPathLength?.(this.path?.length ?? 0);
    this.updateMarkers();
    this.pieces.forEach((piece, i) => {
      const mesh = new THREE.Mesh(buildPieceGeometry(piece, this.theme.road), inRoute.has(i) ? this.roadMat : this.detachedMat);
      mesh.userData.index = i;
      mesh.userData.baseMat = mesh.material;
      this.pieceMeshes.push(mesh);
      this.trackGroup.add(mesh);
      if (piece.type === 'start' || piece.type === 'finish') this.trackGroup.add(buildGate(pieceFrames(piece)[0], piece.type, this.theme.road));
    });
    this.hovered = -1;
    this.updateGhost();
  }

  private updateMarkers() {
    if (this.markerView) {
      this.overlay.remove(this.markerView.group);
      this.markerView.dispose();
      this.markerView = null;
    }
    if (!this.song || !this.path) return;
    this.markerView = new MarkerView(computeMarkers(this.song, this.path).markers);
    this.overlay.add(this.markerView.group);
  }

  private updateGhost() {
    for (const child of [...this.ghost.children]) {
      if (child.userData.ownsGeometry) (child as THREE.Mesh).geometry.dispose();
      this.ghost.remove(child);
    }
    if (this.mode === 'decor') {
      const model = this.decorAsset ? this.decorModels.get(this.decorAsset) : undefined;
      if (!model) return;
      const replacing = this.decorList.some((d) => sameCell(d.cell, this.cursor.cell));
      const obj = placeDecor(model, this.cursor);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = replacing ? this.ghostReplaceMat : this.ghostMat;
      });
      this.ghost.add(obj);
      return;
    }
    const piece: PlacedPiece = { type: this.type, cell: this.cursor.cell, rot: this.cursor.rot };
    const replacing = this.pieces.some((p) => sameCell(p.cell, piece.cell));
    const geo = buildPieceGeometry(piece, this.theme.road);
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, replacing ? this.ghostReplaceMat : this.ghostMat);
    mesh.userData.ownsGeometry = true;
    mesh.position.y = 0.05;
    this.ghost.add(mesh);
  }

  private setHovered(index: number) {
    if (index === this.hovered) return;
    const prev = this.pieceMeshes[this.hovered];
    if (prev) prev.material = prev.userData.baseMat;
    this.hovered = index;
    const next = this.pieceMeshes[index];
    if (next) next.material = this.hoverMat;
  }

  // ---------- Entrada ----------

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons & 6 || !this.inputEnabled) return; // rotando o paneando la cámara
    this.updatePointer(e);
    const hit = this.mode === 'track' ? this.raycaster.intersectObjects(this.pieceMeshes, false)[0] : undefined;
    this.setHovered(hit ? (hit.object.userData.index as number) : -1);

    const p = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!p) return;
    const x = Math.round(p.x / CELL);
    const z = Math.round(p.z / CELL);
    if (x !== this.cursor.cell[0] || z !== this.cursor.cell[2]) {
      this.cursor.cell = [x, this.cursor.cell[1], z];
      this.cursorChanged();
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, button: e.button };
  };

  private onPointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5;
    if (moved || e.button !== this.downAt.button || !this.inputEnabled) return;
    if (e.button === 0) {
      if (e.shiftKey || e.altKey) this.remove();
      else this.place();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e) || !this.inputEnabled) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.code;
    let handled = true;
    if (mod && k === 'KeyZ') e.shiftKey ? this.redo() : this.undo();
    else if (mod && k === 'KeyY') this.redo();
    else if (k === 'KeyQ') this.rotate(-1);
    else if (k === 'KeyE') this.rotate(1);
    else if (k === 'PageUp' || k === 'KeyR') this.changeLevel(1);
    else if (k === 'PageDown' || k === 'KeyF') this.changeLevel(-1);
    else if (k === 'Enter' || k === 'Space') this.place();
    else if (k === 'Delete' || k === 'Backspace' || k === 'KeyX') this.remove();
    else if (k === 'KeyC') this.frameAll();
    else if (k.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) this.moveCursorByKey(k);
    else handled = false;
    if (handled) e.preventDefault();
  };

  /** Mueve el cursor relativo a la vista de la cámara (arriba = alejarse). */
  private moveCursorByKey(code: string) {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const camHeading = Math.abs(fwd.x) > Math.abs(fwd.z) ? (fwd.x > 0 ? 0 : 2) : fwd.z > 0 ? 1 : 3;
    const turn = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 }[code] ?? 0;
    const [dx, dz] = headingDir(camHeading + turn);
    this.cursor.cell = [this.cursor.cell[0] + dx, this.cursor.cell[1], this.cursor.cell[2] + dz];
    this.cursorChanged();
  }

  // ---------- Loop ----------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.markerView?.update(1 / 60);
    // Sin auto, los cordones pulsan con el reloj al tempo de la canción (vista previa).
    const beat = this.song ? performance.now() / 1000 / secondsPerBeat(this.song) : 0;
    for (const m of [this.roadMat, this.detachedMat, this.hoverMat]) setRoadBeat(m, beat);
    this.pipeline!.render();
  };

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.pipeline?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
