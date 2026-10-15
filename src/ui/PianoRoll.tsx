import { useEffect, useMemo, useRef, useState } from 'react';
import { getSynth } from '../music/audio';
import { INSTRUMENTS } from '../music/instruments';
import { audioDeps, fixedClock, Sequencer } from '../music/Sequencer';
import {
  addRepeat,
  moveSelection,
  playedRepeat,
  songLengthBeats,
  unroll,
  unrollWithSource,
  writtenBeat,
  type PlayedNote,
} from '../music/song';
import { isBlackKey, noteName, pitchHue } from '../music/theory';
import { newId } from '../track/storage';
import type { Song, SongTrack } from '../track/types';

const LOW = 48; // C3
const HIGH = 84; // C6
const ROW_H = 13;
const KEYS_W = 44;
/** Regla: arriba los números de compás, abajo los corchetes de repetición. */
const RULER_H = 34;
const BRACKET_Y = 18;
const SNAP = 0.25;
/** Píxeles de arrastre a partir de los cuales un click pasa a ser un arrastre. */
const DRAG_PX = 4;

interface Props {
  song: Song;
  selectedTrack: SongTrack;
  onSelectTrack: (id: string) => void;
  onTracksChange: (tracks: SongTrack[]) => void;
  /** Beats que entran en la pista a la velocidad de diseño. */
  availableBeats: number;
  noteLength: number;
}

interface Selection {
  notes: ReadonlySet<number>;
  repeats: ReadonlySet<number>;
}
const EMPTY: Selection = { notes: new Set(), repeats: new Set() };

type Drag =
  | { kind: 'move'; original: SongTrack; sel: Selection; startWritten: number; startPitch: number; lastPitch: number }
  | { kind: 'resize'; index: number; playedStart: number }
  | { kind: 'marquee'; x0: number; y0: number }
  | { kind: 'ruler'; x0: number; dragged: boolean }
  | null;

/** Ventana para crear o editar una repetición (beats escritos). */
type Popup =
  | { kind: 'new'; start: number; end: number; times: number; x: number; label: string }
  | { kind: 'edit'; index: number; times: number; x: number; label: string }
  | null;

/** Compases (como se ven en la regla) de un tramo en beats tocados: «c.2» o «c.2–3». */
function barsLabel(start: number, end: number, beatsPerBar: number) {
  const a = Math.floor(start / beatsPerBar) + 1;
  const b = Math.ceil(end / beatsPerBar);
  return a >= b ? `c.${a}` : `c.${a}–${b}`;
}

