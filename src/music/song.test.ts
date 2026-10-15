import { describe, expect, it } from 'vitest';
import type { Repeat, SongNote, SongTrack } from '../track/types';
import { addRepeat, moveSelection, playedBeat, playedRepeat, songLengthBeats, unroll, unrollWithSource, writtenBeat } from './song';

const note = (beat: number, pitch = 60, duration = 1): SongNote => ({ pitch, beat, duration });
const track = (notes: SongNote[], repeats: Repeat[] = []): SongTrack => ({ id: 't', name: 'T', instrument: 'marimba', notes, repeats });
const beats = (t: SongTrack) => unroll(t).map((n) => n.beat);

describe('unroll', () => {
  it('sin repeticiones devuelve las mismas notas, ordenadas', () => {
    expect(beats(track([note(3), note(0), note(1)]))).toEqual([0, 1, 3]);
  });

  it('copia el tramo en cada vuelta y corre lo que sigue', () => {
    // Tramo [0, 4) tres veces: suena en 0, 4 y 8. La nota en 4 pasa a 12.
    const t = track([note(0), note(2), note(4)], [{ start: 0, end: 4, times: 3 }]);
    expect(beats(t)).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it('lo anterior a la repetición no se mueve', () => {
    const t = track([note(1), note(4), note(9)], [{ start: 4, end: 8, times: 2 }]);
    expect(beats(t)).toEqual([1, 4, 8, 13]);
  });

  it('acumula el corrimiento de varias repeticiones', () => {
    const t = track([note(0), note(4), note(8)], [
      { start: 0, end: 4, times: 2 },
      { start: 4, end: 8, times: 3 },
    ]);
    // [0,4)×2 → 0, 4 · [4,8)×3 corrido 4 → 8, 12, 16 · el 8 corrido 4 + 8 → 20
    expect(beats(t)).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it('una nota en el borde final pertenece a lo que sigue', () => {
    const t = track([note(4)], [{ start: 0, end: 4, times: 2 }]);
    expect(beats(t)).toEqual([8]);
  });

  it('conserva altura y duración en las copias', () => {
    const t = track([note(1, 72, 2.5)], [{ start: 0, end: 4, times: 2 }]);
    expect(unroll(t)).toEqual([note(1, 72, 2.5), note(5, 72, 2.5)]);
  });
});

describe('writtenBeat', () => {
  const t = track([], [
    { start: 4, end: 8, times: 3 },
    { start: 12, end: 16, times: 2 },
  ]);

  it('antes de la primera repetición es igual', () => {
    expect(writtenBeat(t, 2)).toBe(2);
  });

  it('la primera vuelta se edita; las extra no', () => {
    expect(writtenBeat(t, 5)).toBe(5);
    expect(writtenBeat(t, 9)).toBeNull();
    expect(writtenBeat(t, 15.5)).toBeNull();
  });

  it('después de las vueltas descuenta el corrimiento', () => {
    // [4,8)×3 suma 8 beats: el beat tocado 16 es el escrito 8.
    expect(writtenBeat(t, 16)).toBe(8);
    // Segunda repetición: escrita [12,16), tocada [20,24) y su copia [24,28).
    expect(writtenBeat(t, 21)).toBe(13);
    expect(writtenBeat(t, 25)).toBeNull();
    expect(writtenBeat(t, 28)).toBe(16);
  });

  it('es el inverso de unroll para las notas de la primera vuelta', () => {
    const r = track([note(0), note(5), note(13), note(20)], t.repeats);
    const played = unroll(r).map((n) => writtenBeat(r, n.beat)).filter((b) => b !== null);
    expect(played).toEqual([0, 5, 13, 20]);
  });
});

describe('songLengthBeats', () => {
  it('toma la pista desplegada más larga', () => {
    const lead = track([note(0, 60, 4)]);
    const drums = track([note(3)], [{ start: 0, end: 4, times: 4 }]);
    expect(songLengthBeats({ bpm: 120, beatsPerBar: 4, designSpeed: 30, startOffset: 0, tracks: [lead, drums] })).toBe(16);
  });
});

describe('unrollWithSource y playedBeat', () => {
  const t = track([note(1), note(5), note(9)], [{ start: 4, end: 8, times: 3 }]);

  it('indica de qué nota escrita y de qué vuelta viene cada nota', () => {
    expect(unrollWithSource(t).map((p) => [p.note.beat, p.index, p.copy])).toEqual([
      [1, 0, 0],
      [5, 1, 0],
      [9, 1, 1],
      [13, 1, 2],
      [17, 2, 0],
    ]);
  });

  it('playedBeat ubica la primera vuelta de un beat escrito', () => {
    expect(playedBeat(t, 1)).toBe(1);
    expect(playedBeat(t, 5)).toBe(5);
    expect(playedBeat(t, 8)).toBe(16);
    expect(playedRepeat(t, t.repeats[0])).toEqual({ start: 4, end: 16, firstEnd: 8 });
  });
});

describe('addRepeat', () => {
  const t = track([], [{ start: 4, end: 8, times: 2 }]);

  it('agrega y ordena', () => {
    expect(addRepeat(t, { start: 0, end: 4, times: 3 })).toEqual([
      { start: 0, end: 4, times: 3 },
      { start: 4, end: 8, times: 2 },
    ]);
  });

  it('rechaza superposiciones y tramos inválidos', () => {
    expect(typeof addRepeat(t, { start: 6, end: 10, times: 2 })).toBe('string');
    expect(typeof addRepeat(t, { start: 0, end: 0, times: 2 })).toBe('string');
    expect(typeof addRepeat(t, { start: 0, end: 4, times: 1 })).toBe('string');
  });
});

describe('moveSelection', () => {
  const t = track([note(0, 60), note(2, 62), note(4, 64)], [
    { start: 0, end: 4, times: 2 },
    { start: 8, end: 12, times: 2 },
  ]);

  it('mueve solo lo seleccionado', () => {
    const m = moveSelection(t, new Set([1]), new Set(), 1, 2, 48, 84)!;
    expect(m.notes).toEqual([note(0, 60), note(3, 64), note(4, 64)]);
    expect(m.repeats).toEqual(t.repeats);
  });

  it('mueve notas y repeticiones juntas (Ctrl+A)', () => {
    const m = moveSelection(t, new Set([0, 1, 2]), new Set([0, 1]), 4, 0, 48, 84)!;
    expect(m.notes.map((n) => n.beat)).toEqual([4, 6, 8]);
    expect(m.repeats).toEqual([
      { start: 4, end: 8, times: 2 },
      { start: 12, end: 16, times: 2 },
    ]);
  });

  it('no deja nada antes del beat 0 ni fuera del rango de alturas', () => {
    const m = moveSelection(t, new Set([1, 2]), new Set(), -10, 30, 48, 84)!;
    expect(m.notes.map((n) => [n.beat, n.pitch])).toEqual([
      [0, 60],
      [0, 82],
      [2, 84],
    ]);
  });

  it('rechaza mover una repetición encima de otra', () => {
    expect(moveSelection(t, new Set(), new Set([0]), 6, 0, 48, 84)).toBeNull();
  });
});
