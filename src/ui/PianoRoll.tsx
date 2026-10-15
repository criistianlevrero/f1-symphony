import { useCallback, useEffect, useRef, useState } from 'react';
import { getSynth } from '../music/audio';
import { audioDeps, fixedClock, Sequencer } from '../music/Sequencer';
import { songLengthBeats } from '../music/song';
import { isBlackKey, noteName, pitchHue } from '../music/theory';
import type { Song, SongNote } from '../track/types';

const LOW = 48; // C3
const HIGH = 84; // C6
const ROW_H = 13;
const KEYS_W = 44;
const RULER_H = 20;
const SNAP = 0.25;

interface Props {
  song: Song;
  /** Notas de la pista que se edita. */
  notes: SongNote[];
  onChange: (notes: SongNote[]) => void;
  /** Beats que entran en la pista a la velocidad de diseño. */
  availableBeats: number;
  noteLength: number;
}

type Drag =
  | { kind: 'move'; index: number; offsetBeat: number; startPitch: number; moved: boolean }
  | { kind: 'resize'; index: number }
  | null;

/** Piano roll dibujado en canvas: filas = notas, columnas = beats. */
export function PianoRoll({ song, notes, onChange, availableBeats, noteLength }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 260 });
  const [scroll, setScroll] = useState({ x: -0.5, y: (HIGH - 79) * ROW_H });
  const [pxPerBeat, setPxPerBeat] = useState(36);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const dragRef = useRef<Drag>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const stopRef = useRef<() => void>(() => {});

  const totalBeats = Math.max(32, Math.ceil(availableBeats) + 4, ...notes.map((n) => Math.ceil(n.beat + n.duration) + 8));
  const gridH = (HIGH - LOW + 1) * ROW_H;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);

  // Conversión pantalla ↔ partitura.
  const xOf = (beat: number) => KEYS_W + (beat - scroll.x) * pxPerBeat;
  const yOf = (pitch: number) => RULER_H + (HIGH - pitch) * ROW_H - scroll.y;
  const beatAt = (x: number) => (x - KEYS_W) / pxPerBeat + scroll.x;
  const pitchAt = (y: number) => HIGH - Math.floor((y - RULER_H + scroll.y) / ROW_H);

  // Dibujo.
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
      if (isBar && b >= 0) {
        ctx.fillStyle = '#9aa5b8';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(String(b / song.beatsPerBar + 1), x + 3, 14);
      }
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
    // Notas
    for (const n of notes) {
      const x = xOf(n.beat);
      const y = yOf(n.pitch);
      const w = Math.max(4, n.duration * pxPerBeat - 2);
      const out = n.beat > availableBeats;
      ctx.fillStyle = out ? '#5a2a2a' : `hsl(${pitchHue(n.pitch) * 360} 70% 55%)`;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, w, ROW_H - 2, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + w - 3, y + 2, 2, ROW_H - 4);
    }
    // Cabezal de reproducción
    if (playhead !== null) {
      const x = xOf(playhead);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, RULER_H, 2, size.h);
    }
    // Regla
    ctx.fillStyle = 'rgba(21,25,32,0.9)';
    ctx.fillRect(KEYS_W, 0, size.w, RULER_H);
    ctx.fillStyle = '#9aa5b8';
    ctx.font = '11px system-ui, sans-serif';
    for (let bar = Math.max(0, Math.floor(scroll.x / song.beatsPerBar)); bar * song.beatsPerBar < scroll.x + size.w / pxPerBeat; bar++) {
      ctx.fillText(`c.${bar + 1}`, xOf(bar * song.beatsPerBar) + 3, 14);
    }
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
  }, [song, notes, size, scroll, pxPerBeat, playhead, availableBeats]);

  const audition = (pitch: number) => getSynth().note(pitch, 0.3);

  const hitTest = (x: number, y: number) => {
    const beat = beatAt(x);
    const pitch = pitchAt(y);
    const index = notesRef.current.findIndex((n) => n.pitch === pitch && beat >= n.beat && beat <= n.beat + n.duration);
    if (index < 0) return null;
    const n = notesRef.current[index];
    const nearEnd = xOf(n.beat + n.duration) - x < 7;
    return { index, nearEnd };
  };

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    if (x < KEYS_W) {
      if (y > RULER_H) audition(pitchAt(y));
      return;
    }
    if (y < RULER_H) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const hit = hitTest(x, y);
    const notes = notesRef.current;
    if (e.button === 2) {
      if (hit) onChange(notes.filter((_, i) => i !== hit.index));
      return;
    }
    if (hit) {
      dragRef.current = hit.nearEnd
        ? { kind: 'resize', index: hit.index }
        : { kind: 'move', index: hit.index, offsetBeat: beatAt(x) - notes[hit.index].beat, startPitch: notes[hit.index].pitch, moved: false };
      return;
    }
    const beat = Math.floor(beatAt(x) / SNAP) * SNAP;
    const pitch = pitchAt(y);
    if (beat < 0 || pitch < LOW || pitch > HIGH) return;
    onChange([...notes, { pitch, beat, duration: noteLength }]);
    dragRef.current = { kind: 'resize', index: notes.length };
    audition(pitch);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    const drag = dragRef.current;
    const canvas = canvasRef.current!;
    if (!drag) {
      const hit = x > KEYS_W && y > RULER_H ? hitTest(x, y) : null;
      canvas.style.cursor = hit ? (hit.nearEnd ? 'ew-resize' : 'grab') : 'crosshair';
      return;
    }
    const notes = notesRef.current.slice();
    const n = { ...notes[drag.index] };
    if (drag.kind === 'resize') {
      n.duration = Math.max(SNAP, Math.round((beatAt(x) - n.beat) / SNAP) * SNAP);
    } else {
      n.beat = Math.max(0, Math.round((beatAt(x) - drag.offsetBeat) / SNAP) * SNAP);
      const pitch = Math.max(LOW, Math.min(HIGH, pitchAt(y)));
      if (pitch !== n.pitch) audition(pitch);
      n.pitch = pitch;
      drag.moved = true;
    }
    if (n.beat === notes[drag.index].beat && n.pitch === notes[drag.index].pitch && n.duration === notes[drag.index].duration) return;
    notes[drag.index] = n;
    onChange(notes);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

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

  // Reproducción de prueba: todas las pistas, con el secuenciador.
  const seqRef = useRef<Sequencer | null>(null);
  useEffect(() => seqRef.current?.setSong(song), [song]);
  useEffect(
    () => () => {
      seqRef.current?.dispose();
      seqRef.current = null;
    },
    [],
  );
  const stop = useCallback(() => stopRef.current(), []);
  const play = () => {
    stop();
    const synth = getSynth();
    seqRef.current ??= new Sequencer(audioDeps(synth));
    const seq = seqRef.current;
    seq.setSong(song);
    seq.start(fixedClock(song.bpm, synth.now + 0.1, 0), 0);
    const end = songLengthBeats(song);
    let raf = 0;
    const tick = () => {
      const beat = seq.beat ?? 0;
      if (beat > end + 0.5) return stopRef.current();
      setPlayhead(Math.max(0, beat));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    stopRef.current = () => {
      cancelAnimationFrame(raf);
      seq.stop();
      setPlayhead(null);
      stopRef.current = () => {};
    };
  };
  useEffect(() => stop, [stop]);

  return (
    <div className="pianoroll">
      <div className="pianoroll-bar">
        {playhead === null ? (
          <button className="btn primary" onClick={play} disabled={!songLengthBeats(song)}>
            ▶ Escuchar
          </button>
        ) : (
          <button className="btn" onClick={stop}>
            ■ Parar
          </button>
        )}
        <span className="hint-text">
          Click: agregar · arrastrar: mover / estirar del borde · click derecho: borrar · rueda: desplazar (Shift: horizontal, Ctrl: zoom)
        </span>
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
      </div>
    </div>
  );
}