/** Piano roll multipista dibujado en canvas: filas = notas, columnas = beats tocados. */
export function PianoRoll({ song, selectedTrack: track, onSelectTrack, onTracksChange, availableBeats, noteLength }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 260 });
  const [scroll, setScroll] = useState({ x: -0.5, y: (HIGH - 79) * ROW_H });
  const [pxPerBeat, setPxPerBeat] = useState(36);
  const [sel, setSel] = useState<Selection>(EMPTY);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [popup, setPopup] = useState<Popup>(null);
  const [message, setMessage] = useState('');
  const [transport, setTransport] = useState({ playing: false, pos: 0 });
  const dragRef = useRef<Drag>(null);
  const seqRef = useRef<Sequencer | null>(null);
  const rafRef = useRef(0);

  // El estado más reciente, para handlers nativos y el loop de reproducción.
  const latest = useRef({ song, track, sel, transport });
  latest.current = { song, track, sel, transport };

  const played = useMemo(() => unrollWithSource(track), [track]);
  const isMain = !!track.main;
  const totalBeats = Math.max(32, Math.ceil(availableBeats) + 4, Math.ceil(songLengthBeats(song)) + 8);
  const gridH = (HIGH - LOW + 1) * ROW_H;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);

  // Al cambiar de pista se descarta la selección.
  useEffect(() => {
    setSel(EMPTY);
    setPopup(null);
  }, [track.id]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(t);
  }, [message]);

  const updateTrack = (t: SongTrack) => onTracksChange(latest.current.song.tracks.map((x) => (x.id === t.id ? t : x)));

  // Conversión pantalla ↔ partitura (beats tocados).
  const xOf = (beat: number) => KEYS_W + (beat - scroll.x) * pxPerBeat;
  const yOf = (pitch: number) => RULER_H + (HIGH - pitch) * ROW_H - scroll.y;
  const beatAt = (x: number) => (x - KEYS_W) / pxPerBeat + scroll.x;
  const pitchAt = (y: number) => HIGH - Math.floor((y - RULER_H + scroll.y) / ROW_H);

  // ---- Sonido y transporte ----

  const sequencer = () => {
    if (!seqRef.current) {
      seqRef.current = new Sequencer(audioDeps(getSynth()));
      seqRef.current.setSong(latest.current.song);
    }
    return seqRef.current;
  };
  useEffect(() => seqRef.current?.setSong(song), [song]);
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      seqRef.current?.dispose();
      seqRef.current = null;
    },
    [],
  );

  const audition = (pitch: number) => sequencer().preview(latest.current.track.id, pitch);

  const play = (from: number) => {
    const seq = sequencer();
    const { song } = latest.current;
    seq.setSong(song);
    seq.start(fixedClock(song.bpm, getSynth().now + 0.05, from), from);
    setTransport({ playing: true, pos: from });
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const beat = seq.beat ?? 0;
      if (beat > songLengthBeats(latest.current.song) + 0.5) return stop();
      setTransport({ playing: true, pos: Math.max(0, beat) });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const pause = () => {
    cancelAnimationFrame(rafRef.current);
    const pos = seqRef.current?.beat ?? latest.current.transport.pos;
    seqRef.current?.stop();
    setTransport({ playing: false, pos: Math.max(0, pos) });
  };
  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    seqRef.current?.stop();
    setTransport({ playing: false, pos: 0 });
  };
  const seek = (beat: number) => {
    if (latest.current.transport.playing) play(beat);
    else setTransport({ playing: false, pos: beat });
  };
  const togglePlay = () => (latest.current.transport.playing ? pause() : play(latest.current.transport.pos));

  // Con otro tempo, el reloj fijo ya no vale: se retoma desde donde iba.
  useEffect(() => {
    if (latest.current.transport.playing) play(seqRef.current?.beat ?? latest.current.transport.pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.bpm]);

  // ---- Edición ----

  const deleteSelection = () => {
    const { track, sel } = latest.current;
    if (!sel.notes.size && !sel.repeats.size) return;
    updateTrack({
      ...track,
      notes: track.notes.filter((_, i) => !sel.notes.has(i)),
      repeats: track.repeats.filter((_, i) => !sel.repeats.has(i)),
    });
    setSel(EMPTY);
  };

  const selectAll = () => {
    const { track } = latest.current;
    setSel({ notes: new Set(track.notes.keys()), repeats: new Set(track.repeats.keys()) });
  };

  const hitNote = (x: number, y: number): PlayedNote | null => {
    const beat = beatAt(x);
    const pitch = pitchAt(y);
    const hits = played.filter((p) => p.note.pitch === pitch && beat >= p.note.beat && beat <= p.note.beat + p.note.duration);
    return hits.find((p) => p.copy === 0) ?? hits[0] ?? null;
  };

  const hitBracket = (x: number) => track.repeats.findIndex((r) => {
    const pr = playedRepeat(track, r);
    return x >= xOf(pr.start) && x <= xOf(pr.end);
  });

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    setPopup(null);
    if (x < KEYS_W) {
      if (y > RULER_H) audition(pitchAt(y));
      return;
    }
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (y < RULER_H) {
      dragRef.current = { kind: 'ruler', x0: x, dragged: false };
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const hit = hitNote(x, y);
    if (e.button === 2) {
      if (hit?.copy === 0) {
        updateTrack({ ...track, notes: track.notes.filter((_, i) => i !== hit.index) });
        setSel(EMPTY);
      }
      return;
    }
    if (hit && hit.copy > 0) {
      setMessage('Las vueltas extra de una repetición se editan en la primera vuelta');
      return;
    }
    if (ctrl) {
      if (hit) {
        const notes = new Set(sel.notes);
        if (notes.has(hit.index)) notes.delete(hit.index);
        else notes.add(hit.index);
        setSel({ notes, repeats: sel.repeats });
      } else {
        dragRef.current = { kind: 'marquee', x0: x, y0: y };
        setMarquee({ x0: x, y0: y, x1: x, y1: y });
      }
      return;
    }
    if (hit) {
      const nearEnd = xOf(hit.note.beat + hit.note.duration) - x < 7;
      if (nearEnd) {
        setSel({ notes: new Set([hit.index]), repeats: new Set() });
        dragRef.current = { kind: 'resize', index: hit.index, playedStart: hit.note.beat };
        return;
      }
      // Arrastrar una nota ya seleccionada mueve toda la selección.
      const group = sel.notes.has(hit.index) ? sel : { notes: new Set([hit.index]), repeats: new Set<number>() };
      setSel(group);
      const startWritten = writtenBeat(track, beatAt(x)) ?? track.notes[hit.index].beat;
      dragRef.current = { kind: 'move', original: track, sel: group, startWritten, startPitch: pitchAt(y), lastPitch: hit.note.pitch };
      return;
    }
    // Click en un lugar vacío: deselecciona y crea una nota.
    const playedAt = Math.floor(beatAt(x) / SNAP) * SNAP;
    const beat = writtenBeat(track, playedAt);
    const pitch = pitchAt(y);
    if (beat === null || beat < 0 || pitch < LOW || pitch > HIGH) {
      setSel(EMPTY);
      return;
    }
    const index = track.notes.length;
    updateTrack({ ...track, notes: [...track.notes, { pitch, beat, duration: noteLength }] });
    setSel({ notes: new Set([index]), repeats: new Set() });
    dragRef.current = { kind: 'resize', index, playedStart: playedAt };
    audition(pitch);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    const drag = dragRef.current;
    const canvas = canvasRef.current!;
    if (!drag) {
      if (y < RULER_H) canvas.style.cursor = x > KEYS_W ? 'text' : 'default';
      else {
        const hit = x > KEYS_W ? hitNote(x, y) : null;
        canvas.style.cursor = !hit ? (e.ctrlKey ? 'cell' : 'crosshair') : hit.copy > 0 ? 'not-allowed' : xOf(hit.note.beat + hit.note.duration) - x < 7 ? 'ew-resize' : 'grab';
      }
      return;
    }
    if (drag.kind === 'ruler') {
      if (!drag.dragged && Math.abs(x - drag.x0) < DRAG_PX) return;
      drag.dragged = true;
      const bpb = song.beatsPerBar;
      const a = Math.min(beatAt(drag.x0), beatAt(x));
      const b = Math.max(beatAt(drag.x0), beatAt(x));
      const start = Math.max(0, Math.floor(a / bpb) * bpb);
      setRange({ start, end: Math.max(start + bpb, Math.ceil(b / bpb) * bpb) });
      return;
    }
    if (drag.kind === 'marquee') {
      setMarquee({ x0: drag.x0, y0: drag.y0, x1: x, y1: y });
      return;
    }
    if (drag.kind === 'resize') {
      const n = track.notes[drag.index];
      const duration = Math.max(SNAP, Math.round((beatAt(x) - drag.playedStart) / SNAP) * SNAP);
      if (n && duration !== n.duration) updateTrack({ ...track, notes: track.notes.map((m, i) => (i === drag.index ? { ...m, duration } : m)) });
      return;
    }
    // Mover: el desplazamiento se mide en beats escritos, sobre la pista original.
    const w = writtenBeat(drag.original, beatAt(x));
    if (w === null) return; // sobre una vuelta extra: se queda donde estaba
    const dBeat = Math.round((w - drag.startWritten) / SNAP) * SNAP;
    const dPitch = pitchAt(y) - drag.startPitch;
    const moved = moveSelection(drag.original, drag.sel.notes, drag.sel.repeats, dBeat, dPitch, LOW, HIGH);
    if (!moved) return;
    const anchor = [...drag.sel.notes][0];
    if (anchor !== undefined && moved.notes[anchor].pitch !== drag.lastPitch) {
      drag.lastPitch = moved.notes[anchor].pitch;
      audition(drag.lastPitch);
    }
    updateTrack(moved);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const { x } = local(e);
    if (drag.kind === 'marquee' && marquee) {
      const b0 = beatAt(Math.min(marquee.x0, marquee.x1));
      const b1 = beatAt(Math.max(marquee.x0, marquee.x1));
      const p0 = pitchAt(Math.max(marquee.y0, marquee.y1));
      const p1 = pitchAt(Math.min(marquee.y0, marquee.y1));
      const notes = new Set(
        played.filter((p) => p.copy === 0 && p.note.pitch >= p0 && p.note.pitch <= p1 && p.note.beat < b1 && p.note.beat + p.note.duration > b0).map((p) => p.index),
      );
      setSel({ notes, repeats: new Set() });
      setMarquee(null);
    }
    if (drag.kind === 'ruler') {
      if (!drag.dragged) {
        const i = hitBracket(x);
        const yy = local(e).y;
        if (i >= 0 && yy >= BRACKET_Y - 2) {
          const pr = playedRepeat(track, track.repeats[i]);
          const label = `Repetición ${barsLabel(pr.start, pr.firstEnd, song.beatsPerBar)}`;
          setPopup({ kind: 'edit', index: i, times: track.repeats[i].times, x, label });
        } else seek(Math.max(0, beatAt(x)));
        return;
      }
      const r = range;
      setRange(null);
      if (!r) return;
      // El fin es exclusivo: se convierte el último instante del tramo.
      const start = writtenBeat(track, r.start);
      const last = writtenBeat(track, r.end - 1e-6);
      if (start === null || last === null || Math.round((last + 1e-6 - start) * 1000) / 1000 !== r.end - r.start) {
        setMessage('El tramo no puede incluir vueltas de otra repetición');
        return;
      }
      const label = `Repetir ${barsLabel(r.start, r.end, song.beatsPerBar)}`;
      setPopup({ kind: 'new', start, end: start + (r.end - r.start), times: 2, x: xOf(r.start), label });
    }
  };

  const applyPopup = () => {
    if (!popup) return;
    const times = Math.max(2, Math.min(64, Math.round(popup.times)));
    if (popup.kind === 'new') {
      const repeats = addRepeat(track, { start: popup.start, end: popup.end, times });
      if (typeof repeats === 'string') setMessage(repeats);
      else updateTrack({ ...track, repeats });
    } else {
      updateTrack({ ...track, repeats: track.repeats.map((r, i) => (i === popup.index ? { ...r, times } : r)) });
    }
    setPopup(null);
  };
  const removeRepeat = (index: number) => {
    updateTrack({ ...track, repeats: track.repeats.filter((_, i) => i !== index) });
    setSel(EMPTY);
    setPopup(null);
  };

  // ---- Teclado ----

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === 'Escape') {
      setSel(EMPTY);
      setPopup(null);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- Dibujo ----

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#151920';
    ctx.fillRect(0, 0, size.w, size.h);

    // Filas
    for (let p = LOW; p <= HIGH; p++) {
      const y = yOf(p);
      if (y > size.h || y + ROW_H < RULER_H) continue;
      ctx.fillStyle = isBlackKey(p) ? '#1a1f28' : '#20262f';
      ctx.fillRect(KEYS_W, y, size.w, ROW_H);
      if (p % 12 === 0) {
        ctx.fillStyle = '#323b49';
        ctx.fillRect(KEYS_W, y + ROW_H - 1, size.w, 1);
      }
    }
    // Columnas: semicorcheas, beats y compases
    const first = Math.floor(scroll.x / SNAP) * SNAP;
    for (let b = first; b <= scroll.x + size.w / pxPerBeat; b += SNAP) {
      const x = Math.round(xOf(b)) + 0.5;
      const isBar = Math.abs(b % song.beatsPerBar) < 1e-6;
      const isBeat = Math.abs(b % 1) < 1e-6;
      ctx.strokeStyle = isBar ? '#56617a' : isBeat ? '#353e4d' : '#262d38';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    // Vueltas extra de las repeticiones de la pista activa
    for (const r of track.repeats) {
      const pr = playedRepeat(track, r);
      ctx.fillStyle = 'rgba(127,178,255,0.06)';
      ctx.fillRect(xOf(pr.firstEnd), RULER_H, (pr.end - pr.firstEnd) * pxPerBeat, size.h);
      ctx.fillStyle = 'rgba(127,178,255,0.35)';
      ctx.fillRect(Math.round(xOf(pr.firstEnd)) - 1, RULER_H, 2, size.h);
    }
    // Tramo de repetición que se está marcando
    if (range) {
      ctx.fillStyle = 'rgba(255,204,51,0.08)';
      ctx.fillRect(xOf(range.start), RULER_H, (range.end - range.start) * pxPerBeat, size.h);
    }
    // Fuera de la pista
    const endX = xOf(availableBeats);
    if (endX < size.w) {
      ctx.fillStyle = 'rgba(224,58,58,0.10)';
      ctx.fillRect(Math.max(KEYS_W, endX), RULER_H, size.w, size.h);
      ctx.fillStyle = '#e03a3a';
      ctx.fillRect(endX - 1, RULER_H, 2, size.h);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('fin de pista', endX + 4, RULER_H + 12);
    }
    const drawNote = (beat: number, pitch: number, duration: number, fill: string) => {
      const x = xOf(beat);
      const y = yOf(pitch);
      const w = Math.max(4, duration * pxPerBeat - 2);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, w, ROW_H - 2, 3);
      ctx.fill();
      return { x, y, w };
    };
    // Las otras pistas, detrás y semitransparentes
    ctx.globalAlpha = 0.22;
    for (const t of song.tracks) {
      if (t.id === track.id) continue;
      for (const n of unroll(t)) drawNote(n.beat, n.pitch, n.duration, '#aab4c8');
    }
    ctx.globalAlpha = 1;
    // La pista activa
    for (const p of played) {
      const n = p.note;
      const out = isMain && n.beat > availableBeats;
      ctx.globalAlpha = p.copy > 0 ? 0.4 : 1;
      const { x, y, w } = drawNote(n.beat, n.pitch, n.duration, out ? '#5a2a2a' : `hsl(${pitchHue(n.pitch) * 360} 70% 55%)`);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + w - 3, y + 2, 2, ROW_H - 4);
      if (p.copy === 0 && sel.notes.has(p.index)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, w, ROW_H - 2, 3);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    ctx.globalAlpha = 1;
    // Selección por rectángulo
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    }
    // Cabezal de reproducción
    if (transport.playing || transport.pos > 0) {
      const x = xOf(transport.pos);
      ctx.fillStyle = transport.playing ? '#ffffff' : '#ffcc33';
      ctx.fillRect(x - 1, 0, 2, size.h);
    }
    // Regla
    ctx.fillStyle = 'rgba(21,25,32,0.95)';
    ctx.fillRect(KEYS_W, 0, size.w, RULER_H);
    ctx.fillStyle = '#323b49';
    ctx.fillRect(KEYS_W, RULER_H - 1, size.w, 1);
    ctx.fillStyle = '#9aa5b8';
    ctx.font = '11px system-ui, sans-serif';
    for (let bar = Math.max(0, Math.floor(scroll.x / song.beatsPerBar)); bar * song.beatsPerBar < scroll.x + size.w / pxPerBeat; bar++) {
      const x = xOf(bar * song.beatsPerBar);
      ctx.fillRect(Math.round(x), 2, 1, 12);
      ctx.fillText(`c.${bar + 1}`, x + 3, 12);
    }
    if (range) {
      ctx.fillStyle = 'rgba(255,204,51,0.35)';
      ctx.fillRect(xOf(range.start), BRACKET_Y - 2, (range.end - range.start) * pxPerBeat, RULER_H - BRACKET_Y);
    }
    // Corchetes de repetición: abarcan todas las vueltas; una marca donde termina la primera.
    track.repeats.forEach((r, i) => {
      const pr = playedRepeat(track, r);
      const x0 = xOf(pr.start) + 1;
      const x1 = xOf(pr.end) - 1;
      const color = sel.repeats.has(i) ? '#ffcc33' : '#7fb2ff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, RULER_H - 3);
      ctx.lineTo(x0, BRACKET_Y + 2);
      ctx.lineTo(x1, BRACKET_Y + 2);
      ctx.lineTo(x1, RULER_H - 3);
      ctx.moveTo(xOf(pr.firstEnd), BRACKET_Y + 2);
      ctx.lineTo(xOf(pr.firstEnd), RULER_H - 6);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = color;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(`×${r.times}`, x0 + 5, RULER_H - 4);
    });
    // Teclado
    for (let p = LOW; p <= HIGH; p++) {
      const y = yOf(p);
      if (y > size.h || y + ROW_H < RULER_H) continue;
      ctx.fillStyle = isBlackKey(p) ? '#2a2f38' : '#d9dde5';
      ctx.fillRect(0, y, KEYS_W - 2, ROW_H - 1);
      if (p % 12 === 0) {
        ctx.fillStyle = '#20262f';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(noteName(p), 4, y + ROW_H - 3);
      }
    }
    ctx.fillStyle = '#151920';
    ctx.fillRect(0, 0, KEYS_W, RULER_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, track, played, sel, marquee, range, size, scroll, pxPerBeat, transport, availableBeats]);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      setPxPerBeat((p) => Math.max(12, Math.min(120, p * (e.deltaY > 0 ? 0.9 : 1.1))));
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? 0 : e.deltaY;
    setScroll((s) => ({
      x: Math.max(-0.5, Math.min(totalBeats, s.x + dx / pxPerBeat)),
      y: Math.max(0, Math.min(gridH - (size.h - RULER_H), s.y + dy)),
    }));
  };

  // Listener nativo (no pasivo) para poder evitar el zoom/scroll del navegador.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = wrapRef.current!;
    const handler = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ---- Pistas ----

  const addTrack = () => {
    const t: SongTrack = { id: newId(), name: `Pista ${song.tracks.length + 1}`, instrument: 'synth:bass', notes: [], repeats: [] };
    onTracksChange([...song.tracks, t]);
    onSelectTrack(t.id);
  };
  const removeTrack = () => {
    if (track.main || !confirm(`¿Borrar la pista «${track.name}»?`)) return;
    onTracksChange(song.tracks.filter((t) => t.id !== track.id));
    onSelectTrack(song.tracks.find((t) => t.main)!.id);
  };
  const makeMain = () => onTracksChange(song.tracks.map(({ main: _main, ...t }) => (t.id === track.id ? { ...t, main: true } : t)));
  const knownInstrument = INSTRUMENTS.some((i) => i.id === track.instrument);
  const hasSound = songLengthBeats(song) > 0;

  return (
    <div className="pianoroll">
      <div className="pianoroll-bar">
        <div className="transport">
          <button className="btn primary" onClick={togglePlay} disabled={!hasSound} title="Reproducir / pausar (espacio)">
            {transport.playing ? '⏸' : '▶'}
          </button>
          <button className="btn" onClick={stop} disabled={!transport.playing && transport.pos === 0} title="Detener y volver al inicio">
            ■
          </button>
          <span className="position">c.{Math.floor(transport.pos / song.beatsPerBar) + 1}:{(Math.floor(transport.pos % song.beatsPerBar) + 1).toString()}</span>
        </div>
        <div className="track-controls">
          <select value={track.id} onChange={(e) => onSelectTrack(e.target.value)} aria-label="Pista">
            {song.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.main ? '★ ' : ''}
                {t.name}
              </option>
            ))}
          </select>
          <input className="track-title" value={track.name} onChange={(e) => updateTrack({ ...track, name: e.target.value })} aria-label="Nombre de la pista" />
          <select value={track.instrument} onChange={(e) => updateTrack({ ...track, instrument: e.target.value })} aria-label="Instrumento">
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
            {!knownInstrument && <option value={track.instrument}>{track.instrument} (no disponible)</option>}
          </select>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={track.volume ?? 1}
            onChange={(e) => updateTrack({ ...track, volume: +e.target.value })}
            title="Volumen"
            aria-label="Volumen"
          />
          <button className="btn ghost" onClick={makeMain} disabled={isMain} title="La pista principal es la que toca el auto">
            {isMain ? '★ Principal' : '☆ Hacer principal'}
          </button>
          <button className="btn ghost" onClick={addTrack}>
            + Pista
          </button>
          <button className="btn ghost danger" onClick={removeTrack} disabled={isMain} title={isMain ? 'La pista principal no se puede borrar' : 'Borrar pista'}>
            Borrar pista
          </button>
        </div>
      </div>
      <div ref={wrapRef} className="pianoroll-canvas">
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {popup && (
          <div className="repeat-popup" style={{ left: Math.min(Math.max(KEYS_W, popup.x), size.w - 260), top: RULER_H + 4 }}>
            <span>{popup.label}</span>
            <label>
              ×
              <input
                type="number"
                min={2}
                max={64}
                value={popup.times}
                autoFocus
                onChange={(e) => setPopup({ ...popup, times: +e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyPopup();
                  if (e.key === 'Escape') setPopup(null);
                }}
              />
            </label>
            <button className="btn primary" onClick={applyPopup}>
              Aplicar
            </button>
            {popup.kind === 'edit' && (
              <button className="btn ghost danger" onClick={() => removeRepeat(popup.index)}>
                Quitar
              </button>
            )}
            <button className="btn ghost" onClick={() => setPopup(null)}>
              ✕
            </button>
          </div>
        )}
        {message && <div className="pianoroll-toast">{message}</div>}
      </div>
      <div className="hint-text pianoroll-help">
        Click: agregar / seleccionar · arrastrar: mover la selección / estirar del borde · Ctrl+arrastrar: seleccionar · Ctrl+A: todo · Supr: borrar · click
        derecho: borrar nota · regla: click mueve el cabezal, arrastrar marca una repetición · espacio: ▶/⏸ · rueda: desplazar (Shift: horizontal, Ctrl: zoom)
      </div>
    </div>
  );
}
