import { demoTrack } from './demo';
import { PIECES } from './pieces';
import { DEFAULT_THEME } from './themes';
import type { PieceType, PlacedDecoration, TrackData } from './types';

const INDEX_KEY = 'f1s:tracks';
const trackKey = (id: string) => `f1s:track:${id}`;

export interface TrackMeta {
  id: string;
  name: string;
  updatedAt: number;
  builtin?: boolean;
}

function readIndex(): TrackMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as TrackMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(index: TrackMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Pistas guardadas, más recientes primero, seguidas de las que vienen con el juego. */
export function listTracks(): TrackMeta[] {
  const saved = readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  const demo = demoTrack();
  return [...saved, { id: demo.id, name: demo.name, updatedAt: 0, builtin: true }];
}

export function loadTrack(id: string): TrackData | null {
  if (id === 'demo') return demoTrack();
  try {
    const raw = localStorage.getItem(trackKey(id));
    return raw ? validateTrack(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Guarda la pista. Si es la demo, la guarda como copia nueva. Devuelve la pista guardada. */
export function saveTrack(track: TrackData): TrackData {
  const isDemo = track.id === 'demo';
  const name = isDemo && track.name === demoTrack().name ? `${track.name} (copia)` : track.name;
  const saved: TrackData = { ...track, id: isDemo ? newId() : track.id, name, updatedAt: Date.now() };
  localStorage.setItem(trackKey(saved.id), JSON.stringify(saved));
  const index = readIndex().filter((t) => t.id !== saved.id);
  index.push({ id: saved.id, name: saved.name, updatedAt: saved.updatedAt });
  writeIndex(index);
  return saved;
}

export function deleteTrack(id: string) {
  localStorage.removeItem(trackKey(id));
  writeIndex(readIndex().filter((t) => t.id !== id));
}

export function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newTrack(name = 'Pista nueva'): TrackData {
  return {
    version: 1,
    id: newId(),
    name,
    updatedAt: Date.now(),
    pieces: [{ type: 'start', cell: [0, 0, 0], rot: 0 }],
    song: { bpm: 120, beatsPerBar: 4, designSpeed: 30, startOffset: 60, notes: [] },
    theme: DEFAULT_THEME,
    decorations: {},
  };
}

const isCell = (c: unknown) => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'number');

/**
 * Conserva la decoración de todas las estéticas, aunque no existan en esta versión
 * o usen assets desconocidos. Solo descarta elementos mal formados.
 */
function validateDecorations(data: unknown): Record<string, PlacedDecoration[]> {
  const out: Record<string, PlacedDecoration[]> = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [theme, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    out[theme] = list.filter(
      (d): d is PlacedDecoration => !!d && typeof d.asset === 'string' && isCell(d.cell) && [0, 1, 2, 3].includes(d.rot),
    );
  }
  return out;
}

/** Valida (por arriba) un JSON de pista. Lanza un error legible si no sirve. */
export function validateTrack(data: unknown): TrackData {
  const t = data as Partial<TrackData>;
  if (!t || typeof t !== 'object') throw new Error('El archivo no es una pista');
  if (t.version !== 1) throw new Error('Versión de pista no soportada');
  if (!Array.isArray(t.pieces)) throw new Error('La pista no tiene tramos');
  for (const p of t.pieces) {
    if (!(p.type in PIECES)) throw new Error(`Tramo desconocido: ${String(p.type as PieceType)}`);
    if (!Array.isArray(p.cell) || p.cell.length !== 3 || ![0, 1, 2, 3].includes(p.rot)) throw new Error('Tramo mal formado');
  }
  const song = t.song ?? newTrack().song;
  return {
    version: 1,
    id: typeof t.id === 'string' ? t.id : newId(),
    name: typeof t.name === 'string' ? t.name : 'Sin nombre',
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : Date.now(),
    pieces: t.pieces,
    song: { ...newTrack().song, ...song, notes: Array.isArray(song.notes) ? song.notes : [] },
    theme: typeof t.theme === 'string' ? t.theme : DEFAULT_THEME,
    decorations: validateDecorations(t.decorations),
  };
}

export function exportTrackFile(track: TrackData) {
  const blob = new Blob([JSON.stringify(track, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${track.name.replace(/[^\w\- ]+/g, '').trim() || 'pista'}.f1s.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Importa un archivo .json como pista nueva (con id nuevo) y la guarda. */
export async function importTrackFile(file: File): Promise<TrackData> {
  const track = validateTrack(JSON.parse(await file.text()));
  return saveTrack({ ...track, id: newId() });
}
